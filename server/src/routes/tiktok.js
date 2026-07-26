// TikTok Shop integration — OAuth connect (mirrors the Etsy flow).
// A SELLER connects their OWN TikTok shop; an ADMIN/staff connects the factory shop.
// Auth model differs from Etsy: no PKCE. The app has a service_id; the seller
// authorizes at services.tiktokshop.com (US: services.us.tiktokshop.com), TikTok redirects
// back to the callback registered in Partner Center as ?auth_code=<code>&state=… (NO app_key),
// and we exchange the code at auth.tiktok-shops.com (app_key + app_secret required, NO signature).
import crypto from 'node:crypto';
import { q } from '../db.js';

const APP_KEY    = process.env.TIKTOK_APP_KEY || '';
const APP_SECRET = process.env.TIKTOK_APP_SECRET || '';
const SERVICE_ID = process.env.TIKTOK_SERVICE_ID || '';
// Auth host is stable across regions; the authorize page is services.tiktokshop.com.
const AUTH_HOST     = (process.env.TIKTOK_AUTH_HOST || 'https://auth.tiktok-shops.com').replace(/\/+$/, '');
const AUTHORIZE_URL = process.env.TIKTOK_AUTHORIZE_URL || 'https://services.tiktokshop.com/open/authorize';
// Open API host for signed data calls (orders, shops). Global host serves every region;
// only the AUTHORIZE page is region-split (US = services.us.tiktokshop.com, set via env).
const API_HOST      = (process.env.TIKTOK_API_HOST || 'https://open-api.tiktokglobalshop.com').replace(/\/+$/, '');

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

// ── token helpers ────────────────────────────────────────────────────────────
// TikTok wraps every response as { code, message, data, request_id }; code===0 = ok.
async function ttTokenRequest(path, extraParams) {
  const params = new URLSearchParams({ app_key: APP_KEY, app_secret: APP_SECRET, ...extraParams });
  // TikTok documents token/get + token/refresh as POST with all params in the query string
  // (no JSON body). Sending GET has worked but is fragile if TikTok tightens method validation.
  const res = await fetch(`${AUTH_HOST}${path}?${params.toString()}`, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body && body.code !== 0)) {
    throw new Error((body && body.message) || ('TikTok token error ' + res.status));
  }
  return (body && body.data) || {};
}

// access_token_expire_in is an ABSOLUTE unix-seconds timestamp in TikTok's response,
// but tolerate a plain duration (seconds) too, just in case.
function expiryToIso(v) {
  const n = Number(v) || 0;
  if (n > 1e9) return new Date(n * 1000).toISOString();          // epoch seconds
  return new Date(Date.now() + (n || 7200) * 1000).toISOString(); // duration fallback
}

// Return a valid access token for a connection, refreshing if near expiry.
async function validToken(conn) {
  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() < expMs - 60000) return conn.access_token;
  const d = await ttTokenRequest('/api/v2/token/refresh', {
    refresh_token: conn.refresh_token, grant_type: 'refresh_token'
  });
  const expires = expiryToIso(d.access_token_expire_in);
  await q('update platform_connections set access_token=$1, refresh_token=$2, token_expires_at=$3, updated_at=now() where id=$4',
    [d.access_token, d.refresh_token || conn.refresh_token, expires, conn.id]);
  conn.access_token = d.access_token; conn.token_expires_at = expires;
  return d.access_token;
}

// ── Open API signing (v202309) ────────────────────────────────────────────────
// UNLIKE the token exchange (plain app_key+app_secret in the query, no signature),
// every DATA call must be HMAC-SHA256 signed or TikTok returns 105000/"signature invalid".
// The algorithm (must be byte-exact):
//   1. take all query params EXCEPT `sign` and `access_token`; sort keys A→Z
//   2. concat them as `keyvalue` with NO separators
//   3. prepend the request PATH (e.g. /order/202309/orders/search)
//   4. append the raw JSON body string when the request has a JSON body (empty otherwise)
//   5. wrap the whole thing with app_secret on BOTH ends: secret + s + secret
//   6. HMAC-SHA256 that, keyed by app_secret, lowercase hex
// The body signed here MUST be the exact bytes sent, so we stringify once and reuse it.
function signRequest(path, query, bodyStr) {
  let base = path;
  for (const k of Object.keys(query).filter((x) => x !== 'sign' && x !== 'access_token').sort()) {
    base += k + query[k];
  }
  base += (bodyStr || '');
  const wrapped = APP_SECRET + base + APP_SECRET;
  return crypto.createHmac('sha256', APP_SECRET).update(wrapped).digest('hex');
}

