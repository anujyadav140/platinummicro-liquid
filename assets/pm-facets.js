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
    refreshPriceBounds(); // TC-089: refine the server-side initial bounds

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
        if (!el) return;
        var name = el.getAttribute('name');
        if (!name) return;
        applyToolbarParam(name, el.value);
      });
    }
  }

  // Mirror a toolbar control (e.g. Sort's `sort_by`) into the facets form
  // as a hidden input, then trigger the debounced AJAX swap. Exposed on
  // window.PmFacets so pm-plp.js can drive the Sort change deterministically
  // (TC-022) instead of relying solely on a synthetic `change` bubbling up.
  function applyToolbarParam(name, val) {
    if (!formEl || !name) return false;
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
    return true;
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
    var numMin   = formEl.querySelector('[data-pm-price-min]');
    var numMax   = formEl.querySelector('[data-pm-price-max]');
    if (!minThumb || !maxThumb || !fill) return;

    // Read bounds FRESH each call so applyBounds() can update them in place
    // (TC-089) without needing to rewire listeners.
    function bMax() { return parseFloat(rangeEl.getAttribute('data-bound-max')) || 1; }
    function bMin() { return parseFloat(rangeEl.getAttribute('data-bound-min')) || 0; }

    function syncFill() {
      var lo = parseFloat(minThumb.value); if (isNaN(lo)) lo = bMin();
      var hi = parseFloat(maxThumb.value); if (isNaN(hi)) hi = bMax();
      var span = bMax() - bMin(); if (span <= 0) span = 1;
      var leftPct  = ((lo - bMin()) / span) * 100;
      var rightPct = 100 - ((hi - bMin()) / span) * 100;
      fill.style.left  = Math.max(0, leftPct)  + '%';
      fill.style.right = Math.max(0, rightPct) + '%';
    }

    function thumbInput() {
      var lo = parseFloat(minThumb.value); if (isNaN(lo)) lo = bMin();
      var hi = parseFloat(maxThumb.value); if (isNaN(hi)) hi = bMax();
      if (lo > hi - 1) { lo = hi - 1; minThumb.value = lo; }
      if (hi < lo + 1) { hi = lo + 1; maxThumb.value = hi; }
      if (numMin) numMin.value = Math.round(lo);
      if (numMax) numMax.value = Math.round(hi);
      syncFill();
    }
    function numberInput() {
      var lo = parseFloat(numMin.value); if (isNaN(lo)) lo = bMin();
      var hi = parseFloat(numMax.value); if (isNaN(hi)) hi = bMax();
      if (lo < bMin()) lo = bMin();
      if (hi > bMax()) hi = bMax();
      if (lo > hi) lo = hi;
      minThumb.value = lo;
      maxThumb.value = hi;
      syncFill();
    }

    // Wire once per element. The form innerHTML is replaced on every AJAX swap,
    // so a swapped-in slider is a fresh element and gets wired again; but
    // applyBounds() calls initRange() on the SAME element, so guard against
    // duplicate listeners.
    if (!rangeEl.__pmWired) {
      rangeEl.__pmWired = true;
      minThumb.addEventListener('input', thumbInput);
      maxThumb.addEventListener('input', thumbInput);
      minThumb.addEventListener('change', onChange);
      maxThumb.addEventListener('change', onChange);
      if (numMin) numMin.addEventListener('input', numberInput);
      if (numMax) numMax.addEventListener('input', numberInput);
    }
    syncFill();
  }

  // ── Accurate price bounds (TC-089) ──────────────────────────────────
  // Shopify's price filter only exposes a collection-wide range_max (no minimum,
  // never narrows with other filters), and only the REAL collection page filters
  // collection.products (the Section API + alternate templates don't). So we
  // fetch the current NON-price filter set sorted by price ascending + descending
  // and read the cheapest/priciest product card for the true bounds. Cached per
  // filter set so price-only changes (and repeat states) don't refetch.
  var _boundsCache = {};
  var _boundsSig = null;

  function priceBaseUrl() {
    var params;
    try { params = new URL(window.location.href).searchParams; }
    catch (e) { params = new URLSearchParams(window.location.search); }
    var keep = new URLSearchParams();
    params.forEach(function (v, k) {
      if (k === 'filter.v.price.gte' || k === 'filter.v.price.lte' || k === 'page' || k === 'sort_by') return;
      keep.append(k, v);
    });
    var s = keep.toString();
    return basePath() + (s ? '?' + s : '');
  }

  function firstCardPrice(html) {
    var dom = new DOMParser().parseFromString(html, 'text/html');
    var el = dom.querySelector('.pm-pcard__price-now');
    if (!el) return null;
    var n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  }

  function applyBounds(min, max) {
    var rangeEl = formEl && formEl.querySelector('[data-pm-range]');
    if (!rangeEl) return;
    min = Math.floor(min); max = Math.ceil(max);
    if (max <= min) max = min + 1;
    var minThumb = rangeEl.querySelector('[data-pm-range-min]');
    var maxThumb = rangeEl.querySelector('[data-pm-range-max]');
    var numMin   = formEl.querySelector('[data-pm-price-min]');
    var numMax   = formEl.querySelector('[data-pm-price-max]');
    var bounds   = formEl.querySelectorAll('.pm-facet__price-bounds span');
    var oldMin = parseFloat(rangeEl.getAttribute('data-bound-min'));
    var oldMax = parseFloat(rangeEl.getAttribute('data-bound-max'));
    // Decide snapping BEFORE mutating any min/max attribute. Setting a range
    // input's `max` immediately CLAMPS its `.value`, so reading the value after
    // would be corrupted — this was the "min updates but max doesn't" bug.
    var curMin = parseFloat(minThumb && minThumb.value);
    var curMax = parseFloat(maxThumb && maxThumb.value);
    var snapMin = isNaN(oldMin) || isNaN(curMin) || curMin <= oldMin;
    var snapMax = isNaN(oldMax) || isNaN(curMax) || curMax >= oldMax;
    rangeEl.setAttribute('data-bound-min', min);
    rangeEl.setAttribute('data-bound-max', max);
    [minThumb, maxThumb, numMin, numMax].forEach(function (el) {
      if (!el) return; el.min = min; el.max = max;
    });
    if (numMin) numMin.setAttribute('placeholder', min);
    if (numMax) numMax.setAttribute('placeholder', max);
    // Set values explicitly (after the attributes). Snap an end to the new
    // bound if the user hadn't narrowed it; otherwise clamp the kept value
    // into the new range.
    var newMin = snapMin ? min : Math.max(min, Math.min(max, curMin));
    var newMax = snapMax ? max : Math.max(min, Math.min(max, curMax));
    if (newMin > newMax) newMin = newMax;
    if (minThumb) minThumb.value = newMin;
    if (maxThumb) maxThumb.value = newMax;
    if (numMin) numMin.value = Math.round(newMin);
    if (numMax) numMax.value = Math.round(newMax);
    if (bounds[0]) bounds[0].textContent = '$' + min;
    if (bounds[1]) bounds[1].textContent = '$' + max;
    initRange(rangeEl);
  }

  function refreshPriceBounds() {
    if (!formEl || !formEl.querySelector('[data-pm-range]')) return;
    var base = priceBaseUrl();
    if (base === _boundsSig) return;            // same non-price filters → skip
    _boundsSig = base;
    if (_boundsCache[base]) { applyBounds(_boundsCache[base].min, _boundsCache[base].max); return; }
    var sep = base.indexOf('?') > -1 ? '&' : '?';
    var opt = { headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    Promise.all([
      fetch(base + sep + 'sort_by=price-ascending',  opt).then(function (r) { return r.text(); }),
      fetch(base + sep + 'sort_by=price-descending', opt).then(function (r) { return r.text(); })
    ]).then(function (h) {
      var min = firstCardPrice(h[0]);
      var max = firstCardPrice(h[1]);
      if (min == null || max == null) return;
      _boundsCache[base] = { min: min, max: max };
      if (_boundsSig === base) applyBounds(min, max);  // still the active filter set
    }).catch(function () {});
  }

  // ── AJAX fetch + swap ────────────────────────────────────────────────
  // Build the URL from the current facets-form state, then swap.
  function fetchAndSwap() {
    var formData = new FormData(formEl);
    var qs = new URLSearchParams();
    // A full-range price (gte 0 / lte bound) is NOT a real constraint, but the
    // number inputs always carry those values — so submitting them on every
    // facet change spuriously activates a "$0–max" price filter (adds a price
    // chip AND makes Shopify re-derive the price bounds from each brand's
    // results, so min/max appear to "jump" when you tick a brand). Drop them
    // unless the user actually narrowed the range.
    var rangeEl = formEl.querySelector('[data-pm-range]');
    var priceMax = rangeEl ? parseFloat(rangeEl.getAttribute('data-bound-max')) : NaN;
    var priceMin = rangeEl ? parseFloat(rangeEl.getAttribute('data-bound-min')) : NaN;
    formData.forEach(function (v, k) {
      if (v === '' || v == null) return;
      if (k === 'filter.v.price.gte' && parseFloat(v) <= (isNaN(priceMin) ? 0 : priceMin)) return;
      if (k === 'filter.v.price.lte' && !isNaN(priceMax) && parseFloat(v) >= priceMax) return;
      qs.append(k, v);
    });

    var base = (formEl.getAttribute('action') || window.location.pathname).split('?')[0];
    var url = base + (qs.toString() ? '?' + qs.toString() : '');
    swapToUrl(url);
  }

  // Fetch an explicit URL and swap the facets form, grid and header.
  // Shared by fetchAndSwap (facet changes / sort) and the Clear-all /
  // filter-chip handlers (TC-021), which build their own target URL.
  function swapToUrl(url) {
    if (gridEl) gridEl.classList.add('is-loading');

    fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var dom = new DOMParser().parseFromString(html, 'text/html');
        // Preserve <details open> state AND the inner scroll position of the
        // scrollable facet lists (e.g. the Brand list, which is its own
        // max-height/overflow scroll container) so the user doesn't get
        // yanked back to the top when we rebuild the form's innerHTML.
        var openSet = {};
        formEl.querySelectorAll('[data-pm-facet]').forEach(function (d, i) {
          openSet[i] = d.hasAttribute('open');
        });
        var scrollSet = {};
        formEl.querySelectorAll('.pm-facet__values').forEach(function (el, i) {
          scrollSet[i] = el.scrollTop;
        });
        var newForm = dom.getElementById('pm-facets-form');
        if (newForm) {
          formEl.innerHTML = newForm.innerHTML;
          formEl.querySelectorAll('[data-pm-facet]').forEach(function (d, i) {
            if (openSet[i] === false) d.removeAttribute('open');
            else d.setAttribute('open', '');
          });
          // Restore scroll AFTER the open-state pass so the lists are laid
          // out (a collapsed <details> has no scrollable height yet).
          formEl.querySelectorAll('.pm-facet__values').forEach(function (el, i) {
            if (scrollSet[i]) el.scrollTop = scrollSet[i];
          });
        }
        var newGrid = dom.getElementById('pm-plp-grid-wrap');
        if (newGrid && gridEl) gridEl.innerHTML = newGrid.innerHTML;
        var newHead = dom.getElementById('pm-plp-header');
        if (newHead && headEl) headEl.innerHTML = newHead.innerHTML;

        history.pushState({ url: url }, '', url);
        initRange(formEl.querySelector('[data-pm-range]'));
        refreshPriceBounds(); // TC-089: re-derive bounds for the new filter set
        // Tell PLP toolbar handlers (view-toggle restore) that DOM swapped
        document.dispatchEvent(new CustomEvent('pm:plp-updated'));
      })
      .catch(function () { /* swallow */ })
      .finally(function () {
        if (gridEl) gridEl.classList.remove('is-loading');
      });
  }

  // ── Clear-all / individual filter removal (TC-021) ──────────────────
  // Active-filter chips + the "Clear all" button live in the swapped
  // header (#pm-plp-header). Their click handlers are delegated from the
  // document so they survive every AJAX swap.
  //
  // We treat `filter.*` as the only filter params. Everything else
  // (sort_by, page_size, q, type, options[prefix]) is NOT a filter and is
  // preserved when clearing.
  var FILTER_RE = /^filter\./;

  function basePath() {
    return (formEl && formEl.getAttribute('action') || window.location.pathname).split('?')[0];
  }

  // Build a URL from the current location, mutating its filter params.
  // `drop` (optional) — { name: <param>, value: <value|null> }. When value
  // is null, all values for that param are removed; otherwise only the
  // matching value is removed. When `drop` is omitted, ALL filter.* params
  // are removed (Clear all).
  function buildUrl(drop) {
    var params;
    try { params = new URL(window.location.href).searchParams; }
    catch (e) { params = new URLSearchParams(window.location.search); }

    // An empty/absent drop.value means "remove every value of this param".
    // We also match by prefix in that case so a price chip named
    // "filter.v.price" drops both filter.v.price.gte AND .lte in one go.
    var dropAllValues = drop && (drop.value == null || drop.value === '');

    var keep = new URLSearchParams();
    params.forEach(function (v, k) {
      var isFilter = FILTER_RE.test(k);
      if (!isFilter) {
        // Non-filter param: always keep (sort_by, page_size, q, …).
        keep.append(k, v);
        return;
      }
      if (!drop) return;                       // Clear all → drop every filter
      var nameMatch = dropAllValues
        ? (k === drop.name || k.indexOf(drop.name + '.') === 0) // exact or prefixed
        : (k === drop.name);
      if (!nameMatch) { keep.append(k, v); return; }
      if (!dropAllValues && v !== drop.value) { keep.append(k, v); return; }
      // else: this is the value we're removing → skip it
    });

    // Defensive: ensure search context params survive even if not in URL.
    if (formEl) {
      ['q', 'type', 'options[prefix]'].forEach(function (n) {
        if (!keep.has(n)) {
          var h = formEl.querySelector('input[name="' + n + '"]');
          if (h && h.value) keep.append(n, h.value);
        }
      });
    }

    var s = keep.toString();
    return basePath() + (s ? '?' + s : '');
  }

  function clearAll()              { if (formEl) swapToUrl(buildUrl(null)); }
  function removeFilter(name, val) { if (formEl) swapToUrl(buildUrl({ name: name, value: val == null ? null : String(val) })); }

  // Delegated handlers for Clear all + chips (survive AJAX swaps).
  if (!document.__pmFacetChipsBound) {
    document.__pmFacetChipsBound = true;
    document.addEventListener('click', function (e) {
      var clearBtn = e.target.closest('[data-pm-clear-all]');
      if (clearBtn) { e.preventDefault(); clearAll(); return; }
      var chip = e.target.closest('[data-pm-filter-remove]');
      if (chip) {
        e.preventDefault();
        removeFilter(chip.getAttribute('data-filter-name'), chip.getAttribute('data-filter-value'));
      }
    });
  }

  // Public API so pm-plp.js can drive Sort deterministically and reuse
  // the swap engine (avoids depending on synthetic-event bubbling).
  window.PmFacets = {
    applyToolbarParam: applyToolbarParam,
    swapToUrl: swapToUrl,
    clearAll: clearAll,
    removeFilter: removeFilter
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
