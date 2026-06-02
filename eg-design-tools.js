/* eg-design-tools.js — shared design actions for the factory boards' order-detail
   modal: Upload (reuses EGStore.openDesignUpload), Templates (pick a base product),
   Design Maker (opens design-maker.html in an overlay with order+sku context).
   Loaded by admin/operator/warehouse. Designs are stored on the order+sku via
   EGStore so they flow into the existing pipeline. */
(function () {
  'use strict';
  if (window.EGDesignTools) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) {
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#191918;color:#fff;padding:9px 16px;border-radius:8px;font-size:13.5px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.25)';
      document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200);
    } catch (e) {}
  }
  // Store a chosen image as the design for this order+item so the pipeline picks it up.
  function applyDesign(orderNum, sku, dataUrl) {
    try { if (window.EGStore && EGStore.cacheImage) EGStore.cacheImage(orderNum, sku, dataUrl); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: orderNum, sku: sku } })); } catch (e) {}
  }

  // ── Upload (reuse the shared EGStore flow; basic picker as fallback) ──
  function upload(orderNum, sku, name, tech) {
    if (window.EGStore && EGStore.openDesignUpload) {
      EGStore.openDesignUpload({ orderNum: orderNum, sku: sku, name: name, tech: tech, byRole: 'Staff',
        onDone: function () { document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: orderNum, sku: sku } })); } });
      return;
    }
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,.pdf,.svg';
    inp.onchange = function () { var f = inp.files[0]; if (!f) return; var r = new FileReader(); r.onload = function (e) { applyDesign(orderNum, sku, e.target.result); toast('Uploaded ' + f.name); }; r.readAsDataURL(f); };
    inp.click();
  }

  // ── Templates: pick a base product to apply as the item's design ──
  function templates(orderNum, sku, name) {
    var prods = []; try { prods = (window.EGStore && EGStore.getCatalogProducts && EGStore.getCatalogProducts()) || []; } catch (e) {}
    var cards = prods.length ? prods.map(function (p) {
      var img = p.mockup || p.img || p.thumb || '';
      return '<button data-img="' + esc(img) + '" class="egdt-tpl" style="border:1px solid #e5e4e0;border-radius:10px;padding:8px;background:#fff;cursor:pointer;text-align:left;width:140px">'
        + '<div style="width:100%;height:110px;border-radius:7px;background:#f6f5f4' + (img ? ";background-image:url('" + esc(img) + "');background-size:cover;background-position:center" : '') + '"></div>'
        + '<div style="font-size:12px;font-weight:600;color:#191918;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name || 'Product') + '</div></button>';
    }).join('') : '<div style="color:#9ca3af;font-size:13.5px;padding:20px">No templates yet — add products in the Products section first.</div>';
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(25,25,24,.5);z-index:99990;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:760px;width:100%;max-height:84vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:20px 22px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><div style="font-size:16px;font-weight:700">Templates</div><button id="egdt-x" style="background:none;border:none;font-size:20px;cursor:pointer;color:#9ca3af;line-height:1">&times;</button></div>'
      + '<div style="font-size:13px;color:#6b7280;margin-bottom:16px">Pick a base to apply to ' + esc(name || sku || 'this item') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:10px">' + cards + '</div></div>';
    document.body.appendChild(ov);
    function close() { try { document.body.removeChild(ov); } catch (e) {} }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#egdt-x').addEventListener('click', close);
    ov.querySelectorAll('.egdt-tpl').forEach(function (b) {
      b.addEventListener('click', function () { var img = b.getAttribute('data-img'); if (img) { applyDesign(orderNum, sku, img); toast('Template applied'); } close(); });
    });
  }

  // ── Design Maker: open the editor in an overlay, passing order+sku context ──
  function designMaker(orderNum, sku, name) {
    // Standalone (from the sidebar) → full seller flow incl. publish-to-product.
    // From an order item → carry order+sku context so the design ties to the item.
    var hasCtx = !!(orderNum || sku);
    var src = hasCtx
      ? ('design-maker.html?order=' + encodeURIComponent(orderNum || '') + '&sku=' + encodeURIComponent(sku || '') + '&embed=1')
      : 'design-maker.html';
    var ov = document.createElement('div');
    // Full-screen overlay.
    ov.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:99990;display:flex;flex-direction:column';
    var title = (orderNum || sku) ? ('Design Maker · ' + esc(name || sku || '')) : 'Design Maker';
    ov.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 16px;border-bottom:1px solid #e5e4e0;flex-shrink:0;background:#fdfcfa"><div style="font-size:14px;font-weight:700;color:#191918">' + title + '</div><button id="egdt-dm-x" title="Close" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;line-height:1;padding:0 4px">&times;</button></div>'
      + '<iframe src="' + esc(src) + '" style="flex:1;border:0;width:100%"></iframe>';
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    function close() { try { document.body.removeChild(ov); } catch (e) {} document.body.style.overflow = ''; document.dispatchEvent(new CustomEvent('eg-design-updated', { detail: { orderNum: orderNum, sku: sku } })); }
    ov.querySelector('#egdt-dm-x').addEventListener('click', close);
    document.addEventListener('keydown', function esc2(ev) { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); } });
  }

  window.EGDesignTools = { upload: upload, templates: templates, designMaker: designMaker, applyDesign: applyDesign };
})();
