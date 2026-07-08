/* ──────────────────────────────────────────────────────────────────────────
   eg-products.js — shared Products section + Add Product modal logic.

   Single source of truth used by operator.html, admin.html and warehouse.html
   so all three boards have the SAME create-product experience (rich multi-tab
   modal: details, sizes & pricing, variants, images, print-area, description).

   Reads/writes the shared catalog via EGStore.setCatalogProducts /
   getCatalogProducts, so a product created on any board shows up for the seller
   and on every other board.

   Operator-only helpers (opPushToast, addShiftEvent, renderInventory,
   INVENTORY_ITEMS) are all called behind `typeof === 'function'/'undefined'`
   guards, so this file is safe to load on pages that don't define them.

   Requires: egfulfill-store.js loaded first. Expects the page to contain the
   #section-products markup + #new-product-modal markup (copied from the shared
   HTML block) and the .npm-* CSS.
   ────────────────────────────────────────────────────────────────────────── */

// CSV template button stub — kept here so the shared section's "↓ CSV Template"
// button never throws (operator referenced this without defining it).
if (typeof window.downloadProductCSVTemplate !== 'function') {
  window.downloadProductCSVTemplate = function(){
    try {
      var rows = 'name,sku,type,base_price,shipping_fee,colors,sizes,methods,status\n'
               + 'Gildan Unisex Tee,G5000,Apparel,15.00,4.99,"Black,White,Navy","S,M,L,XL","DTG,Embroidery",Active\n';
      var blob = new Blob([rows], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'egfulfill-product-template.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
    } catch(e) {}
  };
}

// ======== PRODUCTS ========
// Cleared for end-to-end testing — operator starts with an empty catalog so the seller's
// import / manual-order flow can be exercised against products the user creates by hand.
const OP_PRODUCTS = [];

function renderOpProducts() {
  const grid = document.getElementById('op-prod-grid'); if (!grid) return;
  const q = (document.getElementById('op-prod-search')?.value || '').toLowerCase();
  const cat = document.getElementById('op-prod-cat')?.value || '';
  const status = document.getElementById('op-prod-status')?.value || '';
  const filtered = OP_PRODUCTS.filter(p => {
    if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
    if (cat && p.type !== cat) return false;
    if (status && p.status !== status) return false;
    return true;
  });
  // "Add New Product" tile lives at the FRONT of the grid so newly-saved
  // products land immediately to its right instead of crowding the left edge.
  let html = `<div class="card" onclick="openNewProductModal()" style="overflow:hidden;cursor:pointer;border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:104px;gap:6px;transition:border-color .15s" onmouseover="this.style.borderColor='#111827'" onmouseout="this.style.borderColor='#e5e4e0'">
    <div style="width:44px;height:44px;background:#f6f5f4;border-radius:12px;display:flex;align-items:center;justify-content:center">
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 5l3-3 3 3" stroke="#6b7280" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12h12" stroke="#6b7280" stroke-width="1.4" stroke-linecap="round"/></svg>
    </div>
    <span style="font-size:14px;font-weight:600;color:#374151">Add New Product</span>
    <span style="font-size:12.5px;color:#9ca3af">Mockup + print specs</span>
  </div>`;
  html += filtered.map(p => `
    <div class="card" style="overflow:hidden;cursor:pointer;transition:border-color .15s;position:relative;display:flex;align-items:stretch;min-height:104px" onclick="openProductCard(${p.id})" onmouseover="this.style.borderColor='#9ca3af'" onmouseout="this.style.borderColor='#e5e4e0'">
      <button type="button" title="Duplicate product" onclick="event.stopPropagation();opCloneProduct(${p.id})" style="position:absolute;top:8px;right:8px;z-index:2;display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.92);border:1px solid #e5e4e0;border-radius:7px;padding:4px 8px;font-size:11.5px;font-weight:600;color:#374151;cursor:pointer;font-family:inherit;backdrop-filter:blur(3px);transition:border-color .15s,color .15s" onmouseover="this.style.borderColor='#9ca3af';this.style.color='#191918'" onmouseout="this.style.borderColor='#e5e4e0';this.style.color='#374151'"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" stroke="currentColor" stroke-width="1.3"/></svg>Copy</button>
      <div style="background:#f0ede9;flex:0 0 104px;width:104px;overflow:hidden;order:2;border-left:1px solid #e5e4e0">
        <img src="${p.img}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.src='https://placehold.co/400x400/f0ede9/6b7280?text=${p.fallback}'"/>
      </div>
      <div style="padding:12px 14px;flex:1;min-width:0;order:1;display:flex;flex-direction:column">
        <div title="Click to rename" onclick="event.stopPropagation();egRenameProductCard(${p.id}, this)" style="font-size:14px;font-weight:600;color:#191918;margin-bottom:2px;cursor:text;border-radius:5px;padding:1px 3px;margin-left:-3px;outline:none;transition:background .15s" onmouseover="this.style.background='#f0ede9'" onmouseout="if(this.contentEditable!=='true')this.style.background='transparent'">${p.name}</div>
        <div style="font-size:12.5px;color:#9ca3af;margin-bottom:8px">${p.variants} · ${(typeof EGStore !== 'undefined' && EGStore.formatMethod) ? EGStore.formatMethod(p.method) : p.method}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto"><span class="badge ${p.status==='Active'?'b-ok':'b-queue'}">${p.status}</span><span style="font-size:13px;font-weight:600;color:#374151">$${p.price.toFixed(2)}</span></div>
      </div>
    </div>`).join('');
  grid.innerHTML = html;
}

// Duplicate a saved product — deep-clones it, names the copy "<name> (copy)",
// drops it right after the original, and re-renders. Open the copy to rename it.
function opCloneProduct(id){
  var src = OP_PRODUCTS.find(function(x){ return x.id === id; });
  if (!src) return;
  var copy = JSON.parse(JSON.stringify(src));
  copy.id = OP_PRODUCTS.reduce(function(m,x){ return Math.max(m, x.id||0); }, 0) + 1;
  copy.name = src.name + ' (copy)';
  if (copy.sku) copy.sku = src.sku + '-COPY';
  if (copy.status) copy.status = 'Draft';
  var idx = OP_PRODUCTS.indexOf(src);
  OP_PRODUCTS.splice(idx + 1, 0, copy);
  renderOpProducts();
  if (typeof opPushToast === 'function') opPushToast(copy.name + ' created — open it to rename');
}
window.opCloneProduct = opCloneProduct;

// Inline click-to-rename on a product card title. Turns the title into an
// editable field; Enter or blur commits (persists to the shared catalog +
// re-renders), Escape cancels. Lives in the shared file so every board gets it.
function egRenameProductCard(id, el){
  if (!el || el.dataset.editing === '1') return;
  var p = OP_PRODUCTS.find(function(x){ return x.id === id; });
  if (!p) return;
  el.dataset.editing = '1';
  var original = p.name;
  el.contentEditable = 'true';
  el.style.background = '#fff';
  el.style.boxShadow = 'inset 0 0 0 1.5px #191918';
  el.focus();
  var range = document.createRange(); range.selectNodeContents(el);
  var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  var done = function(commit){
    if (el.dataset.editing !== '1') return;
    el.dataset.editing = '';
    el.contentEditable = 'false';
    el.style.background = 'transparent';
    el.style.boxShadow = '';
    var nm = (el.textContent || '').trim();
    if (commit && nm && nm !== original) {
      p.name = nm;
      if (typeof opPersistProducts === 'function') opPersistProducts();
      if (typeof renderOpProducts === 'function') renderOpProducts();
    } else {
      el.textContent = original;
    }
  };
  el.onkeydown = function(ev){
    if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
  };
  el.onblur = function(){ done(true); };
}
window.egRenameProductCard = egRenameProductCard;

let opEditProductId = null;
let npmSkuTouched = false;

const NPM_COLOR_OPTIONS = ['Black','White','Navy','Heather Gray','Charcoal','Red','Royal Blue','Forest Green','Maroon','Sand','Pink','Yellow'];
const NPM_SIZE_OPTIONS  = ['XS','S','M','L','XL','2XL','3XL','4XL','One Size','11oz','15oz'];

let _npmDropdown = null;
let _npmDropAnchor = null;

function _npmEnsureDropdown() {
  if (_npmDropdown) return _npmDropdown;
  const el = document.createElement('div');
  el.id = 'npm-suggest-pop';
  el.style.cssText = 'position:absolute;z-index:1000;background:#fff;border:1px solid #e5e4e0;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.10);padding:6px;display:none;max-width:320px;max-height:230px;overflow-y:auto';
  document.body.appendChild(el);
  _npmDropdown = el;
  return el;
}

function npmOpenSuggest(inputEl, kind) {
  const pop = _npmEnsureDropdown();
  _npmDropAnchor = inputEl;
  const opts = (kind === 'color') ? NPM_COLOR_OPTIONS : NPM_SIZE_OPTIONS;
  const q = (inputEl.value || '').trim().toLowerCase();
  const existing = (kind === 'sizes') ? new Set(q.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)) : new Set();
  const filtered = opts.filter(o => !q || kind==='sizes' || o.toLowerCase().includes(q));
  const help = kind === 'sizes' ? 'Click to add · type custom + Enter' : 'Click to set · type custom';
  pop.innerHTML = `
    <div style="font-size:11px;color:#9ca3af;padding:2px 6px 6px;text-transform:uppercase;letter-spacing:.05em">${help}</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;padding:2px">
      ${filtered.map(o => {
        const isSelected = existing.has(o.toLowerCase());
        return `<button type="button" data-val="${o}" style="font-size:12.5px;padding:4px 10px;border-radius:14px;border:1.25px solid ${isSelected?'#111827':'#e5e4e0'};background:${isSelected?'#111827':'#fff'};color:${isSelected?'#fff':'#374151'};cursor:pointer;font-family:inherit">${isSelected?'✓ ':''}${o}</button>`;
      }).join('')}
    </div>`;
  pop.querySelectorAll('button[data-val]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const val = btn.dataset.val;
      if (kind === 'color') {
        inputEl.value = val;
      } else {
        const cur = inputEl.value.split(',').map(s=>s.trim()).filter(Boolean);
        const idx = cur.findIndex(s => s.toLowerCase() === val.toLowerCase());
        if (idx >= 0) cur.splice(idx, 1); else cur.push(val);
        inputEl.value = cur.join(', ');
      }
      setTimeout(() => { npmOpenSuggest(inputEl, kind); inputEl.dispatchEvent(new Event('input')); }, 0);
    });
  });
  const r = inputEl.getBoundingClientRect();
  pop.style.left = (window.scrollX + r.left) + 'px';
  pop.style.top  = (window.scrollY + r.bottom + 4) + 'px';
  pop.style.minWidth = r.width + 'px';
  pop.style.display = 'block';
}

