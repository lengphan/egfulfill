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

  // Full-screen overlay hosting one of the seller's real pages in an iframe.
  function openSellerPage(src, title) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:99990;display:flex;flex-direction:column';
    ov.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 16px;border-bottom:1px solid #e5e4e0;flex-shrink:0;background:#fdfcfa"><div style="font-size:14px;font-weight:700;color:#191918">' + esc(title) + '</div><button id="egdt-x" title="Close" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;line-height:1;padding:0 4px">&times;</button></div>'
      + '<iframe src="' + esc(src) + '" style="flex:1;border:0;width:100%"></iframe>';
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    function close() {
      try { document.body.removeChild(ov); } catch (e) {}
      document.body.style.overflow = '';
      document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: {} }));
    }
    ov.querySelector('#egdt-x').addEventListener('click', close);
    document.addEventListener('keydown', function k(ev) { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
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
  function designLab() { openSellerPage('design-lab.html', 'Design Lab'); }

  window.EGDesignTools = { upload: upload, templates: templates, designMaker: designMaker, designLab: designLab, openSellerPage: openSellerPage };
})();
