/* eg-scout.js — SHARED "Super Spy" product-research modal.
   Search Etsy LIVE (nothing is stored on our servers — the /api/etsy/search endpoint just
   proxies Etsy's public search), pick a product to sell (Make → hands off to the builder),
   or Save it to Favorites. Favorites are the seller's OWN client-side bookmarks (localStorage
   only), so we never persist Etsy data. ONE modal, shared by seller + admin: EGScout.open({role}).
   Monotone beige + dark-grey theme, one-word buttons. */
(function (g) {
  'use strict';
  if (typeof document === 'undefined' || g.EGScout) return;

  function tok() { try { return localStorage.getItem('eg_token') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ── Favorites: client-side only (the seller's bookmarks). No server, no Etsy data stored by us.
  var FAV_KEY = 'eg_scout_favs';
  function favLoad() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; } }
  function favSave(a) { try { localStorage.setItem(FAV_KEY, JSON.stringify(a || [])); } catch (e) {} }
  function favHas(id) { return favLoad().some(function (f) { return String(f.listing_id) === String(id); }); }
  function favToggle(l) {
    var a = favLoad();
    var idx = -1; for (var i = 0; i < a.length; i++) { if (String(a[i].listing_id) === String(l.listing_id)) { idx = i; break; } }
    if (idx >= 0) a.splice(idx, 1);
    else a.unshift({ listing_id: l.listing_id, title: l.title, image: l.image, price: l.price, url: l.url, num_favorers: l.num_favorers });
    favSave(a); updateFavCount(); return idx < 0;
  }
  function updateFavCount() { var e = document.getElementById('eg-scout-favn'); if (e) e.textContent = favLoad().length; }

  var CSS =
    '#eg-scout-ov{position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:9400;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
    '#eg-scout-ov.on{display:flex}' +
    '#eg-scout-panel{background:#fdfcfa;border:1px solid #e5e4e0;border-radius:18px;box-shadow:0 24px 70px rgba(17,24,39,.22);width:100%;max-width:1080px;height:88vh;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif}' +
    '#eg-scout-head{display:flex;align-items:center;gap:14px;padding:16px 22px;border-bottom:1px solid #ece9e3;flex-shrink:0}' +
    '#eg-scout-head h3{margin:0;font-size:18px;font-weight:750;color:#191918;letter-spacing:-.01em}' +
    '#eg-scout-head .sub{font-size:12.5px;color:#9ca3af;margin-top:1px}' +
    '#eg-scout-tabs{display:flex;gap:3px;background:#f4f2ef;border-radius:10px;padding:3px;margin-left:auto}' +
    '.eg-scout-tab{background:none;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:#6b7280;padding:6px 13px;border-radius:8px;transition:background .12s,color .12s}' +
    '.eg-scout-tab.on{background:#fff;color:#191918;box-shadow:0 1px 2px rgba(17,24,39,.08)}' +
    '.eg-scout-tab b{font-weight:750;margin-left:2px}' +
    '#eg-scout-x{background:none;border:none;cursor:pointer;color:#9ca3af;padding:7px;border-radius:9px;line-height:0;transition:background .12s,color .12s}' +
    '#eg-scout-x:hover{background:#f4f2ef;color:#191918}' +
    '#eg-scout-form{display:flex;gap:9px;padding:14px 22px;border-bottom:1px solid #ece9e3;flex-shrink:0}' +
    '#eg-scout-q{flex:1;border:1px solid #e5e4e0;border-radius:11px;padding:11px 14px;font-size:14px;font-family:inherit;color:#191918;outline:none;background:#fff;transition:border-color .14s,box-shadow .14s}' +
    '#eg-scout-q:focus{border-color:#191918;box-shadow:0 0 0 3px rgba(17,24,39,.06)}' +
    '#eg-scout-go{background:#191918;color:#fff;border:none;border-radius:11px;padding:11px 22px;font-size:14px;font-weight:650;cursor:pointer;font-family:inherit;transition:transform .12s,box-shadow .16s}' +
    '#eg-scout-go:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(17,24,39,.2)}' +
    '#eg-scout-grid{flex:1;overflow-y:auto;padding:18px 22px;display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:16px;align-content:start}' +
    '.eg-scout-empty{grid-column:1/-1;text-align:center;color:#9ca3af;font-size:14px;padding:60px 0;line-height:1.6}' +
    '.eg-scout-card{background:#fff;border:1px solid #e5e4e0;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .14s,box-shadow .14s,transform .08s}' +
    '.eg-scout-card:hover{border-color:#191918;box-shadow:0 4px 18px rgba(17,24,39,.1);transform:translateY(-1px)}' +
    '.eg-scout-img{aspect-ratio:1/1;min-height:172px;background:#f4f2ef;display:flex;align-items:center;justify-content:center;overflow:hidden;text-decoration:none}' +
    '.eg-scout-img img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.eg-scout-noimg{color:#c4c3be;font-size:12.5px}' +
    '.eg-scout-body{padding:12px 13px 13px;display:flex;flex-direction:column;gap:10px;flex:1}' +
    '.eg-scout-title{font-size:13px;color:#191918;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px}' +
    '.eg-scout-metrics{display:flex;gap:7px}' +
    '.eg-scout-pill{flex:1;background:#f7f6f4;border-radius:8px;padding:6px 8px;display:flex;flex-direction:column;line-height:1.15}' +
    '.eg-scout-pill b{font-size:14px;font-weight:750;color:#191918}' +
    '.eg-scout-pill i{font-size:10.5px;color:#9ca3af;font-style:normal;font-weight:600;letter-spacing:.02em;text-transform:uppercase;margin-top:1px}' +
    '.eg-scout-actions{display:flex;gap:8px;margin-top:auto}' +
    '.eg-scout-make{flex:1;background:#191918;color:#fff;border:none;border-radius:9px;padding:9px;font-size:13px;font-weight:650;cursor:pointer;font-family:inherit;transition:transform .1s,box-shadow .14s}' +
    '.eg-scout-make:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(17,24,39,.2)}' +
    '.eg-scout-save{flex-shrink:0;background:#fff;border:1px solid #e5e4e0;color:#374151;border-radius:9px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s,color .12s}' +
    '.eg-scout-save:hover{background:#f7f6f4}' +
    '.eg-scout-save.on{background:#191918;color:#fff;border-color:#191918}' +
    '#eg-scout-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#191918;color:#fff;font-size:13.5px;font-weight:600;padding:11px 18px;border-radius:11px;box-shadow:0 12px 32px rgba(17,24,39,.28);z-index:9600;opacity:0;transition:opacity .2s;pointer-events:none}' +
    '#eg-scout-toast.show{opacity:1}' +
    /* ── Page mode: rendered full-page via EGScout.mount(el) instead of the modal overlay ── */
    '.eg-scout-pagewrap{font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif}' +
    '.eg-scout-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:20px}' +
    '.eg-scout-pagewrap #eg-scout-form{flex:1;min-width:260px;display:flex;gap:9px;padding:0;border:none;background:none}' +
    '.eg-scout-pagewrap #eg-scout-grid{flex:none;overflow:visible;padding:0;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}' +
    '.eg-scout-pagewrap #eg-scout-tabs{margin-left:0}';

  var HTML =
    '<div id="eg-scout-panel" role="dialog" aria-modal="true" aria-label="Super Spy">' +
      '<div id="eg-scout-head">' +
        '<div><h3>Super Spy</h3><div class="sub">Spy what\'s selling on Etsy — live, nothing stored. Make it, or save it.</div></div>' +
        '<div id="eg-scout-tabs">' +
          '<button type="button" data-view="search" class="eg-scout-tab on">All</button>' +
          '<button type="button" data-view="favs" class="eg-scout-tab">Favorites<b id="eg-scout-favn">0</b></button>' +
        '</div>' +
        '<button id="eg-scout-x" type="button" aria-label="Close"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>' +
      '</div>' +
      '<form id="eg-scout-form" autocomplete="off">' +
        '<input id="eg-scout-q" type="text" placeholder="Search a niche, e.g. personalized pennant, custom apron…" autocomplete="off"/>' +
        '<button id="eg-scout-go" type="submit">Search</button>' +
      '</form>' +
      '<div id="eg-scout-grid"><div class="eg-scout-empty">Search a niche above to see what\'s selling on Etsy.</div></div>' +
    '</div>';

  // Page-mode markup (search bar + tabs + grid) — same element IDs as the modal so all the
  // search/favorites/render logic is shared verbatim. A page uses mount(); a modal uses open().
  var PAGE_HTML =
    '<div class="eg-scout-bar">' +
      '<form id="eg-scout-form" autocomplete="off">' +
        '<input id="eg-scout-q" type="text" placeholder="Search a niche, e.g. personalized pennant, custom apron…" autocomplete="off"/>' +
        '<button id="eg-scout-go" type="submit">Search</button>' +
      '</form>' +
      '<div id="eg-scout-tabs">' +
        '<button type="button" data-view="search" class="eg-scout-tab on">All</button>' +
        '<button type="button" data-view="favs" class="eg-scout-tab">Favorites<b id="eg-scout-favn">0</b></button>' +
      '</div>' +
    '</div>' +
    '<div id="eg-scout-grid"><div class="eg-scout-empty">Search a niche above to see what\'s selling on Etsy.</div></div>';

  var _injected = false, _role = 'seller', _last = [], _view = 'search';

  function inject() {
    if (_injected) return; _injected = true;
    if (!document.getElementById('eg-scout-css')) { var st = document.createElement('style'); st.id = 'eg-scout-css'; st.textContent = CSS; document.head.appendChild(st); }
    var ov = document.createElement('div'); ov.id = 'eg-scout-ov'; ov.innerHTML = HTML; document.body.appendChild(ov);
    var t = document.createElement('div'); t.id = 'eg-scout-toast'; document.body.appendChild(t);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('eg-scout-x').addEventListener('click', close);
    document.getElementById('eg-scout-form').addEventListener('submit', function (e) { e.preventDefault(); doSearch(); });
    Array.prototype.forEach.call(document.querySelectorAll('.eg-scout-tab'), function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
  }

  function toast(msg) {
    var t = document.getElementById('eg-scout-toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._to); t._to = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  function open(opts) {
    opts = opts || {}; _role = opts.role || 'seller';
    inject();
    updateFavCount();
    setView('search');
    document.getElementById('eg-scout-ov').classList.add('on');
    document.body.style.overflow = 'hidden';
    var i = document.getElementById('eg-scout-q'); if (i) setTimeout(function () { i.focus(); }, 60);
  }
  function close() { var ov = document.getElementById('eg-scout-ov'); if (ov) ov.classList.remove('on'); document.body.style.overflow = ''; }

  // Full-page mount: render the SAME engine into a page container (superspy.html) instead of the
  // modal overlay. Shared so admin reuses it without a rebuild. A page loads eg-scout.js and calls
  // EGScout.mount(el, {role}); it never opens the modal, so the fixed IDs never collide.
  function mount(el, opts) {
    opts = opts || {}; _role = opts.role || 'seller';
    if (!el) return;
    if (!document.getElementById('eg-scout-css')) { var st = document.createElement('style'); st.id = 'eg-scout-css'; st.textContent = CSS; document.head.appendChild(st); }
    if (!document.getElementById('eg-scout-toast')) { var t = document.createElement('div'); t.id = 'eg-scout-toast'; document.body.appendChild(t); }
    el.classList.add('eg-scout-pagewrap');
    el.innerHTML = PAGE_HTML;
    document.getElementById('eg-scout-form').addEventListener('submit', function (e) { e.preventDefault(); doSearch(); });
    Array.prototype.forEach.call(el.querySelectorAll('.eg-scout-tab'), function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
    updateFavCount();
    setView('search');
    var i = document.getElementById('eg-scout-q'); if (i) setTimeout(function () { i.focus(); }, 80);
  }

  function setView(v) {
    _view = v;
    Array.prototype.forEach.call(document.querySelectorAll('.eg-scout-tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-view') === v); });
    // Keep the search bar visible in BOTH views so the All/Favorites toggle never shifts position.
    if (v === 'favs') { renderFavorites(); }
    else {
      var grid = document.getElementById('eg-scout-grid');
      if (_last.length) render(_last);
      else grid.innerHTML = '<div class="eg-scout-empty">Search a niche above to see what\'s selling on Etsy.</div>';
    }
  }

  function doSearch() {
    var q = (document.getElementById('eg-scout-q').value || '').trim();
    if (!q) return;
    var grid = document.getElementById('eg-scout-grid');
    grid.innerHTML = '<div class="eg-scout-empty">Searching…</div>';
    fetch((g.EG_API_BASE || '') + '/api/etsy/search?q=' + encodeURIComponent(q) + '&limit=36', { headers: { Authorization: 'Bearer ' + tok() } })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (d && d.error) { grid.innerHTML = '<div class="eg-scout-empty">' + esc(d.error) + '</div>'; return; }
        _last = (d && d.results) || [];
        render(_last);
      })
      .catch(function () { grid.innerHTML = '<div class="eg-scout-empty">Search failed — check your connection and try again.</div>'; });
  }

  function cardHTML(l, i) {
    var img = l.image ? '<img src="' + esc(l.image) + '" alt="" loading="lazy"/>' : '<div class="eg-scout-noimg">No image</div>';
    var price = (l.price != null) ? ('$' + Number(l.price).toFixed(2)) : '—';
    var favs = (l.num_favorers || 0);
    var saved = favHas(l.listing_id);
    return '<div class="eg-scout-card">' +
      '<a class="eg-scout-img" href="' + esc(l.url || '#') + '" target="_blank" rel="noopener">' + img + '</a>' +
      '<div class="eg-scout-body">' +
        '<div class="eg-scout-title" title="' + esc(l.title || '') + '">' + esc(l.title || '') + '</div>' +
        '<div class="eg-scout-metrics">' +
          '<span class="eg-scout-pill"><b>' + price + '</b><i>Price</i></span>' +
          '<span class="eg-scout-pill"><b>' + favs + '</b><i>Favorites</i></span>' +
        '</div>' +
        '<div class="eg-scout-actions">' +
          '<button class="eg-scout-make" type="button" data-i="' + i + '">Make</button>' +
          '<button class="eg-scout-save' + (saved ? ' on' : '') + '" type="button" data-i="' + i + '">' + (saved ? 'Saved' : 'Save') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  function wireCards(grid, list) {
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-make'), function (b) { b.addEventListener('click', function () { _make(list[+b.getAttribute('data-i')]); }); });
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-save'), function (b) {
      b.addEventListener('click', function () {
        var l = list[+b.getAttribute('data-i')]; var on = favToggle(l);
        b.classList.toggle('on', on); b.textContent = on ? 'Saved' : 'Save';
        if (_view === 'favs' && !on) renderFavorites();   // removing from the Favorites view drops the card
      });
    });
  }
  function render(results) {
    var grid = document.getElementById('eg-scout-grid');
    if (!results.length) { grid.innerHTML = '<div class="eg-scout-empty">No results — try a different niche.</div>'; return; }
    grid.innerHTML = results.map(function (l, i) { return cardHTML(l, i); }).join('');
    wireCards(grid, results);
  }
  function renderFavorites() {
    var grid = document.getElementById('eg-scout-grid');
    var favs = favLoad();
    if (!favs.length) { grid.innerHTML = '<div class="eg-scout-empty">No favorites yet.<br>Search, then Save the products you want to sell.</div>'; return; }
    grid.innerHTML = favs.map(function (l, i) { return cardHTML(l, i); }).join('');
    wireCards(grid, favs);
  }

  // Make = start turning this idea into a real product. Hands off to the EXISTING design-maker
  // (no change to its flow): we drop a scout context in sessionStorage and open it with ?scout=1;
  // a small guarded hook there pre-fills the listing title/description (via the seller's own AI key
  // if set) and shows the Etsy image as a removable reference. A page may override EGScout.onMake.
  function _make(listing) {
    if (!listing) return;
    if (typeof g.EGScout.onMake === 'function') { g.EGScout.onMake(listing, _role); return; }
    try {
      sessionStorage.setItem('eg_scout_ctx', JSON.stringify({
        title: listing.title || '', description: listing.description || '', tags: listing.tags || [],
        image: listing.image || '', url: listing.url || '', price: (listing.price != null ? listing.price : null), role: _role
      }));
    } catch (e) {}
    toast('Opening the builder…');
    setTimeout(function () { location.href = 'design-maker.html?scout=1'; }, 220);
  }

  g.EGScout = { open: open, close: close, mount: mount, onMake: null };
})(window);
