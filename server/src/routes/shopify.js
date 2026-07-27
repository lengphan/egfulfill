// Shopify integration — OAuth connect (mirrors the TikTok/Etsy flow).
// Shopify OAuth is PER-STORE: the seller enters their <shop>.myshopify.com, we redirect
// to that store's /admin/oauth/authorize, Shopify returns code+hmac+shop to our callback,
// and we exchange for an OFFLINE access token (no expiry). connected_by = the caller, so a
// seller connects their OWN store. Only *.myshopify.com is allowed (SSRF guard).
import crypto from 'node:crypto';
import { q } from '../db.js';

const API_KEY     = process.env.SHOPIFY_API_KEY || '';
const API_SECRET  = process.env.SHOPIFY_API_SECRET || '';
// Keep in lockstep with the scopes configured on the Shopify app (the authorize
// request must be a subset of the app's allowed scopes). Fulfillment scopes get added
// when order-sync/tracking is built.
// Fulfillment-order scopes are needed to push tracking (create a fulfillment). A store
// connected before these were added must RECONNECT to grant them, or the fulfillment 403s.
const SCOPES      = process.env.SHOPIFY_SCOPES || 'read_orders,write_orders,read_products,write_merchant_managed_fulfillment_orders,read_merchant_managed_fulfillment_orders';
// Force canonical (non-www) so the authorize redirect_uri matches the popup origin.
const REDIRECT_URI = (process.env.SHOPIFY_REDIRECT_URI || 'https://egful.store/oauth-callback.html').replace('://www.', '://');
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
function validShop(s) { return typeof s === 'string' && SHOP_RE.test(s); }

