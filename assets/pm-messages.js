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

  var QUOTE_KEY = 'pm:quote:v1';

  /* The old device-local sent log leaked messages across accounts on a
     shared browser (localStorage doesn't know who's signed in). The thread
     metafield is the private, per-customer record now — purge the old key
     everywhere. */
  try { window.localStorage.removeItem('pm:msgs:v1'); } catch (e) {}

  function readJson(key) {
    try {
      var raw = window.localStorage.getItem(key);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── Transient "just sent" card (this page view only, never stored) ──
     The permanent copy is written into the customer's thread metafield by
     the sync and renders server-side on the next visit. */
  var sentSlot = root.querySelector('[data-pm-msgs-sent]');
  function showJustSent(f) {
    if (!sentSlot) return;
    sentSlot.insertAdjacentHTML('afterbegin',
      '<article class="pm-msgs__item" data-kind="team">' +
        '<div class="pm-msgs__item-ico" aria-hidden="true">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
        '</div>' +
        '<div class="pm-msgs__item-body">' +
          '<div class="pm-msgs__item-head">' +
            '<span class="pm-msgs__item-title">You → Platinum Micro' +
              (f.topic ? ' <span class="pm-msgs__pill pm-msgs__pill--pay">' + esc(f.topic) + '</span>' : '') +
              (f.ref ? ' <span class="pm-msgs__pill pm-msgs__pill--ful">' + esc(f.ref) + '</span>' : '') +
            '</span>' +
            '<time class="pm-msgs__item-date">just now</time>' +
          '</div>' +
          '<p class="pm-msgs__item-text">' + esc(f.body).replace(/\n/g, '<br>') + '</p>' +
        '</div>' +
      '</article>');
  }

  /* ── Sending ──
     Messages POST to FormSubmit (formsubmit.co) — a hosted, no-account,
     no-server form-to-email relay. It emails the team on EVERY message,
     unconditionally: no online/offline or bot gating (Tidio), no silent
     spam-drop (Shopify's native form). The customer's email is the
     reply-to, so the team answers them directly from the inbox. First
     submission to a new address triggers a one-time "Activate Form"
     email that must be clicked; after that, delivery is automatic. On a
     network failure it falls back to the native Shopify contact POST so
     a message always has a path out. */
  var FORM_ENDPOINT = 'https://formsubmit.co/ajax/anuj@platinummicro.com';
  var FORM_CC = 'anujyadav160@gmail.com'; // backup inbox + lets delivery be verified

  function showOk(form, msg) {
    var ok = form.querySelector('.pm-msgs__ok');
    if (!ok) {
      ok = document.createElement('div');
      ok.className = 'pm-msgs__ok';
      ok.setAttribute('role', 'status');
      form.insertBefore(ok, form.firstChild);
    }
    ok.textContent = msg;
  }

  function wireComposer(form, getFields, logSent) {
    if (!form) return;
    form.addEventListener('submit', function (e) {
      var f = getFields(form);
      if (!f || !f.body) return; // empty -> native required-field validation
      if (f.hp) { e.preventDefault(); form.reset(); return; } // honeypot: swallow silently
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var orig = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      var payload = {
        name: f.name || '(no name)',
        email: f.email || '',
        topic: f.topic || 'Message',
        reference: f.ref || '(none)',
        message: f.body,
        _subject: '[Message Center] ' + (f.topic || 'Message') + (f.ref ? ' · ' + f.ref : '') + ' — ' + (f.name || f.email || 'customer'),
        _cc: FORM_CC,
        _template: 'table',
        _captcha: 'false'
      };

      function finish() { if (btn) { btn.disabled = false; btn.textContent = orig || 'Send message'; } }

      fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function () {
          // Any 200 = FormSubmit accepted it (delivery is automatic once activated).
          if (logSent) showJustSent(f);
          showOk(form, 'Message sent — our team replies by email, and this message will appear in your thread here shortly.');
          form.reset();
          finish();
        })
        .catch(function () { finish(); form.submit(); }); // relay unreachable -> native Shopify POST
    });
  }

  // Signed-in composer
  wireComposer(root.querySelector('.pm-msgs__form--main'), function (form) {
    var topic = form.querySelector('[data-pm-msgs-topic]');
    var ref   = form.querySelector('[data-pm-msgs-ref]');
    var body  = form.querySelector('[data-pm-msgs-body]');
    var hp    = form.querySelector('input[name="website"]');
    var name  = form.querySelector('input[name="contact[name]"]');
    var email = form.querySelector('input[name="contact[email]"]');
    return {
      name:  name ? name.value : '',
      email: email ? email.value : '',
      topic: topic ? topic.value : '',
      ref:   ref ? ref.value.trim() : '',
      body:  body ? body.value.trim() : '',
      hp:    hp ? hp.value : ''
    };
  }, true);

  // Guest composer
  wireComposer(root.querySelector('.pm-msgs__guest form'), function (form) {
    var name  = form.querySelector('#pm-msgs-gname');
    var email = form.querySelector('#pm-msgs-gmail');
    var body  = form.querySelector('#pm-msgs-gbody');
    var hp    = form.querySelector('input[name="website"]');
    return {
      name:  name ? name.value.trim() : '',
      email: email ? email.value.trim() : '',
      topic: 'Guest message',
      ref:   '',
      body:  body ? body.value.trim() : '',
      hp:    hp ? hp.value : ''
    };
  }, false);

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
      else {
        // Tab-specific empty copy (data-empty-<kind> on the note element).
        var msg = emptyNote.getAttribute('data-empty-' + kind);
        if (msg) emptyNote.textContent = msg;
        emptyNote.removeAttribute('hidden');
      }
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
