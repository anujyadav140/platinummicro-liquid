/**
 * pm-lists-page.js — client-side dashboard for the /pages/lists page.
 *
 * Reads/writes the same localStorage store as pm-add-to-list.js
 * (`pm:lists:v1`). Two views, switched by URL hash:
 *
 *   - GRID  (default, no hash or unknown id) → cards for every saved list
 *           + dashed "New list" trailing tile.
 *   - DETAIL (#list_xxx) → one list's items with qty steppers and remove
 *            buttons + a top-bar "Delete list" affordance.
 *
 * UI states (mutually exclusive, server painted but flipped by JS):
 *   - empty-state (no lists at all and not currently creating)
 *   - create-panel (the inline form is open)
 *   - grid (≥1 lists, not creating, no detail hash)
 *   - detail (#list_xxx points to an existing list)
 *
 * Mutations dispatch `pm:lists-changed` on document so the header badge
 * and the Add-to-List popover stay in sync.
 */
(function () {
  'use strict';

  // ──────────────────────────── Store ───────────────────────────────
  // Mirror of the helpers in pm-add-to-list.js. Kept duplicated so each
  // page can be used independently if the other script isn't loaded.
  var STORAGE_KEY = 'pm:lists:v1';
  // Cap runaway storage — mirror pm-add-to-list.js so the dashboard can't bypass the guard.
  var MAX_LISTS = 50;

  function readStore() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (l) {
        return l && typeof l.id === 'string' && typeof l.name === 'string' && Array.isArray(l.items);
      });
    } catch (e) { return []; }
  }
  function writeStore(lists) {
    var ok = true;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lists)); } catch (e) { ok = false; }
    document.dispatchEvent(new CustomEvent('pm:lists-changed', { detail: { lists: lists } }));
    return ok;
  }
  function makeId() {
    return 'list_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function createList(name) {
    var lists = readStore();
    if (lists.length >= MAX_LISTS) return null;   // cap — keep the runaway-storage guard the PDP popover enforces
    var now = Date.now();
    var list = {
      id: makeId(),
      name: (name || '').trim() || 'Untitled list',
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    lists.push(list);
    list.saved = writeStore(lists);
    return list;
  }
  function renameList(id, nextName) {
    var trimmed = (nextName || '').trim();
    if (!trimmed) return;
    var lists = readStore();
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].id === id) {
        lists[i].name = trimmed;
        lists[i].updatedAt = Date.now();
        break;
      }
    }
    writeStore(lists);
  }
  function removeList(id) {
    var lists = readStore().filter(function (l) { return l.id !== id; });
    writeStore(lists);
  }
  function setItemQuantity(listId, sku, quantity) {
    var next = Math.max(1, Math.floor(quantity) || 1);
    var lists = readStore();
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].id !== listId) continue;
      for (var j = 0; j < lists[i].items.length; j++) {
        if (lists[i].items[j].sku === sku) lists[i].items[j].quantity = next;
      }
      lists[i].updatedAt = Date.now();
      break;
    }
    writeStore(lists);
  }
  function removeItemFromList(listId, sku) {
    var lists = readStore();
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].id !== listId) continue;
      lists[i].items = lists[i].items.filter(function (it) { return it.sku !== sku; });
      lists[i].updatedAt = Date.now();
      break;
    }
    writeStore(lists);
  }

  // ─────────────────────────── Helpers ──────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatUpdatedAt(ts) {
    var diff = Math.max(0, Date.now() - (ts || 0));
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    return d + 'd ago';
  }

  // ────────────────────────── Page root ─────────────────────────────
  var root = document.querySelector('.pm-lists');
  if (!root) return;

  var els = {
    empty:    root.querySelector('[data-pm-lists-empty]'),
    create:   root.querySelector('[data-pm-lists-create]'),
    createForm: root.querySelector('[data-pm-lists-create-form]'),
    createCancel: root.querySelector('[data-pm-lists-create-cancel]'),
    grid:     root.querySelector('[data-pm-lists-grid]'),
    detail:   root.querySelector('[data-pm-lists-detail]'),
    title:    root.querySelector('[data-pm-lists-title]'),
    lede:     root.querySelector('[data-pm-lists-lede]'),
    startCreate: root.querySelector('[data-pm-lists-start-create]'),
  };

  var state = { creating: false };

  // ─────────────────────────── Renderers ────────────────────────────
  function show(el, visible) {
    if (!el) return;
    if (visible) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  function activeListIdFromHash() {
    var h = (window.location.hash || '').replace(/^#/, '');
    return h.indexOf('list_') === 0 ? h : '';
  }

  function render() {
    var lists = readStore();
    var detailId = activeListIdFromHash();
    var detailList = detailId ? lists.filter(function (l) { return l.id === detailId; })[0] : null;

    // Detail view — drops both grid + empty-state + create panel.
    if (detailList) {
      els.title.textContent = detailList.name;
      els.lede.textContent  = detailList.items.length + ' ' + (detailList.items.length === 1 ? 'item' : 'items');
      show(els.empty, false);
      show(els.create, false);
      show(els.grid, false);
      show(els.detail, true);
      renderDetail(detailList);
      return;
    }

    // Reset header copy for the index view.
    els.title.textContent = 'Lists';
    els.lede.textContent  = 'Save BOMs, recurring carts, and shortlists. Add their items to your cart in one click.';

    show(els.detail, false);
    show(els.create, state.creating);
    show(els.empty, lists.length === 0 && !state.creating);
    show(els.grid, lists.length > 0 && !state.creating);

    if (lists.length > 0 && !state.creating) {
      renderGrid(lists);
    }
  }

  function renderGrid(lists) {
    var html = '';
    for (var i = 0; i < lists.length; i++) {
      var l = lists[i];
      var count = l.items.length;
      html +=
        '<article class="pm-lists__card" data-list-id="' + escapeHtml(l.id) + '">' +
          '<div class="pm-lists__card-head">' +
            '<svg class="pm-lists__card-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
            '<h3 class="pm-lists__card-name" data-name>' + escapeHtml(l.name) + '</h3>' +
          '</div>' +
          '<p class="pm-lists__card-meta" data-meta>' +
            count + ' ' + (count === 1 ? 'item' : 'items') + ' · Updated ' + escapeHtml(formatUpdatedAt(l.updatedAt)) +
          '</p>' +
          '<form class="pm-lists__rename" data-rename-form hidden>' +
            '<input type="text" class="pm-lists__rename-input" maxlength="64" value="' + escapeHtml(l.name) + '">' +
            '<button type="submit" class="pm-lists__btn pm-lists__btn--primary pm-lists__btn--sm">Save</button>' +
            '<button type="button" class="pm-lists__btn pm-lists__btn--ghost pm-lists__btn--sm" data-rename-cancel>Cancel</button>' +
          '</form>' +
          '<div class="pm-lists__card-actions">' +
            '<div>' +
              '<button type="button" class="pm-lists__link" data-action="rename">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
                'Rename' +
              '</button>' +
              '<span class="pm-lists__sep" aria-hidden="true">·</span>' +
              '<button type="button" class="pm-lists__link pm-lists__link--danger" data-action="delete">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>' +
                'Delete' +
              '</button>' +
            '</div>' +
            '<a href="#' + escapeHtml(l.id) + '" class="pm-lists__link pm-lists__link--open" data-action="open">' +
              'Open' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
            '</a>' +
          '</div>' +
        '</article>';
    }
    // Trailing dashed "New list" tile.
    html +=
      '<button type="button" class="pm-lists__new-tile" data-pm-lists-start-create>' +
        '<span class="pm-lists__new-tile-circle">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' +
        '</span>' +
        '<span class="pm-lists__new-tile-label">New list</span>' +
      '</button>';
    els.grid.innerHTML = html;
  }

  function renderDetail(list) {
    var itemsHtml = '';
    if (list.items.length === 0) {
      itemsHtml = '<div class="pm-lists__detail-empty">This list is empty. Add items from any product page.</div>';
    } else {
      itemsHtml = '<ul class="pm-lists__detail-list">';
      for (var i = 0; i < list.items.length; i++) {
        var it = list.items[i];
        itemsHtml +=
          '<li class="pm-lists__row" data-sku="' + escapeHtml(it.sku) + '">' +
            '<div class="pm-lists__row-img">' +
              (it.imageUrl
                ? '<img src="' + escapeHtml(it.imageUrl) + '" alt="">'
                : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>') +
            '</div>' +
            '<div class="pm-lists__row-main">' +
              (it.brand ? '<p class="pm-lists__row-brand">' + escapeHtml(it.brand) + '</p>' : '') +
              (it.href
                ? '<a class="pm-lists__row-name" href="' + escapeHtml(it.href) + '">' + escapeHtml(it.name) + '</a>'
                : '<span class="pm-lists__row-name">' + escapeHtml(it.name) + '</span>') +
              '<div class="pm-lists__row-meta">' +
                '<span>SKU: ' + escapeHtml(it.sku) + '</span>' +
                (it.unitPrice ? '<span class="pm-lists__row-price">' + escapeHtml(it.unitPrice) + '</span>' : '') +
              '</div>' +
            '</div>' +
            '<div class="pm-lists__row-controls">' +
              '<div class="pm-lists__qty">' +
                '<button type="button" data-act="dec" aria-label="Decrease quantity" ' + (it.quantity <= 1 ? 'disabled' : '') + '>−</button>' +
                '<span class="pm-lists__qty-val">' + it.quantity + '</span>' +
                '<button type="button" data-act="inc" aria-label="Increase quantity">+</button>' +
              '</div>' +
              '<button type="button" class="pm-lists__row-remove" data-act="remove" aria-label="Remove item">' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>' +
              '</button>' +
            '</div>' +
          '</li>';
      }
      itemsHtml += '</ul>';
    }

    els.detail.innerHTML =
      '<a href="#" class="pm-lists__back" data-pm-lists-back>' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>' +
        'All lists' +
      '</a>' +
      '<header class="pm-lists__detail-head">' +
        '<div>' +
          '<h2 class="pm-lists__detail-title">' + escapeHtml(list.name) + '</h2>' +
          '<p class="pm-lists__detail-meta">' + list.items.length + ' ' + (list.items.length === 1 ? 'item' : 'items') + '</p>' +
        '</div>' +
        '<button type="button" class="pm-lists__btn pm-lists__btn--danger-outline" data-pm-lists-delete>' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>' +
          'Delete list' +
        '</button>' +
      '</header>' +
      itemsHtml;
  }

  // ────────────────────────── Interactions ──────────────────────────
  function openCreate() {
    state.creating = true;
    render();
    var input = els.createForm && els.createForm.querySelector('input');
    if (input) { input.value = ''; input.focus(); }
    var submit = els.createForm && els.createForm.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
  }
  function closeCreate() {
    state.creating = false;
    render();
  }

  if (els.startCreate) els.startCreate.addEventListener('click', openCreate);
  if (els.createCancel) els.createCancel.addEventListener('click', closeCreate);

  if (els.createForm) {
    var input = els.createForm.querySelector('input');
    var submit = els.createForm.querySelector('button[type="submit"]');
    if (input && submit) {
      input.addEventListener('input', function () {
        submit.disabled = input.value.trim().length === 0;
      });
    }
    els.createForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input ? input.value.trim() : '';
      if (!v) return;
      var created = createList(v);
      if (!created) { window.alert('You can keep up to ' + MAX_LISTS + ' lists. Remove one to add another.'); return; }
      state.creating = false;
      render();
    });
  }

  // Grid clicks (rename / delete / open + dashed new-list tile)
  if (els.grid) {
    els.grid.addEventListener('click', function (e) {
      var newTile = e.target.closest('[data-pm-lists-start-create]');
      if (newTile) { openCreate(); return; }

      var card = e.target.closest('.pm-lists__card');
      if (!card) return;
      var listId = card.getAttribute('data-list-id');
      var act = e.target.closest('[data-action]');
      if (!act) return;
      var action = act.getAttribute('data-action');

      if (action === 'rename') {
        e.preventDefault();
        var form = card.querySelector('[data-rename-form]');
        var nameEl = card.querySelector('[data-name]');
        var metaEl = card.querySelector('[data-meta]');
        if (form && nameEl && metaEl) {
          form.removeAttribute('hidden');
          nameEl.style.display = 'none';
          metaEl.style.display = 'none';
          var inp = form.querySelector('input'); if (inp) { inp.focus(); inp.select(); }
        }
      } else if (action === 'delete') {
        e.preventDefault();
        var lists = readStore();
        var l = lists.filter(function (x) { return x.id === listId; })[0];
        if (!l) return;
        if (l.items.length > 0 && !confirm('Delete "' + l.name + '"? Its ' + l.items.length + ' item' + (l.items.length === 1 ? '' : 's') + ' will be removed.')) return;
        removeList(listId);
        render();
      }
      // "Open" is an <a href="#list_xxx"> so the browser handles it
      // — the hashchange listener below picks it up.
    });

    // Submit / cancel inline rename inside any card.
    els.grid.addEventListener('submit', function (e) {
      var form = e.target.closest('[data-rename-form]');
      if (!form) return;
      e.preventDefault();
      var card = form.closest('.pm-lists__card');
      if (!card) return;
      var listId = card.getAttribute('data-list-id');
      var next = form.querySelector('input').value.trim();
      if (!next) return;
      renameList(listId, next);
      render();
    });
    els.grid.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-rename-cancel]');
      if (!btn) return;
      render();
    });
  }

  // Detail interactions (qty steppers, remove item, delete list, back link)
  if (els.detail) {
    els.detail.addEventListener('click', function (e) {
      var detailId = activeListIdFromHash();
      if (!detailId) return;

      var back = e.target.closest('[data-pm-lists-back]');
      if (back) {
        e.preventDefault();
        window.location.hash = '';
        return;
      }
      var del = e.target.closest('[data-pm-lists-delete]');
      if (del) {
        var lists = readStore();
        var l = lists.filter(function (x) { return x.id === detailId; })[0];
        if (!l) return;
        if (l.items.length > 0 && !confirm('Delete "' + l.name + '"? This cannot be undone.')) return;
        removeList(detailId);
        window.location.hash = '';
        return;
      }
      var act = e.target.closest('[data-act]');
      var row = e.target.closest('.pm-lists__row');
      if (!act || !row) return;
      var sku = row.getAttribute('data-sku');
      var action = act.getAttribute('data-act');
      var lists2 = readStore();
      var l2 = lists2.filter(function (x) { return x.id === detailId; })[0];
      if (!l2) return;
      var it = l2.items.filter(function (x) { return x.sku === sku; })[0];
      if (!it) return;
      if (action === 'inc') setItemQuantity(detailId, sku, it.quantity + 1);
      else if (action === 'dec') setItemQuantity(detailId, sku, it.quantity - 1);
      else if (action === 'remove') removeItemFromList(detailId, sku);
      render();
    });
  }

  // Re-render on store changes (cross-tab + same-tab via custom event)
  document.addEventListener('pm:lists-changed', render);
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) render();
  });
  window.addEventListener('hashchange', render);

  // Initial paint
  render();
})();
