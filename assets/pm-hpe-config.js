/* PM — HPE ProLiant configurator (stepped wizard, arrow-nav).
   Base = real Shopify variant price; option deltas from the middleware.
   Navigate steps with the ‹ › arrows in the title (or the numbered pips). Live total. */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(c) { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((c || 0) / 100); } catch (e) { return '$' + ((c || 0) / 100).toFixed(2); } }
  function extractHpeSku(t, s) { var m = (t || '').match(/\bP\d{4,6}-\d{3}\b/i); if (m) return m[0].toUpperCase(); if (s) return s.toUpperCase().replace(/^CS/, ''); return null; }
  var SHORT = { memory: 'Memory', storage: 'Storage', os: 'OS', mgmt: 'iLO', support: 'Support' };

  function init(root) {
    var endpoint = (root.getAttribute('data-endpoint') || '').replace(/\/$/, '');
    var sku = extractHpeSku(root.getAttribute('data-title'), root.getAttribute('data-sku'));
    var baseCents = parseInt(root.getAttribute('data-base-cents') || '0', 10);
    if (!endpoint || !sku || /PLACEHOLDER/.test(endpoint)) return;

    fetch(endpoint + '/hpe/' + encodeURIComponent(sku))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        var groups = d.optionGroups || []; if (!groups.length) return;
        if (!baseCents && d.price && d.price.list) baseCents = Math.round(d.price.list * 100);
        var sel = {}; groups.forEach(function (g) { sel[g.key] = g.choices.filter(function (c) { return c.default; })[0] || g.choices[0]; });
        var step = 0, last = groups.length - 1;

        root.innerHTML =
          '<div class="pm-cfg__card">' +
            '<header class="pm-cfg__head">' +
              '<div class="pm-cfg__headrow">' +
                '<div class="pm-cfg__eyebrow">Configure your server</div>' +
                '<div class="pm-cfg__nav">' +
                  '<button type="button" class="pm-cfg__back" data-prev aria-label="Previous step">&#8249;</button>' +
                  '<button type="button" class="pm-cfg__next" data-next>Next <span aria-hidden="true">&#8250;</span></button>' +
                '</div>' +
              '</div>' +
              '<div class="pm-cfg__stepname" data-stepname></div>' +
            '</header>' +
            '<div class="pm-cfg__body" data-body></div>' +
            '<footer class="pm-cfg__foot">' +
              '<span class="pm-cfg__price-label">Configured price</span>' +
              '<span class="pm-cfg__price-val" data-total>—</span>' +
              '<span class="pm-cfg__price-base" data-base></span>' +
            '</footer>' +
          '</div>';

        var bodyEl = root.querySelector('[data-body]'), nameEl = root.querySelector('[data-stepname]');

        function total() { var t = baseCents; groups.forEach(function (g) { t += (sel[g.key] ? sel[g.key].priceDelta : 0) * 100; }); return t; }
        function renderSteps() {
          nameEl.textContent = 'Step ' + (step + 1) + ' of ' + groups.length + ' · ' + groups[step].label;
        }
        function renderBody() {
          var g = groups[step];
          bodyEl.innerHTML = g.choices.map(function (c) {
            var on = sel[g.key] && sel[g.key].sku === c.sku;
            return '<button type="button" class="pm-cfg__opt' + (on ? ' is-on' : '') + '" data-sku="' + esc(c.sku) + '">' +
              '<span class="pm-cfg__radio" aria-hidden="true"></span>' +
              '<span class="pm-cfg__opt-label">' + esc(c.label) + '</span>' +
              '<span class="pm-cfg__opt-price">' + (c.priceDelta ? '+' + money(c.priceDelta * 100) : 'Included') + '</span>' +
              '</button>';
          }).join('');
        }
        function renderArrows() {
          root.querySelector('[data-prev]').disabled = step === 0;
          root.querySelector('[data-next]').disabled = step === last;
        }
        function refresh() {
          var t = total();
          root.querySelector('[data-total]').textContent = money(t);
          var b = root.querySelector('[data-base]');
          if (b) b.textContent = t > baseCents ? ('Base ' + money(baseCents) + '  ·  +' + money(t - baseCents) + ' in options') : 'Base configuration';
        }
        function all() { renderSteps(); renderBody(); renderArrows(); refresh(); }

        root.addEventListener('click', function (e) {
          var t = e.target.closest('[data-go],[data-sku],[data-prev],[data-next]'); if (!t) return;
          if (t.hasAttribute('data-go')) { step = Number(t.getAttribute('data-go')); all(); }
          else if (t.hasAttribute('data-sku')) { var g = groups[step]; sel[g.key] = g.choices.filter(function (c) { return c.sku === t.getAttribute('data-sku'); })[0]; renderBody(); refresh(); }
          else if (t.hasAttribute('data-prev')) { if (step > 0) { step--; all(); } }
          else if (t.hasAttribute('data-next')) { if (step < last) { step++; all(); } }
        });

        all();
        root.hidden = false;

        // ── Make the page's main "Add to Cart" reflect the configuration ──
        // Build readable line-item properties from the current selection.
        function buildProps() {
          var p = {};
          groups.forEach(function (g) { var c = sel[g.key]; if (c) p[g.label] = c.label + (c.priceDelta ? ' (+' + money(c.priceDelta * 100) + ')' : ''); });
          p['Configured total'] = money(total());
          return p;
        }
        var addBtn = document.querySelector('[data-pm-pdp-add]');
        if (addBtn) {
          // Keep the inventory cap (data-max-qty) on the button so the shared cap
          // logic in pm-add-to-cart.js (syncMaxed) marks it "Already in cart" and
          // disables it once the cart holds every available unit — EXACTLY like the
          // PLP card. We no longer strip the cap or force-enable; we only INJECT the
          // current configuration into the add. Out-of-stock state stays owned by
          // the shared logic (and the Liquid, which renders no button at 0 stock).
          var variantId = Number(addBtn.getAttribute('data-variant-id') || root.getAttribute('data-variant-id') || 0);
          function syncCap() { if (window.PmAddToCart && window.PmAddToCart.syncMaxed) window.PmAddToCart.syncMaxed(); }
          // Capture-phase: runs before pm-add-to-cart.js's add handler, which we then
          // stop — so the line is added ONCE, with the build properties attached.
          document.addEventListener('click', function (e) {
            var b = e.target.closest('[data-pm-pdp-add]'); if (!b) return;
            // Maxed / disabled (all stock already in cart) → let it read "Already in
            // cart"; don't add. (Disabled buttons don't fire clicks; guard anyway.)
            if (b.disabled || b.dataset.busy === '1' || b.classList.contains('is-maxed')) return;
            e.preventDefault(); e.stopImmediatePropagation();
            var lbl = b.querySelector('span');
            var orig = (lbl && !/already in cart|adding/i.test(lbl.textContent)) ? lbl.textContent : 'Add to Cart';
            b.dataset.busy = '1'; b.disabled = true; if (lbl) lbl.textContent = 'Adding…';
            var H = { 'Content-Type': 'application/json', Accept: 'application/json' };
            var addBody = JSON.stringify({ items: [{ id: variantId, quantity: 1, properties: buildProps() }] });
            fetch('/cart/add.js', { method: 'POST', headers: H, body: addBody })
              .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
              .then(function (res) {
                b.dataset.busy = '0';
                if (!res.ok) {
                  // Over the inventory cap → hand off to the shared cap logic, which
                  // locks the button to "Already in cart" (same as the PLP card).
                  if (lbl) lbl.textContent = orig; b.disabled = false;
                  syncCap();
                  document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'cap' } }));
                  return;
                }
                if (lbl) lbl.textContent = 'Added';
                b.dataset.origLabel = orig; // pin the resting label so syncMaxed never captures "Added"
                document.dispatchEvent(new CustomEvent('pm:cart-changed', { detail: { source: 'hpe-config' } }));
                setTimeout(function () {
                  if (!b.classList.contains('is-maxed')) { if (lbl) lbl.textContent = orig; b.disabled = false; delete b.dataset.origLabel; }
                  syncCap(); // this add may have just reached the cap → lock to "Already in cart"
                }, 1000);
              })
              .catch(function () { b.dataset.busy = '0'; if (lbl) lbl.textContent = orig; b.disabled = false; });
          }, true);
        }
      })
      .catch(function () { root.hidden = true; });
  }
  var n = document.querySelectorAll('[data-pm-cfg]');
  for (var i = 0; i < n.length; i++) init(n[i]);
})();
