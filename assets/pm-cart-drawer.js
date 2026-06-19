/**
 * PmCart — slide-out cart drawer.
 * Mirrors Hydrogen's PmCartDrawer.
 */
(function () {
  'use strict';

  var drawer, itemsEl, emptyEl, footEl, countEl, clearBtn, template;
  var inited = false;
  var debounceTimer = null;
  // TC-085: cart line key → real available cap, learned when the server caps a
  // requested qty (the drawer's /cart.js data doesn't expose inventory).
  var maxedCap = {};
  // Per-line qty stepper state — robust against rapid-click races.
  var qPending = {}, qInflight = {}, qTimers = {};
  // TC-085: dedupe the "max stock reached" toast — rapid +/- spam can fire the
  // cap branch many times; show at most one toast per STOCK_TOAST_GAP ms.
  var lastStockToastAt = 0;
  var STOCK_TOAST_GAP = 3000;

  function init() {
    if (inited) return;
    drawer    = document.getElementById('pm-cart-drawer');
    itemsEl   = document.getElementById('pm-cart-items');
    emptyEl   = document.getElementById('pm-cart-empty');
    footEl    = document.getElementById('pm-cart-foot');
    countEl   = document.getElementById('pm-cart-count');
    clearBtn  = document.getElementById('pm-cart-clear');
    template  = document.getElementById('pm-cart-item-template');
    if (!drawer || !template) return;

    drawer.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-cart-close') || e.target.closest('[data-cart-close]')) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !drawer.hasAttribute('aria-hidden')) close();
    });

    // Cart trigger buttons
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-cart-open]');
      if (trigger) {
        e.preventDefault();
        refresh().then(open);
        return;
      }
    });

    // Quantity controls
    itemsEl.addEventListener('click', function (e) {
      var item = e.target.closest('[data-cart-item]');
      if (!item) return;
      var key = item.getAttribute('data-cart-key');
      var isQuote = item.getAttribute('data-cart-kind') === 'quote';
      var input = item.querySelector('.pm-cart__qty-input');
      var curr = parseInt(input.value, 10) || 0;
      if (e.target.closest('[data-cart-inc]'))
        isQuote ? updateQuote(key, curr + 1) : updateLine(key, curr + 1);
      else if (e.target.closest('[data-cart-dec]'))
        isQuote ? updateQuote(key, Math.max(0, curr - 1)) : updateLine(key, Math.max(0, curr - 1));
      else if (e.target.closest('[data-cart-remove]'))
        isQuote ? removeQuote(key) : removeLine(key);
    });
    itemsEl.addEventListener('change', function (e) {
      var input = e.target.closest('.pm-cart__qty-input');
      if (!input) return;
      var item = e.target.closest('[data-cart-item]');
      var key  = item.getAttribute('data-cart-key');
      var isQuote = item.getAttribute('data-cart-kind') === 'quote';
      var qty  = parseInt(input.value, 10);
      if (isNaN(qty) || qty < 0) qty = 0;
      if (isQuote) {
        if (qty === 0) removeQuote(key); else updateQuote(key, qty);
      } else {
        if (qty === 0) removeLine(key); else updateLine(key, qty);
      }
    });

    clearBtn.addEventListener('click', function () {
      if (window.PmQuote) window.PmQuote.clear();
      fetch('/cart/clear.js', { method: 'POST' })
        .then(function () { document.dispatchEvent(new CustomEvent('pm:cart-changed')); });
    });

    // Listen for external cart changes
    document.addEventListener('pm:cart-changed', function (e) {
      var src = (e && e.detail && e.detail.source) || '';
      refresh().then(function () {
        // Auto-open the drawer only after a genuine add-to-cart action (product
        // card, PDP, or quick-order). Quote edits, cart clears, and cross-tab
        // storage syncs reconcile the badge silently without popping the drawer.
        if (src === 'pcard' || src === 'pdp' || src === 'quick-order') open();
      });
    });

    inited = true;

    // Initial fetch (don't open)
    refresh();
  }

  function open() {
    drawer.removeAttribute('aria-hidden');
    drawer.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    // a11y: move focus into the drawer + trap Tab within it (recomputes the
    // focusable set each Tab, so client-rendered cart lines are included).
    if (window.PmFocusTrap) PmFocusTrap.trap(drawer);
  }

  function close() {
    drawer.setAttribute('aria-hidden', 'true');
    drawer.classList.remove('is-open');
    document.body.style.overflow = '';
    if (window.PmFocusTrap) PmFocusTrap.release(); // restore focus to the opener
  }

  function refresh() {
    return fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) { render(cart); return cart; })
      .catch(function () {});
  }

  // Update EVERY cart badge on the page (header + mobile-nav) in one shot.
  // There are multiple [data-cart-badge] hooks now, so a single querySelector
  // would leave the others stale (e.g. mobile showing 3 while header shows 5).
  function setAllBadges(total) {
    document.querySelectorAll('[data-cart-badge]').forEach(function (b) {
      if (total > 0) {
        b.textContent = total;
        b.removeAttribute('hidden');
      } else {
        b.setAttribute('hidden', '');
      }
    });
  }

  function render(cart) {
    var shopifyItems = (cart && cart.items) ? cart.items : [];
    var quoteItems   = (window.PmQuote && window.PmQuote.list) ? window.PmQuote.list() : [];

    var shopifyLines = shopifyItems.length;
    var quoteLines   = quoteItems.length;
    var totalLines   = shopifyLines + quoteLines;
    var shopifyQty   = shopifyItems.reduce(function (a, i) { return a + (i.quantity || 0); }, 0);
    var quoteQty     = quoteItems.reduce(function (a, i) { return a + (i.quantity || 0); }, 0);
    var totalQty     = shopifyQty + quoteQty;

    countEl.textContent = totalLines === 1
      ? '1 item · ' + totalQty + ' unit' + (totalQty === 1 ? '' : 's')
      : totalLines + ' items · ' + totalQty + ' units';

    // Cart badges count BOTH the Shopify cart and local quote items.
    setAllBadges(totalLines);

    itemsEl.innerHTML = '';

    if (totalLines === 0) {
      emptyEl.removeAttribute('hidden');
      itemsEl.setAttribute('hidden', '');
      footEl.setAttribute('hidden', '');
      return;
    }

    emptyEl.setAttribute('hidden', '');
    itemsEl.removeAttribute('hidden');
    footEl.removeAttribute('hidden');

    shopifyItems.forEach(function (item) {
      var node = buildLineNode({
        key:        item.key,
        kind:       'shopify',
        variantId:  item.variant_id,
        url:        item.url,
        title:      item.product_title || item.title,
        imageUrl:   item.image,
        sku:        item.sku,
        lineTotal:  formatMoney(item.line_price || item.price * item.quantity),
        quantity:   item.quantity,
      });
      itemsEl.appendChild(node);
    });

    quoteItems.forEach(function (q) {
      var lineCents = (typeof q.priceCents === 'number' && !isNaN(q.priceCents))
        ? q.priceCents * (q.quantity || 1) : null;
      var node = buildLineNode({
        key:        q.sku,
        kind:       'quote',
        url:        q.href || '#',
        title:      q.name,
        imageUrl:   q.imageUrl,
        sku:        q.sku,
        lineTotal:  lineCents != null ? formatMoney(lineCents) : (q.unitPrice || ''),
        quantity:   q.quantity,
      });
      itemsEl.appendChild(node);
    });
  }

  // Shared line-node builder used by both Shopify cart lines and local
  // quote items. The QUOTE pill + class are applied when kind==='quote'.
  function buildLineNode(opts) {
    var node = template.content.firstElementChild.cloneNode(true);
    node.setAttribute('data-cart-key', opts.key);
    node.setAttribute('data-cart-kind', opts.kind);
    if (opts.kind === 'quote') {
      node.classList.add('pm-cart__item--quote');
      var main = node.querySelector('.pm-cart__item-main');
      if (main && !main.querySelector('.pm-cart__item-quote-pill')) {
        var pill = document.createElement('span');
        pill.className = 'pm-cart__item-quote-pill';
        pill.textContent = 'Quote';
        // Insert at top of main column so it sits above the name.
        main.insertBefore(pill, main.firstChild);
      }
    }

    var imgLink  = node.querySelector('[data-cart-link].pm-cart__item-img');
    var nameLink = node.querySelector('[data-cart-link].pm-cart__item-name');
    imgLink.setAttribute('href', opts.url || '#');
    nameLink.setAttribute('href', opts.url || '#');
    nameLink.textContent = opts.title || '';

    var img = node.querySelector('img');
    if (opts.imageUrl) {
      img.src = String(opts.imageUrl).replace(/\.(jpg|jpeg|png|webp)/i, '_120x120.$1');
      img.alt = opts.title || '';
    } else {
      img.remove();
    }

    var skuEl = node.querySelector('.pm-cart__item-sku');
    var dotEl = node.querySelector('.pm-cart__item-dot');
    if (opts.sku) {
      skuEl.textContent = opts.sku;
    } else {
      skuEl.remove();
      dotEl.remove();
    }

    node.querySelector('.pm-cart__item-price').textContent = opts.lineTotal || '';
    node.querySelector('.pm-cart__qty-input').value = opts.quantity || 1;

    // TC-085: disable + when this line is at its available cap. Prefer the cap
    // learned reactively from a capped change; fall back to the cap stashed from
    // PDP/collection data-max-qty so + is disabled UP FRONT (not after a click).
    if (opts.kind === 'shopify') {
      var cap = maxedCap[opts.key];
      if (typeof cap !== 'number' && window.PmAddToCart && window.PmAddToCart.getCap) {
        var _g = window.PmAddToCart.getCap(opts.variantId);
        if (typeof _g === 'number') cap = _g;
      }
      if (typeof cap === 'number' && cap >= 1) node.setAttribute('data-cart-cap', cap);
      var incBtn = node.querySelector('[data-cart-inc]');
      if (incBtn && typeof cap === 'number' && cap >= 1 && (opts.quantity || 1) >= cap) {
        incBtn.disabled = true;
        incBtn.setAttribute('aria-disabled', 'true');
        incBtn.setAttribute('title', 'No more available in stock');
      }
    }

    return node;
  }

  // ── Quote line mutations — go through PmQuote, not Shopify ──
  // Brief toast when a quote write is rejected (quota / private mode). The store
  // re-dispatches pm:cart-changed regardless, so the optimistic row self-reverts
  // on the next refresh — this just tells the buyer why it bounced back.
  function showSaveError() {
    var toast = document.createElement('div');
    toast.className = 'pm-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      '<div class="pm-toast__body"><div class="pm-toast__title">Couldn’t save</div><div class="pm-toast__lead">Your browser storage may be full.</div></div>' +
      '<button type="button" class="pm-toast__close" aria-label="Dismiss"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
    document.body.appendChild(toast);
    function dismiss() { toast.classList.add('is-leaving'); setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 220); }
    toast.querySelector('.pm-toast__close').addEventListener('click', dismiss);
    setTimeout(dismiss, 4200);
  }

  function updateQuote(sku, qty) {
    var li = itemsEl.querySelector('[data-cart-item][data-cart-key="' + cssEscape(sku) + '"]');
    if (li) li.querySelector('.pm-cart__qty-input').value = qty;
    optimisticHeader();
    if (window.PmQuote && window.PmQuote.setQuantity(sku, qty) === false) showSaveError();
    // refresh()/render is triggered by pm:cart-changed event the store fires.
  }

  function removeQuote(sku) {
    var li = itemsEl.querySelector('[data-cart-item][data-cart-key="' + cssEscape(sku) + '"]');
    if (li) {
      li.style.transition = 'opacity 120ms, max-height 180ms 60ms, padding 180ms 60ms, margin 180ms 60ms';
      li.style.maxHeight = li.offsetHeight + 'px';
      requestAnimationFrame(function () {
        li.style.opacity = '0';
        li.style.maxHeight = '0';
        li.style.paddingTop = '0';
        li.style.paddingBottom = '0';
        li.style.marginTop = '0';
        li.style.marginBottom = '0';
        li.style.overflow = 'hidden';
      });
      setTimeout(function () { if (li.parentNode) li.parentNode.removeChild(li); optimisticHeader(); }, 220);
    }
    if (li) li.querySelector('.pm-cart__qty-input').value = 0;
    optimisticHeader();
    if (window.PmQuote && window.PmQuote.remove(sku) === false) showSaveError();
  }

  // Minimal CSS.escape polyfill so a SKU containing `.` / `:` in a
  // selector doesn't trip the attribute-value matcher.
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return '\\' + c;
    });
  }

  function optimisticHeader() {
    // Recompute counts from what's currently rendered and update the
    // drawer heading + the header badge — no network needed.
    var items = itemsEl.querySelectorAll('[data-cart-item]');
    var totalItems = items.length;
    var totalQty = 0;
    items.forEach(function (li) {
      var n = parseInt(li.querySelector('.pm-cart__qty-input').value, 10);
      if (!isNaN(n)) totalQty += n;
    });
    if (countEl) {
      countEl.textContent = totalItems === 1
        ? '1 item · ' + totalQty + ' unit' + (totalQty === 1 ? '' : 's')
        : totalItems + ' items · ' + totalQty + ' units';
    }
    setAllBadges(totalItems);
    // If the cart is now empty, swap to empty state immediately.
    if (totalItems === 0) {
      itemsEl.setAttribute('hidden', '');
      footEl.setAttribute('hidden', '');
      if (emptyEl) emptyEl.removeAttribute('hidden');
    }
  }

  function applyDrawerCart(cart) {
    render(cart);
    if (window.PmAddToCart && window.PmAddToCart.syncMaxed) window.PmAddToCart.syncMaxed();
  }

  // Send a line's latest pending qty to Shopify. One request per line at a time
  // (qInflight); when it returns, if the user kept clicking (qPending moved on)
  // we send the NEWER value instead of rendering this now-stale response — that
  // is what stops the number bouncing (e.g. 14→18→15) during rapid +/- spam.
  function flushLine(key) {
    if (qInflight[key]) return;
    var sent = qPending[key];
    if (sent == null) return;
    qInflight[key] = true;
    fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: key, quantity: sent })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        qInflight[key] = false;
        function settle(cart) {
          var ln = (cart.items || []).filter(function (i) { return i.key === key; })[0];
          var got = ln ? ln.quantity : 0;
          if (got < sent) {
            maxedCap[key] = got;
            // Hit the stock ceiling — tell the user, but at most once per
            // STOCK_TOAST_GAP ms so rapid +/- spam can't flood the screen.
            var now = Date.now();
            if (now - lastStockToastAt > STOCK_TOAST_GAP) {
              lastStockToastAt = now;
              var rawName = (ln && (ln.product_title || ln.title)) || '';
              var name = rawName.length > 42 ? rawName.slice(0, 41).trim() + '…' : rawName;
              var msg = (name ? name + ' — ' : '') +
                'only ' + got + ' in stock, that\'s the most you can add.';
              showStockToast(msg);
            }
          } else delete maxedCap[key];
          // User kept clicking while this was in flight → send the newest value.
          if (qPending[key] !== sent && qPending[key] != null) { flushLine(key); return; }
          qPending[key] = got;            // settle on the server's (capped) value
          applyDrawerCart(cart);
        }
        if (res.ok && res.body && res.body.items) settle(res.body);
        else {
          // 422 over-cap (no body) → re-sync from the authoritative cart so the
          // other lines don't vanish; learn the real cap.
          fetch('/cart.js', { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.json(); }).then(settle).catch(function () {});
        }
      })
      .catch(function () { qInflight[key] = false; });
  }

  // TC-085: "max available stock" toast. Reuses the shared .pm-toast component
  // (see maybeWelcome() in pm-plp.js) so it matches the rest of the site. No
  // warn modifier exists in CSS, so we use the BASE .pm-toast and tint the left
  // border + icon with the brand terracotta accent inline. Auto-dismisses after
  // a few seconds; the close button dismisses early. Calls are deduped upstream.
  function showStockToast(msg) {
    var ACCENT = '#A63D2F'; // brand terracotta
    var toast = document.createElement('div');
    toast.className = 'pm-toast';
    toast.setAttribute('role', 'status');
    toast.style.borderLeftColor = ACCENT;
    toast.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:' + ACCENT + ';flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      '<div class="pm-toast__body">' +
        '<div class="pm-toast__title">Maximum stock reached</div>' +
        '<div class="pm-toast__lead"></div>' +
      '</div>' +
      '<button type="button" class="pm-toast__close" aria-label="Dismiss">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>';
    // Set the message via textContent so a product name can't inject markup.
    toast.querySelector('.pm-toast__lead').textContent = msg;
    document.body.appendChild(toast);
    function dismiss() {
      toast.classList.add('is-leaving');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 220);
    }
    toast.querySelector('.pm-toast__close').addEventListener('click', dismiss);
    setTimeout(dismiss, 4200);
  }

  function updateLine(key, qty) {
    // Clamp the optimistic value to a known cap so it can't shoot past stock.
    var li = itemsEl.querySelector('[data-cart-item][data-cart-key="' + key + '"]');
    var cap = li ? parseInt(li.getAttribute('data-cart-cap'), 10) : NaN;
    if (!isNaN(cap) && cap >= 1 && qty > cap) qty = cap;
    if (typeof maxedCap[key] === 'number' && qty > maxedCap[key]) qty = maxedCap[key];
    qPending[key] = qty;
    if (li) li.querySelector('.pm-cart__qty-input').value = qty; // optimistic
    optimisticHeader();
    clearTimeout(qTimers[key]);
    qTimers[key] = setTimeout(function () { flushLine(key); }, 220);
  }

  function removeLine(key) {
    // Pure optimistic: pull the row out of the DOM right now, update
    // header/badge from what's left, fire delete in the background.
    var li = itemsEl.querySelector('[data-cart-item][data-cart-key="' + key + '"]');
    if (li) {
      li.style.transition = 'opacity 120ms, max-height 180ms 60ms, padding 180ms 60ms, margin 180ms 60ms';
      li.style.maxHeight = li.offsetHeight + 'px';
      // Next frame: collapse
      requestAnimationFrame(function () {
        li.style.opacity = '0';
        li.style.maxHeight = '0';
        li.style.paddingTop = '0';
        li.style.paddingBottom = '0';
        li.style.marginTop = '0';
        li.style.marginBottom = '0';
        li.style.overflow = 'hidden';
      });
      setTimeout(function () { if (li.parentNode) li.parentNode.removeChild(li); optimisticHeader(); }, 220);
    }
    // Update header immediately too (don't wait for the animation)
    if (li) li.querySelector('.pm-cart__qty-input').value = 0;
    optimisticHeader();
    // Fire delete request — no debounce, no waiting
    fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: key, quantity: 0 })
    })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        // Sync silently in case another tab modified the cart concurrently
        var stillThere = itemsEl.querySelector('[data-cart-item][data-cart-key="' + key + '"]');
        if (cart.items && stillThere) render(cart);
        // Re-evaluate add buttons (e.g. re-enable a PDP "Already in cart" button
        // once its product is removed from the cart).
        if (window.PmAddToCart && window.PmAddToCart.syncMaxed) window.PmAddToCart.syncMaxed();
      })
      .catch(function () {});
  }

  function formatMoney(cents) {
    if (cents == null) return '';
    var dollars = (cents / 100);
    return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  window.PmCart = { open: open, close: close, refresh: refresh };

  // ── Flicker fix ────────────────────────────────────────────────────
  // The header badge is server-rendered with the Shopify cart LINE count
  // only — it can't know about local "quote" items (those live in
  // localStorage). Without this, every navigation showed the Shopify-only
  // number for ~500ms until refresh()'s /cart.js fetch resolved and
  // render() added the quote lines, causing a visible 2 → 4 jump.
  //
  // This runs SYNCHRONOUSLY at script parse (header is already in the DOM
  // by the time scripts load at end of <body>), reading quote lines
  // straight from localStorage and folding them into the badge before the
  // first paint settles. It must run exactly once per page load so it
  // never double-counts the server value.
  function readQuoteLineCount() {
    try {
      var raw = window.localStorage.getItem('pm:quote:v1');
      if (!raw) return 0;
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.length : 0;
    } catch (e) { return 0; }
  }

  function syncBadgeFromStorage() {
    // The server stamps the authoritative Shopify line count on each badge as
    // data-cart-shopify-lines, so read THAT — never textContent, which already
    // includes any quote lines a previous pass added. That keeps this fully
    // idempotent no matter how many times it runs.
    var badge = document.querySelector('[data-cart-badge]');
    if (!badge) return;
    var shopifyLines = parseInt(badge.getAttribute('data-cart-shopify-lines'), 10);
    if (isNaN(shopifyLines)) shopifyLines = 0;
    setAllBadges(shopifyLines + readQuoteLineCount());
  }

  syncBadgeFromStorage();

  // Re-derive the badge when the page is restored from the bfcache (back/forward
  // navigation): the DOM is frozen at its old paint but localStorage quotes may
  // have changed, so recompute from the stable server baseline + current quotes.
  window.addEventListener('pageshow', function (e) { if (e.persisted) syncBadgeFromStorage(); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
