/* eg-products-tabs.js — SHARED products-section enhancer for the factory boards.
   Loaded via <script> on admin/operator/warehouse. It finds each board's existing
   #section-products (search #op-prod-search, filters #op-prod-cat/#op-prod-status,
   grid #op-prod-grid, "+ Add Product" → openNewProductModal()) and, without touching
   that logic, adds a tab row above it:
     • New In   → S&S-synced blanks from /api/ss/products (with "Add to catalog")
     • Catalog  → the board's existing product grid (default view)
     • Create   → opens the board's existing new-product modal
   It also re-skins the search + filter selects to the neo-brutalism theme (the un-themed
   soft #f6f5f4 pills). Purely additive + guarded — no-ops on any page without the section. */
(function () {
  'use strict';
  if (window.__egProdTabs) return; window.__egProdTabs = 1;
  function $(id) { return document.getElementById(id); }
  function tok() { try { return localStorage.getItem('eg_token') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function injectCSS() {
    if ($('epx-css')) return;
    var st = document.createElement('style'); st.id = 'epx-css';
    st.textContent =
      ".epx-tabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}" +
      ".epx-tab{font-family:'DepartureMono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;padding:9px 15px;border:1.5px solid #191918;background:#fff;color:#191918;cursor:pointer;border-radius:0;display:flex;align-items:center;gap:7px;transition:background .12s,color .12s}" +
      ".epx-tab.on{background:#191918;color:#fff}" +
      ".epx-tab .n{font-size:10px;opacity:.7;font-variant-numeric:tabular-nums}" +
      /* re-theme the board's search + selects (they carry inline soft styles → need !important) */
      "#op-prod-search{background:#fff!important;border:1.5px solid #191918!important;border-radius:0!important;box-shadow:2px 2px 0 #191918;width:240px!important}" +
      "#op-prod-cat,#op-prod-status{border:1.5px solid #191918!important;border-radius:0!important;background:#fff!important;font-family:'DepartureMono',ui-monospace,SFMono-Regular,Menlo,monospace!important;text-transform:uppercase;font-size:11px!important;letter-spacing:.04em;padding:7px 26px 7px 11px!important}" +
      ".epx-newin-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}" +
      "@media(max-width:1200px){.epx-newin-grid{grid-template-columns:repeat(3,1fr)}}" +
      ".epx-card{border:1.5px solid #191918;background:#fff;border-radius:0;overflow:hidden;display:flex;flex-direction:column}" +
      ".epx-card .img{height:150px;border-bottom:1.5px solid #191918;background:#f4f2ef;display:flex;align-items:center;justify-content:center;overflow:hidden}" +
      ".epx-card .img img{width:100%;height:100%;object-fit:contain}" +
      ".epx-card .b{padding:10px 12px;flex:1;display:flex;flex-direction:column;gap:3px}" +
      ".epx-card .nm{font-size:13px;font-weight:700;line-height:1.2}" +
      ".epx-card .mt{font-family:'DepartureMono',ui-monospace,Menlo,monospace;font-size:10.5px;color:#6b7280;line-height:1.35}" +
      ".epx-card .add{margin-top:8px;border:none;border-top:1.5px solid #191918;background:#2f4bf0;color:#fff;font-family:'DepartureMono',ui-monospace,Menlo,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:10px;cursor:pointer}" +
      ".epx-card .add:active{background:#2439c8}" +
      ".epx-muted{color:#6b7280;font-size:13px;padding:34px;text-align:center}" +
      "html[data-theme=dark] .epx-tab{background:transparent;border-color:#c9c3ba;color:#c9c3ba}" +
      "html[data-theme=dark] .epx-tab.on{background:#c9c3ba;color:#191918}" +
      "html[data-theme=dark] .epx-card{background:transparent;border-color:#c9c3ba}" +
      "html[data-theme=dark] .epx-card .img{background:#252220;border-bottom-color:#c9c3ba}";
    document.head.appendChild(st);
  }

  var _loaded = false, _newin, _grid, _header, _tabs;

  function loadNewIn() {
    if (_loaded) return; _loaded = true;
    fetch('/api/ss/products?limit=80', { headers: { Authorization: 'Bearer ' + tok() } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.products) || [];
        var nEl = $('epx-newin-n'); if (nEl) nEl.textContent = (d && d.total != null) ? d.total : list.length;
        if (!list.length) { _newin.innerHTML = '<div class="epx-muted">No S&amp;S blanks synced yet. Sync from S&amp;S (Purchases → Sync) to populate New In.</div>'; return; }
        _newin.innerHTML = '<div class="epx-newin-grid">' + list.map(function (p) {
          var img = p.image ? '<img src="' + esc(p.image) + '" onerror="this.style.display=\'none\'">' : '';
          var meta2 = [p.color, p.size].filter(Boolean).map(esc).join(' · ');
          var meta3 = esc(p.sku) + ' · $' + (p.price != null ? p.price : '—') + ' · qty ' + (p.qty || 0);
          return '<div class="epx-card"><div class="img">' + img + '</div><div class="b">' +
            '<div class="nm">' + esc(p.style_name || p.sku) + '</div>' +
            '<div class="mt">' + (esc(p.brand || '')) + (meta2 ? (p.brand ? ' · ' : '') + meta2 : '') + '</div>' +
            '<div class="mt">' + meta3 + '</div>' +
            '<button class="add" data-sku="' + esc(p.sku) + '" data-name="' + esc(p.style_name || '') + '">+ Add to catalog</button>' +
            '</div></div>';
        }).join('') + '</div>';
        _newin.querySelectorAll('.add').forEach(function (b) {
          b.addEventListener('click', function () { addToCatalog(b.getAttribute('data-sku'), b.getAttribute('data-name')); });
        });
      })
      .catch(function () { _newin.innerHTML = '<div class="epx-muted">Couldn’t load S&amp;S products.</div>'; });
  }

  function addToCatalog(sku, name) {
    // Best-effort: open the board's existing create-product modal and prefill name/SKU from the blank.
    if (typeof window.openNewProductModal === 'function') {
      try { window.openNewProductModal(); } catch (e) {}
      setTimeout(function () {
        var n = $('npm-name'); if (n && name) { n.value = name; }
        var s = $('npm-sku'); if (s && sku) { s.value = sku; }
      }, 250);
    }
  }

  function show(t) {
    if (!_tabs) return;
    _tabs.querySelectorAll('.epx-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
    if (t === 'create') {
      if (typeof window.openNewProductModal === 'function') { try { window.openNewProductModal(); } catch (e) {} }
      // creating is a modal, not a persistent view → snap the highlight back to Catalog
      _tabs.querySelector('[data-t="catalog"]').classList.add('on');
      _tabs.querySelector('[data-t="create"]').classList.remove('on');
      return;
    }
    var isCat = (t === 'catalog');
    if (_header) _header.style.display = isCat ? '' : 'none';
    if (_grid) _grid.style.display = isCat ? '' : 'none';
    if (_newin) _newin.style.display = isCat ? 'none' : '';
    if (!isCat) loadNewIn();
  }

  function init() {
    var sec = $('section-products'); _grid = $('op-prod-grid');
    if (!sec || !_grid) return;                 // not a board with the products section
    if (sec.querySelector('.epx-tabs')) return; // already enhanced
    injectCSS();

    _header = _grid.previousElementSibling;      // the existing search/filter + buttons row (capture BEFORE inserting)

    _tabs = document.createElement('div'); _tabs.className = 'epx-tabs';
    _tabs.innerHTML =
      '<button class="epx-tab" data-t="newin">New In <span class="n" id="epx-newin-n"></span></button>' +
      '<button class="epx-tab on" data-t="catalog">Catalog</button>' +
      '<button class="epx-tab" data-t="create">+ Create Product</button>';
    sec.insertBefore(_tabs, sec.firstChild);
    _tabs.addEventListener('click', function (e) { var b = e.target.closest('.epx-tab'); if (b) show(b.dataset.t); });

    _newin = document.createElement('div'); _newin.id = 'epx-newin'; _newin.style.display = 'none';
    _newin.innerHTML = '<div class="epx-muted">Loading S&amp;S blanks…</div>';
    _grid.parentNode.insertBefore(_newin, _grid);

    // pre-fill the New In tab count without loading the grid
    fetch('/api/ss/products?limit=1', { headers: { Authorization: 'Bearer ' + tok() } })
      .then(function (r) { return r.json(); })
      .then(function (d) { var nEl = $('epx-newin-n'); if (nEl && d && d.total != null) nEl.textContent = d.total; })
      .catch(function () {});
  }

  window.EGProdTabs = { init: init, addToCatalog: addToCatalog };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 350); });
  else setTimeout(init, 350);
})();