// Verify Shopify's HMAC over the callback params — proves the request is genuinely from
// Shopify signed with OUR app secret (drop hmac/signature, sort, join k=v with &).
function verifyHmac(params) {
  if (!params || !params.hmac || !API_SECRET) return false;
  const msg = Object.keys(params)
    .filter(k => k !== 'hmac' && k !== 'signature')
    .sort()
    .map(k => `${k}=${Array.isArray(params[k]) ? params[k].join(',') : params[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', API_SECRET).update(msg).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(String(params.hmac), 'utf8')); }
  catch (e) { return false; }
}

// Webhook HMAC — DIFFERENT from verifyHmac above. Webhooks sign the raw request BYTES
// and base64-encode the digest; the OAuth callback signs sorted query params as hex. Mixing
// the two silently rejects every webhook, so they stay separate on purpose.
function verifyWebhookHmac(rawBody, header) {
  if (!rawBody || !header || !API_SECRET) return false;
  const digest = crypto.createHmac('sha256', API_SECRET).update(rawBody).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(header))); }
  catch { return false; }
}

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const genLineId = () => 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
// Sanitize the connect-time "how far back to import" choice → whole days in [0,365], or null
// when the caller didn't choose (older connection). 0 = new orders only (no history).
function clampDays(v) {
  if (v == null || v === '') return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(365, n));
}

// A Shopify line item's custom properties ([{name,value}]) carry the buyer's uploaded
// file + personalization, exactly like Etsy variations. Same split rule as importReceipt.
function parseLineProps(line) {
  let uploadUrl = null, personalization = null; const vparts = [];
  for (const p of (line.properties || [])) {
    const val = String(p.value == null ? '' : p.value);
    const nm = String(p.name || '').toLowerCase();
    if (!val || nm.startsWith('_')) continue;   // _-prefixed props are Shopify-internal
    if (/^https?:\/\//i.test(val) && (/upload|logo|file|image|photo|art|design/.test(nm) || /\.(png|jpe?g|gif|webp|svg|pdf|ai|eps|psd|tiff?)(\?|$)/i.test(val))) uploadUrl = val;
    else if (nm.indexOf('personaliz') !== -1 || nm.indexOf('monogram') !== -1) personalization = val;
    else vparts.push(val);
  }
  return { uploadUrl, personalization, extra: vparts.join(', ') || null };
}

// Upsert one Shopify order into `orders`. Mirrors etsy.js importReceipt: re-syncs and
// orders/updated webhooks only refresh money + address, NEVER the internal pipeline
// (status/factory_status) or items — otherwise a seller's in-progress order would reset
// every time the buyer's shop pinged an update.
async function importShopifyOrder(conn, order, isFactory) {
  const id = 'shopify-' + order.id;
  const cancelled = !!order.cancelled_at;
  const shipped = String(order.fulfillment_status || '').toLowerCase() === 'fulfilled';
  const status = cancelled ? 'cancelled' : (shipped ? 'shipped' : 'new');
  const createdIso = order.created_at || null;
  const cust = order.customer || {};
  const custName = [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim()
    || `${order.name || ''}`.trim() || 'Shopify customer';
  const a = order.shipping_address || order.billing_address || {};
  const address = {
    line1: a.address1 || '', line2: a.address2 || '', city: a.city || '',
    state: a.province_code || a.province || '', zip: a.zip || '',
    country: a.country_code || a.country || '',
    formatted: [a.address1, a.address2, a.city, a.province_code || a.province, a.zip].filter(Boolean).join(', '),
  };
  const track = (order.fulfillments || []).map((f) => f.tracking_number).filter(Boolean)[0] || null;
  // Shopify's own order number (#1001) is what the seller recognises — keep it for
  // display. note = buyer note. Set on INSERT only (out of the conflict update) so a
  // seller's later edits survive a re-sync, same as the Etsy importer.
  const meta = { source: 'shopify', shopify_name: order.name || null,
                 isGift: /gift/i.test(order.note || ''), note: order.note || '' };
  await q(
    `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, tracking, created_at, factory_order, meta)
     values ($1,$2,$3,'shopify',$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now()), $11, $12)
     on conflict (id) do update set total=excluded.total,
       customer=excluded.customer, address=excluded.address, tracking=coalesce(excluded.tracking, orders.tracking),
       created_at=coalesce($10::timestamptz, orders.created_at), updated_at=now()`,
    [id, conn.connected_by, conn.shop_name || conn.shop_id,
     { name: custName, email: cust.email || order.email || null }, address,
     status, status, num(order.total_price), track, createdIso, !!isFactory, meta]
  );
  // Items only on first import — like Etsy, a re-sync must not wipe factory picks.
  const hasItems = await q('select 1 from order_items where order_id=$1 limit 1', [id]);
  if (!hasItems.rowCount) {
    for (const line of (order.line_items || [])) {
      const { uploadUrl, personalization, extra } = parseLineProps(line);
      const variant = [line.variant_title, extra].filter((s) => s && s !== 'Default Title').join(', ') || null;
      const method = /embroider|embroidered|embroidery|monogram/i.test(`${line.title || ''} ${variant || ''}`) ? 'EMB' : null;
      await q(
        `insert into order_items (order_id, sku, name, qty, variant, unit_price, design_src, personalization, print_type, line_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, line.sku || null, line.title || null, line.quantity || 1, variant, num(line.price), uploadUrl, personalization, method, genLineId()]
      );
    }
  }
  return cancelled ? 'cancelled' : 'imported';
}

// Is this connection's owner staff (factory-owned orders) or a seller (seller-owned)?
// Same rule as Etsy: factory_order = the connector is not a seller.
async function connIsFactory(conn) {
  if (!conn.connected_by) return false;
  const r = await q('select role from users where id=$1', [conn.connected_by]);
  return !!(r.rows[0] && r.rows[0].role && r.rows[0].role !== 'seller');
}