function npmBulkSuggest(inputEl, kind) {
  const pop = _npmEnsureDropdown();
  _npmDropAnchor = inputEl;
  const opts = (kind === 'color') ? NPM_COLOR_OPTIONS : NPM_SIZE_OPTIONS;
  const parts = (inputEl.value || '').split(',');
  const token = parts[parts.length - 1].trim().toLowerCase();
  const chosen = new Set(parts.slice(0, -1).map(s => s.trim().toLowerCase()).filter(Boolean));
  const filtered = opts.filter(o => {
    const lo = o.toLowerCase();
    if (chosen.has(lo)) return false;
    return !token || lo.includes(token);
  });
  if (!filtered.length) { npmCloseSuggest(); return; }
  pop.innerHTML = `
    <div style="font-size:11px;color:#9ca3af;padding:2px 6px 6px;text-transform:uppercase;letter-spacing:.05em">Click to add · separate with commas</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;padding:2px">
      ${filtered.map(o => `<button type="button" data-val="${o}" style="font-size:12.5px;padding:4px 10px;border-radius:14px;border:1.25px solid #e5e4e0;background:#fff;color:#374151;cursor:pointer;font-family:inherit">${o}</button>`).join('')}
    </div>`;
  pop.querySelectorAll('button[data-val]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const arr = inputEl.value.split(',');
      arr[arr.length - 1] = ' ' + btn.dataset.val;
      inputEl.value = arr.join(',').replace(/^\s+/, '') + ', ';
      setTimeout(() => { npmBulkSuggest(inputEl, kind); inputEl.focus(); }, 0);
    });
  });
  const r = inputEl.getBoundingClientRect();
  pop.style.left = (window.scrollX + r.left) + 'px';
  pop.style.top  = (window.scrollY + r.bottom + 4) + 'px';
  pop.style.minWidth = r.width + 'px';
  pop.style.display = 'block';
}

function npmCloseSuggest() {
  if (_npmDropdown) _npmDropdown.style.display = 'none';
  _npmDropAnchor = null;
}

document.addEventListener('mousedown', (e) => {
  if (!_npmDropdown || _npmDropdown.style.display === 'none') return;
  if (_npmDropdown.contains(e.target)) return;
  if (_npmDropAnchor && _npmDropAnchor === e.target) return;
  npmCloseSuggest();
});

function addVariantRow(color, size, stock) {
  const row = document.createElement('div');
  row.className = 'npm-variant-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1.4fr 80px 28px;gap:6px;align-items:center';
  row.innerHTML = `<input class="input npm-v-color" placeholder="Color (e.g. Black)" style="font-size:13px"
      onfocus="npmOpenSuggest(this,'color')" oninput="npmOpenSuggest(this,'color');npmUpdateVariantSKUs();npmRefreshSizeWarnings&&npmRefreshSizeWarnings();npmRefreshColorImageOptions&&npmRefreshColorImageOptions()"/>
    <input class="input npm-v-sizes" placeholder="Size (e.g. M)" style="font-size:13px"
      onfocus="npmOpenSuggest(this,'sizes')" oninput="npmOpenSuggest(this,'sizes');npmUpdateVariantSKUs();npmRefreshSizeWarnings&&npmRefreshSizeWarnings()"/>
    <input class="input npm-v-sku" placeholder="Auto SKU" title="Auto-generated from the product SKU + color + size" readonly style="font-size:13px;font-family:'SF Mono',monospace;background:#f4f2ef;color:#374151;cursor:default"/>
    <input class="input npm-v-stock" placeholder="Stock" type="number" style="font-size:13px" oninput="this.classList.remove('npm-pulse');this.style.borderColor=''"/>
    <button onclick="this.closest('.npm-variant-row').remove();npmUpdateVariantSKUs();npmRenderVariantPage();npmRefreshSizeWarnings&&npmRefreshSizeWarnings()" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:19px;line-height:1;padding:0">×</button>`;
  document.getElementById('npm-variants').appendChild(row);
  if (color != null) row.querySelector('.npm-v-color').value = color;
  if (size != null) row.querySelector('.npm-v-sizes').value = size;
  if (stock != null && stock !== '') row.querySelector('.npm-v-stock').value = stock;
  npmUpdateVariantSKUs();
  npmRenderVariantPage();
  return row;
}

var _npmVarPage = 1;
const NPM_VAR_PER_PAGE = 6;
function npmRenderVariantPage() {
  const rows = [...document.querySelectorAll('#npm-variants .npm-variant-row')];
  const pager = document.getElementById('npm-variants-pager');
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / NPM_VAR_PER_PAGE));
  if (_npmVarPage > pages) _npmVarPage = pages;
  if (_npmVarPage < 1) _npmVarPage = 1;
  const start = (_npmVarPage - 1) * NPM_VAR_PER_PAGE, end = start + NPM_VAR_PER_PAGE;
  rows.forEach((r, i) => { r.style.display = (i >= start && i < end) ? 'grid' : 'none'; });
  if (!pager) return;
  if (pages <= 1) { pager.style.display = 'none'; pager.innerHTML = ''; return; }
  pager.style.display = 'flex';
  let html = '<button type="button" class="npm-pg-btn" ' + (_npmVarPage === 1 ? 'disabled' : '') + ' onclick="npmVarGoto(' + (_npmVarPage - 1) + ')">‹</button>';
  for (let i = 1; i <= pages; i++) html += '<button type="button" class="npm-pg-btn' + (i === _npmVarPage ? ' on' : '') + '" onclick="npmVarGoto(' + i + ')">' + i + '</button>';
  html += '<button type="button" class="npm-pg-btn" ' + (_npmVarPage === pages ? 'disabled' : '') + ' onclick="npmVarGoto(' + (_npmVarPage + 1) + ')">›</button>';
  html += '<span style="margin-left:auto;font-size:11.5px;color:#9ca3af">' + total + ' variants</span>';
  pager.innerHTML = html;
}
function npmVarGoto(n) { _npmVarPage = n; npmRenderVariantPage(); }
function npmAddVariantRowUI() {
  const row = addVariantRow();
  const rows = document.querySelectorAll('#npm-variants .npm-variant-row');
  _npmVarPage = Math.max(1, Math.ceil(rows.length / NPM_VAR_PER_PAGE));
  npmRenderVariantPage();
  const c = row && row.querySelector('.npm-v-color'); if (c) c.focus();
}

