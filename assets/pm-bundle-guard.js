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
 * plain variant at the same quantity. Runs on page load and after every
 * pm:cart-changed; self-quiets once the cart is consistent.
 */
(function () {
  'use strict';

  var busy = false;

  function isPackVariant(text) {
    return /pack of \d+/i.test(String(text || ''));
  }

  function lineIsDiscountedBase(line) {
    var p = line.properties || {};
    if (p._bundle !== 'base') return false;
    return isPackVariant((line.variant_title || '') + ' ' + (line.title || ''));
  }

  function check() {
    if (busy) return;
    busy = true;
    fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var items = (cart && cart.items) || [];

        // SKUs of base lines that still have their drives in the cart.
        var coveredBaseSkus = {};
        items.forEach(function (l) {
          var p = l.properties || {};
          if (p._bundle === 'addon' && p._bundle_base_sku) coveredBaseSkus[p._bundle_base_sku] = true;
        });

        var orphan = null, orphanLine = -1;
        items.forEach(function (l, i) {
          if (orphan) return;
          if (lineIsDiscountedBase(l) && !coveredBaseSkus[l.sku]) { orphan = l; orphanLine = i + 1; }
        });

        if (!orphan) { busy = false; return; }

        // Resolve the full-price plain variant of the same product.
        fetch('/products/' + orphan.handle + '.js')
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (prod) {
            var plain = null;
            ((prod && prod.variants) || []).forEach(function (v) {
              var t = [v.option1, v.option2, v.option3, v.title].filter(Boolean).join(' ');
              if (!plain && !isPackVariant(t)) plain = v;
            });
            if (!plain || plain.id === orphan.variant_id) { busy = false; return; }

            // Swap: drop the discounted line, re-add the plain variant.
            return fetch('/cart/change.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ line: orphanLine, quantity: 0 })
            }).then(function () {
              return fetch('/cart/add.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: [{ id: plain.id, quantity: orphan.quantity }] })
              });
            }).then(function () {
              busy = false;
              document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'bundle-guard' } }));
              // The /cart page is server-rendered — reload so prices shown match.
              if (location.pathname === '/cart') { location.reload(); return; }
              check(); // sweep any further orphans (multiple bundles)
            });
          })
          .catch(function () { busy = false; });
      })
      .catch(function () { busy = false; });
  }

  var t = null;
  function debouncedCheck() { clearTimeout(t); t = setTimeout(check, 600); }

  document.addEventListener('pm:cart-changed', debouncedCheck);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', debouncedCheck);
  else debouncedCheck();
})();
