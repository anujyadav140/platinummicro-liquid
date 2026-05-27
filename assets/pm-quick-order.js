/**
 * PmQuickOrder — Bulk SKU → cart entry modal.
 * Mirrors the Hydrogen PmQuickOrder.tsx behaviour.
 */
(function () {
  'use strict';

  var modal, rowsEl, addRowBtn, submitBtn, countEl, alertEl, alertSkusEl, template;
  var inited = false;

  function $(sel, root) { return (root || document).querySelector(sel); }

  function init() {
    if (inited) return;
    modal       = document.getElementById('pm-quick-order-modal');
    rowsEl      = document.getElementById('pm-qo-rows');
    addRowBtn   = document.getElementById('pm-qo-add-row');
    submitBtn   = document.getElementById('pm-qo-submit');
    countEl     = document.getElementById('pm-qo-count');
    alertEl     = document.getElementById('pm-qo-alert');
    alertSkusEl = document.getElementById('pm-qo-alert-skus');
    template    = document.getElementById('pm-qo-row-template');
    if (!modal || !template) return;

    // Add seed row
    addRow();

    // Wiring
    addRowBtn.addEventListener('click', function () { addRow(); focusLastSku(); });
    submitBtn.addEventListener('click', submit);
    modal.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-qo-close')) close();
    });
    rowsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-qo-remove]');
      if (!btn) return;
      var row = btn.closest('[data-qo-row]');
      if (rowsEl.children.length > 1) {
        row.remove();
      } else {
        // Last row → just clear inputs
        row.querySelector('.pm-qo__sku').value = '';
        row.querySelector('.pm-qo__qty').value = '1';
      }
      updateState();
    });
    rowsEl.addEventListener('input', function () {
      hideAlert();
      updateState();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hasAttribute('aria-hidden')) close();
    });

    // Anyone with data-qo-open or href="#quick-order" triggers it
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-qo-open], a[href="#quick-order"], a[href="/pages/quick-order"]');
      if (!t) return;
      e.preventDefault();
      open();
    });

    inited = true;
  }

  function open() {
    if (!modal) return;
    // Always start clean: no leftover error banner from a previous attempt.
    hideAlert();
    modal.removeAttribute('aria-hidden');
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(focusFirstSku, 50);
    updateState();
  }

  function close() {
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    hideAlert();
    // Full reset so the next open is a fresh modal.
    resetForm();
  }

  function addRow() {
    var node = template.content.firstElementChild.cloneNode(true);
    rowsEl.appendChild(node);
    updateState();
  }

  function focusFirstSku() {
    var first = rowsEl.querySelector('.pm-qo__sku');
    if (first) first.focus();
  }

  function focusLastSku() {
    var inputs = rowsEl.querySelectorAll('.pm-qo__sku');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function collect() {
    var rows = Array.from(rowsEl.querySelectorAll('[data-qo-row]'));
    var entries = [];
    rows.forEach(function (row) {
      var sku = (row.querySelector('.pm-qo__sku').value || '').trim();
      var qty = parseInt(row.querySelector('.pm-qo__qty').value, 10);
      if (!sku) return;
      if (!qty || qty < 1) qty = 1;
      entries.push({ sku: sku, qty: qty });
    });
    return entries;
  }

  function updateState() {
    var entries = collect();
    var totalSkus = entries.length;
    var totalUnits = entries.reduce(function (acc, e) { return acc + e.qty; }, 0);
    var noun = totalSkus === 1 ? 'SKU' : 'SKUs';
    var unitNoun = totalUnits === 1 ? 'unit' : 'units';
    countEl.textContent = totalSkus + ' ' + noun + ' · ' + totalUnits + ' ' + unitNoun + ' ready to add';
    submitBtn.disabled = totalSkus === 0;
  }

  function showAlert(missingSkus) {
    alertSkusEl.innerHTML = '';
    missingSkus.forEach(function (s) {
      var div = document.createElement('div');
      div.textContent = s;
      alertSkusEl.appendChild(div);
    });
    alertEl.removeAttribute('hidden');
  }

  function hideAlert() {
    alertEl.setAttribute('hidden', '');
    alertSkusEl.innerHTML = '';
  }

  /**
   * Look up a variant by SKU.
   * 1. Predictive search for products whose SKU field matches.
   * 2. For each candidate product, fetch /products/{handle}.js to find
   *    the variant whose SKU exactly matches (case-insensitive).
   * Returns { id, product } or null.
   */
  function lookupSku(sku) {
    var lower = sku.toLowerCase();
    var url = '/search/suggest.json?q=' + encodeURIComponent(sku) + '&resources[type]=product&resources[options][fields]=sku&resources[limit]=5';
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var products = (((data || {}).resources || {}).results || {}).products || [];
        if (!products.length) return null;
        // Two-step: fetch each candidate's full product JSON for variant SKUs
        var checks = products.map(function (p) {
          return fetch('/products/' + p.handle + '.js', { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (full) {
              var variants = full.variants || [];
              for (var i = 0; i < variants.length; i++) {
                if ((variants[i].sku || '').toLowerCase() === lower) {
                  return { id: variants[i].id, product: full };
                }
              }
              return null;
            })
            .catch(function () { return null; });
        });
        return Promise.all(checks).then(function (results) {
          for (var i = 0; i < results.length; i++) if (results[i]) return results[i];
          return null;
        });
      })
      .catch(function () { return null; });
  }

  function submit() {
    var entries = collect();
    if (entries.length === 0) return;

    setLoading(true);
    hideAlert();

    // Look up each SKU in parallel
    Promise.all(entries.map(function (e) {
      return lookupSku(e.sku).then(function (match) {
        return { entry: e, match: match };
      });
    })).then(function (results) {
      var items   = [];
      var missing = [];
      results.forEach(function (r) {
        if (r.match) {
          items.push({ id: r.match.id, quantity: r.entry.qty });
        } else {
          missing.push(r.entry.sku);
        }
      });

      if (items.length === 0) {
        showAlert(missing);
        setLoading(false);
        return;
      }

      // Multi-add — POST /cart/add.js with `items` array
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: items })
      })
        .then(function (r) { return r.json().then(function (json) { return { ok: r.ok, json: json }; }); })
        .then(function (resp) {
          if (!resp.ok) {
            showAlert(missing.concat(items.map(function () { return '(add failed)'; })));
            setLoading(false);
            return;
          }
          // Refresh cart and notify drawer
          document.dispatchEvent(new CustomEvent('pm:cart-changed', {
            detail: { source: 'quick-order', addedCount: items.length }
          }));

          if (missing.length > 0) {
            // Keep the missing rows visible, drop the added ones
            removeAddedRows(results);
            showAlert(missing);
            setLoading(false);
          } else {
            // Clean everything and close
            resetForm();
            setLoading(false);
            close();
          }
        });
    }).catch(function () {
      setLoading(false);
    });
  }

  function removeAddedRows(results) {
    // Drop the rows whose SKU matched
    var rows = Array.from(rowsEl.querySelectorAll('[data-qo-row]'));
    results.forEach(function (r) {
      if (!r.match) return;
      var matchRow = rows.find(function (row) {
        return (row.querySelector('.pm-qo__sku').value || '').trim().toLowerCase() === r.entry.sku.toLowerCase();
      });
      if (matchRow) matchRow.remove();
    });
    if (rowsEl.children.length === 0) addRow();
    updateState();
  }

  function resetForm() {
    rowsEl.innerHTML = '';
    addRow();
    updateState();
  }

  function setLoading(yes) {
    submitBtn.disabled = yes || collect().length === 0;
    var label   = submitBtn.querySelector('.pm-qo__submit-label');
    var spinner = submitBtn.querySelector('.pm-qo__submit-spinner');
    if (yes) {
      label.textContent = 'Adding…';
      if (spinner) spinner.removeAttribute('hidden');
    } else {
      label.textContent = 'Add to cart';
      if (spinner) spinner.setAttribute('hidden', '');
    }
  }

  // Expose
  window.PmQuickOrder = { open: open, close: close };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
