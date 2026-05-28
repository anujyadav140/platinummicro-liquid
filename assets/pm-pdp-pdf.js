/*  PM — PDP Datasheet PDF generator
 *  ----------------------------------------------------------------------
 *  Wires the "Download datasheet (PDF)" button in the PDP buy-box.
 *  Reads structured product data from the #pm-pdp-pdf-data JSON island,
 *  lazy-loads jsPDF on first click, composes a clean B2B-friendly PDF
 *  (header → title + meta + image → description → features → spec table
 *  → footer with URL + page numbers) and triggers a download.
 *
 *  Buyers can forward the PDF to procurement / IT teams without sharing
 *  the Shopify URL — the file is self-contained.
 *
 *  jsPDF (~50 KB gzipped) is loaded from a CDN on first click so the
 *  PDP first-paint cost is zero. After load it's cached for subsequent
 *  clicks in the same session.
 */
(function () {
  'use strict';

  // ── jsPDF lazy-loader ──────────────────────────────────────────────────
  var JSPDF_SRC = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
  var jspdfPromise = null;

  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (jspdfPromise) return jspdfPromise;
    jspdfPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = JSPDF_SRC;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload  = function () { resolve(); };
      s.onerror = function () { reject(new Error('jsPDF failed to load')); };
      document.head.appendChild(s);
    });
    return jspdfPromise;
  }

  // ── Data island reader ────────────────────────────────────────────────
  function readData() {
    var el = document.getElementById('pm-pdp-pdf-data');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || '{}');
    } catch (e) {
      console.warn('[pm-pdp-pdf] bad JSON in data island', e);
      return null;
    }
  }

  // Description HTML → array of plain-text paragraphs, preserving
  // paragraph / list / heading boundaries.
  function parseDescriptionHTML(html) {
    if (!html) return [];
    var docp = null;
    try {
      docp = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      // Fall back: strip tags crudely, single paragraph.
      var stripped = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return stripped ? [stripped] : [];
    }
    var blocks = docp.body.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, div');
    var out = [];
    blocks.forEach(function (el) {
      // Skip wrappers whose only content is already in their children
      // we've collected. Cheap heuristic: only emit if it has no
      // block-level descendants of the same set we walk.
      if (el.querySelector('p, li, h1, h2, h3, h4, h5, h6')) return;
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    });
    if (!out.length) {
      var t = (docp.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out;
  }

  // ── Image loader (canvas → data URL, handles CORS + transparency) ─────
  function fetchImageAsDataURL(url) {
    if (!url) return Promise.resolve(null);
    // Normalise protocol-relative Shopify CDN URLs.
    if (url.indexOf('//') === 0) url = 'https:' + url;
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width  = img.naturalWidth;
          canvas.height = img.naturalHeight;
          var ctx = canvas.getContext('2d');
          // Paint a white background so PNG transparency doesn't render
          // black against the PDF.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.86));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function fileSafe(s) {
    return (s || 'product')
      .replace(/[^a-z0-9-_]/gi, '_')
      .replace(/_+/g, '_')
      .slice(0, 60);
  }

  function todayLong() {
    try {
      return new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    } catch (e) {
      return new Date().toDateString();
    }
  }

  // Brand colours mirror pm-theme.css custom props.
  var NAVY    = [13, 35, 64];
  var INK_700 = [50, 60, 75];
  var INK_500 = [120, 130, 145];
  var INK_300 = [200, 207, 218];
  var ZEBRA   = [245, 247, 250];
  var OK_GREEN = [16, 110, 64];
  var AMBER    = [160, 100, 25];

  function setRGB(doc, fn, rgb) { doc[fn](rgb[0], rgb[1], rgb[2]); }

  function ensureSpace(doc, y, needed, M, H) {
    if (y + needed > H - M - 44) {
      doc.addPage();
      return M;
    }
    return y;
  }

  function sectionHeader(doc, label, y, M, W) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setRGB(doc, 'setTextColor', NAVY);
    doc.text(label.toUpperCase(), M, y);
    setRGB(doc, 'setDrawColor', INK_300);
    doc.setLineWidth(0.5);
    doc.line(M, y + 4, W - M, y + 4);
    return y + 18;
  }

  // ── Main PDF build ────────────────────────────────────────────────────
  function generatePDF(data, btn) {
    var labelEl = btn.querySelector('[data-pm-pdp-pdf-label]');
    var original = labelEl ? labelEl.textContent : null;
    btn.disabled = true;
    if (labelEl) labelEl.textContent = 'Preparing…';

    return loadJsPDF()
      .then(function () { return fetchImageAsDataURL(data.image); })
      .then(function (imgData) {
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ unit: 'pt', format: 'letter' });

        var W = doc.internal.pageSize.getWidth();
        var H = doc.internal.pageSize.getHeight();
        var M = 48;
        var y = M;

        // ── Top brand band ──
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        setRGB(doc, 'setTextColor', NAVY);
        doc.text((data.shop || 'Platinum Micro').toUpperCase(), M, y);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        setRGB(doc, 'setTextColor', INK_500);
        doc.text(todayLong(), W - M, y, { align: 'right' });

        y += 6;
        setRGB(doc, 'setDrawColor', INK_300);
        doc.setLineWidth(0.5);
        doc.line(M, y, W - M, y);
        y += 22;

        // ── Image (right) + Title/meta block (left) ──
        var imgBoxW = 180;
        var imgBoxH = 135;
        var textRight = imgData ? (W - M - imgBoxW - 16) : W;

        if (imgData) {
          setRGB(doc, 'setFillColor', [255, 255, 255]);
          setRGB(doc, 'setDrawColor', INK_300);
          doc.roundedRect(W - M - imgBoxW, y, imgBoxW, imgBoxH, 4, 4, 'FD');
          try {
            // Fit image into the card with 6pt internal padding.
            doc.addImage(imgData, 'JPEG', W - M - imgBoxW + 6, y + 6, imgBoxW - 12, imgBoxH - 12);
          } catch (e) { /* skip on bad image */ }
        }

        // Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        setRGB(doc, 'setTextColor', NAVY);
        var titleLines = doc.splitTextToSize(data.title || '', textRight - M);
        doc.text(titleLines, M, y + 14);
        var afterTitleY = y + 14 + (titleLines.length * 18) + 2;

        // Vendor / SKU / MPN / UPC line
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        setRGB(doc, 'setTextColor', INK_500);
        var bits = [];
        if (data.vendor) bits.push('Brand: ' + data.vendor);
        if (data.sku)    bits.push('SKU: '   + data.sku);
        if (data.mpn && data.mpn !== data.sku) bits.push('MPN: ' + data.mpn);
        if (data.upc)    bits.push('UPC: '   + data.upc);
        var metaLines = doc.splitTextToSize(bits.join('  ·  '), textRight - M);
        doc.text(metaLines, M, afterTitleY);
        var afterMetaY = afterTitleY + (metaLines.length * 13) + 8;

        // Price
        var afterPriceY = afterMetaY;
        if (data.price) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(20);
          setRGB(doc, 'setTextColor', NAVY);
          doc.text(String(data.price), M, afterMetaY + 14);
          afterPriceY = afterMetaY + 22;
        }

        // Availability
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        if (data.available) {
          setRGB(doc, 'setTextColor', OK_GREEN);
          doc.text(
            'IN STOCK' + (data.stock ? '  ·  ' + data.stock + ' units' : ''),
            M, afterPriceY + 14
          );
        } else {
          setRGB(doc, 'setTextColor', AMBER);
          doc.text('CONTACT FOR AVAILABILITY', M, afterPriceY + 14);
        }
        var afterAvailY = afterPriceY + 22;

        // Move y past whichever side is taller.
        y = Math.max(afterAvailY + 8, y + (imgData ? imgBoxH : 0) + 12);
        y += 8;

        // ── Description ──
        var paras = parseDescriptionHTML(data.description_html || '');
        if (paras.length) {
          y = ensureSpace(doc, y, 60, M, H);
          y = sectionHeader(doc, 'Description', y, M, W);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          setRGB(doc, 'setTextColor', INK_700);
          paras.forEach(function (p) {
            var lines = doc.splitTextToSize(p, W - 2 * M);
            y = ensureSpace(doc, y, lines.length * 13 + 6, M, H);
            doc.text(lines, M, y);
            y += lines.length * 13 + 6;
          });
          y += 8;
        }

        // ── Key features ──
        if (Array.isArray(data.features) && data.features.length) {
          y = ensureSpace(doc, y, 60, M, H);
          y = sectionHeader(doc, 'Key features', y, M, W);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          setRGB(doc, 'setTextColor', INK_700);
          data.features.forEach(function (f) {
            var lines = doc.splitTextToSize('•  ' + f, W - 2 * M - 14);
            y = ensureSpace(doc, y, lines.length * 13 + 2, M, H);
            doc.text(lines, M + 4, y);
            y += lines.length * 13 + 4;
          });
          y += 8;
        }

        // ── Specifications table ──
        if (Array.isArray(data.specs) && data.specs.length) {
          y = ensureSpace(doc, y, 60, M, H);
          y = sectionHeader(doc, 'Specifications', y, M, W);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          var col1X = M + 6;
          var col2X = M + Math.round((W - 2 * M) * 0.40);
          var col2W = W - M - col2X - 6;
          data.specs.forEach(function (s, i) {
            var nameLines  = doc.splitTextToSize(String(s.name  || ''), col2X - col1X - 8);
            var valueLines = doc.splitTextToSize(String(s.value || ''), col2W);
            var rowLines = Math.max(nameLines.length, valueLines.length);
            var rowH = rowLines * 13 + 10;
            y = ensureSpace(doc, y, rowH, M, H);
            if (i % 2 === 0) {
              setRGB(doc, 'setFillColor', ZEBRA);
              doc.rect(M, y - 10, W - 2 * M, rowH, 'F');
            }
            setRGB(doc, 'setTextColor', INK_500);
            doc.text(nameLines, col1X, y);
            setRGB(doc, 'setTextColor', INK_700);
            doc.text(valueLines, col2X, y);
            y += rowH;
          });
          y += 12;
        }

        // ── Footer on every page ──
        var total = doc.internal.getNumberOfPages();
        for (var i = 1; i <= total; i++) {
          doc.setPage(i);
          setRGB(doc, 'setDrawColor', INK_300);
          doc.setLineWidth(0.5);
          doc.line(M, H - 38, W - M, H - 38);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          setRGB(doc, 'setTextColor', INK_500);
          var urlLine = String(data.url || '');
          // Clip the URL to fit if it's stupidly long.
          var maxUrl = doc.splitTextToSize(urlLine, W - 2 * M - 80)[0] || urlLine;
          doc.text(maxUrl, M, H - 24);
          doc.text('Page ' + i + ' of ' + total, W - M, H - 24, { align: 'right' });
          doc.text(
            'For current pricing, availability, and bulk quotes, contact your account manager.',
            M, H - 12
          );
        }

        var name = fileSafe(data.sku || data.title) + '_datasheet.pdf';
        doc.save(name);
      })
      .catch(function (err) {
        console.warn('[pm-pdp-pdf]', err);
        try {
          alert('Could not generate the PDF: ' + (err && err.message || 'unknown error') +
                '\n\nIf this keeps happening, please refresh the page.');
        } catch (e) { /* noop */ }
      })
      .then(function () {
        btn.disabled = false;
        if (labelEl && original != null) labelEl.textContent = original;
      });
  }

  // ── Boot ─────────────────────────────────────────────────────────────
  function init() {
    // Use delegation so dynamically-injected PDPs (Shopify section reload)
    // pick up automatically.
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-pm-pdp-pdf]');
      if (!btn) return;
      e.preventDefault();
      var data = readData();
      if (!data) return;
      generatePDF(data, btn);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
