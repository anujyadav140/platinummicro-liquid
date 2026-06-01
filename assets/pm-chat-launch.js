/**
 * PmChatLaunch — bridge the PM "Chat with us" CTA to Shopify Inbox.
 *
 * Shopify Inbox renders its own chat widget (a floating bubble) once the
 * app is installed and its app embed is enabled. It exposes no official
 * "open chat" API, so we best-effort locate its launcher and click it.
 *
 * Behaviour on click of any [data-pm-chat-open] element:
 *   - If we find + trigger the Inbox launcher → open the chat in place
 *     (preventDefault, stay on the page).
 *   - Otherwise → let the link's href fall through (defaults to the
 *     contact page), so the button always does something useful even
 *     before Inbox is live.
 *
 * If Inbox is installed and the chat still doesn't open, the selector list
 * below may need one entry added for your Inbox version — inspect the
 * launcher element and add its selector to INBOX_LAUNCHER_SELECTORS.
 */
(function () {
  'use strict';
  if (window.__pmChatLaunchBound) return;
  window.__pmChatLaunchBound = true;

  // Known/likely hooks for the Shopify Inbox launcher, most specific first.
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
    if (tryOpenInbox()) {
      e.preventDefault();
    }
  });
})();
