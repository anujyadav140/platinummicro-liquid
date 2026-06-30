/**
 * PmPageSize — client-side products-per-page + pagination (TC-091),
 * plus IN-STOCK-FIRST streaming for the "show all" default (TC-088).
 *
 * TC-091: Shopify can't change products-per-page from the URL (`paginate by N`
 * is fixed; page-size query params are ignored). The server always renders N per
 * page (data-pm-server-size); we fetch additional server pages on demand and
 * slice them into VIRTUAL pages of the size chosen in the "Show" dropdown, then
 * render our own pagination nav.
 *
 * TC-088: Shopify has no "in-stock first" sort, and Liquid can't re-sort a large
 * collection across pages. When a collection shows ALL products (no availability
 * filter, or BOTH values selected — the default), we present them as
 *   [ every in-stock product ] then [ every "Available for Quote" product ]
 * by fetching the two availability-filtered views (?filter.v.availability=1 / =0)
 * on demand and concatenating them. Filtering to a single availability — or
 * /search — uses the normal single-source path untouched.
 *
 * Coordinates with pm-facets.js: every server swap fires pm:plp-updated, on
 * which we re-init from the fresh grid/total (caches reset).
 */
(function () {
  'use strict';

  var STORE_KEY = 'pm-page-size';
  var wrap, serverSize = 24, total = 0, pageSize = 24, vPage = 1;
  var cache = {};                  // normal mode: server page -> [<li> clones]
  var splitMode = false;           // TC-088 in-stock-first streaming
  var inStockTotal = null;         // in-stock product count (split mode)
  var cacheIn = {}, cacheOut = {}; // split mode: source page -> [<li> clones]

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

  // Current collection URL minus &page — keeps active filters + sort.
  function baseUrl() {
    var u;
    try { u = new URL(window.location.href); } catch (e) { return window.location.pathname; }
    u.searchParams.delete('page');
    var qs = u.searchParams.toString();
    return u.pathname + (qs ? '?' + qs : '');
  }

  // Current URL with availability forced to exactly `val` (1 or 0), &page dropped.
  function availUrl(val) {
    var u;
    try { u = new URL(window.location.href); } catch (e) { return window.location.pathname; }
    u.searchParams.delete('page');
    u.searchParams.delete('filter.v.availability');
    u.searchParams.append('filter.v.availability', val);
    var qs = u.searchParams.toString();
    return u.pathname + (qs ? '?' + qs : '');
  }

  // TC-088 GLOBAL in-stock-first: when showing all products (no availability filter,
  // or both values selected), stream the two availability views
  // (?filter.v.availability=1 / =0) and concatenate [every in-stock product] then
  // [every "Available for Quote" product] across ALL pages. The server-side double-loop
  // in pm-collection.liquid is the no-JS fallback / first paint; this client stitch makes
  // the ordering GLOBAL instead of only per server page. Filtering to a single
  // availability (or /search) uses the normal single-source path untouched.
  function detectSplit() {
    var vals;
    try { vals = new URL(window.location.href).searchParams.getAll('filter.v.availability'); }
    catch (e) { vals = []; }
    if (vals.length === 0) return true;
    return vals.indexOf('1') !== -1 && vals.indexOf('0') !== -1;
  }

  function cloneGrid(dom) {
    var g = dom.querySelector('.pm-plp__grid');
    return g ? Array.prototype.slice.call(g.children).map(function (li) { return li.cloneNode(true); }) : [];
  }

  function init() {
    // /search runs its own client-side sort (pm-plp.js) — leave it alone.
    if (/^\/search/.test(window.location.pathname)) return;
    wrap = document.getElementById('pm-plp-grid-wrap');
    var g = gridEl();
    if (!wrap || !g) return;
    var totalAttr = g.getAttribute('data-pm-total');
    if (totalAttr === null) return;
    total = parseInt(totalAttr, 10) || 0;
    serverSize = parseInt(g.getAttribute('data-pm-server-size'), 10) || 24;
    pageSize = readSelectedSize();
    var sel = document.getElementById('pm-plp-pagesize');
    if (sel && sel.value !== String(pageSize)) sel.value = String(pageSize);
    vPage = 1;
    splitMode = detectSplit();
    window.__pmBooted = true; // tell the inline fast-path we've taken over (avoids a late double-render)
    if (splitMode) {
      cacheIn = {}; cacheOut = {}; inStockTotal = null;
      // FAST PATH: the inline script after the grid (pm-collection.liquid) may have already
      // stitched + revealed the correct first page from the <head> prefetch, BEFORE this
      // deferred JS ran. If so, skip the skeleton + render entirely (no flash, no double work)
      // — just prime the page-1 caches from the prefetch so virtual pagination still works,
      // then bail. (__pmStitchEarly is one-shot; facet/sort re-inits render normally.)
      if (window.__pmStitchEarly) {
        window.__pmStitchEarly = false;
        var preEarly = window.__pmStitch;
        window.__pmStitch = null;
        if (preEarly) {
          Promise.all([preEarly.in1, preEarly.out1]).then(function (res) {
            if (res[0] != null) {
              var dI = new DOMParser().parseFromString(res[0], 'text/html');
              cacheIn[1] = cloneGrid(dI);
              var gI = dI.querySelector('.pm-plp__grid');
              inStockTotal = gI ? (parseInt(gI.getAttribute('data-pm-total'), 10) || 0) : 0;
            }
            if (res[1] != null) cacheOut[1] = cloneGrid(new DOMParser().parseFromString(res[1], 'text/html'));
          });
        }
        return;
      }
      // Fallback (fast path didn't run): shimmer-skeleton until the global order is stitched.
      wrap.classList.add('is-reordering');
    } else {
      cache = {};
      cache[urlPage()] = Array.prototype.slice.call(g.children).map(function (li) { return li.cloneNode(true); });
    }
    render();
  }

  // ── normal-mode fetch (single source) ──
  function fetchServerPage(k) {
    if (cache[k]) return Promise.resolve(cache[k]);
    var b = baseUrl();
    // &view=grid → grid-only, layout-less render (templates/collection.grid.liquid):
    // a fraction of the bytes/server-time vs. a full collection page fetch.
    var url = b + (b.indexOf('?') > -1 ? '&' : '?') + 'page=' + k + '&view=grid';
    return fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { if (!r.ok) throw r.status; return r.text(); })
      .then(function (html) {
        cache[k] = cloneGrid(new DOMParser().parseFromString(html, 'text/html'));
        return cache[k];
      })
      .catch(function () { cache[k] = []; return cache[k]; });
  }

  // ── split-mode fetch (one availability source) ──
  function fetchSrc(src, page) {
    var store = src === 'in' ? cacheIn : cacheOut;
    if (store[page]) return Promise.resolve(store[page]);
    function parse(html) {
      var dom = new DOMParser().parseFromString(html, 'text/html');
      store[page] = cloneGrid(dom);
      if (src === 'in' && page === 1) {
        var ig = dom.querySelector('.pm-plp__grid');
        inStockTotal = ig ? (parseInt(ig.getAttribute('data-pm-total'), 10) || 0) : 0;
      }
      return store[page];
    }
    function freshFetch() {
      var b = availUrl(src === 'in' ? '1' : '0');
      // &view=grid → grid-only, layout-less render (much smaller/faster than a full page).
      var url = b + (b.indexOf('?') > -1 ? '&' : '?') + 'page=' + page + '&view=grid';
      return fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) { if (!r.ok) throw r.status; return r.text(); });
    }
    // Reuse the <head> prefetch (window.__pmStitch) for page 1 — already in flight or done —
    // but ONLY if its base URL still matches the current one. After a facet/sort change
    // (pm-facets does history.pushState) the URL differs, so we fetch fresh and never serve
    // stale (pre-filter) products. Falls back to a fresh grid-only fetch if missing/failed.
    var pre = (page === 1 && window.__pmStitch && window.__pmStitch.base === baseUrl())
      ? (src === 'in' ? window.__pmStitch.in1 : window.__pmStitch.out1) : null;
    var textP = pre ? pre.then(function (html) { return html != null ? html : freshFetch(); }) : freshFetch();
    return textP.then(parse).catch(function () {
      store[page] = [];
      if (src === 'in' && page === 1 && inStockTotal == null) inStockTotal = 0;
      return store[page];
    });
  }

  function ensureInStockTotal() {
    if (inStockTotal != null) return Promise.resolve();
    return fetchSrc('in', 1);
  }

  // Map a GLOBAL product index → its source + source-page + offset.
  // Indices [0, I) are the in-stock products; [I, total) the quote-only ones.
  function locate(i) {
    var I = inStockTotal || 0;
    if (i < I) return { src: 'in', page: Math.floor(i / serverSize) + 1, off: i % serverSize };
    var j = i - I;
    return { src: 'out', page: Math.floor(j / serverSize) + 1, off: j % serverSize };
  }

  function ensureNeeded(startIdx, endIdx) {
    if (!splitMode) {
      var first = Math.floor(startIdx / serverSize) + 1;
      var last = Math.floor((endIdx - 1) / serverSize) + 1;
      var need = [];
      for (var p = first; p <= last; p++) need.push(p);
      return Promise.all(need.map(fetchServerPage));
    }
    function fetchJobs() {
      var jobs = {};
      for (var i = startIdx; i < endIdx; i++) {
        var loc = locate(i);
        jobs[loc.src + ':' + loc.page] = loc;
      }
      return Promise.all(Object.keys(jobs).map(function (key) {
        var loc = jobs[key];
        return fetchSrc(loc.src, loc.page);
      }));
    }
    // First virtual page: fetch the in-stock AND quote views IN PARALLEL (the usual
    // first-page need) instead of in-stock-then-quote sequentially — halves the wait.
    // fetchSrc('in', 1) sets inStockTotal; fetchJobs then reuses the cached pages and
    // pulls an extra page only if the window genuinely needs one.
    if (startIdx === 0 && inStockTotal == null) {
      return Promise.all([fetchSrc('in', 1), fetchSrc('out', 1)]).then(fetchJobs);
    }
    return ensureInStockTotal().then(fetchJobs);
  }

  function cardAt(i) {
    if (!splitMode) {
      var arr = cache[Math.floor(i / serverSize) + 1];
      return arr && arr[i % serverSize];
    }
    var loc = locate(i);
    var store = loc.src === 'in' ? cacheIn : cacheOut;
    var c = store[loc.page];
    return c && c[loc.off];
  }

  function render() {
    var g = gridEl();
    if (!g) return;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (vPage > totalPages) vPage = totalPages;
    if (vPage < 1) vPage = 1;
    var startIdx = (vPage - 1) * pageSize;
    var endIdx = Math.min(vPage * pageSize, total);
    wrap.classList.add('is-loading');
    ensureNeeded(startIdx, endIdx).then(function () {
      var frag = document.createDocumentFragment();
      for (var i = startIdx; i < endIdx; i++) {
        var li = cardAt(i);
        if (li) frag.appendChild(li.cloneNode(true));
      }
      // Single-op replace (one reflow) where supported; fall back for old browsers.
      if (g.replaceChildren) { g.replaceChildren(frag); } else { g.innerHTML = ''; g.appendChild(frag); }
      renderNav(totalPages);
      renderCount(startIdx, endIdx);
      wrap.classList.remove('is-loading');
      wrap.classList.remove('is-reordering'); // reveal — now in stock-first order
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
