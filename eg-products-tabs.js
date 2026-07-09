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
      /* right-hand action cluster: Export · Import · +Create, pushed to the far edge */
      ".epx-tabspacer{margin-left:auto}" +
      ".epx-tab .n{font-size:10px;min-width:16px;height:16px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;background:#2f4bf0;color:#fff;border-radius:9px;font-variant-numeric:tabular-nums}" +
      ".epx-tab.on .n{background:#fff;color:#191918}" +
      /* Export / Import buttons that live in the tabs row (lighter than the tabs) */
      ".epx-io{font-family:" + mono + ";font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;padding:9px 13px;border:1.5px solid #191918;background:#fff;color:#191918;cursor:pointer;border-radius:0;display:inline-flex;align-items:center;gap:6px;transition:background .12s,color .12s}" +
      ".epx-io:hover{background:#191918;color:#fff}" +
      /* re-theme the board's own Catalog search + selects (they carry inline soft styles) */
      "#op-prod-search{background:#fff!important;border:1.5px solid #191918!important;border-radius:0!important;box-shadow:2px 2px 0 #191918;width:240px!important}" +
      "#op-prod-cat,#op-prod-status{border:1.5px solid #191918!important;border-radius:0!important;background:#fff!important;font-family:" + mono + "!important;text-transform:uppercase;font-size:11px!important;letter-spacing:.04em;padding:7px 26px 7px 11px!important}" +
      /* Catalog grid: big image-on-top cards, 4 per row (3 / 2 on narrower).
         align-items:stretch so every card in a row fills to the tallest. */
      "#op-prod-grid{grid-template-columns:repeat(4,1fr)!important;gap:18px!important;align-items:stretch!important}" +
      "@media (max-width:1100px){#op-prod-grid{grid-template-columns:repeat(3,1fr)!important}}" +
      "@media (max-width:760px){#op-prod-grid{grid-template-columns:repeat(2,1fr)!important}}" +
      "#op-prod-grid>.card{height:100%}" +
      "#op-prod-grid .op-prod-name{min-height:2.5em}" +
      /* New In / Favorites search row */
      ".epx-searchrow{display:flex;align-items:center;gap:13px;margin-bottom:15px;flex-wrap:wrap}" +
      "#epx-search{flex:1;min-width:220px;max-width:460px;background:#fff;border:1.5px solid #191918;border-radius:0;padding:9px 13px;font-size:13.5px;font-family:inherit;color:#191918;outline:none;box-shadow:2px 2px 0 #191918}" +
      "#epx-search:focus{border-color:#2f4bf0;box-shadow:2px 2px 0 #2f4bf0}" +
      ".epx-status{font-family:" + mono + ";font-size:11px;color:#6b7280;white-space:nowrap}" +
      /* card grid — BIG cards, image on TOP (4 per row, ~18px gap) */
      ".epx-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}" +
      "@media (max-width:1100px){.epx-grid{grid-template-columns:repeat(3,1fr)}}" +
      "@media (max-width:760px){.epx-grid{grid-template-columns:repeat(2,1fr)}}" +
      ".epx-card{display:flex;flex-direction:column;border:1.5px solid #191918;background:#fff;border-radius:0;overflow:hidden;transition:box-shadow .14s ease,transform .14s ease}" +
      ".epx-card:hover{box-shadow:5px 5px 0 #191918;transform:translate(-1px,-1px)}" +
      ".epx-card .b{flex:1;min-width:0;padding:12px 13px 13px;display:flex;flex-direction:column;gap:4px}" +
      ".epx-card .nm{font-size:13.5px;font-weight:700;line-height:1.25;color:#191918;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}" +
      ".epx-card .mt{font-family:" + mono + ";font-size:10.5px;color:#6b7280;line-height:1.4}" +
      ".epx-swatches{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px}" +
      ".epx-swatches .sw{width:15px;height:15px;border-radius:4px;border:1px solid rgba(0,0,0,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);flex:0 0 auto}" +
      ".epx-card .cardfoot{margin-top:auto;padding-top:10px}" +
      ".epx-add{border:1.5px solid #191918;background:#fff;color:#191918;font-family:" + mono + ";font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;padding:8px 11px;cursor:pointer;border-radius:0;transition:background .12s,color .12s;width:100%}" +
      ".epx-add:hover{background:#2f4bf0;color:#fff;border-color:#2f4bf0}" +
      ".epx-card .img{position:relative;aspect-ratio:1/1;background:#f7f5f0;border-bottom:1.5px solid #191918;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:12px}" +
      ".epx-card .img>img{width:100%;height:100%;object-fit:contain}" +
      ".epx-card .img .ph svg{width:56px;height:56px;opacity:.6}" +
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
      "html[data-theme=dark] .epx-card .img{background:#252220;border-bottom-color:#c9c3ba}" +
      "html[data-theme=dark] .epx-add{background:transparent;border-color:#c9c3ba;color:#c9c3ba}" +
      "html[data-theme=dark] .epx-io{background:transparent;border-color:#c9c3ba;color:#c9c3ba}" +
      "html[data-theme=dark] .epx-io:hover{background:#c9c3ba;color:#191918}" +
      "html[data-theme=dark] #epx-search{background:transparent;border-color:#c9c3ba;color:#ece8e1;box-shadow:2px 2px 0 #c9c3ba}" +
      "html[data-theme=dark] .epx-heart{background:rgba(37,34,32,.9);border-color:#3a3631}";
    document.head.appendChild(st);
  }

  var _tabs, _newin, _favs, _grid, _header, _searchTimer, _newinLoaded = false, _io;

  // ── S&S New-In image resolution ────────────────────────────────────────────
  // The styles feed's `styleImage` is frequently null/unusable, so many New In
  // cards would render blank. The PRODUCT image (`colorFrontImage`) DOES work and
  // is returned by GET /api/ss/style/:id as { image }. So: keep styleImage as the
  // fast path when present; otherwise (or if the <img> errors) LAZY-load the real
  // image only when the card scrolls into view, via an IntersectionObserver, with
  // the fetches THROTTLED to a few at a time and results cached by styleID so
  // re-renders / re-scrolls never refetch.
  // Resolved images are cached by styleID AND persisted to localStorage (24h) so a REFRESH
  // hydrates the grid INSTANTLY instead of re-fetching every card. '' = tried, no image.
  var _IMGCACHE_KEY = 'eg_ss_imgcache', _IMGCACHE_TTL = 24 * 3600 * 1000, _saveT = null;
  function _loadImgCache() {
    try { var raw = JSON.parse(localStorage.getItem(_IMGCACHE_KEY) || '{}');
      if (raw && raw.at && (Date.now() - raw.at) < _IMGCACHE_TTL && raw.map) return raw.map; } catch (e) {}
    return {};
  }
  function _saveImgCache() {   // throttled — coalesce a burst of resolves into one write
    if (_saveT) return;
    _saveT = setTimeout(function () { _saveT = null;
      try { localStorage.setItem(_IMGCACHE_KEY, JSON.stringify({ at: Date.now(), map: _imgCache })); } catch (e) {}
    }, 800);
  }
  var _imgCache = _loadImgCache();   // styleID -> resolved URL ('' = tried, no image found)
  var _imgIO = null;         // IntersectionObserver watching the .img containers
  var _imgQueue = [];        // pending styleIDs to resolve (each with its DOM node)
  var _imgActive = 0;        // in-flight fetch count
  var IMG_MAX = 3;           // concurrent /api/ss/style/:id requests

  function _applyResolvedImg(imgWrap, url) {
    if (!imgWrap || !url) return;
    var existing = imgWrap.querySelector('img');
    if (existing) { existing.src = url; existing.style.display = ''; }
    else {
      var im = document.createElement('img');
      im.alt = ''; im.loading = 'lazy'; im.src = url;
      // Insert before the placeholder so object-fit styling applies.
      var ph = imgWrap.querySelector('.ph');
      imgWrap.insertBefore(im, ph || null);
    }
    var ph = imgWrap.querySelector('.ph');
    if (ph) ph.style.display = 'none';
  }

  function _imgPump() {
    while (_imgActive < IMG_MAX && _imgQueue.length) {
      var job = _imgQueue.shift();
      var sid = job.id, wrap = job.wrap;
      // Skip if this node was already resolved by a cached hit.
      if (_imgCache[sid]) { _applyResolvedImg(wrap, _imgCache[sid]); continue; }
      if (_imgCache[sid] === '') continue;   // known-empty, don't refetch
      _imgActive++;
      (function (sid, wrap) {
        fetch('/api/ss/style/' + encodeURIComponent(sid), { headers: hdr() })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            var url = (d && d.image) || '';
            _imgCache[sid] = url;                       // cache result (even '' = tried)
            _saveImgCache();                            // persist so a refresh is instant
            if (url) _applyResolvedImg(wrap, url);
          })
          .catch(function () { /* leave placeholder; don't cache so a later scroll can retry */ })
          .then(function () { _imgActive--; _imgPump(); });
      })(sid, wrap);
    }
  }

  function _ensureImgIO() {
    if (_imgIO || !('IntersectionObserver' in window)) return _imgIO;
    _imgIO = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        var wrap = en.target;
        _imgIO.unobserve(wrap);                         // resolve each card at most once
        var sid = wrap.getAttribute('data-sid');
        if (!sid) return;
        var cached = _imgCache[sid];
        if (cached) { _applyResolvedImg(wrap, cached); return; }   // instant on re-render
        if (cached === '') return;                       // known no-image
        _imgQueue.push({ id: sid, wrap: wrap });
        _imgPump();
      });
    }, { rootMargin: '200px 0px', threshold: 0.01 });
    return _imgIO;
  }

  // Wire lazy image resolution for every card in `container` that lacks a usable
  // styleImage (or already has one cached). Called after each renderList().
  function _observeCardImages(container) {
    var io = _ensureImgIO();
    container.querySelectorAll('.epx-card .img[data-needs-img="1"]').forEach(function (wrap) {
      var sid = wrap.getAttribute('data-sid');
      if (sid && _imgCache[sid]) { _applyResolvedImg(wrap, _imgCache[sid]); return; }  // cache hit — no observe
      if (sid && _imgCache[sid] === '') return;
      if (io) io.observe(wrap);
      else if (sid) { _imgQueue.push({ id: sid, wrap: wrap }); _imgPump(); }  // no IO support → resolve eagerly
    });
  }

  // Colour-name → hex for New In swatches (mirrors eg-products.js OP_COLOR_HEX).
  var _COLOR_HEX = {
    white:'#ffffff','off white':'#f6f5f2',natural:'#efe9dc',ivory:'#f4efe3',cream:'#f2ebd8',bone:'#eae4d6',
    black:'#191918','jet black':'#191918',navy:'#1e293b','navy blue':'#1e293b',midnight:'#111827',
    'heather gray':'#9ca3af','heather grey':'#9ca3af',gray:'#9ca3af',grey:'#9ca3af','sport grey':'#a8a8a3',silver:'#c8c8c4',ash:'#d7d4cc',
    charcoal:'#40403d','dark heather':'#4b4b48',graphite:'#3a3a37',slate:'#475569',
    red:'#dc2626',cardinal:'#b91c1c',cherry:'#c81e1e',maroon:'#7f1d1d',burgundy:'#6d1f2b',
    'royal blue':'#2f4bf0',royal:'#2f4bf0',blue:'#2563eb','light blue':'#93c5fd','carolina blue':'#93c5fd',sky:'#7dd3fc',teal:'#0d9488',turquoise:'#14b8a6',
    green:'#166534','forest green':'#166534','kelly green':'#15803d','military green':'#4b5320',olive:'#556b2f',mint:'#a7f3d0',sage:'#9caf88',
    purple:'#7c3aed',violet:'#8b5cf6',lavender:'#c4b5fd',
    pink:'#ec4899','light pink':'#f9a8d4','hot pink':'#db2777',rose:'#f43f5e',coral:'#fb7185',
    orange:'#ea580c','burnt orange':'#c2410c',rust:'#b45309',
    yellow:'#eab308',gold:'#d4a017',mustard:'#ca8a04',
    brown:'#78350f',chocolate:'#5b3a1e',tan:'#c8a97e',khaki:'#b8a271',sand:'#d8c7a3',beige:'#e0d5bf',
    denim:'#4a6a8a',indigo:'#3730a3',cobalt:'#1d4ed8'
  };
  function _colorHex(name) {
    var k = String(name || '').trim().toLowerCase(); if (!k) return null;
    if (_COLOR_HEX[k]) return _COLOR_HEX[k];
    for (var key in _COLOR_HEX) { if (k.indexOf(key) !== -1) return _COLOR_HEX[key]; }
    return '#c4c0b8';
  }
  // New In styles sometimes carry a `colors` array; render up to 6 swatches when present.
  function _swatchRow(s) {
    var list = Array.isArray(s.colors) ? s.colors : [];
    if (!list.length) return '';
    var seen = {}, out = [];
    for (var i = 0; i < list.length && out.length < 6; i++) {
      var nm = String(list[i] || '').trim(); if (!nm) continue;
      var lk = nm.toLowerCase(); if (seen[lk]) continue; seen[lk] = 1;
      out.push('<span class="sw" title="' + esc(nm) + '" style="background:' + _colorHex(nm) + '"></span>');
    }
    return out.length ? '<div class="epx-swatches">' + out.join('') + '</div>' : '';
  }

  function cardHTML(s) {
    // Fast path: use styleImage when present. On load-error (or when it's missing),
    // fall through to lazy-loading the real colorFrontImage via /api/ss/style/:id;
    // the placeholder shows meanwhile. onerror flips the container to needs-img so
    // the IntersectionObserver picks it up on the next _observeCardImages pass.
    var hasImg = !!s.image;
    var img = hasImg
      ? '<img src="' + esc(s.image) + '" alt="" loading="lazy" onerror="this.onerror=null;this.style.display=\'none\';var im=this.parentNode;im.setAttribute(\'data-needs-img\',\'1\');var p=im.querySelector(\'.ph\');if(p)p.style.display=\'flex\';if(window.EGProdTabs&&window.EGProdTabs._reresolve)window.EGProdTabs._reresolve(im)">'
      : '';
    var phStyle = hasImg ? 'display:none' : 'display:flex';
    // Mark cards WITHOUT a fast-path image so the observer lazy-loads them.
    var needsAttr = hasImg ? '' : ' data-needs-img="1"';
    var meta = [esc(s.brand || ''), s.category ? esc(s.category) : ''].filter(Boolean).join(' · ');
    return '<div class="epx-card' + (s.favorited ? ' is-fav' : '') + '" data-id="' + esc(s.styleID) + '">' +
      '<div class="img" data-sid="' + esc(s.styleID) + '"' + needsAttr + '>' +
        '<button class="epx-heart" type="button" title="Favorite / unfavorite">' + HEART + '</button>' +
        img +
        '<span class="ph" style="align-items:center;justify-content:center;width:100%;height:100%;' + phStyle + '">' + GARMENT + '</span>' +
      '</div>' +
      '<div class="b">' +
        '<div class="nm">' + esc(s.title || ('Style ' + s.styleID)) + '</div>' +
        '<div class="mt">' + (meta || ('Style ' + esc(s.styleID))) + '</div>' +
        (meta ? '<div class="mt">Style ' + esc(s.styleID) + '</div>' : '') +
        _swatchRow(s) +
        '<div class="cardfoot"><button class="epx-add" type="button">+ Add to catalog</button></div>' +
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
    // Lazy-load real product images for cards without a usable styleImage.
    _observeCardImages(container);
  }

  // Called from an <img> onerror (styleImage 404'd): the container was just flagged
  // needs-img, so hand it to the observer to lazy-load the real colorFrontImage.
  function _reresolve(imgWrap) {
    if (!imgWrap) return;
    var sid = imgWrap.getAttribute('data-sid');
    if (!sid) return;
    if (_imgCache[sid]) { _applyResolvedImg(imgWrap, _imgCache[sid]); return; }
    if (_imgCache[sid] === '') return;
    var io = _ensureImgIO();
    if (io) io.observe(imgWrap);
    else { _imgQueue.push({ id: sid, wrap: imgWrap }); _imgPump(); }
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

  function _setVal(id, v) { var e = $(id); if (e && v != null && v !== '') { e.value = v; return true; } return false; }

  function _prefillFromStyle(d) {
    if (!d) return;
    _setVal('npm-name', d.title);
    _setVal('npm-notes', d.description);
    if (d.price != null && d.price !== '') _setVal('npm-price', d.price);
    var colors = Array.isArray(d.colors) ? d.colors.join(', ') : '';
    var sizes = Array.isArray(d.sizes) ? d.sizes.join(', ') : '';
    _setVal('npm-bulk-colors', colors);
    _setVal('npm-bulk-sizes', sizes);
    // Build the variant rows from the bulk color/size fields (clears them afterward).
    if ((colors || sizes) && typeof window.npmBulkGenerate === 'function') { try { window.npmBulkGenerate(); } catch (e) {} }
    if (d.image && typeof window.npmPaSetImage === 'function') { try { window.npmPaSetImage(d.image); } catch (e) {} }
    if (typeof window.autoNpmSKU === 'function') { try { window.autoNpmSKU(); } catch (e) {} }
  }

  function addToCatalog(s) {
    if (typeof window.openNewProductModal !== 'function') return;
    try { window.openNewProductModal(); } catch (e) {}
    // Prefill the name immediately (feels instant), then enrich from the live S&S style.
    setTimeout(function () {
      var n = $('npm-name'); if (n && s.title) { n.value = s.title; if (typeof window.autoNpmSKU === 'function') { try { window.autoNpmSKU(); } catch (e) {} } }
    }, 250);
    if (!s || !s.styleID) return;
    fetch('/api/ss/style/' + encodeURIComponent(s.styleID), { headers: hdr() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || d.error) { if (d && d.title == null) return; }
        // Merge in the card's own title/image as sensible fallbacks.
        if (d) {
          if (!d.title) d.title = s.title;
          if (!d.image) d.image = s.image;
          _prefillFromStyle(d);
        }
      })
      .catch(function () {});
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
    // Restore display:grid (NOT '') — the grid's inline style is "display:grid;…", so
    // setting it to '' would wipe display entirely and the grid falls back to block
    // (this was the "catalog cards stretched full-width" bug).
    if (_grid) _grid.style.display = isCat ? 'grid' : 'none';
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

    // Export / Import were previously a separate toolbar button-group below the
    // search box; they now live in the tabs row, to the LEFT of "+ Create
    // Product" (grouped on the right via .epx-tabspacer on the Catalog tab).
    _tabs = document.createElement('div'); _tabs.className = 'epx-tabs';
    _tabs.innerHTML =
      '<button class="epx-tab on" data-t="newin">New In</button>' +
      '<button class="epx-tab" data-t="favorites">Favorites <span class="n" id="epx-fav-n" style="display:none"></span></button>' +
      '<button class="epx-tab" data-t="catalog">Catalog</button>' +
      '<button class="epx-io epx-tabspacer" type="button" id="epx-export" title="Export catalog CSV">↑ Export</button>' +
      '<button class="epx-io" type="button" id="epx-import" title="Import catalog CSV">↓ Import</button>' +
      '<input type="file" id="epx-import-file" accept=".csv" style="display:none">' +
      '<button class="epx-tab" data-t="create">+ Create Product</button>';
    sec.insertBefore(_tabs, sec.firstChild);
    _tabs.addEventListener('click', function (e) { var b = e.target.closest('.epx-tab'); if (b) show(b.dataset.t); });
    // Wire Export / Import to the same handlers the old toolbar buttons used.
    var _exp = $('epx-export');
    if (_exp) _exp.addEventListener('click', function () { try { window.EGCatalogIO && window.EGCatalogIO.exportProducts(); } catch (e) {} });
    var _imp = $('epx-import'), _impFile = $('epx-import-file');
    if (_imp && _impFile) {
      _imp.addEventListener('click', function () { _impFile.click(); });
      _impFile.addEventListener('change', function () {
        if (this.files && this.files[0]) { try { window.EGCatalogIO && window.EGCatalogIO.importProducts(this.files[0]); } catch (e) {} this.value = ''; }
      });
    }

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

  window.EGProdTabs = { init: init, loadNewIn: loadNewIn, loadFavs: loadFavs, _reresolve: _reresolve };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 350); });
  else setTimeout(init, 350);
})();