function npmBulkGenerate() {
  const split = v => String(v || '').split(/[,/|]/).map(x => x.trim()).filter(Boolean);
  const colors = split(document.getElementById('npm-bulk-colors')?.value);
  const sizes  = split(document.getElementById('npm-bulk-sizes')?.value);
  const stock  = (document.getElementById('npm-bulk-stock')?.value || '').trim();
  if (!colors.length && !sizes.length) {
    if (typeof opPushToast === 'function') opPushToast('Enter at least one color or size to generate');
    return;
  }
  const existing = new Set();
  const rows = [...document.querySelectorAll('#npm-variants .npm-variant-row')];
  rows.forEach(r => {
    const c = (r.querySelector('.npm-v-color')?.value || '').trim();
    const s = (r.querySelector('.npm-v-sizes')?.value || '').trim();
    if (!c && !s) { r.remove(); return; }
    existing.add(c.toLowerCase() + '|' + s.toLowerCase());
  });
  const colorList = colors.length ? colors : [''];
  const sizeList  = sizes.length  ? sizes  : [''];
  let added = 0;
  colorList.forEach(c => sizeList.forEach(s => {
    const key = c.toLowerCase() + '|' + s.toLowerCase();
    if (existing.has(key)) return;
    existing.add(key);
    addVariantRow(c, s, stock);
    added++;
  }));
  ['npm-bulk-colors','npm-bulk-sizes','npm-bulk-stock'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  _npmVarPage = 1;
  npmRenderVariantPage();
  if (typeof npmRefreshSizeWarnings === 'function') npmRefreshSizeWarnings();
  if (added && typeof opPushToast === 'function') opPushToast('Generated ' + added + ' variant' + (added>1?'s':''));
}

const _NPM_COLOR_CODES = {
  black:'BLK', white:'WHT', navy:'NVY', red:'RED', blue:'BLU', green:'GRN',
  gray:'GRY', grey:'GRY', yellow:'YEL', orange:'ORG', purple:'PUR', pink:'PNK',
  brown:'BRN', maroon:'MRN', tan:'TAN', sand:'SND', cream:'CRM', olive:'OLV',
  'heather gray':'HGR', 'heather grey':'HGR', charcoal:'CHA',
  'royal blue':'RYL', 'forest green':'FRG', 'kelly green':'KEL'
};
function _npmAbbrevColor(c) {
  const cleaned = String(c || '').trim().toLowerCase().replace(/[^a-z\s]/g, '');
  if (!cleaned) return '';
  if (_NPM_COLOR_CODES[cleaned]) return _NPM_COLOR_CODES[cleaned];
  const words = cleaned.toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map(w => w[0]).join('').slice(0, 3);
  return words[0].slice(0, 3);
}

function npmBuildVariantSKUs() {
  const base = (document.getElementById('npm-sku')?.value || '').trim().toUpperCase();
  if (!base) return [];
  const rows = document.querySelectorAll('#npm-variants .npm-variant-row');
  const seen = new Set();
  const out = [];
  rows.forEach(r => {
    const color = (r.querySelector('.npm-v-color')?.value || '').trim();
    const sizesRaw = (r.querySelector('.npm-v-sizes')?.value || '').trim();
    const stockRaw = (r.querySelector('.npm-v-stock')?.value || '').trim();
    const stock = stockRaw === '' ? '' : (parseInt(stockRaw, 10) || 0);
    const sizes = sizesRaw ? sizesRaw.split(/[,/|]/).map(x => x.trim()).filter(Boolean) : [];
    const colorAbbr = _npmAbbrevColor(color);
    if (sizes.length) {
      sizes.forEach(s => {
        const sizeAbbr = s.toUpperCase().replace(/\s+/g, '');
        const parts = [base];
        if (colorAbbr) parts.push(colorAbbr);
        parts.push(sizeAbbr);
        const sku = parts.join('-');
        if (!seen.has(sku)) { seen.add(sku); out.push({ sku, color, size: s, stock }); }
      });
    } else if (colorAbbr) {
      const sku = base + '-' + colorAbbr;
      if (!seen.has(sku)) { seen.add(sku); out.push({ sku, color, size: '', stock }); }
    }
  });
  return out;
}

function npmUpdateVariantSKUs() {
  // Keep the Color-images dropdowns in sync with the variant colours in real time.
  if (typeof npmRefreshColorImageOptions === 'function') npmRefreshColorImageOptions();
  const base = (document.getElementById('npm-sku')?.value || '').trim().toUpperCase();
  document.querySelectorAll('#npm-variants .npm-variant-row').forEach(r => {
    const skuEl = r.querySelector('.npm-v-sku');
    if (!skuEl) return;
    const color = (r.querySelector('.npm-v-color')?.value || '').trim();
    const sizesRaw = (r.querySelector('.npm-v-sizes')?.value || '').trim();
    const sizes = sizesRaw ? sizesRaw.split(/[,/|]/).map(x => x.trim()).filter(Boolean) : [];
    const colorAbbr = _npmAbbrevColor(color);
    if (!base) { skuEl.value = ''; skuEl.placeholder = 'Set product SKU first'; skuEl.title = ''; return; }
    skuEl.placeholder = 'Auto SKU';
    let skus = [];
    if (sizes.length) {
      skus = sizes.map(s => [base, colorAbbr, s.toUpperCase().replace(/\s+/g, '')].filter(Boolean).join('-'));
    } else if (colorAbbr) {
      skus = [base + '-' + colorAbbr];
    }
    skuEl.value = skus.join(', ');
    skuEl.title = skus.length ? skus.join('\n') : 'Auto-generated from the product SKU + color + size';
  });
}

function npmCollectVariantsSummary() {
  const rows = document.querySelectorAll('#npm-variants .npm-variant-row');
  const colors = new Set(); let combos = 0;
  rows.forEach(r => {
    const c = (r.querySelector('.npm-v-color')?.value || '').trim();
    const s = (r.querySelector('.npm-v-sizes')?.value || '').trim();
    const sizes = s ? s.split(/[,/|]/).map(x=>x.trim()).filter(Boolean) : [];
    if (c) colors.add(c.toLowerCase());
    if (sizes.length) combos += sizes.length; else if (c) combos += 1;
  });
  if (!combos && !colors.size) return '';
  const parts = [];
  parts.push(combos + ' variant' + (combos===1?'':'s'));
  if (colors.size) parts.push(colors.size + ' color' + (colors.size===1?'':'s'));
  return parts.join(' · ');
}

function npmCollectMethods() {
  const picks = [];
  if (document.getElementById('npm-dtg')?.checked) picks.push('DTG Print');
  if (document.getElementById('npm-dtf')?.checked) picks.push('DTF Print');
  if (document.getElementById('npm-emb')?.checked) picks.push('Embroidery');
  if (document.getElementById('npm-apl')?.checked) picks.push('Appliqué');
  if (document.getElementById('npm-lsr')?.checked) picks.push('Laser');
  return picks.join(' / ') || 'DTG Print';
}

var _npmPriceTiers = [];
// Standard apparel size progression. "+ Add size" walks FORWARD from the
// largest size already in the tiers — so S → M → L → XL → 2XL happens
// automatically. If a row has an unrecognised/custom size, fall back to the
// first unused standard size from the front.
const _NPM_SIZE_ORDER = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
function _npmNextSize(){
  var sizes = _npmPriceTiers.map(function(t){ return String(t.size || '').trim().toUpperCase(); }).filter(Boolean);
  var used = new Set(sizes);
  // Highest standard-list index currently used.
  var highest = -1;
  sizes.forEach(function(s){
    var idx = _NPM_SIZE_ORDER.indexOf(s);
    if (idx > highest) highest = idx;
  });
  // First unused size AFTER the current high-water mark.
  for (var i = highest + 1; i < _NPM_SIZE_ORDER.length; i++) {
    if (!used.has(_NPM_SIZE_ORDER[i])) return _NPM_SIZE_ORDER[i];
  }
  // Past 5XL or all standard sizes used — return empty so the user types
  // whatever custom label they want.
  return '';
}
function npmAddPriceTier(seed){
  if (!seed) {
    var base = _npmPriceTiers[0] || {};
    seed = {
      size:     _npmNextSize(),
      price:    base.price    || '',
      shipping: base.shipping || ''
    };
  }
  _npmPriceTiers.push(seed);
  // Append-only render so rapid clicks don't trigger a full re-paint that
  // shifts the "+ Add size" button under the cursor. Existing rows keep
  // their DOM nodes (and any in-progress edits), only the new row is added.
  // Pin the scroll position too — overflow-anchor inside the scrolling
  // panel was nudging it up by ~one row each click.
  var rowsEl = document.getElementById('npm-price-tier-rows');
  var scrollHost = document.getElementById('npm-right-body');
  var savedScroll = scrollHost ? scrollHost.scrollTop : 0;
  if (!rowsEl) { npmRenderPriceTiers(); if (scrollHost) scrollHost.scrollTop = savedScroll; return; }
  var i = _npmPriceTiers.length - 1;
  var t = seed;
  var sizeEsc  = String(t.size || '').replace(/"/g, '&quot;');
  var priceVal = (t.price === '' || t.price == null) ? '' : t.price;
  var shipVal  = (t.shipping === '' || t.shipping == null) ? '' : t.shipping;
  rowsEl.insertAdjacentHTML('beforeend',
    '<div class="npm-tier-row" data-idx="' + i + '" style="display:grid;grid-template-columns:1fr 110px 110px 24px;gap:6px;align-items:center">' +
      '<input class="input" style="font-size:13px" placeholder="e.g. S" value="' + sizeEsc + '" oninput="_npmPriceTiers[' + i + '].size=this.value;npmSyncBaseFromTiers();npmRefreshSizeWarnings()"/>' +
      '<input class="input" type="number" step="0.01" min="0" style="font-size:13px" placeholder="0.00" value="' + priceVal + '" oninput="_npmPriceTiers[' + i + '].price=this.value;npmSyncBaseFromTiers()"/>' +
      '<input class="input" type="number" step="0.01" min="0" style="font-size:13px" placeholder="0.00" value="' + shipVal + '" oninput="_npmPriceTiers[' + i + '].shipping=this.value;npmSyncBaseFromTiers()"/>' +
      '<button type="button" onclick="npmRemovePriceTier(' + i + ')" title="Remove" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:18px;line-height:1;padding:0">×</button>' +
    '</div>'
  );
  // Re-pin after layout flush — overflow-anchor adjusts on the next frame so
  // a synchronous assignment alone gets overwritten. requestAnimationFrame
  // hits the same frame as the browser's auto-scroll, so we override it.
  if (scrollHost) {
    scrollHost.scrollTop = savedScroll;
    requestAnimationFrame(function(){ scrollHost.scrollTop = savedScroll; });
  }
  npmSyncBaseFromTiers();
  npmRefreshSizeWarnings();
}
function _npmVariantSizes(){
  var set = new Set();
  document.querySelectorAll('#npm-variants .npm-v-sizes').forEach(function(el){
    var v = String(el.value||'').trim().toLowerCase();
    if (v) set.add(v);
  });
  return set;
}
function _npmVariantColors(){
  var seen = new Set(); var out = [];
  document.querySelectorAll('#npm-variants .npm-v-color').forEach(function(el){
    var v = String(el.value||'').trim();
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  });
  return out;
}
function npmRefreshSizeWarnings(){
  // Reverse direction (variant size not priced) runs first and unconditionally,
  // so it still shows even when there are no priced→variant mismatches below.
  npmRefreshVariantWarning();
  var sizes = _npmVariantSizes();
  if (!sizes.size) {
    document.querySelectorAll('#npm-price-tier-rows .npm-tier-warn').forEach(function(w){ w.remove(); });
    return;
  }
  document.querySelectorAll('#npm-price-tier-rows .npm-tier-row').forEach(function(rowEl){
    var i = parseInt(rowEl.dataset.idx, 10);
    var t = _npmPriceTiers[i]; if (!t) return;
    var s = String(t.size||'').trim();
    var warn = rowEl.nextElementSibling && rowEl.nextElementSibling.classList.contains('npm-tier-warn') ? rowEl.nextElementSibling : null;
    var missing = s && !sizes.has(s.toLowerCase());
    if (missing && !warn) {
      var w = document.createElement('div');
      w.className = 'npm-tier-warn';
      w.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fdfcfa;border:1px solid #40403d;border-radius:6px;font-size:11.5px;color:#374151;margin-top:-2px';
      w.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0"><path d="M6 2.5v3.5M6 8.5v.5" stroke="#191918" stroke-width="1.4" stroke-linecap="round"/><circle cx="6" cy="6" r="5" stroke="#191918" stroke-width="1.2"/></svg>'
        + '<span style="flex:1;color:#374151">Size <strong style="color:#191918">'+s+'</strong> isn\'t in your variants yet.</span>'
        + '<button type="button" onclick="npmAddSizeToVariants(\''+s.replace(/'/g,"\\'")+'\')" style="background:#191918;color:#fff;border:none;border-radius:5px;padding:3px 10px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .15s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">Add to variants</button>';
      rowEl.parentNode.insertBefore(w, rowEl.nextSibling);
    } else if (!missing && warn) {
      warn.remove();
    } else if (warn) {
      var strong = warn.querySelector('strong'); if (strong) strong.textContent = s;
      var btn = warn.querySelector('button'); if (btn) btn.setAttribute('onclick', 'npmAddSizeToVariants(\''+s.replace(/'/g,"\\'")+'\')');
    }
  });
}
// Reverse of the pricing-side warning: surface variant sizes that aren't in
// Sizes & Pricing yet, as ONE consolidated inline notice under the variants
// list (matches the ".npm-tier-warn" look). One-click "Add to pricing".
function npmRefreshVariantWarning(){
  var el = document.getElementById('npm-variant-warning');
  if (!el) return;
  var priced = {};
  _npmPriceTiers.forEach(function(t){ var s = String(t.size||'').trim().toLowerCase(); if (s) priced[s] = 1; });
  var missing = [], seen = {};
  document.querySelectorAll('#npm-variants .npm-v-sizes').forEach(function(inp){
    String(inp.value||'').split(/[,/|]/).map(function(x){ return x.trim(); }).filter(Boolean).forEach(function(s){
      var k = s.toLowerCase();
      if (!priced[k] && !seen[k]) { seen[k] = 1; missing.push(s); }
    });
  });
  if (!missing.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  var label = missing.length === 1
    ? 'Size <strong style="color:#191918">' + missing[0] + '</strong> isn\'t priced yet.'
    : 'Sizes <strong style="color:#191918">' + missing.join(', ') + '</strong> aren\'t priced yet.';
  el.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0"><path d="M6 2.5v3.5M6 8.5v.5" stroke="#191918" stroke-width="1.4" stroke-linecap="round"/><circle cx="6" cy="6" r="5" stroke="#191918" stroke-width="1.2"/></svg>'
    + '<span style="flex:1;font-size:11.5px;color:#374151">' + label + '</span>'
    + '<button type="button" onclick="npmAddMissingSizesToPricing()" style="background:#191918;color:#fff;border:none;border-radius:5px;padding:3px 10px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;flex-shrink:0;transition:opacity .15s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">Add to pricing</button>';
}
// Append a priced tier (size, blank price/shipping) for every variant size that
// isn't already in Sizes & Pricing, then re-render the tiers.
function npmAddMissingSizesToPricing(){
  var priced = {};
  _npmPriceTiers.forEach(function(t){ var s = String(t.size||'').trim().toLowerCase(); if (s) priced[s] = 1; });
  var added = {};
  document.querySelectorAll('#npm-variants .npm-v-sizes').forEach(function(inp){
    String(inp.value||'').split(/[,/|]/).map(function(x){ return x.trim(); }).filter(Boolean).forEach(function(s){
      var k = s.toLowerCase();
      if (!priced[k] && !added[k]) { added[k] = 1; _npmPriceTiers.push({ size: s, price: '', shipping: '' }); }
    });
  });
  npmRenderPriceTiers();
}
function npmAddSizeToVariants(size){
  if (!size) return;
  var colors = _npmVariantColors();
  if (!colors.length) {
    addVariantRow('', size, 0);
  } else {
    colors.forEach(function(c){ addVariantRow(c, size, 0); });
  }
  npmRefreshSizeWarnings();
}
function npmRemovePriceTier(i){
  if (_npmPriceTiers.length <= 1) return;
  var removed = _npmPriceTiers[i];
  var removedSize = removed && String(removed.size||'').trim();
  // No popup — when the size has variants, an inline warning row appears
  // above the price tiers offering one-click variant cleanup or dismissal.
  _npmPriceTiers.splice(i, 1);
  if (removedSize) {
    var sizes = _npmVariantSizes();
    if (sizes.has(removedSize.toLowerCase())) {
      if (!_npmGhostSizes.find(function(g){ return g.size.toLowerCase() === removedSize.toLowerCase(); })) {
        _npmGhostSizes.push({ size: removedSize });
      }
    }
  }
  npmRenderPriceTiers();
}
var _npmGhostSizes = [];
function npmDismissGhostSize(size){
  _npmGhostSizes = _npmGhostSizes.filter(function(g){ return g.size.toLowerCase() !== String(size||'').toLowerCase(); });
  npmRenderPriceTiers();
}
function npmRemoveSizeFromVariants(size){
  if (!size) return;
  var target = String(size).toLowerCase();
  var rows = document.querySelectorAll('#npm-variants .npm-variant-row');
  var removed = 0;
  rows.forEach(function(r){
    var sz = (r.querySelector('.npm-v-sizes')?.value || '').trim().toLowerCase();
    if (sz === target) { r.remove(); removed++; }
  });
  if (typeof npmUpdateVariantSKUs === 'function') npmUpdateVariantSKUs();
  if (typeof npmRenderVariantPage === 'function') npmRenderVariantPage();
  npmDismissGhostSize(size);
  if (typeof opPushToast === 'function' && removed) opPushToast('Removed ' + removed + ' variant row' + (removed>1?'s':'') + ' for size ' + size);
}
function npmRenderPriceTiers(){
  var rowsEl = document.getElementById('npm-price-tier-rows');
  if (!rowsEl) return;
  if (!_npmPriceTiers.length) _npmPriceTiers.push({ size:'S', price:'', shipping:'' });
  var liveVariantSizes = _npmVariantSizes();
  _npmGhostSizes = _npmGhostSizes.filter(function(g){ return liveVariantSizes.has(g.size.toLowerCase()); });
  var ghostHtml = _npmGhostSizes.map(function(g){
    var s = g.size.replace(/'/g,"\\'");
    var sEsc = g.size.replace(/"/g,'&quot;');
    return '<div class="npm-tier-ghost" style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fdfcfa;border:1px solid #40403d;border-radius:6px;font-size:11.5px;color:#374151">'
      + '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0"><path d="M6 2.5v3.5M6 8.5v.5" stroke="#191918" stroke-width="1.4" stroke-linecap="round"/><circle cx="6" cy="6" r="5" stroke="#191918" stroke-width="1.2"/></svg>'
      + '<span style="flex:1">Size <strong style="color:#191918">'+sEsc+'</strong> still has variants. Remove them too?</span>'
      + '<button type="button" onclick="npmRemoveSizeFromVariants(\''+s+'\')" style="background:#191918;color:#fff;border:none;border-radius:5px;padding:3px 10px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .15s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">Remove variants</button>'
      + '<button type="button" onclick="npmDismissGhostSize(\''+s+'\')" title="Dismiss" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:16px;line-height:1;padding:0 2px">×</button>'
      + '</div>';
  }).join('');
  rowsEl.innerHTML = ghostHtml + _npmPriceTiers.map(function(t, i){
    var size = String(t.size || '').replace(/"/g,'&quot;');
    var price = (t.price === '' || t.price == null) ? '' : t.price;
    var shipping = (t.shipping === '' || t.shipping == null) ? '' : t.shipping;
    var removeBtn = (i === 0)
      ? '<span></span>'
      : '<button type="button" onclick="npmRemovePriceTier('+i+')" title="Remove" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:18px;line-height:1;padding:0">×</button>';
    return '<div class="npm-tier-row" data-idx="'+i+'" style="display:grid;grid-template-columns:1fr 110px 110px 24px;gap:6px;align-items:center">'
      + '<input class="input" style="font-size:13px" placeholder="e.g. S" value="'+size+'" oninput="_npmPriceTiers['+i+'].size=this.value;npmSyncBaseFromTiers();npmRefreshSizeWarnings()"/>'
      + '<input class="input" type="number" step="0.01" min="0" style="font-size:13px" placeholder="0.00" value="'+price+'" oninput="_npmPriceTiers['+i+'].price=this.value;npmSyncBaseFromTiers()"/>'
      + '<input class="input" type="number" step="0.01" min="0" style="font-size:13px" placeholder="0.00" value="'+shipping+'" oninput="_npmPriceTiers['+i+'].shipping=this.value;npmSyncBaseFromTiers()"/>'
      + removeBtn
      + '</div>';
  }).join('');
  npmSyncBaseFromTiers();
  npmRefreshSizeWarnings();
}
function npmSyncBaseFromTiers(){
  var first = _npmPriceTiers[0] || {};
  var p = document.getElementById('npm-price');
  var s = document.getElementById('npm-ship');
  if (p) p.value = (first.price === '' || first.price == null) ? '' : first.price;
  if (s) s.value = (first.shipping === '' || first.shipping == null) ? '' : first.shipping;
  // Mirror sizes into the Bulk Generate input so the user can hit "Generate"
  // without re-typing them. We don't overwrite if the user has typed sizes
  // there that aren't (yet) in the tiers — they may be staging new entries.
  var bulkSizes = document.getElementById('npm-bulk-sizes');
  if (bulkSizes) {
    var tierSizes = _npmPriceTiers.map(function(t){ return String(t.size || '').trim(); }).filter(Boolean);
    var typed = String(bulkSizes.value || '').split(/[,/|]/).map(function(x){ return x.trim(); }).filter(Boolean);
    // Replace iff (a) bulk input is empty, OR (b) every typed entry is already a tier size — i.e. they
    // haven't introduced anything custom yet. Otherwise leave their staging alone.
    var typedSet = new Set(typed.map(function(s){ return s.toLowerCase(); }));
    var tierSet  = new Set(tierSizes.map(function(s){ return s.toLowerCase(); }));
    var typedIsSubset = typed.every(function(s){ return tierSet.has(s.toLowerCase()); });
    if (!typed.length || typedIsSubset) bulkSizes.value = tierSizes.join(', ');
  }
}
function npmCollectPriceTiers(){
  return _npmPriceTiers
    .map(function(t){
      return {
        size: String(t.size||'').trim(),
        price: parseFloat(t.price) || 0,
        shipping: (t.shipping === '' || t.shipping == null) ? null : (parseFloat(t.shipping) || 0)
      };
    })
    .filter(function(t){ return t.size && t.price > 0; });
}

function npmCollectMethodPrices() {
  const map = {};
  [['npm-dtg','DTG'],['npm-dtf','DTF'],['npm-emb','EMB'],['npm-apl','APL'],['npm-lsr','LSR']].forEach(function(pair){
    const cb = document.getElementById(pair[0]);
    if (!cb || !cb.checked) return;
    const priceEl = document.getElementById(pair[0] + '-price');
    const v = priceEl ? parseFloat(priceEl.value) : NaN;
    if (!isNaN(v) && v > 0) map[pair[1]] = v;
  });
  return map;
}

function openProductCard(id) {
  opEditProductId = id;
  npmSkuTouched = true;
  const p = OP_PRODUCTS.find(x => x.id === id);
  if (!p) { openNewProductModal(); return; }
  document.getElementById('npm-title').textContent = 'Edit Product · ' + p.name;
  // Keep the header title in sync as the user edits the Product Name field, so
  // it's obvious that the name field IS where you rename.
  (function(){
    var nameEl = document.getElementById('npm-name');
    var titleEl = document.getElementById('npm-title');
    if (nameEl && titleEl && !nameEl.__egTitleSync) {
      nameEl.__egTitleSync = true;
      nameEl.addEventListener('input', function(){
        titleEl.textContent = (opEditProductId ? 'Edit Product · ' : 'Add New Product') + (opEditProductId ? (nameEl.value || 'Untitled') : '');
      });
    }
  })();
  document.getElementById('npm-name').value = p.name;
  document.getElementById('npm-sku').value  = p.sku;
  document.getElementById('npm-price').value = p.price;
  const shipEl0 = document.getElementById('npm-ship'); if (shipEl0) shipEl0.value = (p.shippingFee != null ? p.shippingFee : '');
  const addItemEl0 = document.getElementById('npm-add-item-ship'); if (addItemEl0) addItemEl0.value = (p.additionalItemShipping != null ? p.additionalItemShipping : '');
  const catEl = document.getElementById('npm-cat'); if (catEl && p.type) catEl.value = p.type;
  const stEl  = document.getElementById('npm-status'); if (stEl && p.status) stEl.value = p.status;
  document.getElementById('npm-w').value = '';
  document.getElementById('npm-h').value = '';
  document.getElementById('npm-dpi').value = '';
  // Load saved description (preferring p.description, falling back to p.notes
  // for any legacy products written before the rename).
  document.getElementById('npm-notes').value = p.description || p.notes || '';
  ['npm-dtg','npm-dtf','npm-emb','npm-apl','npm-lsr'].forEach(id => { const el=document.getElementById(id); if(el) el.checked = false; });
  ['npm-dtg-price','npm-dtf-price','npm-emb-price','npm-apl-price','npm-lsr-price'].forEach(id => { const el=document.getElementById(id); if(el) el.value = ''; });
  const _mp = p.methodPrices && typeof p.methodPrices === 'object' ? p.methodPrices : null;
  if (_mp) {
    [['DTG','npm-dtg'],['DTF','npm-dtf'],['EMB','npm-emb'],['APL','npm-apl'],['LSR','npm-lsr']].forEach(function(pair){
      if (_mp[pair[0]] != null) {
        const cb = document.getElementById(pair[1]); if (cb) cb.checked = true;
        const priceEl = document.getElementById(pair[1] + '-price'); if (priceEl) priceEl.value = _mp[pair[0]];
      }
    });
  } else if (p.method) {
    const ml = p.method.toLowerCase();
    if (ml.includes('dtg')) { const e=document.getElementById('npm-dtg'); if(e) e.checked=true; }
    if (ml.includes('dtf')) { const e=document.getElementById('npm-dtf'); if(e) e.checked=true; }
    if (ml.includes('emb')) { const e=document.getElementById('npm-emb'); if(e) e.checked=true; }
    if (ml.includes('apl')) { const e=document.getElementById('npm-apl'); if(e) e.checked=true; }
    if (ml.includes('lsr') || ml.includes('laser')) { const e=document.getElementById('npm-lsr'); if(e) e.checked=true; }
  }
  if (Array.isArray(p.sizePrices) && p.sizePrices.length) {
    var expanded = [];
    p.sizePrices.forEach(function(t){
      if (t.size != null) {
        expanded.push({ size: t.size, price: t.price != null ? t.price : '', shipping: t.shipping != null ? t.shipping : (p.shippingFee != null ? p.shippingFee : '') });
      } else if (t.sizes) {
        var basePrice = parseFloat(p.price) || 0;
        var absPrice = (t.upcharge != null) ? (basePrice + parseFloat(t.upcharge)) : (t.price != null ? parseFloat(t.price) : basePrice);
        String(t.sizes).split(/[,\s]+/).map(function(s){return s.trim();}).filter(Boolean).forEach(function(sz){
          expanded.push({ size: sz, price: absPrice || '', shipping: p.shippingFee != null ? p.shippingFee : '' });
        });
      }
    });
    _npmPriceTiers = expanded.length ? expanded : [{ size:'S', price: p.price || '', shipping: p.shippingFee != null ? p.shippingFee : '' }];
  } else {
    _npmPriceTiers = [{ size:'S', price: p.price || '', shipping: p.shippingFee != null ? p.shippingFee : '' }];
  }
  npmRenderPriceTiers();
  document.getElementById('npm-variants').innerHTML = '';
  if (Array.isArray(p.variantSkus) && p.variantSkus.length) {
    p.variantSkus.forEach(v => { if (v) addVariantRow(v.color || '', v.size || '', v.stock != null ? v.stock : ''); });
  } else { addVariantRow(); }
  _npmVarPage = 1; npmRenderVariantPage();
  npmSeedColorImages(p.colorImages, p.mainColor);
  _npmSideMockups = { front: p.mockup || '', back: '', left: '', right: '', sleeve: '' };
  if (p.sideMockups && typeof p.sideMockups === 'object') {
    Object.keys(p.sideMockups).forEach(function(k){ _npmSideMockups[k] = p.sideMockups[k] || _npmSideMockups[k] || ''; });
  }
  _npmSideMockupNames = {};
  _npmSetMockupImage(p.mockup || '', '');
  npmSeedExtras(p.images || []);
  document.getElementById('npm-delete-btn').style.display = '';
  document.getElementById('npm-publish-btn').textContent = 'Save Changes';
  _npmPaAreas = {};
  const saved = p.printAreas || {};
  NPM_PA_SIDES.forEach(s => { _npmPaAreas[s] = saved[s] ? { ...saved[s] } : { ...NPM_PA_DEFAULT }; });
  _npmPaCurrentSide = 'front';
  const paSel = document.getElementById('npm-pa-side'); if (paSel) paSel.value = 'front';
  if (p.dpi) document.getElementById('npm-dpi').value = p.dpi;
  npmPaSetImage(p.mockup || p.img || '');
  npmPaReflectPrice();
  const sideLbl = document.getElementById('npm-pa-side-label'); if (sideLbl) sideLbl.textContent = 'Front';
  npmTab('details');
  document.getElementById('full-order-modal')?.classList.add('modal-hidden');
  document.getElementById('new-product-modal').classList.remove('modal-hidden');
  // Capture clean snapshot so the close handler can detect unsaved edits.
  setTimeout(_npmMarkClean, 0);
}

function openNewProductModal() {
  opEditProductId = null;
  npmSkuTouched = false;
  document.getElementById('npm-title').textContent = 'Add New Product';
  ['npm-name','npm-sku','npm-price','npm-add-item-ship','npm-w','npm-h','npm-dpi','npm-notes'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  ['npm-dtg','npm-dtf','npm-emb','npm-apl','npm-lsr'].forEach(id => { const e=document.getElementById(id); if(e) e.checked=true; });
  ['npm-dtg-price','npm-dtf-price','npm-emb-price','npm-apl-price','npm-lsr-price'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  _npmPriceTiers = [{ size:'S', price:'', shipping:'' }];
  npmRenderPriceTiers();
  _npmSideMockups = { front: '', back: '', left: '', right: '', sleeve: '' };
  _npmSideMockupNames = {};
  _npmPaCurrentSide = 'front';
  const _paSel = document.getElementById('npm-pa-side'); if (_paSel) _paSel.value = 'front';
  _npmSetMockupImage('', '');
  npmSeedExtras([]);
  const cat = document.getElementById('npm-cat'); if (cat) cat.value = 'Apparel';
  const st = document.getElementById('npm-status'); if (st) st.value = 'Active';
  document.getElementById('npm-variants').innerHTML = '';
  addVariantRow();
  _npmVarPage = 1; npmRenderVariantPage();
  npmSeedColorImages({});
  document.getElementById('npm-delete-btn').style.display = 'none';
  document.getElementById('npm-publish-btn').textContent = 'Publish Product →';
  _npmPaAreas = { front: { ...NPM_PA_DEFAULT } };
  _npmPaCurrentSide = 'front';
  const paSel = document.getElementById('npm-pa-side'); if (paSel) paSel.value = 'front';
  const spEl = document.getElementById('npm-side-price'); if (spEl) spEl.value = '';
  const sideLbl = document.getElementById('npm-pa-side-label'); if (sideLbl) sideLbl.textContent = 'Front';
  npmTab('details');
  npmPaSetImage('');
  document.getElementById('new-product-modal').classList.remove('modal-hidden');
  // Capture clean snapshot so the close handler can detect unsaved edits.
  setTimeout(_npmMarkClean, 0);
}

function closeNewProductModal() { document.getElementById('new-product-modal').classList.add('modal-hidden'); }

// ── Categories — render the two dropdowns (NPM "Category" + Products page
//    "All Types" filter) from EGStore so admin/operator can add custom ones
//    that show up everywhere. The "+ New category…" option triggers a small
//    prompt; new categories appear on the seller side too via the shared store.
function npmRefreshCategoryOptions(){
  var cats = (typeof EGStore !== 'undefined' && EGStore.getProductCategories)
    ? EGStore.getProductCategories() : ['Apparel','Accessories','Wall Art','Drinkware','Stickers'];
  // NPM modal dropdown
  var sel = document.getElementById('npm-cat');
  if (sel) {
    var prev = sel.value || cats[0];
    sel.innerHTML = cats.map(function(c){ return '<option' + (c === prev ? ' selected' : '') + '>' + c + '</option>'; }).join('')
      + '<option value="__new__" style="font-style:italic;color:#374151">+ New category…</option>';
    if (cats.indexOf(prev) < 0) sel.value = cats[0];
  }
  // Products page filter
  var fsel = document.getElementById('op-prod-cat');
  if (fsel) {
    var fprev = fsel.value || '';
    fsel.innerHTML = '<option value="">All Types</option>'
      + cats.map(function(c){ return '<option' + (c === fprev ? ' selected' : '') + '>' + c + '</option>'; }).join('');
  }
}
function npmCatChange(sel){
  if (sel.value === '__new__') {
    var name = (prompt('New category name:') || '').trim();
    if (!name) { sel.value = (EGStore.getProductCategories()[0] || 'Apparel'); return; }
    if (typeof EGStore !== 'undefined' && EGStore.addProductCategory) {
      var added = EGStore.addProductCategory(name);
      if (added) {
        npmRefreshCategoryOptions();
        sel.value = added;
      } else {
        // Already exists — just select it
        sel.value = name;
      }
    }
  }
}
// Cross-tab sync — when a category is added on another dashboard.
window.addEventListener('storage', function(e){ if (e && (e.key === null || e.key === 'eg_product_categories')) npmRefreshCategoryOptions(); });
window.addEventListener('eg-categories-changed', npmRefreshCategoryOptions);
document.addEventListener('DOMContentLoaded', npmRefreshCategoryOptions);
// Refresh once Products section is shown for the first time.
(function(){ var orig = window.showSection; if (typeof orig === 'function') window.showSection = function(id){ orig(id); if (id === 'products') npmRefreshCategoryOptions(); }; })();

// Dirty check — looks at the few fields the user actually types into.
// Mockups, color images, extras, and any non-default size tier also count as
// edits. Anything else (category, status, DPI defaults) is ignored so a fresh
// X click on an untouched modal closes cleanly.
function _npmIsDirty(){
  if ((document.getElementById('npm-name')?.value  || '').trim()) return true;
  if ((document.getElementById('npm-sku')?.value   || '').trim()) return true;
  if ((document.getElementById('npm-notes')?.value || '').trim()) return true;
  if ((document.getElementById('npm-add-item-ship')?.value || '').trim()) return true;
  // Per-side mockups
  if (_npmSideMockups && Object.keys(_npmSideMockups).some(function(k){ return !!_npmSideMockups[k]; })) return true;
  // Extras / color images
  if (Array.isArray(_npmExtras) && _npmExtras.length) return true;
  if (typeof npmCollectColorImages === 'function' && Object.keys(npmCollectColorImages()).length) return true;
  // Any tier with a price > 0 means the user actually configured pricing.
  if (Array.isArray(_npmPriceTiers) && _npmPriceTiers.some(function(t){
    return (t.size && _NPM_SIZE_ORDER.indexOf(String(t.size).toUpperCase()) !== 1) // anything other than the default "S"
        || (t.price && parseFloat(t.price) > 0)
        || (t.shipping && parseFloat(t.shipping) > 0);
  })) return true;
  return false;
}
function _npmMarkClean(){ /* no-op — kept for backwards compat */ }

// Intercept X / Cancel / overlay clicks. If the form has unsaved edits, show
// a 3-button modal: Save as Draft / Discard / Keep editing.
function npmRequestClose(){
  if (!_npmIsDirty()) { closeNewProductModal(); return; }
  npmOpenDraftPrompt();
}
function npmOpenDraftPrompt(){
  let m = document.getElementById('npm-draft-prompt');
  if (!m) {
    m = document.createElement('div');
    m.id = 'npm-draft-prompt';
    m.className = 'modal-overlay';
    m.style.zIndex = '400';
    m.addEventListener('click', function(e){ if (e.target === m) npmCloseDraftPrompt(); });
    m.innerHTML =
      '<div class="modal" style="max-width:420px;width:92vw">' +
        '<div style="padding:18px 22px;border-bottom:1px solid #f3f3f1">' +
          '<div style="font-size:15.5px;font-weight:700;color:#191918">Unsaved changes</div>' +
          '<div style="font-size:12.5px;color:#6b7280;margin-top:3px">You have unsaved edits to this product. Save as draft to keep them, or discard.</div>' +
        '</div>' +
        '<div style="padding:14px 22px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">' +
          '<button id="npm-draft-keep"    class="btn btn-out">Keep editing</button>' +
          '<button id="npm-draft-discard" class="btn"     style="background:#fff;border:1.5px solid #fecaca;color:#dc2626;font-weight:600">Discard</button>' +
          '<button id="npm-draft-save"    class="btn btn-dk">Save as draft</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    document.getElementById('npm-draft-keep').addEventListener('click', npmCloseDraftPrompt);
    document.getElementById('npm-draft-discard').addEventListener('click', function(){ npmCloseDraftPrompt(); closeNewProductModal(); });
    document.getElementById('npm-draft-save').addEventListener('click', function(){ npmCloseDraftPrompt(); saveProductDraft(); });
  }
  m.classList.remove('modal-hidden');
}
function npmCloseDraftPrompt(){
  const m = document.getElementById('npm-draft-prompt');
  if (m) m.classList.add('modal-hidden');
}

function npmVariantColors() {
  const seen = {}, out = [];
  document.querySelectorAll('#npm-variants .npm-variant-row').forEach(r => {
    const c = (r.querySelector('.npm-v-color')?.value || '').trim();
    if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; out.push(c); }
  });
  return out;
}
function _npmColorOptions(selected) {
  const colors = npmVariantColors();
  if (selected && colors.indexOf(selected) === -1) colors.unshift(selected);
  return '<option value="">Select color…</option>' + colors.map(c => '<option'+(c===selected?' selected':'')+'>'+c+'</option>').join('');
}
// Re-populate every Color-images "Select color" dropdown from the current
// variant colours, in real time, preserving each row's current selection.
function npmRefreshColorImageOptions() {
  document.querySelectorAll('#npm-color-images .npm-ci-color').forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = _npmColorOptions(cur);
    sel.value = cur;
  });
}
function addColorImageRow(color, dataUrl, isMain) {
  const row = document.createElement('div');
  row.className = 'npm-ci-row';
  row.style.cssText = 'display:grid;grid-template-columns:46px 1fr auto 28px;gap:8px;align-items:center';
  row.innerHTML = '<label style="width:46px;height:46px;border-radius:8px;border:1.5px dashed #d1d5db;background:#f6f5f4;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-shrink:0">'
    + '<img class="npm-ci-thumb" style="width:100%;height:100%;object-fit:cover;display:none"/>'
    + '<svg class="npm-ci-icon" width="16" height="16" viewBox="0 0 22 22" fill="none"><path d="M11 4v9M7 8l4-4 4 4" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    + '<input type="file" accept="image/*" class="npm-ci-input" style="display:none" onchange="npmCiPreview(this)"/>'
    + '</label>'
    + '<select class="input npm-ci-color" style="font-size:13px">'+_npmColorOptions(color)+'</select>'
    + '<button type="button" class="npm-ci-main" title="Use this color\'s image as the product’s main image" onclick="npmCiSetMain(this)">Main</button>'
    + '<button onclick="this.closest(\'.npm-ci-row\').remove();npmCiEnsureMain()" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:19px;line-height:1;padding:0">×</button>';
  document.getElementById('npm-color-images').appendChild(row);
  if (dataUrl) { const img = row.querySelector('.npm-ci-thumb'); img.src = dataUrl; img.style.display = 'block'; row.querySelector('.npm-ci-icon').style.display = 'none'; }
  if (isMain) row.querySelector('.npm-ci-main').classList.add('is-main');
  return row;
}
function npmCiSetMain(btn) {
  const on = btn.classList.contains('is-main');
  document.querySelectorAll('#npm-color-images .npm-ci-main.is-main').forEach(b => b.classList.remove('is-main'));
  if (!on) btn.classList.add('is-main');
}
function npmGetMainColor() {
  const row = document.querySelector('#npm-color-images .npm-ci-row .npm-ci-main.is-main')?.closest('.npm-ci-row');
  if (!row) return '';
  const color = (row.querySelector('.npm-ci-color')?.value || '').trim();
  const img = row.querySelector('.npm-ci-thumb');
  return (color && img && img.style.display !== 'none') ? color : '';
}
function npmCiEnsureMain() {}
function npmCiPreview(input) {
  const file = input.files[0]; if (!file) return;
  if (typeof EGStore !== 'undefined' && EGStore.validateUpload) {
    const chk = EGStore.validateUpload(file);
    if (!chk.ok) { EGStore.showUploadError(file.name, chk.error); input.value = ''; return; }
  }
  const row = input.closest('.npm-ci-row');
  const img = row.querySelector('.npm-ci-thumb');
  _npmReadAndDownscale(file, function(url){
    img.src = url; img.style.display = 'block';
    row.querySelector('.npm-ci-icon').style.display = 'none';
  });
}
var _npmMockup = '';
var _npmSideMockups = { front: '', back: '', left: '', right: '', sleeve: '' };
var _npmSideMockupNames = {};
function _npmSetMockupImage(dataUrl, fileName){
  var side = _npmPaCurrentSide || 'front';
  _npmSideMockups[side] = dataUrl || '';
  if (fileName) _npmSideMockupNames[side] = fileName;
  if (side === 'front' || !_npmMockup) _npmMockup = _npmSideMockups.front || dataUrl || '';
  npmRenderMockupPreview();
  if (typeof npmPaSetImage === 'function') npmPaSetImage(_npmSideMockups[side]);
  _npmUpdateStageEmptyState();
}
function _npmUpdateStageEmptyState(){
  var side = _npmPaCurrentSide || 'front';
  var img = document.getElementById('npm-pa-img');
  var empty = document.getElementById('npm-pa-empty');
  var replaceBtn = document.getElementById('npm-pa-replace');
  var sideLabel = document.getElementById('npm-pa-empty-side');
  var box = document.getElementById('npm-pa-box');
  var has = !!_npmSideMockups[side];
  if (img)    { img.src = _npmSideMockups[side] || ''; img.style.display = has ? '' : 'none'; }
  if (empty)  empty.style.display = has ? 'none' : 'flex';
  if (replaceBtn) replaceBtn.style.display = has ? '' : 'none';
  if (box)    box.style.display = has ? 'block' : 'none';
  if (sideLabel) {
    var sel = document.getElementById('npm-pa-side');
    sideLabel.textContent = sel ? sel.options[sel.selectedIndex].text : 'Front';
  }
}
function _npmReadAndDownscale(file, cb){
  var rd = new FileReader();
  rd.onload = function(e){
    var src = e.target.result;
    var p = (typeof EGStore !== 'undefined' && EGStore.downscaleDataUrl)
      ? EGStore.downscaleDataUrl(src) : Promise.resolve(src);
    p.then(function(out){ cb(out); });
  };
  rd.readAsDataURL(file);
}
// Raw file read — NO downscale. Used for mockup uploads where alpha must be
// preserved. EGStore.downscaleDataUrl falls back to JPEG above ~800KB which
// flattens transparency to black; bypassing it keeps the original PNG bytes
// (including the alpha channel) intact.
function _npmReadRawDataUrl(file, cb){
  var rd = new FileReader();
  rd.onload = function(e){ cb(e.target.result); };
  rd.readAsDataURL(file);
}
function npmPaDropMockup(e){
  e.preventDefault();
  var stage = document.getElementById('npm-pa-stage');
  if (stage) stage.classList.remove('npm-pa-drag');
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  if (typeof EGStore !== 'undefined' && EGStore.validateUpload) {
    var chk = EGStore.validateUpload(f);
    if (!chk.ok) { EGStore.showUploadError(f.name, chk.error); return; }
  }
  _npmReadRawDataUrl(f, function(url){ _npmSetMockupImage(url, f.name); });
}
window.npmPaDropMockup = npmPaDropMockup;
function npmHandleMockup(input){
  var f = input.files && input.files[0]; if (!f) return;
  if (typeof EGStore !== 'undefined' && EGStore.validateUpload) {
    var chk = EGStore.validateUpload(f);
    if (!chk.ok) { EGStore.showUploadError(f.name, chk.error); input.value = ''; return; }
  }
  _npmReadRawDataUrl(f, function(url){ _npmSetMockupImage(url, f.name); });
  input.value = '';
}
function npmClearMockup(){
  var p=(opEditProductId&&typeof OP_PRODUCTS!=='undefined')?OP_PRODUCTS.find(function(x){return x.id===opEditProductId;}):null;
  _npmSetMockupImage(p && p.img ? p.img : '', '');
}

var _npmExtras = [];
function npmHandleExtraImages(input){
  var files = input && input.files ? Array.from(input.files) : [];
  if (!files.length) return;
  files.forEach(function(f){
    if (typeof EGStore !== 'undefined' && EGStore.validateUpload) {
      var chk = EGStore.validateUpload(f);
      if (!chk.ok) { EGStore.showUploadError(f.name, chk.error); return; }
    }
    _npmReadAndDownscale(f, function(url){ _npmExtras.push(url); npmRenderExtras(); });
  });
  input.value = '';
}
function npmRemoveExtra(i){ _npmExtras.splice(i,1); npmRenderExtras(); }
function npmRenderExtras(){
  var wrap = document.getElementById('npm-extra-images'); if(!wrap) return;
  if (!_npmExtras.length){
    wrap.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:#c4c3be;padding:14px 8px;text-align:center;border:1px dashed #e5e4e0;border-radius:8px">No extra images yet</div>';
    return;
  }
  wrap.innerHTML = _npmExtras.map(function(src, i){
    return '<div style="position:relative;aspect-ratio:1;border:1px solid #e5e4e0;border-radius:8px;overflow:hidden;background:#f6f5f4 center/cover no-repeat;background-image:url(' + src + ')">'
      + '<button type="button" onclick="npmRemoveExtra(' + i + ')" title="Remove" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border:none;border-radius:50%;background:rgba(25,25,24,.7);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit"><svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>'
      + '</div>';
  }).join('');
}
function npmSeedExtras(arr){ _npmExtras = Array.isArray(arr) ? arr.slice() : []; npmRenderExtras(); }
function npmCollectExtras(){ return _npmExtras.slice(); }
function npmRenderMockupPreview(){
  var p = document.getElementById('npm-mockup-preview'), c = document.getElementById('npm-mockup-clear');
  if (p){
    if (_npmMockup){ p.style.backgroundImage = 'url(' + _npmMockup + ')'; p.innerHTML = ''; }
    else { p.style.backgroundImage = ''; p.innerHTML = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 11l3-3 2 2 3.5-3.5L14 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="6" r="1.1" fill="currentColor"/></svg>'; }
  }
  if (c) c.style.display = _npmMockup ? '' : 'none';
}
function npmCollectColorImages() {
  const map = {};
  document.querySelectorAll('#npm-color-images .npm-ci-row').forEach(r => {
    const color = (r.querySelector('.npm-ci-color')?.value || '').trim();
    const img = r.querySelector('.npm-ci-thumb');
    const src = (img && img.style.display !== 'none') ? img.src : '';
    if (color && src) map[color] = src;
  });
  return map;
}
function npmSeedColorImages(colorImages, mainColor) {
  const wrap = document.getElementById('npm-color-images');
  if (wrap) wrap.innerHTML = '';
  if (colorImages && typeof colorImages === 'object') {
    Object.keys(colorImages).forEach(c => addColorImageRow(c, colorImages[c], mainColor && c === mainColor));
  }
}

function npmPreviewImage(input) {
  const file = input.files[0];
  if (!file) return;
  if (typeof EGStore !== 'undefined' && EGStore.validateUpload) {
    const chk = EGStore.validateUpload(file);
    if (!chk.ok) { EGStore.showUploadError(file.name, chk.error); input.value = ''; return; }
  }
  _npmReadRawDataUrl(file, function(url){ _npmSetMockupImage(url, file.name); });
}

const NPM_PA_DEFAULT = { x: 25, y: 25, w: 50, h: 50, dpi: 300 };
const NPM_PA_SIDES = ['front','back','left','right','sleeve'];
let _npmPaAreas = {};
let _npmPaCurrentSide = 'front';
const NPM_PA_MAX_INCHES = 16;

function npmPaSetImage(dataUrl) {
  const img = document.getElementById('npm-pa-img');
  const empty = document.getElementById('npm-pa-empty');
  if (!img) return;
  if (dataUrl) {
    img.src = dataUrl;
    img.style.display = '';
    if (empty) empty.style.display = 'none';
    npmPaRenderBox();
  } else {
    img.src = '';
    img.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    const box = document.getElementById('npm-pa-box'); if (box) box.style.display = 'none';
  }
}

function npmTab(name) {
  document.querySelectorAll('#new-product-modal .npm-tab').forEach(b => b.classList.toggle('npm-tab-on', b.dataset.tab === name));
  document.querySelectorAll('#new-product-modal .npm-panel').forEach(p => { p.style.display = (p.dataset.panel === name) ? 'flex' : 'none'; });
  const body = document.getElementById('npm-right-body'); if (body) body.scrollTop = 0;
}

function npmPaSwitchSide() {
  const sel = document.getElementById('npm-pa-side');
  _npmPaCurrentSide = sel ? sel.value : 'front';
  if (!_npmPaAreas[_npmPaCurrentSide]) _npmPaAreas[_npmPaCurrentSide] = { ...NPM_PA_DEFAULT };
  const img = document.getElementById('npm-pa-img');
  const side = _npmPaCurrentSide;
  const sideSrc = (_npmSideMockups && _npmSideMockups[side]) || '';
  if (img) { img.src = sideSrc; img.style.display = sideSrc ? '' : 'none'; }
  _npmUpdateStageEmptyState();
  npmPaRenderBox();
  npmPaReflectPrice();
  const lbl = document.getElementById('npm-pa-side-label');
  if (lbl && sel) lbl.textContent = sel.options[sel.selectedIndex].text;
}

function npmPaReset() {
  const prevPrice = (_npmPaAreas[_npmPaCurrentSide] || {}).price || 0;
  _npmPaAreas[_npmPaCurrentSide] = { ...NPM_PA_DEFAULT, price: prevPrice };
  npmPaRenderBox();
}

function npmPaSyncPrice() {
  const el = document.getElementById('npm-side-price');
  if (!el) return;
  const a = _npmPaAreas[_npmPaCurrentSide] || (_npmPaAreas[_npmPaCurrentSide] = { ...NPM_PA_DEFAULT });
  const v = parseFloat(el.value);
  a.price = (!isNaN(v) && v > 0) ? +v.toFixed(2) : 0;
}
function npmPaReflectPrice() {
  const el = document.getElementById('npm-side-price');
  if (!el || document.activeElement === el) return;
  const a = _npmPaAreas[_npmPaCurrentSide];
  el.value = (a && a.price) ? a.price : '';
}

function npmPaRenderBox() {
  const box = document.getElementById('npm-pa-box');
  const stage = document.getElementById('npm-pa-stage');
  const img = document.getElementById('npm-pa-img');
  if (!box || !stage) return;
  if (!img || img.style.display === 'none') { box.style.display = 'none'; return; }
  const a = _npmPaAreas[_npmPaCurrentSide] || (_npmPaAreas[_npmPaCurrentSide] = { ...NPM_PA_DEFAULT });
  box.style.display = 'block';
  box.style.left   = a.x + '%';
  box.style.top    = a.y + '%';
  box.style.width  = a.w + '%';
  box.style.height = a.h + '%';
  const readout = document.getElementById('npm-pa-readout');
  if (readout) {
    const inW = (a.w / 100 * NPM_PA_MAX_INCHES).toFixed(1);
    const inH = (a.h / 100 * NPM_PA_MAX_INCHES).toFixed(1);
    readout.textContent = `${a.w.toFixed(0)}%×${a.h.toFixed(0)}%  ·  ~${inW}″×${inH}″`;
  }
  const wEl = document.getElementById('npm-w'), hEl = document.getElementById('npm-h');
  if (wEl && document.activeElement !== wEl) wEl.value = (a.w / 100 * NPM_PA_MAX_INCHES).toFixed(2);
  if (hEl && document.activeElement !== hEl) hEl.value = (a.h / 100 * NPM_PA_MAX_INCHES).toFixed(2);
}

function npmPaSyncFromInches() {
  const w = parseFloat(document.getElementById('npm-w').value);
  const h = parseFloat(document.getElementById('npm-h').value);
  const a = _npmPaAreas[_npmPaCurrentSide] || (_npmPaAreas[_npmPaCurrentSide] = { ...NPM_PA_DEFAULT });
  if (!isNaN(w) && w > 0) a.w = Math.min(100, w / NPM_PA_MAX_INCHES * 100);
  if (!isNaN(h) && h > 0) a.h = Math.min(100, h / NPM_PA_MAX_INCHES * 100);
  if (a.x + a.w > 100) a.x = Math.max(0, 100 - a.w);
  if (a.y + a.h > 100) a.y = Math.max(0, 100 - a.h);
  npmPaRenderBox();
}

(function attachPaHandlers(){
  function onDown(e) {
    const box = document.getElementById('npm-pa-box');
    const stage = document.getElementById('npm-pa-stage');
    if (!box || !stage) return;
    if (!box.contains(e.target)) return;
    e.preventDefault();
    const handle = e.target.closest('[data-h]');
    const mode = handle ? ('resize-' + handle.dataset.h) : 'move';
    const sr = stage.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const a0 = { ..._npmPaAreas[_npmPaCurrentSide] };
    const move = (ev) => {
      const dxPct = (ev.clientX - startX) / sr.width  * 100;
      const dyPct = (ev.clientY - startY) / sr.height * 100;
      const a = _npmPaAreas[_npmPaCurrentSide];
      if (mode === 'move') {
        a.x = Math.max(0, Math.min(100 - a0.w, a0.x + dxPct));
        a.y = Math.max(0, Math.min(100 - a0.h, a0.y + dyPct));
      } else {
        if (mode.includes('e')) a.w = Math.max(5, Math.min(100 - a0.x, a0.w + dxPct));
        if (mode.includes('s')) a.h = Math.max(5, Math.min(100 - a0.y, a0.h + dyPct));
        if (mode.includes('w')) {
          const newX = Math.max(0, Math.min(a0.x + a0.w - 5, a0.x + dxPct));
          a.w = a0.w + (a0.x - newX); a.x = newX;
        }
        if (mode.includes('n')) {
          const newY = Math.max(0, Math.min(a0.y + a0.h - 5, a0.y + dyPct));
          a.h = a0.h + (a0.y - newY); a.y = newY;
        }
      }
      npmPaRenderBox();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  document.addEventListener('mousedown', onDown);
})();

function npmValidateStock() {
  const invalid = [];
  document.querySelectorAll('#npm-variants .npm-variant-row').forEach(r => {
    const color = (r.querySelector('.npm-v-color')?.value || '').trim();
    const size  = (r.querySelector('.npm-v-sizes')?.value || '').trim();
    const stockEl = r.querySelector('.npm-v-stock');
    if ((color || size) && (stockEl?.value || '').trim() === '') invalid.push(stockEl);
  });
  if (!invalid.length) return true;
  invalid.forEach(el => { el.classList.remove('npm-pulse'); void el.offsetWidth; el.classList.add('npm-pulse'); });
  invalid[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (typeof opPushToast === 'function') opPushToast('Enter stock for every variant');
  return false;
}

function npmCommit(status) {
  const name = document.getElementById('npm-name').value.trim();
  if (!name) { alert('Product name is required.'); return; }
  if (!npmValidateStock()) return;
  const sku   = (document.getElementById('npm-sku').value.trim() || autoGenSKUFromName(name)).toUpperCase();
  const price = parseFloat(document.getElementById('npm-price').value) || 0;
  const _shipRaw = document.getElementById('npm-ship')?.value;
  const shippingFee = (_shipRaw != null && _shipRaw !== '') ? (parseFloat(_shipRaw) || 0) : null;
  const _addItemShipRaw = document.getElementById('npm-add-item-ship')?.value;
  const additionalItemShipping = (_addItemShipRaw != null && _addItemShipRaw !== '') ? (parseFloat(_addItemShipRaw) || 0) : null;
  const description = (document.getElementById('npm-notes')?.value || '').trim();
  const type  = document.getElementById('npm-cat')?.value || 'Apparel';
  const method = npmCollectMethods();
  const methodPrices = (typeof npmCollectMethodPrices === 'function') ? npmCollectMethodPrices() : {};
  const sizePrices = (typeof npmCollectPriceTiers === 'function') ? npmCollectPriceTiers() : [];
  const variants = npmCollectVariantsSummary() || '1 variant';
  const variantSkus = (typeof npmBuildVariantSKUs === 'function') ? npmBuildVariantSKUs() : [];
  const colorImages = (typeof npmCollectColorImages === 'function') ? npmCollectColorImages() : {};
  const _stgImg = document.getElementById('npm-pa-img');
  const img = (_stgImg && _stgImg.style.display !== 'none' && _stgImg.src) ? _stgImg.src : '';
  const fallback = name.split(' ')[0] || 'Item';
  const ciKeys = Object.keys(colorImages);
  const mainColor = (typeof npmGetMainColor === 'function') ? npmGetMainColor() : '';
  // Pick the product's display image, preferring a REAL uploaded image. A color
  // slot can exist with an empty value (e.g. a variant colour defined but no image
  // uploaded for it) — the old code blindly took colorImages[firstKey] even when
  // it was '', so a real mockup upload was discarded and the product fell back to
  // the placeholder. Now: main-colour image → first NON-EMPTY colour image →
  // staged image → mockup → front side mockup.
  const _hasImg = function(v){ return v && typeof v === 'string' && (v.startsWith('data:') || /^https?:/.test(v)) && v.indexOf('placehold.co') === -1; };
  const _firstRealCi = ciKeys.map(function(k){ return colorImages[k]; }).find(_hasImg);
  const _extras = (typeof npmCollectExtras === 'function') ? (npmCollectExtras() || []) : [];
  const _firstExtra = Array.isArray(_extras) ? _extras.find(_hasImg) : '';
  // Catalog/display image = a real PRODUCT photo: main-colour image → first colour
  // image → product gallery image. The MOCKUP is the design-maker template, so it's
  // only a LAST RESORT (so the catalog isn't blank when no product photo exists yet).
  const avatar = (mainColor && _hasImg(colorImages[mainColor])) ? colorImages[mainColor]
               : (_firstRealCi
                  || _firstExtra
                  || (_hasImg(_npmMockup) ? _npmMockup : '')
                  || (_npmSideMockups && _hasImg(_npmSideMockups.front) ? _npmSideMockups.front : '')
                  || (_hasImg(img) ? img : '')
                  || '');
  const dpi = parseInt(document.getElementById('npm-dpi').value) || null;
  const printAreas = {};
  Object.keys(_npmPaAreas).forEach(side => {
    const a = _npmPaAreas[side];
    if (!a) return;
    const diverges = (a.x !== NPM_PA_DEFAULT.x || a.y !== NPM_PA_DEFAULT.y || a.w !== NPM_PA_DEFAULT.w || a.h !== NPM_PA_DEFAULT.h);
    const hasPrice = a.price && a.price > 0;
    if (diverges || hasPrice) {
      printAreas[side] = { x: +a.x.toFixed(2), y: +a.y.toFixed(2), w: +a.w.toFixed(2), h: +a.h.toFixed(2) };
      if (hasPrice) printAreas[side].price = +a.price.toFixed(2);
    }
  });

  if (opEditProductId) {
    const p = OP_PRODUCTS.find(x => x.id === opEditProductId);
    if (p) {
      p.name = name; p.sku = sku; p.price = price; p.type = type;
      p.shippingFee = shippingFee;
      p.additionalItemShipping = additionalItemShipping;
      p.description = description;
      p.methodPrices = methodPrices;
      p.sizePrices = sizePrices;
      p.method = method; p.variants = variants; p.status = status;
      p.variantSkus = variantSkus;
      p.colorImages = colorImages;
      p.mainColor = mainColor || '';
      p.mockup = _npmMockup || '';
      p.sideMockups = Object.assign({}, _npmSideMockups);
      p.images = npmCollectExtras();
      if (avatar) p.img = avatar;
      p.fallback = fallback;
      p.printAreas = printAreas;
      if (dpi) p.dpi = dpi;
    }
    if (typeof addShiftEvent === 'function') addShiftEvent('note','Product updated: '+name,'SKU: '+sku+' · '+status);
  } else {
    const newId = (OP_PRODUCTS.reduce((m,x)=>Math.max(m,x.id||0),0)) + 1;
    OP_PRODUCTS.unshift({ id:newId, name, sku, type, method, methodPrices, sizePrices, variants, variantSkus, colorImages, mainColor: mainColor || '', mockup: _npmMockup || '', sideMockups: Object.assign({}, _npmSideMockups), images: npmCollectExtras(), price, shippingFee, additionalItemShipping, description, status, img: avatar || 'https://placehold.co/400x400/f0ede9/6b7280?text='+encodeURIComponent(fallback), fallback, printAreas, dpi });
    if (typeof addShiftEvent === 'function') addShiftEvent(status==='Active'?'approve':'note', (status==='Active'?'Product published: ':'Draft saved: ')+name, 'SKU: '+sku);
  }
  opPersistProducts();
  seedInventoryFromProduct({ name, sku, type, variantSkus });
  closeNewProductModal();
  renderOpProducts();
  if (typeof renderInventory === 'function') renderInventory();
}

function seedInventoryFromProduct(p) {
  if (!p) return;
  const variants = Array.isArray(p.variantSkus) && p.variantSkus.length
    ? p.variantSkus
    : [{ sku: p.sku, color: '', size: '' }];
  const rows = variants.map(v => ({
    sku: v.sku,
    name: p.name,
    variant: [v.color, v.size].filter(Boolean).join(' / ') || '—',
    inStock: (v.stock != null && v.stock !== '') ? (parseInt(v.stock, 10) || 0) : 0,
    reserved: 0,
    reorderAt: 25,
    category: p.type || 'Apparel'
  }));
  if (typeof INVENTORY_ITEMS !== 'undefined') {
    rows.forEach(r => {
      if (!INVENTORY_ITEMS.find(i => i.sku === r.sku)) INVENTORY_ITEMS.push(r);
    });
  }
  if (typeof EGStore !== 'undefined' && EGStore.upsertInventoryRows) {
    EGStore.upsertInventoryRows(rows);
  }
}

function opPersistProducts() {
  if (typeof EGStore !== 'undefined' && EGStore.setCatalogProducts) {
    EGStore.setCatalogProducts(OP_PRODUCTS);
  }
}

function saveProductDraft() { npmCommit('Draft'); }
function publishProduct()  { npmCommit(opEditProductId ? (document.getElementById('npm-status')?.value || 'Active') : 'Active'); }

function npmDeleteProduct() {
  if (!opEditProductId) return;
  const p = OP_PRODUCTS.find(x => x.id === opEditProductId);
  if (!p) return;
  if (!confirm('Delete "' + p.name + '"?\n\nThis removes it from the catalog. Existing orders referencing this product are unaffected.')) return;
  const idx = OP_PRODUCTS.findIndex(x => x.id === opEditProductId);
  if (idx >= 0) OP_PRODUCTS.splice(idx, 1);
  if (typeof addShiftEvent === 'function') addShiftEvent('flag','Product deleted: '+p.name,'SKU: '+p.sku);
  opPersistProducts();
  closeNewProductModal();
  renderOpProducts();
}

function autoGenSKUFromName(name) {
  const words = name.trim().toUpperCase().replace(/[^A-Z0-9\s]/g,'').split(/\s+/).filter(Boolean);
  return words.slice(0,3).map(w=>w.slice(0,3)).join('-') || 'SKU';
}
function autoNpmSKU(force) {
  const nameEl = document.getElementById('npm-name');
  const skuEl  = document.getElementById('npm-sku');
  if (!nameEl || !skuEl) return;
  if (force) { npmSkuTouched = false; skuEl.value = autoGenSKUFromName(nameEl.value || 'PRODUCT'); }
  else if (!npmSkuTouched) skuEl.value = autoGenSKUFromName(nameEl.value || '');
  if (typeof npmUpdateVariantSKUs === 'function') npmUpdateVariantSKUs();
}

// Hydrate OP_PRODUCTS from EGStore so seller dashboards reflect what operator publishes.
(function hydrateOpProducts(){
  if (typeof EGStore === 'undefined' || !EGStore.getCatalogProducts) return;
  const stored = EGStore.getCatalogProducts();
  if (stored && stored.length) {
    OP_PRODUCTS.length = 0;
    stored.forEach(p => OP_PRODUCTS.push(p));
  } else {
    EGStore.setCatalogProducts(OP_PRODUCTS);
  }
})();
if (typeof renderOpProducts === 'function') renderOpProducts();
window.addEventListener('storage', function(e){
  if (e.key !== 'eg_catalog_products' || !e.newValue) return;
  try {
    const parsed = JSON.parse(e.newValue);
    if (!Array.isArray(parsed)) return;
    OP_PRODUCTS.length = 0;
    parsed.forEach(p => OP_PRODUCTS.push(p));
    renderOpProducts();
  } catch(err) {}
});
