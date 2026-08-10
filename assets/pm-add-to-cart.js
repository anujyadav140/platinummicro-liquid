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

  var MAXED = 'Already in cart';
  var labelOf = function (btn) { return btn.querySelector('span'); };

  // Inventory caps (variant id → available qty), stashed from data-max-qty
  // buttons and persisted for the session so the cart drawer — whose /cart.js
  // data has no inventory — can disable its + UP FRONT on capped lines.
  var CAP_KEY = 'pm:invcap:v1';
  var capStore = {};
  try { capStore = JSON.parse(sessionStorage.getItem(CAP_KEY) || '{}') || {}; } catch (e) {}
  function setCap(vid, cap) {
    if (!vid || isNaN(cap) || cap < 1) return;
    vid = String(vid);
    if (capStore[vid] !== cap) {
      capStore[vid] = cap;
      try { sessionStorage.setItem(CAP_KEY, JSON.stringify(capStore)); } catch (e) {}
    }
  }
  function getCap(vid) {
    var c = capStore[String(vid)];
    return typeof c === 'number' ? c : null;
  }

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
    // PDP: when the cart holds every available unit, light up "Request a Quote"
    // (terracotta) as the signifier that the buyer can order MORE than stock via
    // a quote. (PLP cards have no inline quote button for in-stock items.)
    if (btn.hasAttribute('data-pm-pdp-add') && typeof window.pmUpdatePdpQuoteSignal === 'function') {
      window.pmUpdatePdpQuoteSignal();
    }
  }

  // Proactive: disable any capped add button whose variant is already maxed
  // out in the cart. One /cart.js fetch covers every button on the page.
  function syncMaxed() {
    var btns = document.querySelectorAll('[data-pm-add][data-max-qty]');
    if (!btns.length) return;
    // Stash every known cap so the drawer can disable + proactively.
    btns.forEach(function (b) {
      setCap(parseInt(b.getAttribute('data-variant-id'), 10), parseInt(b.getAttribute('data-max-qty'), 10));
    });
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

    // PDP "Add to Cart" honors the quantity stepper (#pm-pdp-qty); the card
    // "+ Add" buttons always add 1. The stepper is already capped at available
    // stock, so addQty never exceeds it.
    var addQty = 1;
    if (btn.hasAttribute('data-pm-pdp-add')) {
      var qInput = document.getElementById('pm-pdp-qty');
      addQty = Math.max(1, parseInt(qInput && qInput.value, 10) || 1);
    }

    // Opt-in only: a button carries data-pm-add-properties (JSON) when the
    // page wants the line item to remember something about how it was
    // configured — e.g. the HP "configure your system" wizard's picked
    // Processor/Memory/Storage. No attribute → no properties, unchanged
    // for every other Add button (PLP cards, plain PDPs).
    var lineItem = { id: parseInt(variantId, 10), quantity: addQty };
    var propsRaw = btn.getAttribute('data-pm-add-properties');
    if (propsRaw) {
      try {
        var props = JSON.parse(propsRaw);
        if (props && typeof props === 'object') lineItem.properties = props;
      } catch (e) {}
    }

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: [lineItem] })
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        btn.dataset.busy = '0';
        if (!res.ok) {
          // Over the inventory cap → lock the button. NOTE: /cart/add.js still
          // PARTIAL-adds up to the cap on a 422, so refresh badges + drawer
          // (silently — a non-opening source) to reflect whatever did get added.
          if (lbl) lbl.textContent = orig || 'Add';
          setMaxed(btn, true);
          syncMaxed();
          document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'cap' } }));
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

  window.PmAddToCart = { syncMaxed: syncMaxed, getCap: getCap };
})();
