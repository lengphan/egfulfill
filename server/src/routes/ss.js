// S&S Activewear connector — CATALOG + INVENTORY sync for the factory boards.
// -----------------------------------------------------------------------------
// Auth: S&S REST v2 uses HTTP Basic where the ACCOUNT NUMBER is the username and
// the API KEY is the password → Authorization: Basic base64(account:key).
// Env (see .env.example):  SS_ACCOUNT_NUMBER, SS_API_KEY, SS_API_BASE
// Everything here is STAFF-gated (factory/admin only). No route path collides with
// an existing one (grep confirmed no /api/ss*). Synced blanks land in their OWN
// table `ss_products` (kept separate from `catalog_products`, which holds the
// factory's CREATED products) so the products section can show them under a
// distinct "New In" tab.
//
// IMPORTANT: the full S&S product feed is enormous (100k+ SKUs), so /sync is
// BOUNDED — it requires a brand or a set of styleIds; it never pulls everything.
import { q } from '../db.js';

const SS_ACCOUNT = (process.env.SS_ACCOUNT_NUMBER || '').trim();
const SS_KEY     = (process.env.SS_API_KEY || '').trim();
const SS_BASE    = (process.env.SS_API_BASE || 'https://api.ssactivewear.com/v2').trim().replace(/\/$/, '');

// Field list we ask S&S for — keeps payloads small (product feed is huge).
const PRODUCT_FIELDS = 'sku,gtin,styleID,brandName,styleName,colorName,colorCode,sizeName,piecePrice,dozenPrice,casePrice,salePrice,customerPrice,mapPrice,qty,warehouses,colorFrontImage,colorSwatchImage,baseCategory';

// S&S returns RELATIVE image paths (e.g. "Images/Color/19561_f_fm.jpg") → prefix their CDN.
const SS_CDN = 'https://cdn.ssactivewear.com/';
// S&S's CDN 403s + Cross-Origin-Resource-Policy-blocks cross-origin BROWSER loads, so
// <img src="https://cdn.ssactivewear.com/…"> fails from our origin. Route every image URL
// through our same-origin proxy (GET /api/ss/img) — the server fetches it (no browser
// Origin / CORP restriction) and re-serves it. Returns a RELATIVE url so it works in dev + prod.
function ssImg(u) {
  if (!u) return null;
  const abs = /^https?:/i.test(u) ? u : SS_CDN + String(u).replace(/^\//, '');
  return '/api/ss/img?u=' + encodeURIComponent(abs);
}

// S&S descriptions arrive as messy HTML (inline styles, nested spans). Strip that down to a
// small semantic whitelist so OUR css controls the look on the product page.
// S&S descriptions are HTML (<ul><li>…</li></ul>). The product modal edits the description in a
// PLAIN textarea (and pdFormatDesc renders newlines), so return clean TEXT with "• " bullets —
// raw <ul><li> tags were showing verbatim in the create-product textarea.
function cleanDesc(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<\s*li[^>]*>/gi, '\n• ').replace(/<\s*\/\s*li\s*>/gi, '');                 // <li> → "• " bullet
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');                                                // <br> → newline
  s = s.replace(/<\s*\/\s*(?:p|div|ul|ol|h[1-6]|tr)\s*>/gi, '\n');                          // block close → newline
  s = s.replace(/<[^>]+>/g, '');                                                            // strip all remaining tags
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
       .replace(/&quot;/gi, '"').replace(/&#0?39;/gi, "'").replace(/&apos;/gi, "'")
       .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch (e) { return ''; } });
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');   // tidy whitespace
  return s.trim();
}

// Per-style detail cache — /api/ss/style/:id hits S&S twice; cache the resolved result so
// repeat opens (and every visitor after the first) are instant instead of re-fetching live.
const _styleCache = new Map();      // id -> { at, data }
const STYLE_TTL = 15 * 60 * 1000;   // 15 min

function num(v) { const n = Number(v); return isFinite(n) ? n : null; }
function int(v) { const n = parseInt(v, 10); return isFinite(n) ? n : 0; }
function creds() { return !!(SS_ACCOUNT && SS_KEY); }

