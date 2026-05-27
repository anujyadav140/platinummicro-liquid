/**
 * PmCompare — localStorage-backed product compare list.
 *
 *  • Stores product handles (not variant IDs) so we can fetch the full
 *    product card data via /products/{handle}.js on the compare page.
 *  • Capped at 4 — beyond that, adds silently no-op (with a small UI hint).
 *  • Drives both:
 *      - the [data-pm-compare] checkbox on every product card
 *      - the floating compare bar at the bottom of the viewport
 *  • Dispatches `pm:compare-changed` whenever the list changes; the bar
 *    and the /pages/compare page listen for it.
 */
(function () {
  'use strict';

  var KEY = 'pm-compare';
  var MAX = 4;

  function safeGet() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (e) { return []; }
  }
  function safeSet(arr) {
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('pm:compare-changed', { detail: { items: arr } }));
  }

  window.PmCompare = {
    MAX: MAX,
    get: safeGet,
    has: function (h) { return safeGet().indexOf(h) !== -1; },
    add: function (h) {
      var arr = safeGet();
      if (arr.indexOf(h) !== -1) return { items: arr, full: false };
      if (arr.length >= MAX) return { items: arr, full: true };
      arr.push(h);
      safeSet(arr);
      return { items: arr, full: false };
    },
    remove: function (h) {
      var arr = safeGet().filter(function (x) { return x !== h; });
      safeSet(arr);
      return { items: arr };
    },
    clear: function () { safeSet([]); }
  };

  // ── Checkbox delegation ──────────────────────────────────────────────
  document.addEventListener('change', function (e) {
    var box = e.target.closest('[data-pm-compare]');
    if (!box) return;
    var handle = box.getAttribute('data-product-handle');
    if (!handle) return;
    if (box.checked) {
      var res = window.PmCompare.add(handle);
      if (res.full) {
        box.checked = false;
        flashBar('You can compare up to ' + MAX + ' products at once.');
      }
    } else {
      window.PmCompare.remove(handle);
    }
  });

  // ── Sync checkbox state on load + after AJAX swaps ──────────────────
  function syncCheckboxes() {
    var items = window.PmCompare.get();
    document.querySelectorAll('[data-pm-compare]').forEach(function (box) {
      var h = box.getAttribute('data-product-handle');
      box.checked = !!h && items.indexOf(h) !== -1;
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncCheckboxes);
  } else {
    syncCheckboxes();
  }
  document.addEventListener('pm:plp-updated', syncCheckboxes);
  document.addEventListener('pm:compare-changed', syncCheckboxes);

  // ── Floating compare bar ─────────────────────────────────────────────
  var bar, countEl, thumbsEl;
  function initBar() {
    bar      = document.getElementById('pm-compare-bar');
    countEl  = document.getElementById('pm-cmp-count');
    thumbsEl = document.getElementById('pm-cmp-thumbs');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      if (e.target.closest('[data-pm-cmp-clear]')) {
        window.PmCompare.clear();
        return;
      }
      var coll = e.target.closest('[data-pm-cmp-collapse]');
      if (coll) {
        var collapsed = bar.classList.toggle('is-collapsed');
        coll.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }
    });
    document.addEventListener('pm:compare-changed', renderBar);
    renderBar();
  }

  function escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? (s.slice(0, n - 1) + '…') : s;
  }

  function renderBar() {
    if (!bar) return;
    var items = window.PmCompare.get();
    if (items.length === 0) {
      bar.setAttribute('hidden', '');
      return;
    }
    bar.removeAttribute('hidden');
    countEl.textContent = items.length + ' of ' + MAX + ' selected';
    var pillCount = document.getElementById('pm-cmp-pill-count');
    if (pillCount) pillCount.textContent = items.length;
    // Fetch product info (cached after first call)
    Promise.all(items.map(fetchProduct)).then(function (products) {
      thumbsEl.innerHTML = '';
      products.forEach(function (p) {
        if (!p) return;
        var v = (p.variants || [])[0] || {};
        var li = document.createElement('li');
        li.className = 'pm-cmp-bar__thumb';
        li.innerHTML =
          '<div class="pm-cmp-bar__thumb-img">' +
            '<img src="' + escAttr(p.featured_image || '') + '" alt="' + escAttr(p.title) + '">' +
          '</div>' +
          '<div class="pm-cmp-bar__thumb-info">' +
            '<div class="pm-cmp-bar__thumb-title" title="' + escAttr(p.title) + '">' + truncate(p.title, 28) + '</div>' +
            (v.sku ? '<div class="pm-cmp-bar__thumb-sku">SKU ' + escAttr(v.sku) + '</div>' : '') +
          '</div>' +
          '<button type="button" class="pm-cmp-bar__thumb-x" data-pm-cmp-remove="' + escAttr(p.handle) + '" aria-label="Remove">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>';
        thumbsEl.appendChild(li);
      });
    });
  }
  document.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-pm-cmp-remove]');
    if (!rm) return;
    e.preventDefault();
    window.PmCompare.remove(rm.getAttribute('data-pm-cmp-remove'));
  });

  function flashBar(msg) {
    var b = document.getElementById('pm-compare-bar');
    if (!b) { window.alert(msg); return; }
    var hint = document.createElement('div');
    hint.className = 'pm-cmp-bar__hint';
    hint.textContent = msg;
    b.appendChild(hint);
    b.removeAttribute('hidden');
    setTimeout(function () { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 2400);
  }

  // ── /products/{handle}.js cache ──────────────────────────────────────
  var productCache = {};
  function fetchProduct(handle) {
    if (productCache[handle]) return Promise.resolve(productCache[handle]);
    return fetch('/products/' + handle + '.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) { if (p) productCache[handle] = p; return p; })
      .catch(function () { return null; });
  }
  window.PmCompare.fetchProduct = fetchProduct;

  // ── /pages/compare page renderer ─────────────────────────────────────
  function initComparePage() {
    var grid = document.getElementById('pm-cmp-grid');
    if (!grid) return;

    function moneyFmt(cents) {
      if (cents == null) return '';
      return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function esc(s) {
      return String(s || '').replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    }

    function productCard(p) {
      var v = (p.variants || [])[0] || {};
      var url = p.url || ('/products/' + p.handle);
      return (
        '<button class="pm-cmp__remove" type="button" data-pm-cmp-remove="' + p.handle + '" aria-label="Remove">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        (p.vendor ? '<div class="pm-cmp__brand">' + esc(p.vendor.toUpperCase()) + '</div>' : '') +
        '<a class="pm-cmp__img" href="' + url + '">' +
          '<img src="' + esc(p.featured_image || '') + '" alt="' + esc(p.title) + '" loading="lazy">' +
        '</a>' +
        '<a class="pm-cmp__title" href="' + url + '">' + esc(p.title) + '</a>' +
        (v.sku ? '<div class="pm-cmp__sku">SKU <span>' + esc(v.sku) + '</span></div>' : '') +
        '<div class="pm-cmp__price">' + moneyFmt(p.price || v.price) + '</div>' +
        '<div class="pm-cmp__stock pm-cmp__stock--' + (p.available ? 'in' : 'out') + '">' +
          '<span class="pm-cmp__stock-dot"></span>' +
          '<span>' + (p.available ? 'In Stock' : 'Out of stock') + '</span>' +
          (p.available ? '<small>Ships next business day</small>' : '') +
        '</div>' +
        (p.available
          ? '<button class="pm-pcard__add pm-pcard__add--block" data-pm-add data-variant-id="' + v.id + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> <span>Add to Cart</span></button>'
          : '<button class="pm-pcard__add pm-pcard__add--block" disabled>Sold out</button>')
      );
    }

    function specRows(products) {
      var rows = [
        { label: 'Brand',        values: products.map(function (p) { return p.vendor || '—'; }) },
        { label: 'SKU',          values: products.map(function (p) { var v = (p.variants || [])[0] || {}; return v.sku || '—'; }) },
        { label: 'Price',        values: products.map(function (p) { var v = (p.variants || [])[0] || {}; return moneyFmt(p.price || v.price); }) },
        { label: 'Availability', values: products.map(function (p) { return p.available ? 'In stock' : 'Out of stock'; }) },
        { label: 'Type',         values: products.map(function (p) { return p.type || '—'; }) },
        { label: 'Tags',         values: products.map(function (p) { return (p.tags || []).slice(0, 5).join(', ') || '—'; }) }
      ];
      // Strip rows where everything is "—"
      return rows.filter(function (r) {
        return r.values.some(function (v) { return v && v !== '—'; });
      });
    }

    function render() {
      var items = window.PmCompare.get();
      var empty = document.getElementById('pm-cmp-empty');
      var title = document.getElementById('pm-cmp-title');
      if (items.length === 0) {
        grid.innerHTML = '';
        if (empty) empty.removeAttribute('hidden');
        if (title) title.textContent = 'Compare products';
        return;
      }
      if (empty) empty.setAttribute('hidden', '');
      Promise.all(items.map(fetchProduct)).then(function (products) {
        products = products.filter(Boolean);
        if (title) {
          title.textContent = 'Compare ' + products.length + ' product' + (products.length === 1 ? '' : 's');
        }
        // Set grid columns: [label col][N product cols]
        grid.style.gridTemplateColumns = 'minmax(140px, 200px) repeat(' + products.length + ', minmax(0, 1fr))';
        var html = '';
        // Row 0: card row (empty label cell + N product cards)
        html += '<div class="pm-cmp__row pm-cmp__row--cards">';
        html += '<div class="pm-cmp__cell pm-cmp__cell--label"></div>';
        products.forEach(function (p) {
          html += '<div class="pm-cmp__cell pm-cmp__cell--card">' + productCard(p) + '</div>';
        });
        html += '</div>';
        // Spec rows
        var rows = specRows(products);
        rows.forEach(function (r, i) {
          var distinct = new Set(r.values.map(function (v) { return String(v).trim().toLowerCase(); }));
          var diff = distinct.size > 1;
          var alt = (i % 2 === 1) ? ' pm-cmp__row--alt' : '';
          html += '<div class="pm-cmp__row' + alt + (diff ? ' pm-cmp__row--diff' : '') + '">';
          html += '<div class="pm-cmp__cell pm-cmp__cell--label">' + esc(r.label) + '</div>';
          r.values.forEach(function (v) {
            html += '<div class="pm-cmp__cell">' + esc(v) + '</div>';
          });
          html += '</div>';
        });
        grid.innerHTML = html;
      });
    }

    document.addEventListener('pm:compare-changed', render);
    // Highlight toggle
    var toggle = document.getElementById('pm-cmp-highlight');
    if (toggle) {
      var root = document.getElementById('pm-cmp');
      function syncToggle() { root.classList.toggle('pm-cmp--no-highlight', !toggle.checked); }
      toggle.addEventListener('change', syncToggle);
      syncToggle();
    }
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initBar(); initComparePage(); });
  } else {
    initBar();
    initComparePage();
  }
  // When the 404 template promotes the compare static body into the DOM,
  // re-init so the new #pm-cmp-grid gets populated.
  document.addEventListener('pm:static-mounted', function (e) {
    if (!e.detail || e.detail.handle === 'compare') initComparePage();
  });
})();