// Space every Open API call ≥200ms apart. TikTok caps requests per app/shop; sequential
// awaits alone can still burst when responses return fast, so serialize through a chain.
let _rlChain = Promise.resolve(), _rlLast = 0;
function rateLimit() {
  _rlChain = _rlChain.then(async () => {
    const wait = _rlLast + 200 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _rlLast = Date.now();
  });
  return _rlChain;
}

// One signed Open API request. access_token rides the header (x-tts-access-token), NOT the
// query — and it's excluded from the signature regardless. timestamp is unix SECONDS.
async function ttSignedRequest(conn, method, path, opts = {}) {
  const token = await validToken(conn);
  const query = { app_key: APP_KEY, timestamp: String(Math.floor(Date.now() / 1000)), ...(opts.query || {}) };
  const bodyStr = opts.body != null ? JSON.stringify(opts.body) : '';
  query.sign = signRequest(path, query, bodyStr);
  await rateLimit();
  const res = await fetch(`${API_HOST}${path}?${new URLSearchParams(query).toString()}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-tts-access-token': token },
    body: method === 'GET' || !bodyStr ? undefined : bodyStr,
  });
  const data = await res.json().catch(() => ({}));
  // TikTok wraps everything as { code, message, data, request_id }; code===0 = ok.
  if (!res.ok || (data && data.code !== 0)) {
    throw new Error(((data && data.message) || ('TikTok API ' + res.status)) + ' @ ' + path);
  }
  return (data && data.data) || {};
}

// The order endpoints all need the shop CIPHER (an opaque per-shop token), which the
// authorization endpoint returns. Cache it on the connection so we fetch it once per shop.
// Keep shop_id as the stored open_id (it's the unique key + what disconnect targets) — only
// the cipher and display name get refreshed here.
async function getShopCipher(conn) {
  if (conn.shop_cipher) return conn.shop_cipher;
  const d = await ttSignedRequest(conn, 'GET', '/authorization/202309/shops');
  const shop = (d.shops || [])[0];
  if (!shop || !shop.cipher) throw new Error('No TikTok shop cipher returned — reconnect the shop');
  await q('update platform_connections set shop_cipher=$1, shop_name=coalesce($2, shop_name), updated_at=now() where id=$3',
    [shop.cipher, shop.name || null, conn.id]).catch(() => {});
  conn.shop_cipher = shop.cipher;
  if (shop.name) conn.shop_name = shop.name;
  return shop.cipher;
}

// Is this connection's owner staff (factory-owned orders) or a seller (seller-owned)?
// Same rule as Etsy/Shopify: factory_order = the connector is not a seller.
async function connIsFactory(conn) {
  if (!conn.connected_by) return true;   // unknown owner → factory (safe default)
  const r = await q('select role from users where id=$1', [conn.connected_by]);
  return !!(r.rows[0] && r.rows[0].role && r.rows[0].role !== 'seller');
}

// TikTok order_status → our pipeline status. UNPAID isn't a confirmed sale (cart/abandon),
// so it's skipped entirely; CANCELLED maps to cancelled; anything at/after collection is
// treated as shipped; the rest (ON_HOLD, AWAITING_SHIPMENT) is a fresh order to make.
const TT_SHIPPED = new Set(['AWAITING_COLLECTION', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'PARTIALLY_SHIPPING']);

// Build our address shape from TikTok's recipient_address. district_info[] carries the
// admin hierarchy (L0 country → L1 state/province → L2 city → L3 district); PII may be
// masked by TikTok until the app holds the right data entitlement (their gate, not our bug).
function mapAddress(ra) {
  const dist = {};
  for (const d of (ra.district_info || [])) dist[String(d.address_level || '')] = d.address_name;
  return {
    line1: ra.address_line1 || ra.address_detail || '',
    line2: ra.address_line2 || '',
    city: dist.L2 || dist.L3 || '',
    state: dist.L1 || '',
    zip: ra.postal_code || '',
    country: ra.region_code || '',
    formatted: ra.full_address || [ra.address_detail, dist.L2, dist.L1, ra.postal_code].filter(Boolean).join(', '),
  };
}

// Upsert one TikTok order into `orders`. Mirrors importShopifyOrder: a re-sync refreshes
// money + address + tracking only, NEVER the internal pipeline (status/factory_status) or
// items, so a seller's in-progress order isn't reset when TikTok pings an update. Returns
// 'imported' | 'cancelled' | 'skipped'.
async function importTiktokOrder(conn, order, isFactory) {
  const st = String(order.order_status || '');
  if (st === 'UNPAID') return 'skipped';
  const id = 'tiktok-' + order.id;
  const cancelled = st === 'CANCELLED';
  const shipped = TT_SHIPPED.has(st);
  const status = cancelled ? 'cancelled' : (shipped ? 'shipped' : 'new');
  const createdIso = order.create_time ? new Date(Number(order.create_time) * 1000).toISOString() : null;
  const ra = order.recipient_address || {};
  const custName = ra.name || [ra.first_name, ra.last_name].filter(Boolean).join(' ').trim() || 'TikTok customer';
  const address = mapAddress(ra);
  const track = order.tracking_number
    || (order.packages || []).map((p) => p.tracking_number).filter(Boolean)[0] || null;
  const total = num((order.payment || {}).total_amount);
  // buyer_message → order Notes; seller_note kept too. Set on INSERT only (out of the
  // conflict update) so a seller's later edits survive a re-sync, same as the other importers.
  const meta = { source: 'tiktok', tiktok_status: st, note: order.buyer_message || order.seller_note || '' };
  await q(
    `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, tracking, created_at, factory_order, meta)
     values ($1,$2,$3,'tiktok',$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now()), $11, $12)
     on conflict (id) do update set total=excluded.total,
       customer=excluded.customer, address=excluded.address,
       tracking=coalesce(excluded.tracking, orders.tracking),
       created_at=coalesce($10::timestamptz, orders.created_at), updated_at=now()`,
    [id, conn.connected_by, conn.shop_name || conn.shop_id,
     { name: custName, email: order.buyer_email || null }, address,
     status, status, total, track, createdIso, !!isFactory, meta]
  );
  // Items only on first import — a re-sync must not wipe factory picks. TikTok returns ONE
  // line_item per unit (no quantity field), and CLAUDE.md's line-identity rule wants each
  // unit as its own job, so we insert one order_item per line_item (qty 1) keyed by its id.
  const hasItems = await q('select 1 from order_items where order_id=$1 limit 1', [id]);
  if (!hasItems.rowCount) {
    for (const li of (order.line_items || [])) {
      const name = li.product_name || null;
      const variant = (li.sku_name && li.sku_name !== name) ? li.sku_name : null;
      const method = /embroider|embroidered|embroidery|monogram/i.test(`${name || ''} ${variant || ''}`) ? 'EMB' : null;
      await q(
        `insert into order_items (order_id, sku, name, qty, variant, unit_price, img, print_type, line_id)
         values ($1,$2,$3,1,$4,$5,$6,$7,$8)`,
        [id, li.seller_sku || li.sku_id || null, name, variant, num(li.sale_price), li.sku_image || null, method, 'tt-' + li.id]
      );
    }
  }
  return cancelled ? 'cancelled' : 'imported';
}

// Sync ONE connection's orders into `orders`. Incremental by default (update_time_ge since
// the last sync, with a 5-min overlap) so repeat syncs are a couple of calls; a full/first
// sync pulls everything CREATED since the shop connected (never the whole history).
async function syncTiktokConnection(conn, opts = {}) {
  const isFactory = await connIsFactory(conn);
  const cipher = await getShopCipher(conn);
  const firstSync = !conn.last_sync_at;
  const full = !!opts.full || firstSync;
  let imported = 0, cancelled = 0, skipped = 0;
  const body = {};
  if (full) {
    const connectedSec = conn.created_at ? Math.floor(new Date(conn.created_at).getTime() / 1000) : 0;
    if (connectedSec) body.create_time_ge = connectedSec;   // this shop's orders from connect forward
  } else {
    body.update_time_ge = Math.max(0, Math.floor(new Date(conn.last_sync_at).getTime() / 1000) - 300);
  }
  let pageToken = '';
  // Cap at 20 pages (1000 orders) per run — a backstop; incremental runs return far fewer.
  for (let page = 0; page < 20; page++) {
    const query = { shop_cipher: cipher, page_size: '50', sort_field: 'create_time', sort_order: 'DESC' };
    if (pageToken) query.page_token = pageToken;
    const d = await ttSignedRequest(conn, 'POST', '/order/202309/orders/search', { query, body });
    for (const o of (d.orders || [])) {
      const res = await importTiktokOrder(conn, o, isFactory);
      if (res === 'cancelled') cancelled++; else if (res === 'skipped') skipped++; else imported++;
    }
    pageToken = d.next_page_token || '';
    if (!pageToken) break;
  }
  await q('update platform_connections set last_sync_at=now() where id=$1', [conn.id]).catch(() => {});
  return { shop: conn.shop_name || conn.shop_id, imported, cancelled, skipped, full };
}

// Sync all connected TikTok shops (or filter by owner — a seller syncs only their own).
async function syncAllTiktok(opts = {}) {
  if (!APP_KEY || !APP_SECRET) return { error: 'Server is missing TIKTOK_APP_KEY / TIKTOK_APP_SECRET.' };
  const where = ["platform='tiktok'"]; const params = [];
  if (opts.ownerId) { params.push(opts.ownerId); where.push(`connected_by=$${params.length}`); }
  const rows = (await q(`select * from platform_connections where ${where.join(' and ')}`, params)).rows;
  const synced = [];
  for (const conn of rows) {
    try { synced.push(await syncTiktokConnection(conn, opts)); }
    catch (e) { synced.push({ shop: conn.shop_name || conn.shop_id, error: e.message }); }
  }
  return { ok: true, synced };
}

export function tiktokRoutes(app, requireAuth, requireStaff) {
  // Reuse the platform_connections table (created by etsy.js). Create it here too so
  // TikTok works even on a DB that never loaded the Etsy route first (idempotent).
  q(`create table if not exists platform_connections (
       id uuid primary key default gen_random_uuid(),
       platform text not null default 'etsy', shop_id text not null, shop_name text,
       access_token text, refresh_token text, token_expires_at timestamptz, scopes text,
       last_sync_at timestamptz, connected_by uuid references users(id) on delete set null,
       created_at timestamptz default now(), updated_at timestamptz default now(),
       unique (platform, shop_id))`)
    .catch(() => {})
    // Per-shop cipher for the Open API order calls (fetched on first sync). CHAINED off the
    // create so the column can't ALTER before the table exists on a fresh DB (see etsy.js).
    .then(() => q('alter table platform_connections add column if not exists shop_cipher text').catch(() => {}));

  // Auto-sync: poll TikTok incrementally so new orders land without anyone clicking "Sync
  // now" — mirrors the Etsy poll. Incremental (update_time_ge) → a couple of calls per run.
  if (APP_KEY && APP_SECRET && !globalThis.__egTiktokAutoSync) {
    globalThis.__egTiktokAutoSync = setInterval(() => { syncAllTiktok({ full: false }).catch(() => {}); }, 5 * 60 * 1000);
    if (globalThis.__egTiktokAutoSync.unref) globalThis.__egTiktokAutoSync.unref();
  }

  // Frontend reads this to build the authorize URL (service_id is not a secret).
  app.get('/api/tiktok/config', async () => ({
    service_id: SERVICE_ID, authorize_url: AUTHORIZE_URL,
    configured: !!(APP_KEY && APP_SECRET && SERVICE_ID)
  }));

  // Lightweight connection check for any logged-in user.
  // A SELLER sees only shop(s) THEY connected. FACTORY/staff share one pool of factory-connected
  // shops (any non-seller connector), gated against seller shops.
  app.get('/api/tiktok/connected', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const r = await q(staff
      ? `select shop_name from platform_connections pc where platform='tiktok' and not exists (select 1 from users u where u.id=pc.connected_by and u.role='seller') order by created_at`
      : `select shop_name from platform_connections where platform='tiktok' and connected_by=$1 order by created_at`,
      staff ? [] : [req.user.sub]);
    return { connected: r.rowCount > 0, shops: r.rows.map(x => x.shop_name).filter(Boolean) };
  });

  // List connected shops (no tokens leaked). Staff see all; a seller sees only theirs.
  app.get('/api/tiktok/connections', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const r = await q(
      staff ? `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at
                 from platform_connections where platform='tiktok' order by created_at`
            : `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at
                 from platform_connections where platform='tiktok' and connected_by=$1 order by created_at`,
      staff ? [] : [req.user.sub]);
    return r.rows;
  });

  // Disconnect a TikTok shop. A seller can only drop their own; staff can drop any factory one.
  app.post('/api/tiktok/disconnect', { preHandler: requireAuth }, async (req) => {
    const shopId = String((req.body || {}).shop_id || '');
    if (!shopId) return { ok: false };
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    await q(
      staff ? `delete from platform_connections where platform='tiktok' and shop_id=$1`
            : `delete from platform_connections where platform='tiktok' and shop_id=$1 and connected_by=$2`,
      staff ? [shopId] : [shopId, req.user.sub]).catch(() => {});
    return { ok: true };
  });

  // OAuth code → tokens. Called by oauth-callback.html after TikTok redirects back.
  // requireAuth (not staff): a SELLER connects their OWN shop; connected_by = caller.
  app.post('/api/tiktok/exchange', { preHandler: requireAuth }, async (req, reply) => {
    const { code, auth_code } = req.body || {};
    const authCode = code || auth_code;
    if (!APP_KEY || !APP_SECRET) { reply.code(500); return { error: 'Server missing TIKTOK_APP_KEY / TIKTOK_APP_SECRET' }; }
    if (!authCode) { reply.code(400); return { error: 'Missing auth code' }; }
    try {
      const d = await ttTokenRequest('/api/v2/token/get', { auth_code: authCode, grant_type: 'authorized_code' });
      const expires = expiryToIso(d.access_token_expire_in);
      // open_id is a stable per-seller-per-app id → our shop_id. seller_name → label.
      const shopId   = String(d.open_id || d.seller_name || ('tt-' + Date.now().toString(36)));
      const shopName = d.seller_name || ('TikTok shop ' + shopId.slice(0, 8));
      const scopes   = Array.isArray(d.granted_scopes) ? d.granted_scopes.join(' ') : (d.granted_scopes || '');
      await q(
        `insert into platform_connections (platform, shop_id, shop_name, access_token, refresh_token, token_expires_at, scopes, connected_by)
         values ('tiktok',$1,$2,$3,$4,$5,$6,$7)
         on conflict (platform, shop_id) do update set
           shop_name=excluded.shop_name, access_token=excluded.access_token,
           refresh_token=excluded.refresh_token, token_expires_at=excluded.token_expires_at,
           scopes=excluded.scopes, connected_by=excluded.connected_by, updated_at=now()`,
        [shopId, shopName, d.access_token, d.refresh_token, expires, scopes, req.user.sub]
      );
      return { ok: true, shop_id: shopId, shop_name: shopName, scopes };
    } catch (e) {
      reply.code(400); return { error: e.message };
    }
  });

  // Disconnect. Sellers can only remove their own; staff can remove any.
  app.delete('/api/tiktok/connections/:shop_id', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    if (staff) await q(`delete from platform_connections where platform='tiktok' and shop_id=$1`, [req.params.shop_id]);
    else await q(`delete from platform_connections where platform='tiktok' and shop_id=$1 and connected_by=$2`, [req.params.shop_id, req.user.sub]);
    return { ok: true };
  });

  // Manual/backfill sync — a seller syncs their own shop, staff sync all. Mirrors
  // /api/etsy/sync and /api/shopify/sync. The 5-minute poll keeps things current; this is
  // the "pull now" button and the recovery path if the poll ever missed an order.
  app.post('/api/tiktok/sync', { preHandler: requireAuth }, async (req, reply) => {
    if (!APP_KEY || !APP_SECRET) { reply.code(400); return { error: 'Server missing TIKTOK_APP_KEY / TIKTOK_APP_SECRET' }; }
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const r = await syncAllTiktok(staff ? {} : { ownerId: req.user.sub });
    if (r.error) { reply.code(400); return r; }
    if (!r.synced.length) { reply.code(400); return { error: staff ? 'No TikTok shop connected' : 'No TikTok shop connected to your account' }; }
    // Surface a flat imported count so the client can show "N order(s) imported", like Etsy.
    const imported = r.synced.reduce((n, s) => n + (s.imported || 0), 0);
    return { ...r, imported };
  });

  // Connectivity test (staff): prove the SIGNING works against the live shop by fetching the
  // shop cipher — the same "verify one signed call before trusting the full import" check the
  // Wilcom connectivity test does. Never echoes tokens/secrets.
  app.get('/api/tiktok/test', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const conn = (await q(`select * from platform_connections where platform='tiktok' order by created_at limit 1`)).rows[0];
      if (!conn) { reply.code(400); return { error: 'No TikTok shop connected' }; }
      const d = await ttSignedRequest(conn, 'GET', '/authorization/202309/shops');
      const shops = (d.shops || []).map((s) => ({ id: String(s.id || ''), name: s.name || null, region: s.region || null, has_cipher: !!s.cipher }));
      return { ok: true, signed_call_ok: true, shops };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Diagnostic (staff): confirm the stored token still works + show granted scopes.
  app.get('/api/tiktok/debug', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const conn = (await q(`select * from platform_connections where platform='tiktok' order by created_at limit 1`)).rows[0];
      if (!conn) { reply.code(400); return { error: 'No TikTok shop connected' }; }
      const token = await validToken(conn);
      return { shop_id: conn.shop_id, shop_name: conn.shop_name, scopes: conn.scopes,
               token_ok: !!token, token_expires_at: conn.token_expires_at };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
