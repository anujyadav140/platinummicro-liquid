/**
 * PmHeader — Mega menu + mobile nav interactions
 * Ported from the Hydrogen pm-header.tsx component
 */
(function() {
  'use strict';

  var HOVER_OPEN_DELAY  = 40;
  var HOVER_CLOSE_DELAY = 120;

  var openKey    = null;
  var openTimer  = null;
  var closeTimer = null;

  function getNavItem(key) {
    return document.querySelector('.pm-nav__item[data-key="' + key + '"]');
  }

  function getMega(key) {
    return document.getElementById('pm-mega-' + key);
  }

  function openPanel(key) {
    // Close current panel if different
    if (openKey && openKey !== key) {
      var prev = getNavItem(openKey);
      var prevMega = getMega(openKey);
      if (prev)     { prev.classList.remove('is-open'); prev.querySelector('.pm-nav__link') && prev.querySelector('.pm-nav__link').setAttribute('aria-expanded', 'false'); }
      if (prevMega) { prevMega.classList.remove('is-visible'); }
    }

    openKey = key;
    var item = getNavItem(key);
    var mega = getMega(key);
    if (item) { item.classList.add('is-open'); item.querySelector('.pm-nav__link') && item.querySelector('.pm-nav__link').setAttribute('aria-expanded', 'true'); }
    if (mega) { mega.classList.add('is-visible'); }
  }

  function closePanel() {
    if (!openKey) return;
    var item = getNavItem(openKey);
    var mega = getMega(openKey);
    if (item) { item.classList.remove('is-open'); item.querySelector('.pm-nav__link') && item.querySelector('.pm-nav__link').setAttribute('aria-expanded', 'false'); }
    if (mega) { mega.classList.remove('is-visible'); }
    openKey = null;
  }

  window.PmHeader = {
    scheduleOpen: function(key) {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      if (openTimer)  { clearTimeout(openTimer); }
      openTimer = setTimeout(function() { openPanel(key); }, HOVER_OPEN_DELAY);
    },
    scheduleClose: function() {
      if (openTimer) { clearTimeout(openTimer); openTimer = null; }
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(closePanel, HOVER_CLOSE_DELAY);
    },
    cancelClose: function() {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    }
  };

  // Escape key closes mega
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closePanel();
  });

  // Click outside closes mega
  document.addEventListener('click', function(e) {
    if (!openKey) return;
    var header = document.getElementById('pm-header');
    if (header && !header.contains(e.target)) closePanel();
  });

  // ── Mobile nav ──────────────────────────────────────────────────────────
  function initMobileNav() {
    var openBtn    = document.getElementById('pm-mobile-open');
    var closeBtn   = document.getElementById('pm-mobile-close');
    var backdrop   = document.getElementById('pm-mobile-backdrop');
    var mobileNav  = document.getElementById('pm-mobile-nav');

    if (!mobileNav) return;

    function openMobile() {
      mobileNav.classList.add('is-open');
      mobileNav.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
    }

    function closeMobile() {
      mobileNav.classList.remove('is-open');
      mobileNav.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    }

    if (openBtn)   openBtn.addEventListener('click', openMobile);
    if (closeBtn)  closeBtn.addEventListener('click', closeMobile);
    if (backdrop)  backdrop.addEventListener('click', closeMobile);

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && mobileNav.classList.contains('is-open')) closeMobile();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileNav);
  } else {
    initMobileNav();
  }

  // ── Top-bar dismiss ──
  // Dismiss + restore is now owned by the per-bar inline script in
  // snippets/pm-top-bar-body.liquid, which tracks dismissals by CONTENT
  // signature in localStorage (key pm:topbar-dismissed:v1). That makes
  // dismissal content-aware: edited/new banners re-appear, and old per-bar
  // dismiss cookies are simply ignored. Nothing to do here.

})();
