/* eg-design-tools.js — factory boards REUSE the seller's existing design pages,
   nothing reinvented:
     • Upload      → the shared EGStore.openDesignUpload flow (same as before)
     • Templates   → the seller's product-templates.html
     • Design Maker→ the seller's design-maker.html (with order+sku context)
     • Design Lab  → the seller's design-lab.html hub (left-nav shortcut)
   Loaded by admin/operator/warehouse/designer. Permissions are unchanged. */
(function () {
  'use strict';
  if (window.EGDesignTools) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ctxQS(orderNum, sku) {
    var q = [];
    if (orderNum) q.push('order=' + encodeURIComponent(orderNum));
    if (sku) q.push('sku=' + encodeURIComponent(sku));
    return q.length ? ('?' + q.join('&')) : '';
  }

  // Overlay hosting one of the seller's real pages — sits BESIDE the factory
  // sidebar (left:220px) so the board's left panel stays visible, with a
  // breadcrumb back. onBack (optional) returns to a previous view (e.g. the hub).
  var SIDEBAR_W = 220;
  function overlayEl() {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:' + SIDEBAR_W + 'px;background:#fff;z-index:99990;display:flex;flex-direction:column';
    return ov;
  }

  // Only ONE design overlay at a time, and it must get out of the way when the
  // user clicks a board sidebar nav item — otherwise the section changes behind
  // the overlay and "the page doesn't show up". mount() tears down any previous
  // overlay + wires a capture-phase listener that dismisses on any sidebar nav
  // click (the nav's own onclick still runs, so the section shows through).
  var _ov = null, _navHandler = null, _prevActive = null;
  // Give the "Design Lab" sidebar item the same .on highlight as a real section
  // while the overlay is open, so it's clear it's selected. Restore the previously
  // active item when we close via Escape (a section click re-sets .on itself).
  function labItems() { return document.querySelectorAll('.ni[onclick*="designLab"]'); }
  function setLabActive(on) {
    try {
      if (on) {
        _prevActive = document.querySelector('.ni.on');
        document.querySelectorAll('.ni.on').forEach(function (el) { if (!el.matches('[onclick*="designLab"]')) el.classList.remove('on'); });
        labItems().forEach(function (el) { el.classList.add('on'); });
      } else {
        labItems().forEach(function (el) { el.classList.remove('on'); });
        if (_prevActive && !document.querySelector('.ni.on')) _prevActive.classList.add('on');
        _prevActive = null;
      }
    } catch (e) {}
  }
  function unmount() {
    if (_navHandler) { document.removeEventListener('click', _navHandler, true); _navHandler = null; }
    if (_ov) { try { document.body.removeChild(_ov); } catch (e) {} _ov = null; }
    document.body.style.overflow = '';
    setLabActive(false);
  }
  function mount(ov) {
    var wasOpen = !!_ov;
    unmount();
    _ov = ov;
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    if (!wasOpen) setLabActive(true);   // entering the lab (not just swapping hub↔page)
    else labItems().forEach(function (el) { el.classList.add('on'); });
    _navHandler = function (e) {
      if (_ov && _ov.contains(e.target)) return;                 // clicks inside the overlay are fine
      var n = e.target && e.target.closest && e.target.closest('.ni,[onclick*="showSection"]');
      if (n) unmount();                                          // sidebar nav → dismiss, let it navigate
    };
    document.addEventListener('click', _navHandler, true);
  }
  function header(crumbRoot, crumbLeaf, onRoot) {
    var root = onRoot
      ? '<button id="egdt-back" style="display:inline-flex;align-items:center;gap:4px;background:none;border:none;cursor:pointer;font-size:13.5px;font-weight:600;color:#6b7280;font-family:inherit"><span style="font-size:17px;line-height:1">‹</span>' + esc(crumbRoot) + '</button>'
      : '<span style="font-size:13.5px;font-weight:600;color:#6b7280">' + esc(crumbRoot) + '</span>';
    var leaf = crumbLeaf ? '<span style="color:#c4c3be">/</span><span style="font-size:14px;font-weight:700;color:#191918">' + esc(crumbLeaf) + '</span>' : '';
    // Match the boards' top bar exactly (same bg, border, 54px height) so the
    // header reads as one continuous strip with the sidebar's top + separator.
    return '<div style="display:flex;align-items:center;justify-content:space-between;height:54px;box-sizing:border-box;padding:0 16px;border-bottom:1px solid rgba(0,0,0,.14);flex-shrink:0;background:#f7f5f0">'
      + '<div style="display:flex;align-items:center;gap:9px">' + root + leaf + '</div>'
      + '<button id="egdt-x" title="Back to board" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;line-height:1;padding:0 4px">&times;</button></div>';
  }
  function openSellerPage(src, title, onBack) {
    var ov = overlayEl();
    // No breadcrumb strip — the embedded page's OWN header sits flush at the top so
    // its separator lines up with the board sidebar (no double header). Dismiss via
    // a sidebar nav click (wired by mount) or Escape; the sidebar's "Design Lab"
    // item reopens the hub.
    // Cache-bust: iframes cache HTML very stubbornly, so the factory kept loading an
    // OLD design-maker/templates page. A unique param forces a fresh fetch each open.
    var _bust = src + (src.indexOf('?') >= 0 ? '&' : '?') + '_v=' + Date.now();
    ov.innerHTML = '<iframe id="egdt-frame" title="' + esc(title || '') + '" src="' + esc(_bust) + '" style="flex:1;border:0;width:100%"></iframe>';
    mount(ov);
    // The iframed seller BOARD pages carry their own sidebar + dashboard top bar —
    // strip that chrome so we don't show a second side panel / seller header. The
    // editor (design-maker) has no .sidebar, so this is a no-op there and it keeps
    // its own toolbar header as the single top bar.
    var ifr = ov.querySelector('#egdt-frame');
    ifr.addEventListener('load', function () {
      try {
        var d = ifr.contentDocument || ifr.contentWindow.document;
        if (d && d.querySelector('.sidebar')) {
          var st = d.createElement('style');
          st.textContent = '.sidebar{display:none!important}[style*="margin-left:220px"]{margin-left:0!important}header{display:none!important}';
          (d.head || d.documentElement).appendChild(st);
        }
      } catch (e) { /* cross-origin (e.g. local file://) — ignore */ }
    });
    function onKey(ev) {
      if (ev.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        unmount();
        document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: {} }));
      }
    }
    document.addEventListener('keydown', onKey);
  }

  // Upload — the existing shared seller flow (unchanged; same as the old Upload button).
  function upload(orderNum, sku, name, tech) {
    if (window.EGStore && EGStore.openDesignUpload) {
      EGStore.openDesignUpload({ orderNum: orderNum, sku: sku, name: name, tech: tech, byRole: 'Staff',
        onDone: function () { document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: orderNum, sku: sku } })); } });
    }
  }
  function templates(orderNum, sku, name) { openSellerPage('product-templates.html' + ctxQS(orderNum, sku), 'Templates' + (name ? (' · ' + name) : '')); }
  function designMaker(orderNum, sku, name) { openSellerPage('design-maker.html' + ctxQS(orderNum, sku), 'Design Maker' + (name ? (' · ' + name) : '')); }

  // Design Lab hub — mirrors the SELLER's design-lab layout (the 3 cards) but
  // rendered chrome-less inside the factory shell (no seller sidebar/account).
  // Each card launches the same reused flow.
  function designLab() {
    var card = function (icon, title, desc, cta, action) {
      return '<button class="egdl-card" data-act="' + action + '" style="text-align:left;background:#fdfcfa;border:1px solid #40403d;border-radius:14px;padding:24px;cursor:pointer;font-family:inherit;box-shadow:2px 2px 0 #40403d;transition:box-shadow .12s ease,transform .12s ease" onmouseover="this.style.boxShadow=\'4px 4px 0 #40403d\';this.style.transform=\'translate(-1px,-1px)\'" onmouseout="this.style.boxShadow=\'2px 2px 0 #40403d\';this.style.transform=\'\'">'
        + '<div style="color:#374151;margin-bottom:14px">' + icon + '</div>'
        + '<div style="font-size:16px;font-weight:700;color:#191918;margin-bottom:6px">' + title + '</div>'
        + '<div style="font-size:13.5px;color:#6b7280;line-height:1.55;margin-bottom:16px">' + desc + '</div>'
        + '<div style="font-size:13.5px;font-weight:600;color:#191918">' + cta + '</div></button>';
    };
    var PEN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L19 9l-4-4L4 16v4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    var BOX = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" stroke="currentColor" stroke-width="1.6"/></svg>';
    var TPL = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:' + SIDEBAR_W + 'px;background:#f4f2ef;z-index:99990;display:flex;flex-direction:column;overflow:auto';
    ov.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;height:54px;box-sizing:border-box;padding:0 24px;border-bottom:1px solid rgba(0,0,0,.14);background:#f7f5f0;position:sticky;top:0;z-index:1"><div style="font-size:16px;font-weight:800;color:#191918">Design Lab</div><button id="egdl-x" title="Back to board" style="background:none;border:none;font-size:24px;color:#9ca3af;cursor:pointer;line-height:1;padding:0 4px">&times;</button></div>'
      + '<div style="max-width:1500px;margin:0 auto;padding:28px 32px 48px;width:100%;box-sizing:border-box">'
      + '<div style="font-size:22px;font-weight:800;color:#191918;margin-bottom:20px">Welcome to Design Lab</div>'
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">'
      + card(PEN, 'Upload &amp; Design', 'Start with your artwork — upload a file, place it on a blank, generate a mockup, and publish.', 'Open editor →', 'maker')
      + card(BOX, 'Catalog', 'Browse your product catalog — base blanks ready to customize, then drop a design on top.', 'Browse products →', 'catalog')
      + card(TPL, 'Use a Template', 'Start from a saved product setup. Apply a fresh design to something already configured.', 'View product templates →', 'templates')
      + '</div></div>';
    mount(ov);
    function close() { unmount(); }
    ov.querySelector('#egdl-x').addEventListener('click', close);
    ov.querySelectorAll('.egdl-card').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'templates') openSellerPage('product-templates.html', 'Templates', designLab);
        else if (act === 'catalog') openSellerPage('products-dash.html', 'Catalog', designLab);   // seller product catalog
        else openSellerPage('design-maker.html', 'Design Maker', designLab);                      // Upload & Design
      });
    });
  }

  /* ----------------------------------------------------------------------
     NEW-ORDER SETUP (factory boards) — synced/new orders need a blank picked
     and a print method chosen before they enter the normal pipeline. These
     controls render ONLY while the order is "new"; once "Push to production"
     is hit the order flips to in_review and the boards fall back to their
     normal per-item layout. Selections persist locally (survive re-render)
     and the print method mirrors onto the order item so methodLabel etc. pick
     it up. Push uses EGStore.update → which also PATCHes the backend, so it
     sticks across re-sync/hydrate. Nothing in the existing flow changes. */
  var PRINT_METHODS = ['DTG', 'DTF', 'EMB', 'APL', 'LSR', 'SUB'];
  var PRINT_LABELS = { DTG: 'DTG', DTF: 'DTF', EMB: 'Embroidery', APL: 'Appliqué', LSR: 'Laser', SUB: 'Sublimation' };
  var SETUP_KEY = 'eg_neworder_setup';

  function jsAttr(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
  function setupAll() { try { return JSON.parse(localStorage.getItem(SETUP_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function setupSave(o) { try { localStorage.setItem(SETUP_KEY, JSON.stringify(o)); } catch (e) {} }
  function getItemSetup(orderNum, sku) { var a = setupAll(); return a[orderNum + '|' + sku] || {}; }
  function setItemSetupField(orderNum, sku, field, val) {
    var a = setupAll(), k = orderNum + '|' + sku; a[k] = a[k] || {}; a[k][field] = val; setupSave(a);
  }
  function orderStatusOf(o) { return String((o && (o.factoryStatus || o.status)) || '').toLowerCase(); }
  function isNewOrder(o) { var s = orderStatusOf(o); return s === 'new' || s === ''; }

  function findOrder(orderNum) {
    var orders = (window.EGStore && EGStore.getOrders) ? (EGStore.getOrders() || []) : [];
    for (var i = 0; i < orders.length; i++) {
      var x = orders[i];
      if (String(x.num) === String(orderNum) || String(x.id) === String(orderNum)) return x;
    }
    return null;
  }

  // Image of the base product the operator picked for a still-"new" item, looked
  // up from the catalog by the stored product name. Empty until a product is
  // chosen — boards use it to SWAP the line thumbnail off the marketplace listing
  // image and onto the chosen blank (over which the design composite then sits).
  function setupProductImage(orderNum, sku) {
    var s = getItemSetup(orderNum, sku);
    if (!s || !s.product) return '';
    var prods = (window.EGStore && EGStore.getCatalogProducts) ? (EGStore.getCatalogProducts() || []) : [];
    for (var i = 0; i < prods.length; i++) {
      var p = prods[i];
      if (String(p.name || p.sku || p.id) === String(s.product)) return p.img || p.image || '';
    }
    return '';
  }

  // Re-render the current board's order table (whichever global render fn it
  // exposes) so a setup change is reflected immediately — e.g. the thumbnail
  // swapping off the listing image onto the chosen product blank. Boards track
  // row expansion in persistent state, so this keeps an open row open.
  function refreshBoard() {
    // Capture which order-detail rows are open so a re-render doesn't COLLAPSE
    // them mid-interaction (some boards toggle detail via direct DOM, not a
    // persisted set). We restore them right after the render.
    var openIds = [];
    try {
      document.querySelectorAll('[id^="op-detail-"],[id^="wh-detail-"]').forEach(function (el) {
        if (el.style && el.style.display && el.style.display !== 'none') openIds.push(el.id.replace(/^(op|wh)-detail-/, ''));
      });
    } catch (e) {}
    ['renderOpOrders', 'whRenderOrders', 'admRenderOrders', 'renderOrders'].forEach(function (fn) {
      try { if (typeof window[fn] === 'function') window[fn](); } catch (e) {}
    });
    try {
      openIds.forEach(function (id) {
        var el = document.getElementById('op-detail-' + id) || document.getElementById('wh-detail-' + id);
        if (el) el.style.display = 'table-row';
        var chev = document.getElementById('op-chevron-' + id) || document.getElementById('wh-chevron-' + id);
        if (chev) chev.style.transform = 'rotate(180deg)';
      });
    } catch (e) {}
  }

  // ── Auto thread-colour matching for embroidery items ───────────────────────
  // Etsy-synced EMB items arrive with the buyer's artwork but no thread codes.
  // Run the dominant-colour → nearest-stocked-thread match ONCE per item (guarded
  // so re-renders don't re-run it), then persist via setItemThreadColors so every
  // board shows the chips. etsystatic images go through our same-origin proxy so
  // the colour-analysis canvas isn't tainted (cross-origin → getImageData throws).
  var _tmAttempted = {};
  function etsyImgProxy(url) { return '/api/etsy/img-proxy?url=' + encodeURIComponent(url); }
  function autoThreadMatch(orderNum, sku, method, designUrl) {
    if (!/EMB/i.test(String(method || ''))) return;
    designUrl = String(designUrl || '');
    // Only real artwork — an http(s) upload or a data: image. Guards against the
    // designSrc enum values ('design-lab'/'template') the seller UI sometimes uses.
    if (!/^https?:\/\//i.test(designUrl) && !/^data:image\//i.test(designUrl)) return;
    if (!(window.EGStore && EGStore.matchThreadColors && EGStore.setItemThreadColors)) return;
    try { var ex = EGStore.getItemThreadColors && EGStore.getItemThreadColors(orderNum, sku); if (ex && ex.length) return; } catch (e) {}
    var key = orderNum + '|' + sku;
    if (_tmAttempted[key]) return;
    _tmAttempted[key] = 1;
    var src = /(^|\.)etsystatic\.com/i.test(String(designUrl)) ? etsyImgProxy(designUrl) : designUrl;
    try {
      EGStore.matchThreadColors(src, function (threads) {
        if (threads && threads.length) { try { EGStore.setItemThreadColors(orderNum, sku, threads); } catch (e) {} refreshBoard(); }
      });
    } catch (e) {}
  }

  // Resolve the catalog product the operator picked for an item (by stored name).
  function chosenProduct(orderNum, sku) {
    var s = getItemSetup(orderNum, sku);
    if (!s || !s.product) return null;
    var prods = (window.EGStore && EGStore.getCatalogProducts) ? (EGStore.getCatalogProducts() || []) : [];
    for (var i = 0; i < prods.length; i++) { if (String(prods[i].name || prods[i].sku || prods[i].id) === String(s.product)) return prods[i]; }
    return null;
  }
  // Unit price for a chosen product + item — base (per-size if set, else base/price)
  // plus the print-method add-on. Mirrors the boards' _xfomUnitPrice so totals agree.
  function productUnitPrice(product, it) {
    var base = null, sz = String((it && it.size) || '').trim().toLowerCase();
    if (Array.isArray(product.sizePrices)) {
      var row = product.sizePrices.find(function (r) { return r.size != null && String(r.size).toLowerCase() === sz; });
      if (row && row.price != null) { var ap = parseFloat(row.price); if (!isNaN(ap) && ap > 0) base = ap; }
    }
    if (base == null) base = parseFloat(product.basePrice) || parseFloat(product.price) || 0;
    var add = 0, tech = String((it && (it.tech || it.printType)) || '').toUpperCase();
    if (tech && product.methodPrices) {
      var k = /EMB/.test(tech) ? 'EMB' : /DTF/.test(tech) ? 'DTF' : /APL|APPLIQ/.test(tech) ? 'APL' : /LSR|LASER/.test(tech) ? 'LSR' : /DTG|DIRECT/.test(tech) ? 'DTG' : tech;
      var mp = parseFloat(product.methodPrices[k] != null ? product.methodPrices[k] : product.methodPrices[tech]);
      if (!isNaN(mp) && mp > 0) add = mp;
    }
    return base + add;
  }
  // Push the chosen product's unit price onto the order line item so the order
  // detail + item-derived totals stay in sync. NEVER overwrites the order's own
  // total (keeps the marketplace sale price) or the listing image.
  function syncItemToProduct(orderNum, sku) {
    try {
      var p = chosenProduct(orderNum, sku);
      if (!p) return;
      var o = findOrder(orderNum);
      if (!o || !Array.isArray(o.items)) return;
      var it = o.items.find(function (i) { return String(i.sku) === String(sku); });
      if (!it) return;
      var price = productUnitPrice(p, it);
      if (price > 0) { it.price = price; it.unitPrice = price; }
      if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items });
    } catch (e) {}
  }

  function onSetProduct(orderNum, sku, val) { setItemSetupField(orderNum, sku, 'product', val); syncItemToProduct(orderNum, sku); refreshBoard(); }
  function onSetPrint(orderNum, sku, val) {
    setItemSetupField(orderNum, sku, 'printType', val);
    try {
      var o = findOrder(orderNum);
      if (o && Array.isArray(o.items)) {
        var it = o.items.find(function (i) { return String(i.sku) === String(sku); });
        if (it) {
          it.printType = val; it.tech = val; if (EGStore.update) EGStore.update(o.id, { items: o.items });
          // Method add-on can change the unit price → re-sync the line item.
          syncItemToProduct(orderNum, sku);
          // Picking EMB on a method-less item → kick off thread matching now.
          if (/EMB/i.test(String(val))) {
            var du = it.customerFile || it.designSrc || (EGStore.getRawDesign && EGStore.getRawDesign(orderNum, sku)) || '';
            autoThreadMatch(orderNum, sku, val, du);
          }
        }
      }
    } catch (e) {}
  }

  // ── Customer-uploaded file (marketplace) → adopt as the item's design, or
  //    dismiss it and upload your own. Dismissal is per order|sku, persisted so
  //    it survives re-render/re-sync. "Use as design" caches the buyer's file URL
  //    as the item's raw design (EGStore.cacheRawDesign), so it drives the mockup
  //    + thread match + downloads exactly like a seller-uploaded design. ────────
  var CF_DISMISS_KEY = 'eg_custfile_dismissed';
  function cfDismissed() { try { return JSON.parse(localStorage.getItem(CF_DISMISS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function isCustomerFileDismissed(orderNum, sku) { return !!cfDismissed()[orderNum + '|' + sku]; }
  function dismissCustomerFile(orderNum, sku) {
    try { var m = cfDismissed(); m[orderNum + '|' + sku] = 1; localStorage.setItem(CF_DISMISS_KEY, JSON.stringify(m)); } catch (e) {}
    refreshBoard();
    // Open the upload flow so they can drop in their own artwork right away.
    var name = ''; try { var o = findOrder(orderNum); if (o && o.items) { var it = o.items.find(function (i) { return String(i.sku) === String(sku); }); if (it) name = it.name || ''; } } catch (e) {}
    upload(orderNum, sku, name, '');
  }
  function isCustomerFileAdopted(orderNum, sku, url) {
    try { return !!(window.EGStore && EGStore.getRawDesign && EGStore.getRawDesign(orderNum, sku) === url); } catch (e) { return false; }
  }
  function adoptCustomerFile(orderNum, sku, url) {
    if (!url) return;
    try { if (window.EGStore && EGStore.cacheRawDesign) EGStore.cacheRawDesign(orderNum, sku, url); } catch (e) {}
    refreshBoard();
    document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: orderNum, sku: sku } }));
  }
  // Inline cluster for the DESIGN cell: the file link + Use / dismiss controls.
  // Returns '' when dismissed (caller falls back to its normal no-file state).
  function customerFileControls(orderNum, sku, url) {
    if (!url || isCustomerFileDismissed(orderNum, sku)) return '';
    var on = jsAttr(orderNum), sk = jsAttr(sku), u = jsAttr(url);
    var link = '<a href="' + esc(url) + '" target="_blank" onclick="event.stopPropagation()" title="Customer-uploaded file from the marketplace" style="color:#7c3aed;font-weight:600;text-decoration:underline;text-decoration-color:#c4b5fd">Customer file ↗</a>';
    var mini = 'font-size:10.5px;font-weight:700;line-height:1;padding:2px 6px;border-radius:5px;cursor:pointer;font-family:inherit;white-space:nowrap';
    if (isCustomerFileAdopted(orderNum, sku, url)) {
      return '<span style="display:inline-flex;align-items:center;gap:6px">' + link
        + '<span title="Using the customer\'s file as the design" style="' + mini + ';background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;cursor:default">✓ in use</span></span>';
    }
    return '<span style="display:inline-flex;align-items:center;gap:6px">' + link
      + '<button onclick="event.stopPropagation();EGDesignTools.adoptCustomerFile(\'' + on + '\',\'' + sk + '\',\'' + u + '\')" title="Use this file as the design" style="' + mini + ';background:#191918;color:#fff;border:1px solid #191918">Use</button>'
      + '<button onclick="event.stopPropagation();EGDesignTools.dismissCustomerFile(\'' + on + '\',\'' + sk + '\')" title="Dismiss &amp; upload your own" style="' + mini + ';background:#fff;color:#9ca3af;border:1px solid #e5e4e0">✕</button></span>';
  }

  // ── Color / Size variant pickers (mirrors the seller's inline variant logic) ──
  var _DEF_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'One Size'];
  var _DEF_COLORS = ['White', 'Black', 'Navy', 'Heather Gray', 'Light Pink', 'Light Blue', 'Forest Green', 'Red'];
  function _extractSize(sku) { if (!sku) return ''; var m = String(sku).toUpperCase().match(/-(XS|S|M|L|XL|2XL|3XL|4XL|OS)\b/); return m ? (m[1] === 'OS' ? 'One Size' : m[1]) : ''; }
  function _extractColor(sku) { if (!sku) return ''; var abbr = { WHT: 'White', WHI: 'White', BLK: 'Black', NVY: 'Navy', GRY: 'Heather Gray', LPK: 'Light Pink', LBL: 'Light Blue', RED: 'Red', GRN: 'Forest Green', PNK: 'Pink', PUR: 'Purple', GLD: 'Gold', SND: 'Sand', NAT: 'Natural', CRM: 'Cream' }; var m = String(sku).toUpperCase().match(/-([A-Z]{2,4})-/); return m ? (abbr[m[1]] || (m[1].charAt(0) + m[1].slice(1).toLowerCase())) : ''; }
  function variantOptions(orderNum, sku, it) {
    var colors = [], sizes = [];
    try {
      var prods = (window.EGStore && EGStore.getCatalogProducts) ? (EGStore.getCatalogProducts() || []) : [];
      var p = chosenProduct(orderNum, sku);
      if (!p) { var base = String(sku || '').split('-')[0]; p = prods.find(function (x) { return (Array.isArray(x.variantSkus) && x.variantSkus.some(function (v) { return v && v.sku === sku; })) || (x.sku && base && x.sku.toUpperCase() === base.toUpperCase()); }); }
      if (p && Array.isArray(p.variantSkus)) { var sc = {}, ss = {}; p.variantSkus.forEach(function (v) { if (!v) return; if (v.color && !sc[v.color]) { sc[v.color] = 1; colors.push(v.color); } if (v.size && !ss[v.size]) { ss[v.size] = 1; sizes.push(v.size); } }); }
    } catch (e) {}
    var curC = (it && it.color) || _extractColor(sku), curS = (it && it.size) || _extractSize(sku);
    if (!colors.length) colors = _DEF_COLORS.slice();
    if (!sizes.length) sizes = _DEF_SIZES.slice();
    if (curC && colors.indexOf(curC) < 0) colors.unshift(curC);
    if (curS && sizes.indexOf(curS) < 0) sizes.unshift(curS);
    return { colors: colors, sizes: sizes, curColor: curC, curSize: curS };
  }
  function onSetVariant(orderNum, sku, key, value) {
    try {
      var o = findOrder(orderNum); if (!o || !Array.isArray(o.items)) return;
      var it = o.items.find(function (i) { return String(i.sku) === String(sku); }); if (!it) return;
      it[key] = value;
      if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items });
    } catch (e) {}
    refreshBoard();
  }
  // Remove a line item (New orders only) — keeps at least one, confirms first.
  function removeItem(orderNum, sku) {
    try {
      var o = findOrder(orderNum); if (!o || !Array.isArray(o.items)) return;
      if (o.items.length <= 1) { alert('An order must have at least one item.'); return; }
      if (!window.confirm('Remove this item from the order?')) return;
      o.items = o.items.filter(function (i) { return String(i.sku) !== String(sku); });
      if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items });
    } catch (e) {}
    refreshBoard();
  }

  function actBtn(label, onclick) {
    return '<button class="btn btn-out" style="font-size:11px;padding:3px 9px;white-space:nowrap" onclick="' + onclick + '">' + label + '</button>';
  }
  function opt(val, label, sel) { return '<option value="' + esc(val) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }

  // Full right-side action cluster for an item row. Drop-in replacement for the
  // boards' hand-written Upload/Templates/Design Maker button group, plus the
  // product + print-method pickers when the order is still "new".
  function itemActions(o, it) {
    o = o || {}; it = it || {};
    var num = o.num || o.id || '';
    var sku = it.sku || '';
    var name = it.name || '';
    var tech = it.type || it.printType || it.tech || '';
    // Auto-darken Upload once a design is attached (raw design cached, an adopted
    // customer file, or an uploaded file on the item) — mirrors the seller's
    // active-state design button. Clicking still re-opens upload to replace it.
    var _hasDesign = false;
    try { _hasDesign = !!(window.EGStore && EGStore.getRawDesign && EGStore.getRawDesign(num, sku)); } catch (e) {}
    if (!_hasDesign && (it.file || it.designUrl || it.thumb)) _hasDesign = true;
    var _upOnclick = "EGDesignTools.uploadPanel('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "','" + jsAttr(tech) + "')";
    var uploadBtn = _hasDesign
      ? '<button class="btn" style="font-size:11px;padding:3px 9px;white-space:nowrap;background:#191918;color:#fff;border:1px solid #191918" title="Design attached — click to replace" onclick="' + _upOnclick + '">Uploaded</button>'
      : actBtn('↑ Upload', _upOnclick);
    var btns = uploadBtn
      + actBtn('Templates', "EGDesignTools.openTemplates('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "',event)")
      + actBtn('Design Maker', "EGDesignTools.designMaker('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "')")
      // Place = quick move/resize/remove-bg on the attached design (only once there is one).
      + (_hasDesign ? actBtn('Place', "EGDesignTools.placeDesign('" + jsAttr(num) + "','" + jsAttr(sku) + "')") : '');
    var pickers = '';
    if (isNewOrder(o)) {
      var setup = getItemSetup(num, sku);
      var prods = (window.EGStore && EGStore.getCatalogProducts) ? (EGStore.getCatalogProducts() || []) : [];
      var curProd = setup.product || '', matched = false;
      var prodOpts = '<option value="">Product…</option>';
      prods.forEach(function (p) {
        var v = p.name || p.sku || p.id || ''; if (!v) return;
        var s = curProd && String(curProd) === String(v); if (s) matched = true;
        prodOpts += opt(v, p.name || p.sku || v, s);
      });
      if (curProd && !matched) prodOpts += opt(curProd, curProd, true);
      var curPt = (setup.printType || tech || '').toString().toUpperCase();
      var ptOpts = '<option value="">Method…</option>';
      PRINT_METHODS.forEach(function (m) { ptOpts += opt(m, PRINT_LABELS[m] || m, curPt === m); });
      var sel = 'font-size:11px;padding:3px 6px;border:1px solid #e5e4e0;border-radius:6px;background:#fff;color:#191918;font-family:inherit;max-width:150px';
      // Color + Size pickers (matches the seller's Product · Color · Size · Method row).
      var vo = variantOptions(num, sku, it);
      var colorOpts = (vo.curColor ? '' : '<option value="">Color…</option>') + vo.colors.map(function (c) { return opt(c, c, c === vo.curColor); }).join('');
      var sizeOpts = (vo.curSize ? '' : '<option value="">Size…</option>') + vo.sizes.map(function (s) { return opt(s, s, s === vo.curSize); }).join('');
      pickers = '<select title="Base product" style="' + sel + '" onchange="EGDesignTools.onSetProduct(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',this.value)">' + prodOpts + '</select>'
        + '<select title="Color" style="' + sel + ';max-width:120px" onchange="EGDesignTools.onSetVariant(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',\'color\',this.value)">' + colorOpts + '</select>'
        + '<select title="Size" style="' + sel + ';max-width:90px" onchange="EGDesignTools.onSetVariant(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',\'size\',this.value)">' + sizeOpts + '</select>'
        + '<select title="Print method" style="' + sel + '" onchange="EGDesignTools.onSetPrint(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',this.value)">' + ptOpts + '</select>';
    }
    // Delete (trash) — only while New, keeps ≥1 item.
    var delBtn = isNewOrder(o)
      ? '<button title="Remove item" onclick="EGDesignTools.removeItem(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\')" style="background:none;border:none;cursor:pointer;color:#c4c3be;padding:3px 4px;flex-shrink:0;font-family:inherit;line-height:0" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#c4c3be\'"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 3.5h9M5.5 3.5V2.5a1 1 0 011-1h1a1 1 0 011 1v1M3.5 3.5l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
      : '';
    return '<div style="display:flex;gap:6px;flex-shrink:0;margin-left:auto;align-items:center;flex-wrap:wrap;justify-content:flex-end" onclick="event.stopPropagation()">' + pickers + btns + delBtn + '</div>';
  }

  // ── Inline "+ Add item" (factory boards) — mirrors the seller's add-item on the
  //    orders table. Pushes a placeholder line item the operator then configures
  //    with the Product / Method pickers + Upload/Templates. Persists via
  //    EGStore.update so it survives re-sync/hydrate. Only while the order is new.
  function addItem(orderNum) {
    try {
      var o = findOrder(orderNum);
      if (!o) return;
      o.items = Array.isArray(o.items) ? o.items : [];
      var sku = 'NEW-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      o.items.push({ sku: sku, name: 'New item', qty: 1, printType: '' });
      if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items });
    } catch (e) {}
    refreshBoard();
  }
  function addItemButton(o) {
    if (!isNewOrder(o)) return '';
    var num = (o && (o.num || o.id)) || '';
    return '<div style="padding:4px 14px 10px 28px" onclick="event.stopPropagation()">'
      + '<button onclick="EGDesignTools.addItem(\'' + jsAttr(num) + '\')" title="Add another line item to this order" '
      + 'style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:#191918;background:transparent;border:1px dashed #c4c3be;border-radius:7px;padding:6px 12px;cursor:pointer;font-family:inherit;transition:border-color .15s,background .15s" '
      + 'onmouseover="this.style.borderColor=\'#191918\';this.style.background=\'#fff\'" onmouseout="this.style.borderColor=\'#c4c3be\';this.style.background=\'transparent\'">'
      + '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Add item</button></div>';
  }

  // Per-order "Push to production" — only while the order is new.
  function pushButton(o) {
    if (!isNewOrder(o)) return '';
    var num = (o && (o.num || o.id)) || '';
    return '<div style="display:flex;justify-content:flex-end;align-items:center;padding:6px 16px 4px 28px" onclick="event.stopPropagation()">'
      + '<button class="btn btn-dk" style="font-size:12px;padding:6px 16px" onclick="EGDesignTools.pushToProduction(\'' + jsAttr(num) + '\')">Push</button></div>';
  }

  // Compact "Push" for the PARENT order row's action cluster — sits beside the
  // Full Details (↗) button. 32px tall to line up with the icon buttons there.
  // Only renders while the order is still new. event.stopPropagation keeps the
  // row from toggling its expansion when Push is clicked.
  function pushButtonInline(o) {
    if (!isNewOrder(o)) return '';
    var num = (o && (o.num || o.id)) || '';
    return '<button title="Push to production" onclick="event.stopPropagation();EGDesignTools.pushToProduction(\'' + jsAttr(num) + '\')" '
      + 'style="height:32px;padding:0 14px;display:inline-flex;align-items:center;border-radius:7px;border:1.5px solid #191918;background:#191918;color:#fff;cursor:pointer;flex-shrink:0;font-family:inherit;font-size:12.5px;font-weight:600;transition:background .15s" '
      + 'onmouseover="this.style.background=\'#000\'" onmouseout="this.style.background=\'#191918\'">Push</button>';
  }

  function pushToProduction(orderNum) {
    var o = findOrder(orderNum);
    var id = o ? o.id : orderNum;
    if (o && Array.isArray(o.items) && o.items.length) {
      var miss = o.items.filter(function (it) {
        var s = getItemSetup(o.num || orderNum, it.sku) || {};
        return !(s.printType || it.printType || it.tech);
      });
      if (miss.length && !window.confirm(miss.length + ' item(s) have no print method selected yet. Push to production anyway?')) return;
    }
    if (window.EGStore && EGStore.update) EGStore.update(id, { factoryStatus: 'in_review', status: 'in_review' });
  }

  // ── Searchable Templates dropdown (ported from the seller orders page) ───────
  // Same saved-template store the seller uses; lets the factory apply a saved
  // design to a line item without leaving the board. The full-page templates()
  // flow above is kept intact — this is just the quick inline picker.
  var _tplCtx = null;
  function _loadTemplates() {
    var legacy = [], meta = [], blobs = {};
    try { legacy = JSON.parse(localStorage.getItem('eg_design_templates') || '[]'); } catch (e) {}
    try { meta = JSON.parse(localStorage.getItem('eg_templates') || '[]'); } catch (e) {}
    try { blobs = JSON.parse(localStorage.getItem('eg_templates_blob') || '{}'); } catch (e) {}
    if (!Array.isArray(legacy)) legacy = [];
    if (!Array.isArray(meta)) meta = [];
    if (!blobs || typeof blobs !== 'object') blobs = {};
    var enriched = meta.map(function (m) {
      if (!m || m.id == null) return m; var b = blobs[m.id]; if (!b) return m;
      return Object.assign({}, m, { compositeImg: m.compositeImg || b.compositeImg || '', designOnlyImg: m.designOnlyImg || b.designOnlyImg || '', layers: m.layers || b.layers || [] });
    });
    var byId = {};
    enriched.forEach(function (t) { if (t && t.id != null) byId[String(t.id)] = t; });
    legacy.forEach(function (t) { if (t && t.id != null && !byId[String(t.id)]) byId[String(t.id)] = t; });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }
  function _tplTechOf(t) { if (t && t.tech) return t.tech; if (t && t.method) return /emb/i.test(t.method) ? 'EMB' : /sub/i.test(t.method) ? 'SUB' : /scr/i.test(t.method) ? 'SCR' : 'DTG'; return 'DTG'; }
  function _tplPanel() {
    var p = document.getElementById('egt-tpl-panel');
    if (!p) {
      p = document.createElement('div'); p.id = 'egt-tpl-panel';
      p.style.cssText = 'position:fixed;background:#fff;border:1.5px solid #e5e4e0;border-radius:12px;width:310px;z-index:10095;box-shadow:0 8px 32px rgba(0,0,0,.13);overflow:hidden;display:none;font-family:Inter,system-ui,sans-serif';
      p.innerHTML = '<div style="padding:9px 12px;border-bottom:1px solid #f3f3f1;display:flex;align-items:center;gap:8px">'
        + '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="#9ca3af" stroke-width="1.3"/><path d="M11 11l2.5 2.5" stroke="#9ca3af" stroke-width="1.3" stroke-linecap="round"/></svg>'
        + '<input id="egt-tpl-search" placeholder="Search templates…" style="border:none;outline:none;font-size:13.5px;flex:1;font-family:inherit;background:transparent" oninput="EGDesignTools._filterTemplates(this.value)"/>'
        + '<span onclick="EGDesignTools._closeTemplates()" style="cursor:pointer;color:#9ca3af;font-size:17px;line-height:1">&times;</span></div>'
        + '<div id="egt-tpl-list" style="max-height:300px;overflow:auto;padding:4px"></div>'
        + '<div style="padding:8px 12px;border-top:1px solid #f3f3f1"><a onclick="EGDesignTools._templatesPage()" style="font-size:12.5px;color:#191918;font-weight:600;cursor:pointer;text-decoration:none">Browse all product templates →</a></div>';
      document.body.appendChild(p);
      document.addEventListener('mousedown', function (e) { if (p.style.display !== 'none' && !p.contains(e.target)) closeTemplates(); }, true);
    }
    return p;
  }
  function openTemplates(orderNum, sku, name, ev) {
    _tplCtx = { orderNum: orderNum, sku: sku, name: name };
    var p = _tplPanel(); p.style.display = 'block'; p.style.transform = '';
    var rect = null; try { var el = ev && (ev.currentTarget || ev.target); if (el && el.getBoundingClientRect) rect = el.getBoundingClientRect(); } catch (e) {}
    if (rect) {
      var top = rect.bottom + 6, left = rect.left;
      if (left + 310 > window.innerWidth - 20) left = window.innerWidth - 330;
      if (top + 340 > window.innerHeight - 10) top = Math.max(10, rect.top - 346);
      p.style.top = top + 'px'; p.style.left = left + 'px';
    } else { p.style.top = '90px'; p.style.left = '50%'; p.style.transform = 'translateX(-50%)'; }
    var s = document.getElementById('egt-tpl-search'); if (s) s.value = '';
    filterTemplates('');
    setTimeout(function () { var si = document.getElementById('egt-tpl-search'); if (si) si.focus(); }, 50);
  }
  function closeTemplates() { var p = document.getElementById('egt-tpl-panel'); if (p) p.style.display = 'none'; }
  // Open the board's full product-templates page (in-board overlay) for the
  // current item, carrying its order+sku context — same page the board owns.
  function openTemplatesPage() { var c = _tplCtx; closeTemplates(); if (c) templates(c.orderNum, c.sku, c.name); }
  function filterTemplates(q) {
    var list = document.getElementById('egt-tpl-list'); if (!list) return;
    var all = _loadTemplates();
    if (!all.length) { list.innerHTML = '<div style="padding:24px 18px;text-align:center;font-size:13px;color:#9ca3af;line-height:1.5">No templates saved yet.<br><a href="design-maker.html" target="_blank" style="color:#191918;font-weight:600;text-decoration:underline">Open Design Maker</a> and save one.</div>'; return; }
    var ql = (q || '').toLowerCase();
    var results = ql ? all.filter(function (t) { return (t.name || '').toLowerCase().indexOf(ql) >= 0 || (t.productName || '').toLowerCase().indexOf(ql) >= 0 || _tplTechOf(t).toLowerCase().indexOf(ql) >= 0; }) : all;
    if (!results.length) { list.innerHTML = '<div style="padding:18px;text-align:center;font-size:13px;color:#9ca3af">No templates match “' + esc(q) + '”</div>'; return; }
    list.innerHTML = results.map(function (t) {
      var tech = _tplTechOf(t);
      var techBg = tech === 'DTG' ? '#ede9fe' : tech === 'EMB' ? '#dcfce7' : tech === 'SUB' ? '#dbeafe' : '#f0ede9';
      var techFg = tech === 'DTG' ? '#7c3aed' : tech === 'EMB' ? '#15803d' : tech === 'SUB' ? '#1d4ed8' : '#374151';
      var thumbSrc = t.designOnlyImg || t.compositeImg || t.productImg || '';
      var thumb = thumbSrc ? '<img src="' + esc(thumbSrc) + '" style="width:34px;height:34px;object-fit:cover;border-radius:8px;background:#f0ede9;flex-shrink:0" onerror="this.style.visibility=\'hidden\'"/>' : '<div style="width:34px;height:34px;background:#f0ede9;border-radius:8px;flex-shrink:0"></div>';
      return '<div onclick="EGDesignTools._applyTemplate(\'' + jsAttr(String(t.id)) + '\')" style="display:flex;align-items:center;gap:10px;padding:9px 10px;cursor:pointer;border-radius:8px" onmouseover="this.style.background=\'#fafaf9\'" onmouseout="this.style.background=\'transparent\'">'
        + thumb
        + '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:#191918;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.name || 'Untitled template') + '</div>'
        + '<div style="margin-top:2px"><span style="background:' + techBg + ';color:' + techFg + ';padding:1px 5px;border-radius:4px;font-weight:700;font-size:10.5px">' + tech + '</span></div></div></div>';
    }).join('');
  }
  function applyTemplate(tplId) {
    var t = _loadTemplates().find(function (x) { return String(x.id) === String(tplId); });
    var ctx = _tplCtx; closeTemplates();
    if (!t || !ctx) return;
    var designImg = t.designOnlyImg || t.compositeImg || t.productImg || '';
    try {
      var o = findOrder(ctx.orderNum);
      if (o && Array.isArray(o.items)) {
        var it = o.items.find(function (i) { return String(i.sku) === String(ctx.sku); });
        if (it) {
          it.designSrc = 'template'; it.designTemplateId = t.id;
          if (designImg) { it.designUrl = designImg; if (window.EGStore && EGStore.cacheRawDesign && o.id) EGStore.cacheRawDesign(o.id, it.sku, designImg); }
          var tech = _tplTechOf(t);
          if (tech) { it.printType = tech; it.tech = tech; setItemSetupField(ctx.orderNum, ctx.sku, 'printType', tech); }
          if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items });
          syncItemToProduct(ctx.orderNum, ctx.sku);
        }
      }
    } catch (e) {}
    refreshBoard();
    document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: ctx.orderNum, sku: ctx.sku } }));
  }

  // ── Quick-place design modal (move / resize / remove background) — ported from
  //    the seller's qp modal, made self-contained for the factory boards. Reads
  //    the item from EGStore, persists designPos + bg-removed artwork, refreshes
  //    every board surface. Trigger: the "Place" item action (shown once a design
  //    is attached). ─────────────────────────────────────────────────────────
  var _qpCur = null;
  function _qpDesignUrl(o, it) {
    try { if (window.EGStore && EGStore.getRawDesign) { var r = EGStore.getRawDesign(o.id, it.sku); if (r) return r; } } catch (e) {}
    return it.designUrl || (it.file && String(it.file).indexOf('data:') === 0 ? it.file : '') || '';
  }
  function _qpMockupUrl(o, it) {
    var picked = setupProductImage(o.num || o.id, it.sku); if (picked) return picked;
    if (it.img && /^(https?:|data:)/.test(String(it.img))) return it.img;
    try { if (window.EGStore && EGStore.imageForSku) { var m = EGStore.imageForSku(it.sku, it.name); if (m) return m; } } catch (e) {}
    return it.sellerImg || it.thumb || '';
  }
  function placeDesign(orderNum, sku) {
    var o = findOrder(orderNum); if (!o || !Array.isArray(o.items)) return;
    var it = o.items.find(function (i) { return String(i.sku) === String(sku); }); if (!it) return;
    var design = _qpDesignUrl(o, it);
    if (!design) { alert('Attach a design first (Upload / Templates / Design Maker), then Place it.'); return; }
    if (!it.designPos) it.designPos = { x: 25, y: 25, w: 50, h: 50 };
    _qpCur = { orderNum: orderNum, sku: sku };
    _qpEnsureModal();
    document.getElementById('egqp-title').textContent = '#' + (o.num || o.id) + ' — ' + (it.name || it.sku || 'Design');
    document.getElementById('egqp-stage').style.backgroundImage = (function () { var mk = _qpMockupUrl(o, it); return mk ? 'url("' + mk + '")' : 'none'; })();
    var wrap = document.getElementById('egqp-wrap');
    document.getElementById('egqp-design').src = design;
    wrap.style.left = (it.designPos.x || 25) + '%'; wrap.style.top = (it.designPos.y || 25) + '%';
    wrap.style.width = (it.designPos.w || 50) + '%'; wrap.style.height = (it.designPos.h || 50) + '%';
    document.getElementById('egqp-modal').style.display = 'flex';
  }
  function _qpEnsureModal() {
    var m = document.getElementById('egqp-modal'); if (m) return m;
    m = document.createElement('div'); m.id = 'egqp-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(25,25,24,.45);z-index:10120;display:none;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui,sans-serif';
    m.innerHTML = '<div onclick="event.stopPropagation()" style="background:#fdfcfa;border:1.5px solid #40403d;border-radius:14px;box-shadow:4px 4px 0 #40403d;width:100%;max-width:480px;overflow:hidden">'
      + '<div style="padding:14px 18px;border-bottom:1.5px solid #40403d;display:flex;align-items:center;justify-content:space-between"><div><div id="egqp-title" style="font-size:14px;font-weight:700;color:#191918">—</div><div style="font-size:12px;color:#6b7280;margin-top:1px">Drag to move · drag the corner to resize</div></div><button onclick="EGDesignTools._qpClose()" style="background:none;border:none;cursor:pointer;color:#6b7280;padding:4px;font-size:16px;line-height:1">&times;</button></div>'
      + '<div style="padding:18px;display:flex;justify-content:center"><div id="egqp-stage" style="position:relative;width:360px;height:360px;background:#f6f5f4 center/contain no-repeat;border:1.5px solid #c9c4bc;border-radius:10px;user-select:none;overflow:hidden">'
      + '<button id="egqp-rmbg" onclick="event.stopPropagation();EGDesignTools._qpRemoveBg()" title="Remove the design background" style="position:absolute;top:7px;right:7px;z-index:5;background:rgba(255,255,255,.94);border:1px solid #e5e4e0;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;letter-spacing:.03em;color:#374151;cursor:pointer;font-family:inherit;box-shadow:0 1px 4px rgba(0,0,0,.08)">REMOVE BG</button>'
      + '<div id="egqp-wrap" style="position:absolute;cursor:grab"><img id="egqp-design" draggable="false" style="display:block;width:100%;height:100%;object-fit:contain;pointer-events:none"/><div id="egqp-handle" style="position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;background:#191918;border:1.5px solid #fff;border-radius:2px;cursor:nwse-resize"></div></div>'
      + '</div></div>'
      + '<div style="padding:0 18px 16px;display:flex;align-items:center;gap:8px"><div style="margin-left:auto;display:flex;gap:8px"><button onclick="EGDesignTools._qpClose()" class="btn btn-out" style="font-size:13px">Cancel</button><button onclick="EGDesignTools._qpSave()" class="btn btn-dk" style="font-size:13px">Save</button></div></div>'
      + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) qpClose(); });
    document.body.appendChild(m);
    _qpAttach();
    return m;
  }
  function qpClose() { var m = document.getElementById('egqp-modal'); if (m) m.style.display = 'none'; _qpCur = null; }
  function qpSave() {
    if (!_qpCur) { qpClose(); return; }
    try {
      var o = findOrder(_qpCur.orderNum); var it = o && o.items && o.items.find(function (i) { return String(i.sku) === String(_qpCur.sku); });
      var wrap = document.getElementById('egqp-wrap');
      if (it && wrap) { it.designPos = { x: parseFloat(wrap.style.left) || 0, y: parseFloat(wrap.style.top) || 0, w: parseFloat(wrap.style.width) || 50, h: parseFloat(wrap.style.height) || 50 }; if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items }); }
    } catch (e) {}
    qpClose(); refreshBoard();
  }
  function qpRemoveBg() {
    if (!_qpCur) return;
    var o = findOrder(_qpCur.orderNum); var it = o && o.items && o.items.find(function (i) { return String(i.sku) === String(_qpCur.sku); });
    var dEl = document.getElementById('egqp-design'); if (!o || !it || !dEl || !dEl.src) return;
    var btn = document.getElementById('egqp-rmbg'); if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) return;
        var c = document.createElement('canvas'); c.width = w; c.height = h; var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        var data; try { data = ctx.getImageData(0, 0, w, h); } catch (e) { alert('This image can’t be processed in-browser (cross-origin). Upload it through Upload first.'); return; }
        var d = data.data; var px = function (x, y) { var i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
        var cs = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)]; var bg = [0, 0, 0]; cs.forEach(function (p) { bg[0] += p[0]; bg[1] += p[1]; bg[2] += p[2]; }); bg = bg.map(function (v) { return v / 4; });
        var tol = 46, removed = 0;
        for (var i = 0; i < d.length; i += 4) { var dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2]; if (Math.sqrt(dr * dr + dg * dg + db * db) < tol) { d[i + 3] = 0; removed++; } }
        if (!removed) { alert('No uniform background detected.'); return; }
        ctx.putImageData(data, 0, 0); var out = c.toDataURL('image/png');
        dEl.src = out; it.designUrl = out;
        try { if (window.EGStore && EGStore.cacheRawDesign && o.id) EGStore.cacheRawDesign(o.id, it.sku, out); } catch (e) {}
        refreshBoard();
      } finally { if (btn) { btn.disabled = false; btn.style.opacity = ''; } }
    };
    img.onerror = function () { if (btn) { btn.disabled = false; btn.style.opacity = ''; } };
    img.src = dEl.src;
  }
  function _qpAttach() {
    var stage = document.getElementById('egqp-stage'); var mode = null, sx = 0, sy = 0, startX = 0, startY = 0, startW = 0, startH = 0;
    function pct(px, py) { var r = stage.getBoundingClientRect(); return { x: (px / r.width) * 100, y: (py / r.height) * 100 }; }
    function down(e) {
      var wrap = document.getElementById('egqp-wrap'); var handle = document.getElementById('egqp-handle');
      if (e.target === handle) mode = 'resize'; else if (e.target === wrap || wrap.contains(e.target)) { mode = 'drag'; wrap.style.cursor = 'grabbing'; } else return;
      sx = e.clientX; sy = e.clientY; startX = parseFloat(wrap.style.left) || 0; startY = parseFloat(wrap.style.top) || 0; startW = parseFloat(wrap.style.width) || 50; startH = parseFloat(wrap.style.height) || 50; e.preventDefault();
    }
    function mv(e) {
      if (!mode) return; var wrap = document.getElementById('egqp-wrap'); var dd = pct(e.clientX - sx, e.clientY - sy);
      if (mode === 'drag') { wrap.style.left = Math.max(0, Math.min(100 - startW, startX + dd.x)) + '%'; wrap.style.top = Math.max(0, Math.min(100 - startH, startY + dd.y)) + '%'; }
      else { wrap.style.width = Math.max(8, Math.min(100 - startX, startW + dd.x)) + '%'; wrap.style.height = Math.max(8, Math.min(100 - startY, startH + dd.y)) + '%'; }
    }
    function up() { if (mode === 'drag') { var wrap = document.getElementById('egqp-wrap'); if (wrap) wrap.style.cursor = 'grab'; } mode = null; }
    stage.addEventListener('mousedown', down); window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  }

  // ── Right-side upload panel (seller-style) — replaces the bare file picker. ──
  // Pre-populates with the customer's marketplace upload (or current design), lets
  // you replace it, remove its background, and shows the live thread match for EMB
  // items. "Use this design" caches it as the item's design + persists threads.
  var _up = null;
  function _upCanvasSrc(url) { if (/^data:/i.test(String(url))) return url; if (/(^|\.)etsystatic\.com/i.test(String(url))) return '/api/etsy/img-proxy?url=' + encodeURIComponent(url); return url; }
  function uploadPanel(orderNum, sku, name, tech) {
    var o = findOrder(orderNum);
    var it = o && Array.isArray(o.items) ? o.items.find(function (i) { return String(i.sku) === String(sku); }) : null;
    var initial = '';
    try { if (window.EGStore && EGStore.getRawDesign && o) { var r = EGStore.getRawDesign(o.id, sku); if (r) initial = r; } } catch (e) {}
    var custFile = it ? (it.customerFile || (it.designSrc && /^https?:\/\//i.test(String(it.designSrc)) ? String(it.designSrc) : '')) : '';
    if (!initial && it) initial = custFile || it.designUrl || '';
    _up = { orderNum: orderNum, sku: sku, name: name || (it && it.name) || sku, tech: String(tech || (it && it.printType) || '').toUpperCase(), src: initial, fromCustomer: !!(initial && initial === custFile), threads: [] };
    _upEnsure(); _upRender();
    var p = document.getElementById('egup-panel'); p.style.display = 'block'; setTimeout(function () { p.classList.add('open'); }, 10);
  }
  function _upEnsure() {
    if (document.getElementById('egup-panel')) return;
    if (!document.getElementById('egup-css')) { var st = document.createElement('style'); st.id = 'egup-css'; st.textContent = '#egup-ov{position:fixed;inset:0;background:rgba(25,25,24,.28);z-index:10125;display:none}#egup-ov.on{display:block}#egup-panel{position:fixed;top:0;right:-480px;bottom:0;width:440px;max-width:92vw;background:#fff;border-left:1px solid #e5e4e0;z-index:10130;box-shadow:-8px 0 32px rgba(0,0,0,.12);transition:right .28s cubic-bezier(.22,1,.36,1);overflow-y:auto;font-family:Inter,system-ui,sans-serif}#egup-panel.open{right:0}'; document.head.appendChild(st); }
    var ov = document.createElement('div'); ov.id = 'egup-ov'; ov.onclick = function () { _upClose(); }; document.body.appendChild(ov);
    var p = document.createElement('div'); p.id = 'egup-panel'; p.style.display = 'none'; document.body.appendChild(p);
  }
  function _upRender() {
    var s = _up; if (!s) return; var p = document.getElementById('egup-panel');
    var hasImg = !!s.src;
    var preview = hasImg
      ? '<div style="position:relative;width:100%;aspect-ratio:1;border:1.5px solid #e5e4e0;border-radius:10px;overflow:hidden;background:#f6f5f4 center/contain no-repeat;background-image:url(\'' + s.src + '\')"></div>'
      : '<label style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;aspect-ratio:1;border:1.5px dashed #c4c3be;border-radius:10px;cursor:pointer;color:#9ca3af;font-size:13px;gap:8px;text-align:center"><input type="file" accept="image/*,.png,.jpg,.jpeg,.svg,.webp,.pdf,.emb,.dst" style="display:none" onchange="EGDesignTools._upFile(this.files&&this.files[0])"/><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 16V4M7 9l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Click to choose a file</label>';
    document.getElementById('egup-ov').classList.add('on');
    p.innerHTML = '<div style="padding:16px 18px;border-bottom:1px solid #f0ede9;display:flex;align-items:center;justify-content:space-between"><div style="min-width:0"><div style="font-size:15px;font-weight:700;color:#191918">Design</div><div style="font-size:12.5px;color:#9ca3af;margin-top:1px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name) + '</div></div><button onclick="EGDesignTools._upClose()" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:19px;line-height:1">&times;</button></div>'
      + '<div style="padding:18px">'
      + (s.fromCustomer && hasImg ? '<div style="font-size:12px;font-weight:600;color:#7c3aed;background:#faf5ff;border:1px solid #e9d5ff;border-radius:7px;padding:7px 10px;margin-bottom:12px">Customer-uploaded file — review &amp; use, or replace it below.</div>' : '')
      + preview
      + '<div style="display:flex;gap:8px;margin-top:12px"><label style="flex:1;text-align:center;border:1.5px solid #e5e4e0;border-radius:8px;padding:9px;font-size:13px;font-weight:600;color:#374151;cursor:pointer;background:#fff"><input type="file" accept="image/*,.png,.jpg,.jpeg,.svg,.webp,.pdf,.emb,.dst" style="display:none" onchange="EGDesignTools._upFile(this.files&&this.files[0])"/>' + (hasImg ? 'Replace file' : 'Choose file') + '</label>' + (hasImg ? '<button onclick="EGDesignTools._upRemoveBg()" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:9px 12px;font-size:13px;font-weight:600;color:#374151;cursor:pointer;background:#fff;font-family:inherit">Remove BG</button>' : '')
      + '</div><div id="egup-threads"></div></div>'
      + '<div style="position:sticky;bottom:0;background:#fff;border-top:1px solid #f0ede9;padding:14px 18px;display:flex;gap:8px"><button onclick="EGDesignTools._upClose()" class="btn btn-out" style="flex:1;font-size:13.5px">Cancel</button><button onclick="EGDesignTools._upSave()" class="btn btn-dk" style="flex:1;font-size:13.5px;' + (hasImg ? '' : 'opacity:.5;pointer-events:none') + '">Use this design</button></div>';
    _upThreads();
  }
  function _upThreadChips(threads) {
    return '<div style="margin-top:18px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Thread colours · ' + threads.length + '</div><div style="display:flex;flex-wrap:wrap;gap:6px">'
      + threads.map(function (t) { return '<div style="display:inline-flex;align-items:center;gap:7px;padding:5px 11px 5px 5px;background:#fff;border:1.5px solid #e5e4e0;border-radius:999px;font-size:12px;font-weight:600;color:#191918"><span style="width:16px;height:16px;border-radius:50%;background:' + (t.hex || '#e5e4e0') + ';border:1.5px solid rgba(0,0,0,.18)"></span><span style="font-family:monospace">' + (t.code || '—') + '</span>' + (t.name ? '<span style="color:#9ca3af;font-weight:500">' + t.name + '</span>' : '') + '</div>'; }).join('') + '</div>';
  }
  function _upThreads() {
    var s = _up; var box = document.getElementById('egup-threads'); if (!box || !s) return;
    if (!/EMB/i.test(s.tech)) { box.innerHTML = ''; return; }
    // Show the threads ALREADY matched for this item (same ones on the board's
    // composite) right away, so the panel never looks empty; then refine with a
    // live re-match against the current image.
    var stored = [];
    try { if (window.EGStore && EGStore.getItemThreadColors) stored = EGStore.getItemThreadColors(s.orderNum, s.sku) || []; } catch (e) {}
    if (stored.length) { s.threads = stored; box.innerHTML = _upThreadChips(stored); }
    else box.innerHTML = '<div style="margin-top:18px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em">Thread match</div><div style="font-size:12.5px;color:#9ca3af;margin-top:6px">Matching…</div>';
    if (!s.src || !(window.EGStore && EGStore.matchThreadColors)) { if (!stored.length) box.innerHTML = ''; return; }
    EGStore.matchThreadColors(_upCanvasSrc(s.src), function (threads) {
      if (!_up || _up !== s) return;
      if (threads && threads.length) { s.threads = threads; box.innerHTML = _upThreadChips(threads); }
      else if (!stored.length) { box.innerHTML = '<div style="margin-top:18px;font-size:12px;color:#9ca3af">No thread colours detected (image may not be readable in-browser).</div>'; }
    });
  }
  function _upFile(f) { if (!f || !_up) return; var rd = new FileReader(); rd.onload = function (ev) { _up.src = ev.target.result; _up.fromCustomer = false; _upRender(); }; rd.readAsDataURL(f); }
  function _upRemoveBg() {
    var s = _up; if (!s || !s.src) return;
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) return;
        var c = document.createElement('canvas'); c.width = w; c.height = h; var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        var data; try { data = ctx.getImageData(0, 0, w, h); } catch (e) { alert('This image can’t be processed in-browser (cross-origin).'); return; }
        var d = data.data; var px = function (x, y) { var i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
        var cs = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)]; var bg = [0, 0, 0]; cs.forEach(function (q) { bg[0] += q[0]; bg[1] += q[1]; bg[2] += q[2]; }); bg = bg.map(function (v) { return v / 4; });
        var tol = 46, removed = 0;
        for (var i = 0; i < d.length; i += 4) { var dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2]; if (Math.sqrt(dr * dr + dg * dg + db * db) < tol) { d[i + 3] = 0; removed++; } }
        if (!removed) { alert('No uniform background detected.'); return; }
        ctx.putImageData(data, 0, 0); _up.src = c.toDataURL('image/png'); _up.fromCustomer = false; _upRender();
      } catch (e) {}
    };
    img.onerror = function () {};
    img.src = _upCanvasSrc(s.src);
  }
  function _upSave() {
    var s = _up; if (!s || !s.src) return;
    try {
      var o = findOrder(s.orderNum); var it = o && o.items && o.items.find(function (i) { return String(i.sku) === String(s.sku); });
      if (o && window.EGStore && EGStore.cacheRawDesign) EGStore.cacheRawDesign(o.id, s.sku, s.src);
      if (it) { it.designUrl = s.src; if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items }); }
      if (o && window.EGStore && EGStore.getDesignCard && EGStore.pushToDesignBoard) { var card = EGStore.getDesignCard(o.id, s.sku); if (!card) EGStore.pushToDesignBoard({ orderNum: o.id, sku: s.sku, board: (s.tech || 'dtg').toLowerCase(), name: s.name, thumb: s.src, byRole: 'Factory' }); }
      if (/EMB/i.test(s.tech) && s.threads && s.threads.length && window.EGStore && EGStore.setItemThreadColors) EGStore.setItemThreadColors(o.id, s.sku, s.threads);
      document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: s.orderNum, sku: s.sku } }));
    } catch (e) {}
    _upClose(); refreshBoard();
  }
  function _upClose() { var p = document.getElementById('egup-panel'); var ov = document.getElementById('egup-ov'); if (p) p.classList.remove('open'); if (ov) ov.classList.remove('on'); _up = null; setTimeout(function () { if (p) p.style.display = 'none'; }, 280); }

  window.EGDesignTools = {
    upload: upload, templates: templates, designMaker: designMaker, designLab: designLab, openSellerPage: openSellerPage,
    // new-order setup
    itemActions: itemActions, pushButton: pushButton, pushButtonInline: pushButtonInline, pushToProduction: pushToProduction,
    addItem: addItem, addItemButton: addItemButton,
    placeDesign: placeDesign, _qpClose: qpClose, _qpSave: qpSave, _qpRemoveBg: qpRemoveBg,
    uploadPanel: uploadPanel, _upFile: _upFile, _upRemoveBg: _upRemoveBg, _upSave: _upSave, _upClose: _upClose,
    onSetProduct: onSetProduct, onSetPrint: onSetPrint, onSetVariant: onSetVariant, removeItem: removeItem, isNewOrder: isNewOrder, getItemSetup: getItemSetup, setupProductImage: setupProductImage,
    adoptCustomerFile: adoptCustomerFile, dismissCustomerFile: dismissCustomerFile, customerFileControls: customerFileControls, isCustomerFileDismissed: isCustomerFileDismissed,
    autoThreadMatch: autoThreadMatch,
    openTemplates: openTemplates, _closeTemplates: closeTemplates, _filterTemplates: filterTemplates, _applyTemplate: applyTemplate, _templatesPage: openTemplatesPage,
    PRINT_METHODS: PRINT_METHODS
  };
})();
