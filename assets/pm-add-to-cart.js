/**
 * PmAddToCart — universal "+ Add" button handler.
 * Any [data-pm-add][data-variant-id] click → POST /cart/add.js → fire
 * pm:cart-changed so the drawer opens with the new item.
 */
(function () {
  'use strict';

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pm-add]');
    if (!btn) return;
    var variantId = btn.getAttribute('data-variant-id');
    if (!variantId) return;
    e.preventDefault();
    if (btn.dataset.busy === '1') return;

    var label = btn.querySelector('span');
    var orig = label ? label.textContent : '';
    btn.dataset.busy = '1';
    btn.disabled = true;
    if (label) label.textContent = 'Adding…';

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: [{ id: parseInt(variantId, 10), quantity: 1 }] })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('add failed');
        return r.json();
      })
      .then(function () {
        if (label) label.textContent = 'Added';
        document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'pcard' } }));
        setTimeout(function () {
          if (label) label.textContent = orig || 'Add';
          btn.disabled = false;
          btn.dataset.busy = '0';
        }, 900);
      })
      .catch(function () {
        if (label) label.textContent = orig || 'Add';
        btn.disabled = false;
        btn.dataset.busy = '0';
      });
  });
})();
