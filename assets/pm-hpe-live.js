/* PM — HPE live data panel.
   Extracts the HPE part number from the product title, calls the middleware,
   and fills price / availability / specs. Fails silent (panel stays hidden). */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function extractHpeSku(title, sku) {
    var m = (title || '').match(/\bP\d{4,6}-\d{3}\b/i);   // P69302-005 in the title
    if (m) return m[0].toUpperCase();
    if (sku) return sku.toUpperCase().replace(/^CS/, ''); // CSP69302005 -> P69302005 (middleware is dash-insensitive)
    return null;
  }
  function money(n, cur) {
    if (n == null) return '—';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n);
    } catch (e) { return '$' + n; }
  }
  function availText(a) {
    if (!a) return '—';
    if (a.status === 'in_stock') return 'In stock' + (a.quantity != null ? ' · ' + a.quantity + ' units' : '');
    if (a.status === 'made_to_order') return 'Made to order' + (a.leadTimeDays ? ' · ships in ~' + a.leadTimeDays + ' days' : '');
    if (a.status === 'backorder') return 'Backorder' + (a.leadTimeDays ? ' · ~' + a.leadTimeDays + ' days' : '');
    return a.status || '—';
  }
  function availClass(a) {
    if (a && a.status === 'in_stock') return ' is-in-stock';
    if (a && (a.status === 'made_to_order' || a.status === 'backorder')) return ' is-lead';
    return '';
  }
  function init(el) {
    var endpoint = (el.getAttribute('data-endpoint') || '').replace(/\/$/, '');
    var sku = extractHpeSku(el.getAttribute('data-title'), el.getAttribute('data-sku'));
    if (!endpoint || !sku || /PLACEHOLDER/.test(endpoint)) return; // not wired yet — stay hidden
    fetch(endpoint + '/hpe/' + encodeURIComponent(sku))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        el.querySelector('[data-pm-hpe-price]').textContent = money(d.price && d.price.list, d.price && d.price.currency);
        var av = el.querySelector('[data-pm-hpe-avail]');
        av.textContent = availText(d.availability);
        av.className = 'pm-hpe__avail' + availClass(d.availability);
        var src = el.querySelector('[data-pm-hpe-source]');
        if (src) src.textContent = d.source ? 'via ' + d.source : '';
        var specsEl = el.querySelector('[data-pm-hpe-specs]');
        if (specsEl && d.specs && d.specs.length) {
          specsEl.innerHTML = d.specs.map(function (s) {
            return '<div class="pm-hpe__spec"><span class="pm-hpe__spec-k">' + esc(s.label) +
              '</span><span class="pm-hpe__spec-v">' + esc(s.value) + '</span></div>';
          }).join('');
        }
        var foot = el.querySelector('[data-pm-hpe-foot]');
        if (foot) foot.textContent = 'HPE SKU ' + d.sku + (d.fetchedAt ? ' · updated ' + new Date(d.fetchedAt).toLocaleDateString() : '');
        el.hidden = false;
      })
      .catch(function () { el.hidden = true; });
  }
  var nodes = document.querySelectorAll('[data-pm-hpe]');
  for (var i = 0; i < nodes.length; i++) init(nodes[i]);
})();