// S&S distribution centers (fixed locations) — used both to rank by distance AND as the
// fallback DC list, since S&S's /warehouses endpoint comes back empty for this account.
const SS_DC = [
  { abbr: 'NJ', name: 'Robbinsville, NJ', city: 'Robbinsville', state: 'NJ', lat: 40.21, lng: -74.62 },
  { abbr: 'GA', name: 'McDonough, GA',    city: 'McDonough',    state: 'GA', lat: 33.45, lng: -84.15 },
  { abbr: 'IL', name: 'University Park, IL', city: 'University Park', state: 'IL', lat: 41.44, lng: -87.69 },
  { abbr: 'KS', name: 'Olathe, KS',       city: 'Olathe',       state: 'KS', lat: 38.88, lng: -94.82 },
  { abbr: 'TX', name: 'Fort Worth, TX',   city: 'Fort Worth',   state: 'TX', lat: 32.75, lng: -97.33 },
  { abbr: 'NV', name: 'Reno, NV',         city: 'Reno',         state: 'NV', lat: 39.53, lng: -119.75 },
];
const SS_WH_COORDS = SS_DC.reduce((m, d) => { m[d.abbr] = [d.lat, d.lng]; return m; }, {});
function haversineMi(lat1, lon1, lat2, lon2) {
  const R = 3959, toR = (d) => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// One authenticated GET to S&S. Returns { ok, status, data } (data parsed JSON or raw text).
// GLOBAL cap on concurrent S&S HTTP calls across the WHOLE process — the warm job, the batch image
// resolver, and live browsing all share this, so no single caller can saturate the small VPS and
// starve the others. This is what lets you browse while the warm runs. (The styles LIST is cached,
// so browsing keeps working even when all these slots are busy with image resolves.)
let _ssActive = 0;
const _ssWaiters = [];
const SS_MAX = 4;
function _ssAcquire() { return _ssActive < SS_MAX ? (_ssActive++, Promise.resolve()) : new Promise((res) => _ssWaiters.push(res)); }
function _ssRelease() { const next = _ssWaiters.shift(); if (next) next(); else _ssActive--; }
async function ssGet(path, timeoutMs) {
  await _ssAcquire();
  const auth = Buffer.from(SS_ACCOUNT + ':' + SS_KEY).toString('base64');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);   // never hang a request on a slow S&S
  try {
    const r = await fetch(SS_BASE + path, { headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' }, signal: ctrl.signal });
    const txt = await r.text();
    let data; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e && e.message };   // timeout/network → caller falls back
  } finally { clearTimeout(timer); _ssRelease(); }
}

// Map one S&S product row → our ss_products columns. `meta` = the style's metadata
// (brand + descriptive title + category), since the PRODUCT feed omits brand and only
// carries the style NUMBER in styleName — so New In can show "Gildan Ultra Cotton…".
function mapProduct(p, meta) {
  return {
    sku: String(p.sku || p.skuID || p.gtin || ''),
    style_id: p.styleID != null ? String(p.styleID) : (meta && meta.styleID != null ? String(meta.styleID) : null),
    brand: (meta && meta.brand) || p.brandName || null,
    style_name: (meta && meta.title) || p.styleName || null,
    color: p.colorName || null,
    color_code: p.colorCode || null,
    size: p.sizeName || null,
    // "yourPrice"/piece is the per-unit cost; fall back through the price fields S&S may return.
    price: num(p.customerPrice ?? p.piecePrice ?? p.salePrice),
    map_price: num(p.mapPrice),
    qty: int(p.qty),
    warehouses: JSON.stringify(Array.isArray(p.warehouses) ? p.warehouses : []),
    image: ssImg(p.colorFrontImage || p.colorSwatchImage),   // relative path → CDN-prefixed
    category: (meta && meta.category) || p.baseCategory || null,
    data: p,
  };
}

export function ssRoutes(app, requireAuth, requireStaff, requireAdmin) {
  // ── Image proxy (PUBLIC) ──────────────────────────────────────────────────
  // S&S's CDN refuses cross-origin browser loads (403 + Cross-Origin-Resource-Policy),
  // so the browser can't hot-link cdn.ssactivewear.com from our site. Fetch the image
  // server-side and re-serve it same-origin. No auth (an <img> can't send one), but locked
  // to the S&S CDN host + image paths only, with a timeout + content-type check, so it can't
  // be used as an open/SSRF proxy.
  app.get('/api/ss/img', async (req, reply) => {
    const u = String((req.query && req.query.u) || '');
    if (!/^https:\/\/cdn\.ssactivewear\.com\/[\w./%-]+$/i.test(u)) { reply.code(400); return { error: 'only S&S CDN images may be proxied' }; }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'egfulfill/1.0', Accept: 'image/*' } });
      clearTimeout(timer);
      if (!r.ok) { reply.code(r.status); return { error: 'upstream ' + r.status }; }
      const ct = r.headers.get('content-type') || 'image/jpeg';
      if (!/^image\//i.test(ct)) { reply.code(415); return { error: 'not an image' }; }
      const buf = Buffer.from(await r.arrayBuffer());
      reply.header('Content-Type', ct);
      reply.header('Cache-Control', 'public, max-age=86400, immutable');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      return reply.send(buf);
    } catch (e) { reply.code(502); return { error: 'proxy failed: ' + (e && e.message ? e.message : 'error') }; }
  });

  // Synced blanks live in their own table (created idempotently at load, like the other integrations).
  q(`create table if not exists ss_products (
       sku text primary key,
       style_id text, brand text, style_name text,
       color text, color_code text, size text,
       price numeric, map_price numeric,
       qty integer default 0,
       warehouses jsonb default '[]',
       image text, category text,
       data jsonb,
       synced_at timestamptz default now()
     )`).catch(() => {});

  // Resolved style thumbnails. styleImage is null on this account, so the New In grid resolves the
  // first product's colorFrontImage per card — expensive live. Cache it here so the FIRST viewer
  // resolves a style (one light S&S call) and everyone after is instant. Progressive speedup, no sync.
  q(`create table if not exists ss_style_images (
       style_id text primary key,
       image text,
       at timestamptz default now()
     )`).catch(() => {});
  q(`alter table ss_style_images add column if not exists colors jsonb`).catch(() => {});
  // Persisted copy of the live styles LIST, so a cold server / S&S outage still has a fallback
  // (New In never dies with "couldn't reach the S&S catalog").
  q(`create table if not exists ss_styles_cache (id int primary key, data jsonb, at timestamptz default now())`).catch(() => {});

  // Favorited S&S styles — the factory's shortlist, shared across staff (like the
  // backorder/PO queues). Keyed by S&S styleID so favoriting is idempotent.
  q(`create table if not exists ss_favorites (
       style_id text primary key,
       brand text, style_name text, category text, image text,
       data jsonb,
       created_by integer,
       created_at timestamptz default now()
     )`).catch(() => {});

  // ── Status: is it configured, and what's synced? ────────────────────────────
  app.get('/api/ss/status', { preHandler: requireStaff }, async () => {
    let count = 0, last = null;
    try {
      const r = await q('select count(*)::int as n, max(synced_at) as last from ss_products');
      count = r.rows[0]?.n || 0; last = r.rows[0]?.last || null;
    } catch (e) {}
    return { configured: creds(), account: SS_ACCOUNT ? '…' + SS_ACCOUNT.slice(-4) : null, base: SS_BASE, synced_count: count, last_sync: last };
  });

  // ── Browse the LIVE S&S catalog (styles) — powers the "New In" tab ───────────
  // Hits S&S directly (NOT our synced ss_products table), so it shows their full
  // live catalog. The whole style list (~thousands of small rows) is cached in
  // memory for 5 min so search/paging keystrokes don't refetch it every time.
  let _stylesCache = { at: 0, data: null };
  async function fetchStyles() {
    const now = Date.now();
    if (_stylesCache.data && (now - _stylesCache.at) < 30 * 60 * 1000) return _stylesCache.data;   // 30-min cache: the catalog list rarely changes
    try {
    const r = await ssGet('/styles/?fields=styleID,brandName,title,baseCategory,styleImage', 30000);   // 30s — big list
    if (!r.ok || !Array.isArray(r.data)) { const e = new Error('S&S styles fetch failed (' + r.status + ')'); e.status = r.status; throw e; }
    const mapped = r.data.map((s) => ({
      styleID: String(s.styleID),
      brand: s.brandName || '',
      title: ((s.brandName ? s.brandName + ' ' : '') + (s.title || '')).trim() || (s.title || ''),
      category: s.baseCategory || '',
      // styleImage is frequently null/unusable on this account. ssImg CDN-prefixes any
      // relative path (incl. a bare filename with no leading slash), so the client's fast
      // path works when it IS present; when it's null the client lazy-loads the reliable
      // colorFrontImage via GET /api/ss/style/:id (see eg-products-tabs.js).
      image: ssImg(s.styleImage)
    })).filter((s) => s.styleID);
    _stylesCache = { at: now, data: mapped };
    q(`insert into ss_styles_cache (id, data, at) values (1,$1,now()) on conflict (id) do update set data=excluded.data, at=now()`, [JSON.stringify(mapped)]).catch(() => {});
    return mapped;
    } catch (e) {
      // S&S slow / rate-limited / timed out — serve the last-known list so New In never dies with
      // "couldn't reach". Memory first, then the DB copy (survives restarts + prolonged S&S outages).
      if (_stylesCache.data) return _stylesCache.data;
      try {
        const row = (await q('select data from ss_styles_cache where id=1')).rows[0];
        if (row && Array.isArray(row.data) && row.data.length) { _stylesCache = { at: 0, data: row.data }; return row.data; }
      } catch (e2) {}
      throw e;
    }
  }

  app.get('/api/ss/styles', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured — set SS_ACCOUNT_NUMBER and SS_API_KEY.' }; }
    const brand = (req.query?.brand || '').trim().toLowerCase();
    const search = (req.query?.search || '').trim().toLowerCase();
    const limit = Math.min(120, Math.max(1, parseInt(req.query?.limit, 10) || 60));
    const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
    try {
      let list = await fetchStyles();
      if (brand) list = list.filter((s) => s.brand.toLowerCase() === brand);
      if (search) list = list.filter((s) => (s.title + ' ' + s.brand + ' ' + s.category).toLowerCase().includes(search));
      const total = list.length;
      let favs = new Set();
      try { const fr = await q('select style_id from ss_favorites'); favs = new Set(fr.rows.map((r) => String(r.style_id))); } catch (e) {}
      const styles = list.slice(offset, offset + limit).map((s) => ({ ...s, favorited: favs.has(s.styleID) }));
      return { total, styles, cached: (Date.now() - _stylesCache.at) > 500 };
    } catch (e) { reply.code(e.status || 502); return { error: 'S&S fetch error: ' + e.message }; }
  });

  // ── New In from the SYNCED catalog (ss_products) — INSTANT: one grouped query, images included,
  // ZERO per-style live calls. The client prefers this and falls back to live /api/ss/styles when
  // the catalog hasn't been synced yet (returns {synced:false}). Run POST /api/ss/sync to populate.
  app.get('/api/ss/styles-synced', { preHandler: requireStaff }, async (req, reply) => {
    const search = (req.query?.search || '').trim().toLowerCase();
    const limit = Math.min(120, Math.max(1, parseInt(req.query?.limit, 10) || 60));
    const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
    const proxify = (u) => (!u ? null : (/^https:\/\/cdn\.ssactivewear\.com\//i.test(u) ? '/api/ss/img?u=' + encodeURIComponent(u) : u));
    try {
      const g = await q(`select style_id, min(brand) as brand, min(style_name) as title, min(category) as category,
                                (array_agg(image) filter (where image is not null))[1] as image,
                                array_agg(distinct color) filter (where color is not null) as colors,
                                min(price) as price, count(*)::int as variants
                         from ss_products where style_id is not null group by style_id`);
      if (!g.rows.length) return { synced: false, total: 0, styles: [] };
      let favs = new Set();
      try { const fr = await q('select style_id from ss_favorites'); favs = new Set(fr.rows.map((r) => String(r.style_id))); } catch (e) {}
      let list = g.rows.map((r) => ({
        styleID: String(r.style_id), brand: r.brand || '', title: r.title || ('Style ' + r.style_id),
        category: r.category || '', image: proxify(r.image), price: r.price != null ? Number(r.price) : null,
        colors: Array.isArray(r.colors) ? r.colors : [],
        favorited: favs.has(String(r.style_id)),
      }));
      if (search) list = list.filter((s) => (s.title + ' ' + s.brand + ' ' + s.category).toLowerCase().includes(search));
      list.sort((a, b) => (a.brand + a.title).localeCompare(b.brand + b.title));
      return { synced: true, total: list.length, styles: list.slice(offset, offset + limit) };
    } catch (e) { reply.code(500); return { error: 'synced styles error: ' + e.message }; }
  });

  // ── ONE style's detail — colors, sizes, price + description (powers "Add to catalog") ─
  // Hits S&S directly (per-style product feed is small). Returns everything the
  // create-product modal needs to prefill: distinct colors/sizes, a min price, an image
  // and a description (fetched from /styles/:id when the field is available).
  app.get('/api/ss/style/:id', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured — set SS_ACCOUNT_NUMBER and SS_API_KEY.' }; }
    const id = String(req.params.id || '').trim();
    if (!id) { reply.code(400); return { error: 'styleID required' }; }
    const _hit = _styleCache.get(id);
    if (_hit && (Date.now() - _hit.at) < STYLE_TTL) return _hit.data;   // instant on repeat
    try {
      const pr = await ssGet('/products/?style=' + encodeURIComponent(id) +
        '&fields=sku,colorName,sizeName,piecePrice,customerPrice,colorFrontImage,colorBackImage,colorSideImage,colorOnModelFrontImage,colorOnModelBackImage,styleName,brandName');
      if (!pr.ok || !Array.isArray(pr.data)) { reply.code(pr.status || 502); return { error: 'S&S style fetch failed (' + pr.status + ')' }; }
      const rows = pr.data;

      // Distinct colors + sizes, order-preserving (first-seen wins).
      const colors = [], sizes = [], cseen = new Set(), sseen = new Set();
      let price = null, brand = null, styleName = null, image = null;
      // One front image per colour + all OTHER angle/model photos (deduped, never a colour's front).
      const colorImages = {}, frontUrls = new Set(), extraSet = new Set();
      for (const p of rows) {
        const c = p.colorName; if (c && !cseen.has(c)) { cseen.add(c); colors.push(c); }
        const s = p.sizeName;  if (s && !sseen.has(s)) { sseen.add(s); sizes.push(s); }
        const cp = num(p.customerPrice ?? p.piecePrice);
        if (cp != null && (price == null || cp < price)) price = cp;
        if (!brand && p.brandName) brand = p.brandName;
        if (!styleName && p.styleName) styleName = p.styleName;
        const front = ssImg(p.colorFrontImage);
        if (!image && front) image = front;
        if (c && front && !colorImages[c]) { colorImages[c] = front; frontUrls.add(front); }
        [p.colorBackImage, p.colorSideImage, p.colorOnModelFrontImage, p.colorOnModelBackImage].forEach((raw) => { const im = ssImg(raw); if (im) extraSet.add(im); });
      }

      // Style-level metadata (descriptive title + description); best-effort — some
      // accounts/styles omit `description`, so we guard and fall back gracefully.
      let title = ((brand ? brand + ' ' : '') + (styleName || '')).trim() || styleName || ('Style ' + id);
      let description = '';
      try {
        const sr = await ssGet('/styles/' + encodeURIComponent(id) + '?fields=styleID,brandName,title,baseCategory,description,styleImage');
        const meta = Array.isArray(sr.data) ? sr.data[0] : sr.data;
        if (sr.ok && meta) {
          const mBrand = meta.brandName || brand || '';
          const mTitle = meta.title || styleName || '';
          const t = ((mBrand ? mBrand + ' ' : '') + mTitle).trim();
          if (t) title = t;
          if (meta.description) description = cleanDesc(meta.description);
          if (!image) { const im = ssImg(meta.styleImage); if (im) image = im; }
        }
      } catch (e) {}

      // Proxy S&S CDN urls (blocked cross-origin for canvas) → same-origin, canvas-safe for the design maker.
      const proxify = (u) => (!u ? null : (/^https:\/\/cdn\.ssactivewear\.com\//i.test(u) ? '/api/ss/img?u=' + encodeURIComponent(u) : u));
      const colorImagesProx = {};
      Object.keys(colorImages).forEach((k) => { const pu = proxify(colorImages[k]); if (pu) colorImagesProx[k] = pu; });
      const extraImages = [...extraSet].filter((u) => !frontUrls.has(u)).slice(0, 24).map(proxify).filter(Boolean);
      const out = { styleID: id, title, brand: brand || null, description, image: proxify(image), price, colors, sizes, colorImages: colorImagesProx, extraImages };
      _styleCache.set(id, { at: Date.now(), data: out });   // cache for repeat opens
      return out;
    } catch (e) { reply.code(e.status || 502); return { error: 'S&S fetch error: ' + e.message }; }
  });

  // ── Lightweight, DB-cached style THUMBNAIL — powers the New In grid ──────────
  // vs /api/ss/style/:id (two S&S calls + full colors/sizes/description just for an image), this
  // does ONE small products call (image fields only) and PERSISTS the result in ss_style_images.
  // First viewer of a style pays one light call; everyone after (any user/session) reads the DB.
  app.get('/api/ss/style-img/:id', { preHandler: requireStaff }, async (req, reply) => {
    const id = String(req.params.id || '').trim();
    if (!id) { reply.code(400); return { error: 'styleID required' }; }
    try {
      const hit = (await q('select image, colors from ss_style_images where style_id=$1', [id])).rows[0];
      if (hit && hit.image) return { styleID: id, image: hit.image, colors: hit.colors || [] };   // cached → instant
    } catch (e) {}
    let image = '';
    const colors = [], seen = new Set();
    try {
      const pr = await ssGet('/products/?style=' + encodeURIComponent(id) + '&fields=colorFrontImage,colorSwatchImage,colorName');
      if (pr.ok && Array.isArray(pr.data)) {
        for (const p of pr.data) {
          if (!image) { const im = ssImg(p.colorFrontImage || p.colorSwatchImage); if (im) image = im; }
          const c = String(p.colorName || '').trim();
          if (c && !seen.has(c.toLowerCase()) && colors.length < 16) { seen.add(c.toLowerCase()); colors.push(c); }
        }
      }
    } catch (e) {}
    // Only persist a real hit, so a transient failure retries next time instead of caching a blank.
    if (image) { try { await q(`insert into ss_style_images (style_id, image, colors, at) values ($1,$2,$3,now())
                                on conflict (style_id) do update set image=excluded.image, colors=excluded.colors, at=now()`, [id, image, JSON.stringify(colors)]); } catch (e) {} }
    return { styleID: id, image, colors };
  });

  // ── BATCH thumbnail resolver — resolve a whole page of styles in ONE request ──
  // The client sends all the page's style IDs; we check the DB cache in a single query and resolve
  // the misses IN PARALLEL (bounded), caching each. Far fewer round-trips than /style-img per card,
  // so the first/cold page load is much faster. GET /api/ss/style-imgs?ids=123,456,789
  app.get('/api/ss/style-imgs', { preHandler: requireStaff }, async (req, reply) => {
    const raw = String((req.query && req.query.ids) || '').trim();
    if (!raw) return {};
    const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 120);
    const out = {};
    try {
      const rows = (await q('select style_id, image, colors from ss_style_images where style_id = any($1)', [ids])).rows;
      for (const r of rows) { if (r.image) out[String(r.style_id)] = { image: r.image, colors: r.colors || [] }; }
    } catch (e) {}
    const misses = ids.filter((id) => !out[id]);
    const CONC = 10;   // parallel S&S calls per wave — well under the 150/sec limit
    for (let i = 0; i < misses.length; i += CONC) {
      await Promise.all(misses.slice(i, i + CONC).map(async (id) => {
        let image = ''; const colors = [], seen = new Set();
        try {
          const pr = await ssGet('/products/?style=' + encodeURIComponent(id) + '&fields=colorFrontImage,colorSwatchImage,colorName');
          if (pr.ok && Array.isArray(pr.data)) {
            for (const p of pr.data) {
              if (!image) { const im = ssImg(p.colorFrontImage || p.colorSwatchImage); if (im) image = im; }
              const c = String(p.colorName || '').trim();
              if (c && !seen.has(c.toLowerCase()) && colors.length < 16) { seen.add(c.toLowerCase()); colors.push(c); }
            }
          }
        } catch (e) {}
        if (image) {
          out[id] = { image, colors };
          try { await q(`insert into ss_style_images (style_id, image, colors, at) values ($1,$2,$3,now())
                         on conflict (style_id) do update set image=excluded.image, colors=excluded.colors, at=now()`, [id, image, JSON.stringify(colors)]); } catch (e) {}
        }
      }));
    }
    return out;
  });

  // ── Catalog PRE-WARM — resolve EVERY style's thumbnail + colours into ss_style_images so New In
  // loads from our DB instead of live S&S (near-instant, no per-browse S&S calls). Staff-triggered,
  // runs in the BACKGROUND; poll /api/ss/warm/status. POST /api/ss/warm/stop to cancel.
  let _warm = { running: false, total: 0, done: 0, startedAt: 0, error: null };
  app.post('/api/ss/warm', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured' }; }
    if (_warm.running) return { ok: true, already: true, running: true, done: _warm.done, total: _warm.total };
    _warm = { running: true, total: 0, done: 0, startedAt: Date.now(), error: null };
    (async () => {
      try {
        const styles = await fetchStyles();
        const have = new Set(((await q('select style_id from ss_style_images where image is not null')).rows).map((r) => String(r.style_id)));
        const allIds = styles.map((s) => String(s.styleID));
        _warm.total = allIds.length;
        const CONC = 2;   // leaves headroom under the global SS_MAX cap so live browsing gets slots too
        // Up to 3 passes — each re-queries what's STILL uncached, so styles that failed under load
        // (S&S slow/rate-limited) get retried instead of left blank. Stops early when nothing remains.
        for (let pass = 0; pass < 3 && _warm.running; pass++) {
          const have = new Set(((await q('select style_id from ss_style_images where image is not null')).rows).map((r) => String(r.style_id)));
          const todo = allIds.filter((id) => !have.has(id));
          _warm.done = _warm.total - todo.length;
          if (!todo.length) break;
          for (let i = 0; i < todo.length && _warm.running; i += CONC) {
            await Promise.all(todo.slice(i, i + CONC).map(async (id) => {
              try {
                let image = ''; const colors = [], seen = new Set();
                const pr = await ssGet('/products/?style=' + encodeURIComponent(id) + '&fields=colorFrontImage,colorSwatchImage,colorName', 20000);
                if (pr.ok && Array.isArray(pr.data)) {
                  for (const p of pr.data) {
                    if (!image) { const im = ssImg(p.colorFrontImage || p.colorSwatchImage); if (im) image = im; }
                    const c = String(p.colorName || '').trim();
                    if (c && !seen.has(c.toLowerCase()) && colors.length < 16) { seen.add(c.toLowerCase()); colors.push(c); }
                  }
                }
                if (image) { await q(`insert into ss_style_images (style_id, image, colors, at) values ($1,$2,$3,now())
                                      on conflict (style_id) do update set image=excluded.image, colors=excluded.colors, at=now()`, [id, image, JSON.stringify(colors)]); _warm.done++; }
              } catch (e) {}
            }));
            await new Promise((r) => setTimeout(r, 300));   // gentle pacing between waves
          }
        }
      } catch (e) { _warm.error = e.message; }
      finally { _warm.running = false; }
    })();
    return { ok: true, started: true };
  });
  app.get('/api/ss/warm/status', { preHandler: requireStaff }, async () => {
    let cached = 0;
    try { cached = (await q('select count(*)::int n from ss_style_images where image is not null')).rows[0]?.n || 0; } catch (e) {}
    return { running: _warm.running, total: _warm.total, done: _warm.done, error: _warm.error, cached };
  });
  app.post('/api/ss/warm/stop', { preHandler: requireStaff }, async () => { _warm.running = false; return { ok: true }; });

  // ── Favorites (staff-shared shortlist of S&S styles) ─────────────────────────
  app.get('/api/ss/favorites', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const r = await q('select style_id, brand, style_name, category, image from ss_favorites order by created_at desc');
      return { favorites: r.rows.map((x) => ({ styleID: x.style_id, brand: x.brand, title: x.style_name, category: x.category, image: x.image, favorited: true })) };
    } catch (e) { reply.code(500); return { error: e.message }; }
  });
  app.post('/api/ss/favorites', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const id = String(b.styleID || b.style_id || '').trim();
    if (!id) { reply.code(400); return { error: 'styleID required' }; }
    try {
      await q(
        `insert into ss_favorites (style_id, brand, style_name, category, image, created_by)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (style_id) do update set brand=excluded.brand, style_name=excluded.style_name,
           category=excluded.category, image=excluded.image`,
        [id, b.brand || null, b.title || b.style_name || null, b.category || null, b.image || null, req.user?.id || null]
      );
      return { ok: true, styleID: id, favorited: true };
    } catch (e) { reply.code(500); return { error: e.message }; }
  });
  app.delete('/api/ss/favorites/:styleId', { preHandler: requireStaff }, async (req, reply) => {
    try { await q('delete from ss_favorites where style_id=$1', [String(req.params.styleId)]); return { ok: true, favorited: false }; }
    catch (e) { reply.code(500); return { error: e.message }; }
  });

  // ── SYNC catalog + inventory into ss_products (BOUNDED) ──────────────────────
  // Body: { styleIds:[...] }  OR  { brands:[...] }  (at least one required so we
  // never pull the whole catalog). Upserts by sku; refreshes price/qty/warehouses.
  app.post('/api/ss/sync', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured — set SS_ACCOUNT_NUMBER and SS_API_KEY.' }; }
    const body = req.body || {};
    const styleIds = Array.isArray(body.styleIds) ? body.styleIds.map(String) : [];
    const brands = Array.isArray(body.brands) ? body.brands.map(String) : [];
    if (!styleIds.length && !brands.length) {
      reply.code(400);
      return { error: 'Specify styleIds[] or brands[] to sync — the full S&S catalog is too large to pull at once.' };
    }
    // Style metadata (brand, descriptive title, category) — the product feed omits these,
    // so fetch the (far smaller) style list once and index it by styleID.
    let styleMap = {};
    try {
      const sr = await ssGet('/styles/?fields=styleID,brandName,title,baseCategory');
      if (sr.ok && Array.isArray(sr.data)) sr.data.forEach((s) => {
        const brand = s.brandName || '';
        const title = ((brand ? brand + ' ' : '') + (s.title || '')).trim();
        styleMap[String(s.styleID)] = { styleID: s.styleID, brand: brand || null, title: title || null, category: s.baseCategory || null };
      });
    } catch (e) {}

    // Resolve which styles to sync WITHOUT ever pulling the full product feed (that OOMs a 1GB VPS):
    // the brand path picks styleIds from the small styles list, then we fetch products PER STYLE.
    let toSync = styleIds.slice();
    if (!toSync.length && brands.length) {
      const set = new Set(brands.map((b) => b.toLowerCase()));
      toSync = Object.values(styleMap).filter((m) => set.has(String(m.brand || '').toLowerCase())).map((m) => String(m.styleID));
    }
    toSync = toSync.slice(0, 300);   // hard cap so a big brand can't run away on memory/time

    let n = 0, fetched = 0;
    for (const sid of toSync) {
      let prods = [];
      try { const r = await ssGet('/products/?style=' + encodeURIComponent(sid) + '&fields=' + PRODUCT_FIELDS); if (r.ok && Array.isArray(r.data)) prods = r.data; } catch (e) {}
      fetched += prods.length;
      // GUARANTEE style_id: we fetched /products/?style=<sid>, so every product here belongs to
      // <sid>. Fall back to { styleID: sid } so a missing p.styleID / empty styleMap can never leave
      // style_id null — null style_ids all collapse into ONE card via GROUP BY style_id in New In.
      const meta = styleMap[String(sid)] || { styleID: sid };
      for (const raw of prods) {
        const p = mapProduct(raw, styleMap[String(raw.styleID)] || meta);
        if (p.style_id == null) p.style_id = String(sid);
        if (!p.sku) continue;
        try {
          await q(
            `insert into ss_products (sku, style_id, brand, style_name, color, color_code, size, price, map_price, qty, warehouses, image, category, data, synced_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
             on conflict (sku) do update set
               style_id=excluded.style_id, brand=excluded.brand, style_name=excluded.style_name,
               color=excluded.color, color_code=excluded.color_code, size=excluded.size,
               price=excluded.price, map_price=excluded.map_price, qty=excluded.qty,
               warehouses=excluded.warehouses, image=excluded.image, category=excluded.category,
               data=excluded.data, synced_at=now()`,
            [p.sku, p.style_id, p.brand, p.style_name, p.color, p.color_code, p.size,
             p.price, p.map_price, p.qty, p.warehouses, p.image, p.category, p.data]
          );
          n++;
        } catch (e) {}
      }
      prods = null;   // let each style's payload GC before the next
    }
    return { ok: true, synced: n, fetched, styles: toSync.length };
  });

  // ── List synced S&S products (the "New In" tab feed) — search/filter/paged ───
  app.get('/api/ss/products', { preHandler: requireStaff }, async (req, reply) => {
    const search = (req.query?.search || '').trim();
    const brand = (req.query?.brand || '').trim();
    const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
    const where = [], args = [];
    if (search) { args.push('%' + search.toLowerCase() + '%'); where.push(`(lower(sku) like $${args.length} or lower(style_name) like $${args.length} or lower(brand) like $${args.length})`); }
    if (brand) { args.push(brand); where.push(`brand = $${args.length}`); }
    const wc = where.length ? 'where ' + where.join(' and ') : '';
    try {
      const cnt = await q(`select count(*)::int as n from ss_products ${wc}`, args);
      args.push(limit); args.push(offset);
      const r = await q(`select sku, style_id, brand, style_name, color, color_code, size, price, map_price, qty, warehouses, image, category, synced_at
                         from ss_products ${wc} order by brand, style_name, size limit $${args.length - 1} offset $${args.length}`, args);
      return { total: cnt.rows[0]?.n || 0, products: r.rows };
    } catch (e) { reply.code(500); return { error: e.message }; }
  });

  // ── LIVE inventory for one SKU (per-warehouse) — for on-demand stock checks ──
  app.get('/api/ss/live/:sku', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured.' }; }
    const sku = encodeURIComponent(req.params.sku);
    try {
      const r = await ssGet('/products/' + sku + '?fields=sku,qty,warehouses,customerPrice,mapPrice');
      if (!r.ok) { reply.code(r.status || 502); return { error: 'S&S live lookup failed', status: r.status }; }
      const p = Array.isArray(r.data) ? r.data[0] : r.data;
      return { sku: req.params.sku, qty: int(p?.qty), warehouses: p?.warehouses || [], price: num(p?.customerPrice), map_price: num(p?.mapPrice) };
    } catch (e) { reply.code(502); return { error: 'S&S fetch error: ' + e.message }; }
  });

  // ── S&S distribution centers, optionally ranked CLOSEST-FIRST to ?near=lat,lng ─
  // (your warehouse). The PO flow defaults the pickup DC to the nearest one WITH stock
  // while still listing every DC to choose from.
  app.get('/api/ss/warehouses', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured.' }; }
    // Prefer the live S&S list if it ever returns rows; otherwise use the fixed DC list.
    let list = [];
    try { const r = await ssGet('/warehouses/'); if (r.ok && Array.isArray(r.data) && r.data.length) list = r.data; } catch (e) {}
    if (!list.length) list = SS_DC.map((d) => ({ ...d }));
    const near = String(req.query?.near || '').split(',').map(Number);
    if (near.length === 2 && isFinite(near[0]) && isFinite(near[1])) {
      list = list.map((w) => {
        const abbr = String(w.abbr || w.warehouseAbbr || w.warehouseCode || w.code || '').toUpperCase().slice(0, 2);
        const c = SS_WH_COORDS[abbr] || (isFinite(w.lat) && isFinite(w.lng) ? [w.lat, w.lng] : null);
        return { ...w, abbr, distance_mi: c ? Math.round(haversineMi(near[0], near[1], c[0], c[1])) : null };
      }).sort((a, b) => (a.distance_mi ?? 1e9) - (b.distance_mi ?? 1e9));
    }
    return list;
  });
}
