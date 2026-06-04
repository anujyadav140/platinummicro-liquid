/**
 * PmPlp — PLP toolbar handlers (view toggle + sort menu).
 *
 * The grid + toolbar HTML gets swapped by pm-facets.js after every facet
 * change. Setting innerHTML doesn't re-execute <script> tags, so any
 * listener bound to those elements dies on the first AJAX update. We
 * delegate from document instead so the handlers survive every swap.
 */
(function () {
  'use strict';

  function closeAllSorts(except) {
    document.querySelectorAll('[data-pm-sort].is-open').forEach(function (root) {
      if (root === except) return;
      root.classList.remove('is-open');
      var menu = root.querySelector('[data-pm-sort-menu]');
      var trig = root.querySelector('[data-pm-sort-trigger]');
      if (menu) menu.setAttribute('hidden', '');
      if (trig) trig.setAttribute('aria-expanded', 'false');
    });
  }

  // ── Click delegation ────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    // VIEW TOGGLE — grid/list buttons in the toolbar
    var viewBtn = e.target.closest('[data-pm-view]');
    if (viewBtn) {
      var mode = viewBtn.getAttribute('data-pm-view');
      var grid = document.querySelector('[data-pm-view-mode]');
      if (grid) grid.setAttribute('data-pm-view-mode', mode);
      document.querySelectorAll('[data-pm-view]').forEach(function (b) {
        var on = b.getAttribute('data-pm-view') === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      try { localStorage.setItem('pm-view-mode', mode); } catch (e) {}
      return;
    }

    // SORT TRIGGER — open / close the menu
    var trigger = e.target.closest('[data-pm-sort-trigger]');
    if (trigger) {
      e.stopPropagation();
      var root = trigger.closest('[data-pm-sort]');
      if (!root) return;
      var menu = root.querySelector('[data-pm-sort-menu]');
      var isOpen = !menu.hasAttribute('hidden');
      closeAllSorts(root);
      if (isOpen) {
        menu.setAttribute('hidden', '');
        trigger.setAttribute('aria-expanded', 'false');
        root.classList.remove('is-open');
      } else {
        menu.removeAttribute('hidden');
        trigger.setAttribute('aria-expanded', 'true');
        root.classList.add('is-open');
      }
      return;
    }

    // SORT OPTION — picked an entry
    var opt = e.target.closest('[data-pm-sort-opt]');
    if (opt) {
      var sortRoot = opt.closest('[data-pm-sort]');
      if (!sortRoot) return;
      var hidden  = sortRoot.querySelector('input[type="hidden"][name="sort_by"]');
      var current = sortRoot.querySelector('.pm-sort__current');
      var val     = opt.getAttribute('data-value');
      var labelEl = opt.querySelector('.pm-sort__opt-label');
      var label   = labelEl ? labelEl.textContent : val;
      sortRoot.querySelectorAll('[data-pm-sort-opt]').forEach(function (o) {
        var on = o === opt;
        o.classList.toggle('is-active', on);
        o.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (current) current.textContent = label;
      if (hidden) hidden.value = val;
      // TC-022: reorder via the facets AJAX engine (pushState, no full
      // reload). Drive it directly through the public API for determinism;
      // fall back to a bubbling `change` event only if the engine isn't
      // loaded yet. syncSortControl() re-asserts this label after the swap.
      if (window.PmFacets && typeof window.PmFacets.applyToolbarParam === 'function') {
        window.PmFacets.applyToolbarParam('sort_by', val);
      } else if (hidden) {
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }
      var menu2 = sortRoot.querySelector('[data-pm-sort-menu]');
      var trig2 = sortRoot.querySelector('[data-pm-sort-trigger]');
      if (menu2) menu2.setAttribute('hidden', '');
      if (trig2) trig2.setAttribute('aria-expanded', 'false');
      sortRoot.classList.remove('is-open');
      return;
    }

    // Click outside any sort menu → close them all
    if (!e.target.closest('[data-pm-sort]')) closeAllSorts(null);
  });

  // ── Escape closes sort menus ────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAllSorts(null);
  });

  // ── Client-side sort for /search ────────────────────────────────────
  //
  // Shopify's /search endpoint only honors relevance/price-asc/price-desc
  // server-side — title-asc, title-desc, newest, best-selling all return
  // the same order. To make the dropdown feel responsive, we post-sort
  // the currently-visible product cards client-side after every update.
  // (Only affects the visible page, but Shopify won't let us sort 869
  // results by title server-side so this is the best we get.)
  function applySearchClientSort() {
    if (!/^\/search/.test(window.location.pathname)) return;
    // URL is the source of truth — survives AJAX swaps and pushState.
    var sort = '';
    try { sort = new URL(window.location.href).searchParams.get('sort_by') || ''; } catch (e) {}
    if (!sort) {
      var sortInput = document.querySelector('input[type="hidden"][name="sort_by"]');
      sort = sortInput ? sortInput.value : '';
    }
    if (!sort) return;

    var grid = document.querySelector('.pm-plp__grid');
    if (!grid) return;

    var titleOf = function (li) {
      var t = li.querySelector('.pm-pcard__title');
      return t ? (t.textContent || '').trim().toLowerCase() : '';
    };
    var priceOf = function (li) {
      var p = li.querySelector('.pm-pcard__price-now');
      if (!p) return 0;
      var n = parseFloat((p.textContent || '').replace(/[^0-9.]/g, ''));
      return isNaN(n) ? 0 : n;
    };

    var sortFn;
    switch (sort) {
      case 'title-ascending':  sortFn = function (a, b) { return titleOf(a).localeCompare(titleOf(b)); }; break;
      case 'title-descending': sortFn = function (a, b) { return titleOf(b).localeCompare(titleOf(a)); }; break;
      case 'price-ascending':  sortFn = function (a, b) { return priceOf(a) - priceOf(b); }; break;
      case 'price-descending': sortFn = function (a, b) { return priceOf(b) - priceOf(a); }; break;
      default: return; // relevance / unsupported → server already did its best
    }

    var items = Array.prototype.slice.call(grid.children);
    items.sort(sortFn);
    var frag = document.createDocumentFragment();
    items.forEach(function (li) { frag.appendChild(li); });
    grid.appendChild(frag);
  }

  // ── Sync sort-control label + active option from the URL ────────────
  //
  // TC-016 / TC-022 fix. After pm-facets.js swaps #pm-plp-header (which
  // contains the sort menu) the server re-renders the menu from its own
  // `sort_by` value. Shopify's /search in particular does NOT always echo
  // the chosen sort back, so the freshly-picked label would silently
  // revert to "Relevance"/"Featured". The URL is our source of truth (we
  // pushState'd it), so we re-assert the trigger label, the hidden input,
  // and the is-active/aria-selected option from `sort_by` on every swap.
  function syncSortControl() {
    var sort = '';
    try { sort = new URL(window.location.href).searchParams.get('sort_by') || ''; } catch (e) {}
    if (!sort) return; // no explicit sort → leave server default as-is

    document.querySelectorAll('[data-pm-sort]').forEach(function (root) {
      var match = null;
      root.querySelectorAll('[data-pm-sort-opt]').forEach(function (o) {
        var on = o.getAttribute('data-value') === sort;
        o.classList.toggle('is-active', on);
        o.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) match = o;
      });
      if (!match) return; // sort value not in this menu's options
      var current = root.querySelector('.pm-sort__current');
      if (current) {
        var labelEl = match.querySelector('.pm-sort__opt-label');
        current.textContent = labelEl ? labelEl.textContent : sort;
      }
      var hidden = root.querySelector('input[type="hidden"][name="sort_by"]');
      if (hidden) hidden.value = sort;
    });
  }

  // ── Client-side BRAND/VENDOR filter (TC-017 / TC-020) ───────────────
  //
  // When the storefront *vendor* filter isn't enabled in Shopify admin,
  // the server silently ignores `filter.p.vendor`, so an AJAX swap comes
  // back with EVERY product (price/availability, which usually ARE
  // enabled, still narrow server-side). The facets form is then flagged
  // with data-pm-vendor-clientside="true".
  //
  // In that mode we:
  //   1. read the selected vendor(s) from the URL (?filter.p.vendor=…),
  //   2. re-assert the matching checkbox states (authoritative — fixes
  //      the "checkbox unchecks itself" symptom from the fragile Liquid
  //      substring check), and
  //   3. hide grid cards whose vendor isn't in the selected set, so the
  //      grid actually narrows. Combines naturally with price/availability
  //      which the server already applied.
  function getSelectedVendors() {
    var out = [];
    try {
      new URL(window.location.href).searchParams.getAll('filter.p.vendor')
        .forEach(function (v) { if (v) out.push(v.toLowerCase()); });
    } catch (e) {}
    return out;
  }

  function applyVendorFilter() {
    var form = document.getElementById('pm-facets-form');
    // Only engage in fallback (client-side) mode. If Shopify filtered
    // server-side, the grid is already correct — don't touch it.
    if (!form || form.getAttribute('data-pm-vendor-clientside') !== 'true') return;

    var selected = getSelectedVendors();

    // (2) Re-assert checkbox state from the URL (exact value match).
    form.querySelectorAll('[data-pm-vendor]').forEach(function (cb) {
      var val = (cb.getAttribute('data-pm-vendor-value') || cb.value || '').toLowerCase();
      cb.checked = selected.indexOf(val) !== -1;
    });

    // (3) Show/hide grid cards by vendor.
    var grid = document.querySelector('.pm-plp__grid');
    if (!grid) return;
    var items = Array.prototype.slice.call(grid.children);
    var shown = 0;
    items.forEach(function (li) {
      if (selected.length === 0) { li.hidden = false; shown++; return; }
      var brandEl = li.querySelector('.pm-pcard__brand');
      var vendor = brandEl ? (brandEl.textContent || '').trim().toLowerCase() : '';
      var match = vendor && selected.indexOf(vendor) !== -1;
      li.hidden = !match;
      if (match) shown++;
    });

    // If a vendor is selected but nothing on this page matches, surface a
    // lightweight empty hint (only when we actually hid everything).
    var wrap = document.getElementById('pm-plp-grid-wrap');
    if (wrap) {
      var hint = wrap.querySelector('[data-pm-vendor-empty]');
      if (selected.length > 0 && shown === 0) {
        if (!hint) {
          hint = document.createElement('p');
          hint.className = 'pm-facet__empty';
          hint.setAttribute('data-pm-vendor-empty', '');
          hint.style.padding = '24px 0';
          hint.textContent = 'No products from the selected brand on this page.';
          grid.parentNode.insertBefore(hint, grid.nextSibling);
        }
      } else if (hint) {
        hint.parentNode.removeChild(hint);
      }
    }
  }

  // ── Client-side active-filter chips + Clear all (TC-021 fallback) ───
  //
  // Shopify-enabled filters (price/availability) already render chips +
  // "Clear all" server-side from active_values. But the brand/vendor
  // fallback can't: `request.url` is nil in Shopify Liquid, so the
  // server-side chip logic for vendor silently no-ops. We rebuild the
  // missing chips here from window.location so a "Clear all" control and
  // a removable pill ALWAYS appear whenever a filter.* param is active —
  // the remove/clear click handlers in pm-facets.js are delegated, so
  // these JS-built chips work the same as the server-rendered ones.
  function prettyFilterLabel(name, value) {
    if (name === 'filter.v.availability') return value === '0' ? 'Out of stock' : 'In stock';
    if (name === 'filter.p.tag') {
      if (value === 'on-sale') return 'On sale';
      if (value === 'featured') return 'Featured';
      return value;
    }
    return value; // vendor + anything else → raw value (e.g. "ASRock Rack")
  }

  function renderFallbackChips() {
    var form = document.getElementById('pm-facets-form');
    // Only needed in vendor-fallback mode (Shopify isn't filtering vendor
    // server-side). When the merchant enables the filter, Shopify renders
    // the chips natively and this is a no-op.
    if (!form || form.getAttribute('data-pm-vendor-clientside') !== 'true') return;

    var active = [];
    try {
      new URL(window.location.href).searchParams.forEach(function (v, k) {
        if (/^filter\./.test(k) && v !== '' && v != null) active.push({ name: k, value: v });
      });
    } catch (e) {}
    if (!active.length) return;

    // Find the server-rendered block (present when a Shopify filter is also
    // active) or create one at the top of the form.
    var block = form.querySelector('[data-pm-active-filters]');
    if (!block) {
      block = document.createElement('div');
      block.className = 'pm-facets__active';
      block.setAttribute('data-pm-active-filters', '');
      block.innerHTML =
        '<div class="pm-facets__active-head">' +
          '<span class="pm-facets__active-title">Filters</span>' +
          '<button type="button" class="pm-facets__clear" data-pm-clear-all>Clear all</button>' +
        '</div>' +
        '<ul class="pm-facets__chips"></ul>';
      form.insertBefore(block, form.firstChild);
    }
    var ul = block.querySelector('.pm-facets__chips');
    if (!ul) return;

    // Skip params already shown as a server-rendered chip.
    var seen = {};
    ul.querySelectorAll('[data-pm-filter-remove]').forEach(function (c) {
      seen[c.getAttribute('data-filter-name') + '=' + (c.getAttribute('data-filter-value') || '')] = true;
    });

    active.forEach(function (p) {
      // Price gte/lte get a single combined server chip when enabled; don't
      // double-render noisy raw price pills here.
      if (/price/.test(p.name) && block.querySelector('[data-filter-name="filter.v.price"]')) return;
      if (seen[p.name + '=' + p.value]) return;
      seen[p.name + '=' + p.value] = true;

      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pm-facets__chip';
      btn.setAttribute('data-pm-filter-remove', '');
      btn.setAttribute('data-filter-name', p.name);
      btn.setAttribute('data-filter-value', p.value);
      btn.innerHTML =
        '<span class="pm-facets__chip-label"></span>' +
        '<svg class="pm-facets__chip-x" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      btn.querySelector('.pm-facets__chip-label').textContent = prettyFilterLabel(p.name, p.value);
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  // ── Restore last view mode on each navigation/AJAX swap ─────────────
  function restoreViewMode() {
    try {
      var saved = localStorage.getItem('pm-view-mode');
      if (!saved) return;
      var grid = document.querySelector('[data-pm-view-mode]');
      if (!grid) return;
      grid.setAttribute('data-pm-view-mode', saved);
      document.querySelectorAll('[data-pm-view]').forEach(function (b) {
        var on = b.getAttribute('data-pm-view') === saved;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    } catch (e) {}
  }
  // ── Keep On sale / Featured boxes ticked (TC-090) ──────────────────
  // Shopify caps a filter at 100 values, so on a 100+ tag store the
  // on-sale/featured tag values fall off the list — Liquid then can't tell
  // they're active (no active_value; request.url is nil), so the box renders
  // unchecked. Re-assert the checked state from the URL's filter.p.tag params
  // after every render so they stay ticked through navigations + AJAX swaps.
  function applyPromoChecked() {
    var active = [];
    try {
      new URL(window.location.href).searchParams.getAll('filter.p.tag')
        .forEach(function (v) { if (v) active.push(v.toLowerCase()); });
    } catch (e) {}
    document.querySelectorAll('#pm-facets-form input[name="filter.p.tag"]').forEach(function (cb) {
      if (cb.disabled) return;
      cb.checked = active.indexOf((cb.value || '').toLowerCase()) !== -1;
    });
  }

  function onUpdate() {
    restoreViewMode();
    syncSortControl();      // TC-016: keep the sort label after AJAX header swap
    applyVendorFilter();    // TC-017/020: narrow grid by vendor + fix checkbox state
    applyPromoChecked();    // TC-090: keep On sale / Featured ticked (100-value cap)
    renderFallbackChips();  // TC-021: client-side Clear all + chips in fallback mode
    applySearchClientSort();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onUpdate);
  } else {
    onUpdate();
  }
  // Re-apply after pm-facets.js swaps the toolbar HTML
  document.addEventListener('pm:plp-updated', onUpdate);

  // ── Auth form interceptor ─────────────────────────────────────────
  //
  // /account/login and /account/register are 404s under New Customer
  // Accounts. We redirect to /account (Shopify-hosted email magic-link
  // flow), appending:
  //   • email     — pre-fills the field on Shopify's page
  //   • return_to — where to send the user after successful auth
  //                  (Shopify's OAuth callback honours this for the
  //                  storefront origin).
  function authRedirect(email) {
    var origin = window.location.origin;
    var returnTo = origin + '/';
    var url = '/account?return_to=' + encodeURIComponent(returnTo);
    if (email) url += '&email=' + encodeURIComponent(email);
    // Drop a flag so when the user returns authenticated, we can show
    // a welcome toast.
    try { sessionStorage.setItem('pm-auth-pending', '1'); } catch (e) {}
    window.location.href = url;
  }

  // ── Welcome toast after successful Shopify auth ───────────────────
  function maybeWelcome() {
    var customerId = document.body.getAttribute('data-pm-customer') || '';
    var pending = false;
    try { pending = sessionStorage.getItem('pm-auth-pending') === '1'; } catch (e) {}
    if (!customerId || !pending) return;
    try { sessionStorage.removeItem('pm-auth-pending'); } catch (e) {}
    var name = document.body.getAttribute('data-pm-customer-name') || '';
    var toast = document.createElement('div');
    toast.className = 'pm-toast pm-toast--ok';
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' +
      '<div class="pm-toast__body">' +
        '<div class="pm-toast__title">Signed in' + (name ? ', ' + name : '') + '.</div>' +
        '<div class="pm-toast__lead">Welcome back to Platinum Micro.</div>' +
      '</div>' +
      '<button type="button" class="pm-toast__close" aria-label="Dismiss">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>';
    document.body.appendChild(toast);
    function dismiss() {
      toast.classList.add('is-leaving');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 220);
    }
    toast.querySelector('.pm-toast__close').addEventListener('click', dismiss);
    setTimeout(dismiss, 4200);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeWelcome);
  } else {
    maybeWelcome();
  }

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-pm-auth-redirect]');
    if (!form) return;
    e.preventDefault();
    var emailInput = form.querySelector('input[type="email"]');
    var email = emailInput ? (emailInput.value || '').trim() : '';
    authRedirect(email);
  });

  // Sign-in "Create Account" button and any /account/register link → /account
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href="/account/register"], a[href="/account/login"]');
    if (!a) return;
    e.preventDefault();
    authRedirect('');
  });
})();
