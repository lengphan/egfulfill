// Etsy integration — OAuth 2.0 (PKCE) connect + order/listing sync.
// Etsy v3 uses PKCE with the keystring as client_id; NO client secret is needed
// for the token exchange. Access tokens last ~1h and are refreshed automatically.
import { q } from '../db.js';

const KEYSTRING   = process.env.ETSY_KEYSTRING || '';
// Etsy's x-api-key header for API data calls must be "keystring:shared_secret"
// (the shared secret is NOT needed for the PKCE token exchange, only here).
const SHARED_SECRET = process.env.ETSY_SHARED_SECRET || '';
const API_KEY_HEADER = SHARED_SECRET ? (KEYSTRING + ':' + SHARED_SECRET) : KEYSTRING;
// Force the canonical (non-www) host: the served config, the authorize redirect_uri,
// and the browser's post-Caddy origin must all agree, or Etsy rejects the token
// exchange with a redirect_uri mismatch. Normalizing here makes a stale www value in
// .env harmless (Caddy already redirects www → non-www for the browser).
const REDIRECT_URI = (process.env.ETSY_REDIRECT_URI || 'https://egful.store/oauth-callback.html').replace('://www.', '://');
// shops_r/shops_w are needed to READ shipping profiles (and shop-level data) and to
// create them — without shops_r, /shops/{id}/shipping-profiles returns 403 and Etsy
// publish fails ("shipping_profile_id required"). Adding a scope requires the user
// to RECONNECT (re-authorize) so the new token carries it.
// address_r is REQUIRED to read buyer shipping addresses on receipts — without it
// Etsy redacts first_line/city/zip to null (confirmed by Etsy support, Jul 2026).
const SCOPES = 'address_r transactions_r transactions_w listings_r listings_w shops_r shops_w';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const API = 'https://api.etsy.com/v3/application';

// ── helpers ────────────────────────────────────────────────────────────────
function money(m) { return m && m.divisor ? (m.amount / m.divisor) : 0; }
// Stable per-line id stamped at creation, so itemDK() on the client never shifts from
// the SKU to a later-assigned id and orphans the line's design/blank.
function genLineId() { return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }

async function etsyTokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || ('Etsy token error ' + res.status));
  return data; // { access_token, refresh_token, expires_in, token_type }
}

// Return a valid access token for a connection, refreshing if it's near expiry.
async function validToken(conn) {
  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() < expMs - 60000) return conn.access_token;
  const t = await etsyTokenRequest({
    grant_type: 'refresh_token', client_id: KEYSTRING, refresh_token: conn.refresh_token
  });
  const expires = new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString();
  await q('update platform_connections set access_token=$1, refresh_token=$2, token_expires_at=$3, updated_at=now() where id=$4',
    [t.access_token, t.refresh_token || conn.refresh_token, expires, conn.id]);
  conn.access_token = t.access_token; conn.token_expires_at = expires;
  return t.access_token;
}

// Global rate limiter — Etsy caps at 10 requests/second. Space EVERY Etsy call at
// least 140ms apart (~7/sec) so a sync can never trip the per-second limit, no
// matter how many receipts/images it touches. Sequential awaits alone weren't
// enough because cached image responses return in <100ms.
let _rlLast = 0, _rlChain = Promise.resolve();
function rateLimit() {
  // Serialize through a chain so even an auto-sync overlapping a manual sync can't
  // burst — every call is guaranteed ≥MIN_GAP after the previous one.
  _rlChain = _rlChain.then(async () => {
    const MIN_GAP = 140;
    const wait = _rlLast + MIN_GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _rlLast = Date.now();
  });
  return _rlChain;
}

// Authenticated GET against the Etsy API.
async function etsyGet(conn, path) {
  const token = await validToken(conn);
  await rateLimit();
  const res = await fetch(API + path, {
    headers: { 'x-api-key': API_KEY_HEADER, Authorization: 'Bearer ' + token }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error || ('Etsy API ' + res.status)) + ' @ ' + path);
  return data;
}

