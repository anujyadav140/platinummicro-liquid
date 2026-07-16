/**
 * PM — "You may also like" product recommendations (compact horizontal rail).
 *
 * Source: Shopify NATIVE recommendations (/recommendations/products.json?intent=related,
 * the store's own order/behavioral data). Fallback: same-category products from the
 * product's collection (data-fallback-collection) when the related set is thin (e.g.
 * freshly-imported HPE servers). No paid app; Search & Discovery enables intent=complementary.
 *
 * Renders a CDW-style horizontal scroll rail of small cards below the PDP specs, each with
 * an Add-to-Cart (in stock) or Request-a-Quote (out of stock) action. Lazy-loaded on scroll.
 *
 * build: pm-recommendations 2026-07-16-relevance-rank
 */
(function () {
  'use strict';
  var mount = document.querySelector('[data-pm-recs]');
  if (!mount) return;
  var pid     = mount.getAttribute('data-product-id');
  var intent  = mount.getAttribute('data-intent') || 'related';
  var need    = parseInt(mount.getAttribute('data-limit'), 10) || 10;
  var heading = mount.getAttribute('data-heading') || 'You may also like';
  var fbColl  = mount.getAttribute('data-fallback-collection') || '';
  // Quote-only PDPs set data-prefer-available="1": purchasable cards sort to
  // the front of the rail, and the buy-area "Need it sooner?" jump link
  // ([data-pm-recs-jump], shipped hidden) is revealed only when at least one
  // in-stock card actually renders. Absent the attribute (every other mount),
  // behavior is unchanged.
  var preferAvail = mount.getAttribute('data-prefer-available') === '1';
  var myVendor = (mount.getAttribute('data-vendor') || '').trim().toLowerCase();
  if (!pid) return;

  // First distinctive word of this product's title that isn't the vendor or a
  // part number — for "HPE P83287-005 ProLiant DL360 …" that's "proliant".
  var seriesToken = (function () {
    var t = (mount.getAttribute('data-title') || '').toLowerCase();
    var words = t.split(/[\s,\-–—/()]+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 4) continue;
      if (/\d/.test(w)) continue;                          // part numbers / capacities
      if (myVendor && myVendor.indexOf(w) >= 0) continue;  // the brand itself
      return w;
    }
    return '';
  })();

  // Relevance score. Shopify's intent=related is driven by order/behavioural
  // data this store doesn't have yet, so it happily returns 10 unrelated SKUs
  // (a ProLiant DL360 → NAS boxes, a motherboard, a heatsink) and — because it
  // fills the whole limit — it used to starve the vendor-collection fallback
  // that holds the actually-similar products. Rank same-vendor and same-series
  // first so the rail leads with real alternatives whatever Shopify suggests.
  // NB: product_type is deliberately not scored — this catalog sets it to
  // "Physical" on every product, so it carries no signal.
  function relevance(p) {
    var score = 0;
    if (myVendor && (p.vendor || '').trim().toLowerCase() === myVendor) score += 4;
    if (seriesToken && (p.title || '').toLowerCase().indexOf(seriesToken) >= 0) score += 3;
    return score;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function money(cents) {
    if (cents == null || cents <= 0) return 'Pricing by quote';
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }
    catch (e) { return '$' + (cents / 100).toFixed(2); }
  }
  function thumb(url) {
    if (!url) return '';
    // Size via ?width= (server-side transform, filename-agnostic) — never the
    // legacy _WxH filename suffix; migrated BC filenames carry ".jpg" mid-name.
    var u = String(url);
    if (u.slice(0, 2) === '//') u = 'https:' + u;
    if (/cdn\.shopify\.com|\/cdn\//.test(u) && !/[?&]width=/.test(u)) {
      u += (u.indexOf('?') >= 0 ? '&' : '?') + 'width=300';
    }
    return u;
  }
  // Normalize either shape (/recommendations/products.json OR /collections/*/products.json)
  // into one card model: { id, title, url, vendor, image, price(cents), available, variantId }.
  function norm(p) {
    var price = (typeof p.price === 'number')
      ? p.price
      : (p.variants && p.variants[0] && p.variants[0].price != null ? Math.round(parseFloat(p.variants[0].price) * 100) : 0);
    var image = p.featured_image || (p.images && p.images[0] ? (p.images[0].src || p.images[0]) : '');
    var available = (typeof p.available === 'boolean')
      ? p.available
      : (p.variants ? p.variants.some(function (v) { return v.available; }) : false);
    var vid = (p.first_available_variant && p.first_available_variant.id) ||
      (p.variants && p.variants.length ? ((p.variants.filter(function (v) { return v.available; })[0] || p.variants[0]).id) : null);
    return { id: p.id, title: p.title, url: (p.url || '/products/' + p.handle), vendor: p.vendor, image: image, price: price, available: available, variantId: vid };
  }

  var CART_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
  var DOC_SVG  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var CHEV_L = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  var CHEV_R = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

  function card(p) {
    var img = thumb(p.image);
    var btn = (p.available && p.variantId)
      ? '<button type="button" class="pm-recs__btn" data-pm-add data-variant-id="' + p.variantId + '">' + CART_SVG + '<span>Add to Cart</span></button>'
      : '<a class="pm-recs__btn pm-recs__btn--quote" href="' + esc(p.url) + '">' + DOC_SVG + '<span>Request a Quote</span></a>';
    return '<li class="pm-recs__card">' +
        '<a class="pm-recs__cardlink" href="' + esc(p.url) + '">' +
          '<div class="pm-recs__img">' +
            (img ? '<img src="' + esc(img) + '" alt="' + esc(p.title) + '" loading="lazy" width="300" height="300">' : '') +
          '</div>' +
          (p.vendor ? '<div class="pm-recs__brand">' + esc(p.vendor) + '</div>' : '') +
          '<div class="pm-recs__name">' + esc(p.title) + '</div>' +
          '<div class="pm-recs__price">' + money(p.price) + '</div>' +
        '</a>' + btn +
      '</li>';
  }

  function wireNav() {
    var list = mount.querySelector('.pm-recs__list');
    var prev = mount.querySelector('[data-recs-prev]');
    var next = mount.querySelector('[data-recs-next]');
    if (!list || !prev || !next) return;
    function stepBy() { return Math.max(240, Math.round(list.clientWidth * 0.85)); }
    function update() {
      var overflow = (list.scrollWidth - list.clientWidth) > 2;
      prev.hidden = !overflow; next.hidden = !overflow;
      if (!overflow) return;
      prev.disabled = list.scrollLeft <= 1;
      next.disabled = list.scrollLeft >= (list.scrollWidth - list.clientWidth - 1);
    }
    prev.addEventListener('click', function () { list.scrollBy({ left: -stepBy(), behavior: 'smooth' }); });
    next.addEventListener('click', function () { list.scrollBy({ left: stepBy(), behavior: 'smooth' }); });
    list.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update(); setTimeout(update, 150);
  }

  function render(products) {
    if (!products.length) return;
    // The quote-only mount's heading ("Similar items you can buy now") is a claim
    // about the rail's contents, so it only survives if the rail actually has a
    // purchasable card. Shopify's recommendation + fallback-collection endpoints
    // don't filter by stock, and whole categories here can be quote-only, so an
    // all-quote result is expected — fall back to the neutral heading rather
    // than title a wall of "Request a Quote" cards as in stock.
    var hasAvailable = false;
    for (var h = 0; h < products.length; h++) {
      if (products[h].available && products[h].variantId) { hasAvailable = true; break; }
    }
    var title = (preferAvail && !hasAvailable) ? 'You may also like' : heading;
    mount.innerHTML =
      '<section class="pm-recs" aria-label="' + esc(title) + '">' +
        '<div class="pm-container pm-recs__inner">' +
          '<header class="pm-recs__head">' +
            '<h2 class="pm-recs__title">' + esc(title) + '</h2>' +
            '<div class="pm-recs__nav">' +
              '<button type="button" class="pm-recs__navbtn" data-recs-prev aria-label="Scroll left" hidden>' + CHEV_L + '</button>' +
              '<button type="button" class="pm-recs__navbtn" data-recs-next aria-label="Scroll right" hidden>' + CHEV_R + '</button>' +
            '</div>' +
          '</header>' +
          '<ul class="pm-recs__list">' + products.map(card).join('') + '</ul>' +
        '</div>' +
      '</section>';
    wireNav();
    // wire injected Add-to-Cart buttons (pm-add-to-cart.js delegates on document)
    document.dispatchEvent(new CustomEvent('pm:plp-updated'));
    if (window.PmAddToCart && window.PmAddToCart.syncMaxed) window.PmAddToCart.syncMaxed();
    // Reveal the quote-only buy-area jump link(s) ONLY when the rendered rail
    // contains at least one genuinely purchasable card — the link promises
    // "in stock & ready to ship", so an all-quote rail keeps it hidden.
    if (preferAvail && hasAvailable) {
      var jumps = document.querySelectorAll('[data-pm-recs-jump]');
      for (var j = 0; j < jumps.length; j++) jumps[j].hidden = false;
    }
  }

  function getRelated() {
    return fetch('/recommendations/products.json?product_id=' + encodeURIComponent(pid) +
                 '&intent=' + encodeURIComponent(intent) + '&limit=' + need, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return ((d && d.products) || []).map(norm); })
      .catch(function () { return []; });
  }
  // The fallback collection is the product's own first real collection — on this
  // store that's typically the VENDOR collection (e.g. hewlett-packard-enterprise),
  // i.e. the best pool of genuinely similar SKUs. Fetch it ALWAYS, not just when
  // Shopify's related set is short: related returning a full 10 unrelated items
  // is exactly the case where we most need these candidates to compete.
  function getFallback() {
    if (!fbColl) return Promise.resolve([]);
    return fetch('/collections/' + encodeURIComponent(fbColl) + '/products.json?limit=250', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (fb) { return ((fb && fb.products) || []).map(norm); })
      .catch(function () { return []; });
  }

  var done = false;
  function load() {
    if (done) return; done = true;
    Promise.all([getRelated(), getFallback()])
      .then(function (res) {
        // Merge both pools, de-duped, excluding the product being viewed.
        // Shopify's related keeps a slight edge on ties by being added first.
        var seen = {}; seen[String(pid)] = 1;
        var pool = [];
        res[0].concat(res[1]).forEach(function (p) {
          if (!p || seen[String(p.id)]) return;
          seen[String(p.id)] = 1;
          pool.push(p);
        });

        // Rank: relevance (same vendor / same series) always wins — an unrelated
        // in-stock NAS is not a "similar item" to a ProLiant. Within equal
        // relevance, quote-only rails put buyable cards first (that rail promises
        // "you can buy now"); everything else keeps its incoming order.
        return pool
          .map(function (p, i) { return { p: p, i: i, r: relevance(p) }; })
          .sort(function (a, b) {
            if (b.r !== a.r) return b.r - a.r;
            if (preferAvail) {
              var d = (b.p.available ? 1 : 0) - (a.p.available ? 1 : 0);
              if (d) return d;
            }
            return a.i - b.i;
          })
          .slice(0, need)
          .map(function (x) { return x.p; });
      })
      .then(render)
      .catch(function () {});
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); load(); break; }
      }
    }, { rootMargin: '600px 0px' });
    io.observe(mount);
  } else {
    load();
  }
})();
