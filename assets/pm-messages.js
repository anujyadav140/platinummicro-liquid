/* PM — Message Center (BETA) client wiring.
 * Everything here is additive and page-local:
 *   · tab filtering over server-rendered feed items (data-kind)
 *   · quote-cart status card read from the pm-quote store (pm:quote:v1)
 *   · a device-local "sent messages" log (pm:msgs:v1) so customers see
 *     what they've sent from this browser (replies arrive by email /
 *     the staff thread metafield)
 * No other surface reads these hooks; removing this file only blanks
 * the two JS-filled slots on /pages/messages.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-pm-msgs]');
  if (!root) return;

  var SENT_KEY = 'pm:msgs:v1';
  var QUOTE_KEY = 'pm:quote:v1';
  var MAX_SENT = 30;

  function readJson(key) {
    try {
      var raw = window.localStorage.getItem(key);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function writeSent(items) {
    try { window.localStorage.setItem(SENT_KEY, JSON.stringify(items.slice(-MAX_SENT))); }
    catch (e) { /* quota/private mode — the send itself still went through */ }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return ''; }
  }

  /* ── Sent-message log (this device) ── */
  var sentSlot = root.querySelector('[data-pm-msgs-sent]');
  function renderSent() {
    if (!sentSlot) return;
    var items = readJson(SENT_KEY).slice().reverse();
    sentSlot.innerHTML = items.map(function (m) {
      return (
        '<article class="pm-msgs__item" data-kind="team">' +
          '<div class="pm-msgs__item-ico" aria-hidden="true">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
          '</div>' +
          '<div class="pm-msgs__item-body">' +
            '<div class="pm-msgs__item-head">' +
              '<span class="pm-msgs__item-title">You → Platinum Micro' +
                (m.topic ? ' <span class="pm-msgs__pill pm-msgs__pill--pay">' + esc(m.topic) + '</span>' : '') +
                (m.ref ? ' <span class="pm-msgs__pill pm-msgs__pill--ful">' + esc(m.ref) + '</span>' : '') +
              '</span>' +
              '<time class="pm-msgs__item-date">' + esc(fmtDate(m.ts)) + '</time>' +
            '</div>' +
            '<p class="pm-msgs__item-text">' + esc(m.body).replace(/\n/g, '<br>') + '</p>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }
  renderSent();

  /* Log outgoing messages at submit time (the form then posts to Shopify,
     which emails the store and reloads with the success banner). */
  var form = root.querySelector('.pm-msgs__form--main');
  if (form) {
    form.addEventListener('submit', function () {
      var topic = form.querySelector('[data-pm-msgs-topic]');
      var ref   = form.querySelector('[data-pm-msgs-ref]');
      var body  = form.querySelector('[data-pm-msgs-body]');
      if (!body || !body.value.trim()) return;
      var items = readJson(SENT_KEY);
      items.push({
        ts: Date.now(),
        topic: topic ? topic.value : '',
        ref: ref ? ref.value.trim() : '',
        body: body.value.trim()
      });
      writeSent(items);
    });
  }

  /* ── Quote-cart status card ── */
  var quoteSlot = root.querySelector('[data-pm-msgs-quotes]');
  if (quoteSlot) {
    var qItems = readJson(QUOTE_KEY);
    if (qItems.length) {
      var lines = qItems.slice(0, 4).map(function (q) { return esc(q.name || q.sku); });
      var more = qItems.length > 4 ? ' + ' + (qItems.length - 4) + ' more' : '';
      quoteSlot.innerHTML =
        '<article class="pm-msgs__item" data-kind="quotes">' +
          '<div class="pm-msgs__item-ico" aria-hidden="true">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          '</div>' +
          '<div class="pm-msgs__item-body">' +
            '<div class="pm-msgs__item-head">' +
              '<span class="pm-msgs__item-title">Quote cart <span class="pm-msgs__pill pm-msgs__pill--pay">Draft</span></span>' +
            '</div>' +
            '<p class="pm-msgs__item-text">' + qItems.length + ' item' + (qItems.length === 1 ? '' : 's') +
              ' waiting to be submitted: ' + lines.join(', ') + more + '.</p>' +
            '<a class="pm-msgs__item-link" href="/cart">Review &amp; request the quote</a>' +
          '</div>' +
        '</article>';
    } else {
      quoteSlot.innerHTML =
        '<article class="pm-msgs__item" data-kind="quotes">' +
          '<div class="pm-msgs__item-ico" aria-hidden="true">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          '</div>' +
          '<div class="pm-msgs__item-body">' +
            '<div class="pm-msgs__item-head"><span class="pm-msgs__item-title">No open quote requests</span></div>' +
            '<p class="pm-msgs__item-text">Add products with "Request a Quote" and submit from the cart — our team prices volume orders within one business day. Submitted quotes are answered by email.</p>' +
          '</div>' +
        '</article>';
    }
  }

  /* ── Tabs ── */
  var tabs = root.querySelectorAll('[data-pm-msgs-tab]');
  var emptyNote = root.querySelector('[data-pm-msgs-empty]');
  function applyTab(kind) {
    var any = false;
    root.querySelectorAll('.pm-msgs__item').forEach(function (it) {
      var show = kind === 'all' || it.getAttribute('data-kind') === kind;
      if (show) { it.removeAttribute('hidden'); any = true; }
      else it.setAttribute('hidden', '');
    });
    if (emptyNote) {
      if (any) emptyNote.setAttribute('hidden', '');
      else emptyNote.removeAttribute('hidden');
    }
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) {
        var on = x === t;
        x.classList.toggle('is-active', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      applyTab(t.getAttribute('data-pm-msgs-tab'));
    });
  });
})();
