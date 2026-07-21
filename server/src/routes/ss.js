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
/**
 * Swap S&S's image size suffix.  _fs = small, _fm = medium (what they return), _fl = large.
 *
 * Documented on the styles object. It means a thumbnail costs nothing to store and little
 * to move: we keep a URL, not an image, and asking for the SMALL variant on a list row
 * avoids pulling a full-size product photo per line just to draw it at 40px.
 */
export function ssImgSize(u, size = 'fs') {
  if (!u) return u;
  return String(u).replace(/_(fs|fm|fl)(\.[a-z]+)$/i, `_${size}$2`);
}

function ssImg(u) {
  if (!u) return null;
  const str = String(u);
  // Already proxied — don't wrap it twice.
  if (str.startsWith('/api/ss/img')) return str;
  const abs = /^https?:/i.test(str) ? str : SS_CDN + str.replace(/^\//, '');
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
async function ssGet(path, timeoutMs, skipLimit) {
  if (!skipLimit) await _ssAcquire();   // the critical styles LIST passes skipLimit so image resolves can't starve it
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
  } finally { clearTimeout(timer); if (!skipLimit) _ssRelease(); }
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
    // NOT resized. The doc promises _fs/_fm/_fl for brandImage and styleImage only —
    // colour images are undocumented, and asking for a variant that may not exist trades
    // a working picture for a broken one to save a few KB.
    image: ssImg(p.colorFrontImage || p.colorSwatchImage),
    category: (meta && meta.category) || p.baseCategory || null,
    data: p,
  };
}

