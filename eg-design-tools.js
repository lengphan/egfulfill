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
      return '<button class="egdl-card" data-act="' + action + '" style="text-align:left;background:#fff;border:1px solid #e5e4e0;border-radius:14px;padding:22px;cursor:pointer;font-family:inherit;transition:box-shadow .15s,border-color .15s" onmouseover="this.style.boxShadow=\'0 6px 22px rgba(0,0,0,.08)\';this.style.borderColor=\'#d4cfc7\'" onmouseout="this.style.boxShadow=\'\';this.style.borderColor=\'#e5e4e0\'">'
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
      + '<div style="max-width:1180px;margin:0 auto;padding:30px 24px;width:100%;box-sizing:border-box">'
      + '<div style="font-size:22px;font-weight:800;color:#191918;margin-bottom:20px">Welcome to Design Lab</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px">'
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

  function onSetProduct(orderNum, sku, val) { setItemSetupField(orderNum, sku, 'product', val); }
  function onSetPrint(orderNum, sku, val) {
    setItemSetupField(orderNum, sku, 'printType', val);
    try {
      var o = findOrder(orderNum);
      if (o && Array.isArray(o.items)) {
        var it = o.items.find(function (i) { return String(i.sku) === String(sku); });
        if (it) { it.printType = val; it.tech = val; if (EGStore.update) EGStore.update(o.id, { items: o.items }); }
      }
    } catch (e) {}
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
      + actBtn('Templates', "EGDesignTools.templates('" + jsAttr(num) + "','" + jsAttr(sku) + "','" + jsAttr(name) + "')")
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
    return '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:10px 16px 4px 28px" onclick="event.stopPropagation()">'
      + '<span style="font-size:11.5px;color:#9ca3af">Pick a blank + print method per item, then</span>'
      + '<button class="btn btn-dk" style="font-size:12px;padding:6px 16px" onclick="EGDesignTools.pushToProduction(\'' + jsAttr(num) + '\')">Push to production →</button></div>';
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

  window.EGDesignTools = {
    upload: upload, templates: templates, designMaker: designMaker, designLab: designLab, openSellerPage: openSellerPage,
    // new-order setup
    itemActions: itemActions, pushButton: pushButton, pushToProduction: pushToProduction,
    onSetProduct: onSetProduct, onSetPrint: onSetPrint, isNewOrder: isNewOrder, getItemSetup: getItemSetup,
    PRINT_METHODS: PRINT_METHODS
  };
})();
