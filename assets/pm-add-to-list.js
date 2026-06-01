/**
 * PmAddToList — Hydrogen pm-add-to-list-menu.tsx ported to vanilla JS.
 *
 * What it does:
 *   - Maintains a localStorage-backed lists store under key `pm:lists:v1`
 *     (same shape + key as the Hydrogen storefront's pm-lists-store, so
 *     a future shared backend can read both).
 *   - Renders a single shared popover (appended to <body>) on first open
 *     to escape the PDP's stacking context. Reused for every trigger.
 *   - Trigger button is any element with `[data-pm-add-to-list-trigger]`
 *     carrying the product item attributes:
 *       data-item-sku, data-item-name, data-item-brand, data-item-image,
 *       data-item-price, data-item-href
 *     Quantity is read live from `#pm-pdp-qty` at click time.
 *   - When the SKU is already in any list, the trigger swaps its + icon
 *     for a filled star and its label to "In Your List" (visual cue).
 *   - Dedupe on add: same SKU → existing row's qty bumps by the new qty.
 *
 * Public events: dispatches `pm:lists-changed` on document after every
 * mutation so other surfaces (header counter, /account/lists) can refresh.
 */
(function () {
  'use strict';

  // ───────────────────────────── Store ──────────────────────────────
  var STORAGE_KEY = 'pm:lists:v1';

  // ──────────────────────── Auth gate + resume ──────────────────────────
  // Lists require a signed-in customer. When a guest clicks "Add to List"
  // we stash the product, scroll to the top, and open Shopify's sign-in
  // popup (the same one the header trigger opens). Shopify's hosted auth
  // returns the visitor to this product page; on load we detect the stashed
  // intent and re-open the list popover for that product so they can pick a
  // list. Intent lives in localStorage with a short TTL so a stale click
  // never resurfaces days later.
  var PENDING_KEY = 'pm:lists:pending:v1';
  var PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes

  function isSignedIn() {
    return !!(document.body && document.body.getAttribute('data-pm-customer'));
  }

  function stashPending(sku) {
    try {
      window.localStorage.setItem(PENDING_KEY, JSON.stringify({
        sku: sku,
        href: window.location.pathname + window.location.search,
        ts: Date.now(),
      }));
    } catch (e) { /* private mode — resume just won't fire */ }
  }

  function readPending() {
    try {
      var raw = window.localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || !p.sku) return null;
      if (Date.now() - (p.ts || 0) > PENDING_TTL_MS) { clearPending(); return null; }
      return p;
    } catch (e) { return null; }
  }

  function clearPending() {
    try { window.localStorage.removeItem(PENDING_KEY); } catch (e) {}
  }

  // Scroll to top and trigger Shopify's <shopify-account> sign-in popup.
  function routeToSignIn() {
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    var sa = document.querySelector('shopify-account.pm-header__shopify-account');
    if (!sa) { window.location.href = '/account'; return; }
    var avatar = sa.querySelector('[slot="signed-out-avatar"]') || sa;
    // Let the smooth-scroll start, then open the popup so it pins to the
    // (sticky) header trigger in view.
    setTimeout(function () { avatar.click(); }, 80);
  }

  // After returning from sign-in, re-open the list popover for the stashed
  // product if its trigger is on this page.
  function resumePending() {
    if (!isSignedIn()) return;
    var p = readPending();
    if (!p) return;
    var sel = '[data-pm-add-to-list-trigger][data-item-sku="' +
      ((window.CSS && CSS.escape) ? CSS.escape(p.sku) : p.sku.replace(/"/g, '\\"')) + '"]';
    var trigger = document.querySelector(sel);
    if (!trigger) return; // not on the matching product page yet — keep intent
    clearPending();
    setTimeout(function () {
      try { trigger.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      setTimeout(function () { openPopover(trigger); }, 400);
    }, 200);
  }

  function readStore() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Light shape check — drop malformed entries silently.
      return parsed.filter(function (l) {
        return l && typeof l.id === 'string' && typeof l.name === 'string' && Array.isArray(l.items);
      });
    } catch (e) {
      return [];
    }
  }

  function writeStore(lists) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
    } catch (e) {
      // Quota / private-mode Safari — let the session see the change in
      // memory; we just can't persist.
    }
    document.dispatchEvent(new CustomEvent('pm:lists-changed', { detail: { lists: lists } }));
  }

  function makeId() {
    return 'list_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function createList(name) {
    var lists = readStore();
    var now = Date.now();
    var list = {
      id: makeId(),
      name: (name || '').trim() || 'Untitled list',
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    lists.push(list);
    writeStore(lists);
    return list;
  }

  function addItemToList(listId, item) {
    var lists = readStore();
    var now = Date.now();
    var qty = Math.max(1, Math.floor(item.quantity) || 1);
    for (var i = 0; i < lists.length; i++) {
      var l = lists[i];
      if (l.id !== listId) continue;
      // Dedupe by SKU — same SKU bumps qty instead of duplicating.
      var found = null;
      for (var j = 0; j < l.items.length; j++) {
        if (l.items[j].sku === item.sku) { found = l.items[j]; break; }
      }
      if (found) {
        found.quantity = (found.quantity || 1) + qty;
      } else {
        l.items.push({
          sku: item.sku,
          name: item.name,
          brand: item.brand || undefined,
          imageUrl: item.imageUrl || undefined,
          unitPrice: item.unitPrice || undefined,
          quantity: qty,
          href: item.href || undefined,
          addedAt: now,
        });
      }
      l.updatedAt = now;
      break;
    }
    writeStore(lists);
  }

  function isSkuInAnyList(sku) {
    if (!sku) return false;
    var lists = readStore();
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].items.length; j++) {
        if (lists[i].items[j].sku === sku) return true;
      }
    }
    return false;
  }

  // Is this SKU present in this specific list?
  function isSkuInList(listId, sku) {
    if (!sku || !listId) return false;
    var lists = readStore();
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].id !== listId) continue;
      for (var j = 0; j < lists[i].items.length; j++) {
        if (lists[i].items[j].sku === sku) return true;
      }
      return false;
    }
    return false;
  }

  // Drop a single SKU from a specific list.
  function removeItemFromList(listId, sku) {
    if (!listId || !sku) return;
    var lists = readStore();
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].id !== listId) continue;
      lists[i].items = lists[i].items.filter(function (it) { return it.sku !== sku; });
      lists[i].updatedAt = Date.now();
      break;
    }
    writeStore(lists);
  }

  // ─────────────────────────── Helpers ─────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readItemFromTrigger(trigger) {
    var qtyEl = document.getElementById('pm-pdp-qty');
    var qty = qtyEl ? Math.max(1, parseInt(qtyEl.value, 10) || 1) : 1;
    return {
      sku:       trigger.getAttribute('data-item-sku')   || '',
      name:      trigger.getAttribute('data-item-name')  || '',
      brand:     trigger.getAttribute('data-item-brand') || '',
      imageUrl:  trigger.getAttribute('data-item-image') || '',
      unitPrice: trigger.getAttribute('data-item-price') || '',
      href:      trigger.getAttribute('data-item-href')  || '',
      quantity:  qty,
    };
  }

  // ───────────────────────── Trigger sync ──────────────────────────
  // Mirror the SKU-in-any-list state into trigger appearance: when an
  // item the trigger represents is already in some list, swap the +
  // for a filled star and the label to "In Your List". Runs on load,
  // after every mutation, and after any popover close.
  function syncTrigger(trigger) {
    var sku = trigger.getAttribute('data-item-sku');
    var inList = isSkuInAnyList(sku);
    trigger.classList.toggle('is-in-list', inList);
    var label = trigger.querySelector('[data-pm-add-to-list-label]');
    var defaultLabel = trigger.getAttribute('data-default-label') || 'Add to List';
    if (label) label.textContent = inList ? 'In Your List' : defaultLabel;
    var iconPlus = trigger.querySelector('[data-pm-add-icon-plus]');
    var iconStar = trigger.querySelector('[data-pm-add-icon-star]');
    if (iconPlus) iconPlus.style.display = inList ? 'none' : '';
    if (iconStar) iconStar.style.display = inList ? '' : 'none';
  }

  function syncAllTriggers() {
    document.querySelectorAll('[data-pm-add-to-list-trigger]').forEach(syncTrigger);
  }

  // ───────────────────────────── Popover ────────────────────────────
  var POPOVER_WIDTH = 300;
  var ADDED_FLASH_MS = 800;
  var popover = null;
  var currentTrigger = null;
  // Track the last list the user mutated + which way it went, so the
  // popover can flash "Added" / "Removed" briefly on that row.
  var recentlyChangedListId = null;
  var recentlyChangedAction = null; // 'added' | 'removed' | null

  function ensurePopover() {
    if (popover) return popover;
    popover = document.createElement('div');
    popover.className = 'pm-list-popover';
    popover.setAttribute('role', 'menu');
    popover.innerHTML =
      '<div class="pm-list-popover__head">' +
        '<div class="pm-list-popover__eyebrow">Add to a list</div>' +
      '</div>' +
      '<div class="pm-list-popover__body" data-popover-body></div>' +
      '<div class="pm-list-popover__footer" data-popover-footer></div>';
    document.body.appendChild(popover);
    return popover;
  }

  function positionPopover() {
    if (!popover || !currentTrigger) return;
    var rect = currentTrigger.getBoundingClientRect();
    var vw = window.innerWidth;
    var width = Math.min(POPOVER_WIDTH, vw - 16);
    var top = rect.bottom + 8;
    var left = Math.max(8, rect.right - width);
    popover.style.width = width + 'px';
    popover.style.top  = top + 'px';
    popover.style.left = left + 'px';
  }

  function renderPopoverBody() {
    var body = popover.querySelector('[data-popover-body]');
    var lists = readStore();
    if (lists.length === 0) {
      body.className = 'pm-list-popover__body pm-list-popover__body--empty';
      body.innerHTML = 'No saved lists yet. Create one below to get started.';
      return;
    }
    body.className = 'pm-list-popover__body';
    // Look up the trigger's SKU once so each row knows whether it
    // already contains this product. That decides both the trailing
    // icon (plus vs. check) AND the click action (add vs. remove).
    var triggerSku = currentTrigger ? currentTrigger.getAttribute('data-item-sku') || '' : '';
    var html = '<ul class="pm-list-popover__list">';
    for (var i = 0; i < lists.length; i++) {
      var l = lists[i];
      var justChanged = recentlyChangedListId === l.id;
      var inThisList = isSkuInList(l.id, triggerSku);
      var count = l.items.length;

      // Trailing slot: shows "Added" / "Removed" flash after a click,
      // otherwise a check (if the SKU is already in this list) or a
      // plus (if it's not).
      var trailing;
      if (justChanged) {
        trailing =
          '<span class="pm-list-popover__added">' +
            (recentlyChangedAction === 'removed'
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>Removed'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Added') +
          '</span>';
      } else if (inThisList) {
        trailing =
          '<span class="pm-list-popover__check" aria-label="In this list — click to remove">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' +
          '</span>';
      } else {
        trailing =
          '<svg class="pm-list-popover__item-plus" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>';
      }

      html +=
        '<li>' +
          '<button type="button" ' +
            'class="pm-list-popover__item' + (inThisList ? ' is-in-list' : '') + '" ' +
            'data-list-id="' + escapeHtml(l.id) + '" ' +
            'data-in-list="' + (inThisList ? '1' : '0') + '" ' +
            'title="' + (inThisList ? 'Click to remove from this list' : 'Click to add to this list') + '"' +
          '>' +
            '<span class="pm-list-popover__item-main">' +
              '<span class="pm-list-popover__item-name">' + escapeHtml(l.name) + '</span>' +
              '<span class="pm-list-popover__item-count">' + count + ' ' + (count === 1 ? 'item' : 'items') + '</span>' +
            '</span>' +
            trailing +
          '</button>' +
        '</li>';
    }
    html += '</ul>';
    body.innerHTML = html;
  }

  function renderPopoverFooter(creating) {
    var footer = popover.querySelector('[data-popover-footer]');
    if (creating) {
      footer.innerHTML =
        '<form class="pm-list-popover__form" data-create-form>' +
          '<input ' +
            'type="text" name="listName" maxlength="64" ' +
            'class="pm-list-popover__input" ' +
            'placeholder="List name (e.g. Server build)" ' +
            'autocomplete="off"' +
          '>' +
          '<div class="pm-list-popover__form-actions">' +
            '<button type="button" class="pm-list-popover__btn pm-list-popover__btn--ghost" data-cancel-create>Cancel</button>' +
            '<button type="submit" class="pm-list-popover__btn pm-list-popover__btn--primary" disabled>' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>' +
              'Create &amp; add' +
            '</button>' +
          '</div>' +
        '</form>';
      var form = footer.querySelector('[data-create-form]');
      var input = form.querySelector('input');
      var submit = form.querySelector('button[type="submit"]');
      input.focus();
      input.addEventListener('input', function () {
        submit.disabled = input.value.trim().length === 0;
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var trimmed = input.value.trim();
        if (!trimmed) return;
        var newList = createList(trimmed);
        if (currentTrigger) {
          var item = readItemFromTrigger(currentTrigger);
          if (item.sku) addItemToList(newList.id, item);
        }
        flashChange(newList.id, 'added');
      });
      footer.querySelector('[data-cancel-create]').addEventListener('click', function () {
        renderPopoverFooter(false);
      });
    } else {
      footer.innerHTML =
        '<button type="button" class="pm-list-popover__create" data-start-create>' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>' +
          'Create new list' +
        '</button>';
      footer.querySelector('[data-start-create]').addEventListener('click', function () {
        renderPopoverFooter(true);
      });
    }
  }

  // Flash the row + auto-close. action: 'added' | 'removed'.
  function flashChange(listId, action) {
    recentlyChangedListId = listId;
    recentlyChangedAction = action;
    renderPopoverBody();
    renderPopoverFooter(false);
    syncAllTriggers();
    setTimeout(function () {
      recentlyChangedListId = null;
      recentlyChangedAction = null;
      closePopover();
    }, ADDED_FLASH_MS);
  }

  function openPopover(trigger) {
    ensurePopover();
    currentTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    renderPopoverBody();
    renderPopoverFooter(false);
    popover.classList.add('is-open');
    positionPopover();
  }

  function closePopover() {
    if (!popover) return;
    popover.classList.remove('is-open');
    if (currentTrigger) currentTrigger.setAttribute('aria-expanded', 'false');
    currentTrigger = null;
    recentlyChangedListId = null;
    recentlyChangedAction = null;
  }

  // ──────────────────────────── Wiring ──────────────────────────────
  // Trigger toggle
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-pm-add-to-list-trigger]');
    if (t) {
      e.preventDefault();
      e.stopPropagation();
      // Lists are gated behind sign-in. A guest who tries to add gets
      // stashed + routed to the sign-in popup; resumePending() re-opens
      // this popover for them once they're back and authenticated.
      if (!isSignedIn()) {
        stashPending(t.getAttribute('data-item-sku') || '');
        routeToSignIn();
        return;
      }
      if (currentTrigger === t && popover && popover.classList.contains('is-open')) {
        closePopover();
      } else {
        openPopover(t);
      }
      return;
    }
    // List-row click → TOGGLE this product in that list. If the SKU
    // is already present we remove it; if not, we add it. Visual cue
    // is the check icon next to the list name (rendered by
    // renderPopoverBody when isSkuInList returns true).
    if (popover && popover.classList.contains('is-open')) {
      var row = e.target.closest('.pm-list-popover__item');
      if (row && currentTrigger) {
        e.preventDefault();
        var listId = row.getAttribute('data-list-id');
        var inList = row.getAttribute('data-in-list') === '1';
        var item = readItemFromTrigger(currentTrigger);
        if (!item.sku) return;
        if (inList) {
          removeItemFromList(listId, item.sku);
          flashChange(listId, 'removed');
        } else {
          addItemToList(listId, item);
          flashChange(listId, 'added');
        }
      }
    }
  });

  // Click-outside to close
  document.addEventListener('mousedown', function (e) {
    if (!popover || !popover.classList.contains('is-open')) return;
    if (popover.contains(e.target)) return;
    if (currentTrigger && currentTrigger.contains(e.target)) return;
    closePopover();
  });

  // Escape to close
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && popover && popover.classList.contains('is-open')) {
      closePopover();
    }
  });

  // Reposition on scroll/resize while open
  window.addEventListener('scroll', function () { if (popover && popover.classList.contains('is-open')) positionPopover(); }, true);
  window.addEventListener('resize', function () { if (popover && popover.classList.contains('is-open')) positionPopover(); });

  // ───────────────────────── Header badge ──────────────────────────
  // Reflect the current list count on the header's Lists button. The
  // badge element is rendered server-side in pm-header.liquid; we just
  // toggle its hidden state + update the number on every store change.
  function syncHeaderBadge() {
    var badge = document.querySelector('[data-pm-header-lists-badge]');
    if (!badge) return;
    var count = readStore().length;
    if (count > 0) {
      badge.textContent = String(count);
      badge.removeAttribute('hidden');
    } else {
      badge.setAttribute('hidden', '');
    }
  }

  function syncAll() {
    syncAllTriggers();
    syncHeaderBadge();
  }

  // State stays in sync with the store across all surfaces.
  document.addEventListener('pm:lists-changed', syncAll);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { syncAll(); resumePending(); });
  } else {
    syncAll();
    resumePending();
  }

  // Cross-tab sync (storage event)
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      syncAll();
      if (popover && popover.classList.contains('is-open')) {
        renderPopoverBody();
      }
    }
  });
})();
