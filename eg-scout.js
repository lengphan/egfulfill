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
  function updateFavCount() { var e = document.getElementById('eg-scout-favn'); if (e) e.textContent = favLoad().length; }

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
  function _fmt(n) { n = Math.round(n || 0); if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'; return String(n); }
  function _money(n) { n = Math.round(n || 0); if (n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'; return '$' + n; }
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
    '#eg-scout-form{display:flex;gap:9px;padding:14px 22px;border-bottom:1px solid #ece9e3;flex-shrink:0}' +
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
    '.eg-scout-remove{position:absolute;top:6px;right:6px;z-index:3;width:28px;height:28px;border:none;background:none;color:transparent;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:color .12s}' +
    '.eg-scout-card:hover .eg-scout-remove{color:#40403d}' +
    '.eg-scout-remove:hover{color:#191918}' +
    '.eg-scout-img{aspect-ratio:1/1;min-height:188px;background:#f4f2ef;display:flex;align-items:center;justify-content:center;overflow:hidden;text-decoration:none}' +
    '.eg-scout-img img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.eg-scout-noimg{color:#c4c3be;font-size:12.5px}' +
    '.eg-scout-body{padding:12px 13px 13px;display:flex;flex-direction:column;gap:10px;flex:1}' +
    '.eg-scout-stats{display:grid;grid-template-columns:1fr 1fr;gap:7px}' +
    '.eg-scout-stat{background:rgba(0,0,0,.045);border-radius:8px;padding:7px 9px;display:flex;flex-direction:column;align-items:center;text-align:center;line-height:1.15}' +
    '.eg-scout-stat b{font-size:14.5px;font-weight:750;color:#191918;font-variant-numeric:tabular-nums}' +
    '.eg-scout-stat i{font-size:10px;color:#9ca3af;font-style:normal;font-weight:600;letter-spacing:.02em;text-transform:uppercase;margin-top:2px}' +
    '.eg-scout-title{font-size:13px;color:#191918;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px}' +
    '.eg-scout-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11.5px;color:#6b7280}' +
    '.eg-scout-tags{display:flex;flex-wrap:wrap;gap:5px;align-content:flex-start;max-height:118px;overflow:hidden;position:relative;padding-bottom:26px}' +
    '.eg-scout-tag{background:rgba(0,0,0,.04);border:1px solid rgba(0,0,0,.06);color:#6b7280;font-size:10.5px;font-weight:500;padding:2px 7px;border-radius:6px;white-space:nowrap;max-width:100%}' +
    '.eg-scout-copy{position:absolute;bottom:0;right:0;background:#191918;color:#fff;border:none;font-size:10px;font-weight:650;padding:4px 11px;border-radius:6px;cursor:pointer;line-height:1.3;transition:opacity .12s}' +
    '.eg-scout-copy:hover{opacity:.85}' +
    '.eg-scout-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:auto}' +
    '.eg-scout-make{background:#191918;color:#fff;border:none;border-radius:9px;padding:9px;font-size:13px;font-weight:650;cursor:pointer;font-family:inherit;transition:transform .1s,box-shadow .14s}' +
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
    '.eg-scout-pagewrap #eg-scout-grid{flex:none;overflow:visible;padding:0;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}' +
    '.eg-scout-pagewrap #eg-scout-tabs{margin-left:0}' +
    '.eg-scout-pagewrap #eg-scout-pager{border-top:none;padding:22px 0 4px}';

  var TABS =
    '<button type="button" data-view="search" class="eg-scout-tab on">All</button>' +
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

  var CARD_SHADES = ['#ffffff', '#fbf9f5', '#f7f4ee', '#fcfaf6', '#f8f5ef', '#fdfbf8'];
  function cardHTML(l, i, favView) {
    var e = _est(l);
    var img = l.image ? '<img src="' + esc(l.image) + '" alt="" loading="lazy"/>' : '<div class="eg-scout-noimg">No image</div>';
    var saved = favHas(l.listing_id);
    var created = _dateStr(l.created);
    var favs = l.num_favorers || 0;
    var tags = (Array.isArray(l.tags) ? l.tags : []).slice(0, 13);   // Etsy allows up to 13 tags
    var tagHTML = tags.length
      ? '<div class="eg-scout-tags">' + tags.map(function (t) { return '<span class="eg-scout-tag">' + esc(t) + '</span>'; }).join('') + '<button class="eg-scout-copy" type="button" data-i="' + i + '" title="Copy all keywords">Copy</button></div>'
      : '';
    return '<div class="eg-scout-card' + (e.trending ? ' trend' : '') + '" style="background:' + CARD_SHADES[i % CARD_SHADES.length] + '">' +
      (favView ? '<button class="eg-scout-remove" type="button" data-i="' + i + '" title="Remove" aria-label="Remove">&times;</button>' : '') +
      (e.trending ? '<span class="eg-scout-trend">Trending</span>' : '') +
      '<a class="eg-scout-img" href="' + esc(l.url || '#') + '" target="_blank" rel="noopener">' + img + '</a>' +
      '<div class="eg-scout-body">' +
        '<div class="eg-scout-stats">' +
          '<span class="eg-scout-stat"><b>' + _fmt(e.views24) + '</b><i>Views · 24h</i></span>' +
          '<span class="eg-scout-stat"><b>' + _fmt(e.sold24) + '</b><i>Sold · 24h</i></span>' +
          '<span class="eg-scout-stat"><b>' + _money(e.revenue) + '</b><i>Revenue</i></span>' +
          '<span class="eg-scout-stat"><b>' + _fmt(e.totalSold) + '</b><i>Sold · all</i></span>' +
        '</div>' +
        '<div class="eg-scout-title" title="' + esc(l.title || '') + '">' + esc(l.title || '') + '</div>' +
        '<div class="eg-scout-meta">' +
          '<span title="Favorites">&#9829; ' + _fmt(favs) + '</span>' +
          '<span title="Created on Etsy">' + (created ? 'Created ' + esc(created) : '') + '</span>' +
        '</div>' +
        tagHTML +
        '<div class="eg-scout-actions">' +
          '<button class="eg-scout-make" type="button" data-i="' + i + '">Make</button>' +
          '<button class="eg-scout-save' + (saved ? ' on' : '') + '" type="button" data-i="' + i + '">' + (saved ? 'Saved' : 'Save') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function wireCards(grid, list, favView) {
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-make'), function (b) { b.addEventListener('click', function () { _make(list[+b.getAttribute('data-i')]); }); });
    Array.prototype.forEach.call(grid.querySelectorAll('.eg-scout-save'), function (b) {
      b.addEventListener('click', function () {
        var l = list[+b.getAttribute('data-i')]; var on = favToggle(l);
        b.classList.toggle('on', on); b.textContent = on ? 'Saved' : 'Save';
        if (_view === 'favs' && !on) renderFavorites();
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
    if (!favs.length) { grid.innerHTML = '<div class="eg-scout-empty">No favorites yet.<br>Search, then Save the products you want to sell.</div>'; return; }
    grid.innerHTML = favs.map(function (l, i) { return cardHTML(l, i, true); }).join('');
    wireCards(grid, favs, true);
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

  // Make = start turning this idea into a real product. Default hands off to the EXISTING
  // design-maker via ?scout=1 (a page may override EGScout.onMake — the Publish flow does this).
  function _make(listing) {
    if (!listing) return;
    if (typeof g.EGScout.onMake === 'function') { g.EGScout.onMake(listing, _role); return; }
    try {
      sessionStorage.setItem('eg_scout_ctx', JSON.stringify({
        title: listing.title || '', description: listing.description || '', tags: listing.tags || [],
        image: listing.image || '', images: listing.images || [], url: listing.url || '', price: (listing.price != null ? listing.price : null), role: _role
      }));
    } catch (e) {}
    toast('Opening the builder…');
    setTimeout(function () { location.href = 'design-maker.html?scout=1'; }, 220);
  }

  g.EGScout = { open: open, close: close, mount: mount, onMake: null, _est: _est };
})(window);
