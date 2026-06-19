/* =============================================================================
   pm-focus-trap.js — minimal WAI-ARIA modal-dialog focus management.
   PM theme JS · shared helper (loaded before the dialog scripts).

   window.PmFocusTrap.trap(el, opts) — call when a dialog OPENS:
     • remembers the element that was focused (the trigger),
     • moves focus into the dialog (opts.initial selector, else first focusable),
     • wraps Tab / Shift+Tab so keyboard focus can't leave the open dialog.
   window.PmFocusTrap.release() — call when it CLOSES: unbinds the Tab handler
     and restores focus to the trigger.

   Purely additive: each dialog opts in by calling trap() in its open() and
   release() in its close(). Escape-to-close stays owned by each dialog. Only
   ONE trap is active at a time (trap() releases any prior one first).
   ============================================================================= */
(function () {
  'use strict';

  var FOCUSABLE = [
    'a[href]', 'area[href]', 'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]'
  ].join(',');

  var active = null; // { el, prevFocus }

  function isVisible(n) {
    return !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length) &&
      getComputedStyle(n).visibility !== 'hidden';
  }

  // Recomputed on every Tab so dialogs that render their content client-side
  // (e.g. the cart drawer) always trap the CURRENT set of controls.
  function focusables(el) {
    return Array.prototype.filter.call(el.querySelectorAll(FOCUSABLE), isVisible);
  }

  function onKeydown(e) {
    if (!active || e.key !== 'Tab') return; // only Tab — Esc stays each dialog's job
    var list = focusables(active.el);
    if (!list.length) { e.preventDefault(); return; }
    var first = list[0], last = list[list.length - 1], cur = document.activeElement;
    if (!active.el.contains(cur)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }

  function focusInto(el, initial) {
    var target = (initial && el.querySelector(initial)) || focusables(el)[0] || el;
    if (target === el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (e2) {} }
  }

  window.PmFocusTrap = {
    trap: function (el, opts) {
      if (!el) return;
      opts = opts || {};
      if (active) this.release(); // never nest two traps
      active = { el: el, prevFocus: document.activeElement };
      document.addEventListener('keydown', onKeydown, true);
      // Defer one frame so a just-toggled .is-open class / open transition has
      // applied before we move focus (the trigger is already captured above).
      var initial = opts.initial;
      if (window.requestAnimationFrame) {
        requestAnimationFrame(function () { if (active && active.el === el) focusInto(el, initial); });
      } else {
        focusInto(el, initial);
      }
    },
    release: function () {
      if (!active) return;
      document.removeEventListener('keydown', onKeydown, true);
      var prev = active.prevFocus;
      active = null;
      if (prev && prev.isConnected && typeof prev.focus === 'function') {
        try { prev.focus({ preventScroll: true }); } catch (e) { try { prev.focus(); } catch (e2) {} }
      }
    },
    isActive: function () { return !!active; }
  };
})();