// Generic authed Etsy call (GET/POST). Pass opts.body as a URLSearchParams string
// (form) or a FormData (image upload); set opts.headers for the form content-type.
async function etsyFetch(conn, path, opts = {}) {
  const token = await validToken(conn);
  await rateLimit();
  const res = await fetch(API + path, { method: opts.method || 'GET', headers: Object.assign({ 'x-api-key': API_KEY_HEADER, Authorization: 'Bearer ' + token }, opts.headers || {}), body: opts.body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(((data && (data.error || data.message)) || ('Etsy API ' + res.status)) + ' @ ' + path);
  return data;
}

// Resolve the listing image URL. Prefers the EXACT image the buyer saw
// (transaction.listing_image_id); falls back to the listing's first image.
// Cached per listing[:image] for the sync run.
function imgUrlOf(im) { return (im && (im.url_fullxfull || im.url_570xN || im.url_300x300 || im.url_170x135)) || null; }
async function listingImage(conn, listingId, imageId, cache) {
  if (!listingId) return null;
  const key = String(listingId) + (imageId ? (':' + imageId) : '');
  if (cache && Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  let url = null;
  try {
    if (imageId) {
      url = imgUrlOf(await etsyGet(conn, `/listings/${listingId}/images/${imageId}`));
    }
    if (!url) {
      const r = await etsyGet(conn, `/listings/${listingId}/images`);
      url = imgUrlOf(r && r.results && r.results[0]);
    }
  } catch (e) { url = null; }
  if (cache) cache[key] = url;
  return url;
}

// Is this connection owned by factory STAFF (admin/operator/…) or by a SELLER? This
// drives factory_order: a seller's OWN shop yields seller-owned orders
// (factory_order=false, seller-managed until pushed, then the normal pipeline); the
// admin/factory shop keeps factory_order=true (factory-managed only).
async function ownerIsStaff(userId) {
  if (!userId) return true;                          // unknown owner → factory (safe default)
  try {
    const r = await q('select role from users where id=$1', [userId]);
    const role = r.rows[0] && r.rows[0].role;
    return !!role && role !== 'seller';
  } catch (e) { return true; }
}

// Upsert one Etsy receipt into orders. Returns 'imported' or 'skipped'.
// Re-syncs never overwrite the internal pipeline (status/factory_status) or items.
// isFactory: true → factory-owned (admin shop); false → seller-owned (seller's shop).
async function importReceipt(conn, rc, connectedSec, imgCache, isFactory) {
  const id = 'etsy-' + rc.receipt_id;
  const shipped = !!(rc.is_shipped || rc.was_shipped);
  const status = shipped ? 'shipped' : 'new';
  const createdTs = rc.created_timestamp || rc.create_timestamp;            // epoch seconds
  const createdIso = createdTs ? new Date(createdTs * 1000).toISOString() : null;
  // Skip the pre-connection shipped backlog entirely (don't store it).
  if (shipped && createdTs && connectedSec && createdTs < connectedSec) return 'skipped';
  // factory_order=true: this came from the ADMIN/factory Etsy connection, so it
  // belongs to the factory boards (admin/operator/warehouse), NOT to sellers. A
  // future seller-owned shop connection would insert these with factory_order=false.
  // Customer note + gift message → the order-detail Notes + Gift Message fields
  // (orders.html reads meta.note / meta.gift). Set on INSERT only (left out of the
  // conflict update) so a seller's later edits to either survive re-syncs.
  const meta = { source: 'etsy', isGift: !!(rc.is_gift || rc.gift_message),
                 note: rc.message_from_buyer || '', gift: rc.gift_message || '' };
  await q(
    `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, tracking, created_at, factory_order, meta)
     values ($1,$2,$3,'etsy',$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now()), $11, $12)
     on conflict (id) do update set total=excluded.total,
       customer=excluded.customer, address=excluded.address,
       created_at=coalesce($10::timestamptz, orders.created_at), updated_at=now()`,
    [id, conn.connected_by, conn.shop_name,
     { name: rc.name, email: rc.buyer_email || null },
     { line1: rc.first_line, line2: rc.second_line, city: rc.city, state: rc.state,
       zip: rc.zip, country: rc.country_iso, formatted: rc.formatted_address },
     status, status, money(rc.grandtotal), (rc.shipments && rc.shipments[0]?.tracking_code) || null, createdIso,
     !!isFactory, meta]
  );
  const hasItems = await q('select 1 from order_items where order_id=$1 limit 1', [id]);
  // Pre-load existing items so re-syncs DON'T refetch listing images (Etsy rate limit:
  // 10/sec, 10k/day). We only call the image API for items that have no image yet.
  const existing = {};
  if (hasItems.rowCount) {
    const ex = await q('select sku, img, design_src, personalization, print_type from order_items where order_id=$1', [id]);
    for (const r of ex.rows) existing[String(r.sku || '')] = r;
  }
  for (const tr of (rc.transactions || [])) {
    // Split variations: customer-uploaded file (URL), personalization text, size/color.
    let uploadUrl = null, personalization = null; const vparts = [];
    for (const v of (tr.variations || [])) {
      const val = String(v.formatted_value || v.value || '');
      const nm = String(v.formatted_name || '').toLowerCase();
      if (/^https?:\/\//i.test(val) && (/upload|logo|file|image|photo|art|design/.test(nm) || /\.(png|jpe?g|gif|webp|svg|pdf|ai|eps|psd|tiff?)(\?|$)/i.test(val))) {
        uploadUrl = val;
      } else if (nm.indexOf('personaliz') !== -1) {
        personalization = val;
      } else if (val) {
        vparts.push(val);
      }
    }
    const variant = vparts.join(', ') || null;
    // Method detection — embroidery listings ("Custom Embroidered…", "Monogrammed…")
    // come in as 'EMB' so the factory boards run thread-colour matching automatically
    // (the boards otherwise default a method-less item to DTG). Everything else is
    // left null → the board's DTG default + manual picker still apply.
    const method = /embroider|embroidered|embroidery|monogram/i.test(String(tr.title || '') + ' ' + (variant || '')) ? 'EMB' : null;
    const exItem = existing[String(tr.sku || '')];
    if (!hasItems.rowCount) {
      const img = await listingImage(conn, tr.listing_id, tr.listing_image_id, imgCache);   // first import → fetch once
      await q(
        `insert into order_items (order_id, sku, name, qty, variant, unit_price, img, design_src, personalization, print_type, line_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, tr.sku || null, tr.title || null, tr.quantity || 1, variant, money(tr.price), img, uploadUrl, personalization, method, genLineId()]
      );
    } else if (exItem) {
      // Backfill the method on re-sync if a prior import stored it without one.
      if (method && !exItem.print_type) await q(`update order_items set print_type=$1 where order_id=$2 and sku is not distinct from $3 and (print_type is null or print_type='')`, [method, id, tr.sku || null]);
      // Existing item — only hit the image API if it still has no image.
      if (!exItem.img) {
        const img = await listingImage(conn, tr.listing_id, tr.listing_image_id, imgCache);
        if (img) await q(`update order_items set img=$1 where order_id=$2 and sku is not distinct from $3 and (img is null or img='')`, [img, id, tr.sku || null]);
      }
      if (uploadUrl && !exItem.design_src) await q(`update order_items set design_src=$1 where order_id=$2 and sku is not distinct from $3 and (design_src is null or design_src='')`, [uploadUrl, id, tr.sku || null]);
      if (personalization && !exItem.personalization) await q(`update order_items set personalization=$1 where order_id=$2 and sku is not distinct from $3 and (personalization is null or personalization='')`, [personalization, id, tr.sku || null]);
    }
  }
  return 'imported';
}

// Sync ONE connection's receipts into orders. Incremental by default: only pulls
// receipts modified since last_sync_at (Etsy's min_last_modified), so repeat syncs
// don't re-fetch the whole shop (incl. the already-shipped backlog) every time —
// that's what burns the 10k/day quota. Pass {full:true} to force a complete pull.
async function syncConnection(conn, opts = {}) {
  const full = !!opts.full;
  const firstSync = !conn.last_sync_at;
  let orders = 0, skipped = 0, purgedShipped = 0, resolved = null;
  // Resolve the real shop id/name only on a full or first sync (saves a call/run).
  if (full || firstSync) {
    try {
      const userId = String(conn.access_token).split('.')[0];
      const sr = await etsyGet(conn, `/users/${userId}/shops`);
      const shop = sr && (sr.shop_id ? sr : (Array.isArray(sr.results) ? sr.results[0] : null));
      if (shop && shop.shop_id) {
        const realId = String(shop.shop_id);
        if (realId !== String(conn.shop_id) || (shop.shop_name && shop.shop_name !== conn.shop_name)) {
          await q('update platform_connections set shop_id=$1, shop_name=$2, updated_at=now() where id=$3',
            [realId, shop.shop_name || conn.shop_name, conn.id]);
          conn.shop_id = realId; conn.shop_name = shop.shop_name || conn.shop_name;
        }
        resolved = { shop_id: conn.shop_id, shop_name: conn.shop_name };
      }
    } catch (e) { resolved = { error: e.message }; }
  }
  const connectedSec = conn.created_at ? Math.floor(new Date(conn.created_at).getTime() / 1000) : 0;
  // Factory shop (admin) vs seller's own shop — sets factory_order on each receipt.
  const isFactory = await ownerIsStaff(conn.connected_by);
  // One-time: drop the pre-connection shipped backlog (full/first sync only).
  if ((full || firstSync) && connectedSec) {
    const del = await q(
      `delete from orders where source='etsy' and seller_id=$1 and status='shipped' and created_at < to_timestamp($2)`,
      [conn.connected_by, connectedSec]);
    purgedShipped = del.rowCount || 0;
  }
  const isIncremental = !full && !!conn.last_sync_at;
  const imgCache = {};
  // Pull one filtered page-set of receipts and import each (importReceipt upserts,
  // so overlapping passes are harmless). Throttled implicitly by sequential awaits.
  async function pullPass(qs) {
    for (let offset = 0; offset < 1000; offset += 100) {
      const r = await etsyGet(conn, `/shops/${conn.shop_id}/receipts?limit=100&offset=${offset}&includes=Transactions${qs}`);
      const results = r.results || [];
      for (const rc of results) {
        if ((await importReceipt(conn, rc, connectedSec, imgCache, isFactory)) === 'skipped') skipped++; else orders++;
      }
      if (results.length < 100) break;
    }
  }
  if (isIncremental) {
    // Only receipts changed since the last sync (5-min overlap) → tiny call count.
    const sinceSec = Math.max(0, Math.floor(new Date(conn.last_sync_at).getTime() / 1000) - 300);
    await pullPass(`&min_last_modified=${sinceSec}`);
  } else {
    // Full/first sync — SCOPED so we never pull the entire shipped history (that's
    // what blew the quota). Two narrow passes:
    //   1) orders CREATED since you connected (from the import date forward)
    //   2) any order still UNSHIPPED/open, regardless of date (the active queue)
    // Together: "today's orders onward + everything not yet shipped" — nothing else.
    if (connectedSec) await pullPass(`&min_created=${connectedSec}`);
    await pullPass(`&was_shipped=false`);
  }
  await q('update platform_connections set last_sync_at=now() where id=$1', [conn.id]);
  return { shop: conn.shop_name, shop_id: conn.shop_id, orders, skipped, purgedShipped, resolved, incremental: isIncremental };
}

// Sync all connected Etsy shops (or just one via opts.shopId).
async function syncAllEtsy(opts = {}) {
  if (!SHARED_SECRET) return { error: 'Server is missing ETSY_SHARED_SECRET.' };
  // Optional filters: shopId (one shop) and ownerId (one user's shops — sellers sync
  // only their own). No filters → every connection (the admin auto-sync).
  const where = ["platform='etsy'"]; const params = [];
  if (opts.shopId) { params.push(opts.shopId); where.push(`shop_id=$${params.length}`); }
  if (opts.ownerId) { params.push(opts.ownerId); where.push(`connected_by=$${params.length}`); }
  const rows = (await q(`select * from platform_connections where ${where.join(' and ')}`, params)).rows;
  const summary = [];
  for (const conn of rows) {
    try { summary.push(await syncConnection(conn, opts)); }
    catch (e) { summary.push({ shop: conn.shop_name, shop_id: conn.shop_id, error: e.message }); }
  }
  return { ok: true, synced: summary };
}

// ── routes ───────────────────────────────────────────────────────────────--
export function etsyRoutes(app, requireAuth, requireStaff) {
  // ensure table exists even on a DB that booted before this feature (idempotent)
  q(`create table if not exists platform_connections (
       id uuid primary key default gen_random_uuid(),
       platform text not null default 'etsy', shop_id text not null, shop_name text,
       access_token text, refresh_token text, token_expires_at timestamptz, scopes text,
       last_sync_at timestamptz, connected_by uuid references users(id) on delete set null,
       created_at timestamptz default now(), updated_at timestamptz default now(),
       unique (platform, shop_id))`).catch(() => {});
  // Buyer personalization text per item (added with the customer-upload feature).
  q('alter table order_items add column if not exists personalization text').catch(() => {});
  // factory_order: orders from the ADMIN/factory shop belong to the factory boards;
  // orders from a SELLER's own shop are seller-owned (factory_order=false, shown on
  // their dashboard, seller-managed until pushed). Sellers' GET excludes factory ones.
  q('alter table orders add column if not exists factory_order boolean not null default false').catch(() => {});
  // notes column is used by manual orders (the PATCH map). Etsy note/gift go into
  // meta (meta.note / meta.gift) so the order-detail Notes + Gift Message fill in.
  q('alter table orders add column if not exists notes text').catch(() => {});
  // Re-classify Etsy orders by OWNER ROLE (not by id): factory_order=true only when
  // the connection owner is staff; a seller's own Etsy orders → false. Idempotent
  // (touches only rows whose flag is wrong), so it can't yank seller orders back to
  // the factory on every boot the way the old id-based force-flag did.
  q(`update orders set factory_order = (id like 'etsy-%' and exists (select 1 from users u where u.id = orders.seller_id and u.role <> 'seller'))
      where factory_order is distinct from (id like 'etsy-%' and exists (select 1 from users u where u.id = orders.seller_id and u.role <> 'seller'))`).catch(() => {});

  // Auto-sync: poll Etsy incrementally so new orders land WITHOUT anyone clicking
  // "Sync now". Incremental (min_last_modified) means each run is just a couple of
  // API calls — far under the 10/sec + 10k/day limits — instead of re-pulling the
  // whole shop (incl. already-shipped) like a manual full sync.
  if (KEYSTRING && SHARED_SECRET && !globalThis.__egEtsyAutoSync) {
    globalThis.__egEtsyAutoSync = setInterval(() => { syncAllEtsy({ full: false }).catch(() => {}); }, 5 * 60 * 1000);
    if (globalThis.__egEtsyAutoSync.unref) globalThis.__egEtsyAutoSync.unref();
  }

  // Frontend reads this to build the Etsy authorize URL (keystring is public).
  app.get('/api/etsy/config', async () => ({
    keystring: KEYSTRING, redirect_uri: REDIRECT_URI, scopes: SCOPES,
    configured: !!KEYSTRING
  }));

  // Same-origin image proxy for Etsy's public CDN. The factory boards run canvas
  // colour analysis (thread matching) on the buyer's uploaded artwork — but a
  // remote cross-origin image taints the canvas and getImageData() throws. Loading
  // it through THIS endpoint makes it same-origin, so the canvas stays readable.
  // Locked to *.etsystatic.com (no auth needed: it only re-serves public Etsy
  // images, so there's no SSRF surface).
  app.get('/api/etsy/img-proxy', async (req, reply) => {
    const url = req.query && req.query.url;
    if (!url) { reply.code(400); return { error: 'url required' }; }
    let host;
    try { host = new URL(url).hostname; } catch (e) { reply.code(400); return { error: 'bad url' }; }
    if (!/(^|\.)etsystatic\.com$/i.test(host)) { reply.code(403); return { error: 'host not allowed' }; }
    try {
      const r = await fetch(url);
      if (!r.ok) { reply.code(502); return { error: 'upstream ' + r.status }; }
      const buf = Buffer.from(await r.arrayBuffer());
      reply.header('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(buf);
    } catch (e) { reply.code(502); return { error: e.message }; }
  });

  // Lightweight connection check for ANY logged-in user (sellers publish to the
  // shop connected on the admin side). No tokens leaked — just names.
  app.get('/api/etsy/connected', { preHandler: requireAuth }, async () => {
    const r = await q(`select shop_name from platform_connections where platform='etsy' order by created_at`);
    return { connected: r.rowCount > 0, shops: r.rows.map(x => x.shop_name).filter(Boolean) };
  });

  // List connected shops (no tokens leaked). Staff see all; a seller sees only their
  // own connected shop (drives the seller-side connect UI).
  app.get('/api/etsy/connections', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const r = await q(
      staff ? `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at
                 from platform_connections where platform='etsy' order by created_at`
            : `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at
                 from platform_connections where platform='etsy' and connected_by=$1 order by created_at`,
      staff ? [] : [req.user.sub]);
    return r.rows;
  });

  // Diagnostic: list the connected shop's shipping profiles (so we can see if one
  // exists + its id, and whether reading them is a scope problem).
  app.get('/api/etsy/shipping-profiles', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const conn = (await q(`select * from platform_connections where platform='etsy' order by created_at limit 1`)).rows[0];
      if (!conn) { reply.code(400); return { error: 'No Etsy shop connected' }; }
      const sp = await etsyGet(conn, `/shops/${conn.shop_id}/shipping-profiles`);
      const list = sp.results || sp.shippingProfiles || [];
      return {
        shop_id: conn.shop_id, scopes: conn.scopes, count: list.length,
        profiles: list.map((p) => ({ id: p.shipping_profile_id || p.shippingProfileId, title: p.title || p.name })),
        response_keys: Object.keys(sp || {})
      };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Diagnostic: dump the address-relevant fields of the most recent receipt EXACTLY
  // as Etsy returns them — so we can tell whether Etsy is even sending the address
  // (vs a parsing bug here). Also lists every key on the receipt to spot a renamed
  // field. GET /api/etsy/raw-receipt
  app.get('/api/etsy/raw-receipt', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const conn = (await q(`select * from platform_connections where platform='etsy' order by created_at limit 1`)).rows[0];
      if (!conn) { reply.code(400); return { error: 'No Etsy shop connected' }; }
      const r = await etsyGet(conn, `/shops/${conn.shop_id}/receipts?limit=1&includes=Transactions`);
      const rc = (r.results || [])[0] || {};
      // Compare with the SINGLE-receipt endpoint: if the list is shallow, this one
      // returns the full address (then the fix is to import from here). If BOTH are
      // null, Etsy is withholding the buyer address from this app (a permissions gate).
      let single = {};
      try { if (rc.receipt_id) single = await etsyGet(conn, `/shops/${conn.shop_id}/receipts/${rc.receipt_id}`); }
      catch (e) { single = { error: e.message }; }
      // Test the x-api-key theory: refetch the SAME receipt with x-api-key = keystring
      // ALONE (the Etsy-v3-correct value) instead of our "keystring:shared_secret".
      let keyOnly = {};
      try {
        if (rc.receipt_id) {
          const tok = await validToken(conn);
          const res = await fetch(API + `/shops/${conn.shop_id}/receipts/${rc.receipt_id}`, { headers: { 'x-api-key': KEYSTRING, Authorization: 'Bearer ' + tok } });
          keyOnly = await res.json().catch(() => ({}));
          if (!res.ok) keyOnly = { http: res.status, body: keyOnly };
        }
      } catch (e) { keyOnly = { error: e.message }; }
      const addr = (x) => ({ name: x.name, first_line: x.first_line, city: x.city, state: x.state, zip: x.zip, formatted_address: x.formatted_address });
      return {
        sharedSecretSet: !!SHARED_SECRET,
        apiKeyMode: API_KEY_HEADER && API_KEY_HEADER.indexOf(':') >= 0 ? 'keystring:secret' : 'keystring-only',
        connScopes: conn.scopes,
        scopes: conn.scopes,
        receipt_id: rc.receipt_id,
        state: { is_paid: rc.is_paid, is_shipped: rc.is_shipped, status: rc.status, receipt_type: rc.receipt_type, buyer_user_id: rc.buyer_user_id },
        address_from_list: addr(rc),
        address_from_single: single.error ? single : addr(single),
        address_keystring_only: keyOnly.error || keyOnly.http ? keyOnly : addr(keyOnly),
        receipt_keys: Object.keys(rc)
      };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // OAuth code → tokens. Called by oauth-callback.html after Etsy redirects back.
  // requireAuth (not staff): a SELLER connects their OWN shop here — connected_by is
  // set to the caller, so importReceipt routes their orders to them (factory_order=false).
  app.post('/api/etsy/exchange', { preHandler: requireAuth }, async (req, reply) => {
    const { code, code_verifier, redirect_uri } = req.body || {};
    if (!KEYSTRING) { reply.code(500); return { error: 'Server missing ETSY_KEYSTRING' }; }
    if (!code || !code_verifier) { reply.code(400); return { error: 'Missing code or verifier' }; }
    try {
      const t = await etsyTokenRequest({
        grant_type: 'authorization_code', client_id: KEYSTRING,
        redirect_uri: redirect_uri || REDIRECT_URI, code, code_verifier
      });
      const expires = new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString();
      // The user id is the prefix of the access token: "<user_id>.<token>".
      const userId = String(t.access_token).split('.')[0];
      const tmp = { access_token: t.access_token, refresh_token: t.refresh_token, token_expires_at: expires };
      // Find the shop owned by this user.
      let shopId = '', shopName = '';
      try {
        const shops = await etsyGet(tmp, `/users/${userId}/shops`);
        const shop = Array.isArray(shops?.results) ? shops.results[0] : shops;
        shopId = String(shop?.shop_id || userId);
        shopName = shop?.shop_name || ('Etsy shop ' + shopId);
      } catch (e) { shopId = userId; shopName = 'Etsy shop ' + userId; }

      await q(
        `insert into platform_connections (platform, shop_id, shop_name, access_token, refresh_token, token_expires_at, scopes, connected_by)
         values ('etsy',$1,$2,$3,$4,$5,$6,$7)
         on conflict (platform, shop_id) do update set
           shop_name=excluded.shop_name, access_token=excluded.access_token,
           refresh_token=excluded.refresh_token, token_expires_at=excluded.token_expires_at,
           scopes=excluded.scopes, connected_by=excluded.connected_by, updated_at=now()`,
        [shopId, shopName, t.access_token, t.refresh_token, expires, SCOPES, req.user.sub]
      );
      return { ok: true, shop_id: shopId, shop_name: shopName };
    } catch (e) {
      reply.code(400); return { error: e.message };
    }
  });

  app.delete('/api/etsy/connections/:shop_id', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    if (staff) await q(`delete from platform_connections where platform='etsy' and shop_id=$1`, [req.params.shop_id]);
    else await q(`delete from platform_connections where platform='etsy' and shop_id=$1 and connected_by=$2`, [req.params.shop_id, req.user.sub]);
    return { ok: true };
  });

  // Pull orders (receipts) into our DB. Incremental by default (only what changed
  // since the last sync); pass { full: true } in the body to force a complete pull.
  app.post('/api/etsy/sync', { preHandler: requireAuth }, async (req, reply) => {
    if (!SHARED_SECRET) { reply.code(400); return { error: 'Server is missing ETSY_SHARED_SECRET. Add it to the server .env and redeploy.' }; }
    // Sellers sync ONLY their own shop; staff sync every connection.
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const ownerId = staff ? null : req.user.sub;
    const has = await q(
      ownerId ? `select 1 from platform_connections where platform='etsy' and connected_by=$1 limit 1`
              : `select 1 from platform_connections where platform='etsy' limit 1`,
      ownerId ? [ownerId] : []);
    if (!has.rowCount) { reply.code(400); return { error: ownerId ? 'No Etsy shop connected to your account' : 'No Etsy shop connected' }; }
    // One-time cleanup (staff only): purge any Etsy listings a previous version
    // imported into the base-product catalog (they don't belong there).
    let purged = { rowCount: 0 };
    if (staff) purged = await q(`delete from catalog_products where id like 'etsy-%'`);
    const res = await syncAllEtsy({ full: !!(req.body && req.body.full), shopId: (req.body && req.body.shop_id) || null, ownerId });
    return { ...res, catalog_listings_purged: purged.rowCount || 0 };
  });

  // ── Test helper: inject a realistic SAMPLE Etsy order owned by the CALLER, so the
  // seller-side experience (listing image as the hero, customer note, gift message,
  // editable items) can be exercised without a real purchase. A seller calling it
  // gets a seller-owned order (factory_order=false → shows on their dashboard).
  app.post('/api/etsy/sample', { preHandler: requireAuth }, async (req) => {
    const isFactory = !!(req.user && req.user.role && req.user.role !== 'seller');
    // Idempotent: clear this caller's existing sample(s) first, so repeated calls
    // REPLACE rather than pile up duplicate "Jamie Rivera" orders.
    await q(`delete from order_items where order_id in (select id from orders where seller_id=$1 and id like 'etsy-SAMPLE-%')`, [req.user.sub]).catch(() => {});
    await q(`delete from orders where seller_id=$1 and id like 'etsy-SAMPLE-%'`, [req.user.sub]).catch(() => {});
    const id = 'etsy-SAMPLE-' + Date.now().toString(36);
    const meta = { source: 'etsy', sample: true, isGift: true,
      note: 'Please use navy thread for the embroidery — thank you! 💙',
      gift: 'Happy Birthday, Mom! Love, Jamie' };
    await q(
      `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, created_at, factory_order, meta)
       values ($1,$2,$3,'etsy',$4,$5,'new','new',$6, now(), $7, $8)`,
      [id, req.user.sub, 'My Etsy Shop (sample)',
       { name: 'Jamie Rivera', email: 'jamie.rivera@example.com' },
       { line1: '742 Evergreen Terrace', line2: '', city: 'Portland', state: 'OR', zip: '97201', country: 'US', formatted: '742 Evergreen Terrace, Portland, OR 97201' },
       42.00, isFactory, meta]
    );
    const items = [
      ['EMB-APRON-NVY', 'Personalized Embroidered Linen Apron', 1, 'Navy / Embroidery', 32.00, 'https://placehold.co/600x600/6b7a4f/ffffff?text=Apron+Listing', 'EMB', 'The Rivera Kitchen'],
      ['TEE-WHT-L', 'Custom Print Cotton Tee', 2, 'White / L', 5.00, 'https://placehold.co/600x600/efefef/333333?text=Tee+Listing', 'DTG', null]
    ];
    for (const it of items) {
      await q(
        `insert into order_items (order_id, sku, name, qty, variant, unit_price, img, print_type, personalization, line_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, it[0], it[1], it[2], it[3], it[4], it[5], it[6], it[7], genLineId()]
      );
    }
    return { ok: true, id, ownedBy: isFactory ? 'factory' : 'seller' };
  });
  // Clean up sample orders. Staff wipe ALL of them; a seller wipes only their own.
  app.delete('/api/etsy/sample', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const where = staff ? `id like 'etsy-SAMPLE-%'` : `seller_id=$1 and id like 'etsy-SAMPLE-%'`;
    const params = staff ? [] : [req.user.sub];
    await q(`delete from order_items where order_id in (select id from orders where ${where})`, params).catch(() => {});
    const r = await q(`delete from orders where ${where}`, params);
    return { ok: true, removed: r.rowCount || 0 };
  });

  // ── Webhook receiver (real-time). Etsy POSTs here when an order event fires.
  // Public (Etsy has no bearer token). Effect is read-only: an incremental sync
  // pulls just the changed receipts — so it can't be abused to mutate anything.
  // Register this URL in the Etsy webhooks portal: https://egful.store/api/webhooks/etsy
  app.post('/api/webhooks/etsy', async () => {
    const res = await syncAllEtsy({});   // incremental — picks up the event's order
    const imported = Array.isArray(res.synced) ? res.synced.reduce((n, s) => n + (s.orders || 0), 0) : 0;
    return { ok: true, imported };
  });

  // ── Publish a design to Etsy as a DRAFT listing, then upload the design image.
  // Called from the "Publish to store" window on the seller + factory design pages.
  // body: { title, description, price, quantity?, image (data URL), images?[], sku?, taxonomy_id? }
  app.post('/api/etsy/publish', { preHandler: requireAuth }, async (req, reply) => {
    try {
      if (!SHARED_SECRET) { reply.code(400); return { error: 'Server is missing ETSY_SHARED_SECRET.' }; }
      const conn = (await q(`select * from platform_connections where platform='etsy' order by created_at limit 1`)).rows[0];
      if (!conn) { reply.code(400); return { error: 'No Etsy shop connected.' }; }
      const b = req.body || {};
      const title = String(b.title || '').trim();
      const price = Number(b.price) || 0;
      if (!title) { reply.code(400); return { error: 'A listing title is required.' }; }
      if (!price) { reply.code(400); return { error: 'A retail price is required.' }; }

      // Physical listings require several shop-specific IDs that Etsy keeps adding to
      // (shipping_profile_id, then readiness_state_id, …). The reliable way to get
      // valid values for THIS shop is to borrow them from one of its existing active
      // listings — then we always match whatever Etsy currently requires.
      let shipId = (b.shipping_profile_id != null) ? String(b.shipping_profile_id) : null;
      let taxId = (b.taxonomy_id != null) ? String(b.taxonomy_id) : null;
      let readinessId = (b.readiness_state_id != null) ? String(b.readiness_state_id) : null;
      let returnPolicyId = (b.return_policy_id != null) ? String(b.return_policy_id) : null;
      try {
        const al = await etsyFetch(conn, `/shops/${conn.shop_id}/listings?state=active&limit=1`);
        const ex = al.results && al.results[0];
        if (ex) {
          if (!taxId && ex.taxonomy_id != null) taxId = String(ex.taxonomy_id);
          if (!shipId && ex.shipping_profile_id != null) shipId = String(ex.shipping_profile_id);
          if (!readinessId && ex.readiness_state_id != null) readinessId = String(ex.readiness_state_id);
          if (!returnPolicyId && ex.return_policy_id != null) returnPolicyId = String(ex.return_policy_id);
        }
      } catch (e) {}
      // Fallback: shipping profile from the shop's profile list if no active listing.
      if (!shipId) {
        try {
          const sp = await etsyFetch(conn, `/shops/${conn.shop_id}/shipping-profiles`);
          const list = sp.results || sp.shippingProfiles || [];
          if (list[0]) shipId = String(list[0].shipping_profile_id || list[0].shippingProfileId || '');
        } catch (e) {}
      }
      if (!taxId)  { reply.code(400); return { error: 'No category (taxonomy_id) available — publish one listing manually on Etsy first so we can reuse its category, or pass taxonomy_id.' }; }
      if (!shipId) { reply.code(400); return { error: 'No Etsy shipping profile found — create one in your Etsy Shop Manager → Settings → Shipping (or pass shipping_profile_id).' }; }

      // Create the DRAFT listing.
      const form = new URLSearchParams({
        quantity: String(b.quantity || 999),
        title: title.slice(0, 140),
        description: String(b.description || title),
        price: String(price),
        who_made: 'i_did', when_made: 'made_to_order', type: 'physical', state: 'draft',
        taxonomy_id: String(taxId), shipping_profile_id: String(shipId)
      });
      if (readinessId) form.append('readiness_state_id', String(readinessId));
      if (returnPolicyId) form.append('return_policy_id', String(returnPolicyId));
      const listing = await etsyFetch(conn, `/shops/${conn.shop_id}/listings`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString()
      });
      const listingId = listing.listing_id;

      // Upload the design image(s).
      const imgs = (Array.isArray(b.images) && b.images.length) ? b.images : (b.image ? [b.image] : []);
      let uploaded = 0;
      for (const dataUrl of imgs) {
        try {
          const m = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(String(dataUrl));
          if (!m) continue;
          const buf = Buffer.from(m[2], 'base64');
          const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg');
          const fd = new FormData();
          fd.append('image', new Blob([buf], { type: m[1] }), 'design.' + ext);
          await etsyFetch(conn, `/shops/${conn.shop_id}/listings/${listingId}/images`, { method: 'POST', body: fd });
          uploaded++;
        } catch (e) { /* keep going; the draft still exists without the image */ }
      }

      return {
        ok: true, listing_id: listingId, state: listing.state || 'draft', images_uploaded: uploaded,
        url: listing.url || `https://www.etsy.com/listing/${listingId}`
      };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // ── Push tracking back to Etsy (marks the order shipped on Etsy AND emails the
  // buyer). Customer-facing — call it deliberately, not on every status change.
  app.post('/api/etsy/fulfill', { preHandler: requireStaff }, async (req, reply) => {
    const { order_id, tracking_code, carrier_name } = req.body || {};
    const m = String(order_id || '').match(/^etsy-(.+)$/i);
    if (!m) { reply.code(400); return { error: 'Not an Etsy order' }; }
    const receiptId = m[1];
    const ord = (await q('select store from orders where id=$1', [order_id])).rows[0];
    const conns = (await q(`select * from platform_connections where platform='etsy'`)).rows;
    const conn = conns.find((c) => c.shop_name === (ord && ord.store)) || conns[0];
    if (!conn) { reply.code(400); return { error: 'No Etsy shop connected' }; }
    try {
      const token = await validToken(conn);
      const res = await fetch(`${API}/shops/${conn.shop_id}/receipts/${receiptId}/tracking`, {
        method: 'POST',
        headers: { 'x-api-key': API_KEY_HEADER, Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tracking_code: tracking_code || '', carrier_name: (carrier_name || 'usps').toLowerCase(), send_bcc: 'false' }).toString()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { reply.code(400); return { error: data.error || ('Etsy ' + res.status) }; }
      return { ok: true };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Debug (staff): return the RAW Etsy receipt(s) + transactions so we can see
  // exactly which fields Etsy sends — including any personalization/file-upload
  // fields. Read-only. Optional ?id=<receipt_id> for one order, else first 3.
  app.get('/api/etsy/debug', { preHandler: requireStaff }, async (req, reply) => {
    const conn = (await q(`select * from platform_connections where platform='etsy' limit 1`)).rows[0];
    if (!conn) { reply.code(400); return { error: 'No Etsy shop connected' }; }
    try {
      if (req.query && req.query.id) {
        const r = await etsyGet(conn, `/shops/${conn.shop_id}/receipts/${req.query.id}?includes=Transactions`);
        return r;
      }
      const r = await etsyGet(conn, `/shops/${conn.shop_id}/receipts?limit=3&offset=0&includes=Transactions`);
      return r;
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Diagnostic + self-repair (staff): a connection can store shop_id = user_id when the
  // owner-lookup failed at connect time, which 400s EVERY receipts call ("Could not
  // find a shop for user with user_id …"). This resolves the real shop_id — preferring
  // findShops-by-name (?shop_name=CustomBabeUSA), which works regardless of Etsy's
  // quirky owner-lookup — repairs the stored connection, then TESTS whether this token
  // can actually read the shop's receipts (the definitive owner-vs-not check).
  //   GET /api/etsy/whoami?shop_name=CustomBabeUSA
  app.get('/api/etsy/whoami', { preHandler: requireStaff }, async (req, reply) => {
    const conn = (await q(`select * from platform_connections where platform='etsy' order by created_at limit 1`)).rows[0];
    if (!conn) { reply.code(400); return { error: 'No Etsy shop connected' }; }
    const userId = String(conn.access_token).split('.')[0];
    const out = { stored_shop_id: conn.shop_id, stored_shop_name: conn.shop_name, token_user_id: userId,
                  apiKeyMode: API_KEY_HEADER.indexOf(':') >= 0 ? 'keystring:secret' : 'keystring-only' };
    let shop = null;
    // 1) Preferred when a name is supplied: findShops by name. Public data, no owner
    //    requirement — reliably yields the numeric shop_id.
    const wantName = String((req.query && req.query.shop_name) || '').trim();
    if (wantName) {
      try {
        const r = await etsyGet(conn, `/shops?shop_name=${encodeURIComponent(wantName)}`);
        const list = r.results || [];
        out.findShops_count = list.length;
        const match = list.find(s => String(s.shop_name || '').toLowerCase() === wantName.toLowerCase()) || list[0];
        if (match && match.shop_id) shop = match;
      } catch (e) { out.findShops_error = e.message; }
    }
    // 2) Fallback: owner-lookup by the token's user_id.
    if (!shop || !shop.shop_id) {
      try {
        const r = await etsyGet(conn, `/users/${userId}/shops`);
        out.users_shops = r;
        shop = Array.isArray(r && r.results) ? r.results[0] : r;
      } catch (e) { out.users_shops_error = e.message; }
    }
    if (shop && shop.shop_id) {
      if (String(shop.shop_id) !== String(conn.shop_id)) {
        await q('update platform_connections set shop_id=$1, shop_name=$2, updated_at=now() where id=$3',
          [String(shop.shop_id), shop.shop_name || conn.shop_name, conn.id]);
        conn.shop_id = String(shop.shop_id); conn.shop_name = shop.shop_name || conn.shop_name;
        out.repaired = { new_shop_id: conn.shop_id, shop_name: conn.shop_name };
      }
      // The definitive test: can THIS token read the shop's receipts? 200 = owner/authorized;
      // 403 = the connected Etsy account does not own this shop (reconnect as the owner).
      try {
        const rc = await etsyGet(conn, `/shops/${conn.shop_id}/receipts?limit=1&includes=Transactions`);
        out.receipts_access = { ok: true, count: (rc.results || []).length };
      } catch (e) { out.receipts_access = { ok: false, error: e.message }; }
    }
    return out;
  });
}
