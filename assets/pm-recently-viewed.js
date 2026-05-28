/**
 * PmRecentlyViewed — localStorage-backed strip of recently-viewed PDPs.
 *
 * Track on: every PDP load (data-pm-rv-track stamped on the section root).
 * Render on:
 *   - PDP bottom strip      → [data-pm-rv-mount]   (horizontal cards)
 *   - Cart drawer footer    → [data-pm-rv-drawer]  (compact 3-item list)
 *
 * Store shape (per item):
 *   { sku, handle, title, vendor, imageUrl, priceLabel, href, viewedAt }
 *
 * Behavior:
 *   - MRU-ordered, deduped by SKU. New view of a tracked SKU bumps it
 *     to position 0.
 *   - Capped at 12 items so the store stays under a few KB.
 *   - On PDP, the currently-viewed product is filtered from the rendered
 *     strip — it's redundant to show yourself.
 *   - Strip hides itself entirely when there's nothing to show (or only
 *     the current PDP's own SKU).
 *   - Fires `pm:recently-viewed-changed` on every store mutation so other
 *     surfaces (cart drawer mini-strip) re-render.
 *
 * No backend, no auth — same privacy model as the Lists / Quote stores.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'pm:recently-viewed:v1';
  var CAP = 12;

  function readStore() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (it) {
        return it && typeof it.sku === 'string' && typeof it.handle === 'string' && typeof it.title === 'string';
      });
    } catch (e) { return []; }
  }

  function writeStore(items) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('pm:recently-viewed-changed', { detail: { items: items } }));
  }

  // Push a product onto the MRU. Existing SKU is removed first, then
  // the fresh item gets prepended at position 0. Caps the array at CAP.
  function track(item) {
    if (!item || !item.sku) return;
    var items = readStore().filter(function (i) { return i.sku !== item.sku; });
    items.unshift({
      sku:        item.sku,
      handle:     item.handle || '',
      title:      item.title || '',
      vendor:     item.vendor || '',
      imageUrl:   item.imageUrl || '',
      priceLabel: item.priceLabel || '',
      href:       item.href || ('/products/' + (item.handle || '')),
      viewedAt:   Date.now()
    });
    if (items.length > CAP) items = items.slice(0, CAP);
    writeStore(items);
  }

  function list() { return readStore(); }

  function clear() { writeStore([]); }

  function remove(sku) {
    writeStore(readStore().filter(function (i) { return i.sku !== sku; }));
  }

  window.PmRecentlyViewed = {
    list:   list,
    track:  track,
    remove: remove,
    clear:  clear
  };

  // ─────────────────────────── Helpers ──────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ─────────────────────── Auto-track on PDP ───────────────────────
  // PDP stamps the current product into a [data-pm-rv-track] element
  // with data-* attrs. We read those on load and track.
  function autoTrack() {
    var el = document.querySelector('[data-pm-rv-track]');
    if (!el) return;
    track({
      sku:        el.getAttribute('data-rv-sku')        || '',
      handle:     el.getAttribute('data-rv-handle')     || '',
      title:      el.getAttribute('data-rv-title')      || '',
      vendor:     el.getAttribute('data-rv-vendor')     || '',
      imageUrl:   el.getAttribute('data-rv-image')      || '',
      priceLabel: el.getAttribute('data-rv-price')      || '',
      href:       el.getAttribute('data-rv-href')       || ''
    });
  }

  // ─────────────────────── PDP bottom strip ────────────────────────
  function renderPdpStrip() {
    var mount = document.querySelector('[data-pm-rv-mount]');
    if (!mount) return;
    var currentSku = mount.getAttribute('data-current-sku') || '';
    var items = readStore().filter(function (i) { return i.sku !== currentSku; });
    if (items.length === 0) {
      mount.setAttribute('hidden', '');
      return;
    }
    mount.removeAttribute('hidden');
    var html = '<div class="pm-rv__inner pm-container">';
    html +=
      '<header class="pm-rv__head">' +
        '<h2 class="pm-rv__title">Recently viewed</h2>' +
        '<button type="button" class="pm-rv__clear" data-pm-rv-clear>Clear</button>' +
      '</header>';
    html += '<ul class="pm-rv__list">';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      html +=
        '<li class="pm-rv__card">' +
          '<a href="' + escapeHtml(it.href) + '" class="pm-rv__link" aria-label="' + escapeHtml(it.title) + '">' +
            '<div class="pm-rv__img">' +
              (it.imageUrl
                ? '<img src="' + escapeHtml(it.imageUrl) + '" alt="" width="160" height="160" loading="lazy">'
                : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>') +
            '</div>' +
            (it.vendor ? '<div class="pm-rv__brand">' + escapeHtml(it.vendor) + '</div>' : '') +
            '<div class="pm-rv__name">' + escapeHtml(it.title) + '</div>' +
            (it.priceLabel ? '<div class="pm-rv__price">' + escapeHtml(it.priceLabel) + '</div>' : '') +
          '</a>' +
        '</li>';
    }
    html += '</ul></div>';
    mount.innerHTML = html;
  }

  // ─────────────────────── Cart drawer mini-strip ──────────────────
  function renderDrawerStrip() {
    var mount = document.querySelector('[data-pm-rv-drawer]');
    if (!mount) return;
    var items = readStore().slice(0, 3);
    if (items.length === 0) {
      mount.setAttribute('hidden', '');
      return;
    }
    mount.removeAttribute('hidden');
    var html = '<div class="pm-rv-mini__head">RECENTLY VIEWED</div>';
    html += '<ul class="pm-rv-mini__list">';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      html +=
        '<li class="pm-rv-mini__row">' +
          '<a href="' + escapeHtml(it.href) + '" class="pm-rv-mini__link">' +
            '<div class="pm-rv-mini__img">' +
              (it.imageUrl
                ? '<img src="' + escapeHtml(it.imageUrl) + '" alt="" width="40" height="40" loading="lazy">'
                : '') +
            '</div>' +
            '<div class="pm-rv-mini__main">' +
              '<div class="pm-rv-mini__name">' + escapeHtml(it.title) + '</div>' +
              (it.priceLabel ? '<div class="pm-rv-mini__price">' + escapeHtml(it.priceLabel) + '</div>' : '') +
            '</div>' +
          '</a>' +
        '</li>';
    }
    html += '</ul>';
    mount.innerHTML = html;
  }

  function renderAll() {
    renderPdpStrip();
    renderDrawerStrip();
  }

  // Clear button click
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-pm-rv-clear]')) {
      clear();
    }
  });

  // Re-render on mutations + cross-tab sync
  document.addEventListener('pm:recently-viewed-changed', renderAll);
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) renderAll();
  });

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      autoTrack();
      renderAll();
    });
  } else {
    autoTrack();
    renderAll();
  }
})();
