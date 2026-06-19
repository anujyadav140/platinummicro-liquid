/**
 * PmQuickOrder — Bulk SKU → cart entry modal.
 * Mirrors the Hydrogen PmQuickOrder.tsx behaviour.
 */
(function () {
  'use strict';

  var modal, rowsEl, addRowBtn, submitBtn, countEl, alertEl, alertSkusEl, template;
  var inited = false;

  // --- TC-092 SKU typeahead state -------------------------------------------
  var acEl;                 // the shared dropdown element (#pm-qo-ac)
  var acInput   = null;     // the .pm-qo__sku input the dropdown is anchored to
  var acItems   = [];       // current suggestion data [{ sku, title, image, price, url, handle }]
  var acActive  = -1;       // highlighted index, -1 = none
  var acSeq     = 0;        // request sequence — newest wins, stale responses ignored
  var acTimer   = null;     // debounce timer
  var acBlurT   = null;     // blur-close timer (delayed so a click can land first)
  var AC_MIN    = 2;        // min chars before querying
  var AC_DEBOUNCE = 250;

  function $(sel, root) { return (root || document).querySelector(sel); }

  function init() {
    if (inited) return;
    modal       = document.getElementById('pm-quick-order-modal');
    rowsEl      = document.getElementById('pm-qo-rows');
    addRowBtn   = document.getElementById('pm-qo-add-row');
    submitBtn   = document.getElementById('pm-qo-submit');
    countEl     = document.getElementById('pm-qo-count');
    alertEl     = document.getElementById('pm-qo-alert');
    alertSkusEl = document.getElementById('pm-qo-alert-skus');
    template    = document.getElementById('pm-qo-row-template');
    acEl        = document.getElementById('pm-qo-ac');
    if (!modal || !template) return;

    // The modal panel is transformed + overflow:hidden, which would clip a
    // dropdown anchored inside it (common when typing in a lower row). Re-parent
    // the typeahead to <body> so it's position:fixed against the viewport and
    // never clipped. (Done once; it's reused across opens.)
    if (acEl && acEl.parentNode !== document.body) document.body.appendChild(acEl);

    // Add seed row
    addRow();

    // Wiring
    addRowBtn.addEventListener('click', function () { addRow(); focusLastSku(); });
    submitBtn.addEventListener('click', submit);
    modal.addEventListener('click', function (e) {
      // closest() so clicks on the X icon's inner <svg>/<path> still close
      if (e.target.closest('[data-qo-close]')) close();
    });
    rowsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-qo-remove]');
      if (!btn) return;
      var row = btn.closest('[data-qo-row]');
      if (rowsEl.children.length > 1) {
        row.remove();
      } else {
        // Last row → just clear inputs
        row.querySelector('.pm-qo__sku').value = '';
        row.querySelector('.pm-qo__qty').value = '1';
      }
      updateState();
    });
    rowsEl.addEventListener('input', function () {
      hideAlert();
      updateState();
    });

    // --- TC-092 typeahead: DELEGATED on #pm-qo-rows so cloned rows work ------
    // Input → debounced query, anchored to whichever .pm-qo__sku fired.
    rowsEl.addEventListener('input', function (e) {
      var input = e.target.closest('.pm-qo__sku');
      if (input) acOnInput(input);
    });
    // Focus → if there's already a >=2-char value, re-run the query.
    rowsEl.addEventListener('focusin', function (e) {
      var input = e.target.closest('.pm-qo__sku');
      if (input) acOnInput(input);
    });
    // Blur → close after a short delay so a click on a suggestion still lands.
    rowsEl.addEventListener('focusout', function (e) {
      if (!e.target.closest('.pm-qo__sku')) return;
      if (acBlurT) clearTimeout(acBlurT);
      acBlurT = setTimeout(acClose, 150);
    });
    // Keyboard nav from within any SKU input.
    rowsEl.addEventListener('keydown', function (e) {
      if (e.target.closest('.pm-qo__sku')) acOnKeydown(e);
    });

    // Suggestion interaction. mousedown (not click) fires before the input's
    // blur, so the selection registers even though blur is about to close it.
    acEl.addEventListener('mousedown', function (e) {
      var opt = e.target.closest('.pm-qo__ac-item');
      if (!opt) return;
      e.preventDefault(); // keep focus on the input
      acSelect(parseInt(opt.getAttribute('data-index'), 10));
    });
    acEl.addEventListener('mousemove', function (e) {
      var opt = e.target.closest('.pm-qo__ac-item');
      if (opt) acSetActive(parseInt(opt.getAttribute('data-index'), 10));
    });
    // Click-outside closes (a click inside an input or the dropdown does not).
    document.addEventListener('mousedown', function (e) {
      if (!acInput) return;
      if (e.target.closest('.pm-qo__ac') || e.target.closest('.pm-qo__sku')) return;
      acClose();
    });
    // Reposition if the modal body scrolls under the open dropdown.
    var body = $('.pm-qo__body', modal);
    if (body) body.addEventListener('scroll', function () { if (acInput) acPosition(); }, { passive: true });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hasAttribute('aria-hidden')) {
        // Escape first closes an open suggestion list, then (next press) the modal.
        if (acInput) { acClose(); e.stopPropagation(); return; }
        close();
      }
    });

    // Anyone with data-qo-open or href="#quick-order" triggers it
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-qo-open], a[href="#quick-order"], a[href="/pages/quick-order"]');
      if (!t) return;
      e.preventDefault();
      open();
    });

    inited = true;
  }

  function open() {
    if (!modal) return;
    // Always start clean: no leftover error banner from a previous attempt.
    hideAlert();
    modal.removeAttribute('aria-hidden');
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    // a11y: trap focus in the modal + land focus on the first SKU input.
    if (window.PmFocusTrap) PmFocusTrap.trap(modal, { initial: '.pm-qo__sku' });
    else setTimeout(focusFirstSku, 50);
    updateState();
  }

  function close() {
    if (!modal) return;
    acClose();
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    hideAlert();
    // Full reset so the next open is a fresh modal.
    resetForm();
    if (window.PmFocusTrap) PmFocusTrap.release(); // restore focus to the opener
  }

  function addRow() {
    var node = template.content.firstElementChild.cloneNode(true);
    rowsEl.appendChild(node);
    updateState();
  }

  function focusFirstSku() {
    var first = rowsEl.querySelector('.pm-qo__sku');
    if (first) first.focus();
  }

  function focusLastSku() {
    var inputs = rowsEl.querySelectorAll('.pm-qo__sku');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function collect() {
    var rows = Array.from(rowsEl.querySelectorAll('[data-qo-row]'));
    var entries = [];
    rows.forEach(function (row) {
      var sku = (row.querySelector('.pm-qo__sku').value || '').trim();
      var qty = parseInt(row.querySelector('.pm-qo__qty').value, 10);
      if (!sku) return;
      if (!qty || qty < 1) qty = 1;
      entries.push({ sku: sku, qty: qty });
    });
    return entries;
  }

  function updateState() {
    var entries = collect();
    var totalSkus = entries.length;
    var totalUnits = entries.reduce(function (acc, e) { return acc + e.qty; }, 0);
    var noun = totalSkus === 1 ? 'SKU' : 'SKUs';
    var unitNoun = totalUnits === 1 ? 'unit' : 'units';
    countEl.textContent = totalSkus + ' ' + noun + ' · ' + totalUnits + ' ' + unitNoun + ' ready to add';
    submitBtn.disabled = totalSkus === 0;
  }

  function showAlert(problems) {
    alertSkusEl.innerHTML = '';
    problems.forEach(function (p) {
      var reason = (p && p.reason) || '';
      var isOOS  = reason === 'out of stock';

      var row = document.createElement('div');
      row.className = 'pm-qo__problem';

      var sku = document.createElement('span');
      sku.className = 'pm-qo__problem-sku';
      sku.textContent = (p && p.sku) ? p.sku : String(p);
      row.appendChild(sku);

      if (reason) {
        var status = document.createElement('span');
        status.className = 'pm-qo__problem-status ' + (isOOS ? 'pm-qo__problem-status--oos' : 'pm-qo__problem-status--missing');
        status.textContent = isOOS ? 'Out of stock' : (reason === 'not found' ? 'Not found' : reason);
        row.appendChild(status);
      }

      // Out-of-stock items we found → one-tap "Add to quote".
      if (isOOS && p.match && p.match.product) {
        var qbtn = document.createElement('button');
        qbtn.type = 'button';
        qbtn.className = 'pm-qo__quote-btn';
        qbtn.textContent = 'Add to quote';
        (function (m) { qbtn.addEventListener('click', function () { addToQuote(m); }); })(p.match);
        row.appendChild(qbtn);
      }

      alertSkusEl.appendChild(row);
    });
    alertEl.removeAttribute('hidden');
  }

  /**
   * Send an out-of-stock SKU to the Quotify quote flow. Mirrors the PDP's
   * Quotify trigger exactly: a no-op <form> wrapping a [data-quotify] button
   * carrying the full product JSON (same shape as {{ product | json }}), which
   * Quotify's event-delegated app script picks up. If Quotify isn't loaded for
   * some reason, fall back to the product's page (which leads with the quote CTA
   * for out-of-stock items).
   */
  function addToQuote(match) {
    if (!match || !match.product) return;
    var p = match.product, variantId = match.id;
    if (typeof window.Quotify === 'undefined') {
      window.location.href = p.url || ('/products/' + p.handle);
      return;
    }
    var form = document.createElement('form');
    form.className = 'pm-quotify-form';
    form.setAttribute('onsubmit', 'return false;');
    form.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
    var hidden = document.createElement('input');
    hidden.type = 'hidden'; hidden.name = 'id'; hidden.value = variantId;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quotify-request-quote-btn';
    btn.setAttribute('data-quotify', '');
    btn.setAttribute('data-product-id', String(p.id));
    btn.setAttribute('data-variant', String(variantId));
    btn.setAttribute('data-product', JSON.stringify(p));
    form.appendChild(hidden);
    form.appendChild(btn);
    document.body.appendChild(form);
    // Quotify delegates from document.body and, on DESKTOP, fires its handler on
    // `mousedown` (mobile uses `click`), resolving the closest [data-quotify]. A
    // plain .click() emits only a 'click' event, so it never triggered on desktop.
    // Dispatch the full mouse sequence and make each event look like a genuine
    // left-click (button/buttons/which) so any button-guard in Quotify passes.
    ['mousedown', 'mouseup', 'click'].forEach(function (type) {
      var ev = new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        button: 0, buttons: type === 'mousedown' ? 1 : 0
      });
      try { Object.defineProperty(ev, 'which', { value: 1 }); } catch (e) {}
      btn.dispatchEvent(ev);
    });
    // Quotify opens its own flow off that event; drop our scaffold afterward.
    setTimeout(function () { try { form.remove(); } catch (e) {} }, 5000);
  }

  function hideAlert() {
    alertEl.setAttribute('hidden', '');
    alertSkusEl.innerHTML = '';
  }

  // ===========================================================================
  // TC-092 — SKU typeahead / autocomplete
  // ---------------------------------------------------------------------------
  // A single shared dropdown (#pm-qo-ac) is repositioned under whichever
  // .pm-qo__sku input is active, so it works with rows cloned at runtime.
  // ===========================================================================

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Format a Shopify price. suggest.json gives an already-formatted `price`
  // string (e.g. "$1,299.00"); fall back to cents → "$x.xx" if it's numeric.
  function acPrice(p) {
    if (p == null || p === '') return '';
    if (typeof p === 'string') return p;
    var n = Number(p);
    if (!isFinite(n)) return '';
    // Heuristic: integers >= 1000 are almost certainly cents.
    if (Number.isInteger(n) && n >= 1000) n = n / 100;
    return '$' + n.toFixed(2);
  }

  // suggest.json does NOT include variant SKUs — its `variants` array comes back
  // empty — so we resolve them with a second hop to /products/<handle>.js, the
  // same trick lookupSku uses. Cached by handle so repeated keystrokes that
  // re-surface the same product don't refetch.
  var acVariantCache = {};
  function acLoadVariants(handle) {
    if (!handle) return Promise.resolve([]);
    if (acVariantCache[handle]) return acVariantCache[handle];
    var pr = fetch('/products/' + handle + '.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (full) { return (full && full.variants) || []; })
      .catch(function () { return []; });
    acVariantCache[handle] = pr;
    return pr;
  }

  // From a resolved variants array, pick the one whose SKU best matches `term`
  // (case-insensitive contains). Falls back to the first variant's SKU.
  function bestVariantSku(variants, term) {
    var t = (term || '').toLowerCase();
    var firstSku = '';
    for (var i = 0; i < variants.length; i++) {
      var sku = (variants[i] && variants[i].sku) ? String(variants[i].sku) : '';
      if (!sku) continue;
      if (!firstSku) firstSku = sku;
      if (sku.toLowerCase().indexOf(t) !== -1) return sku;
    }
    return firstSku;
  }

  // Debounced input handler — anchors the dropdown to `input` and queries.
  function acOnInput(input) {
    acInput = input;
    var term = (input.value || '').trim();
    if (term.length < AC_MIN) { acClose(); return; }
    if (acTimer) clearTimeout(acTimer);
    var seq = ++acSeq;            // claim a sequence number for this keystroke
    acTimer = setTimeout(function () { acFetch(term, seq, input); }, AC_DEBOUNCE);
  }

  // Query predictive search (matches SKUs via the variants.sku field), then a
  // second hop per candidate to resolve the actual SKU string.
  // Platinum Micro prepends a short category code (CC / CD / EP …) to the
  // manufacturer SKU, so a customer who types the manufacturer SKU (e.g.
  // AS6706TV2, stored as CCAS6706TV2) should still resolve the product. True
  // when the stored SKU equals the typed term, or is just a short prefix + it.
  function skuMatches(stored, typed) {
    var s = (stored || '').trim().toLowerCase();
    var t = (typed || '').trim().toLowerCase();
    if (!s || !t) return false;
    if (s === t) return true;
    if (s.length > t.length && (s.length - t.length) <= 3 && s.slice(s.length - t.length) === t) return true;
    return false;
  }

  // Predictive search over products (matches SKU via variants.sku, plus barcode
  // + title). A full manufacturer SKU can return nothing — e.g. "AS6706TV2": the
  // title is "AS6706T v2" (a space splits the token) and the stored SKU is
  // prefixed — so on an empty result we retry with a shorter prefix to surface
  // broader candidates that skuMatches() / bestVariantSku() then narrow.
  function suggestProducts(term) {
    function hit(q) {
      var url = '/search/suggest.json?q=' + encodeURIComponent(q) +
                '&resources[type]=product&resources[limit]=6' +
                '&resources[options][unavailable_products]=last' +
                '&resources[options][fields]=variants.sku,variants.barcode,title';
      return fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) { return (((d || {}).resources || {}).results || {}).products || []; })
        .catch(function () { return []; });
    }
    return hit(term).then(function (products) {
      if (products.length || term.length <= 6) return products;
      return hit(term.slice(0, 6));
    });
  }

  function acFetch(term, seq, input) {
    function stale() {
      return seq !== acSeq || input !== acInput || (input.value || '').trim() !== term;
    }
    suggestProducts(term)
      .then(function (products) {
        if (stale()) return;
        if (!products.length) { acClose(); return; }
        // suggest.json has no variant SKUs → resolve each candidate's SKU from
        // its product JSON (cached) before building the suggestion list.
        return Promise.all(products.slice(0, 6).map(function (p) {
          var handle = p.handle || (p.url ? p.url.split('?')[0].replace(/^.*\/products\//, '') : '');
          return acLoadVariants(handle).then(function (variants) {
            return {
              sku:    bestVariantSku(variants, term),
              title:  p.title || '',
              image:  (p.featured_image && p.featured_image.url) || (typeof p.image === 'string' ? p.image : '') || '',
              price:  acPrice(p.price),
              url:    p.url || '',
              handle: handle
            };
          });
        })).then(function (items) {
          if (stale()) return;
          acItems = items.filter(function (it) { return it.sku; });
          if (!acItems.length) { acClose(); return; }
          acRender(term);
          acOpen();
        });
      })
      .catch(function () { /* network error → silently leave dropdown as-is */ });
  }

  // Platinum Micro prepends a 2-letter category code (CC/CA/CS/CD/EP…) to the
  // manufacturer SKU. Customers know the manufacturer SKU (AS6706TV2, not the
  // internal CCAS6706TV2), so we show + fill that. lookupSku()/skuMatches()
  // resolve it back to the prefixed variant on add-to-cart.
  function mfgSku(sku) {
    var s = String(sku || '');
    return (s.length > 4 && /^[A-Za-z]{2}/.test(s)) ? s.slice(2) : s;
  }

  function acRender(term) {
    var lower = (term || '').toLowerCase();
    acActive = -1;
    var html = acItems.map(function (it, i) {
      // Show the MANUFACTURER SKU; highlight the matched substring.
      var display = mfgSku(it.sku);
      var skuHtml = esc(display);
      var idx = display.toLowerCase().indexOf(lower);
      if (idx !== -1 && lower) {
        skuHtml = esc(display.slice(0, idx)) +
                  '<mark class="pm-qo__ac-mark">' + esc(display.slice(idx, idx + lower.length)) + '</mark>' +
                  esc(display.slice(idx + lower.length));
      }
      var thumb = it.image
        ? '<span class="pm-qo__ac-thumb"><img src="' + esc(it.image) + '" alt="" loading="lazy"></span>'
        : '<span class="pm-qo__ac-thumb pm-qo__ac-thumb--empty"></span>';
      var price = it.price ? '<span class="pm-qo__ac-price">' + esc(it.price) + '</span>' : '';
      return '<div class="pm-qo__ac-item" role="option" id="pm-qo-ac-opt-' + i + '" data-index="' + i + '" aria-selected="false">' +
               thumb +
               '<span class="pm-qo__ac-main">' +
                 '<span class="pm-qo__ac-sku">' + skuHtml + '</span>' +
                 '<span class="pm-qo__ac-title">' + esc(it.title) + '</span>' +
               '</span>' +
               price +
             '</div>';
    }).join('');
    acEl.innerHTML = html;
  }

  function acOpen() {
    if (!acItems.length) return;
    acEl.removeAttribute('hidden');
    acPosition();
    if (acInput) acInput.setAttribute('aria-expanded', 'true');
  }

  function acClose() {
    if (acTimer) { clearTimeout(acTimer); acTimer = null; }
    acSeq++; // invalidate any in-flight request so its response is ignored
    acEl.setAttribute('hidden', '');
    acEl.innerHTML = '';
    acItems = [];
    acActive = -1;
    if (acInput) {
      acInput.removeAttribute('aria-activedescendant');
      acInput.removeAttribute('aria-expanded');
    }
    acInput = null;
  }

  // Position the shared dropdown directly under the active input. Both live
  // inside .pm-qo__panel (the offsetParent), so we use offset coordinates.
  function acPosition() {
    if (!acInput) return;
    // #pm-qo-ac is appended to <body> and position:fixed, so anchor it with
    // raw viewport coordinates (getBoundingClientRect is already viewport-based).
    var r = acInput.getBoundingClientRect();
    acEl.style.top = (r.bottom + 4) + 'px';
    acEl.style.left = r.left + 'px';
    acEl.style.width = r.width + 'px';
  }

  function acSetActive(i) {
    var opts = acEl.querySelectorAll('.pm-qo__ac-item');
    if (acActive >= 0 && opts[acActive]) {
      opts[acActive].classList.remove('is-active');
      opts[acActive].setAttribute('aria-selected', 'false');
    }
    acActive = i;
    if (i >= 0 && opts[i]) {
      opts[i].classList.add('is-active');
      opts[i].setAttribute('aria-selected', 'true');
      if (acInput) acInput.setAttribute('aria-activedescendant', 'pm-qo-ac-opt-' + i);
      // Keep the highlighted row visible if the list scrolls.
      if (opts[i].scrollIntoView) opts[i].scrollIntoView({ block: 'nearest' });
    } else if (acInput) {
      acInput.removeAttribute('aria-activedescendant');
    }
  }

  function acOnKeydown(e) {
    var open = acInput && !acEl.hasAttribute('hidden') && acItems.length;
    if (e.key === 'Escape') {
      if (open) { acClose(); e.stopPropagation(); e.preventDefault(); }
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acSetActive((acActive + 1) % acItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acSetActive((acActive - 1 + acItems.length) % acItems.length);
    } else if (e.key === 'Enter') {
      if (acActive >= 0) {
        e.preventDefault();
        acSelect(acActive);
      }
      // No highlight → let Enter fall through (e.g. native form behaviour).
    } else if (e.key === 'Tab') {
      acClose(); // tabbing away dismisses the list
    }
  }

  // Fill the chosen SKU into the anchored input and close the dropdown.
  function acSelect(i) {
    if (i < 0 || i >= acItems.length || !acInput) return;
    var input = acInput;
    input.value = mfgSku(acItems[i].sku);
    acClose();
    input.focus();
    // Re-run existing validation/state without re-triggering the typeahead:
    // a plain input event keeps hideAlert()/updateState() in sync, and since
    // the value now exactly matches a real SKU the next acFetch (if any) is
    // harmless. Suppress the immediate re-open by clearing the debounce.
    if (acTimer) { clearTimeout(acTimer); acTimer = null; }
    updateState();
    hideAlert();
  }

  /**
   * Look up a variant by SKU.
   * 1. Predictive search for products whose SKU field matches.
   * 2. For each candidate product, fetch /products/{handle}.js to find
   *    the variant whose SKU exactly matches (case-insensitive).
   * Returns { id, product } or null.
   */
  function lookupSku(sku) {
    // suggestProducts() handles the manufacturer-SKU retry; each candidate's full
    // product JSON is then checked for an EXACT variant SKU first (most precise),
    // then an EXACT match against the de-prefixed manufacturer SKU so a customer
    // who types AS6706TV2 still resolves the PM-prefixed CCAS6706TV2 variant.
    // A relaxed skuMatches() candidate is ONLY accepted when it is unambiguous
    // (exactly one loose match across all products): the committed cart add must
    // never silently substitute a differently-priced variant.
    return suggestProducts(sku).then(function (products) {
      if (!products.length) return null;
      var checks = products.map(function (p) {
        var handle = p.handle || (p.url ? p.url.split('?')[0].replace(/^.*\/products\//, '') : '');
        if (!handle) return Promise.resolve(null);
        return fetch('/products/' + handle + '.js', { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (full) {
            var variants = (full && full.variants) || [];
            var lower = sku.trim().toLowerCase();
            // Coerce id to a Number — /cart/add.js needs the numeric variant id.
            // 1. EXACT variant SKU match (full string, case-insensitive).
            for (var i = 0; i < variants.length; i++) {
              if ((variants[i].sku || '').trim().toLowerCase() === lower)
                return { id: parseInt(variants[i].id, 10), available: variants[i].available, product: full, exact: true };
            }
            // 2. EXACT match against the de-prefixed manufacturer SKU
            //    (e.g. typed AS6706TV2 === mfgSku('CCAS6706TV2')).
            for (var k = 0; k < variants.length; k++) {
              if (mfgSku((variants[k].sku || '').trim()).toLowerCase() === lower)
                return { id: parseInt(variants[k].id, 10), available: variants[k].available, product: full, exact: true };
            }
            // 3. Relaxed prefix match — flagged exact:false so it is only used
            //    when it is the single unambiguous candidate (resolved below).
            for (var j = 0; j < variants.length; j++) {
              if (skuMatches(variants[j].sku, sku))
                return { id: parseInt(variants[j].id, 10), available: variants[j].available, product: full, exact: false };
            }
            return null;
          })
          .catch(function () { return null; });
      });
      return Promise.all(checks).then(function (results) {
        var relaxed = [];
        for (var i = 0; i < results.length; i++) {
          if (results[i] && results[i].exact) return results[i];
          if (results[i]) relaxed.push(results[i]);
        }
        // Only accept a relaxed match when it is unambiguous — exactly one loose
        // candidate. Two or more → we can't tell which (differently-priced)
        // variant the customer meant, so report it as unresolved rather than
        // silently adding the wrong one.
        return relaxed.length === 1 ? relaxed[0] : null;
      });
    });
  }

  function submit() {
    var entries = collect();
    if (entries.length === 0) return;

    setLoading(true);
    hideAlert();

    // Look up each SKU in parallel
    Promise.all(entries.map(function (e) {
      return lookupSku(e.sku).then(function (match) {
        return { entry: e, match: match };
      });
    })).then(function (results) {
      var items    = [];   // in-stock, addable
      var problems = [];   // { sku, reason } — 'not found' or 'out of stock'
      results.forEach(function (r) {
        var id  = r.match ? parseInt(r.match.id, 10) : NaN;
        var qty = parseInt(r.entry.qty, 10);
        if (!qty || qty < 1) qty = 1;
        if (r.match && id && r.match.available) {
          items.push({ id: id, quantity: qty });
        } else if (r.match && id && !r.match.available) {
          // Found, but the variant is sold out. Shopify's /cart/add.js is atomic,
          // so leaving it in the batch would fail EVERY line — exclude + report it.
          // Keep the match so we can offer "Add to quote" for it.
          problems.push({ sku: r.entry.sku, reason: 'out of stock', match: r.match });
        } else {
          problems.push({ sku: r.entry.sku, reason: 'not found' });
        }
      });

      if (items.length === 0) {
        showAlert(problems);
        setLoading(false);
        return;
      }

      // Multi-add the IN-STOCK items only (sold-out ones excluded above).
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: items })
      })
        .then(function (r) {
          // Parse defensively: a non-JSON body (rare error pages) must not throw
          // into the outer catch and silently swallow the result.
          return r.text().then(function (text) {
            var json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
            return { ok: r.ok, json: json };
          });
        })
        .then(function (resp) {
          if (!resp.ok) {
            // A late inventory change can still 422 — surface Shopify's reason.
            var msg = (resp.json && resp.json.message) ? resp.json.message : 'could not be added';
            showAlert(problems.concat([{ sku: items.length + ' item(s)', reason: msg }]));
            setLoading(false);
            return;
          }
          // Refresh cart and notify drawer
          document.dispatchEvent(new CustomEvent('pm:cart-changed', {
            detail: { source: 'quick-order', addedCount: items.length }
          }));

          if (problems.length > 0) {
            // Keep the not-found / sold-out rows visible, drop the added ones
            removeAddedRows(results);
            showAlert(problems);
            setLoading(false);
          } else {
            // Clean everything and close
            resetForm();
            setLoading(false);
            close();
          }
        });
    }).catch(function () {
      setLoading(false);
    });
  }

  function removeAddedRows(results) {
    // Drop only the rows that were actually ADDED (matched AND in stock).
    var rows = Array.from(rowsEl.querySelectorAll('[data-qo-row]'));
    results.forEach(function (r) {
      if (!r.match || !r.match.available) return;
      var matchRow = rows.find(function (row) {
        return (row.querySelector('.pm-qo__sku').value || '').trim().toLowerCase() === r.entry.sku.toLowerCase();
      });
      if (matchRow) matchRow.remove();
    });
    if (rowsEl.children.length === 0) addRow();
    updateState();
  }

  function resetForm() {
    rowsEl.innerHTML = '';
    addRow();
    updateState();
  }

  function setLoading(yes) {
    submitBtn.disabled = yes || collect().length === 0;
    var label   = submitBtn.querySelector('.pm-qo__submit-label');
    var spinner = submitBtn.querySelector('.pm-qo__submit-spinner');
    if (yes) {
      label.textContent = 'Adding…';
      if (spinner) spinner.removeAttribute('hidden');
    } else {
      label.textContent = 'Add to cart';
      if (spinner) spinner.setAttribute('hidden', '');
    }
  }

  // Expose
  window.PmQuickOrder = { open: open, close: close };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
