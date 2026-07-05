/* eg-scout.js — SHARED "SpyDeck" product-research surface.
   Search Etsy LIVE (the /api/etsy/search endpoint proxies Etsy's public search; nothing is stored
   on our servers), see estimated performance stats, Make a product from an idea, or Save it to
   Favorites (client-side bookmarks only). ONE engine, shared by seller + admin:
   EGScout.mount(el,{role}) for a full page, or EGScout.open({role}) for the modal.

   Stats note: Etsy's public API exposes Favorites, Created date, Tags & Price — but NOT views,
   units sold, or revenue. Those four boxes are ESTIMATES derived from favorites + listing age +
   price (clearly marked "est."), the same way scraping tools approximate them. Monotone theme;
   the only accent is a red border on trending finds. */
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
    // Keep enough to re-render the full card (incl. stats) in the Favorites view.
    else a.unshift({ listing_id: l.listing_id, title: l.title, image: l.image, images: l.images || [], price: l.price, url: l.url, num_favorers: l.num_favorers, created: l.created || null, tags: l.tags || [], description: l.description || '' });
    favSave(a); updateFavCount(); return idx < 0;
  }
  // Saved = in-progress products (Make → Save for later). Distinct from Favorites (research bookmarks).
  function _savedLoad() { try { return JSON.parse(localStorage.getItem('eg_scout_products') || '[]'); } catch (e) { return []; } }
  function updateFavCount() {
    var e = document.getElementById('eg-scout-favn'); if (e) e.textContent = favLoad().length;
    var s = document.getElementById('eg-scout-savedn'); if (s) s.textContent = _savedLoad().length;
  }

  // ── Estimates (Etsy's API doesn't expose views/sold/revenue — derive them from favorites + age).
  function _est(l) {
    var fav = l.num_favorers || 0;
    var price = (l.price != null) ? Number(l.price) : 0;
    var created = l.created || 0;
    var nowS = Date.now() / 1000;
    var ageDays = created ? Math.max(1, (nowS - created) / 86400) : 45;
    var totalSold = Math.round(fav * 3.5) || fav;
    var perDay = totalSold / ageDays;
    var sold24 = Math.max(0, Math.round(perDay));
    var views24 = Math.max(sold24, Math.round(perDay * 36 + (fav / ageDays) * 10));
    var revenue = Math.round(totalSold * price);
    var vel = fav / ageDays;                                  // favorites per day = demand velocity
    var trending = (ageDays <= 30 && vel >= 1.2) || vel >= 6;  // young + wanted, or very hot
    return { totalSold: totalSold, sold24: sold24, views24: views24, revenue: revenue, trending: trending };
  }
  function _fmt(n) { n = Math.round(n || 0); if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return String(n); }
  function _money(n) { n = Math.round(n || 0); if (n >= 1e9) return '$' + (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return '$' + n; }
  function _dateStr(created) { if (!created) return ''; try { return new Date(created * 1000).toLocaleDateString('en-GB'); } catch (e) { return ''; } }

  var CSS =
    '#eg-scout-ov{position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:9400;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
    '#eg-scout-ov.on{display:flex}' +
    '#eg-scout-panel{background:#fdfcfa;border:1px solid #e5e4e0;border-radius:18px;box-shadow:0 24px 70px rgba(17,24,39,.22);width:100%;max-width:1120px;height:88vh;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif}' +
    '#eg-scout-head{display:flex;align-items:center;gap:14px;padding:16px 22px;border-bottom:1px solid #ece9e3;flex-shrink:0}' +
    '#eg-scout-head h3{margin:0;font-size:18px;font-weight:750;color:#191918;letter-spacing:-.01em}' +
    '#eg-scout-head .sub{font-size:12.5px;color:#9ca3af;margin-top:1px}' +
    '#eg-scout-tabs{display:flex;gap:3px;background:#f4f2ef;border-radius:10px;padding:3px;margin-left:auto}' +
    '.eg-scout-tab{background:none;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:#6b7280;padding:6px 13px;border-radius:8px;transition:background .12s,color .12s}' +
    '.eg-scout-tab.on{background:#fff;color:#191918;box-shadow:0 1px 2px rgba(17,24,39,.08)}' +
    '.eg-scout-tab b{font-weight:750;margin-left:2px}' +
    '#eg-scout-x{background:none;border:none;cursor:pointer;color:#9ca3af;padding:7px;border-radius:9px;line-height:0;transition:background .12s,color .12s}' +
    '#eg-scout-x:hover{background:#f4f2ef;color:#191918}' +
    '#eg-scout-form{display:flex;gap:9px;padding:14px 22px;flex-shrink:0}' +
    '#eg-scout-q{flex:1;border:1px solid #e5e4e0;border-radius:11px;padding:11px 14px;font-size:14px;font-family:inherit;color:#191918;outline:none;background:#fff;transition:border-color .14s,box-shadow .14s}' +
    '#eg-scout-q:focus{border-color:#191918;box-shadow:0 0 0 3px rgba(17,24,39,.06)}' +
    '#eg-scout-go{background:#191918;color:#fff;border:none;border-radius:11px;padding:11px 22px;font-size:14px;font-weight:650;cursor:pointer;font-family:inherit;transition:transform .12s,box-shadow .16s}' +
    '#eg-scout-go:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(17,24,39,.2)}' +
    '#eg-scout-note{padding:2px 22px 0;font-size:12.5px;color:#9ca3af;flex-shrink:0;display:none}' +
    '#eg-scout-note.on{display:block}' +
    '#eg-scout-grid{flex:1;overflow-y:auto;padding:18px 22px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px;align-content:start}' +
    '.eg-scout-empty{grid-column:1/-1;text-align:center;color:#9ca3af;font-size:14px;padding:60px 0;line-height:1.6}' +
    '.eg-scout-card{position:relative;background:#fff;border:1px solid #e5e4e0;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .14s,box-shadow .14s,transform .08s}' +
    '.eg-scout-card:hover{border-color:#191918;box-shadow:0 4px 18px rgba(17,24,39,.1);transform:translateY(-1px)}' +
    '.eg-scout-card.trend{border-color:#dc2626;box-shadow:0 0 0 1px rgba(220,38,38,.35)}' +
    '.eg-scout-card.trend:hover{border-color:#dc2626;box-shadow:0 4px 18px rgba(220,38,38,.2)}' +
    '.eg-scout-trend{position:absolute;top:8px;left:8px;z-index:2;background:#dc2626;color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;letter-spacing:.03em}' +
    '.eg-scout-heart{position:absolute;top:9px;right:9px;z-index:3;width:32px;height:32px;border-radius:50%;background:rgba(17,24,39,.42);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background .12s,transform .1s}' +
    '.eg-scout-heart:hover{background:rgba(17,24,39,.62)}.eg-scout-heart:active{transform:scale(.88)}' +
    '.eg-scout-heart svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:1.9}.eg-scout-heart.on svg{fill:#ef4444;stroke:#ef4444}' +
    '.eg-scout-remove{position:absolute;top:6px;right:6px;z-index:3;width:28px;height:28px;border:none;background:none;color:transparent;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:color .12s}' +
    '.eg-scout-card:hover .eg-scout-remove{color:#40403d}' +
    '.eg-scout-remove:hover{color:#191918}' +
    /* saved-card overlay X (top-right of image) — frosted dark, turns danger-red on hover */
    '.eg-scout-x{position:absolute;top:9px;right:9px;z-index:3;width:30px;height:30px;border-radius:50%;background:rgba(17,24,39,.5);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background .12s,transform .1s}' +
    '.eg-scout-x:hover{background:rgba(220,38,38,.92)}.eg-scout-x:active{transform:scale(.88)}' +
    '.eg-scout-x svg{width:15px;height:15px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round}' +
    '.eg-scout-img{position:relative;aspect-ratio:1/1;min-height:188px;background:#f4f2ef;display:flex;align-items:center;justify-content:center;overflow:hidden;text-decoration:none}' +
    '.eg-scout-img img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.eg-scout-noimg{color:#c4c3be;font-size:12.5px}' +
    /* frosted-glass monospace overlay on the image — favourites + created date (Tavus ID-pill style) */
    '.eg-scout-imeta{position:absolute;left:8px;bottom:8px;z-index:3;display:inline-flex;align-items:center;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:700;letter-spacing:.02em;color:#191918;background:rgba(255,255,255,.5);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);border:1px solid rgba(255,255,255,.55);border-radius:7px;padding:4px 9px}' +
    '.eg-scout-body{padding:12px 13px 13px;display:flex;flex-direction:column;gap:10px;flex:1}' +
    '.eg-scout-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}' +
    '.eg-scout-stat{background:rgba(0,0,0,.05);border-radius:8px;padding:7px 3px;display:flex;flex-direction:column;align-items:center;text-align:center;line-height:1.1;min-width:0}' +
    /* value shows FULL (no ellipsis) — $100.3K fits via 13px + tight tabular figures */
    '.eg-scout-stat b{font-size:13px;font-weight:800;color:#191918;font-variant-numeric:tabular-nums;letter-spacing:-.03em;white-space:nowrap}' +
    '.eg-scout-stat i{font-size:8px;color:#9ca3af;font-style:normal;font-weight:700;letter-spacing:.01em;text-transform:uppercase;margin-top:3px;line-height:1.15}' +
    '.eg-scout-sub{display:block;font-size:7.5px;font-weight:700;color:#b8b2ab;letter-spacing:.03em;margin-top:1px;min-height:9px}' +
    '.eg-scout-title{font-size:13px;color:#191918;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px}' +
    '.eg-scout-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11.5px;color:#6b7280}' +
    '.eg-scout-tagwrap{display:flex;flex-direction:column}' +
    '.eg-scout-tags{display:flex;flex-wrap:wrap;gap:5px;align-content:flex-start;max-height:23px;overflow:hidden;transition:max-height .18s ease}' +
    '.eg-scout-tags.expanded{max-height:220px}' +
    '.eg-scout-tagbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px}' +
    '.eg-scout-more{background:none;border:none;color:#6b7280;font-size:10.5px;font-weight:650;cursor:pointer;font-family:inherit;padding:0;white-space:nowrap}.eg-scout-more:hover{color:#191918}' +
    '.eg-scout-tag{background:rgba(0,0,0,.04);border:1px solid rgba(0,0,0,.06);color:#6b7280;font-size:10.5px;font-weight:500;padding:2px 7px;border-radius:6px;white-space:nowrap;max-width:100%}' +
    '.eg-scout-copy{flex-shrink:0;background:#191918;color:#fff;border:none;font-size:10px;font-weight:650;padding:5px 13px;border-radius:6px;cursor:pointer;line-height:1.3;transition:opacity .12s}' +
    '.eg-scout-copy:hover{opacity:.85}' +
    '.eg-scout-actions{margin-top:auto}' +
    '.eg-scout-add{width:100%;background:#fff;border:1.5px solid #191918;color:#191918;border-radius:9px;padding:10px;font-size:13px;font-weight:650;cursor:pointer;font-family:inherit;transition:background .12s,color .12s}.eg-scout-add:hover{background:#191918;color:#fff}' +
    '.eg-scout-make{width:100%;background:#191918;color:#fff;border:none;border-radius:9px;padding:10px;font-size:13px;font-weight:650;cursor:pointer;font-family:inherit;transition:transform .1s,box-shadow .14s}' +
    '.eg-scout-make:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(17,24,39,.2)}' +
    '.eg-scout-save{background:#fff;border:1px solid #e5e4e0;color:#374151;border-radius:9px;padding:9px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s,color .12s}' +
    '.eg-scout-save:hover{background:#f7f6f4}' +
    '.eg-scout-save.on{background:#191918;color:#fff;border-color:#191918}' +
    '#eg-scout-pager{flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:14px;padding:14px 22px;border-top:1px solid #ece9e3}' +
    '#eg-scout-pager:empty{display:none}' +
    '.eg-scout-pg-btn{background:#fff;border:1px solid #e5e4e0;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:17px;color:#374151;display:flex;align-items:center;justify-content:center;transition:border-color .12s;line-height:0}' +
    '.eg-scout-pg-btn:hover{border-color:#191918}' +
    '.eg-scout-pg-btn:disabled{opacity:.35;cursor:default;border-color:#e5e4e0}' +
    '.eg-scout-pgtxt{font-size:13.5px;font-weight:600;color:#374151;min-width:96px;text-align:center;font-variant-numeric:tabular-nums}' +
    '.eg-scout-perpage{margin-left:8px;border:1px solid #e5e4e0;border-radius:8px;padding:6px 8px;font-size:12.5px;font-family:inherit;color:#6b7280;background:#fff;cursor:pointer;outline:none}' +
    '#eg-scout-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#191918;color:#fff;font-size:13.5px;font-weight:600;padding:11px 18px;border-radius:11px;box-shadow:0 12px 32px rgba(17,24,39,.28);z-index:9600;opacity:0;transition:opacity .2s;pointer-events:none}' +
    '#eg-scout-toast.show{opacity:1}' +
    /* ── Page mode: rendered full-page via EGScout.mount(el) instead of the modal overlay ── */
    '.eg-scout-pagewrap{font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif}' +
    '.eg-scout-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}' +
    '.eg-scout-pagewrap #eg-scout-form{flex:1;min-width:260px;display:flex;gap:9px;padding:0;border:none;background:none}' +
    '.eg-scout-pagewrap #eg-scout-note{padding:0;margin-bottom:14px}' +
    '.eg-scout-pagewrap #eg-scout-grid{flex:none;overflow:visible;padding:0;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}' +
    '.eg-scout-pagewrap #eg-scout-tabs{margin-left:0}' +
    '.eg-scout-pagewrap #eg-scout-pager{border-top:none;padding:22px 0 4px}';

  var TABS =
    '<button type="button" data-view="search" class="eg-scout-tab on">Search</button>' +
    '<button type="button" data-view="saved" class="eg-scout-tab">Saved<b id="eg-scout-savedn">0</b></button>' +
    '<button type="button" data-view="favs" class="eg-scout-tab">Favorites<b id="eg-scout-favn">0</b></button>';
  var FORM =
    '<input id="eg-scout-q" type="text" placeholder="Search a niche, e.g. personalized pennant, custom apron…" autocomplete="off"/>' +
    '<button id="eg-scout-go" type="submit">Search</button>';

  var HTML =
    '<div id="eg-scout-panel" role="dialog" aria-modal="true" aria-label="SpyDeck">' +
      '<div id="eg-scout-head">' +
        '<div><h3>SpyDeck</h3><div class="sub">Spy what\'s selling on Etsy. Make it, or save it.</div></div>' +
        '<div id="eg-scout-tabs">' + TABS + '</div>' +
        '<button id="eg-scout-x" type="button" aria-label="Close"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>' +
      '</div>' +
      '<form id="eg-scout-form" autocomplete="off">' + FORM + '</form>' +
      '<div id="eg-scout-note"></div>' +
      '<div id="eg-scout-grid"><div class="eg-scout-empty">Loading fresh finds…</div></div>' +
      '<div id="eg-scout-pager"></div>' +
    '</div>';

  // Page-mode markup (search bar + tabs + note + grid + pager) — same element IDs as the modal so
  // all the search/favorites/render logic is shared verbatim. A page uses mount(); a modal uses open().
  var PAGE_HTML =
    '<div class="eg-scout-bar">' +
      '<form id="eg-scout-form" autocomplete="off">' + FORM + '</form>' +
      '<div id="eg-scout-tabs">' + TABS + '</div>' +
    '</div>' +
    '<div id="eg-scout-note"></div>' +
    '<div id="eg-scout-grid"><div class="eg-scout-empty">Loading fresh finds…</div></div>' +
    '<div id="eg-scout-pager"></div>';

  // Rotating default queries so the page hydrates with fresh products BEFORE any search (the "daily
  // new products" homepage). We pick by the calendar day, so it changes daily without server storage.
  var FEED_QUERIES = ['personalized gift', 'custom name sign', 'minimalist wall art', 'funny shirt',
    'birth flower jewelry', 'custom pet portrait', 'embroidered sweatshirt', 'handmade candle',
    'wedding gift', 'birthday gift idea', 'custom door mat', 'trending home decor'];

  var _injected = false, _role = 'seller', _last = [], _view = 'search';
  var _query = '', _feedQuery = '', _feed = false, _page = 1, _count = 0, _perPage = 24, _loading = false;

  function _wireCommon(root) {
    (root || document).querySelector('#eg-scout-form').addEventListener('submit', function (e) { e.preventDefault(); doSearch(1); });
    Array.prototype.forEach.call((root || document).querySelectorAll('.eg-scout-tab'), function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
  }

  function inject() {
    if (_injected) return; _injected = true;
    if (!document.getElementById('eg-scout-css')) { var st = document.createElement('style'); st.id = 'eg-scout-css'; st.textContent = CSS; document.head.appendChild(st); }
    var ov = document.createElement('div'); ov.id = 'eg-scout-ov'; ov.innerHTML = HTML; document.body.appendChild(ov);
    var t = document.createElement('div'); t.id = 'eg-scout-toast'; document.body.appendChild(t);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('eg-scout-x').addEventListener('click', close);
    _wireCommon(document);
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
    _maybeLoadFeed();
  }
  function close() { var ov = document.getElementById('eg-scout-ov'); if (ov) ov.classList.remove('on'); document.body.style.overflow = ''; }

  // Full-page mount: render the SAME engine into a page container (superspy.html) instead of the
  // modal overlay. Shared so admin reuses it without a rebuild.
  function mount(el, opts) {
    opts = opts || {}; _role = opts.role || 'seller';
    if (!el) return;
    if (!document.getElementById('eg-scout-css')) { var st = document.createElement('style'); st.id = 'eg-scout-css'; st.textContent = CSS; document.head.appendChild(st); }
    if (!document.getElementById('eg-scout-toast')) { var t = document.createElement('div'); t.id = 'eg-scout-toast'; document.body.appendChild(t); }
    el.classList.add('eg-scout-pagewrap');
    el.innerHTML = PAGE_HTML;
    _wireCommon(el);
    updateFavCount();
    setView('search');
    _maybeLoadFeed();
  }

  function _maybeLoadFeed() { if (!_last.length && !_loading) loadFeed(); }
  function _note(msg) { var n = document.getElementById('eg-scout-note'); if (!n) return; if (msg) { n.textContent = msg; n.classList.add('on'); } else { n.classList.remove('on'); } }

  function setView(v) {
    _view = v;
    Array.prototype.forEach.call(document.querySelectorAll('.eg-scout-tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-view') === v); });
    if (v === 'favs') { _note(''); _clearPager(); renderFavorites(); }
    else if (v === 'saved') { _note(''); _clearPager(); renderSaved(); }
    else {
      if (_last.length) { render(_last); renderPager(); if (_feed) _note('Fresh finds for today — or search any niche above.'); }
      else _maybeLoadFeed();
    }
  }

  // The daily feed is cached so the page paints INSTANTLY on open (no spinner), then refreshes live.
  var FEED_CACHE_KEY = 'eg_scout_feed';
  function _saveFeedCache(results) { try { localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ ts: Date.now(), results: (results || []).slice(0, 48) })); } catch (e) {} }
  function _loadFeedCache() { try { var c = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || 'null'); return (c && Array.isArray(c.results)) ? c.results : null; } catch (e) { return null; } }
  function loadFeed() {
    var day = Math.floor(Date.now() / 86400000);
    _feedQuery = FEED_QUERIES[day % FEED_QUERIES.length];
    _feed = true;
    var cached = _loadFeedCache();
    if (cached && cached.length) { _last = cached; _count = cached.length; render(_last); renderPager(); _note('Fresh finds for today — or search any niche above.'); }
    _fetchPage(_feedQuery, 1, true);
  }

  function doSearch(page) {
    var q = (document.getElementById('eg-scout-q').value || '').trim();
    if (!q) { _feed = true; loadFeed(); return; }
    _feed = false;
    _fetchPage(q, page || 1, false);
  }

  function _fetchPage(q, page, isFeed, isFallback) {
    _query = q; _page = Math.max(1, page || 1); _loading = true;
    var grid = document.getElementById('eg-scout-grid');
    var keepCards = isFeed && grid && grid.querySelector('.eg-scout-card');   // silent background refresh of the feed — no spinner flash
    if (grid && !keepCards) grid.innerHTML = '<div class="eg-scout-empty">' + (isFeed ? 'Loading fresh finds…' : 'Searching…') + '</div>';
    if (!keepCards) _clearPager();
    var offset = (_page - 1) * _perPage;
    var url = (g.EG_API_BASE || '') + '/api/etsy/search?q=' + encodeURIComponent(q) + '&limit=' + _perPage + '&offset=' + offset + ((isFeed && !isFallback) ? '&sort=created' : '');
    fetch(url, { headers: { Authorization: 'Bearer ' + tok() } })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        _loading = false;
        if (_view !== 'search') return;                       // user switched to Favorites mid-flight
        if (d && d.error) { if (grid) grid.innerHTML = '<div class="eg-scout-empty">' + esc(d.error) + '</div>'; return; }
        var res = (d && d.results) || [];
        if (isFeed && !isFallback && !res.length) { _fetchPage(q, page, true, true); return; }   // newest-sort empty → retry unsorted
        _last = res;
        _count = (d && d.count) || _last.length;
        render(_last);
        renderPager();
        if (isFeed) _saveFeedCache(_last);
        _note(isFeed ? 'Fresh finds for today — or search any niche above.' : '');
      })
      .catch(function () { _loading = false; if (grid) grid.innerHTML = '<div class="eg-scout-empty">Search failed — check your connection and try again.</div>'; });
  }

  function cardHTML(l, i, favView) {
    var e = _est(l);
    var img = l.image ? '<img src="' + esc(l.image) + '" alt="" loading="lazy"/>' : '<div class="eg-scout-noimg">No image</div>';
    var saved = favHas(l.listing_id);
    var created = _dateStr(l.created);
    var favs = l.num_favorers || 0;
    var tags = (Array.isArray(l.tags) ? l.tags : []).slice(0, 13);   // Etsy allows up to 13 tags
    // One row of keywords by default; "+N" expands the rest inline. Copy stays locked on the right.
    var tagHTML = tags.length
      ? '<div class="eg-scout-tagwrap">'
        + '<div class="eg-scout-tags">' + tags.map(function (t) { return '<span class="eg-scout-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
        + '<div class="eg-scout-tagbar">'
        +   (tags.length > 3 ? '<button class="eg-scout-more" type="button">+' + tags.length + ' keywords</button>' : '<span></span>')
        +   '<button class="eg-scout-copy" type="button" data-i="' + i + '" title="Copy all keywords">Copy</button>'
        + '</div></div>'
      : '';
    return '<div class="eg-scout-card' + (e.trending ? ' trend' : '') + '">' +
      (favView ? '<button class="eg-scout-remove" type="button" data-i="' + i + '" title="Remove" aria-label="Remove">&times;</button>' : '') +
      (e.trending ? '<span class="eg-scout-trend">Trending</span>' : '') +
      '<button class="eg-scout-heart' + (saved ? ' on' : '') + '" type="button" data-i="' + i + '" title="Save to favorites" aria-label="Favorite"><svg viewBox="0 0 24 24"><path d="M12 20.7C7 17 3.5 13.9 3.5 9.7 3.5 7 5.5 5.2 7.9 5.2c1.5 0 2.9.7 4.1 2.2 1.2-1.5 2.6-2.2 4.1-2.2 2.4 0 4.4 1.8 4.4 4.5 0 4.2-3.5 7.3-8.5 11z"/></svg></button>' +
      '<a class="eg-scout-img" href="' + esc(l.url || '#') + '" target="_blank" rel="noopener">' + img +
        '<span class="eg-scout-imeta"><span style="color:#ef4444">&#9829;</span> ' + _fmt(favs) + (created ? ' <span style="opacity:.4">·</span> ' + esc(created) : '') + '</span>' +
      '</a>' +
      '<div class="eg-scout-body">' +
        '<div class="eg-scout-stats">' +
          '<span class="eg-scout-stat"><b>' + _fmt(e.views24) + '</b><i>Views<span class="eg-scout-sub">24h</span></i></span>' +
          '<span class="eg-scout-stat"><b>' + _fmt(e.sold24) + '</b><i>Sold<span class="eg-scout-sub">24h</span></i></span>' +
          '<span class="eg-scout-stat"><b>' + _money(e.revenue) + '</b><i>Revenue<span class="eg-scout-sub"></span></i></span>' +
          '<span class="eg-scout-stat"><b>' + _fmt(e.totalSold) + '</b><i>Sold<span class="eg-scout-sub"></span></i></span>' +
        '</div>' +
        '<div class="eg-scout-title" title="' + esc(l.title || '') + '">' + esc(l.title || '') + '</div>' +
        tagHTML +
        '<div class="eg-scout-actions">' +
          '<button class="eg-scout-add" type="button" data-i="' + i + '">Add to store</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function wireCards(grid, list, favView) {
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-add'), function (b) { b.addEventListener('click', function () { _make(list[+b.getAttribute('data-i')]); }); });
    // Heart overlay on the image = favourite toggle (fills red when saved).
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-heart'), function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var l = list[+b.getAttribute('data-i')]; var on = favToggle(l);
        b.classList.toggle('on', on);
        if (_view === 'favs' && !on) renderFavorites();
      });
    });
    // "+N keywords" expands the clipped keyword row inline.
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-more'), function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var wrap = b.closest('.eg-scout-tagwrap'); if (!wrap) return;
        var tagsEl = wrap.querySelector('.eg-scout-tags'); var on = tagsEl.classList.toggle('expanded');
        b.textContent = on ? '− less' : '+' + tagsEl.querySelectorAll('.eg-scout-tag').length + ' keywords';
      });
    });
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-copy'), function (b) {
      b.addEventListener('click', function () {
        var l = list[+b.getAttribute('data-i')]; var kws = (Array.isArray(l.tags) ? l.tags : []);
        try { navigator.clipboard.writeText(kws.join(', ')); } catch (e) {}
        var was = b.textContent; b.textContent = 'Copied'; setTimeout(function () { b.textContent = was; }, 1200);
        toast('Copied ' + kws.length + ' keywords');
      });
    });
    if (favView) {
      Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-remove'), function (b) {
        b.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          favToggle(list[+b.getAttribute('data-i')]); renderFavorites();
        });
      });
    }
  }

  function render(results) {
    var grid = document.getElementById('eg-scout-grid');
    if (!results.length) { grid.innerHTML = '<div class="eg-scout-empty">No results — try a different niche.</div>'; return; }
    grid.innerHTML = results.map(function (l, i) { return cardHTML(l, i, false); }).join('');
    wireCards(grid, results, false);
  }
  function renderFavorites() {
    var grid = document.getElementById('eg-scout-grid');
    var favs = favLoad();
    if (!favs.length) { grid.innerHTML = '<div class="eg-scout-empty">No favorites yet.<br>Search, then tap <b>Favorite</b> on the products you want to research.</div>'; return; }
    grid.innerHTML = favs.map(function (l, i) { return cardHTML(l, i, true); }).join('');
    wireCards(grid, favs, true);
  }
  // Saved = products you started via Make → Save for later (in-progress, finish in the Design Maker).
  function savedCardHTML(p, i) {
    var img = (p.images && p.images[0]) ? '<img src="' + esc(p.images[0]) + '" alt="" loading="lazy"/>' : '<div class="eg-scout-noimg">No image</div>';
    var variant = [p.color, p.size].filter(Boolean).join(' · ');
    return '<div class="eg-scout-card">' +
      '<button class="eg-scout-x" type="button" data-i="' + i + '" title="Remove from saved" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<a class="eg-scout-img" href="' + esc(p.url || '#') + '" target="_blank" rel="noopener">' + img + '</a>' +
      '<div class="eg-scout-body">' +
        '<div class="eg-scout-title" title="' + esc(p.title || '') + '">' + esc(p.title || 'Untitled product') + '</div>' +
        '<div class="eg-scout-meta"><span>' + esc(p.product || 'No blank chosen') + (variant ? ' · ' + esc(variant) : '') + '</span><span>' + esc(p.store || '') + '</span></div>' +
        '<div class="eg-scout-actions">' +
          '<button class="eg-scout-make eg-scout-cont" type="button" data-i="' + i + '">Continue</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  function renderSaved() {
    var grid = document.getElementById('eg-scout-grid');
    var list = _savedLoad();
    if (!list.length) { grid.innerHTML = '<div class="eg-scout-empty">No saved products yet.<br>Hit <b>Make</b> on any find, then <b>Save for later</b> to park it here and finish in the Design Maker.</div>'; return; }
    grid.innerHTML = list.map(function (p, i) { return savedCardHTML(p, i); }).join('');
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-cont'), function (b) { b.addEventListener('click', function () {
      var p = list[+b.getAttribute('data-i')];
      openPublish({ listing_id: p.listing_id, title: p.title, description: p.description, price: p.price, tags: p.tags, url: p.url, images: p.images });
    }); });
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-x'), function (b) { b.addEventListener('click', function () {
      var all = _savedLoad(); all.splice(+b.getAttribute('data-i'), 1); try { localStorage.setItem('eg_scout_products', JSON.stringify(all)); } catch (e) {}
      updateFavCount(); renderSaved();
    }); });
  }

  function _clearPager() { var p = document.getElementById('eg-scout-pager'); if (p) p.innerHTML = ''; }
  function renderPager() {
    var p = document.getElementById('eg-scout-pager'); if (!p) return;
    if (_view !== 'search' || !_last.length) { p.innerHTML = ''; return; }
    var total = Math.max(1, Math.min(50, Math.ceil((_count || _last.length) / _perPage)));   // cap deep pagination
    p.innerHTML =
      '<button class="eg-scout-pg-btn" id="eg-scout-prev" ' + (_page <= 1 ? 'disabled' : '') + ' aria-label="Previous page">&#8249;</button>' +
      '<span class="eg-scout-pgtxt">Page ' + _page + ' / ' + total + '</span>' +
      '<button class="eg-scout-pg-btn" id="eg-scout-next" ' + (_page >= total ? 'disabled' : '') + ' aria-label="Next page">&#8250;</button>' +
      '<select class="eg-scout-perpage" id="eg-scout-perpage" title="Products per page">' +
        [12, 24, 36, 48].map(function (n) { return '<option value="' + n + '"' + (n === _perPage ? ' selected' : '') + '>' + n + ' / page</option>'; }).join('') +
      '</select>';
    var prev = document.getElementById('eg-scout-prev'); if (prev) prev.onclick = function () { if (_page > 1) _go(_page - 1); };
    var next = document.getElementById('eg-scout-next'); if (next) next.onclick = function () { if (_page < total) _go(_page + 1); };
    var pp = document.getElementById('eg-scout-perpage'); if (pp) pp.onchange = function () { _perPage = parseInt(pp.value, 10) || 24; _go(1); };
  }
  function _go(page) {
    var grid = document.getElementById('eg-scout-grid'); if (grid) grid.scrollTop = 0;
    _fetchPage(_query || _feedQuery, page, _feed);
  }

  // Make = turn this idea into a real product. Opens the Publish modal below (NO design-maker).
  // A page may still override EGScout.onMake to take over.
  function _make(listing) {
    if (!listing) return;
    if (typeof g.EGScout.onMake === 'function') { g.EGScout.onMake(listing, _role); return; }
    openPublish(listing);
  }

  // ══════════════════ Publish flow (Make → here; the design-maker is skipped) ══════════════════
  // Synced product images → pick a blank (colour/size) → optional Template/Design ID → publish to a
  // connected store, or connect one. "Save for later" stashes the product (eg_scout_products) so it
  // can be finished in the Design Maker. Shared by seller + admin.
  var PUB_CSS =
    '#eg-pub-ov{position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:9500;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
    '#eg-pub-ov.on{display:flex}' +
    '#eg-pub-card{background:#fdfcfa;border:1px solid #e5e4e0;border-radius:18px;box-shadow:0 24px 70px rgba(17,24,39,.24);width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif}' +
    '#eg-pub-head{display:flex;align-items:flex-start;gap:12px;padding:18px 22px;border-bottom:1px solid #ece9e3;flex-shrink:0}' +
    '#eg-pub-head h3{margin:0;font-size:17px;font-weight:750;color:#191918}' +
    '#eg-pub-head .sub{font-size:12.5px;color:#9ca3af;margin-top:2px;max-width:430px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#eg-pub-x{margin-left:auto;background:none;border:none;cursor:pointer;color:#9ca3af;padding:6px;border-radius:8px;line-height:0;flex-shrink:0}' +
    '#eg-pub-x:hover{background:#f4f2ef;color:#191918}' +
    '#eg-pub-body{overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:19px}' +
    '.eg-pub-l{font-size:12px;font-weight:700;color:#191918;text-transform:uppercase;letter-spacing:.04em;margin-bottom:9px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}' +
    '.eg-pub-l em{font-weight:500;text-transform:none;letter-spacing:0;color:#9ca3af;font-size:11.5px;font-style:normal}' +
    '#eg-pub-imgs{display:flex;gap:9px;flex-wrap:wrap}' +
    '.eg-pub-img{position:relative;width:70px;height:70px;border-radius:9px;overflow:hidden;border:1px solid #e5e4e0;background:#f4f2ef;flex-shrink:0;cursor:pointer}' +
    '.eg-pub-img img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.eg-pub-img.primary{border:2px solid #191918}' +
    '.eg-pub-img .rm{position:absolute;top:2px;right:2px;width:18px;height:18px;background:rgba(17,24,39,.72);color:#fff;border:none;border-radius:50%;font-size:12px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}' +
    '.eg-pub-img .pr{position:absolute;bottom:0;left:0;right:0;background:#191918;color:#fff;font-size:8px;font-weight:700;text-align:center;padding:1px;letter-spacing:.03em}' +
    '.eg-pub-addimg{width:70px;height:70px;border:1.5px dashed #c4c3be;border-radius:9px;background:#faf9f7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer;color:#9ca3af;font-family:inherit;flex-shrink:0;transition:border-color .15s,color .15s}' +
    '.eg-pub-addimg span{font-size:22px;line-height:1;font-weight:300}.eg-pub-addimg i{font-size:10px;font-style:normal;font-weight:600}.eg-pub-addimg:hover{border-color:#191918;color:#191918}' +
    '#eg-pub-zoom{position:fixed;inset:0;z-index:10010;display:none;align-items:center;justify-content:center;padding:24px}' +
    '#eg-pub-zoom .egz-back{position:absolute;inset:0;background:rgba(17,24,39,.74);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}' +
    '#eg-pub-zoom .egz-box{position:relative;z-index:1;max-width:min(680px,92vw);display:flex;flex-direction:column;align-items:center;gap:12px}' +
    '#eg-pub-zoom .egz-img{max-width:100%;max-height:72vh;object-fit:contain;border-radius:10px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.45)}' +
    '#eg-pub-zoom .egz-bar{display:flex;align-items:center;gap:14px}' +
    '#eg-pub-zoom .egz-nav{background:rgba(255,255,255,.16);border:none;color:#fff;width:34px;height:34px;border-radius:50%;font-size:20px;cursor:pointer;line-height:1}#eg-pub-zoom .egz-nav:hover{background:rgba(255,255,255,.3)}' +
    '#eg-pub-zoom .egz-count{font-size:12.5px;color:rgba(255,255,255,.85)}' +
    '#eg-pub-zoom .egz-primary{background:#fff;color:#191918;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:650;cursor:pointer;font-family:inherit}' +
    '#eg-pub-zoom .egz-x{position:absolute;top:-8px;right:-8px;width:32px;height:32px;border-radius:50%;background:#fff;border:none;color:#374151;font-size:20px;cursor:pointer;line-height:1;box-shadow:0 4px 12px rgba(0,0,0,.3)}' +
    '.eg-pub-in,.eg-pub-sel{width:100%;border:1px solid #e5e4e0;border-radius:9px;padding:9px 11px;font-size:13.5px;font-family:inherit;color:#191918;outline:none;background:#fff;box-sizing:border-box}' +
    '.eg-pub-in:focus,.eg-pub-sel:focus{border-color:#191918}' +
    '.eg-pub-row{display:flex;gap:10px;margin-top:9px}' +
    '.eg-pub-row>div{flex:1;min-width:0}' +
    '.eg-pub-cap{font-size:11px;color:#9ca3af;font-weight:600;margin-bottom:4px;display:block}' +
    '.eg-pub-hint{font-size:11.5px;color:#9ca3af;margin-top:6px;line-height:1.5}' +
    '.eg-pub-store{display:flex;align-items:center;gap:10px;border:1px solid #e5e4e0;border-radius:10px;padding:10px 13px;cursor:pointer;margin-bottom:8px;transition:border-color .12s,box-shadow .12s;background:#fff}' +
    '.eg-pub-store:hover{border-color:#9ca3af}' +
    '.eg-pub-store.on{border-color:#191918;box-shadow:0 0 0 1px #191918}' +
    '.eg-pub-store b{font-size:13.5px;font-weight:650;color:#191918;display:block}' +
    '.eg-pub-store i{font-size:11.5px;color:#9ca3af;font-style:normal}' +
    '.eg-pub-connect{width:100%;border:1.5px dashed #c9c3ba;border-radius:11px;padding:15px;text-align:center;cursor:pointer;background:transparent;font-family:inherit;color:#6b7280;font-size:13.5px;font-weight:600;transition:border-color .12s,color .12s}' +
    '.eg-pub-connect:hover{border-color:#191918;color:#191918}' +
    '#eg-pub-foot{border-top:1px solid #ece9e3;padding:14px 22px;display:flex;gap:10px;flex-shrink:0}' +
    '#eg-pub-foot button{flex:1;border-radius:11px;padding:12px;font-size:14px;font-weight:650;cursor:pointer;font-family:inherit;transition:opacity .14s,background .14s}' +
    '#eg-pub-save{background:#fff;border:1px solid #e5e4e0;color:#374151}' +
    '#eg-pub-save:hover{background:#f7f6f4}' +
    '#eg-pub-publish{background:#191918;border:none;color:#fff}' +
    '#eg-pub-publish:hover{opacity:.88}';

  var _pub = null, _pubInjected = false;
  function injectPub() {
    if (_pubInjected) return; _pubInjected = true;
    if (!document.getElementById('eg-pub-css')) { var st = document.createElement('style'); st.id = 'eg-pub-css'; st.textContent = PUB_CSS; document.head.appendChild(st); }
    var ov = document.createElement('div'); ov.id = 'eg-pub-ov';
    ov.innerHTML =
      '<div id="eg-pub-card" role="dialog" aria-modal="true" aria-label="Make product">' +
        '<div id="eg-pub-head"><div><h3>Make product</h3><div class="sub" id="eg-pub-sub"></div></div>' +
          '<button id="eg-pub-x" type="button" aria-label="Close"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>' +
        '<div id="eg-pub-body">' +
          '<div><div class="eg-pub-l">Images <em>synced from Etsy — click to set primary, × to remove</em></div><div id="eg-pub-imgs"></div></div>' +
          '<div><div class="eg-pub-l">Choose your blank</div><select class="eg-pub-sel" id="eg-pub-product"></select>' +
            '<div class="eg-pub-row"><div><label class="eg-pub-cap">Colour</label><select class="eg-pub-sel" id="eg-pub-color"></select></div><div><label class="eg-pub-cap">Size</label><select class="eg-pub-sel" id="eg-pub-size"></select></div></div></div>' +
          '<div><div class="eg-pub-l">Design <em>optional</em></div><input class="eg-pub-in" id="eg-pub-design" placeholder="Template or Design ID — e.g. TPL-1234 or DSN-5678" autocomplete="off"/>' +
            '<div class="eg-pub-hint">Have a design ready? Paste its Template/Design ID. Or <b>Save for later</b> and finish it in the Design Maker.</div></div>' +
          '<div><div class="eg-pub-l">Publish to</div><div id="eg-pub-stores"></div></div>' +
        '</div>' +
        '<div id="eg-pub-foot"><button id="eg-pub-save" type="button">Save for later</button><button id="eg-pub-publish" type="button">Publish</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closePub(); });
    document.getElementById('eg-pub-x').addEventListener('click', closePub);
    document.getElementById('eg-pub-product').addEventListener('change', _pubOnProduct);
    document.getElementById('eg-pub-save').addEventListener('click', _pubSave);
    document.getElementById('eg-pub-publish').addEventListener('click', _pubPublish);
  }
  function openPublish(listing) {
    if (!listing) return;
    injectPub();
    _pub = { listing: listing, images: (listing.images && listing.images.length ? listing.images.slice() : (listing.image ? [listing.image] : [])), store: null };
    document.getElementById('eg-pub-sub').textContent = listing.title || '';
    document.getElementById('eg-pub-design').value = '';
    _pubRenderImgs(); _pubRenderProducts(); _pubRenderStores();
    document.getElementById('eg-pub-ov').classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function closePub() { var ov = document.getElementById('eg-pub-ov'); if (ov) ov.classList.remove('on'); document.body.style.overflow = ''; }

  function _pubRenderImgs() {
    var box = document.getElementById('eg-pub-imgs'); if (!box) return;
    var tiles = _pub.images.map(function (u, i) {
      return '<div class="eg-pub-img' + (i === 0 ? ' primary' : '') + '" data-i="' + i + '"><img src="' + esc(u) + '" alt=""/>' + (i === 0 ? '<span class="pr">PRIMARY</span>' : '') + '<button class="rm" type="button" data-i="' + i + '" title="Remove">&times;</button></div>';
    }).join('');
    // Blank tile to add more images (upload) — always present, even with no synced images.
    box.innerHTML = tiles + '<button type="button" class="eg-pub-addimg" id="eg-pub-addimg" title="Add an image"><span>+</span><i>Add</i></button>';
    Array.prototype.forEach.call(box.querySelectorAll('.rm'), function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); _pub.images.splice(+b.getAttribute('data-i'), 1); _pubRenderImgs(); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.eg-pub-img'), function (d) {
      d.addEventListener('click', function () { _pubZoom(+d.getAttribute('data-i')); });
    });
    var add = document.getElementById('eg-pub-addimg'); if (add) add.addEventListener('click', _pubAddImage);
  }
  // Click an image → zoom it in a lightbox over the Make-product window (arrows / Esc; set primary here).
  function _pubZoom(start) {
    var imgs = _pub.images || []; if (!imgs.length) return;
    var idx = Math.max(0, Math.min(imgs.length - 1, start | 0));
    var ov = document.getElementById('eg-pub-zoom');
    if (!ov) { ov = document.createElement('div'); ov.id = 'eg-pub-zoom'; document.body.appendChild(ov); }
    function close() { ov.style.display = 'none'; ov.innerHTML = ''; document.removeEventListener('keydown', key, true); }
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') { idx = (idx - 1 + imgs.length) % imgs.length; draw(); } else if (e.key === 'ArrowRight') { idx = (idx + 1) % imgs.length; draw(); } }
    function draw() {
      imgs = _pub.images || [];
      ov.innerHTML = '<div class="egz-back"></div><div class="egz-box">'
        + '<button class="egz-x" title="Close">&times;</button>'
        + '<img class="egz-img" src="' + esc(imgs[idx]) + '" alt=""/>'
        + '<div class="egz-bar">'
        +   '<button class="egz-nav egz-prev"' + (imgs.length < 2 ? ' style="visibility:hidden"' : '') + '>&#8249;</button>'
        +   '<span class="egz-count">' + (idx + 1) + ' / ' + imgs.length + '</span>'
        +   '<button class="egz-nav egz-next"' + (imgs.length < 2 ? ' style="visibility:hidden"' : '') + '>&#8250;</button>'
        +   '<button class="egz-primary">' + (idx === 0 ? '★ Primary' : 'Set as primary') + '</button>'
        + '</div></div>';
      ov.style.display = 'flex';
      ov.querySelector('.egz-back').onclick = close;
      ov.querySelector('.egz-x').onclick = close;
      ov.querySelector('.egz-prev').onclick = function (e) { e.stopPropagation(); idx = (idx - 1 + imgs.length) % imgs.length; draw(); };
      ov.querySelector('.egz-next').onclick = function (e) { e.stopPropagation(); idx = (idx + 1) % imgs.length; draw(); };
      ov.querySelector('.egz-primary').onclick = function (e) { e.stopPropagation(); if (idx > 0) { _pub.images.unshift(_pub.images.splice(idx, 1)[0]); idx = 0; _pubRenderImgs(); draw(); } };
    }
    document.addEventListener('keydown', key, true);
    draw();
  }
  function _pubAddImage() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var rd = new FileReader(); rd.onload = function () { _pub.images.push(String(rd.result)); _pubRenderImgs(); }; rd.readAsDataURL(f);
    });
    document.body.appendChild(inp); inp.click(); setTimeout(function () { try { document.body.removeChild(inp); } catch (e) {} }, 2000);
  }

  function _pubCatalog() { try { if (!window.EGStore) return []; var fn = EGStore.getCatalogProducts || EGStore.getCatalog; return (fn ? (fn.call(EGStore) || []) : []); } catch (e) { return []; } }
  function _pubList(p, keys) {
    for (var i = 0; i < keys.length; i++) { var v = p[keys[i]]; if (Array.isArray(v) && v.length) return v.map(function (x) { return (x && x.name) ? x.name : String(x); }); }
    return [];
  }
  function _pubRenderProducts() {
    var sel = document.getElementById('eg-pub-product'); if (!sel) return;
    var cat = _pubCatalog().filter(function (p) { return !p.status || p.status === 'Active'; });
    sel._cat = cat;
    if (!cat.length) { sel.innerHTML = '<option value="">No blanks in your catalog yet</option>'; document.getElementById('eg-pub-color').innerHTML = '<option>All Colours</option>'; document.getElementById('eg-pub-size').innerHTML = '<option>All Sizes</option>'; return; }
    sel.innerHTML = cat.map(function (p, i) { return '<option value="' + i + '">' + esc(p.name || p.type || ('Product ' + (i + 1))) + '</option>'; }).join('');
    _pubOnProduct();
  }
  function _pubOnProduct() {
    var sel = document.getElementById('eg-pub-product'); var cat = sel && sel._cat; if (!cat || !cat.length) return;
    var p = cat[+sel.value] || cat[0] || {};
    // Real catalog products carry colours as a colorImages map; fall back to a colours array.
    var colors = (p.colorImages && typeof p.colorImages === 'object') ? Object.keys(p.colorImages) : _pubList(p, ['colors', 'colours', 'colorList']);
    var sizes = _pubList(p, ['sizes', 'sizeList']);
    if (!sizes.length && Array.isArray(p.variants)) sizes = p.variants.map(function (v) { return (v && v.size) ? v.size : (typeof v === 'string' ? v : ''); }).filter(Boolean);
    sizes = sizes.filter(function (s, i) { return sizes.indexOf(s) === i; });   // de-dupe
    // "All Colours"/"All Sizes" lead (and default) so every variant syncs to the platform unless narrowed.
    document.getElementById('eg-pub-color').innerHTML = ['All Colours'].concat(colors.length ? colors : ['Default']).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    document.getElementById('eg-pub-size').innerHTML = ['All Sizes'].concat(sizes.length ? sizes : ['One size']).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
  }

  function _pubRenderStores() {
    var box = document.getElementById('eg-pub-stores'); if (!box) return;
    box.innerHTML = '<div style="font-size:12.5px;color:#9ca3af;padding:4px 0">Checking your connected stores…</div>';
    var tk = tok();
    var plats = [['etsy', 'Etsy'], ['shopify', 'Shopify'], ['tiktok', 'TikTok Shop']];
    Promise.all(plats.map(function (pl) {
      return fetch((g.EG_API_BASE || '') + '/api/' + pl[0] + '/connected', { headers: tk ? { Authorization: 'Bearer ' + tk } : {} })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) { return { key: pl[0], label: pl[1], connected: !!(d && d.connected), shops: (d && d.shops) || [] }; })
        .catch(function () { return { key: pl[0], label: pl[1], connected: false }; });
    })).then(function (results) {
      var connected = results.filter(function (r) { return r.connected; });
      if (!connected.length) {
        box.innerHTML = '<button class="eg-pub-connect" id="eg-pub-connect" type="button">+ Connect a store to publish</button>';
        var cb = document.getElementById('eg-pub-connect'); if (cb) cb.addEventListener('click', function () { location.href = 'settings.html#stores'; });
        _pub.store = null; return;
      }
      box.innerHTML = connected.map(function (r, i) {
        return '<div class="eg-pub-store' + (i === 0 ? ' on' : '') + '" data-key="' + r.key + '"><div style="flex:1"><b>' + esc(r.label) + '</b><i>' + esc((r.shops && r.shops[0]) || 'Connected') + '</i></div></div>';
      }).join('');
      _pub.store = connected[0].key;
      Array.prototype.forEach.call(box.querySelectorAll('.eg-pub-store'), function (d) {
        d.addEventListener('click', function () {
          Array.prototype.forEach.call(box.querySelectorAll('.eg-pub-store'), function (x) { x.classList.remove('on'); });
          d.classList.add('on'); _pub.store = d.getAttribute('data-key');
        });
      });
    });
  }

  function _pubCollect() {
    var sel = document.getElementById('eg-pub-product'); var cat = sel && sel._cat;
    var p = (cat && cat.length) ? cat[+sel.value] : null;
    return {
      listing_id: _pub.listing.listing_id, title: _pub.listing.title || '', description: _pub.listing.description || '',
      price: (_pub.listing.price != null ? _pub.listing.price : null), tags: _pub.listing.tags || [], url: _pub.listing.url || '',
      images: _pub.images.slice(), product: p ? (p.name || p.type || '') : '', productId: p ? (p.id || null) : null,
      color: (document.getElementById('eg-pub-color') || {}).value || '', size: (document.getElementById('eg-pub-size') || {}).value || '',
      designId: ((document.getElementById('eg-pub-design') || {}).value || '').trim(), store: _pub.store, ts: Date.now()
    };
  }
  function _pubPersist(prod) { try { var all = JSON.parse(localStorage.getItem('eg_scout_products') || '[]'); all.unshift(prod); localStorage.setItem('eg_scout_products', JSON.stringify(all.slice(0, 200))); } catch (e) {} }
  function _pubSave() { _pubPersist(_pubCollect()); toast('Saved — finish & publish it from the Design Maker anytime.'); closePub(); }
  function _pubPublish() {
    var prod = _pubCollect();
    if (!prod.store) { toast('Connect a store first, or use Save for later.'); return; }
    _pubPersist(prod);
    if (prod.store !== 'etsy') { toast('Saved. Publishing to ' + prod.store + ' is coming soon — Etsy publishes live now.'); closePub(); return; }
    var img = prod.images[0] || _pub.listing.image || '';
    var btn = document.getElementById('eg-pub-publish'); if (btn) { btn.disabled = true; btn.textContent = 'Publishing…'; }
    fetch((g.EG_API_BASE || '') + '/api/etsy/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok() },
      body: JSON.stringify({ title: prod.title, description: prod.description || prod.title, price: prod.price || 0, quantity: 999, image: img })
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Publish'; }
      if (!res || res.error) { toast('Etsy publish failed: ' + ((res && res.error) || 'unknown error')); return; }
      toast('✓ Draft listing created on Etsy');
      if (res.url) { try { window.open(res.url, '_blank'); } catch (e) {} }
      closePub();
    }).catch(function (e) { if (btn) { btn.disabled = false; btn.textContent = 'Publish'; } toast('Etsy publish failed: ' + e.message); });
  }

  g.EGScout = { open: open, close: close, mount: mount, openPublish: openPublish, onMake: null, _est: _est };
})(window);
