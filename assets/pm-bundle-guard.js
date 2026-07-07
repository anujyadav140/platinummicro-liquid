/* build: pm-bundle-guard 2026-07-07-cart-reload-loop-fix (force CDN re-hash) */
/* PM — Bundle integrity guard.
 *
 * Migrated BigCommerce bundles add TWO cart lines: the base unit on a
 * discounted "(Pack of N)" variant (properties._bundle = "base") plus the
 * drive pack product (properties._bundle = "addon"). BigCommerce sold the
 * same thing as ONE unsplittable line; on Shopify a customer can delete the
 * drives and keep the discounted base ($874.93 instead of $901.99). This
 * guard puts the base back to full price when its drives are gone.
 *
 * ── Why the earlier versions glitched ──
 * They reacted to every cart event immediately, mutating the cart (remove
 * discounted line, add plain line) while the customer was still clicking.
 * The drawer, meanwhile, repainted from those half-finished states — SKUs
 * flashed in and out, and rapid "delete everything" resurrected the last
 * line. Whack-a-mole intent checks couldn't win a fundamentally racy design.
 *
 * ── This version: quiescence + suspension ──
 * 1. QUIESCENCE — the guard never touches the cart mid-interaction. Every
 *    cart event (re)starts a short quiet timer; only after the customer
 *    STOPS for QUIET_MS does it reconcile the ONE final cart state. Rapid
 *    deletes/edits collapse into a single reconciliation of the end state,
 *    so nothing races.
 * 2. SUSPENSION — from the moment a bundle's drives are removed until the
 *    swap lands, the drawer's repaints are suspended (window.__pmSuspend-
 *    CartRender). The optimistic DOM (drive row gone, base price shown at
 *    full price) stays put; the guard does one authoritative render at the
 *    end. No flashing.
 * 3. OPTIMISTIC PAINT — the base line's price flips to full price the
 *    instant the drives are trashed (cosmetic), so it FEELS immediate while
 *    the real swap settles quietly behind the suspension.
 * 4. INTENT — if the customer deletes the base themselves, the guard stands
 *    down (no resurrection).
 * Safety: the swap is atomic (remove by stable key, verify each step, and
 * restore the original on a half-failure); suspension self-releases via a
 * failsafe so a bug can never freeze the drawer.
 */
