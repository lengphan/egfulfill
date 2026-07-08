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
function ssImg(u) { if (!u) return null; return /^https?:/i.test(u) ? u : SS_CDN + String(u).replace(/^\//, ''); }

function num(v) { const n = Number(v); return isFinite(n) ? n : null; }
function int(v) { const n = parseInt(v, 10); return isFinite(n) ? n : 0; }
function creds() { return !!(SS_ACCOUNT && SS_KEY); }

// One authenticated GET to S&S. Returns { ok, status, data } (data parsed JSON or raw text).
async function ssGet(path) {
  const auth = Buffer.from(SS_ACCOUNT + ':' + SS_KEY).toString('base64');
  const r = await fetch(SS_BASE + path, { headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' } });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { ok: r.ok, status: r.status, data };
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

  // ── Status: is it configured, and what's synced? ────────────────────────────
  app.get('/api/ss/status', { preHandler: requireStaff }, async () => {
    let count = 0, last = null;
    try {
      const r = await q('select count(*)::int as n, max(synced_at) as last from ss_products');
      count = r.rows[0]?.n || 0; last = r.rows[0]?.last || null;
    } catch (e) {}
    return { configured: creds(), account: SS_ACCOUNT ? '…' + SS_ACCOUNT.slice(-4) : null, base: SS_BASE, synced_count: count, last_sync: last };
  });

  // ── Browse S&S STYLES (lightweight) — for picking what to sync into "New In" ─
  // Optional ?brand= and ?search= filter it down. Style-level = far fewer rows than products.
  app.get('/api/ss/styles', { preHandler: requireStaff }, async (req, reply) => {
    if (!creds()) { reply.code(400); return { error: 'S&S not configured — set SS_ACCOUNT_NUMBER and SS_API_KEY.' }; }
    const brand = (req.query?.brand || '').trim();
    const search = (req.query?.search || '').trim().toLowerCase();
    try {
      const r = await ssGet('/styles/?fields=styleID,brandName,title,baseCategory,styleImage');
      if (!r.ok) { reply.code(r.status || 502); return { error: 'S&S styles fetch failed', status: r.status, body: r.data }; }
      let list = Array.isArray(r.data) ? r.data : [];
      if (brand) list = list.filter((s) => String(s.brandName || '').toLowerCase() === brand.toLowerCase());
      if (search) list = list.filter((s) => (String(s.title || '') + ' ' + String(s.brandName || '')).toLowerCase().includes(search));
      return list.slice(0, 500);
    } catch (e) { reply.code(502); return { error: 'S&S fetch error: ' + e.message }; }
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

    let products = [];
    try {
      if (styleIds.length) {
        for (const sid of styleIds.slice(0, 100)) {
          const r = await ssGet('/products/?style=' + encodeURIComponent(sid) + '&fields=' + PRODUCT_FIELDS);
          if (r.ok && Array.isArray(r.data)) products = products.concat(r.data);
        }
      } else {
        // brand path: pull the feed once, filter by the STYLE's brand (product rows omit brandName).
        const r = await ssGet('/products/?fields=' + PRODUCT_FIELDS);
        if (!r.ok) { reply.code(r.status || 502); return { error: 'S&S products fetch failed', status: r.status, body: r.data }; }
        const set = new Set(brands.map((b) => b.toLowerCase()));
        products = (Array.isArray(r.data) ? r.data : []).filter((p) => {
          const m = styleMap[String(p.styleID)];
          const brand = (m && m.brand) || p.brandName || '';
          return set.has(String(brand).toLowerCase());
        });
      }
    } catch (e) { reply.code(502); return { error: 'S&S fetch error: ' + e.message }; }

    let n = 0;
    for (const raw of products) {
      const p = mapProduct(raw, styleMap[String(raw.styleID)]);
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
    return { ok: true, synced: n, fetched: products.length };
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
}
