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

  // ── Per-line design key (mirrors the seller's assignDesignKeys/itemDK) ────────
  // Two line items with the SAME sku must be independent — otherwise every state
  // lookup (setup, design, threads, customer-file) keyed by sku resolves to the
  // first match and editing one item silently edits the others. The key is the
  // sku for the first occurrence, then sku#1, sku#2… for repeats — identical to
  // the seller side, so seller + factory resolve the same line to the same art.
  function itemDK(it) { return (it && it._dk) || (it && it.sku) || ''; }
  function assignDesignKeys(items) {
    if (!Array.isArray(items)) return items;
    var seen = {};
    items.forEach(function (it) {
      if (!it) return;
      var base = String(it.sku || '');
      var n = seen[base] || 0;
      it._dk = n === 0 ? base : base + '#' + n;
      seen[base] = n + 1;
    });
    return items;
  }
  // Find a line item by its design key (falls back to raw-sku match for callers
  // that still pass a plain sku, so nothing breaks mid-migration).
  function findItemByKey(o, key) {
    if (!o || !Array.isArray(o.items)) return null;
    assignDesignKeys(o.items);
    return o.items.find(function (i) { return itemDK(i) === key; }) || o.items.find(function (i) { return String(i.sku) === String(key); }) || null;
  }
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
  // An order is in "setup mode" (blank picker + design upload + composite shown,
  // for BOTH manual and synced/Etsy items) until it reaches production. Once it
  // hits Printing or any later/terminal stage the line is locked. This is what
  // lets synced Etsy items be blanked + uploaded just like manual ones, right up
  // to the moment they go to print.
  var EGDT_LOCKED_STATUS = {
    printing: 1, packing: 1, packed: 1, qc: 1, quality: 1,
    shipped: 1, delivered: 1, transit: 1, in_transit: 1, fulfilled: 1, fulfil: 1,
    cancelled: 1, canceled: 1, refunded: 1
  };
  function isNewOrder(o) { var s = orderStatusOf(o); return !EGDT_LOCKED_STATUS[s]; }

  function findOrder(orderNum) {
    var orders = (window.EGStore && EGStore.getOrders) ? (EGStore.getOrders() || []) : [];
    for (var i = 0; i < orders.length; i++) {
      var x = orders[i];
      if (String(x.num) === String(orderNum) || String(x.id) === String(orderNum)) { assignDesignKeys(x.items); return x; }
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

  // Best design-artwork URL to overlay on the blank for the live composite,
  // tried in priority order so the item image hydrates the moment ANY design
  // source exists — uploaded file, cached raw design, or the buyer's
  // marketplace upload. Returns '' when there's genuinely nothing to show.
  function designOverlaySrc(orderNum, it) {
    if (!it) return '';
    if (it.designUrl && /^(https?:|data:)/.test(String(it.designUrl))) return it.designUrl;
    try { if (window.EGStore && EGStore.getRawDesign) { var r = EGStore.getRawDesign(orderNum, itemDK(it)); if (r && /^(https?:|data:)/.test(String(r))) return r; } } catch (e) {}
    if (it.file && String(it.file).indexOf('data:') === 0) return it.file;
    if (it.customerFile && /^(https?:|data:)/.test(String(it.customerFile))) return it.customerFile;
    if (it.designSrc && /^https?:\/\//i.test(String(it.designSrc))) return it.designSrc;
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
      var it = findItemByKey(o, sku);
      if (!it) return;
      var price = productUnitPrice(p, it);
      if (price > 0) { it.price = price; it.unitPrice = price; }
      // Carry the chosen blank's identity + its catalog image onto the line item
      // (a SEPARATE field — never the marketplace listing image). This is what
      // makes the composite rehydrate everywhere the order is read, including the
      // mobile app after a barcode scan, where the blank is the mockup background.
      var blankImg = setupProductImage(orderNum, sku);
      it.blank = p.name || p.sku || p.id || it.blank || '';
      if (blankImg) it.img = blankImg;
      if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items });
      pushItemsToApi(o);
    } catch (e) {}
  }

  // Persist the order's line items to the server so factory-chosen blanks reach
  // the mobile app. Fire-and-forget PATCH (staff token); harmless if offline or
  // standalone — the board still works off localStorage.
  function pushItemsToApi(o) {
    try {
      if (!o || !o.id || !Array.isArray(o.items)) return;
      var tok = localStorage.getItem('eg_token');
      if (!tok) return;
      var base = (window.EGAuth && window.EGAuth.API_BASE) || '';
      fetch(base + '/api/orders/' + encodeURIComponent(o.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ items: o.items })
      }).catch(function () {});
    } catch (e) {}
  }

  function onSetProduct(orderNum, sku, val) { setItemSetupField(orderNum, sku, 'product', val); syncItemToProduct(orderNum, sku); refreshBoard(); document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: orderNum, sku: sku } })); }
  function onSetPrint(orderNum, sku, val) {
    setItemSetupField(orderNum, sku, 'printType', val);
    try {
      var o = findOrder(orderNum);
      if (o && Array.isArray(o.items)) {
        var it = findItemByKey(o, sku);
        if (it) {
          it.printType = val; it.tech = val; if (EGStore.update) EGStore.update(o.id, { items: o.items });
          pushItemsToApi(o);
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
    document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: orderNum, sku: sku } }));
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
    var name = ''; try { var o = findOrder(orderNum); var it = findItemByKey(o, sku); if (it) name = it.name || ''; } catch (e) {}
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
      var realSku = (it && it.sku) || sku;
      if (!p) { var base = String(realSku || '').split('-')[0]; p = prods.find(function (x) { return (Array.isArray(x.variantSkus) && x.variantSkus.some(function (v) { return v && v.sku === realSku; })) || (x.sku && base && x.sku.toUpperCase() === base.toUpperCase()); }); }
      if (p && Array.isArray(p.variantSkus)) { var sc = {}, ss = {}; p.variantSkus.forEach(function (v) { if (!v) return; if (v.color && !sc[v.color]) { sc[v.color] = 1; colors.push(v.color); } if (v.size && !ss[v.size]) { ss[v.size] = 1; sizes.push(v.size); } }); }
    } catch (e) {}
    var curC = (it && it.color) || _extractColor((it && it.sku) || sku), curS = (it && it.size) || _extractSize((it && it.sku) || sku);
    if (!colors.length) colors = _DEF_COLORS.slice();
    if (!sizes.length) sizes = _DEF_SIZES.slice();
    if (curC && colors.indexOf(curC) < 0) colors.unshift(curC);
    if (curS && sizes.indexOf(curS) < 0) sizes.unshift(curS);
    return { colors: colors, sizes: sizes, curColor: curC, curSize: curS };
  }
  function onSetVariant(orderNum, sku, key, value) {
    try {
      var o = findOrder(orderNum); if (!o || !Array.isArray(o.items)) return;
      var it = findItemByKey(o, sku); if (!it) return;
      it[key] = value;
      if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items });
      pushItemsToApi(o);
    } catch (e) {}
    refreshBoard();
    document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: orderNum, sku: sku } }));
  }
  // Remove a line item (New orders only) — keeps at least one, confirms first.
  function removeItem(orderNum, sku) {
    try {
      var o = findOrder(orderNum); if (!o || !Array.isArray(o.items)) return;
      if (o.items.length <= 1) { alert('An order must have at least one item.'); return; }
      if (!window.confirm('Remove this item from the order?')) return;
      assignDesignKeys(o.items);
      o.items = o.items.filter(function (i) { return itemDK(i) !== sku; });   // remove ONLY this line, not every same-sku line
      if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items });
    } catch (e) {}
    refreshBoard();
  }

  function _ensurePulseCss() {
    if (document.getElementById('egdt-pulse-css')) return;
    var st = document.createElement('style'); st.id = 'egdt-pulse-css';
    // Uniform "needs attention" cue across seller + factory: the seller's pickNudge
    // (a gentle horizontal nudge). Same animation everywhere, look + function alike.
    st.textContent = '@keyframes egdtPulse{0%,100%{transform:translateX(0)}50%{transform:translateX(3px)}}.egdt-pulse{animation:egdtPulse 1.2s ease-in-out infinite;border-color:#191918!important}';
    document.head.appendChild(st);
  }
  function actBtn(label, onclick) {
    return '<button class="btn btn-out" style="font-size:11px;padding:3px 9px;white-space:nowrap" onclick="' + onclick + '">' + label + '</button>';
  }
  function opt(val, label, sel) { return '<option value="' + esc(val) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }

  // Full right-side action cluster for an item row. Drop-in replacement for the
  // boards' hand-written Upload/Templates/Design Maker button group, plus the
  // product + print-method pickers when the order is still "new".
  // Trash button HTML — shared by itemActions (inline) and itemTrash (when a
  // board wants to place the delete control elsewhere on the row, e.g. admin
  // pins it to the far end). Only while New, keeps ≥1 item.
  function _trashHtml(num, sku) {
    // Small on-theme dark × (not a bulky trash can) at the row's end.
    return '<button title="Remove item" onclick="EGDesignTools.removeItem(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\')" style="background:none;border:none;cursor:pointer;color:#9ca3af;padding:2px 3px;flex-shrink:0;font-family:inherit;line-height:0" onmouseover="this.style.color=\'#191918\'" onmouseout="this.style.color=\'#9ca3af\'"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>';
  }
  function itemTrash(o, it) {
    o = o || {}; it = it || {};
    var num = o.num || o.id || '';
    assignDesignKeys(o.items);
    var sku = itemDK(it);
    return isNewOrder(o) ? _trashHtml(num, sku) : '';
  }
  function itemActions(o, it, opts) {
    opts = opts || {};
    o = o || {}; it = it || {};
    var num = o.num || o.id || '';
    assignDesignKeys(o.items);            // ensure every line has a stable _dk
    var sku = itemDK(it);                  // the per-line key (sku, sku#1, …) — drives all state below
    var name = it.name || '';
    var tech = it.type || it.printType || it.tech || '';
    // Auto-darken Upload once a design is attached (raw design cached, an adopted
    // customer file, or an uploaded file on the item) — mirrors the seller's
    // active-state design button. Clicking still re-opens upload to replace it.
    var _hasDesign = false;
    try { _hasDesign = !!(window.EGStore && EGStore.getRawDesign && EGStore.getRawDesign(num, sku)); } catch (e) {}
    if (!_hasDesign && (it.file || it.designUrl || it.thumb || it.customerFile || (it.designSrc && /^https?:\/\//i.test(String(it.designSrc))))) _hasDesign = true;
    var _upOnclick = "EGDesignTools.uploadPanel('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "','" + jsAttr(tech) + "')";
    // Pulse the Upload button while a NEW order's item still has no design — a
    // gold "needs upload" cue, like the seller side. Injected once.
    _ensurePulseCss();
    var _pulse = (isNewOrder(o) && !_hasDesign) ? ' egdt-pulse' : '';
    var uploadBtn = _hasDesign
      ? '<button class="btn" style="font-size:11px;padding:3px 9px;white-space:nowrap;background:#191918;color:#fff;border:1px solid #191918" title="Design attached — click to replace" onclick="' + _upOnclick + '">Uploaded</button>'
      : '<button class="btn btn-out' + _pulse + '" style="font-size:11px;padding:3px 9px;white-space:nowrap" title="Upload a design" onclick="' + _upOnclick + '">↑ Upload</button>';
    // Labeled meta-row layout — the editable selectors mirror the read-only
    // METHOD · DESIGN · STOCK · THREADS row (same grey uppercase labels), so a
    // "new" selling-mode order reads identically to an in-review one; the values
    // just happen to be live controls. Replaces the old cluttered pill cluster.
    var _lbl = 'font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap';
    var selSm = 'border:1px solid #e5e4e0;border-radius:6px;background:#fff;font-size:11.5px;font-weight:600;color:#374151;font-family:inherit;cursor:pointer;outline:none;padding:3px 7px;text-overflow:ellipsis';
    function _field(label, ctrl) { return '<div style="display:inline-flex;align-items:center;gap:7px;white-space:nowrap">' + '<span style="' + _lbl + '">' + label + '</span>' + ctrl + '</div>'; }
    var pickers = '';
    if (isNewOrder(o)) {
      var setup = getItemSetup(num, sku);
      var prods = (window.EGStore && EGStore.getCatalogProducts) ? (EGStore.getCatalogProducts() || []) : [];
      var curProd = setup.product || '', matched = false;
      var prodOpts = '<option value="">Pick a blank…</option>';
      prods.forEach(function (p) {
        var v = p.name || p.sku || p.id || ''; if (!v) return;
        var s = curProd && String(curProd) === String(v); if (s) matched = true;
        prodOpts += opt(v, p.name || p.sku || v, s);
      });
      if (curProd && !matched) prodOpts += opt(curProd, curProd, true);
      var curPt = (setup.printType || tech || '').toString().toUpperCase();
      var ptOpts = '<option value="">Method…</option>';
      PRINT_METHODS.forEach(function (m) { ptOpts += opt(m, PRINT_LABELS[m] || m, curPt === m); });
      var vo = variantOptions(num, sku, it);
      var colorOpts = (vo.curColor ? '' : '<option value="">Color…</option>') + vo.colors.map(function (c) { return opt(c, c, c === vo.curColor); }).join('');
      var sizeOpts = (vo.curSize ? '' : '<option value="">Size…</option>') + vo.sizes.map(function (s) { return opt(s, s, s === vo.curSize); }).join('');
      // One unified box — Product · Color · Size · Method on a single line,
      // dot-separated, mirroring the seller-side variation pill. The selects are
      // borderless/transparent so they read as one continuous control.
      var selIn = 'border:none;background:transparent;font-size:11.5px;font-weight:600;color:#374151;font-family:inherit;cursor:pointer;outline:none;padding:2px 2px;text-overflow:ellipsis;max-width:160px;-webkit-appearance:none;-moz-appearance:none;appearance:none';
      var _dot = '<span style="color:#c4c3be;font-weight:700;padding:0 3px;flex-shrink:0">·</span>';
      pickers = '<div style="display:inline-flex;align-items:center;flex-wrap:nowrap;border:1px solid #e5e4e0;border-radius:8px;padding:3px 10px;background:#fff;max-width:100%;overflow:hidden">'
        + '<select title="Base product" style="' + selIn + ';max-width:150px" onchange="EGDesignTools.onSetProduct(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',this.value)">' + prodOpts + '</select>' + _dot
        + '<select title="Colour" style="' + selIn + ';max-width:96px" onchange="EGDesignTools.onSetVariant(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',\'color\',this.value)">' + colorOpts + '</select>' + _dot
        + '<select title="Size" style="' + selIn + ';max-width:74px" onchange="EGDesignTools.onSetVariant(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',\'size\',this.value)">' + sizeOpts + '</select>' + _dot
        + '<select title="Print method" style="' + selIn + ';max-width:96px" onchange="EGDesignTools.onSetPrint(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',this.value)">' + ptOpts + '</select>'
        + '</div>';
    }
    // DESIGN field carries the Upload control; Templates + Design Maker fold into
    // a compact ⋯ overflow menu so the row stays uncluttered.
    // Design controls belong to the NEW/selling-mode setup only. Once the order is
    // pushed to production (in_review onward) the row drops the Upload/Uploaded
    // state — the design then lives solely in the click-to-zoom image lightbox.
    var designField = isNewOrder(o) ? _field('Design', uploadBtn) : '';
    var moreBtn = '<button title="More — Templates · Design Maker" onclick="EGDesignTools._moreMenu(\'' + jsAttr(num) + '\',\'' + jsAttr(sku) + '\',\'' + jsAttr(name) + '\',this,event)" style="background:#fff;border:1px solid #e5e4e0;border-radius:6px;cursor:pointer;color:#6b7280;padding:2px 8px 4px;font-size:14px;line-height:1;font-family:inherit;flex-shrink:0" onmouseover="this.style.borderColor=\'#191918\';this.style.color=\'#191918\'" onmouseout="this.style.borderColor=\'#e5e4e0\';this.style.color=\'#6b7280\'">⋯</button>';
    // Delete (trash) — only while New, keeps ≥1 item. A board can suppress it
    // here (opts.noTrash) and render EGDesignTools.itemTrash(o,it) elsewhere.
    var delBtn = (isNewOrder(o) && !opts.noTrash) ? _trashHtml(num, sku) : '';
    // Upload/Templates/Design Maker now live as tabs inside the one Design panel,
    // so the row needs a single Design button — the ⋯ overflow menu is retired.
    // Left-packed so the controls sit right after the (capped) product title — no
    // margin-left:auto, which previously shoved the whole group to the far edge and
    // left a big gap. The board row caps the title width so this stays close.
    return '<div style="display:flex;gap:14px;flex-shrink:0;align-items:center;flex-wrap:wrap;justify-content:flex-start;row-gap:8px" onclick="event.stopPropagation()">' + pickers + designField + delBtn + '</div>';
  }

  // Compact ⋯ overflow menu for an item's secondary actions (Templates, Design
  // Maker) — keeps the labeled meta-row from getting busy. Closes on outside click.
  function _moreMenu(num, sku, name, btn, ev) {
    if (ev) ev.stopPropagation();
    var old = document.getElementById('egdt-more-menu'); if (old) { old.remove(); return; }
    var r = btn.getBoundingClientRect();
    var m = document.createElement('div'); m.id = 'egdt-more-menu';
    m.style.cssText = 'position:fixed;z-index:10140;background:#fff;border:1px solid #e5e4e0;border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:5px;min-width:152px;font-family:Inter,system-ui,sans-serif';
    m.style.top = (r.bottom + 5) + 'px'; m.style.left = Math.max(8, r.right - 152) + 'px';
    var item = function (label, onclick) { return '<button onclick="' + onclick + ';var _mm=document.getElementById(\'egdt-more-menu\');if(_mm)_mm.remove()" style="display:block;width:100%;text-align:left;background:none;border:none;cursor:pointer;font-size:13px;color:#374151;padding:7px 10px;border-radius:6px;font-family:inherit" onmouseover="this.style.background=\'#f6f5f4\'" onmouseout="this.style.background=\'none\'">' + label + '</button>'; };
    m.innerHTML = item('Templates', "EGDesignTools.openTemplates('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "',event)")
      + item('Design Maker', "EGDesignTools.designMaker('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "')");
    document.body.appendChild(m);
    setTimeout(function () { document.addEventListener('click', function _c() { var _mm = document.getElementById('egdt-more-menu'); if (_mm) _mm.remove(); document.removeEventListener('click', _c); }); }, 0);
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
    return '<button id="egdt-push-' + jsAttr(num) + '" title="Push to production" onclick="event.stopPropagation();EGDesignTools.pushToProduction(\'' + jsAttr(num) + '\')" '
      + 'style="height:32px;padding:0 14px;display:inline-flex;align-items:center;border-radius:7px;border:1.5px solid #191918;background:#191918;color:#fff;cursor:pointer;flex-shrink:0;font-family:inherit;font-size:12.5px;font-weight:600;transition:background .15s" '
      + 'onmouseover="this.style.background=\'#000\'" onmouseout="this.style.background=\'#191918\'">Push</button>';
  }

  // True once an item has everything needed to enter production: a base product
  // (picked, or its sku already maps to a catalog product), a print method, and a
  // design (uploaded / adopted / template / customer file).
  function itemSetupComplete(orderNum, o, it) {
    var dk = itemDK(it);
    var s = getItemSetup((o && o.num) || orderNum, dk) || {};
    var hasProduct = !!s.product;
    if (!hasProduct) { try { hasProduct = !!chosenProduct(orderNum, dk); } catch (e) {} }
    if (!hasProduct) { try { var prods = (window.EGStore && EGStore.getCatalogProducts) ? (EGStore.getCatalogProducts() || []) : []; var base = String(it.sku || '').split('-')[0]; hasProduct = prods.some(function (p) { return (Array.isArray(p.variantSkus) && p.variantSkus.some(function (v) { return v && v.sku === it.sku; })) || (p.sku && base && p.sku.toUpperCase() === base.toUpperCase()); }); } catch (e) {} }
    var hasMethod = !!(s.printType || it.printType || it.tech);
    var hasDesign = false;
    try { hasDesign = !!(window.EGStore && EGStore.getRawDesign && o && EGStore.getRawDesign(o.id, dk)); } catch (e) {}
    if (!hasDesign && (it.designUrl || it.customerFile || (it.designSrc && /^https?:\/\//i.test(String(it.designSrc))))) hasDesign = true;
    var miss = [];
    if (!hasProduct) miss.push('product');
    if (!hasMethod) miss.push('method');
    if (!hasDesign) miss.push('design');
    return { ok: !miss.length, miss: miss };
  }
  function itemNeedsDesign(orderNum, o, it) { return !itemSetupComplete(orderNum, o, it).ok; }

  function pushToProduction(orderNum) {
    var o = findOrder(orderNum);
    var id = o ? o.id : orderNum;
    if (o && Array.isArray(o.items) && o.items.length) {
      var problems = [];
      o.items.forEach(function (it) {
        var r = itemSetupComplete(orderNum, o, it);
        if (!r.ok) problems.push('• ' + (it.name || it.sku || 'Item') + ' — needs ' + r.miss.join(' + '));
      });
      // Not ready → no popup, and DON'T pulse the Push button. The incomplete
      // items' own action buttons pulse (Upload / pickers) to show what's missing.
      // Re-render so those pulses are showing, then silently refuse.
      if (problems.length) { refreshBoard(); return; }
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
        var it = findItemByKey(o, ctx.sku);
        if (it) {
          it.designSrc = 'template'; it.designTemplateId = t.id;
          if (designImg) { it.designUrl = designImg; if (window.EGStore && EGStore.cacheRawDesign && o.id) EGStore.cacheRawDesign(o.id, ctx.sku, designImg); }
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

  // ── Right-side upload panel (seller-style) — replaces the bare file picker. ──
  // Pre-populates with the customer's marketplace upload (or current design), lets
  // you replace it, remove its background, and shows the live thread match for EMB
  // items. "Use this design" caches it as the item's design + persists threads.
  var _up = null;
  function _upCanvasSrc(url) { if (/^data:/i.test(String(url))) return url; if (/(^|\.)etsystatic\.com/i.test(String(url))) return '/api/etsy/img-proxy?url=' + encodeURIComponent(url); return url; }
  function uploadPanel(orderNum, sku, name, tech) {
    var o = findOrder(orderNum);
    var it = findItemByKey(o, sku);
    var initial = '';
    try { if (window.EGStore && EGStore.getRawDesign && o) { var r = EGStore.getRawDesign(o.id, sku); if (r) initial = r; } } catch (e) {}
    var custFile = it ? (it.customerFile || (it.designSrc && /^https?:\/\//i.test(String(it.designSrc)) ? String(it.designSrc) : '')) : '';
    if (!initial && it) initial = custFile || it.designUrl || '';
    _up = { orderNum: orderNum, sku: sku, name: name || (it && it.name) || sku, tech: String(tech || (it && it.printType) || '').toUpperCase(), src: initial, fromCustomer: !!(initial && initial === custFile), threads: [], tab: 'upload' };
    _upEnsure(); _upRender();
    var p = document.getElementById('egup-panel'); p.style.display = 'block'; setTimeout(function () { p.classList.add('open'); }, 10);
  }
  function _upEnsure() {
    if (document.getElementById('egup-panel')) return;
    if (!document.getElementById('egup-css')) { var st = document.createElement('style'); st.id = 'egup-css'; st.textContent = '#egup-ov{position:fixed;inset:0;background:rgba(25,25,24,.28);z-index:10125;display:none}#egup-ov.on{display:block}#egup-panel{position:fixed;top:0;right:-480px;bottom:0;width:440px;max-width:92vw;background:#fff;border-left:1px solid #e5e4e0;z-index:10130;box-shadow:-8px 0 32px rgba(0,0,0,.12);transition:right .28s cubic-bezier(.22,1,.36,1);overflow-y:auto;font-family:Inter,system-ui,sans-serif}#egup-panel.open{right:0}'; document.head.appendChild(st); }
    var ov = document.createElement('div'); ov.id = 'egup-ov'; ov.onclick = function () { _upClose(); }; document.body.appendChild(ov);
    var p = document.createElement('div'); p.id = 'egup-panel'; p.style.display = 'none'; document.body.appendChild(p);
  }
  // The panel now has three tabs — Upload · Templates · Design Maker — so every
  // design source lives in ONE consistent surface (no floating popup, no ⋯ menu).
  function _upTab(t) { if (_up) { _up.tab = t; _upRender(); } }
  function _upRender() {
    var s = _up; if (!s) return; var p = document.getElementById('egup-panel');
    document.getElementById('egup-ov').classList.add('on');
    var tab = s.tab || 'upload';
    var tb = function (t, lbl) {
      var on = t === tab;
      return '<button onclick="EGDesignTools._upTab(\'' + t + '\')" style="flex:1;background:none;border:none;padding:11px 6px;font-size:12.5px;font-weight:' + (on ? '700' : '600') + ';color:' + (on ? '#191918' : '#9ca3af') + ';cursor:pointer;font-family:inherit;border-bottom:2px solid ' + (on ? '#191918' : 'transparent') + ';margin-bottom:-1px">' + lbl + '</button>';
    };
    var head = '<div style="padding:16px 18px 0;display:flex;align-items:flex-start;justify-content:space-between"><div style="min-width:0"><div style="font-size:15px;font-weight:700;color:#191918">Design</div><div style="font-size:12.5px;color:#9ca3af;margin-top:1px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name) + '</div></div><button onclick="EGDesignTools._upClose()" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:19px;line-height:1">&times;</button></div>';
    var tabs = '<div style="display:flex;border-bottom:1px solid #f0ede9;margin-top:12px;padding:0 10px">' + tb('upload', 'Upload') + tb('templates', 'Templates') + tb('maker', 'Design Maker') + '</div>';
    p.innerHTML = head + tabs + (tab === 'templates' ? _upTemplatesBody(s) : tab === 'maker' ? _upMakerBody(s) : _upUploadBody(s));
    if (tab === 'upload') _upThreads();
    else if (tab === 'templates') _upFilterTpl('');
  }
  function _upUploadBody(s) {
    var hasImg = !!s.src;
    var preview = hasImg
      ? ('<div id="egup-lwrap" onmousemove="EGDesignTools._upLensMove(event)" onmouseleave="EGDesignTools._upLensHide()" style="position:relative;width:100%;aspect-ratio:1;border:1.5px solid #e5e4e0;border-radius:10px;overflow:hidden;background:#f6f5f4">'
          + '<img id="egup-limg" src="' + _upCanvasSrc(s.src) + '" crossorigin="anonymous" onmouseenter="EGDesignTools._upLensShow()" onclick="EGDesignTools._upPick(event)" style="width:100%;height:100%;object-fit:contain;display:block;cursor:crosshair"/>'
          + '<div id="egup-lens" style="position:absolute;width:90px;height:90px;border-radius:50%;border:2px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,.25),0 0 0 1px rgba(0,0,0,.08);background-repeat:no-repeat;background-color:#fff;pointer-events:none;display:none;z-index:2"></div>'
          + '<div id="egup-cross" style="position:absolute;width:14px;height:14px;border:1.5px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.4);transform:translate(-50%,-50%);pointer-events:none;display:none;z-index:4"></div>'
          + '</div>'
          + '<div style="font-size:11px;color:#9ca3af;margin-top:6px;text-align:center">Hover to magnify · click the artwork to sample a thread colour</div>')
      : '<label style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;aspect-ratio:1;border:1.5px dashed #c4c3be;border-radius:10px;cursor:pointer;color:#9ca3af;font-size:13px;gap:8px;text-align:center"><input type="file" accept="image/*,.png,.jpg,.jpeg,.svg,.webp,.pdf,.emb,.dst" style="display:none" onchange="EGDesignTools._upFile(this.files&&this.files[0])"/><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 16V4M7 9l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Click to choose a file</label>';
    return '<div style="padding:18px">'
      + (s.fromCustomer && hasImg ? '<div style="font-size:12px;font-weight:600;color:#7c3aed;background:#faf5ff;border:1px solid #e9d5ff;border-radius:7px;padding:7px 10px;margin-bottom:12px">Customer-uploaded file — review &amp; use, or replace it below.</div>' : '')
      + preview
      + '<div style="display:flex;gap:8px;margin-top:12px"><label style="flex:1;text-align:center;border:1.5px solid #e5e4e0;border-radius:8px;padding:9px;font-size:13px;font-weight:600;color:#374151;cursor:pointer;background:#fff"><input type="file" accept="image/*,.png,.jpg,.jpeg,.svg,.webp,.pdf,.emb,.dst" style="display:none" onchange="EGDesignTools._upFile(this.files&&this.files[0])"/>' + (hasImg ? 'Replace file' : 'Choose file') + '</label>' + (hasImg ? '<button onclick="EGDesignTools._upRemoveBg()" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:9px 12px;font-size:13px;font-weight:600;color:#374151;cursor:pointer;background:#fff;font-family:inherit">Remove BG</button>' : '')
      + '</div><div id="egup-threads"></div></div>'
      + '<div style="position:sticky;bottom:0;background:#fff;border-top:1px solid #f0ede9;padding:14px 18px;display:flex;gap:8px"><button onclick="EGDesignTools._upClose()" class="btn btn-out" style="flex:1;font-size:13.5px">Cancel</button><button onclick="EGDesignTools._upSave()" class="btn btn-dk" style="flex:1;font-size:13.5px;' + (hasImg ? '' : 'opacity:.5;pointer-events:none') + '">Use this design</button></div>';
  }
  // Templates tab — the saved-template list, INLINE in the panel (replaces the old
  // floating popup). Clicking one applies it to this exact line item and closes.
  function _upTemplatesBody(s) {
    return '<div style="padding:14px 18px">'
      + '<input id="egup-tpl-search" placeholder="Search templates…" oninput="EGDesignTools._upFilterTpl(this.value)" style="width:100%;box-sizing:border-box;border:1px solid #e5e4e0;border-radius:8px;padding:8px 11px;font-size:13px;font-family:inherit;outline:none;margin-bottom:10px"/>'
      + '<div id="egup-tpl-list" style="display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow:auto"></div>'
      + '</div>';
  }
  function _upFilterTpl(q) {
    var box = document.getElementById('egup-tpl-list'); if (!box) return;
    var all = _loadTemplates();
    if (!all.length) { box.innerHTML = '<div style="padding:26px 8px;text-align:center;font-size:13px;color:#9ca3af;line-height:1.6">No saved templates yet.<br>Make one in <b>Design Maker</b> and save it to reuse here.</div>'; return; }
    var ql = String(q || '').toLowerCase();
    var res = ql ? all.filter(function (t) { return String(t.name || '').toLowerCase().indexOf(ql) >= 0 || _tplTechOf(t).toLowerCase().indexOf(ql) >= 0; }) : all;
    if (!res.length) { box.innerHTML = '<div style="padding:18px;text-align:center;font-size:13px;color:#9ca3af">No templates match.</div>'; return; }
    box.innerHTML = res.map(function (t) {
      var tech = _tplTechOf(t);
      var thumb = t.designOnlyImg || t.compositeImg || t.productImg || '';
      var th = thumb ? '<img src="' + esc(thumb) + '" style="width:38px;height:38px;object-fit:cover;border-radius:8px;background:#f0ede9;flex-shrink:0" onerror="this.style.visibility=\'hidden\'"/>' : '<div style="width:38px;height:38px;background:#f0ede9;border-radius:8px;flex-shrink:0"></div>';
      return '<button onclick="EGDesignTools._upApplyTemplate(\'' + jsAttr(String(t.id)) + '\')" style="display:flex;align-items:center;gap:11px;padding:8px 10px;cursor:pointer;border-radius:9px;border:1px solid #e5e4e0;background:#fff;text-align:left;font-family:inherit;width:100%" onmouseover="this.style.borderColor=\'#191918\'" onmouseout="this.style.borderColor=\'#e5e4e0\'">' + th + '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:#191918;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.name || 'Untitled template') + '</div><div style="font-size:11px;color:#9ca3af;margin-top:2px">' + tech + '</div></div></button>';
    }).join('');
  }
  function _upApplyTemplate(id) {
    var s = _up; if (!s) return;
    _tplCtx = { orderNum: s.orderNum, sku: s.sku, name: s.name };   // applyTemplate keys by ctx.sku (the line key)
    applyTemplate(id);
    _upClose();
  }
  // Design Maker tab — the canvas editor needs full width, so launch the existing
  // overlay (carrying this order+line context); attaching there returns to the board.
  function _upMakerBody(s) {
    var hasImg = !!s.src;
    return '<div style="padding:24px 18px;text-align:center">'
      + (hasImg
        ? '<img src="' + _upCanvasSrc(s.src) + '" style="width:120px;height:120px;object-fit:contain;border:1px solid #e5e4e0;border-radius:10px;background:#f6f5f4;margin:0 auto 14px;display:block"/>'
        : '<div style="width:120px;height:120px;border:1.5px dashed #c4c3be;border-radius:10px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;color:#c4c3be"><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L19 9l-4-4L4 16v4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div>')
      + '<div style="font-size:13px;color:#6b7280;line-height:1.55;margin:0 auto 16px;max-width:300px">Open the full editor to place &amp; resize the artwork on the blank, then attach it back to this item.</div>'
      + '<button onclick="EGDesignTools._upOpenMaker()" class="btn btn-dk" style="font-size:13.5px;padding:9px 18px">Open Design Maker →</button>'
      + '</div>';
  }
  function _upOpenMaker() {
    var s = _up; if (!s) return;
    var on = s.orderNum, sk = s.sku, nm = s.name;
    _upClose();
    designMaker(on, sk, nm);
  }
  // ── Magnifier lens + click-to-sample-thread on the panel preview (ported from
  //    the seller's pickThreadFromImage/tpLens*). Hover = 3× zoom loupe; click =
  //    sample the pixel → nearest in-stock thread → add a chip. ─────────────────
  function _upLensShow() { var l = document.getElementById('egup-lens'), c = document.getElementById('egup-cross'); if (l) l.style.display = 'block'; if (c) c.style.display = 'block'; }
  function _upLensHide() { document.querySelectorAll('#egup-lens,#egup-cross').forEach(function (el) { el.style.display = 'none'; }); }
  function _upLensMove(ev) {
    var wrap = document.getElementById('egup-lwrap'), img = document.getElementById('egup-limg'), lens = document.getElementById('egup-lens'), cross = document.getElementById('egup-cross');
    if (!wrap || !img || !lens) return;
    var wr = wrap.getBoundingClientRect(), ir = img.getBoundingClientRect();
    var wx = ev.clientX - wr.left, wy = ev.clientY - wr.top, ix = ev.clientX - ir.left, iy = ev.clientY - ir.top;
    if (ix < 0 || iy < 0 || ix > ir.width || iy > ir.height) { _upLensHide(); return; }
    _upLensShow();
    var sz = 90, zoom = 3;
    if (!lens.style.backgroundImage) { lens.style.backgroundImage = 'url("' + img.src + '")'; lens.style.backgroundSize = (ir.width * zoom) + 'px ' + (ir.height * zoom) + 'px'; }
    lens.style.left = (wx - sz / 2) + 'px'; lens.style.top = (wy - sz / 2) + 'px';
    var bgX = -(ix * zoom - sz / 2), bgY = -(iy * zoom - sz / 2), offX = ir.left - wr.left, offY = ir.top - wr.top;
    lens.style.backgroundPosition = (bgX + offX * zoom) + 'px ' + (bgY + offY * zoom) + 'px';
    if (cross) { cross.style.left = wx + 'px'; cross.style.top = wy + 'px'; }
  }
  function _upPulse(x, y, bg) { var dot = document.createElement('div'); dot.style.cssText = 'position:fixed;width:22px;height:22px;border:2px solid #fff;border-radius:50%;background:' + bg + ';box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;z-index:10140;transform:translate(-50%,-50%);left:' + x + 'px;top:' + y + 'px;transition:transform .55s cubic-bezier(.22,1,.36,1),opacity .55s'; document.body.appendChild(dot); requestAnimationFrame(function () { dot.style.transform = 'translate(-50%,-50%) scale(1.9)'; dot.style.opacity = '0'; }); setTimeout(function () { dot.remove(); }, 580); }
  function _upPick(ev) {
    ev.stopPropagation();
    _upLensHide();
    try { document.querySelectorAll('#egup-lens,#egup-cross').forEach(function (el) { el.style.display = 'none'; }); } catch (e) {}
    var s = _up; if (!s) return;
    var img = document.getElementById('egup-limg'); if (!img || !img.naturalWidth) return;
    var rect = img.getBoundingClientRect(), cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    try {
      var cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      var ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
      var px = Math.max(0, Math.min(img.naturalWidth - 1, Math.round((cx / rect.width) * img.naturalWidth)));
      var py = Math.max(0, Math.min(img.naturalHeight - 1, Math.round((cy / rect.height) * img.naturalHeight)));
      var d; try { d = ctx.getImageData(px, py, 1, 1).data; } catch (e) { return; }
      if (d[3] < 30) return;
      if (!(window.EGStore && EGStore.nearestThread)) return;
      var t = EGStore.nearestThread(d[0], d[1], d[2]); if (!t) return;
      _upPulse(ev.clientX, ev.clientY, 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')');
      s.threads = s.threads || [];
      if (s.threads.some(function (x) { return x.code === t.code; })) return;
      s.threads.push({ code: t.code, name: t.name, hex: t.hex });
      var box = document.getElementById('egup-threads'); if (box) box.innerHTML = _upThreadChips(s.threads);
    } catch (e) {}
  }
  function _upThreadChips(threads) {
    return '<div style="margin-top:18px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Thread colours · ' + threads.length + ' <span style="font-weight:500;text-transform:none;letter-spacing:0;color:#c4c3be">· click the artwork to add</span></div><div style="display:flex;flex-wrap:wrap;gap:6px">'
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
      var o = findOrder(s.orderNum); var it = findItemByKey(o, s.sku);
      if (o && window.EGStore && EGStore.cacheRawDesign) EGStore.cacheRawDesign(o.id, s.sku, s.src);
      if (it) { it.designUrl = s.src; if (window.EGStore && EGStore.update) EGStore.update(o.id, { items: o.items }); }
      if (o && window.EGStore && EGStore.getDesignCard && EGStore.pushToDesignBoard) { var card = EGStore.getDesignCard(o.id, s.sku); if (!card) EGStore.pushToDesignBoard({ orderNum: o.id, sku: s.sku, board: (s.tech || 'dtg').toLowerCase(), name: s.name, thumb: s.src, byRole: 'Factory' }); }
      if (s.threads && s.threads.length && window.EGStore && EGStore.setItemThreadColors) EGStore.setItemThreadColors(o.id, s.sku, s.threads);
      document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: s.orderNum, sku: s.sku } }));
    } catch (e) {}
    _upClose(); refreshBoard();
  }
  function _upClose() { var p = document.getElementById('egup-panel'); var ov = document.getElementById('egup-ov'); if (p) p.classList.remove('open'); if (ov) ov.classList.remove('on'); _up = null; setTimeout(function () { if (p) p.style.display = 'none'; }, 280); }

  window.EGDesignTools = {
    upload: upload, templates: templates, designMaker: designMaker, designLab: designLab, openSellerPage: openSellerPage,
    // new-order setup
    itemActions: itemActions, itemTrash: itemTrash, pushButton: pushButton, pushButtonInline: pushButtonInline, pushToProduction: pushToProduction,
    addItem: addItem, addItemButton: addItemButton,
    uploadPanel: uploadPanel, _upFile: _upFile, _upRemoveBg: _upRemoveBg, _upSave: _upSave, _upClose: _upClose,
    _upTab: _upTab, _upFilterTpl: _upFilterTpl, _upApplyTemplate: _upApplyTemplate, _upOpenMaker: _upOpenMaker,
    _upLensShow: _upLensShow, _upLensMove: _upLensMove, _upLensHide: _upLensHide, _upPick: _upPick,
    onSetProduct: onSetProduct, onSetPrint: onSetPrint, onSetVariant: onSetVariant, removeItem: removeItem, isNewOrder: isNewOrder, getItemSetup: getItemSetup, setupProductImage: setupProductImage, designOverlaySrc: designOverlaySrc,
    adoptCustomerFile: adoptCustomerFile, dismissCustomerFile: dismissCustomerFile, customerFileControls: customerFileControls, isCustomerFileDismissed: isCustomerFileDismissed,
    autoThreadMatch: autoThreadMatch,
    openTemplates: openTemplates, _closeTemplates: closeTemplates, _filterTemplates: filterTemplates, _applyTemplate: applyTemplate, _templatesPage: openTemplatesPage, _moreMenu: _moreMenu,
    assignDesignKeys: assignDesignKeys, itemDK: itemDK,
    PRINT_METHODS: PRINT_METHODS
  };
})();
