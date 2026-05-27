/**
 * PmFacets — collection / search facets.
 *  • Any change debounces a fetch of the current URL + new querystring,
 *    swaps the facets form, grid wrap, and header.
 *  • Dual-range price slider — two range inputs overlaid on a track,
 *    JS keeps the number inputs and fill bar in sync.
 *  • Updates browser history via pushState; popstate triggers a reload
 *    so back/forward navigation lands on the right state.
 */
(function () {
  'use strict';

  var DEBOUNCE_MS = 320;
  var formEl, gridEl, headEl, debounceTimer;

  function init() {
    formEl = document.getElementById('pm-facets-form');
    gridEl = document.getElementById('pm-plp-grid-wrap');
    headEl = document.getElementById('pm-plp-header');
    if (!formEl) return;

    formEl.addEventListener('input', onChange);
    formEl.addEventListener('change', onChange);
    formEl.addEventListener('submit', function (e) { e.preventDefault(); onChange(); });

    initRange(formEl.querySelector('[data-pm-range]'));

    // Mobile drawer
    var trigger = document.querySelector('[data-pm-facets-toggle]');
    if (trigger) {
      trigger.addEventListener('click', function () {
        formEl.classList.toggle('is-open');
        document.body.classList.toggle('pm-facets-drawer-open', formEl.classList.contains('is-open'));
      });
      formEl.addEventListener('click', function (e) {
        if (e.target === formEl) {
          formEl.classList.remove('is-open');
          document.body.classList.remove('pm-facets-drawer-open');
        }
      });
    }

    window.addEventListener('popstate', function () { window.location.reload(); });

    // Toolbar selects (Sort) — delegated at the document level so they
    // survive every AJAX swap of the toolbar HTML. The SHOW select uses
    // its own inline onchange and reloads the page, so it's not in here.
    if (!document.__pmPlpControlBound) {
      document.__pmPlpControlBound = true;
      document.addEventListener('change', function (e) {
        var el = e.target.closest('[data-pm-plp-control]');
        if (!el || !formEl) return;
        var name = el.getAttribute('name');
        if (!name) return;
        var val  = el.value;
        var safe = name.replace(/[^a-z0-9_.]/gi, '');
        var hidden = formEl.querySelector('input[type="hidden"][data-toolbar="' + safe + '"]');
        if (!hidden) {
          hidden = document.createElement('input');
          hidden.type = 'hidden';
          hidden.name = name;
          hidden.setAttribute('data-toolbar', safe);
          formEl.appendChild(hidden);
        }
        hidden.value = val;
        onChange();
      });
    }
  }

  function onChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchAndSwap, DEBOUNCE_MS);
  }

  // ── Dual-range slider ───────────────────────────────────────────────
  function initRange(rangeEl) {
    if (!rangeEl) return;
    var minThumb = rangeEl.querySelector('[data-pm-range-min]');
    var maxThumb = rangeEl.querySelector('[data-pm-range-max]');
    var fill     = rangeEl.querySelector('[data-pm-range-fill]');
    var bound    = parseFloat(rangeEl.getAttribute('data-bound-max')) || 1;
    var numMin   = formEl.querySelector('[data-pm-price-min]');
    var numMax   = formEl.querySelector('[data-pm-price-max]');

    function syncFill() {
      var lo = parseFloat(minThumb.value) || 0;
      var hi = parseFloat(maxThumb.value);
      if (isNaN(hi)) hi = bound;
      if (lo > hi - 1) lo = hi - 1;
      if (hi < lo + 1) hi = lo + 1;
      var leftPct  = (lo / bound) * 100;
      var rightPct = 100 - (hi / bound) * 100;
      fill.style.left  = Math.max(0, leftPct)  + '%';
      fill.style.right = Math.max(0, rightPct) + '%';
    }

    function thumbInput() {
      var lo = parseFloat(minThumb.value) || 0;
      var hi = parseFloat(maxThumb.value);
      if (isNaN(hi)) hi = bound;
      if (lo > hi - 1) { lo = hi - 1; minThumb.value = lo; }
      if (hi < lo + 1) { hi = lo + 1; maxThumb.value = hi; }
      numMin.value = Math.round(lo);
      numMax.value = Math.round(hi);
      syncFill();
    }
    function numberInput() {
      var lo = parseFloat(numMin.value) || 0;
      var hi = parseFloat(numMax.value);
      if (isNaN(hi)) hi = bound;
      if (lo < 0) lo = 0;
      if (hi > bound) hi = bound;
      if (lo > hi) lo = hi;
      minThumb.value = lo;
      maxThumb.value = hi;
      syncFill();
    }

    minThumb.addEventListener('input', thumbInput);
    maxThumb.addEventListener('input', thumbInput);
    minThumb.addEventListener('change', onChange);
    maxThumb.addEventListener('change', onChange);
    numMin.addEventListener('input', numberInput);
    numMax.addEventListener('input', numberInput);

    syncFill();
  }

  // ── AJAX fetch + swap ────────────────────────────────────────────────
  function fetchAndSwap() {
    var formData = new FormData(formEl);
    var qs = new URLSearchParams();
    formData.forEach(function (v, k) {
      if (v === '' || v == null) return;
      qs.append(k, v);
    });

    var basePath = (formEl.getAttribute('action') || window.location.pathname).split('?')[0];
    var url = basePath + (qs.toString() ? '?' + qs.toString() : '');

    if (gridEl) gridEl.classList.add('is-loading');

    fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var dom = new DOMParser().parseFromString(html, 'text/html');
        // Preserve <details open> state so the user doesn't lose their place
        var openSet = {};
        formEl.querySelectorAll('[data-pm-facet]').forEach(function (d, i) {
          openSet[i] = d.hasAttribute('open');
        });
        var newForm = dom.getElementById('pm-facets-form');
        if (newForm) {
          formEl.innerHTML = newForm.innerHTML;
          formEl.querySelectorAll('[data-pm-facet]').forEach(function (d, i) {
            if (openSet[i] === false) d.removeAttribute('open');
            else d.setAttribute('open', '');
          });
        }
        var newGrid = dom.getElementById('pm-plp-grid-wrap');
        if (newGrid && gridEl) gridEl.innerHTML = newGrid.innerHTML;
        var newHead = dom.getElementById('pm-plp-header');
        if (newHead && headEl) headEl.innerHTML = newHead.innerHTML;

        history.pushState({ url: url }, '', url);
        initRange(formEl.querySelector('[data-pm-range]'));
        // Tell PLP toolbar handlers (view-toggle restore) that DOM swapped
        document.dispatchEvent(new CustomEvent('pm:plp-updated'));
      })
      .catch(function () { /* swallow */ })
      .finally(function () {
        if (gridEl) gridEl.classList.remove('is-loading');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
