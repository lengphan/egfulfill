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
    ['renderOpOrders', 'whRenderOrders', 'admRenderOrders', 'renderOrders'].forEach(function (fn) {
      try { if (typeof window[fn] === 'function') window[fn](); } catch (e) {}
    });
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
    var btns = actBtn('↑ Upload', "EGDesignTools.upload('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "','" + jsAttr(tech) + "')")
      + actBtn('Templates', "EGDesignTools.openTemplates('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "',event)")
      + actBtn('Design Maker', "EGDesignTools.designMaker('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "')");
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
      pickers = '<select title="Base product" style="' + sel + '" onchange="EGDesignTools.onSetProduct(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',this.value)">' + prodOpts + '</select>'
        + '<select title="Print method" style="' + sel + '" onchange="EGDesignTools.onSetPrint(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',this.value)">' + ptOpts + '</select>';
    }
    return '<div style="display:flex;gap:6px;flex-shrink:0;margin-left:auto;align-items:center;flex-wrap:wrap;justify-content:flex-end" onclick="event.stopPropagation()">' + pickers + btns + '</div>';
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
        + '<div id="egt-tpl-list" style="max-height:300px;overflow:auto;padding:4px"></div>';
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

  window.EGDesignTools = {
    upload: upload, templates: templates, designMaker: designMaker, designLab: designLab, openSellerPage: openSellerPage,
    // new-order setup
    itemActions: itemActions, pushButton: pushButton, pushButtonInline: pushButtonInline, pushToProduction: pushToProduction,
    onSetProduct: onSetProduct, onSetPrint: onSetPrint, isNewOrder: isNewOrder, getItemSetup: getItemSetup, setupProductImage: setupProductImage,
    adoptCustomerFile: adoptCustomerFile, dismissCustomerFile: dismissCustomerFile, customerFileControls: customerFileControls, isCustomerFileDismissed: isCustomerFileDismissed,
    autoThreadMatch: autoThreadMatch,
    openTemplates: openTemplates, _closeTemplates: closeTemplates, _filterTemplates: filterTemplates, _applyTemplate: applyTemplate,
    PRINT_METHODS: PRINT_METHODS
  };
})();
