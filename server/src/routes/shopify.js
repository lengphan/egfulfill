// Shopify integration — OAuth connect (mirrors the TikTok/Etsy flow).
// Shopify OAuth is PER-STORE: the seller enters their <shop>.myshopify.com, we redirect
// to that store's /admin/oauth/authorize, Shopify returns code+hmac+shop to our callback,
// and we exchange for an OFFLINE access token (no expiry). connected_by = the caller, so a
// seller connects their OWN store. Only *.myshopify.com is allowed (SSRF guard).
import crypto from 'node:crypto';
import { descriptionHtml } from '../listing-description.js';
import { q } from '../db.js';
import { recordUsage } from '../usage.js';
import { clampDays, windowStartSec } from '../backfill.js';
import { audit } from '../audit.js';
import { resolveDestination } from '../destinations.js';

const API_KEY     = process.env.SHOPIFY_API_KEY || '';
const API_SECRET  = process.env.SHOPIFY_API_SECRET || '';
// Keep in lockstep with the scopes configured on the Shopify app (the authorize
// request must be a subset of the app's allowed scopes). Fulfillment scopes get added
// when order-sync/tracking is built.
// Fulfillment-order scopes are needed to push tracking (create a fulfillment). A store
// connected before these were added must RECONNECT to grant them, or the fulfillment 403s.
// write_products is what lets /api/shopify/publish create anything. It was absent, so a
// token from an existing connection CANNOT create a product however correct the payload is
// — Shopify refuses on scope, not on content. Adding it here only affects connections made
// from now on: OAuth scopes are fixed at grant time, so every already-connected shop must
// RECONNECT before publishing works for it. That is unavoidable rather than a design
// choice, and the publish route says so by name when Shopify rejects it.
const SCOPES      = process.env.SHOPIFY_SCOPES || 'read_orders,write_orders,read_products,write_products,write_merchant_managed_fulfillment_orders,read_merchant_managed_fulfillment_orders';
// Force canonical (non-www) so the authorize redirect_uri matches the popup origin.
const REDIRECT_URI = (process.env.SHOPIFY_REDIRECT_URI || 'https://egful.store/oauth-callback.html').replace('://www.', '://');
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
function validShop(s) { return typeof s === 'string' && SHOP_RE.test(s); }

/**
 * EXPIRING OFFLINE TOKENS — not optional any more.
 *
 * Shopify stopped accepting non-expiring offline tokens for apps created from 2026-04-01,
 * and every public app follows on 2027-01-01. This integration stored `refresh_token: null,
 * token_expires_at: null` and every Admin API call began failing with "Non-expiring access
 * tokens are no longer accepted" — a whole-integration outage that looks, from the UI, like
 * a store that connects fine and imports nothing.
 *
 * The opt-in is `expiring: true` on the code exchange. What comes back is a PAIR: an access
 * token good for ~60 minutes and a refresh token good for 90 days. Both rotate — a refresh
 * returns a NEW refresh token and immediately invalidates the one used, and Shopify keeps
 * only one live refreshable token per app per store. So the new pair must be persisted
 * before it's used; dropping it strands the store until the seller reconnects by hand.
 */
const TOKEN_SKEW_MS = 5 * 60 * 1000;   // refresh this far before expiry, not at it

/** Persist a token response against a connection. Returns the access token. */
async function storeTokens(shopId, t) {
  // expires_in is seconds and only present on expiring tokens. Absent → legacy non-expiring
  // token; store null so freshToken() can tell "no expiry known" from "expires at T".
  const expiresAt = Number.isFinite(Number(t.expires_in))
    ? new Date(Date.now() + Number(t.expires_in) * 1000)
    : null;
  await q(
    `update platform_connections
        set access_token=$2, refresh_token=coalesce($3, refresh_token),
            token_expires_at=$4, updated_at=now()
      where platform='shopify' and shop_id=$1`,
    [shopId, t.access_token, t.refresh_token || null, expiresAt]
  ).catch(() => {});
  return t.access_token;
}

/**
 * The access token to use RIGHT NOW, refreshing first if it's about to lapse.
 *
 * Every Admin API call goes through this. A connection with no refresh token is a legacy
 * one: nothing can be done for it here, so its existing token is returned and Shopify's own
 * error is allowed to surface — which is the honest outcome, because the fix is a reconnect
 * and no amount of retrying here produces one.
 */
