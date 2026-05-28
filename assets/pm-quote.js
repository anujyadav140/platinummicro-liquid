/**
 * PmQuote — local "quote" cart for out-of-stock items.
 *
 * Why this exists:
 *   Shopify's /cart/add.js refuses to add a variant whose
 *   inventory_policy is "deny" and whose stock is 0. We still want the
 *   user experience to be "click → it lands in the cart drawer with a
 *   visible distinction", so quote items live in localStorage instead
 *   of the Shopify cart. pm-cart-drawer.js merges them into the same
 *   list with a QUOTE pill.
 *
 * Public surface (window.PmQuote):
 *   list()                  → array of quote items
 *   add(item)               → push or dedupe-bump-by-sku
 *   remove(sku)             → drop a line
 *   setQuantity(sku, n)     → set qty (clamped to >= 1; 0 removes)
 *   clear()                 → drop everything
 *
 * Events:
 *   Dispatches `pm:cart-changed` on document after every mutation so the
 *   cart drawer + header badge stay in sync (same event the Shopify cart
 *   updates use).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'pm:quote:v1';

  function read() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // Light shape check — drop malformed entries silently.
      return arr.filter(function (it) {
        return it && typeof it.sku === 'string' && typeof it.name === 'string';
      });
    } catch (e) { return []; }
  }

  function write(items) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'quote' } }));
  }

  function list() { return read(); }

  function add(item) {
    if (!item || !item.sku) return;
    var items = read();
    var qty = Math.max(1, Math.floor(item.quantity) || 1);
    var now = Date.now();
    var existing = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].sku === item.sku) { existing = items[i]; break; }
    }
    if (existing) {
      existing.quantity = (existing.quantity || 1) + qty;
      existing.updatedAt = now;
    } else {
      items.push({
        sku:          item.sku,
        name:         item.name || '',
        brand:        item.brand || '',
        imageUrl:     item.imageUrl || '',
        unitPrice:    item.unitPrice || '',
        priceCents:   item.priceCents != null ? Number(item.priceCents) : null,
        quantity:     qty,
        href:         item.href || '',
        variantId:    item.variantId || '',
        productId:    item.productId || '',
        addedAt:      now,
        updatedAt:    now,
      });
    }
    write(items);
  }

  function remove(sku) {
    var items = read().filter(function (i) { return i.sku !== sku; });
    write(items);
  }

  function setQuantity(sku, n) {
    var next = Math.max(0, Math.floor(n) || 0);
    if (next === 0) return remove(sku);
    var items = read();
    for (var i = 0; i < items.length; i++) {
      if (items[i].sku === sku) {
        items[i].quantity = next;
        items[i].updatedAt = Date.now();
        break;
      }
    }
    write(items);
  }

  function clear() { write([]); }

  // ── Click handler for any [data-pm-quote-add] button ──
  // Item data comes from data-quote-* attributes on the trigger (product
  // card / PDP). Reads the live qty from #pm-pdp-qty if present (PDP),
  // otherwise defaults to 1.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pm-quote-add]');
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.busy === '1') return;

    var label = btn.querySelector('span');
    var orig = label ? label.textContent : '';
    btn.dataset.busy = '1';
    if (label) label.textContent = 'Adding…';

    var qtyEl = document.getElementById('pm-pdp-qty');
    var qty = qtyEl ? Math.max(1, parseInt(qtyEl.value, 10) || 1) : 1;

    add({
      sku:        btn.getAttribute('data-quote-sku') || '',
      name:       btn.getAttribute('data-quote-name') || '',
      brand:      btn.getAttribute('data-quote-brand') || '',
      imageUrl:   btn.getAttribute('data-quote-image') || '',
      unitPrice:  btn.getAttribute('data-quote-price') || '',
      priceCents: btn.getAttribute('data-quote-price-cents'),
      href:       btn.getAttribute('data-quote-href') || '',
      variantId:  btn.getAttribute('data-quote-variant-id') || '',
      productId:  btn.getAttribute('data-quote-product-id') || '',
      quantity:   qty,
    });

    if (label) label.textContent = 'Added';
    setTimeout(function () {
      if (label) label.textContent = orig || 'Add to Quote';
      btn.dataset.busy = '0';
    }, 900);
  });

  window.PmQuote = {
    list: list,
    add: add,
    remove: remove,
    setQuantity: setQuantity,
    clear: clear,
  };

  // Cross-tab sync — fire pm:cart-changed when another tab writes.
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'quote-storage' } }));
    }
  });
})();