export function ssRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse) {
  // ── Image proxy (PUBLIC) ──────────────────────────────────────────────────
  // S&S's CDN refuses cross-origin browser loads (403 + Cross-Origin-Resource-Policy),
  // so the browser can't hot-link cdn.ssactivewear.com from our site. Fetch the image
  // server-side and re-serve it same-origin. No auth (an <img> can't send one), but locked
  // to the S&S CDN host + image paths only, with a timeout + content-type check, so it can't
  // be used as an open/SSRF proxy.
  /**
   * Supplier image proxy, cached into OUR storage.
   *
   * Why proxy at all: the sync stores a URL, not a picture, so the catalogue costs nothing
   * to keep — but S&S's CDN sets Cross-Origin-Resource-Policy and 403s obvious bots, so a
   * browser can't load their URL directly from our origin. It has to come through us.
   *
   * Why CACHE: re-fetching their CDN on every render makes every product list depend on
   * someone else's rate limit and bot rules, and this path has never been proven to work
   * from the VPS (the old app never displayed these images at all). Fetched once, stored,
   * and served from our own bucket afterwards, a blocked or slow upstream stops mattering
   * from the second view onward.
   *
   * Keyed by a hash of the SOURCE URL — which is per sku and colour, so each variant keeps
   * its own picture and an identical image fetched twice collapses to one object.
   */
  app.get('/api/ss/img', async (req, reply) => {
    const u = String((req.query && req.query.u) || '');
    // Their docs give image URLs as https://www.ssactivewear.com/{Image}; our sync built
    // cdn.ssactivewear.com. Accept BOTH rather than bet on one — a wrong host shows up as
    // a broken <img>, which is the hardest kind of failure to notice.
    // Allowlisted supplier hosts only — this endpoint fetches whatever URL it's given, so
    // an open list would make it a server-side request forgery tool pointed at our own
    // network. Otto is included because its product images have the same problem S&S's do
    // and there is no second proxy.
    if (!/^https:\/\/([\w-]+\.)?(ssactivewear|ottocap)\.com\/[\w./%-]+$/i.test(u)) {
      console.error(`[ss/img] refused non-supplier host: ${u.slice(0, 120)}`);
      reply.code(400); return { error: 'only supplier image hosts may be proxied' };
    }

    const { storageEnabled, putObject, getObject } = await import('../storage.js');
    const { createHash } = await import('crypto');
    const ext = (u.split('?')[0].match(/\.[a-z0-9]{2,5}$/i) || ['.jpg'])[0];
    const key = `supplier-img/${createHash('sha256').update(u).digest('hex').slice(0, 32)}${ext}`;

    // Served from our bucket if we already have it.
    if (storageEnabled()) {
      try {
        const hit = await getObject(key);
        if (hit && hit.body && hit.body.length) {
          reply.header('Content-Type', hit.contentType || 'image/jpeg');
          reply.header('Cache-Control', 'public, max-age=604800, immutable');
          return reply.send(hit.body);
        }
      } catch { /* not cached yet — fetch below */ }
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      // A browser-ish User-Agent + Referer: their CDN 403s anything that looks like a bot,
      // which a bare 'egfulfill/1.0' does.
      const UA = 'Mozilla/5.0 (compatible; egfulfill/1.0)';
      const get = (url) => fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'image/*', Referer: 'https://www.ssactivewear.com/' } });
      let r = await get(u);
      // Self-heal: a missing size variant or the wrong host shouldn't mean no picture.
      if (!r.ok) {
        const alts = [u.replace(/_(fs|fl)(\.[a-z]+)$/i, '_fm$2'), u.replace('//cdn.', '//www.'), u.replace('//www.', '//cdn.')]
          .filter((x, i, a) => x !== u && a.indexOf(x) === i);
        for (const alt of alts) { const rr = await get(alt); if (rr.ok) { r = rr; break; } }
      }
      clearTimeout(timer);
      if (!r.ok) {
        // Say so in the log. A broken <img> tells nobody anything, and silence here is why
        // nobody noticed these never worked.
        console.error(`[ss/img] upstream ${r.status} for ${u}`);
        reply.code(r.status); return { error: 'upstream ' + r.status, url: u };
      }
      const type = r.headers.get('content-type') || 'image/jpeg';
      if (!/^image\//i.test(type)) {
        console.error(`[ss/img] non-image content-type "${type}" for ${u}`);
        reply.code(502); return { error: 'upstream returned ' + type + ', not an image', url: u };
      }
      const buf = Buffer.from(await r.arrayBuffer());
      // Best-effort store: a caching failure must never cost the picture we just fetched.
      if (storageEnabled()) putObject(key, buf, type, 'private').catch(() => {});
      reply.header('Content-Type', type);
      reply.header('Cache-Control', 'public, max-age=604800, immutable');
      return reply.send(buf);
    } catch (e) {
      console.error(`[ss/img] fetch error for ${u}: ${e.message}`);
      reply.code(502); return { error: 'image fetch failed: ' + e.message };
    }
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
  // Style-level price RANGE (min/max piecePrice across the style's SKUs). S&S has no
  // price on the /styles list — only per-SKU on /products — so the New In grid showed no
  // price at all next to Otto's. Resolved lazily in the SAME products call that fetches
  // the thumbnail (no extra API traffic). null until first resolved.
  q(`alter table ss_style_images add column if not exists price_min numeric`).catch(() => {});
  q(`alter table ss_style_images add column if not exists price_max numeric`).catch(() => {});
  // Persisted copy of the live styles LIST, so a cold server / S&S outage still has a fallback
  // (New In never dies with "couldn't reach the S&S catalog").
  q(`create table if not exists ss_styles_cache (id int primary key, data jsonb, at timestamptz default now())`).catch(() => {});

  // Favorited S&S styles — the factory's shortlist, shared across staff (like the
  // backorder/PO queues). Keyed by S&S styleID so favoriting is idempotent.
  q(`create table if not exists ss_favorites (
       style_id text primary key,
       brand text, style_name text, category text, image text,
       data jsonb,
       created_by uuid,
       created_at timestamptz default now()
     )`).catch(() => {});
  // created_by was declared `integer` against a uuid users.id, so it could never have
  // stored a value — and the insert wrote req.user.id, which the JWT doesn't carry
  // (it signs `sub`), so it was always NULL anyway. Converting is therefore lossless.
  // Guarded on the current type so it can't touch a column that is already uuid.
  q(`do $$ begin
       if exists (select 1 from information_schema.columns
                   where table_name='ss_favorites' and column_name='created_by' and data_type='integer') then
         alter table ss_favorites alter column created_by type uuid using null::uuid;
       end if;
     end $$;`).catch(() => {});

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
  let _stylesRefreshing = null;
  async function _pullStyles() {
    // styleName + partNumber are what a person actually types — "18500", "00760". They
    // were never fetched, so searching for a style NUMBER matched nothing and the only
    // way in was scrolling. They cost nothing to add to a list we already pull.
    const r = await ssGet('/styles/?fields=styleID,partNumber,brandName,styleName,title,baseCategory,styleImage', 60000, true);   // 60s + BYPASS the cap
    if (!r.ok || !Array.isArray(r.data)) { const e = new Error('S&S styles fetch failed (' + r.status + ')'); e.status = r.status; throw e; }
    const mapped = r.data.map((s) => ({
      styleID: String(s.styleID),
      partNumber: s.partNumber ? String(s.partNumber) : '',
      styleName: s.styleName ? String(s.styleName) : '',
      brand: s.brandName || '',
      title: ((s.brandName ? s.brandName + ' ' : '') + (s.title || '')).trim() || (s.title || ''),
      category: s.baseCategory || '',
      image: ssImg(s.styleImage)
    })).filter((s) => s.styleID);
    _stylesCache = { at: Date.now(), data: mapped };
    q(`insert into ss_styles_cache (id, data, at) values (1,$1,now()) on conflict (id) do update set data=excluded.data, at=now()`, [JSON.stringify(mapped)]).catch(() => {});
    return mapped;
  }
  async function fetchStyles() {
    const now = Date.now();
    if (_stylesCache.data && (now - _stylesCache.at) < 30 * 60 * 1000) return _stylesCache.data;   // fresh in-memory → serve
    // Cold memory (right after a deploy/restart) → SEED from the DB copy so browsing is INSTANT, never hangs.
    if (!_stylesCache.data) {
      try {
        const row = (await q('select data from ss_styles_cache where id=1')).rows[0];
        if (row && Array.isArray(row.data) && row.data.length) _stylesCache = { at: 0, data: row.data };   // mark stale → refreshed below
      } catch (e) {}
    }
    // Have (possibly stale) data → serve NOW + refresh S&S in the BACKGROUND. The request never blocks on S&S.
    if (_stylesCache.data) {
      if (!_stylesRefreshing) _stylesRefreshing = _pullStyles().catch(() => {}).then(() => { _stylesRefreshing = null; });
      return _stylesCache.data;
    }
    // No memory + no DB copy yet (first ever) → pull once, coalesced across concurrent callers.
    if (!_stylesRefreshing) _stylesRefreshing = _pullStyles().then((m) => { _stylesRefreshing = null; return m; }, (e) => { _stylesRefreshing = null; throw e; });
    return _stylesRefreshing;
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
      // Search the NUMBERS as well as the words. "18500" and "Gildan 5000" are how a
      // style is referred to on the floor and on every S&S page; matching only the
      // marketing title meant the fastest way in didn't work.
      if (search) list = list.filter((s) =>
        (s.title + ' ' + s.brand + ' ' + s.category + ' ' + (s.styleName || '') + ' ' + (s.partNumber || ''))
          .toLowerCase().includes(search));
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
      // Search the NUMBERS as well as the words. "18500" and "Gildan 5000" are how a
      // style is referred to on the floor and on every S&S page; matching only the
      // marketing title meant the fastest way in didn't work.
      if (search) list = list.filter((s) =>
        (s.title + ' ' + s.brand + ' ' + s.category + ' ' + (s.styleName || '') + ' ' + (s.partNumber || ''))
          .toLowerCase().includes(search));
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
      const hit = (await q('select image, colors, price_min, price_max from ss_style_images where style_id=$1', [id])).rows[0];
      // Require price too, so rows cached by the OLD image-only resolver re-run once and
      // backfill price + real swatches instead of staying priceless forever.
      if (hit && hit.image && hit.price_min != null) return { styleID: id, image: hit.image, colors: hit.colors || [], price: num(hit.price_min), priceMax: num(hit.price_max) };
    } catch (e) {}
    let image = '';
    const colors = [], seen = new Set();
    let priceMin = null, priceMax = null;
    try {
      // colorSwatchImage → a real supplier swatch (beats guessing a hex from a name like
      // "Dk.Grn/Kha/Brn"). piecePrice → the style's price range.
      const pr = await ssGet('/products/?style=' + encodeURIComponent(id) + '&fields=colorFrontImage,colorSwatchImage,colorName,piecePrice,customerPrice,salePrice');
      if (pr.ok && Array.isArray(pr.data)) {
        for (const p of pr.data) {
          if (!image) { const im = ssImg(p.colorFrontImage || p.colorSwatchImage); if (im) image = im; }
          const c = String(p.colorName || '').trim();
          if (c && !seen.has(c.toLowerCase()) && colors.length < 16) {
            seen.add(c.toLowerCase());
            colors.push({ name: c, swatch: ssImg(p.colorSwatchImage) || null });   // {name, swatch}
          }
          const pp = num(p.customerPrice ?? p.piecePrice ?? p.salePrice);
          if (pp != null && pp > 0) { priceMin = priceMin == null ? pp : Math.min(priceMin, pp); priceMax = priceMax == null ? pp : Math.max(priceMax, pp); }
        }
      }
    } catch (e) {}
    // Only persist a real hit, so a transient failure retries next time instead of caching a blank.
    if (image) { try { await q(`insert into ss_style_images (style_id, image, colors, price_min, price_max, at) values ($1,$2,$3,$4,$5,now())
                                on conflict (style_id) do update set image=excluded.image, colors=excluded.colors, price_min=excluded.price_min, price_max=excluded.price_max, at=now()`,
                                [id, image, JSON.stringify(colors), priceMin, priceMax]); } catch (e) {} }
    return { styleID: id, image, colors, price: priceMin, priceMax };
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
      const rows = (await q('select style_id, image, colors, price_min, price_max from ss_style_images where style_id = any($1)', [ids])).rows;
      // price_min present ⇒ resolved by the NEW path; rows without it fall to `misses` so
      // they re-resolve once and pick up price + real swatches.
      for (const r of rows) { if (r.image && r.price_min != null) out[String(r.style_id)] = { image: r.image, colors: r.colors || [], price: num(r.price_min), priceMax: num(r.price_max) }; }
    } catch (e) {}
    const misses = ids.filter((id) => !out[id]);
    const CONC = 10;   // parallel S&S calls per wave — well under the 150/sec limit
    for (let i = 0; i < misses.length; i += CONC) {
      await Promise.all(misses.slice(i, i + CONC).map(async (id) => {
        let image = ''; const colors = [], seen = new Set();
        let priceMin = null, priceMax = null;
        try {
          const pr = await ssGet('/products/?style=' + encodeURIComponent(id) + '&fields=colorFrontImage,colorSwatchImage,colorName,piecePrice,customerPrice,salePrice');
          if (pr.ok && Array.isArray(pr.data)) {
            for (const p of pr.data) {
              if (!image) { const im = ssImg(p.colorFrontImage || p.colorSwatchImage); if (im) image = im; }
              const c = String(p.colorName || '').trim();
              if (c && !seen.has(c.toLowerCase()) && colors.length < 16) { seen.add(c.toLowerCase()); colors.push({ name: c, swatch: ssImg(p.colorSwatchImage) || null }); }
              const pp = num(p.customerPrice ?? p.piecePrice ?? p.salePrice);
              if (pp != null && pp > 0) { priceMin = priceMin == null ? pp : Math.min(priceMin, pp); priceMax = priceMax == null ? pp : Math.max(priceMax, pp); }
            }
          }
        } catch (e) {}
        if (image) {
          out[id] = { image, colors, price: priceMin, priceMax };
          try { await q(`insert into ss_style_images (style_id, image, colors, price_min, price_max, at) values ($1,$2,$3,$4,$5,now())
                         on conflict (style_id) do update set image=excluded.image, colors=excluded.colors, price_min=excluded.price_min, price_max=excluded.price_max, at=now()`,
                         [id, image, JSON.stringify(colors), priceMin, priceMax]); } catch (e) {}
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
        [id, b.brand || null, b.title || b.style_name || null, b.category || null, b.image || null, req.user?.sub || null]
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
    // Search every field someone actually types. It covered sku, style_name and brand
    // only — so a style NUMBER ("375"), a colour ("sport grey") or a size ("2XL") all
    // matched nothing, which is most of how a garment gets described out loud. Terms are
    // AND-ed, so "gildan 2xl navy" narrows instead of returning everything Gildan.
    for (const term of search.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
      args.push('%' + term + '%');
      const i = args.length;
      where.push(`(lower(sku) like $${i} or lower(coalesce(style_name,'')) like $${i}
                   or lower(coalesce(brand,'')) like $${i} or lower(coalesce(color,'')) like $${i}
                   or lower(coalesce(size,'')) like $${i} or lower(coalesce(style_id,'')) like $${i}
                   or lower(coalesce(category,'')) like $${i})`);
    }
    if (brand) { args.push(brand); where.push(`brand = $${args.length}`); }
    const wc = where.length ? 'where ' + where.join(' and ') : '';
    try {
      const cnt = await q(`select count(*)::int as n from ss_products ${wc}`, args);
      args.push(limit); args.push(offset);
      const r = await q(`select sku, style_id, brand, style_name, color, color_code, size, price, map_price, qty, warehouses, image, category, synced_at
                         from ss_products ${wc} order by brand, style_name, size limit $${args.length - 1} offset $${args.length}`, args);
      // Route every image through OUR proxy at read time. Rows synced before the proxy
      // existed hold the raw cdn.ssactivewear.com URL, which a browser can't load from our
      // origin — it renders as a broken image and never reaches the proxy, so nothing is
      // ever logged and the failure looks like "no images" rather than a blocked fetch.
      // Normalising here fixes existing rows without anyone re-syncing.
      return { total: cnt.rows[0]?.n || 0, products: r.rows.map((p) => ({ ...p, image: ssImg(p.image) })) };
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

  // ── S&S order placement (PO) — SAFE by default ────────────────────────────────
  // Places a purchase order with S&S via REST v2 POST /orders (same Basic auth as catalog).
  // TWO SAFETY GATES so a test can never charge/ship by accident:
  //   1) DRY RUN unless env SS_ORDER_LIVE='1' → returns the built payload WITHOUT contacting S&S.
  //   2) Even when live, testOrder:true (S&S Test mode) unless the request passes { live:true }.
  // CONFIRM the exact S&S Orders field names (line identifier, testOrder flag, shippingMethod)
  // against your S&S "Orders_Post" API doc before flipping SS_ORDER_LIVE — S&S gates those docs.
  // Placing a supplier order SPENDS REAL MONEY the moment the LIVE flag is set.
  // requireStaff included operator, which contradicts every other spend boundary.
  /**
   * Tracking.  GET /v2/TrackingDataByOrderNum/{n,n}  |  ByInvoice  |  ByTrackingNum
   *
   * Turns the PO's tracking field from something someone pastes into something that fills
   * itself — and a number nobody has to type is a number nobody mistypes.
   *
   * Batched (comma-separated), so the whole board refreshes in one call rather than one
   * per order. `?Boxes=true` is passed through because a split shipment has a tracking
   * number PER BOX, and one number standing for four boxes is how three go missing
   * without anyone noticing.
   *
   * Their response nests an array inside an array, like paymentprofiles — flattened here.
   */
  app.get('/api/ss/tracking', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured (SS_ACCOUNT_NUMBER + SS_API_KEY).' }; }
    const q2 = req.query || {};
    const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
    const orders = list(q2.orderNumbers);
    const invoices = list(q2.invoiceNumbers);
    const numbers = list(q2.trackingNumbers);
    const path = orders.length ? '/TrackingDataByOrderNum/' + encodeURIComponent(orders.join(','))
      : invoices.length ? '/TrackingDataByInvoice/' + encodeURIComponent(invoices.join(','))
        : numbers.length ? '/TrackingDataByTrackingNum/' + encodeURIComponent(numbers.join(',')) : null;
    if (!path) { reply.code(400); return { error: 'Pass ?orderNumbers=, ?invoiceNumbers= or ?trackingNumbers=' }; }
    try {
      const r = await ssGet(path + '?Boxes=true&mediatype=json');
      if (r.status === 404) return { shipments: [] };      // nothing shipped yet is an answer
      if (!r.ok) { reply.code(r.status || 502); return { error: 'S&S tracking lookup failed', status: r.status, detail: r.data }; }
      const rows = Array.isArray(r.data) ? r.data.flat(2).filter((x) => x && typeof x === 'object') : [];
      return {
        shipments: rows.map((t) => ({
          carrier: t.carrierName || null,
          tracking: t.trackingNumber || null,
          box: t.boxNumber != null ? String(t.boxNumber) : null,
          origin: t.origin || null,
          orderNumber: t.orderNumber != null ? String(t.orderNumber) : null,
          invoiceNumber: t.invoiceNumber != null ? String(t.invoiceNumber) : null,
          deliveredAt: t.actualDeliveryDateTime || null,
          signedBy: t.signedBy || null,
          // Their latest checkpoint arrives as separate date/time/location strings; joined
          // into one line because that's how it reads on screen anyway.
          lastUpdate: t.latestCheckpoint ? {
            at: [t.latestCheckpoint.checkpointDate, t.latestCheckpoint.checkpointTime].filter(Boolean).join(' ') || null,
            where: t.latestCheckpoint.checkpointLocation || null,
            status: t.latestCheckpoint.checkpointStatusMessage || null,
          } : null,
        })).filter((t) => t.tracking),
      };
    } catch (e) { reply.code(502); return { error: 'S&S fetch error: ' + e.message }; }
  });

  /**
   * Batch stock check.  GET /v2/inventory/{sku,sku,sku}
   *
   * The existing /api/ss/live/:sku asks /products/ for ONE sku. This is the dedicated
   * inventory resource and takes a comma-separated list, so a whole PO can be checked in
   * one call instead of one per line — which is the difference between "is this order
   * fillable" being a click and being twenty.
   *
   * Per-warehouse quantities, because a total of 400 spread across four warehouses is not
   * the same as 400 in one: a split shipment costs more and arrives twice.
   */
  app.get('/api/ss/inventory', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured (SS_ACCOUNT_NUMBER + SS_API_KEY).' }; }
    const skus = String((req.query && req.query.skus) || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!skus.length) { reply.code(400); return { error: 'Pass ?skus=A,B,C' }; }
    try {
      const r = await ssGet('/inventory/' + encodeURIComponent(skus.join(',')) + '?mediatype=json');
      // 404 is THEIR "not found or discontinued", which is an answer about the skus, not a
      // failure of the request — a discontinued blank is exactly what someone needs told.
      if (r.status === 404) return { items: [], notFound: skus, discontinued: true };
      if (!r.ok) { reply.code(r.status || 502); return { error: 'S&S inventory lookup failed', status: r.status, detail: r.data }; }
      const rows = Array.isArray(r.data) ? r.data : [r.data].filter(Boolean);
      const items = rows.map((p) => {
        const warehouses = Array.isArray(p.warehouses) ? p.warehouses : [];
        return {
          sku: p.sku,
          styleId: p.styleID != null ? String(p.styleID) : null,
          total: warehouses.reduce((a, w) => a + (parseInt(w.qty, 10) || 0), 0),
          warehouses: warehouses.map((w) => ({ abbr: w.warehouseAbbr, qty: parseInt(w.qty, 10) || 0 })),
        };
      });
      const found = new Set(items.map((i) => String(i.sku)));
      return { items, notFound: skus.filter((x) => !found.has(x)) };
    } catch (e) { reply.code(502); return { error: 'S&S fetch error: ' + e.message }; }
  });

  /**
   * Invoice PDF.  GET /v2/Invoices/{invoiceNumber}  |  ?OrderNumber=  |  ?Guid=
   *
   * Proxied rather than linked: the URL needs our Basic credentials, so handing the
   * browser a direct link would mean putting the API key in it. Bytes come back as a PDF
   * with a filename, so it opens or saves like any other document.
   *
   * By ORDER number their doc returns every invoice for that order in one document, which
   * is usually what's wanted — a split shipment invoices more than once.
   */
  app.get('/api/ss/invoice', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured (SS_ACCOUNT_NUMBER + SS_API_KEY).' }; }
    const q2 = req.query || {};
    const invoice = String(q2.invoice || '').trim();
    const orderNumber = String(q2.orderNumber || '').trim();
    const guid = String(q2.guid || '').trim();
    const path = invoice ? '/Invoices/' + encodeURIComponent(invoice)
      : orderNumber ? '/Invoices/?OrderNumber=' + encodeURIComponent(orderNumber)
        : guid ? '/Invoices/?Guid=' + encodeURIComponent(guid) : null;
    if (!path) { reply.code(400); return { error: 'Pass ?invoice=, ?orderNumber= or ?guid=' }; }
    try {
      const auth = Buffer.from(SS_ACCOUNT + ':' + SS_KEY).toString('base64');
      const r = await fetch(SS_BASE + path, { headers: { Authorization: 'Basic ' + auth, Accept: 'application/pdf' } });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        reply.code(r.status === 404 ? 404 : 502);
        return { error: r.status === 404 ? 'No invoice found for that reference.' : 'S&S refused the invoice request', status: r.status, detail: t.slice(0, 300) };
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const name = `S-S_Invoice_${invoice || orderNumber || guid}.pdf`;
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${name}"`);
      return reply.send(buf);
    } catch (e) { reply.code(502); return { error: 'S&S fetch error: ' + e.message }; }
  });

  /**
   * S&S payment profiles.  GET /v2/paymentprofiles/?email={email}
   *
   * Their stored cards and bank accounts. `profileID` is what POST Orders takes, so
   * without this an order can only ever go on the account's default terms — which is
   * what the purchase board was doing, and what I had wrongly documented as S&S's only
   * option.
   *
   * Keyed by EMAIL, not account: profiles belong to a person on the account, so the
   * address book differs per user. The email is the one saved in factory settings
   * (order_email), falling back to whatever the caller passes.
   *
   * Their response nests one level deeper than the other endpoints — an array containing
   * an array of profiles — so it's flattened here rather than in every caller.
   */
  app.get('/api/ss/payment_profiles', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured (SS_ACCOUNT_NUMBER + SS_API_KEY).' }; }
    let email = String((req.query && req.query.email) || '').trim();
    if (!email) {
      const { readAll } = await import('./factory_settings.js');
      email = String((await readAll().catch(() => ({}))).order_email || '').trim();
    }
    if (!email) {
      reply.code(400);
      return { error: 'An email is required — S&S payment profiles belong to a person on the account. Set one in Supplier ordering.' };
    }
    try {
      const auth = Buffer.from(SS_ACCOUNT + ':' + SS_KEY).toString('base64');
      const r = await fetch(SS_BASE + '/paymentprofiles/?email=' + encodeURIComponent(email) + '&mediatype=json',
        { headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' } });
      const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch { data = txt; }
      if (!r.ok) { reply.code(502); return { error: 'S&S refused the request', status: r.status, detail: data }; }
      const flat = Array.isArray(data) ? data.flat(2).filter((x) => x && typeof x === 'object') : [];
      return {
        email,
        profiles: flat.map((p) => ({
          // Their doc misspells it "profyleType" in the field table while the example uses
          // "profileType" — accept both rather than betting on which one ships.
          id: String(p.profileID ?? p.profileId ?? ''),
          type: p.profileType ?? p.profyleType ?? null,
          name: p.name ?? null,
        })).filter((p) => p.id),
      };
    } catch (e) {
      reply.code(502); return { error: String((e && e.message) || e) };
    }
  });

  /**
   * Cancel an order with S&S.  DELETE /v2/orders/{OrderNumber}
   *
   * Their doc says it "TRIES to cancel the specified order number" — and that word is the
   * whole design of this route. A 2xx does not mean cancelled; an order already picked or
   * shipped comes back 200 with its unchanged status. So the HTTP code is ignored as a
   * verdict and `orderStatus` in the response body is what's believed.
   *
   * Anything other than "Cancelled" is reported as a FAILURE with the real status, because
   * the dangerous outcome here isn't an error — it's being told an order stopped when it
   * is still on a truck, and only finding out when the boxes arrive.
   *
   * Their response is an ARRAY of order objects; the order is the first element.
   */
  app.delete('/api/ss/order/:num', { preHandler: requireWarehouse }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured (SS_ACCOUNT_NUMBER + SS_API_KEY).' }; }
    const num = String(req.params.num || '').trim();
    if (!num) { reply.code(400); return { error: 'An S&S order number is required.' }; }
    const url = SS_BASE + '/orders/' + encodeURIComponent(num);

    if (String(process.env.SS_ORDER_LIVE || '') !== '1') {
      return { dryRun: true, method: 'DELETE', url,
               note: 'SS_ORDER_LIVE!=1 → nothing sent. This is the request that would go.' };
    }
    try {
      const auth = Buffer.from(SS_ACCOUNT + ':' + SS_KEY).toString('base64');
      const r = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' } });
      const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch { data = txt; }
      if (!r.ok) { reply.code(502); return { error: 'S&S refused the cancellation', status: r.status, detail: data }; }

      const row = Array.isArray(data) ? data[0] : data;
      const status = String((row && row.orderStatus) || '').trim();
      const cancelled = status.toLowerCase() === 'cancelled';
      // A restock fee means they've charged us for the attempt — worth surfacing rather
      // than leaving buried in the payload, since it's money either way.
      const restockFee = Number(row && row.restockFee) || 0;

      if (!cancelled) {
        reply.code(409);
        return {
          error: status
            ? `S&S did not cancel it — the order is "${status}". Too late to stop it through the API; call them if it hasn't shipped.`
            : 'S&S accepted the request but did not report the order as cancelled. Check the portal before assuming it stopped.',
          cancelled: false, orderStatus: status || null, orderNumber: (row && row.orderNumber) || num, detail: row,
        };
      }
      return {
        ok: true, cancelled: true, orderStatus: status,
        orderNumber: row.orderNumber, invoiceNumber: row.invoiceNumber || null,
        restockFee, total: Number(row.total) || 0, detail: row,
      };
    } catch (e) {
      reply.code(502); return { error: String((e && e.message) || e) };
    }
  });

  app.post('/api/ss/order', { preHandler: requireWarehouse }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured (SS_ACCOUNT_NUMBER + SS_API_KEY).' }; }
    const b = req.body || {};
    const lines = (Array.isArray(b.lines) ? b.lines : [])
      .map((l) => ({ identifier: String(l.sku || l.identifier || '').trim(), qty: parseInt(l.qty, 10) || 0 }))
      .filter((l) => l.identifier && l.qty > 0);
    if (!lines.length) { reply.code(400); return { error: 'No order lines — each needs a sku + qty.' }; }
    const wantLive = b.live === true;
    // Their required address shape. Refuse rather than send a partial one: an order with
    // no valid delivery address is the one thing that cannot be fixed after the fact.
    const shippingAddress = toSsAddress(b.shippingAddress);
    if (b.shippingAddress && !shippingAddress) {
      reply.code(400);
      return { error: 'The warehouse address is incomplete or malformed for S&S — it needs a street, city, 2-letter state and 5-digit ZIP.' };
    }

    const payload = {
      testOrder: !wantLive,                          // S&S Test mode unless the caller explicitly asks for a live order
      poNumber: b.poNumber || ('EG-' + Date.now()),
      shippingMethod: b.shippingMethod || '1',
      shippingAddress: shippingAddress || undefined,
      emailConfirmation: b.email || undefined,
      // Let S&S choose the warehouses and split lines across them. Their doc: with this
      // on, per-line warehouseAbbr is IGNORED — so sending both would be a contradiction
      // where only one side wins silently. We have no view of their stock levels at
      // order time, so they are better placed to decide than we are.
      autoselectWarehouse: b.autoselectWarehouse !== false,
      // A saved card/bank on the ssactivewear.com account. It is an OBJECT of
      // {email, profileID} — NOT a flat id, which is what the profiles doc's phrasing
      // ("used in POST - Orders") led me to guess before reading this page.
      ...(b.paymentProfileId && b.paymentProfileEmail
        ? { paymentProfile: { email: String(b.paymentProfileEmail), profileID: parseInt(b.paymentProfileId, 10) || undefined } }
        : {}),
      // FALSE on purpose: place what can be filled and report the rest, rather than
      // rejecting a 12-line order because one blank is out of stock. The unfillable lines
      // come back as LineErrors, which is information; a wholesale rejection is not.
      rejectLineErrors: b.rejectLineErrors === true,
      ...(b.shipByDate ? { shipByDate: String(b.shipByDate) } : {}),
      ...(b.promotionCode ? { promotionCode: String(b.promotionCode) } : {}),
      lines
    };
    // GATE 1 — never contact S&S unless SS_ORDER_LIVE='1'. Default = DRY RUN (return the payload only).
    if (String(process.env.SS_ORDER_LIVE || '') !== '1') {
      return { dryRun: true, note: 'SS_ORDER_LIVE!=1 → NOT sent to S&S. Review this payload + confirm the fields against the S&S Orders doc, then set SS_ORDER_LIVE=1 to enable (starts in Test mode).', payload };
    }
    try {
      const auth = Buffer.from(SS_ACCOUNT + ':' + SS_KEY).toString('base64');
      const r = await fetch(SS_BASE + '/orders/', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch (e) { data = txt; }
      if (!r.ok) { reply.code(502); return { error: 'S&S rejected the order', status: r.status, testOrder: payload.testOrder, detail: data }; }
      // Products from multiple warehouses come back as MULTIPLE orders, and with
      // rejectLineErrors=false the body carries lineErrors alongside them. Both are
      // summarised rather than buried: "placed" hiding three unfilled lines is how a job
      // reaches the floor missing its blanks.
      const orders = Array.isArray(data) ? data.filter((x) => x && x.orderNumber) : (data && data.orderNumber ? [data] : []);
      const lineErrors = Array.isArray(data) ? data.flatMap((x) => (x && Array.isArray(x.lineErrors)) ? x.lineErrors : [])
        : (data && Array.isArray(data.lineErrors) ? data.lineErrors : []);
      return {
        ok: true, testOrder: payload.testOrder,
        orders: orders.map((o) => ({
          orderNumber: String(o.orderNumber), guid: o.guid || null, warehouse: o.warehouseAbbr || null,
          status: o.orderStatus || null, total: Number(o.total) || 0,
          expectedDelivery: o.expectedDeliveryDate || null, carrier: o.shippingCarrier || null,
          shippingMethod: o.shippingMethod || null, lines: Array.isArray(o.lines) ? o.lines.length : 0,
        })),
        lineErrors,
        ssResponse: data,
      };
    } catch (e) {
      reply.code(502); return { error: 'S&S order request failed', detail: String((e && e.message) || e) };
    }
  });
}
