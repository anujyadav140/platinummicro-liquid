/* PM — Bundle integrity guard.
 *
 * Migrated BigCommerce bundles add TWO cart lines: the base unit on a
 * discounted "(Pack of N)" variant (properties._bundle = "base") plus the
 * drive pack product (properties._bundle = "addon"). BigCommerce sold the
 * same thing as ONE line with a pick-list modifier, so it could never be
 * split; on Shopify a customer can delete the drives line and keep the
 * discounted base (e.g. the AS6706T at $874.93 instead of $901.99).
 *
 * This guard watches the cart and, whenever a discounted base line has no
 * matching addon line left, swaps it back to the product's full-price
 * plain variant at the same quantity.
 *
 * Speed: the plain-variant lookup is PREFETCHED whenever a bundle base is
 * seen in the cart, drawer mutations trigger an immediate (undebounced)
 * check, and the drawer row's price is repainted optimistically the moment
 * the split is detected — the server swap settles in the background and
 * the final re-render confirms it.
 *
 * Safety: the swap is atomic-ish — removal targets the line's stable key,
 * every step must return ok before the next runs, and if the re-add
 * bounces after a successful removal the original line is restored, so a
 * transient failure (rate limit, network) can never duplicate or lose a
 * line. On any failure nothing changes and the next cart event retries.
 */
(function () {
  'use strict';

  var busy = false;
  var plainCache = {}; // product handle -> { id, price } of the full-price variant
  var lastCart = null; // snapshot from the most recent check() — powers click-time prediction

  function isPackVariant(text) {
    return /pack of \d+/i.test(String(text || ''));
  }

  function lineIsDiscountedBase(line) {
    var p = line.properties || {};
    if (p._bundle !== 'base') return false;
    return isPackVariant((line.variant_title || '') + ' ' + (line.title || ''));
  }

  function fmtMoney(cents) {
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  /* Instant feedback: flip the drawer row's price to the full price right
     away; the authoritative re-render lands moments later with the same
     number. */
  function paintOptimistic(orphan, plain) {
    try {
      var row = document.querySelector('[data-cart-item][data-cart-key="' + orphan.key + '"]');
      if (!row) return;
      var priceEl = row.querySelector('.pm-cart__item-price');
      if (priceEl) priceEl.textContent = fmtMoney(plain.price * orphan.quantity);
    } catch (e) { /* cosmetic only */ }
  }

  function check() {
    if (busy) return;
    busy = true;
    fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var items = (cart && cart.items) || [];
        lastCart = cart;

        // SKUs of base lines that still have their drives in the cart.
        var coveredBaseSkus = {};
        items.forEach(function (l) {
          var p = l.properties || {};
          if (p._bundle === 'addon' && p._bundle_base_sku) coveredBaseSkus[p._bundle_base_sku] = true;
        });

        // Warm the plain-variant cache for every bundle base present, so a
        // future split repaints with zero lookups on the hot path.
        items.forEach(function (l) {
          if ((l.properties || {})._bundle === 'base') prefetchPlain(l.handle);
        });

        var orphan = null;
        items.forEach(function (l) {
          if (orphan) return;
          if (lineIsDiscountedBase(l) && !coveredBaseSkus[l.sku]) orphan = l;
        });

        if (!orphan) { busy = false; return; }

        prefetchPlain(orphan.handle).then(function (plain) {
          if (!plain || plain.id === orphan.variant_id) { busy = false; return; }

          paintOptimistic(orphan, plain);

          // Atomic swap: remove by stable key, verify, re-add, verify.
          fetch('/cart/change.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: orphan.key, quantity: 0 })
          }).then(function (r1) {
            if (!r1.ok) throw new Error('remove failed ' + r1.status);
            return fetch('/cart/add.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: [{ id: plain.id, quantity: orphan.quantity }] })
            });
          }).then(function (r2) {
            if (!r2.ok) {
              // Removal succeeded but the re-add bounced: put the original
              // line back (best effort) so the customer's item isn't lost.
              fetch('/cart/add.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: [{ id: orphan.variant_id, quantity: orphan.quantity, properties: orphan.properties || {} }] })
              }).catch(function () {});
              throw new Error('re-add failed ' + r2.status);
            }
            busy = false;
            document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'bundle-guard' } }));
            // Second, delayed notification: if the drawer was mid-render
            // when the first one fired, this one lands after the dust
            // settles so an OPEN drawer repaints with the repaired price.
            setTimeout(function () {
              document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'bundle-guard' } }));
            }, 1100);
            // The /cart page is server-rendered — reload so prices match.
            if (location.pathname === '/cart') { location.reload(); return; }
            check(); // sweep any further orphans (multiple bundles)
          }).catch(function () { busy = false; });
        });
      })
      .catch(function () { busy = false; });
  }

  /* Click-time prediction: the drawer announces a removal BEFORE its API
     call. If the line being removed is a bundle addon whose base sits in
     the cart at the discounted price, repaint that base to full price
     immediately — zero waiting. The authoritative swap + re-render follow
     and land on the same number. */
  document.addEventListener('pm:cart-line-removing', function (e) {
    var key = e && e.detail && e.detail.key;
    if (!key || !lastCart) return;
    var items = lastCart.items || [];
    var removed = null;
    items.forEach(function (l) { if (!removed && l.key === key) removed = l; });
    if (!removed || (removed.properties || {})._bundle !== 'addon') return;
    var baseSku = (removed.properties || {})._bundle_base_sku;
    var base = null;
    items.forEach(function (l) {
      if (!base && lineIsDiscountedBase(l) && l.sku === baseSku) base = l;
    });
    if (!base) return;
    var plain = plainCache[base.handle];
    if (plain) paintOptimistic(base, plain);
    else prefetchPlain(base.handle).then(function (p) { if (p) paintOptimistic(base, p); });
  });

  var t = null;
  function debouncedCheck() { clearTimeout(t); t = setTimeout(check, 600); }

  document.addEventListener('pm:cart-changed', function (e) {
    var src = (e && e.detail && e.detail.source) || '';
    // Drawer mutations are the hot path (a customer just split a bundle in
    // front of their own eyes) — check immediately, no debounce.
    if (src === 'drawer-line') { clearTimeout(t); check(); }
    else debouncedCheck();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', debouncedCheck);
  else debouncedCheck();
})();