async function freshToken(conn) {
  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  const stale = exp > 0 && exp - Date.now() < TOKEN_SKEW_MS;
  if (!stale || !conn.refresh_token) return conn.access_token;

  const r = await fetch(`https://${conn.shop_id}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: API_KEY, client_secret: API_SECRET,
      grant_type: 'refresh_token', refresh_token: conn.refresh_token,
    }).toString(),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    // Say which failure this is. A lapsed 90-day refresh token needs the seller to
    // reconnect; anything else is worth reading literally.
    throw new Error(
      `Shopify token refresh failed (${r.status}). ${t.error_description || t.error || ''} `
      + `Reconnect ${conn.shop_id} from Stores to re-authorise.`
    );
  }
  const token = await storeTokens(conn.shop_id, t);
  conn.access_token = token;                       // callers reuse the row in-process
  if (t.refresh_token) conn.refresh_token = t.refresh_token;
  return token;
}

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

/**
 * The product photo for a line item — the thing that makes an order row readable at a glance.
 *
 * Shopify's orders payload does NOT carry an image anywhere: a line item has product_id and
 * variant_id and nothing else, so a Shopify order imported without this step shows a
 * placeholder box where Etsy orders show the item. One extra call per DISTINCT product per
 * sync, cached, which is the same shape as etsy.js listingImage().
 *
 * Prefers the VARIANT's own image when it has one — a buyer who ordered the black shirt
 * should not be looking at the white one on the production floor — and falls back to the
 * product's primary image.
 */
async function shopifyProductImage(conn, productId, variantId, cache) {
  if (!productId) return null;
  const key = String(productId);
  if (cache.has(key)) {
    const p = cache.get(key);
    return p ? pickVariantImage(p, variantId) : null;
  }
  try {
    const r = await fetch(
      `https://${conn.shop_id}/admin/api/${API_VERSION}/products/${encodeURIComponent(productId)}.json?fields=id,image,images,variants`,
      { headers: { 'X-Shopify-Access-Token': await freshToken(conn) } }
    );
    recordUsage('shopify', { endpoint: 'GET /products/:id', ok: r.ok });
    const d = r.ok ? await r.json().catch(() => ({})) : {};
    const prod = (d && d.product) || null;
    cache.set(key, prod);
    return prod ? pickVariantImage(prod, variantId) : null;
  } catch (e) {
    // A missing photo must never fail an import — the order still has to reach the floor.
    cache.set(key, null);
    return null;
  }
}

function pickVariantImage(prod, variantId) {
  const variants = Array.isArray(prod.variants) ? prod.variants : [];
  const images = Array.isArray(prod.images) ? prod.images : [];
  const v = variantId ? variants.find((x) => String(x.id) === String(variantId)) : null;
  if (v && v.image_id) {
    const hit = images.find((im) => String(im.id) === String(v.image_id));
    if (hit && hit.src) return hit.src;
  }
  return (prod.image && prod.image.src) || (images[0] && images[0].src) || null;
}

