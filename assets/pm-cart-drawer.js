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
  }

  function close() {
    drawer.setAttribute('aria-hidden', 'true');
    drawer.classList.remove('is-open');
    document.body.style.overflow = '';
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

    // TC-085: disable + once this line is known to be at its available cap.
    if (opts.kind === 'shopify') {
      var cap = maxedCap[opts.key];
      var incBtn = node.querySelector('[data-cart-inc]');
      if (incBtn && typeof cap === 'number' && (opts.quantity || 1) >= cap) {
        incBtn.disabled = true;
        incBtn.setAttribute('aria-disabled', 'true');
        incBtn.setAttribute('title', 'No more available in stock');
      }
    }

    return node;
  }

  // ── Quote line mutations — go through PmQuote, not Shopify ──
  function updateQuote(sku, qty) {
    var li = itemsEl.querySelector('[data-cart-item][data-cart-key="' + cssEscape(sku) + '"]');
    if (li) li.querySelector('.pm-cart__qty-input').value = qty;
    optimisticHeader();
    if (window.PmQuote) window.PmQuote.setQuantity(sku, qty);
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
    if (window.PmQuote) window.PmQuote.remove(sku);
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

  function updateLine(key, qty) {
    // Update the qty input + line price + counts immediately, then
    // sync with the server. Debounce coalesces rapid +/- spam.
    var li = itemsEl.querySelector('[data-cart-item][data-cart-key="' + key + '"]');
    if (li) li.querySelector('.pm-cart__qty-input').value = qty;
    optimisticHeader();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: key, quantity: qty })
      })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
          if (res.ok && res.body && res.body.items) {
            // Normal change (Shopify may have capped qty below what we asked).
            var ln = res.body.items.filter(function (i) { return i.key === key; })[0];
            var got = ln ? ln.quantity : 0;
            if (got < qty) maxedCap[key] = got; else delete maxedCap[key];
            render(res.body);
            if (window.PmAddToCart && window.PmAddToCart.syncMaxed) window.PmAddToCart.syncMaxed();
          } else {
            // Over available stock: Shopify returns 422 with NO cart body. Rendering
            // that would wipe every other line, so re-sync from the real cart and
            // learn the cap from the line's actual (capped) quantity.
            fetch('/cart.js', { headers: { Accept: 'application/json' } })
              .then(function (r) { return r.json(); })
              .then(function (cart) {
                var ln = (cart.items || []).filter(function (i) { return i.key === key; })[0];
                maxedCap[key] = ln ? ln.quantity : 0;
                render(cart);
                if (window.PmAddToCart && window.PmAddToCart.syncMaxed) window.PmAddToCart.syncMaxed();
              }).catch(function () {});
          }
        });
    }, 120);
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
