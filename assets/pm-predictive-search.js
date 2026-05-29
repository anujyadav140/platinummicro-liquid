/*
  PM — Predictive Search (header autocomplete)
  ============================================
  Progressive enhancement over the plain /search form in sections/pm-header.liquid.
  As the shopper types, we fetch Shopify's Predictive Search via the Section
  Rendering API and drop the rendered `predictive-search` section into a panel
  under the input. No type-ahead = no behaviour change (form still submits).

  Markup hooks (pm-header.liquid):
    [data-pm-search]            wrapper (position: relative)
    input[type="search"]        the query field
    [data-pm-search-results]    empty panel we fill + toggle

  Route: window.routes.predictive_search_url (set in layout/theme.liquid).
*/
(function () {
  'use strict';

  var wrap = document.querySelector('[data-pm-search]');
  if (!wrap) return;

  var input = wrap.querySelector('input[type="search"]');
  var panel = wrap.querySelector('[data-pm-search-results]');
  if (!input || !panel) return;

  var ROUTE = (window.routes && window.routes.predictive_search_url) || '/search/suggest';
  var MIN_CHARS = 2;
  var DEBOUNCE = 220;

  var timer = null;
  var controller = null;
  var lastTerm = '';

  function show() {
    if (panel.hidden) panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function hide() {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }
  function clear() {
    panel.innerHTML = '';
    lastTerm = '';
    hide();
  }

  function render(term) {
    if (controller) controller.abort();
    controller = new AbortController();

    var url = ROUTE +
      '?q=' + encodeURIComponent(term) +
      '&section_id=predictive-search' +
      '&resources[type]=product,collection,query' +
      '&resources[limit]=6' +
      '&resources[options][unavailable_products]=last';

    fetch(url, { signal: controller.signal })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var results = doc.getElementById('pm-psr');
        if (!results) { clear(); return; }
        panel.innerHTML = results.outerHTML;
        show();
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        clear();
      });
  }

  function onInput() {
    var term = (input.value || '').trim();
    clearTimeout(timer);
    if (term.length < MIN_CHARS) { clear(); return; }
    if (term === lastTerm) { if (panel.innerHTML) show(); return; }
    lastTerm = term;
    timer = setTimeout(function () { render(term); }, DEBOUNCE);
  }

  // Keyboard nav across the rendered result links.
  function links() {
    return panel.hidden ? [] : Array.prototype.slice.call(panel.querySelectorAll('a'));
  }
  function focusIndex() {
    var ls = links();
    for (var i = 0; i < ls.length; i++) { if (ls[i] === document.activeElement) return i; }
    return -1;
  }
  function moveFocus(dir) {
    var ls = links();
    if (!ls.length) return;
    var i = focusIndex();
    if (dir > 0) { (ls[i + 1] || ls[0]).focus(); }
    else { if (i <= 0) { input.focus(); } else { ls[i - 1].focus(); } }
  }

  input.addEventListener('input', onInput);

  input.addEventListener('focus', function () {
    if ((input.value || '').trim().length >= MIN_CHARS && panel.innerHTML) show();
  });

  wrap.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { clear(); input.focus(); return; }
    if (panel.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
  });

  // Dismiss when focus/click leaves the search area.
  document.addEventListener('click', function (e) {
    if (!wrap.contains(e.target)) hide();
  });
  document.addEventListener('focusin', function (e) {
    if (!wrap.contains(e.target)) hide();
  });
})();
