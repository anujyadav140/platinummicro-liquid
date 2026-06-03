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
      // closest() so clicks on the X icon's inner <svg>/<path> still close
      if (e.target.closest('[data-qo-close]')) close();
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

  function showAlert(problems) {
    alertSkusEl.innerHTML = '';
    problems.forEach(function (p) {
      var reason = (p && p.reason) || '';
      var isOOS  = reason === 'out of stock';

      var row = document.createElement('div');
      row.className = 'pm-qo__problem';

      var sku = document.createElement('span');
      sku.className = 'pm-qo__problem-sku';
      sku.textContent = (p && p.sku) ? p.sku : String(p);
      row.appendChild(sku);

      if (reason) {
        var status = document.createElement('span');
        status.className = 'pm-qo__problem-status ' + (isOOS ? 'pm-qo__problem-status--oos' : 'pm-qo__problem-status--missing');
        status.textContent = isOOS ? 'Out of stock' : (reason === 'not found' ? 'Not found' : reason);
        row.appendChild(status);
      }

      // Out-of-stock items we found → one-tap "Add to quote".
      if (isOOS && p.match && p.match.product) {
        var qbtn = document.createElement('button');
        qbtn.type = 'button';
        qbtn.className = 'pm-qo__quote-btn';
        qbtn.textContent = 'Add to quote';
        (function (m) { qbtn.addEventListener('click', function () { addToQuote(m); }); })(p.match);
        row.appendChild(qbtn);
      }

      alertSkusEl.appendChild(row);
    });
    alertEl.removeAttribute('hidden');
  }

  /**
   * Send an out-of-stock SKU to the Quotify quote flow. Mirrors the PDP's
   * Quotify trigger exactly: a no-op <form> wrapping a [data-quotify] button
   * carrying the full product JSON (same shape as {{ product | json }}), which
   * Quotify's event-delegated app script picks up. If Quotify isn't loaded for
   * some reason, fall back to the product's page (which leads with the quote CTA
   * for out-of-stock items).
   */
  function addToQuote(match) {
    if (!match || !match.product) return;
    var p = match.product, variantId = match.id;
    if (typeof window.Quotify === 'undefined') {
      window.location.href = p.url || ('/products/' + p.handle);
      return;
    }
    var form = document.createElement('form');
    form.className = 'pm-quotify-form';
    form.setAttribute('onsubmit', 'return false;');
    form.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
    var hidden = document.createElement('input');
    hidden.type = 'hidden'; hidden.name = 'id'; hidden.value = variantId;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quotify-request-quote-btn';
    btn.setAttribute('data-quotify', '');
    btn.setAttribute('data-product-id', String(p.id));
    btn.setAttribute('data-variant', String(variantId));
    btn.setAttribute('data-product', JSON.stringify(p));
    form.appendChild(hidden);
    form.appendChild(btn);
    document.body.appendChild(form);
    btn.click();
    // Quotify opens its own flow on the click; drop our scaffold afterward.
    setTimeout(function () { try { form.remove(); } catch (e) {} }, 4000);
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
    // Predictive search does NOT match SKUs unless told to via the documented
    // `resources[options][fields]` param. The original code used `fields=sku`
    // (wrong field name → 0 results); simply removing it also returned 0 for SKU
    // queries (predictive defaults to title/vendor/type only). The correct field
    // is `variants.sku` (+ barcode/title as extra candidate sources). Verified
    // live: with this, q=<exact SKU> resolves the product; the variant-SKU exact
    // match below still gates the final result, so broader candidates can't cause
    // a wrong add.
    var url = '/search/suggest.json?q=' + encodeURIComponent(sku) +
              '&resources[type]=product&resources[limit]=6' +
              '&resources[options][unavailable_products]=last' +
              '&resources[options][fields]=variants.sku,variants.barcode,title';
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var products = (((data || {}).resources || {}).results || {}).products || [];
        if (!products.length) return null;
        // Two-step: fetch each candidate's full product JSON for variant SKUs.
        // suggest.json items expose `handle` (and `url`); fall back to url so a
        // missing handle doesn't break the second hop.
        var checks = products.map(function (p) {
          var handle = p.handle || (p.url ? p.url.split('?')[0].replace(/^.*\/products\//, '') : '');
          if (!handle) return Promise.resolve(null);
          return fetch('/products/' + handle + '.js', { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (full) {
              var variants = (full && full.variants) || [];
              for (var i = 0; i < variants.length; i++) {
                if ((variants[i].sku || '').trim().toLowerCase() === lower) {
                  // Coerce to a Number — /cart/add.js needs the numeric variant id
                  // (same as pm-add-to-cart.js: parseInt(variantId, 10)).
                  return { id: parseInt(variants[i].id, 10), available: variants[i].available, product: full };
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
      var items    = [];   // in-stock, addable
      var problems = [];   // { sku, reason } — 'not found' or 'out of stock'
      results.forEach(function (r) {
        var id  = r.match ? parseInt(r.match.id, 10) : NaN;
        var qty = parseInt(r.entry.qty, 10);
        if (!qty || qty < 1) qty = 1;
        if (r.match && id && r.match.available) {
          items.push({ id: id, quantity: qty });
        } else if (r.match && id && !r.match.available) {
          // Found, but the variant is sold out. Shopify's /cart/add.js is atomic,
          // so leaving it in the batch would fail EVERY line — exclude + report it.
          // Keep the match so we can offer "Add to quote" for it.
          problems.push({ sku: r.entry.sku, reason: 'out of stock', match: r.match });
        } else {
          problems.push({ sku: r.entry.sku, reason: 'not found' });
        }
      });

      if (items.length === 0) {
        showAlert(problems);
        setLoading(false);
        return;
      }

      // Multi-add the IN-STOCK items only (sold-out ones excluded above).
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: items })
      })
        .then(function (r) {
          // Parse defensively: a non-JSON body (rare error pages) must not throw
          // into the outer catch and silently swallow the result.
          return r.text().then(function (text) {
            var json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
            return { ok: r.ok, json: json };
          });
        })
        .then(function (resp) {
          if (!resp.ok) {
            // A late inventory change can still 422 — surface Shopify's reason.
            var msg = (resp.json && resp.json.message) ? resp.json.message : 'could not be added';
            showAlert(problems.concat([{ sku: items.length + ' item(s)', reason: msg }]));
            setLoading(false);
            return;
          }
          // Refresh cart and notify drawer
          document.dispatchEvent(new CustomEvent('pm:cart-changed', {
            detail: { source: 'quick-order', addedCount: items.length }
          }));

          if (problems.length > 0) {
            // Keep the not-found / sold-out rows visible, drop the added ones
            removeAddedRows(results);
            showAlert(problems);
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
    // Drop only the rows that were actually ADDED (matched AND in stock).
    var rows = Array.from(rowsEl.querySelectorAll('[data-qo-row]'));
    results.forEach(function (r) {
      if (!r.match || !r.match.available) return;
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
