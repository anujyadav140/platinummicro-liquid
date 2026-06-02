/**
 * PmChatLaunch — bridge the PM "Chat with us" CTA to the store's live chat.
 *
 * Primary target: Tidio (Lyro AI). Tidio exposes an official JS API
 * (window.tidioChatApi / document.tidioChatApi) with .open() / .show(), so
 * we use that — reliable, no DOM guessing. Falls back to Shopify Inbox
 * (no public API, best-effort DOM click) and finally to the link's href
 * (the contact page), so the button always does something useful no matter
 * which app — if any — is currently installed.
 *
 * Behaviour on click of any [data-pm-chat-open] element:
 *   1. Tidio present  → open its chat in place (preventDefault).
 *   2. Inbox present  → click its launcher (preventDefault).
 *   3. Neither        → let the href fall through to the contact page.
 */
(function () {
  'use strict';
  if (window.__pmChatLaunchBound) return;
  window.__pmChatLaunchBound = true;

  // ── Tidio (preferred) ────────────────────────────────────────────────
  // Public API: https://docs.tidio.com/docs/javascript-api
  function tryOpenTidio() {
    var api = window.tidioChatApi || document.tidioChatApi;
    if (!api || typeof api.open !== 'function') return false;
    try {
      if (typeof api.show === 'function') api.show(); // un-hide launcher if hidden
      api.open();
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── Shopify Inbox (fallback, no public API) ──────────────────────────
  var INBOX_LAUNCHER_SELECTORS = [
    '#shopify-chat button',
    '#shopify-chat [role="button"]',
    '#shopify-chat',
    '[id^="shopify-chat"] button',
    'button[aria-label*="chat" i]',
    'button[aria-label*="message" i]',
    'shopify-chat'
  ];

  function tryOpenInbox() {
    for (var i = 0; i < INBOX_LAUNCHER_SELECTORS.length; i++) {
      var el = document.querySelector(INBOX_LAUNCHER_SELECTORS[i]);
      if (!el) continue;
      var clickable = el.tagName === 'BUTTON' ? el : (el.querySelector('button') || el);
      try {
        clickable.click();
        return true;
      } catch (e) { /* try next selector */ }
    }
    return false;
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-pm-chat-open]');
    if (!trigger) return;
    // Open the live chat if we can; otherwise the href (contact page) wins.
    if (tryOpenTidio() || tryOpenInbox()) {
      e.preventDefault();
    }
  });
})();