// Pull recent orders for one connection (backfill / manual sync). Webhooks handle
// real-time; this covers the just-connected backlog and any missed events. `status=any`
// so we see unfulfilled + fulfilled; Shopify caps page size at 250.
async function syncShopifyConnection(conn) {
  const isFactory = await connIsFactory(conn);
  let imported = 0, cancelled = 0;
  // Bound the pull to the scope chosen at connect (conn.backfill_days): N → the last N days;
  // 0 → new orders only (from when the store connected); null (older connection) → unchanged
  // (up to Shopify's 250 most recent, as before). Webhooks keep things current after connect.
  let url = `https://${conn.shop_id}/admin/api/${API_VERSION}/orders.json?status=any&limit=250`;
  if (conn.backfill_days != null) {
    const sinceIso = conn.backfill_days > 0
      ? new Date(Date.now() - conn.backfill_days * 86400000).toISOString()
      : (conn.created_at ? new Date(conn.created_at).toISOString() : null);
    if (sinceIso) url += `&created_at_min=${encodeURIComponent(sinceIso)}`;
  }
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': conn.access_token } });
  if (!r.ok) throw new Error(`Shopify orders fetch failed (${r.status})`);
  const data = await r.json().catch(() => ({}));
  for (const order of (data.orders || [])) {
    const res = await importShopifyOrder(conn, order, isFactory);
    if (res === 'cancelled') cancelled++; else imported++;
  }
  await q('update platform_connections set last_sync_at=now() where id=$1', [conn.id]).catch(() => {});
  return { shop: conn.shop_id, imported, cancelled };
}

// Register the order webhooks on the store right after connect, so we don't depend on
// anyone wiring them by hand. Idempotent: Shopify dedupes by (topic,address), returning
// 422 for an existing one — which we treat as success. Compliance webhooks
// (customers/data_request, customers/redact, shop/redact) are configured in the Partner
// Dashboard app settings, not here; they hit the same /api/webhooks/shopify endpoint.
async function registerWebhooks(shop, token) {
  const address = (process.env.SHOPIFY_WEBHOOK_URL || 'https://egful.store/api/webhooks/shopify');
  const topics = ['orders/create', 'orders/updated', 'orders/cancelled'];
  const results = [];
  for (const topic of topics) {
    try {
      const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/webhooks.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
      });
      results.push({ topic, ok: r.ok || r.status === 422 });   // 422 = already registered
    } catch (e) { results.push({ topic, ok: false, error: e.message }); }
  }
  return results;
}

// Our carrier → Shopify's tracking "company" (its supported carrier list auto-builds the
// tracking URL). Unknown carriers pass through verbatim, which Shopify accepts as a custom name.
function shopifyCarrier(c) {
  const s = String(c || '').trim().toLowerCase();
  if (!s) return 'Other';
  if (s.includes('usps')) return 'USPS';
  if (s.includes('ups')) return 'UPS';
  if (s.includes('fedex')) return 'FedEx';
  if (s.includes('dhl')) return 'DHL Express';
  return String(c);
}

/**
 * Push tracking to Shopify for one order — creates a Fulfillment against the order's open
 * fulfillment orders, which marks it fulfilled and (notify_customer) EMAILS the buyer.
 * VERIFIED against the Admin REST docs: GET the order's fulfillment_orders, then
 * POST /fulfillments.json with line_items_by_fulfillment_order + tracking_info. Bound to the
 * order's OWNER store (no fallback). Throws on any problem. NB: needs the fulfillment-order
 * scopes below — an existing connection must RECONNECT before this works.
 */
export async function shopifyPushTracking(order, tracking, carrier) {
  const m = String((order && order.id) || '').match(/^shopify-(.+)$/i);
  if (!m) throw new Error('Not a Shopify order');
  const orderNumId = m[1];
  const conns = (await q(`select * from platform_connections where platform='shopify'`)).rows;
  const conn = conns.find((c) => order && String(c.connected_by) === String(order.seller_id))
    || conns.find((c) => order && c.shop_name && c.shop_name === order.store)
    || null;
  if (!conn) throw new Error("Couldn't tell which connected Shopify store this order belongs to");
  const base = `https://${conn.shop_id}/admin/api/${API_VERSION}`;
  const headers = { 'X-Shopify-Access-Token': conn.access_token, 'Content-Type': 'application/json' };
  const foRes = await fetch(`${base}/orders/${encodeURIComponent(orderNumId)}/fulfillment_orders.json`, { headers });
  const foData = await foRes.json().catch(() => ({}));
  if (!foRes.ok) throw new Error(`Shopify fulfillment_orders ${foRes.status}`);
  const open = (foData.fulfillment_orders || []).filter((f) => ['open', 'in_progress', 'scheduled'].includes(String(f.status)));
  if (!open.length) return { ok: true, channel: 'shopify', already: true };   // nothing left to fulfil
  const body = { fulfillment: {
    line_items_by_fulfillment_order: open.map((f) => ({ fulfillment_order_id: f.id })),
    tracking_info: { number: tracking, company: shopifyCarrier(carrier) },
    notify_customer: true,
  } };
  const fRes = await fetch(`${base}/fulfillments.json`, { method: 'POST', headers, body: JSON.stringify(body) });
  const fData = await fRes.json().catch(() => ({}));
  if (!fRes.ok) throw new Error((fData.errors && JSON.stringify(fData.errors)) || `Shopify fulfillment ${fRes.status}`);
  return { ok: true, channel: 'shopify' };
}

