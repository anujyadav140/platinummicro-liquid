/**
 * PmPageSize — client-side products-per-page + pagination (TC-091).
 *
 * Shopify can't change products-per-page from the URL: `paginate ... by N` is
 * fixed and Liquid can't read a page-size query param (verified: page_size /
 * limit / per_page are all ignored). So we do it client-side — the server
 * always renders N per page (data-pm-server-size); we fetch additional server
 * pages on demand and slice them into VIRTUAL pages of the size chosen in the
 * "Show" dropdown, then render our own pagination nav.
 *
 * Coordinates with pm-facets.js (filters/sort): every server swap fires
 * pm:plp-updated, on which we re-read the fresh grid + total and re-render
 * virtual page 1 (cache reset so stale/old-filter pages are never reused).
 */
(function () {
  'use strict';

  var STORE_KEY = 'pm-page-size';
  var wrap, serverSize = 24, total = 0, pageSize = 24, vPage = 1;
  var cache = {}; // server page (1-based) -> [<li> clones]

  function gridEl() { return wrap ? wrap.querySelector('.pm-plp__grid') : null; }

  function readSelectedSize() {
    try { var s = parseInt(localStorage.getItem(STORE_KEY), 10); if (s > 0) return s; } catch (e) {}
    var sel = document.getElementById('pm-plp-pagesize');
    var v = sel ? parseInt(sel.value, 10) : NaN;
    return (!isNaN(v) && v > 0) ? v : 24;
  }

  function urlPage() {
    try { return parseInt(new URL(window.location.href).searchParams.get('page'), 10) || 1; }
    catch (e) { return 1; }
  }

  // Current collection/search URL minus any &page — keeps active filters + sort.
  function baseUrl() {
    var u;
    try { u = new URL(window.location.href); } catch (e) { return window.location.pathname; }
    u.searchParams.delete('page');
    var qs = u.searchParams.toString();
    return u.pathname + (qs ? '?' + qs : '');
  }

  function init() {
    wrap = document.getElementById('pm-plp-grid-wrap');
    var g = gridEl();
    if (!wrap || !g) return;
    total = parseInt(g.getAttribute('data-pm-total'), 10);
    if (isNaN(total)) total = g.children.length;
    serverSize = parseInt(g.getAttribute('data-pm-server-size'), 10) || 24;
    pageSize = readSelectedSize();
    var sel = document.getElementById('pm-plp-pagesize');
    if (sel && sel.value !== String(pageSize)) sel.value = String(pageSize);
    // The DOM currently holds whichever server page the URL points at.
    cache = {};
    cache[urlPage()] = Array.prototype.slice.call(g.children).map(function (li) { return li.cloneNode(true); });
    vPage = 1;
    render();
  }

  function fetchServerPage(k) {
    if (cache[k]) return Promise.resolve(cache[k]);
    var b = baseUrl();
    var url = b + (b.indexOf('?') > -1 ? '&' : '?') + 'page=' + k;
    return fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var dom = new DOMParser().parseFromString(html, 'text/html');
        var g = dom.querySelector('.pm-plp__grid');
        cache[k] = g ? Array.prototype.slice.call(g.children).map(function (li) { return li.cloneNode(true); }) : [];
        return cache[k];
      })
      .catch(function () { cache[k] = []; return cache[k]; });
  }

  function render() {
    var g = gridEl();
    if (!g) return;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (vPage > totalPages) vPage = totalPages;
    if (vPage < 1) vPage = 1;
    var startIdx = (vPage - 1) * pageSize;
    var endIdx = Math.min(vPage * pageSize, total);
    var first = Math.floor(startIdx / serverSize) + 1;
    var last = Math.floor((endIdx - 1) / serverSize) + 1;
    var need = [];
    for (var p = first; p <= last; p++) need.push(p);
    wrap.classList.add('is-loading');
    Promise.all(need.map(fetchServerPage)).then(function () {
      var frag = document.createDocumentFragment();
      for (var i = startIdx; i < endIdx; i++) {
        var arr = cache[Math.floor(i / serverSize) + 1];
        var li = arr && arr[i % serverSize];
        if (li) frag.appendChild(li.cloneNode(true));
      }
      g.innerHTML = '';
      g.appendChild(frag);
      renderNav(totalPages);
      renderCount(startIdx, endIdx);
      wrap.classList.remove('is-loading');
      // re-evaluate add buttons (maxed/"Already in cart") on the new cards
      if (window.PmAddToCart && window.PmAddToCart.syncMaxed) window.PmAddToCart.syncMaxed();
    });
  }

  function renderCount(startIdx, endIdx) {
    var c = document.querySelector('.pm-plp__count');
    if (!c) return;
    c.innerHTML = 'Showing <strong>' + (total ? startIdx + 1 : 0) + '–' + endIdx +
                  '</strong> of <strong>' + total + '</strong> products';
  }

  // 1 … (cur-1) cur (cur+1) … last
  function pageList(totalPages, cur) {
    var want = [], add = function (n) { if (n >= 1 && n <= totalPages && want.indexOf(n) === -1) want.push(n); };
    add(1); add(cur - 1); add(cur); add(cur + 1); add(totalPages);
    want.sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < want.length; i++) {
      if (i && want[i] - want[i - 1] > 1) out.push(-1);
      out.push(want[i]);
    }
    return out;
  }

  var CHEV_L = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>';
  var CHEV_R = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';

  function renderNav(totalPages) {
    var old = wrap.querySelector('.pm-pagination');
    if (totalPages <= 1) { if (old) old.parentNode.removeChild(old); return; }
    var h = '<nav class="pm-pagination" aria-label="Pagination">';
    if (vPage > 1) h += '<a href="#" class="pm-pagination__nav" data-pm-vpage="' + (vPage - 1) + '">' + CHEV_L + 'Previous</a>';
    h += '<ul class="pm-pagination__pages">';
    pageList(totalPages, vPage).forEach(function (n) {
      if (n === -1) h += '<li><span class="is-ellipsis">…</span></li>';
      else if (n === vPage) h += '<li><span class="is-current" aria-current="page">' + n + '</span></li>';
      else h += '<li><a href="#" data-pm-vpage="' + n + '">' + n + '</a></li>';
    });
    h += '</ul>';
    if (vPage < totalPages) h += '<a href="#" class="pm-pagination__nav" data-pm-vpage="' + (vPage + 1) + '">Next' + CHEV_R + '</a>';
    h += '</nav>';
    var tmp = document.createElement('div');
    tmp.innerHTML = h;
    var nav = tmp.firstChild;
    if (old) old.parentNode.replaceChild(nav, old);
    else gridEl().parentNode.appendChild(nav);
  }

  // ── Delegated controls (survive facets/sort swaps) ──
  document.addEventListener('change', function (e) {
    if (!e.target || e.target.id !== 'pm-plp-pagesize') return;
    pageSize = parseInt(e.target.value, 10) || 24;
    try { localStorage.setItem(STORE_KEY, String(pageSize)); } catch (e2) {}
    vPage = 1;
    render();
  });

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-pm-vpage]');
    if (!a || !wrap || !wrap.contains(a)) return;
    e.preventDefault();
    vPage = parseInt(a.getAttribute('data-pm-vpage'), 10) || 1;
    render();
    var head = document.getElementById('pm-plp-header') || wrap;
    if (head && head.scrollIntoView) head.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // pm-facets.js swaps the grid on filter/sort → re-init from the fresh server page
  document.addEventListener('pm:plp-updated', init);
})();
