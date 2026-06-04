/**
 * PmAddToCart — universal "+ Add" / "Add to Cart" handler (PLP cards + PDP).
 * Any [data-pm-add][data-variant-id] click → POST /cart/add.js → fire
 * pm:cart-changed so the drawer opens with the new item.
 *
 * TC-084: when the cart already holds every available unit of a variant,
 * Shopify's /cart/add.js rejects further adds (HTTP 422). The old handler
 * just silently reset the label, so the button looked unresponsive. Now we:
 *   (a) PROACTIVELY disable + relabel the button to "Max in cart" the moment
 *       the cart reaches the variant's inventory cap (data-max-qty, rendered
 *       only when inventory is tracked and oversell is denied), and
 *   (b) lock it the same way if an add is ever rejected (safety net).
 * Buttons with no data-max-qty (untracked / oversell-allowed) are never
 * capped. When the cart drops back below the cap, the button re-enables.
 */
(function () {
  'use strict';

  var MAXED = 'Max in cart';
  var labelOf = function (btn) { return btn.querySelector('span'); };

  function setMaxed(btn, maxed) {
    var lbl = labelOf(btn);
    if (maxed) {
      if (lbl && !btn.dataset.origLabel) btn.dataset.origLabel = lbl.textContent;
      btn.classList.add('is-maxed');
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('title', 'All available stock is already in your cart');
      if (lbl) lbl.textContent = MAXED;
    } else {
      btn.classList.remove('is-maxed');
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('title');
      if (lbl && btn.dataset.origLabel) lbl.textContent = btn.dataset.origLabel;
      delete btn.dataset.origLabel;
      if (btn.dataset.busy !== '1') btn.disabled = false;
    }
  }

  // Proactive: disable any capped add button whose variant is already maxed
  // out in the cart. One /cart.js fetch covers every button on the page.
  function syncMaxed() {
    var btns = document.querySelectorAll('[data-pm-add][data-max-qty]');
    if (!btns.length) return;
    fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var have = {};
        (cart.items || []).forEach(function (it) {
          have[it.variant_id] = (have[it.variant_id] || 0) + it.quantity;
        });
        btns.forEach(function (btn) {
          if (btn.dataset.busy === '1') return;
          var vid = parseInt(btn.getAttribute('data-variant-id'), 10);
          var max = parseInt(btn.getAttribute('data-max-qty'), 10);
          if (isNaN(max) || max < 1) { setMaxed(btn, false); return; }
          setMaxed(btn, (have[vid] || 0) >= max);
        });
      })
      .catch(function () {});
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pm-add]');
    if (!btn) return;
    var variantId = btn.getAttribute('data-variant-id');
    if (!variantId) return;
    e.preventDefault();
    if (btn.disabled || btn.dataset.busy === '1') return;

    var lbl = labelOf(btn);
    var orig = lbl ? lbl.textContent : '';
    btn.dataset.busy = '1';
    btn.disabled = true;
    if (lbl) lbl.textContent = 'Adding…';

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: [{ id: parseInt(variantId, 10), quantity: 1 }] })
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        btn.dataset.busy = '0';
        if (!res.ok) {
          // Over the inventory cap (or otherwise rejected) → lock the button and
          // tell the user why, instead of silently bouncing back to "Add".
          if (lbl) lbl.textContent = orig || 'Add';
          setMaxed(btn, true);
          syncMaxed();
          return;
        }
        if (lbl) lbl.textContent = 'Added';
        document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'pcard' } }));
        setTimeout(function () {
          if (lbl) lbl.textContent = orig || 'Add';
          btn.disabled = false;
          syncMaxed(); // this add may have just reached the cap
        }, 900);
      })
      .catch(function () {
        btn.dataset.busy = '0';
        if (lbl) lbl.textContent = orig || 'Add';
        btn.disabled = false;
      });
  });

  function init() { syncMaxed(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('pm:cart-changed', syncMaxed); // cart drawer +/- , removes, adds
  document.addEventListener('pm:plp-updated', syncMaxed);  // facet/sort grid swaps re-render cards

  window.PmAddToCart = { syncMaxed: syncMaxed };
})();
