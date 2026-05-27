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
      if (hidden) {
        hidden.value = val;
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
  function onUpdate() {
    restoreViewMode();
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
