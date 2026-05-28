/* ============================================================================
   eg-new-order.js — Shared "Create New Order" modal
   ----------------------------------------------------------------------------
   Single source of truth for the detailed Create New Order modal that lives in
   orders.html. Drop this on any seller page (after egfulfill-store.js) to get
   an identical modal + behaviour without copy-pasting markup/JS into each file.

   Usage:
     <script src="egfulfill-store.js"></script>   (optional, for catalog + persistence)
     <script src="eg-new-order.js"></script>

   The modal opens via openNewOrderModal(). The shared header "+ New → Manual
   order" item already calls goManualOrder(), which calls openNewOrderModal()
   when it exists — so simply including this script wires it up.

   Pages that already define their own openNewOrderModal + #new-order-modal
   (e.g. orders.html, the factory print-queue tools) should NOT load this file;
   it bails out if a #new-order-modal already exists in the DOM.
   ========================================================================== */
(function () {
  if (window.__egNewOrderLoaded) return;
  window.__egNewOrderLoaded = true;

  /* ── Blank-product catalog (mirrors orders.html, pulls from EGStore) ────── */
  var BLANK_CATALOG = [];
  // A small built-in catalog so the Items selectors are never empty on pages
  // that have no EGStore catalog data yet.
  var FALLBACK_CATALOG = [
    { id: 'fb-hoodie', name: 'Classic Unisex Hoodie · Gildan 18500', skuBase: 'GLD18500',
      printTypes: ['DTG', 'EMB'], colors: ['Black', 'Navy', 'White', 'Sport Grey'],
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      colorCodes: { Black: 'BLK', Navy: 'NVY', White: 'WHT', 'Sport Grey': 'GRY' } },
    { id: 'fb-tee', name: 'Unisex Tee · Bella+Canvas 3001', skuBase: 'BC3001',
      printTypes: ['DTG', 'SCR'], colors: ['White', 'Black', 'Heather', 'Red'],
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      colorCodes: { White: 'WHT', Black: 'BLK', Heather: 'HTH', Red: 'RED' } },
    { id: 'fb-tote', name: 'Everyday Canvas Tote — Natural', skuBase: 'TOTE',
      printTypes: ['SCR', 'DTG'], colors: ['Natural', 'Black'],
      sizes: ['One Size'], colorCodes: { Natural: 'NAT', Black: 'BLK' } },
    { id: 'fb-mug', name: 'Ceramic Mug 11oz White', skuBase: 'MUG',
      printTypes: ['SUB'], colors: ['White'],
      sizes: ['11oz', '15oz'], colorCodes: { White: 'WHT' } }
  ];
  function _mapCatProd(p) {
    var variants = Array.isArray(p.variants) ? p.variants : (Array.isArray(p.variantSkus) ? p.variantSkus : []);
    var colors = (Array.isArray(p.colors) && p.colors.length) ? p.colors
               : Array.from(new Set(variants.map(function (v) { return v && (v.color || v.colour); }).filter(Boolean)));
    var sizes  = (Array.isArray(p.sizes) && p.sizes.length) ? p.sizes
               : Array.from(new Set(variants.map(function (v) { return v && v.size; }).filter(Boolean)));
    if (!colors.length) colors = ['Default'];
    if (!sizes.length)  sizes  = ['One Size'];
    var printTypes = (Array.isArray(p.printTypes) && p.printTypes.length) ? p.printTypes
               : (p.method ? [String(p.method).toUpperCase()] : (p.type ? [String(p.type).toUpperCase()] : ['DTG']));
    var colorCodes = Object.assign({}, p.colorCodes);
    colors.forEach(function (c) { if (!colorCodes[c]) colorCodes[c] = String(c).replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() || 'CLR'; });
    return { id: p.id, name: p.name, skuBase: p.sku || p.skuBase || ('SKU-' + p.id), printTypes: printTypes, colors: colors, sizes: sizes, colorCodes: colorCodes };
  }
  function syncBlankCatalog() {
    try {
      BLANK_CATALOG = (typeof EGStore !== 'undefined' && EGStore.getCatalogProducts)
        ? EGStore.getCatalogProducts().filter(function (p) { return (p.status || 'Active') === 'Active'; }).map(_mapCatProd)
        : [];
    } catch (e) { BLANK_CATALOG = []; }
    if (!BLANK_CATALOG.length) BLANK_CATALOG = FALLBACK_CATALOG.slice();
  }
  syncBlankCatalog();
  window.addEventListener('storage', function (e) {
    if (!e || e.key === null || /catalog|product/i.test(e.key || '')) syncBlankCatalog();
  });

  /* ── Modal markup (identical to orders.html #new-order-modal) ───────────── */
  var MODAL_HTML = '' +
'<div id="new-order-modal" style="display:none;position:fixed;inset:0;z-index:300;align-items:center;justify-content:center;padding:24px">' +
'  <div onclick="closeNewOrderModal()" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:-1"></div>' +
'  <div id="new-order-card" style="background:#fff;border-radius:16px;width:700px;max-width:calc(100vw - 48px);max-height:90vh;box-shadow:0 24px 64px rgba(0,0,0,.22);animation:fadeUp .25s cubic-bezier(.22,1,.36,1);display:flex;flex-direction:column;overflow:hidden">' +
'    <div style="padding:16px 22px;border-bottom:1px solid #f3f3f1;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
'      <div>' +
'        <div style="font-size:16px;font-weight:700;color:#191918">Create New Order</div>' +
'        <div style="font-size:13px;color:#9ca3af;margin-top:1px">Fill in shipping + items — push to production when ready</div>' +
'      </div>' +
'      <button onclick="closeNewOrderModal()" style="background:none;border:none;cursor:pointer;color:#9ca3af;padding:5px;border-radius:7px;display:flex;align-items:center" onmouseover="this.style.background=\'#f6f5f4\'" onmouseout="this.style.background=\'\'">' +
'        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
'      </button>' +
'    </div>' +
'    <div style="overflow-y:auto;flex:1;padding:18px 22px;display:flex;flex-direction:column;gap:20px">' +
'      <div>' +
'        <div style="font-size:12px;font-weight:700;color:#b0aaa4;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Order Info</div>' +
'        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
'          <div style="display:flex;flex-direction:column;gap:4px">' +
'            <label style="font-size:12px;color:#6b7280;font-weight:600">Sales Channel</label>' +
'            <select id="no-channel" onchange="noSyncChannel()" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;background:#fff;box-sizing:border-box;width:100%" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'">' +
'              <option value="Shopify">Shopify</option><option value="WooCommerce">WooCommerce</option><option value="Etsy">Etsy</option><option value="Amazon">Amazon</option><option value="Manual">Manual</option>' +
'            </select>' +
'          </div>' +
'          <div style="display:flex;flex-direction:column;gap:4px">' +
'            <label style="font-size:12px;color:#6b7280;font-weight:600">Store</label>' +
'            <select id="no-store" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;background:#fff;box-sizing:border-box;width:100%" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'">' +
'              <option value="Main Store">Main Store</option>' +
'            </select>' +
'          </div>' +
'          <div style="display:flex;flex-direction:column;gap:4px">' +
'            <label style="font-size:12px;color:#6b7280;font-weight:600">Shipping Service</label>' +
'            <select id="no-shipping" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;background:#fff;box-sizing:border-box;width:100%" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'">' +
'              <option value="USPS Priority Mail">USPS Priority Mail</option><option value="USPS First Class">USPS First Class</option><option value="UPS Ground">UPS Ground</option><option value="UPS 2nd Day Air">UPS 2nd Day Air</option><option value="FedEx Ground">FedEx Ground</option>' +
'            </select>' +
'          </div>' +
'        </div>' +
'      </div>' +
'      <div>' +
'        <div style="font-size:12px;font-weight:700;color:#b0aaa4;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Recipient Address</div>' +
'        <div style="margin-bottom:12px">' +
'          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px">' +
'            <label style="font-size:12px;font-weight:600;color:#6b7280">Paste full address <span style="color:#d1ceca;font-weight:400">— auto-fills fields below</span></label>' +
'            <button type="button" onclick="noParsePastedAddr(document.getElementById(\'no-paste\').value)" style="font-size:11.5px;font-weight:600;color:#191918;background:none;border:none;cursor:pointer;font-family:inherit;padding:0">↻ Auto-fill</button>' +
'          </div>' +
'          <textarea id="no-paste" rows="3" placeholder="Daniel Park&#10;1243 Valley View Ave&#10;Santa Fe Springs, CA 90670" oninput="noParsePastedAddr(this.value)" onpaste="setTimeout(function(){noParsePastedAddr(document.getElementById(\'no-paste\').value)},0)" onchange="noParsePastedAddr(this.value)" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:8px 10px;font-size:13.5px;font-family:inherit;outline:none;color:#191918;box-sizing:border-box;width:100%;resize:none;line-height:1.6" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'"></textarea>' +
'        </div>' +
'        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
'          <div><label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">First Name</label><input id="no-fname" placeholder="Daniel" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;box-sizing:border-box;width:100%" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'"/></div>' +
'          <div><label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Last Name</label><input id="no-lname" placeholder="Park" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;box-sizing:border-box;width:100%" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'"/></div>' +
'        </div>' +
'        <div style="margin-bottom:10px"><label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Street Address</label><input id="no-street" placeholder="1243 Valley View Ave" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;box-sizing:border-box;width:100%" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'"/></div>' +
'        <div style="margin-bottom:10px"><label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Apt / Suite <span style="color:#d1ceca;font-weight:400">optional</span></label><input id="no-apt" placeholder="Apt 4B" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;box-sizing:border-box;width:100%" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'"/></div>' +
'        <div style="display:grid;grid-template-columns:1fr 80px 120px;gap:10px">' +
'          <div><label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">City</label><input id="no-city" placeholder="Santa Fe Springs" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;box-sizing:border-box;width:100%" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'"/></div>' +
'          <div><label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">State</label><input id="no-state" placeholder="CA" maxlength="2" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;box-sizing:border-box;width:100%;text-transform:uppercase" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'"/></div>' +
'          <div><label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">ZIP Code</label><input id="no-zip" placeholder="90670" maxlength="10" style="border:1.5px solid #e5e4e0;border-radius:8px;padding:7px 10px;font-size:14px;font-family:inherit;outline:none;color:#191918;box-sizing:border-box;width:100%" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'"/></div>' +
'        </div>' +
'      </div>' +
'      <div>' +
'        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
'          <div style="font-size:12px;font-weight:700;color:#b0aaa4;text-transform:uppercase;letter-spacing:.06em">Items</div>' +
'          <button onclick="noAddItem()" style="font-size:12px;font-weight:600;color:#111827;background:#f4f2ef;border:1px solid #e5e4e0;border-radius:6px;padding:4px 10px;cursor:pointer;display:flex;align-items:center;gap:4px" onmouseover="this.style.background=\'#ece9e4\'" onmouseout="this.style.background=\'#f4f2ef\'">' +
'            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Add Item' +
'          </button>' +
'        </div>' +
'        <div id="no-items-list" style="display:flex;flex-direction:column;gap:10px"></div>' +
'      </div>' +
'    </div>' +
'    <div style="padding:14px 22px;border-top:1px solid #f3f3f1;background:#fafaf9;display:flex;align-items:center;gap:10px;flex-shrink:0">' +
'      <button onclick="closeNewOrderModal()" style="padding:9px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;background:#fff;border:1.5px solid #e5e4e0;color:#374151;transition:border-color .15s" onmouseover="this.style.borderColor=\'#9ca3af\'" onmouseout="this.style.borderColor=\'#e5e4e0\'">Cancel</button>' +
'      <div style="flex:1"></div>' +
'      <button onclick="saveNewOrderDraft()" style="padding:9px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;background:#fff;border:1.5px solid #e5e4e0;color:#374151;transition:border-color .15s" onmouseover="this.style.borderColor=\'#9ca3af\'" onmouseout="this.style.borderColor=\'#e5e4e0\'">Save as Draft</button>' +
'      <button onclick="submitNewOrder()" style="padding:9px 20px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;background:#111827;color:#fff;border:none;display:flex;align-items:center;gap:7px;transition:opacity .15s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">' +
'        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>Create order' +
'      </button>' +
'    </div>' +
'  </div>' +
'</div>';

  function injectModal() {
    if (document.getElementById('new-order-modal')) return; // page already supplies one
    var holder = document.createElement('div');
    holder.innerHTML = MODAL_HTML;
    document.body.appendChild(holder.firstChild);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectModal);
  } else {
    injectModal();
  }

  /* ── Behaviour (mirrors orders.html, with guarded page deps) ────────────── */
  function openNewOrderModal() {
    injectModal();
    var card = document.getElementById('new-order-card');
    if (card) card.classList.remove('modal-fade-out');
    var modal = document.getElementById('new-order-modal');
    if (modal) modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    var list = document.getElementById('no-items-list');
    if (list && !list.children.length) noAddItem();
    ['no-fname', 'no-lname', 'no-street', 'no-city', 'no-state', 'no-zip'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.style.borderColor = '#e5e4e0';
    });
    noSyncChannel();
  }
  function closeNewOrderModal() {
    var card = document.getElementById('new-order-card');
    if (card) card.classList.add('modal-fade-out');
    setTimeout(function () {
      var modal = document.getElementById('new-order-modal');
      if (modal) modal.style.display = 'none';
      if (card) card.classList.remove('modal-fade-out');
      document.body.style.overflow = '';
    }, 420);
  }
  function noSyncChannel() {
    var sel = document.getElementById('no-store');
    var chEl = document.getElementById('no-channel');
    if (!sel || !chEl) return;
    var map = { Shopify: 'Main Store', WooCommerce: 'EU Store', Etsy: 'Etsy Store', Amazon: 'Amazon US', Manual: 'Default Store' };
    sel.innerHTML = '<option>' + (map[chEl.value] || 'Main Store') + '</option>';
  }
  function noAddItem() {
    syncBlankCatalog();
    var NO_SL = 'border:1.5px solid #e5e4e0;border-radius:7px;padding:6px 8px;font-size:13px;font-family:inherit;outline:none;color:#374151;background:#fff;box-sizing:border-box;width:100%';
    var NO_IN = 'border:1.5px solid #e5e4e0;border-radius:7px;padding:6px 9px;font-size:13px;font-family:inherit;outline:none;color:#374151;background:#fff;box-sizing:border-box;width:100%';
    var pid = 'noi-' + Date.now();
    var popts = BLANK_CATALOG.map(function (p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
    var html = '<div class="no-item-row" id="' + pid + '" style="border:1.5px solid #e5e4e0;border-radius:9px;padding:11px 13px;background:#fafaf9">' +
      '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 56px;gap:7px;margin-bottom:7px">' +
        '<div><label style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px">Base Product</label>' +
        '<select onchange="noSyncProduct(this)" style="' + NO_SL + '"><option value="">Select product…</option>' + popts + '</select></div>' +
        '<div><label style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px">Color</label>' +
        '<select onchange="noUpdateSku(this.closest(\'.no-item-row\'))" style="' + NO_SL + ';color:#d1d5db" disabled><option>—</option></select></div>' +
        '<div><label style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px">Size</label>' +
        '<select onchange="noUpdateSku(this.closest(\'.no-item-row\'))" style="' + NO_SL + ';color:#d1d5db" disabled><option>—</option></select></div>' +
        '<div><label style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px">Qty</label>' +
        '<input type="number" min="1" value="1" style="' + NO_IN + ';text-align:center"/></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:7px">' +
        '<div style="flex-shrink:0"><label style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px">Print Type</label>' +
        '<select style="' + NO_SL + ';color:#d1d5db;width:auto;min-width:90px" disabled><option>—</option></select></div>' +
        '<div style="flex:1"><label style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px">Auto SKU</label>' +
        '<div class="no-sku" style="font-family:monospace;font-size:12.5px;color:#9ca3af;padding:5px 9px;background:#f0ede9;border-radius:6px;border:1.5px solid #f0ede9;line-height:1.5">—</div></div>' +
        '<div style="flex-shrink:0;padding-top:17px"><button onclick="this.closest(\'.no-item-row\').remove()" style="background:none;border:none;cursor:pointer;color:#d1d5db;padding:4px;border-radius:5px;display:flex;align-items:center;transition:color .12s" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#d1d5db\'">' +
        '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>' +
      '</div>' +
    '</div>';
    document.getElementById('no-items-list').insertAdjacentHTML('beforeend', html);
  }
  function noSyncProduct(sel) {
    var row = sel.closest('.no-item-row');
    var sels = row.querySelectorAll('select');
    var colorSel = sels[1], sizeSel = sels[2], printSel = sels[3];
    var p = BLANK_CATALOG.find(function (x) { return String(x.id) === String(sel.value); });
    if (!p) {
      [colorSel, sizeSel, printSel].forEach(function (s) { s.innerHTML = '<option>—</option>'; s.disabled = true; s.style.color = '#d1d5db'; });
      row.querySelector('.no-sku').textContent = '—'; return;
    }
    colorSel.innerHTML = p.colors.map(function (c) { return '<option>' + c + '</option>'; }).join('');
    colorSel.disabled = false; colorSel.style.color = '#374151';
    sizeSel.innerHTML = p.sizes.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    sizeSel.disabled = false; sizeSel.style.color = '#374151';
    printSel.innerHTML = p.printTypes.map(function (t) { return '<option>' + t + '</option>'; }).join('');
    printSel.disabled = false; printSel.style.color = '#374151';
    noUpdateSku(row);
  }
  function noUpdateSku(row) {
    var sels = row.querySelectorAll('select');
    var p = BLANK_CATALOG.find(function (x) { return String(x.id) === String(sels[0].value); });
    if (!p) return;
    var colorCode = p.colorCodes[sels[1].value] || sels[1].value.substring(0, 3).toUpperCase();
    var sizeCode = sels[2].value.replace(/\s+/g, '').replace(/×/g, 'X').toUpperCase();
    var el = row.querySelector('.no-sku');
    el.textContent = p.skuBase + '-' + colorCode + '-' + sizeCode;
    el.style.color = '#374151'; el.style.background = '#f0fdf4'; el.style.borderColor = '#bbf7d0';
  }
  function saveNewOrderDraft() {
    var f = document.getElementById('no-fname');
    if (f && !f.value.trim()) { f.focus(); f.style.borderColor = '#dc2626'; return; }
    closeNewOrderModal();
  }
  function submitNewOrder() {
    var fEl = document.getElementById('no-fname');
    var fname = fEl ? fEl.value.trim() : '';
    var lname = (document.getElementById('no-lname') || {}).value ? document.getElementById('no-lname').value.trim() : '';
    if (!fname) { if (fEl) { fEl.focus(); fEl.style.borderColor = '#dc2626'; } return; }
    var items = [];
    document.querySelectorAll('#no-items-list .no-item-row').forEach(function (row) {
      var sels = row.querySelectorAll('select');
      var productId = sels[0] ? sels[0].value : '';
      var color = sels[1] ? sels[1].value : '';
      var size  = sels[2] ? sels[2].value : '';
      var tech  = sels[3] ? sels[3].value : '';
      var qtyEl = row.querySelector('input[type=number]');
      var qty   = parseInt(qtyEl ? qtyEl.value : '1', 10) || 1;
      var skuEl = row.querySelector('.no-sku');
      var sku   = (skuEl ? skuEl.textContent : '').trim();
      if (!productId || !sku || sku === '—') return;
      var product = BLANK_CATALOG.find(function (p) { return String(p.id) === String(productId); });
      items.push({
        img: 'https://placehold.co/80x80/f0ede9/9ca3af?text=' + encodeURIComponent(((product && product.skuBase) || '?').substring(0, 3)),
        listing: ((product && product.name) || 'Manual Item') + (color || size ? ' — ' + [color, size].filter(Boolean).join(' / ') : ''),
        name: (product && product.name) || 'Manual Item',
        sku: sku, tech: tech, qty: qty
      });
    });
    if (!items.length) { alert('Please add at least one item with a product, color, and size selected.'); return; }
    var ship = (document.getElementById('no-shipping') || {}).value || '';
    var del = /express|2nd day/i.test(ship) ? 'Express' : (/priority mail/i.test(ship) ? 'Priority' : 'Standard');
    var channel = (document.getElementById('no-channel') || {}).value || 'Manual';
    var store = (document.getElementById('no-store') || {}).value || 'Main Store';
    var platPfx = ({ Shopify: 'SP', Etsy: 'ET', WooCommerce: 'WC', Amazon: 'AM', Manual: 'MA' })[channel] || 'MA';
    var today = new Date();
    var fmtDate = (today.getMonth() + 1) + '/' + today.getDate() + '/' + today.getFullYear();
    var customer = (fname + ' ' + lname).trim();
    var shipTo = {
      street: (document.getElementById('no-street') || {}).value || '',
      apt:    (document.getElementById('no-apt') || {}).value || '',
      city:   (document.getElementById('no-city') || {}).value || '',
      state:  ((document.getElementById('no-state') || {}).value || '').toUpperCase(),
      zip:    (document.getElementById('no-zip') || {}).value || ''
    };

    // If this page has an in-memory ORDERS table, push + re-render it too.
    var nextNo = (typeof ORDERS !== 'undefined' && ORDERS.length)
      ? ORDERS.reduce(function (m, o) { return Math.max(m, o.no); }, 0) + 1
      : Math.floor(Date.now() / 1000) % 100000;
    var ord = {
      no: nextNo, id: 'FF-' + (7000 + nextNo),
      platId: platPfx + '-' + Math.floor(10000 + Math.random() * 90000),
      cust: customer, del: del, status: 'new', src: channel, store: store,
      total: items.reduce(function (s, i) { return s + i.qty * 15; }, 0),
      profit: 0, created: fmtDate, time: today.toISOString(), est: '', track: null,
      itemsList: items, _live: true, shipTo: shipTo
    };
    if (typeof ORDERS !== 'undefined' && typeof ORDERS.unshift === 'function') {
      ORDERS.unshift(ord);
      if (typeof renderOrders === 'function') renderOrders();
    }

    // Persist as a DRAFT via the shared store so it survives navigation and
    // shows up in orders.html — without releasing it to the factory yet.
    if (typeof EGStore !== 'undefined' && EGStore.submitOrder) {
      try {
        EGStore.submitOrder({
          id: ord.id, seller: store, factoryStatus: 'draft',
          customer: { name: customer, email: '', shipTo: shipTo },
          items: items.map(function (i) { return { sku: i.sku, name: i.name, qty: i.qty, tech: i.tech, img: i.img, listing: i.listing }; })
        });
      } catch (e) {}
    }
    closeNewOrderModal();
    // Light confirmation on pages with no orders table to re-render into.
    if (typeof renderOrders !== 'function') {
      try {
        var toast = document.createElement('div');
        toast.textContent = 'Order ' + ord.id + ' saved as draft → view in Orders';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:11px 18px;border-radius:10px;font-size:13.5px;font-family:inherit;font-weight:600;z-index:9999;box-shadow:0 8px 28px rgba(0,0,0,.25);animation:fadeUp .2s';
        document.body.appendChild(toast);
        setTimeout(function () { toast.style.transition = 'opacity .3s'; toast.style.opacity = '0'; setTimeout(function () { toast.remove(); }, 320); }, 2600);
      } catch (e) {}
    }
  }
  function noParsePastedAddr(raw) {
    if (!raw || !raw.trim()) return;
    var lines = raw.replace(/\r\n?/g, '\n').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var COUNTRY_RE = /^(usa|u\.?\s?s\.?\s?a\.?|us|united\s+states(\s+of\s+america)?|canada|uk|united\s+kingdom)$/i;
    while (lines.length > 0 && COUNTRY_RE.test(lines[lines.length - 1])) lines.pop();
    var parseCSZ = function (str) {
      var m = str.match(/^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
      return m ? { city: m[1].trim(), state: m[2].toUpperCase(), zip: m[3] } : null;
    };
    var name = '', street = '', city = '', state = '', zip = '';
    var cszIdx = -1, csz = null;
    for (var i = lines.length - 1; i >= 0; i--) { var c = parseCSZ(lines[i]); if (c) { cszIdx = i; csz = c; break; } }
    if (csz) {
      city = csz.city; state = csz.state; zip = csz.zip;
      if (cszIdx >= 2) { name = lines[0]; street = lines[cszIdx - 1]; }
      else if (cszIdx === 1) { if (/^\d/.test(lines[0])) street = lines[0]; else name = lines[0]; }
    } else if (lines.length === 1) {
      var parts = lines[0].split(',').map(function (s) { return s.trim(); });
      if (parts.length >= 3) {
        var c2 = parseCSZ(parts[parts.length - 2] + ', ' + parts[parts.length - 1]);
        if (c2) {
          city = c2.city; state = c2.state; zip = c2.zip;
          if (parts.length >= 3 && !/^\d/.test(parts[0])) { name = parts[0]; street = parts[1]; } else { street = parts[0]; }
        }
      }
    }
    var np = name.trim().split(/\s+/).filter(Boolean);
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
    set('no-fname', np[0] || '');
    set('no-lname', np.slice(1).join(' ') || '');
    var am = street.match(/^(.+?),?\s+(apt|suite|ste|unit|#)\s*(.+)$/i);
    if (am) { set('no-street', am[1].trim()); set('no-apt', am[2] + ' ' + am[3]); }
    else { set('no-street', street); set('no-apt', ''); }
    set('no-city', city); set('no-state', state); set('no-zip', zip);
  }

  /* ── Export (don't clobber a page that already defines its own) ─────────── */
  function expose(name, fn) { if (typeof window[name] !== 'function') window[name] = fn; }
  expose('openNewOrderModal', openNewOrderModal);
  expose('closeNewOrderModal', closeNewOrderModal);
  expose('noSyncChannel', noSyncChannel);
  expose('noAddItem', noAddItem);
  expose('noSyncProduct', noSyncProduct);
  expose('noUpdateSku', noUpdateSku);
  expose('saveNewOrderDraft', saveNewOrderDraft);
  expose('submitNewOrder', submitNewOrder);
  expose('noParsePastedAddr', noParsePastedAddr);
  expose('syncBlankCatalog', syncBlankCatalog);
  // goManualOrder is what the shared "+ New" menu calls; ensure it opens the modal.
  if (typeof window.goManualOrder !== 'function') {
    window.goManualOrder = function () { if (typeof closeNewMenu === 'function') closeNewMenu(); openNewOrderModal(); };
  }
})();