export function shopifyRoutes(app, requireAuth, requireStaff) {
  // Shared connections table (created by etsy.js too) — idempotent.
  q(`create table if not exists platform_connections (
       id uuid primary key default gen_random_uuid(),
       platform text not null default 'etsy', shop_id text not null, shop_name text,
       access_token text, refresh_token text, token_expires_at timestamptz, scopes text,
       last_sync_at timestamptz, connected_by uuid references users(id) on delete set null,
       created_at timestamptz default now(), updated_at timestamptz default now(),
       unique (platform, shop_id))`)
    .catch(() => {})
    // How far back the first import reaches, chosen at connect time (null = older connection).
    // CHAINED off the create so it can't ALTER before the table exists on a fresh DB.
    .then(() => q('alter table platform_connections add column if not exists backfill_days integer').catch(() => {}));

  // Frontend reads this to build the per-store authorize URL (api_key is public).
  app.get('/api/shopify/config', async () => ({
    api_key: API_KEY, scopes: SCOPES, redirect_uri: REDIRECT_URI,
    configured: !!(API_KEY && API_SECRET)
  }));

  // A SELLER sees only shop(s) THEY connected. FACTORY/staff share one pool of factory-connected
  // shops (any non-seller connector), gated against seller shops.
  app.get('/api/shopify/connected', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const r = await q(staff
      ? `select shop_name from platform_connections pc where platform='shopify' and not exists (select 1 from users u where u.id=pc.connected_by and u.role='seller') order by created_at`
      : `select shop_name from platform_connections where platform='shopify' and connected_by=$1 order by created_at`,
      staff ? [] : [req.user.sub]);
    return { connected: r.rowCount > 0, shops: r.rows.map(x => x.shop_name).filter(Boolean) };
  });

  // Staff see all; a seller sees only their own connected store.
  app.get('/api/shopify/connections', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const r = await q(
      staff ? `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at
                 from platform_connections where platform='shopify' order by created_at`
            : `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at
                 from platform_connections where platform='shopify' and connected_by=$1 order by created_at`,
      staff ? [] : [req.user.sub]);
    return r.rows;
  });

  // OAuth code → offline token. Called by oauth-callback.html after Shopify redirects back.
  app.post('/api/shopify/exchange', { preHandler: requireAuth }, async (req, reply) => {
    if (!API_KEY || !API_SECRET) { reply.code(500); return { error: 'Server missing SHOPIFY_API_KEY / SHOPIFY_API_SECRET' }; }
    const body = req.body || {};
    const shop = String(body.shop || '').trim().toLowerCase();
    const code = body.code;
    const bd = clampDays(body.backfill_days);   // how far back the first import reaches
    // Params for the HMAC check: an explicit object, or parse the raw callback query string.
    let params = body.params;
    if (!params && typeof body.query === 'string') params = Object.fromEntries(new URLSearchParams(body.query.replace(/^\?/, '')));
    if (!validShop(shop)) { reply.code(400); return { error: 'Invalid shop domain — must be a <name>.myshopify.com store' }; }
    if (!code) { reply.code(400); return { error: 'Missing authorization code' }; }
    if (!verifyHmac(params || {})) { reply.code(400); return { error: 'HMAC verification failed — the callback could not be trusted' }; }
    try {
      const tr = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code })
      });
      const t = await tr.json().catch(() => ({}));
      if (!tr.ok || !t.access_token) throw new Error(t.error_description || t.error || ('Shopify token error ' + tr.status));
      // Best-effort: fetch the store's display name.
      let shopName = shop;
      try {
        const sr = await fetch(`https://${shop}/admin/api/${API_VERSION}/shop.json`, { headers: { 'X-Shopify-Access-Token': t.access_token } });
        const sd = await sr.json().catch(() => ({}));
        if (sd && sd.shop && sd.shop.name) shopName = sd.shop.name;
      } catch (e) {}
      // Offline token → no expiry; refresh_token stays null.
      await q(
        `insert into platform_connections (platform, shop_id, shop_name, access_token, refresh_token, token_expires_at, scopes, connected_by, backfill_days)
         values ('shopify',$1,$2,$3,null,null,$4,$5,$6)
         on conflict (platform, shop_id) do update set
           shop_name=excluded.shop_name, access_token=excluded.access_token,
           scopes=excluded.scopes, connected_by=excluded.connected_by,
           backfill_days=excluded.backfill_days, updated_at=now()`,
        [shop, shopName, t.access_token, t.scope || SCOPES, req.user.sub, bd]
      );
      // Register order webhooks now, so real-time sync works without manual setup.
      // Best-effort: a failure here doesn't block the connection (the backfill sync
      // still works), it just means no live updates until re-registered.
      let webhooks = [];
      try { webhooks = await registerWebhooks(shop, t.access_token); } catch (e) { /* non-fatal */ }
      // Backfill the existing order backlog immediately, so a freshly-connected store
      // isn't empty until the first new webhook fires.
      let backfill = null;
      try {
        const conn = (await q(`select * from platform_connections where platform='shopify' and shop_id=$1`, [shop])).rows[0];
        if (conn) backfill = await syncShopifyConnection(conn);
      } catch (e) { backfill = { error: e.message }; }
      return { ok: true, shop_id: shop, shop_name: shopName, scopes: t.scope || SCOPES, webhooks, backfill };
    } catch (e) {
      reply.code(400); return { error: e.message };
    }
  });

  // Manual/backfill sync — a seller syncs their own store, staff sync all. Mirrors
  // /api/etsy/sync. Webhooks keep things current; this is the "pull now" button and the
  // recovery path if a webhook was ever missed.
  app.post('/api/shopify/sync', { preHandler: requireAuth }, async (req, reply) => {
    if (!API_KEY || !API_SECRET) { reply.code(400); return { error: 'Server missing SHOPIFY_API_KEY / SHOPIFY_API_SECRET' }; }
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const conns = (await q(
      staff ? `select * from platform_connections where platform='shopify'`
            : `select * from platform_connections where platform='shopify' and connected_by=$1`,
      staff ? [] : [req.user.sub])).rows;
    if (!conns.length) { reply.code(400); return { error: staff ? 'No Shopify store connected' : 'No Shopify shop connected to your account' }; }
    const synced = [];
    for (const conn of conns) {
      try { synced.push(await syncShopifyConnection(conn)); }
      catch (e) { synced.push({ shop: conn.shop_id, error: e.message }); }
    }
    return { ok: true, synced };
  });

  // ── Webhook receiver. ONE public endpoint for every Shopify topic (order events +
  // the mandatory GDPR compliance webhooks). Shopify signs the raw body; we verify with
  // the app secret before trusting anything, so being public + unauthenticated is safe.
  // Routed by the X-Shopify-Topic header. Configure this URL as BOTH the app's webhook
  // endpoint and its compliance-webhook endpoint in the Partner Dashboard.
  app.post('/api/webhooks/shopify', async (req, reply) => {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    if (!verifyWebhookHmac(req.rawBody, hmac)) { reply.code(401); return { error: 'HMAC verification failed' }; }
    const topic = String(req.headers['x-shopify-topic'] || '');
    const shopDomain = String(req.headers['x-shopify-shop-domain'] || '').toLowerCase();
    const payload = req.body || {};

    // Compliance webhooks are MANDATORY for public apps — Shopify rejects the app if the
    // endpoint doesn't 200 to a signed request. We hold very little PII (buyer name +
    // shipping address on synced orders), and honour redaction by scrubbing it.
    if (topic === 'customers/data_request') {
      // A merchant asked what customer data we hold. Nothing to return synchronously;
      // acknowledged. (If we ever store more, respond out-of-band per Shopify's SLA.)
      return { ok: true };
    }
    if (topic === 'customers/redact') {
      // Erase a specific customer's PII from that shop's orders.
      const ids = (payload.orders_to_redact || []).map((n) => 'shopify-' + n);
      if (ids.length) {
        await q(`update orders set customer='{}'::jsonb, address='{}'::jsonb, updated_at=now()
                 where id = any($1)`, [ids]).catch(() => {});
      }
      return { ok: true };
    }
    if (topic === 'shop/redact') {
      // 48h after uninstall: erase the shop's data. Drop the connection and scrub PII
      // from its orders (the order shells stay for the factory's own fulfilment record,
      // but nothing personally identifying remains).
      const dom = shopDomain || String(payload.shop_domain || '').toLowerCase();
      if (dom) {
        // Read the connection BEFORE deleting it — we need its owner + display name to
        // find the orders (orders store the shop's NAME, not its domain).
        const conn = (await q(`select connected_by, shop_name from platform_connections where platform='shopify' and shop_id=$1`, [dom])).rows[0];
        if (conn) {
          await q(`update orders set customer='{}'::jsonb, address='{}'::jsonb, updated_at=now()
                   where source='shopify' and seller_id=$1 and store=$2`, [conn.connected_by, conn.shop_name || dom]).catch(() => {});
        }
        await q(`delete from platform_connections where platform='shopify' and shop_id=$1`, [dom]).catch(() => {});
      }
      return { ok: true };
    }

    // Order events — find the connection this shop belongs to, then import.
    const conn = (await q(`select * from platform_connections where platform='shopify' and shop_id=$1`, [shopDomain])).rows[0];
    if (!conn) { reply.code(202); return { ok: false, reason: 'shop not connected' }; }   // 202: accepted, nothing to do
    try {
      if (topic === 'orders/create' || topic === 'orders/updated') {
        const isFactory = await connIsFactory(conn);
        await importShopifyOrder(conn, payload, isFactory);
      } else if (topic === 'orders/cancelled') {
        await q(`update orders set status='cancelled', factory_status='cancelled', updated_at=now() where id=$1`,
          ['shopify-' + payload.id]).catch(() => {});
      }
    } catch (e) {
      req.log.error({ err: e, topic }, 'shopify webhook import failed');
      // Still 200 — a 500 makes Shopify retry for hours over a bad single payload.
    }
    return { ok: true };
  });

  app.delete('/api/shopify/connections/:shop_id', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    if (staff) await q(`delete from platform_connections where platform='shopify' and shop_id=$1`, [req.params.shop_id]);
    else await q(`delete from platform_connections where platform='shopify' and shop_id=$1 and connected_by=$2`, [req.params.shop_id, req.user.sub]);
    return { ok: true };
  });

  // Diagnostic (staff): confirm the stored token still works against the Shop API.
  app.get('/api/shopify/debug', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const conn = (await q(`select * from platform_connections where platform='shopify' order by created_at limit 1`)).rows[0];
      if (!conn) { reply.code(400); return { error: 'No Shopify store connected' }; }
      const sr = await fetch(`https://${conn.shop_id}/admin/api/${API_VERSION}/shop.json`, { headers: { 'X-Shopify-Access-Token': conn.access_token } });
      const sd = await sr.json().catch(() => ({}));
      return { shop_id: conn.shop_id, shop_name: conn.shop_name, scopes: conn.scopes, api_ok: sr.ok, http: sr.status, store_name: sd && sd.shop && sd.shop.name };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
