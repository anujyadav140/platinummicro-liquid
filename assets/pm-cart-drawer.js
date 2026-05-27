/**
 * PmCart — slide-out cart drawer.
 * Mirrors Hydrogen's PmCartDrawer.
 */
(function () {
  'use strict';

  var drawer, itemsEl, emptyEl, footEl, countEl, clearBtn, template;
  var inited = false;
  var debounceTimer = null;

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
      var input = item.querySelector('.pm-cart__qty-input');
      var curr = parseInt(input.value, 10) || 0;
      if (e.target.closest('[data-cart-inc]')) updateLine(key, curr + 1);
      else if (e.target.closest('[data-cart-dec]')) updateLine(key, Math.max(0, curr - 1));
      else if (e.target.closest('[data-cart-remove]')) removeLine(key);
    });
    itemsEl.addEventListener('change', function (e) {
      var input = e.target.closest('.pm-cart__qty-input');
      if (!input) return;
      var item = e.target.closest('[data-cart-item]');
      var key  = item.getAttribute('data-cart-key');
      var qty  = parseInt(input.value, 10);
      if (isNaN(qty) || qty < 0) qty = 0;
      if (qty === 0) removeLine(key);
      else updateLine(key, qty);
    });

    clearBtn.addEventListener('click', function () {
      fetch('/cart/clear.js', { method: 'POST' })
        .then(function () { document.dispatchEvent(new CustomEvent('pm:cart-changed')); });
    });

    // Listen for external cart changes
    document.addEventListener('pm:cart-changed', function () {
      refresh().then(function () {
        // Auto-open after a Quick Order success
        open();
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

  function render(cart) {
    var totalItems = cart.item_count || 0;
    var totalQty   = (cart.items || []).reduce(function (a, i) { return a + (i.quantity || 0); }, 0);
    countEl.textContent = totalItems === 1
      ? '1 item · ' + totalQty + ' unit' + (totalQty === 1 ? '' : 's')
      : totalItems + ' items · ' + totalQty + ' units';

    // Update header cart badge
    var badge = document.querySelector('[data-cart-badge]');
    if (badge) {
      if (totalItems > 0) {
        badge.textContent = totalItems;
        badge.removeAttribute('hidden');
      } else {
        badge.setAttribute('hidden', '');
      }
    }

    itemsEl.innerHTML = '';

    if (!cart.items || cart.items.length === 0) {
      emptyEl.removeAttribute('hidden');
      itemsEl.setAttribute('hidden', '');
      footEl.setAttribute('hidden', '');
      return;
    }

    emptyEl.setAttribute('hidden', '');
    itemsEl.removeAttribute('hidden');
    footEl.removeAttribute('hidden');

    cart.items.forEach(function (item) {
      var node = template.content.firstElementChild.cloneNode(true);
      node.setAttribute('data-cart-key', item.key);

      var imgLink = node.querySelector('[data-cart-link].pm-cart__item-img');
      var nameLink = node.querySelector('[data-cart-link].pm-cart__item-name');
      imgLink.setAttribute('href', item.url);
      nameLink.setAttribute('href', item.url);
      nameLink.textContent = item.product_title || item.title;

      var img = node.querySelector('img');
      if (item.image) {
        img.src = item.image.replace(/\.(jpg|jpeg|png|webp)/i, '_120x120.$1');
        img.alt = item.product_title || item.title;
      } else {
        img.remove();
      }

      var skuEl = node.querySelector('.pm-cart__item-sku');
      var dotEl = node.querySelector('.pm-cart__item-dot');
      if (item.sku) {
        skuEl.textContent = item.sku;
      } else {
        skuEl.remove();
        dotEl.remove();
      }
      node.querySelector('.pm-cart__item-price').textContent = formatMoney(item.line_price || item.price * item.quantity);

      node.querySelector('.pm-cart__qty-input').value = item.quantity;

      itemsEl.appendChild(node);
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
    var badge = document.querySelector('[data-cart-badge]');
    if (badge) {
      if (totalItems > 0) { badge.textContent = totalItems; badge.removeAttribute('hidden'); }
      else { badge.setAttribute('hidden', ''); }
    }
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
        .then(function (r) { return r.json(); })
        .then(function (cart) { render(cart); });
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
      })
      .catch(function () {});
  }

  function formatMoney(cents) {
    if (cents == null) return '';
    var dollars = (cents / 100);
    return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  window.PmCart = { open: open, close: close, refresh: refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