// Upsert one Shopify order into `orders`. Mirrors etsy.js importReceipt: re-syncs and
// orders/updated webhooks only refresh money + address, NEVER the internal pipeline
// (status/factory_status) or items — otherwise a seller's in-progress order would reset
// every time the buyer's shop pinged an update.
async function importShopifyOrder(conn, order, isFactory, imgCache = new Map()) {
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
      const img = await shopifyProductImage(conn, line.product_id, line.variant_id, imgCache);
      await q(
        `insert into order_items (order_id, sku, name, qty, variant, unit_price, design_src, personalization, print_type, line_id, img)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, line.sku || null, line.title || null, line.quantity || 1, variant, num(line.price), uploadUrl, personalization, method, genLineId(), img]
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
  // 0 → today (since midnight UTC); null (older connection) → unchanged (up to Shopify's 250
  // most recent, as before). Webhooks keep things current after connect. The cutoff comes
  // from the shared helper so "0 means today" is the same statement on all three channels.
  let url = `https://${conn.shop_id}/admin/api/${API_VERSION}/orders.json?status=any&limit=250`;
  if (conn.backfill_days != null) {
    const connectedSec = conn.created_at ? Math.floor(new Date(conn.created_at).getTime() / 1000) : 0;
    const sinceSec = windowStartSec(conn.backfill_days, connectedSec);
    if (sinceSec) url += `&created_at_min=${encodeURIComponent(new Date(sinceSec * 1000).toISOString())}`;
  }
  const imgCache = new Map();   // one product lookup per distinct product per sync
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': await freshToken(conn) } });
  recordUsage('shopify', { endpoint: 'GET /orders', ok: r.ok });
  if (!r.ok) throw new Error(`Shopify orders fetch failed (${r.status})`);
  const data = await r.json().catch(() => ({}));
  for (const order of (data.orders || [])) {
    const res = await importShopifyOrder(conn, order, isFactory, imgCache);
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
  const headers = { 'X-Shopify-Access-Token': await freshToken(conn), 'Content-Type': 'application/json' };
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
      // oldest_order_at: the earliest order we actually hold for this shop's owner on this
      // channel. It's the ONLY evidence of how far back a shop has already imported when
      // backfill_days is null — which is every connection made before the chooser existed.
      // The chooser ratchets against whichever is wider, so a shop with 60 days of orders
      // can't be re-connected at "Today" just because nobody recorded a window for it.
    const r = await q(
      staff ? `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at, backfill_days,
                        (select min(o.created_at) from orders o where o.source='shopify' and o.seller_id = pc.connected_by) as oldest_order_at
                 from platform_connections pc where platform='shopify' order by created_at`
            : `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at, backfill_days,
                        (select min(o.created_at) from orders o where o.source='shopify' and o.seller_id = pc.connected_by) as oldest_order_at
                 from platform_connections pc where platform='shopify' and connected_by=$1 order by created_at`,
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
      // FORM-ENCODED, and `expiring=1` as a STRING. Both matter: the token endpoint accepts
      // a JSON body for the plain exchange, so posting JSON appears to work — it returns a
      // perfectly good token — while silently ignoring the opt-in and handing back the
      // non-expiring kind that every Admin API call then rejects. The failure is invisible
      // at the exchange and only shows up as a 403 on the first real request.
      const tr = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: API_KEY, client_secret: API_SECRET, code, expiring: '1',
        }).toString(),
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
         values ('shopify',$1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (platform, shop_id) do update set
           shop_name=excluded.shop_name, access_token=excluded.access_token,
           -- The PAIR rotates together. Keeping a stale refresh token beside a new access
           -- token is how a reconnect appears to work and then dies an hour later.
           refresh_token=excluded.refresh_token, token_expires_at=excluded.token_expires_at,
           scopes=excluded.scopes, connected_by=excluded.connected_by,
           -- Ratchets: widen only, never narrow (see backfill.js). GREATEST ignores nulls,
           -- so a reconnect with no choice keeps whatever the seller originally picked.
           backfill_days=greatest(platform_connections.backfill_days, excluded.backfill_days),
           updated_at=now()`,
        [shop, shopName, t.access_token, t.refresh_token || null,
         Number.isFinite(Number(t.expires_in)) ? new Date(Date.now() + Number(t.expires_in) * 1000) : null,
         t.scope || SCOPES, req.user.sub, bd]
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
    // `ok` used to be the literal true regardless of what happened, so a sync where EVERY
    // shop failed returned 200 {ok:true} and the button reported success over an error it
    // was already holding. It now means what it says.
    const failed = synced.filter((s) => s.error);
    return {
      ok: failed.length < synced.length,
      synced,
      error: failed.length === synced.length && failed.length ? failed[0].error : undefined,
    };
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
  /**
   * Publish a product to Shopify.
   *
   * Mirrors /api/etsy/publish and /api/tiktok/publish: one product, its variants, its
   * images, and a row in published_listings so the Uploaded card can describe what we made
   * rather than what it was copied from.
   *
   * DRAFT OR ACTIVE is the seller's choice in the publish form, and Shopify takes it at
   * creation — unlike Etsy, which cannot activate a listing before its photos exist and so
   * needs a second call. The default is draft: an absent or unrecognised value must never
   * be the one that puts something in front of buyers.
   *
   * The connection is the CALLER's own shop, never "the first row in the table" — writing a
   * product into a shop you do not own is the same violation the Etsy route was fixed for.
   */
  app.post('/api/shopify/publish', { preHandler: requireAuth }, async (req, reply) => {
    if (!API_KEY || !API_SECRET) { reply.code(400); return { error: 'Server missing SHOPIFY_API_KEY / SHOPIFY_API_SECRET' }; }
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) { reply.code(400); return { error: 'A title is required.' }; }

    // The store named on the request, else the caller's own — see destinations.js. The
    // fallback keeps the previous behaviour exactly: the caller's first connected store.
    let conn;
    try {
      conn = await resolveDestination('shopify', b, req.user, async (user) => (await q(
        `select * from platform_connections where platform='shopify' and connected_by=$1 order by created_at limit 1`,
        [user.sub])).rows[0] || null);
    } catch (e) { reply.code(e.status || 400); return { error: e.message }; }
    if (!conn) { reply.code(400); return { error: 'No Shopify shop is connected to your account.' }; }

    const base = `https://${conn.shop_id}/admin/api/${API_VERSION}`;
    /**
     * REFRESH FIRST — this route used `conn.access_token` raw while every other Shopify
     * call in this file goes through freshToken(). Shopify's tokens now expire in ~60
     * minutes, so publishing worked only inside the hour after a connect and answered
     * every later attempt with a 401 that reads "reconnect the shop" — advice that was
     * never the actual problem. Fetched ONCE here and reused for the product and each
     * image, rather than per call.
     */
    let token;
    try { token = await freshToken(conn); }
    catch (e) { reply.code(401); return { error: e.message }; }
    const call = async (path, init = {}) => {
      const r = await fetch(base + path, {
        ...init,
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* keep the raw text below */ }
      if (!r.ok) {
        // Their words. A 403 here is almost always the missing write_products scope, and
        // that has a specific fix (reconnect the shop) that a generic failure would hide.
        const why = (data && (data.errors || data.error)) || text || `HTTP ${r.status}`;
        const err = new Error(typeof why === 'string' ? why : JSON.stringify(why));
        err.status = r.status;
        throw err;
      }
      return data;
    };

    // VARIANTS. Shopify takes options as up to three named axes; we ship colour and size,
    // which is what the catalogue actually varies. An empty axis is omitted rather than
    // sent empty — Shopify creates a "Title / Default" variant in that case, which is the
    // correct shape for a one-variant product.
    const colors = (Array.isArray(b.colors) ? b.colors : []).map(String).filter(Boolean);
    const sizes  = (Array.isArray(b.sizes)  ? b.sizes  : []).map(String).filter(Boolean);
    const options = [];
    if (colors.length) options.push({ name: 'Color', values: colors });
    if (sizes.length)  options.push({ name: 'Size',  values: sizes });
    const price = Number(b.price) > 0 ? Number(b.price).toFixed(2) : '0.00';
    const variants = [];
    const pairs = colors.length && sizes.length
      ? colors.flatMap((c) => sizes.map((z) => [c, z]))
      : colors.length ? colors.map((c) => [c, null])
      : sizes.length ? sizes.map((z) => [null, z])
      : [[null, null]];
    for (const [c, z] of pairs) {
      const v = { price, inventory_management: null };
      if (c) v.option1 = c;
      if (z) v[c ? 'option2' : 'option1'] = z;
      // The BLANK sku, suffixed per variant, so an order coming back is resolvable to a
      // product the floor can actually make. Matches the Etsy route's variant_skus.
      if (b.blank_sku) v.sku = [b.blank_sku, c, z].filter(Boolean).join('-');
      variants.push(v);
    }

    const product = {
      title,
      // body_html is HTML. Handing it the raw string published a plain-text blob into an
      // HTML field, which renders as one unbroken paragraph — the wall a seller sees in
      // the Shopify editor. Same parser as the other channels.
      body_html: descriptionHtml(b.description, b.title),
      status: String(b.state || '').toLowerCase() === 'active' ? 'active' : 'draft',
      tags: (Array.isArray(b.tags) ? b.tags : []).map(String).filter(Boolean).join(', '),
      product_type: String(b.print_type || ''),
      ...(options.length ? { options } : {}),
      variants,
    };

    let created;
    try {
      created = await call('/products.json', { method: 'POST', body: JSON.stringify({ product }) });
    } catch (e) {
      reply.code(e.status === 403 || e.status === 401 ? 403 : 502);
      return {
        // TWO causes wear the same 401/403, and Shopify's own text ("Invalid API key or
        // access token") doesn't separate them: the stored token has EXPIRED, or it never
        // carried write_products because the shop connected before publishing existed.
        // Naming only the second would be a guess stated as a fact. Reconnecting fixes
        // either, so the instruction is the same — the diagnosis is what stays honest.
        error: (e.status === 403 || e.status === 401)
          ? `Shopify refused: ${e.message}. Either the stored token has expired, or this shop connected before publishing was supported and its token has no write_products scope. Reconnecting the shop under Stores fixes both.`
          : `Shopify refused: ${e.message}`,
      };
    }
    const p = created && created.product;
    if (!p || !p.id) { reply.code(502); return { error: 'Shopify accepted the request but returned no product.' }; }

    /**
     * IMAGES, one call each, and a failure here does NOT fail the publish.
     *
     * The product exists by this point. Reporting the whole thing as failed would leave a
     * real draft in the shop that our record denies — the same "board says done, order says
     * nothing" split the design routes were fixed for. So images are counted and the count
     * is returned, exactly as the Etsy route does.
     */
    const imgs = (Array.isArray(b.images) ? b.images : []).map(String).filter(Boolean).slice(0, 10);
    let uploaded = 0, primaryImage = null;
    for (const src of imgs) {
      try {
        const body = /^data:/i.test(src)
          ? { image: { attachment: src.replace(/^data:[^,]*,/, '') } }
          : { image: { src } };
        const r = await call(`/products/${p.id}/images.json`, { method: 'POST', body: JSON.stringify(body) });
        if (r && r.image) { uploaded++; if (!primaryImage) primaryImage = r.image.src || null; }
      } catch (e) {
        req.log?.warn?.({ err: e, product: p.id }, 'shopify image upload failed');
      }
    }

    await q(
      `insert into published_listings (listing_id, platform, seller_id, blank_sku, design_id, design_data, design_pos, print_type, color, size,
                                       title, description, tags, connection_id, shop_id)
       values ($1,'shopify',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (listing_id) do update set blank_sku=excluded.blank_sku, print_type=excluded.print_type,
         title=excluded.title, description=excluded.description, tags=excluded.tags,
         connection_id=excluded.connection_id, shop_id=excluded.shop_id`,
      [String(p.id), req.user.sub, b.blank_sku || null, b.design_id || null, b.design_data || null,
       b.design_pos ? JSON.stringify(b.design_pos) : null, b.print_type || null,
       colors[0] || null, sizes[0] || null,
       // Same as Etsy: kept so an edit-and-send-again doesn't ask for the words twice.
       title || null, b.description ? String(b.description) : null,
       (Array.isArray(b.tags) && b.tags.length) ? b.tags.map(String) : null,
       // Which store it went to — the record has to survive a second connected store.
       conn.id, conn.shop_id || null]
    ).catch(() => {});

    audit(req, 'shopify.publish', {
      entityType: 'listing', entityId: String(p.id),
      after: { title, variants: variants.length, images: uploaded, blank: b.blank_sku || null },
      note: `Published "${title}" to ${conn.shop_id} as ${product.status === 'active' ? 'live' : 'a draft'}`,
    });

    return {
      ok: true, listing_id: String(p.id), state: p.status || 'draft',
      images_uploaded: uploaded, primary_image: primaryImage,
      variants_applied: variants.length,
      variant_skus: variants.map((v) => v.sku).filter(Boolean),
      url: `https://${conn.shop_id}/admin/products/${p.id}`,
    };
  });

  app.get('/api/shopify/debug', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const conn = (await q(`select * from platform_connections where platform='shopify' order by created_at limit 1`)).rows[0];
      if (!conn) { reply.code(400); return { error: 'No Shopify store connected' }; }
      const sr = await fetch(`https://${conn.shop_id}/admin/api/${API_VERSION}/shop.json`, { headers: { 'X-Shopify-Access-Token': await freshToken(conn) } });
      const sd = await sr.json().catch(() => ({}));
      return { shop_id: conn.shop_id, shop_name: conn.shop_name, scopes: conn.scopes, api_ok: sr.ok, http: sr.status, store_name: sd && sd.shop && sd.shop.name };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