(function () {
  'use strict';

  var QUIET_MS = 450;     // reconcile only after the cart is quiet this long
  var FAILSAFE_MS = 9000; // hard ceiling on how long renders stay suspended
                          // (must exceed the swap + settle poll below)

  var plainCache = {};    // handle -> { id, price } of the full-price variant
  var lastCart = null;    // most recent cart snapshot (for click-time prediction)
  var userRemoved = {};   // line key -> ts of a customer-initiated removal
  var swapped = {};       // discounted-base key -> ts, AFTER we've removed it
  var swapFailed = {};    // base SKU -> ts of a FAILED swap (add didn't land).
                          // The failed swap re-adds the discounted base under a
                          // FRESH key, which findOrphans would otherwise re-pick
                          // and re-swap immediately — a tight loop that repaints
                          // the discounted price over and over. Skip that SKU for
                          // a short cooldown so one bad swap can't oscillate.
  var awaitingPlain = {}; // base SKU -> true, while we wait for its full-price
                          // line to appear in /cart.js (so we never render a
                          // moment where the base row is missing entirely)
  var quietTimer = null;
  var failsafeTimer = null;
  var running = false;
  var mutated = false;    // did THIS reconcile actually swap a line? Gates the
                          // /cart reload: a clean cart (no orphans) must never
                          // reload, or the init reconcile would loop the page.

  function isPackVariant(text) { return /pack of \d+/i.test(String(text || '')); }
  function lineIsDiscountedBase(l) {
    var p = l.properties || {};
    return p._bundle === 'base' && isPackVariant((l.variant_title || '') + ' ' + (l.title || ''));
  }
  function fmtMoney(c) { return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function noteUserRemoved(key) { if (key) userRemoved[key] = Date.now(); }
  function recentlyUserRemoved(key) {
    var ts = userRemoved[key];
    if (!ts) return false;
    if (Date.now() - ts > 15000) { delete userRemoved[key]; return false; }
    return true;
  }

  // A discounted base we've already SUCCESSFULLY removed. Shopify's /cart.js is
  // eventually consistent, so a sweep right after the swap can still return the
  // old discounted line — without this we'd re-swap it in a loop (adding a
  // duplicate plain and re-rendering, which the customer sees as flicker).
  function noteSwapped(key) { if (key) swapped[key] = Date.now(); }
  function recentlySwapped(key) {
    var ts = swapped[key];
    if (!ts) return false;
    if (Date.now() - ts > 30000) { delete swapped[key]; return false; } // keys never recur; expire for hygiene
    return true;
  }

  function noteSwapFail(sku) { if (sku) swapFailed[sku] = Date.now(); }
  function recentlySwapFailed(sku) {
    var ts = swapFailed[sku];
    if (!ts) return false;
    if (Date.now() - ts > 8000) { delete swapFailed[sku]; return false; } // brief cooldown, then retry
    return true;
  }

  function prefetchPlain(handle) {
    if (plainCache[handle]) return Promise.resolve(plainCache[handle]);
    return fetch('/products/' + handle + '.js')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (prod) {
        var plain = null;
        ((prod && prod.variants) || []).forEach(function (v) {
          var t = [v.option1, v.option2, v.option3, v.title].filter(Boolean).join(' ');
          if (!plain && !isPackVariant(t)) plain = v;
        });
        if (plain) plainCache[handle] = { id: plain.id, price: plain.price };
        return plainCache[handle] || null;
      })
      .catch(function () { return null; });
  }

  // Cosmetic: flip a base row's price to full price right away.
  function paintOptimistic(base, plain) {
    try {
      var row = document.querySelector('[data-cart-item][data-cart-key="' + base.key + '"]');
      var el = row && row.querySelector('.pm-cart__item-price');
      if (el) el.textContent = fmtMoney(plain.price * base.quantity);
    } catch (e) { /* cosmetic only */ }
  }

  // ── Render suspension (drawer cooperates via the shared flag) ──
  function suspend() {
    window.__pmSuspendCartRender = true;
    clearTimeout(failsafeTimer);
    failsafeTimer = setTimeout(release, FAILSAFE_MS); // never freeze forever
  }
  function release() {
    if (!window.__pmSuspendCartRender) return;
    window.__pmSuspendCartRender = false;
    clearTimeout(failsafeTimer);
  }
  function renderNow() {
    // One authoritative render past the suspension.
    if (window.PmCart && window.PmCart.refresh) window.PmCart.refresh(true);
  }

  // ── Quiescence-gated reconciliation ──
  function schedule() { clearTimeout(quietTimer); quietTimer = setTimeout(reconcile, QUIET_MS); }

  // Find every discounted base whose drives are gone (and the customer didn't
  // delete themselves). Returns an array — a cart can hold several bundles.
  function findOrphans(items) {
    var covered = {};
    items.forEach(function (l) {
      var p = l.properties || {};
      if (p._bundle === 'addon' && p._bundle_base_sku) covered[p._bundle_base_sku] = true;
    });
    return items.filter(function (l) {
      return lineIsDiscountedBase(l) && !covered[l.sku] &&
             !recentlyUserRemoved(l.key) && !recentlySwapped(l.key) &&
             !recentlySwapFailed(l.sku);
    });
  }

  // Is the full-price (non-pack) line for this base SKU present in the cart yet?
  function plainPresent(cart, sku) {
    return ((cart && cart.items) || []).some(function (l) {
      return l.sku === sku && !isPackVariant((l.variant_title || '') + ' ' + (l.title || ''));
    });
  }

  // Render ONLY once every swapped base's full-price line is actually in the
  // cart. Shopify's /cart.js lags a beat after the add, and the discounted line
  // is already filtered out by the drawer (markRemoved) — so if we rendered
  // straightaway the base row would blink out until the plain line landed. We
  // keep the drawer suspended (the optimistically-painted row, already at full
  // price, stays put) and poll briefly; the instant the plain line is present
  // we release and render exactly once, so the row transitions seamlessly.
  function settleRender(tries) {
    fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        lastCart = cart;
        Object.keys(awaitingPlain).forEach(function (sku) { if (plainPresent(cart, sku)) delete awaitingPlain[sku]; });
        // Still waiting for a swapped-in full-price line to land? poll again.
        if (Object.keys(awaitingPlain).length && tries < 10) {
          setTimeout(function () { settleRender(tries + 1); }, 250);
          return;
        }
        awaitingPlain = {}; // drained, or gave up after ~2.5s
        // ── The 2nd-bundle oscillation fix ──
        // A NEW orphan may have appeared WHILE this swap settled: the customer
        // pulled ANOTHER bundle's drive. If we rendered now we'd paint that
        // base at its discounted (bundle) price for a frame before its own swap
        // runs — the "second SKU flips back to the bundle price" bug. So swap
        // every remaining orphan FIRST, still suspended and still holding the
        // reconcile lock (running stays true so no concurrent reconcile can
        // double-add), and only render once the cart is fully clean.
        var more = findOrphans(cart.items || []);
        if (more.length) {
          Promise.all(more.map(function (o) { return prefetchPlain(o.handle); }))
            .then(function () { swapNext(more, 0); });
          return;
        }
        // Settled — no orphans left. Release the lock + suspension, render once.
        running = false;
        release();
        if (window.PmCart && window.PmCart.applyCart) window.PmCart.applyCart(cart); else renderNow();
      })
      .catch(function () { running = false; release(); renderNow(); });
  }

  function finishReconcile() {
    // NOTE: for the drawer path, running is intentionally NOT cleared here — it
    // stays held through settleRender (and any follow-on swap of a newly-orphaned
    // base) so a concurrent reconcile can't race in and double-swap. settleRender
    // clears it at the very end, once the cart is clean and rendered.
    if (location.pathname === '/cart') {
      // Server-rendered page: the ONLY reason to reload is to reflect a swap we
      // actually made. Reloading on a clean cart (no orphans → this runs on
      // every load via the init reconcile) would loop /cart forever. So reload
      // only when a swap mutated the cart; otherwise just stand down.
      running = false;
      release();
      if (mutated) location.reload();
      return;
    }
    settleRender(0);
  }

  // Swap ONE orphan base (remove discounted line by key → add plain variant),
  // then recurse to the next. All swaps run inside a single suspended window
  // so the drawer never repaints from a half-finished multi-bundle state.
  function swapNext(list, i) {
    if (i >= list.length) {
      // All done — sweep ONCE more (still suspended) for any straggler a
      // concurrent removal created, then finish with a single render.
      fetch('/cart.js', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (cart) {
          lastCart = cart;
          var more = findOrphans(cart.items || []);
          if (more.length) { swapNext(more, 0); } else { finishReconcile(); }
        })
        .catch(finishReconcile);
      return;
    }
    var o = list[i];
    var plain = plainCache[o.handle];
    if (!plain || plain.id === o.variant_id || recentlyUserRemoved(o.key)) { swapNext(list, i + 1); return; }
    fetch('/cart/change.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: o.key, quantity: 0 })
    }).then(function (r1) {
      if (!r1.ok) throw new Error('remove ' + r1.status);
      if (recentlyUserRemoved(o.key)) throw new Error('user removed base');
      // Removal committed. Record it so a stale sweep can't re-swap this same
      // base (loop), and tell the drawer the discounted line is dead so no
      // render — the guard's OR the drawer's own — can repaint its old price.
      noteSwapped(o.key);
      awaitingPlain[o.sku] = true; // hold the final render until this base's full-price line is in the cart
      if (window.PmCart && window.PmCart.markRemoved) window.PmCart.markRemoved(o.key);
      return fetch('/cart/add.js', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: plain.id, quantity: o.quantity }] })
      });
    }).then(function (r2) {
      if (!r2 || !r2.ok) {
        // Plain add failed. Restore the original so the customer doesn't lose
        // the item, but mark this SKU failed + stop waiting for a plain that
        // won't come — so the straggler sweep can't re-pick the restored line
        // and re-swap it in a tight loop (the price-oscillation bug).
        noteSwapFail(o.sku);
        delete awaitingPlain[o.sku];
        if (!recentlyUserRemoved(o.key)) {
          fetch('/cart/add.js', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: o.variant_id, quantity: o.quantity, properties: o.properties || {} }] })
          }).catch(function () {});
        }
        throw new Error('re-add fail');
      }
      delete swapFailed[o.sku]; // swap landed — clear any earlier failure note
      mutated = true;           // a real cart change happened → /cart may reload to reflect it
      swapNext(list, i + 1);
    }).catch(function () { swapNext(list, i + 1); }); // one bad swap doesn't strand the rest
  }

  function reconcile() {
    if (running) { schedule(); return; } // a swap is in flight — retry after quiet
    running = true;
    mutated = false; // fresh cycle — no swap has happened yet
    fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        lastCart = cart;
        var items = cart.items || [];
        items.forEach(function (l) { if ((l.properties || {})._bundle === 'base') prefetchPlain(l.handle); });

        var orphans = findOrphans(items);
        if (!orphans.length) { finishReconcile(); return; } // covers rapid-empty: cart is as left

        // Freeze the drawer, resolve all plain variants, swap them ALL, render once.
        suspend();
        Promise.all(orphans.map(function (o) { return prefetchPlain(o.handle); }))
          .then(function () { swapNext(orphans, 0); });
      })
      .catch(finishReconcile);
  }

  // ── Click-time prediction: paint + suspend the instant drives are trashed ──
  document.addEventListener('pm:cart-line-removing', function (e) {
    var key = e && e.detail && e.detail.key;
    noteUserRemoved(key);
    if (!key || !lastCart) return;
    var removed = null;
    (lastCart.items || []).forEach(function (l) { if (!removed && l.key === key) removed = l; });
    if (!removed || (removed.properties || {})._bundle !== 'addon') return;
    var baseSku = (removed.properties || {})._bundle_base_sku, base = null;
    (lastCart.items || []).forEach(function (l) { if (!base && lineIsDiscountedBase(l) && l.sku === baseSku) base = l; });
    if (!base) return;
    // A split is coming: freeze the drawer's repaints and show full price now.
    suspend();
    var plain = plainCache[base.handle];
    if (plain) paintOptimistic(base, plain);
    else prefetchPlain(base.handle).then(function (p) { if (p) paintOptimistic(base, p); });
    schedule();
  });

  document.addEventListener('pm:cart-changed', function (e) {
    var src = (e && e.detail && e.detail.source) || '';
    if (src === 'bundle-guard') return; // our own final render — don't loop
    schedule();
  });

  // Seed the snapshot and do an initial reconcile (repairs a cart that was
  // left split in a previous session / another tab).
  fetch('/cart.js', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.json(); })
    .then(function (c) { lastCart = c; schedule(); })
    .catch(function () {});
})();
