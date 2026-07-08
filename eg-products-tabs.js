/* eg-products-tabs.js — SHARED products-section enhancer for the factory boards.
   Loaded via <script> on admin/operator/warehouse. It finds each board's existing
   #section-products (grid #op-prod-grid, search #op-prod-search, filters
   #op-prod-cat/#op-prod-status, new-product modal openNewProductModal()) and, without
   touching that logic, layers on a tab row:
     • New In    → the LIVE S&S catalog (GET /api/ss/styles, hits S&S directly — NOT our
                   synced DB). Own search box; each card has a ♥ favorite toggle + "Add
                   to catalog". Lazy-loaded the first time the tab is actually viewed.
     • Favorites → the staff-shared shortlist (GET /api/ss/favorites); ♥ to remove.
     • Catalog   → the board's existing product grid (default).
     • Create    → opens the board's existing new-product modal.
   Purely additive + guarded — no-ops on any page without the section. */
(function () {
  'use strict';
  if (window.__egProdTabs) return; window.__egProdTabs = 1;
  function $(id) { return document.getElementById(id); }
  function tok() { try { return localStorage.getItem('eg_token') || ''; } catch (e) { return ''; } }
  function hdr() { return { Authorization: 'Bearer ' + tok() }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var HEART = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16.6S3.2 12.4 2 8.6C1.2 6 2.7 4 5 4c1.6 0 2.7.9 5 3.2C12.3 4.9 13.4 4 15 4c2.3 0 3.8 2 3 4.6-1.2 3.8-8 8-8 8Z"/></svg>';
  // Neutral garment placeholder shown when an S&S image is missing / fails to load.
  var GARMENT = '<svg viewBox="0 0 24 24" fill="none" stroke="#bdb9b2" stroke-width="1.1"><path d="M8.5 3 4 6l1.7 2.7L8 7.6V21h8V7.6l2.3 1.1L20 6l-4.5-3c0 1.4-1.6 2.4-3.5 2.4S8.5 4.4 8.5 3Z" stroke-linejoin="round"/></svg>';

  function injectCSS() {
    if ($('epx-css')) return;
    var mono = "'DepartureMono',ui-monospace,SFMono-Regular,Menlo,monospace";
    var st = document.createElement('style'); st.id = 'epx-css';
    st.textContent =
      ".epx-tabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}" +
      ".epx-tab{font-family:" + mono + ";font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;padding:9px 15px;border:1.5px solid #191918;background:#fff;color:#191918;cursor:pointer;border-radius:0;display:flex;align-items:center;gap:7px;transition:background .12s,color .12s}" +
      ".epx-tab.on{background:#191918;color:#fff}" +
      ".epx-tab .n{font-size:10px;min-width:16px;height:16px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;background:#2f4bf0;color:#fff;border-radius:9px;font-variant-numeric:tabular-nums}" +
      ".epx-tab.on .n{background:#fff;color:#191918}" +
      /* re-theme the board's own Catalog search + selects (they carry inline soft styles) */
      "#op-prod-search{background:#fff!important;border:1.5px solid #191918!important;border-radius:0!important;box-shadow:2px 2px 0 #191918;width:240px!important}" +
      "#op-prod-cat,#op-prod-status{border:1.5px solid #191918!important;border-radius:0!important;background:#fff!important;font-family:" + mono + "!important;text-transform:uppercase;font-size:11px!important;letter-spacing:.04em;padding:7px 26px 7px 11px!important}" +
      /* keep the Catalog grid from stretching: responsive columns, capped width */
      "#op-prod-grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))!important}" +
      /* New In / Favorites search row */
      ".epx-searchrow{display:flex;align-items:center;gap:13px;margin-bottom:15px;flex-wrap:wrap}" +
      "#epx-search{flex:1;min-width:220px;max-width:460px;background:#fff;border:1.5px solid #191918;border-radius:0;padding:9px 13px;font-size:13.5px;font-family:inherit;color:#191918;outline:none;box-shadow:2px 2px 0 #191918}" +
      "#epx-search:focus{border-color:#2f4bf0;box-shadow:2px 2px 0 #2f4bf0}" +
      ".epx-status{font-family:" + mono + ";font-size:11px;color:#6b7280;white-space:nowrap}" +
      /* card grid — horizontal cards, image on the RIGHT */
      ".epx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}" +
      ".epx-card{display:flex;align-items:stretch;border:1.5px solid #191918;background:#fff;border-radius:0;overflow:hidden;min-height:120px;transition:box-shadow .14s ease,transform .14s ease}" +
      ".epx-card:hover{box-shadow:5px 5px 0 #191918;transform:translate(-1px,-1px)}" +
      ".epx-card .b{flex:1;min-width:0;padding:13px 14px;display:flex;flex-direction:column;gap:4px}" +
      ".epx-card .nm{font-size:13.5px;font-weight:700;line-height:1.25;color:#191918;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}" +
      ".epx-card .mt{font-family:" + mono + ";font-size:10.5px;color:#6b7280;line-height:1.4}" +
      ".epx-card .cardfoot{margin-top:auto;padding-top:9px}" +
      ".epx-add{border:1.5px solid #191918;background:#fff;color:#191918;font-family:" + mono + ";font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;padding:7px 11px;cursor:pointer;border-radius:0;transition:background .12s,color .12s}" +
      ".epx-add:hover{background:#2f4bf0;color:#fff;border-color:#2f4bf0}" +
      ".epx-card .img{position:relative;flex:0 0 116px;width:116px;background:#f4f2ef;border-left:1.5px solid #191918;display:flex;align-items:center;justify-content:center;overflow:hidden}" +
      ".epx-card .img>img{width:100%;height:100%;object-fit:contain}" +
      ".epx-card .img .ph svg{width:54px;height:54px;opacity:.6}" +
      /* heart */
      ".epx-heart{position:absolute;top:7px;right:7px;z-index:2;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.92);border:1.5px solid #e5e4e0;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:transform .12s,border-color .12s;backdrop-filter:blur(2px)}" +
      ".epx-heart:hover{transform:scale(1.12);border-color:#191918}" +
      ".epx-heart svg{width:15px;height:15px}" +
      ".epx-heart svg path{fill:none;stroke:#9ca3af;stroke-width:1.4;transition:fill .12s,stroke .12s}" +
      ".epx-card.is-fav .epx-heart{border-color:#2f4bf0}" +
      ".epx-card.is-fav .epx-heart svg path{fill:#2f4bf0;stroke:#2f4bf0}" +
      ".epx-muted{color:#6b7280;font-size:13px;padding:34px;text-align:center}" +
      /* dark mode */
      "html[data-theme=dark] .epx-tab{background:transparent;border-color:#c9c3ba;color:#c9c3ba}" +
      "html[data-theme=dark] .epx-tab.on{background:#c9c3ba;color:#191918}" +
      "html[data-theme=dark] .epx-card{background:transparent;border-color:#c9c3ba}" +
      "html[data-theme=dark] .epx-card:hover{box-shadow:5px 5px 0 #c9c3ba}" +
      "html[data-theme=dark] .epx-card .nm{color:#ece8e1}" +
      "html[data-theme=dark] .epx-card .img{background:#252220;border-left-color:#c9c3ba}" +
      "html[data-theme=dark] .epx-add{background:transparent;border-color:#c9c3ba;color:#c9c3ba}" +
      "html[data-theme=dark] #epx-search{background:transparent;border-color:#c9c3ba;color:#ece8e1;box-shadow:2px 2px 0 #c9c3ba}" +
      "html[data-theme=dark] .epx-heart{background:rgba(37,34,32,.9);border-color:#3a3631}";
    document.head.appendChild(st);
  }

  var _tabs, _newin, _favs, _grid, _header, _searchTimer, _newinLoaded = false, _io;

  function cardHTML(s) {
    var img = s.image
      ? '<img src="' + esc(s.image) + '" onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.ph\').style.display=\'flex\'">'
      : '';
    var phStyle = s.image ? 'display:none' : 'display:flex';
    var meta = [esc(s.brand || ''), s.category ? esc(s.category) : ''].filter(Boolean).join(' · ');
    return '<div class="epx-card' + (s.favorited ? ' is-fav' : '') + '" data-id="' + esc(s.styleID) + '">' +
      '<div class="b">' +
        '<div class="nm">' + esc(s.title || ('Style ' + s.styleID)) + '</div>' +
        '<div class="mt">' + meta + '</div>' +
        '<div class="mt">Style ' + esc(s.styleID) + '</div>' +
        '<div class="cardfoot"><button class="epx-add" type="button">+ Add to catalog</button></div>' +
      '</div>' +
      '<div class="img">' +
        '<button class="epx-heart" type="button" title="Favorite / unfavorite">' + HEART + '</button>' +
        img +
        '<span class="ph" style="align-items:center;justify-content:center;width:100%;height:100%;' + phStyle + '">' + GARMENT + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderList(container, list, emptyMsg) {
    if (!list.length) { container.innerHTML = '<div class="epx-muted">' + emptyMsg + '</div>'; return; }
    container.innerHTML = '<div class="epx-grid">' + list.map(cardHTML).join('') + '</div>';
    var cards = container.querySelectorAll('.epx-card');
    cards.forEach(function (card, i) {
      var s = list[i];
      card.querySelector('.epx-heart').addEventListener('click', function (e) { e.stopPropagation(); toggleFav(card, s); });
      card.querySelector('.epx-add').addEventListener('click', function (e) { e.stopPropagation(); addToCatalog(s); });
    });
  }

  function loadNewIn(search) {
    var body = $('epx-newin-body'); if (!body) return;
    var status = $('epx-status'); if (status) status.textContent = 'Searching S&S…';
    var url = '/api/ss/styles?limit=60' + (search ? '&search=' + encodeURIComponent(search) : '');
    fetch(url, { headers: hdr() })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          body.innerHTML = '<div class="epx-muted">' + esc((res.d && res.d.error) || 'Couldn’t reach the S&S catalog.') + '</div>';
          if (status) status.textContent = '';
          return;
        }
        var list = (res.d && res.d.styles) || [];
        if (status) status.textContent = res.d.total != null ? (res.d.total.toLocaleString() + ' in catalog' + (list.length < res.d.total ? ' · showing ' + list.length : '')) : '';
        renderList(body, list, search ? 'No S&S styles match “' + esc(search) + '”.' : 'No styles returned from S&S.');
      })
      .catch(function () { body.innerHTML = '<div class="epx-muted">Couldn’t reach the S&S catalog.</div>'; if (status) status.textContent = ''; });
  }

  function loadFavs() {
    var body = $('epx-favs'); if (!body) return;
    body.innerHTML = '<div class="epx-muted">Loading favorites…</div>';
    fetch('/api/ss/favorites', { headers: hdr() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.favorites) || [];
        setFavCount(list.length);
        renderList(body, list, 'No favorites yet. Open <b>New In</b> and tap the ♥ on any S&S product to save it here.');
      })
      .catch(function () { body.innerHTML = '<div class="epx-muted">Couldn’t load favorites.</div>'; });
  }

  function toggleFav(card, s) {
    var isFav = card.classList.contains('is-fav');
    if (isFav) {
      card.classList.remove('is-fav');
      fetch('/api/ss/favorites/' + encodeURIComponent(s.styleID), { method: 'DELETE', headers: hdr() })
        .then(function () { bumpFav(-1); if (card.closest('#epx-favs')) card.remove(); })
        .catch(function () { card.classList.add('is-fav'); });
    } else {
      card.classList.add('is-fav');
      fetch('/api/ss/favorites', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr()), body: JSON.stringify(s) })
        .then(function () { bumpFav(1); })
        .catch(function () { card.classList.remove('is-fav'); });
    }
  }

  var _favCount = 0;
  function setFavCount(n) { _favCount = n; var el = $('epx-fav-n'); if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; } }
  function bumpFav(d) { setFavCount(Math.max(0, _favCount + d)); }

  function addToCatalog(s) {
    if (typeof window.openNewProductModal === 'function') {
      try { window.openNewProductModal(); } catch (e) {}
      setTimeout(function () {
        var n = $('npm-name'); if (n && s.title) { n.value = s.title; if (typeof autoNpmSKU === 'function') { try { autoNpmSKU(); } catch (e) {} } }
      }, 250);
    }
  }

  function show(t) {
    if (!_tabs) return;
    if (t === 'create') {
      if (typeof window.openNewProductModal === 'function') { try { window.openNewProductModal(); } catch (e) {} }
      _tabs.querySelectorAll('.epx-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.t === 'catalog'); });
      return;
    }
    _tabs.querySelectorAll('.epx-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
    var isCat = (t === 'catalog');
    if (_header) _header.style.display = isCat ? '' : 'none';
    if (_grid) _grid.style.display = isCat ? '' : 'none';
    if (_newin) _newin.style.display = (t === 'newin') ? '' : 'none';
    if (_favs) _favs.style.display = (t === 'favorites') ? '' : 'none';
    if (t === 'newin' && !_newinLoaded) { _newinLoaded = true; loadNewIn(''); }
    if (t === 'favorites') loadFavs();
  }

  function init() {
    var sec = $('section-products'); _grid = $('op-prod-grid');
    if (!sec || !_grid) return;                 // not a board with the products section
    if (sec.querySelector('.epx-tabs')) return; // already enhanced
    injectCSS();

    _header = _grid.previousElementSibling;      // the board's search/filter + buttons row (capture BEFORE inserting)

    _tabs = document.createElement('div'); _tabs.className = 'epx-tabs';
    _tabs.innerHTML =
      '<button class="epx-tab on" data-t="newin">New In</button>' +
      '<button class="epx-tab" data-t="favorites">Favorites <span class="n" id="epx-fav-n" style="display:none"></span></button>' +
      '<button class="epx-tab" data-t="catalog">Catalog</button>' +
      '<button class="epx-tab" data-t="create">+ Create Product</button>';
    sec.insertBefore(_tabs, sec.firstChild);
    _tabs.addEventListener('click', function (e) { var b = e.target.closest('.epx-tab'); if (b) show(b.dataset.t); });

    // New In container (search + live S&S grid)
    _newin = document.createElement('div'); _newin.id = 'epx-newin';
    _newin.innerHTML =
      '<div class="epx-searchrow">' +
        '<input id="epx-search" type="search" placeholder="Search the S&amp;S catalog — brand, style, category…" autocomplete="off">' +
        '<span class="epx-status" id="epx-status"></span>' +
      '</div>' +
      '<div id="epx-newin-body"><div class="epx-muted">Loading S&amp;S catalog…</div></div>';
    _grid.parentNode.insertBefore(_newin, _grid);

    // Favorites container
    _favs = document.createElement('div'); _favs.id = 'epx-favs'; _favs.style.display = 'none';
    _favs.innerHTML = '<div class="epx-muted">Loading favorites…</div>';
    _grid.parentNode.insertBefore(_favs, _grid);

    // debounced live search
    var search = $('epx-search');
    search.addEventListener('input', function () {
      clearTimeout(_searchTimer);
      var v = search.value.trim();
      _searchTimer = setTimeout(function () { loadNewIn(v); }, 320);
    });

    // Default tab is New In, but defer the live S&S fetch until the section is
    // actually visible (so it never fires just from loading the board page).
    if ('IntersectionObserver' in window) {
      _io = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) {
          if (en.isIntersecting && !_newinLoaded && _newin.style.display !== 'none') { _newinLoaded = true; loadNewIn(''); _io.disconnect(); }
        });
      }, { threshold: 0.01 });
      _io.observe(_newin);
    }

    // prime the Favorites badge without loading the grid
    fetch('/api/ss/favorites', { headers: hdr() })
      .then(function (r) { return r.json(); })
      .then(function (d) { setFavCount(((d && d.favorites) || []).length); })
      .catch(function () {});

    show('newin');
  }

  window.EGProdTabs = { init: init, loadNewIn: loadNewIn, loadFavs: loadFavs };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 350); });
  else setTimeout(init, 350);
})();
