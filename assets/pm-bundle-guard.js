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
  var FAILSAFE_MS = 3500; // hard ceiling on how long renders stay suspended

  var plainCache = {};    // handle -> { id, price } of the full-price variant
  var lastCart = null;    // most recent cart snapshot (for click-time prediction)
  var userRemoved = {};   // line key -> ts of a customer-initiated removal
  var quietTimer = null;
  var failsafeTimer = null;
  var running = false;

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
      return lineIsDiscountedBase(l) && !covered[l.sku] && !recentlyUserRemoved(l.key);
    });
  }

  function finishReconcile() {
    running = false;
    release();
    if (location.pathname === '/cart') { location.reload(); return; } // server-rendered page
    renderNow();
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
      return fetch('/cart/add.js', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: plain.id, quantity: o.quantity }] })
      });
    }).then(function (r2) {
      if (!r2 || !r2.ok) {
        if (!recentlyUserRemoved(o.key)) {
          fetch('/cart/add.js', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: o.variant_id, quantity: o.quantity, properties: o.properties || {} }] })
          }).catch(function () {});
        }
        throw new Error('re-add fail');
      }
      swapNext(list, i + 1);
    }).catch(function () { swapNext(list, i + 1); }); // one bad swap doesn't strand the rest
  }

  function reconcile() {
    if (running) { schedule(); return; } // a swap is in flight — retry after quiet
    running = true;
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
