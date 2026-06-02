/* ──────────────────────────────────────────────────────────────────────────
   PM — Pin Shopify's <shopify-account> popup directly below the Sign in /
   Account trigger.

   v2: MutationObserver-based detection. The signed-in popup uses a
   different element than the signed-out one (one's a <dialog>, the other
   may be <aside role="dialog"> or a <div popover>), so instead of guessing
   selectors we observe the shopify-account subtree for ANY element that
   appears with popup-like dimensions (width 200-500, height >= 100) and
   pin it.

   Pinning = set position: fixed; top: trigger.bottom + 8; right: window.innerWidth - trigger.right - SHIFT
   so the popup hangs from the trigger's right edge, shifted SHIFT pixels
   further right (so the dropdown body extends mostly rightward instead of
   overflowing leftward by hundreds of pixels).
   ──────────────────────────────────────────────────────────────────────── */

(function () {
  if (window.__pmAuthAnchorBound) return;
  window.__pmAuthAnchorBound = true;

  // Extra right-shift past the trigger's right edge. Negative = popup
  // sits to the LEFT of the trigger's right edge (overflows leftward).
  var EXTRA_RIGHT_SHIFT_PX = 144;

  var pinnedEl  = null;
  var observers = [];
  var trigger   = null;

  function findTrigger() {
    var sa = document.querySelector('shopify-account.pm-header__shopify-account');
    if (!sa) return null;
    // Use whichever avatar slot is visible (signed-out OR signed-in).
    var avatars = sa.querySelectorAll('[slot="signed-out-avatar"], [slot="signed-in-avatar"]');
    for (var i = 0; i < avatars.length; i++) {
      var r = avatars[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return avatars[i];
    }
    return sa;
  }

  function pinTo(el) {
    if (!el) return;
    var t = findTrigger();
    if (!t) return;
    var rect = t.getBoundingClientRect();
    if (rect.width === 0) return;
    var rightFromViewport = Math.max(8, window.innerWidth - rect.right - EXTRA_RIGHT_SHIFT_PX);
    var topFromViewport   = rect.bottom + 8;
    el.style.setProperty('position', 'fixed', 'important');
    el.style.setProperty('top',      topFromViewport   + 'px', 'important');
    el.style.setProperty('right',    rightFromViewport + 'px', 'important');
    el.style.setProperty('left',     'auto', 'important');
    el.style.setProperty('bottom',   'auto', 'important');
    el.style.setProperty('margin',   '0', 'important');
    pinnedEl = el;
  }

  // Test whether an element looks like a popup we should pin.
  function looksLikePopup(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute && el.getAttribute('role');
    var hasPopover = el.hasAttribute && el.hasAttribute('popover');
    var isContainer = tag === 'dialog' || tag === 'aside' || role === 'dialog' || role === 'menu' || hasPopover;
    if (!isContainer) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 200 && r.width <= 600 && r.height >= 100;
  }

  // Walk a subtree looking for a popup-like element.
  function scanForPopup(root, depth) {
    if (!root || depth > 14) return null;
    var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (looksLikePopup(e)) return e;
      if (e.shadowRoot) {
        var r = scanForPopup(e.shadowRoot, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  // Set up mutation observers on every shadow root inside shopify-account
  // so we get notified whenever a popup is mounted/removed/resized.
  function observeAll(root, depth) {
    if (!root || depth > 14) return;
    if (root.nodeType === 11 /* DOCUMENT_FRAGMENT (shadow root) */ || root === document) {
      var mo = new MutationObserver(function () {
        var found = scanForPopup(root, 0);
        if (found && found !== pinnedEl) pinTo(found);
        // Even if same element, re-pin in case Shopify re-rendered its style
        if (pinnedEl) pinTo(pinnedEl);
      });
      try {
        mo.observe(root.host ? root : root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'open', 'hidden'] });
        observers.push(mo);
      } catch (e) { /* ignore unsupported roots */ }
    }
    var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) observeAll(all[i].shadowRoot, depth + 1);
    }
  }

  function teardownObservers() {
    observers.forEach(function (mo) { mo.disconnect(); });
    observers = [];
    pinnedEl = null;
  }

  // Kick off after first click on the account trigger. We re-setup
  // observers each open in case Shopify replaced shadow roots between
  // signed-out / signed-in transitions.
  document.addEventListener('click', function (e) {
    var sa = e.target.closest('shopify-account.pm-header__shopify-account');
    if (!sa) return;
    trigger = findTrigger();
    // Give Shopify a beat to mount the popup, then observe and pin.
    setTimeout(function () {
      teardownObservers();
      // Immediate scan in case the popup is already there.
      var found = scanForPopup(sa, 0);
      if (!found && sa.shadowRoot) found = scanForPopup(sa.shadowRoot, 0);
      if (found) pinTo(found);
      // Set up observers for any future changes (shopify may re-render).
      observeAll(sa, 0);
      if (sa.shadowRoot) observeAll(sa.shadowRoot, 0);
    }, 0);

    // Aggressive re-pin loop for the first 2 seconds in case the popup
    // mounts after MutationObserver setup or Shopify keeps overriding
    // the style.
    var t0 = Date.now();
    var burst = setInterval(function () {
      var found = pinnedEl || scanForPopup(sa, 0) || (sa.shadowRoot && scanForPopup(sa.shadowRoot, 0));
      if (found) pinTo(found);
      if (Date.now() - t0 > 2000) clearInterval(burst);
    }, 60);
  }, true);

  // Re-pin on viewport changes.
  window.addEventListener('resize', function () { if (pinnedEl) pinTo(pinnedEl); });
  window.addEventListener('scroll', function () { if (pinnedEl) pinTo(pinnedEl); }, { passive: true });
})();
