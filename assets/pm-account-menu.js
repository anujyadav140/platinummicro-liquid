/* PM — Account menu: dropdown behaviour + unread-message signifier.
 *
 * The signed-in header account menu is a native <details> we own (see
 * sections/pm-header.liquid). This script:
 *   1. adds the niceties a bare <details> lacks — close on outside-click, close
 *      on Escape, and an explicit ✕ button;
 *   2. drives the unread-message badge shown on the account avatar (header +
 *      mobile drawer) and next to the "Messages" links.
 *
 * Unread model (per device, no network):
 *   · <body data-pm-msg-teamcount> is stamped server-side = how many thread
 *     entries the Platinum Micro team has sent this customer (custom.thread
 *     metafield, entries whose `from` is NOT "You"). See layout/theme.liquid.
 *   · localStorage `pm:msgs:read` holds the count the customer has already SEEN.
 *   · unread = max(0, teamCount − read). When > 0 we light every [data-msg-badge]
 *     (avatar) and [data-msg-linkbadge] (Messages row) with the number.
 *   · Visiting /pages/messages — or clicking any Messages link — marks all seen.
 */
(function () {
  'use strict';

  var READ_KEY  = 'pm:msgs:read';
  var MSGS_PATH = '/pages/messages';

  function teamCount() {
    var v = document.body && document.body.getAttribute('data-pm-msg-teamcount');
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }
  function readCount() {
    try { var n = parseInt(window.localStorage.getItem(READ_KEY), 10); return isNaN(n) ? 0 : n; }
    catch (e) { return 0; }
  }
  function setReadCount(n) {
    try { window.localStorage.setItem(READ_KEY, String(n)); } catch (e) {}
  }
  function unread() {
    var u = teamCount() - readCount();
    return u > 0 ? u : 0;
  }

  // Paint (or clear) every unread signifier currently in the DOM.
  function paint() {
    var n = unread();
    var label = n > 9 ? '9+' : String(n);
    var badges = document.querySelectorAll('[data-msg-badge], [data-msg-linkbadge]');
    badges.forEach(function (el) {
      if (n > 0) { el.textContent = label; el.removeAttribute('hidden'); }
      else { el.textContent = ''; el.setAttribute('hidden', ''); }
    });
  }

  // Everything the team has sent is now considered seen.
  function markRead() {
    setReadCount(teamCount());
    paint();
  }

  function init() {
    if (!document.body) return;

    // Seeing the Message Center == reading the thread.
    if (location.pathname.indexOf(MSGS_PATH) === 0) markRead();
    else paint();

    // Clicking any Messages link clears the badge right away (optimistic — the
    // page load then confirms it via markRead()).
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('[data-msg-link]')) markRead();
    });

    // Recompute when returning via the bfcache (back/forward) — the marker or
    // the server count may have changed since this page was frozen.
    window.addEventListener('pageshow', function (e) { if (e.persisted) paint(); });

    // ── Desktop <details> account dropdown niceties ──
    var acct = document.querySelector('[data-pm-amenu]');
    if (acct) {
      // Close when clicking anywhere outside the open menu.
      document.addEventListener('click', function (e) {
        if (!acct.open) return;
        if (!acct.contains(e.target)) acct.removeAttribute('open');
      });
      // Close on Escape, returning focus to the trigger.
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && acct.open) {
          acct.removeAttribute('open');
          var trigger = acct.querySelector('.pm-amenu__trigger');
          if (trigger && trigger.focus) trigger.focus();
        }
      });
      // Explicit ✕ button inside the card.
      var closeBtn = acct.querySelector('[data-pm-amenu-close]');
      if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
          e.preventDefault();
          acct.removeAttribute('open');
        });
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
