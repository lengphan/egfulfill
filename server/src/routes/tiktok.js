// TikTok Shop integration — OAuth connect (mirrors the Etsy flow).
// A SELLER connects their OWN TikTok shop; an ADMIN/staff connects the factory shop.
// Auth model differs from Etsy: no PKCE. The app has a service_id; the seller
// authorizes at services.tiktokshop.com (US: services.us.tiktokshop.com), TikTok redirects
// back to the callback registered in Partner Center as ?auth_code=<code>&state=… (NO app_key),
// and we exchange the code at auth.tiktok-shops.com (app_key + app_secret required, NO signature).
import crypto from 'node:crypto';
import { descriptionHtml } from '../listing-description.js';
import { q } from '../db.js';
import { recordUsage } from '../usage.js';
import { clampDays, windowStartSec } from '../backfill.js';
import { imageBytesFrom } from '../images.js';
import { moveFunds, balanceOf } from './wallet.js';
import { readAll as readSettings } from './factory_settings.js';
import { resolveDestination } from '../destinations.js';

const APP_KEY    = process.env.TIKTOK_APP_KEY || '';
const APP_SECRET = process.env.TIKTOK_APP_SECRET || '';
const SERVICE_ID = process.env.TIKTOK_SERVICE_ID || '';
// Auth host is stable across regions; the token exchange is always auth.tiktok-shops.com.
// The Open API host does NOT serve /api/v2/token/* — it answers those with a gateway error
// ("no schema found", now worded "Invalid path…"), which reads like a broken app rather than a
// misconfigured host. So an override pointing there is refused rather than obeyed.
const AUTH_HOST_DEFAULT = 'https://auth.tiktok-shops.com';
const AUTH_HOST = (() => {
  const raw = (process.env.TIKTOK_AUTH_HOST || '').replace(/\/+$/, '');
  if (!raw) return AUTH_HOST_DEFAULT;
  if (/open-api\.tiktokglobalshop\.com/i.test(raw)) {
    console.warn(`[tiktok] ignoring TIKTOK_AUTH_HOST=${raw} — the Open API host does not serve the token endpoints; using ${AUTH_HOST_DEFAULT}`);
    return AUTH_HOST_DEFAULT;
  }
  return raw;
})();
// The AUTHORIZE page is the ONE region-split URL. TikTok Shop US runs a SEPARATE account
// system (services.us.tiktokshop.com); everywhere else uses the global Partner Center page
// (services.tiktokshop.com). A US seller sent to the global page gets "we couldn't find an
// account with that email" for a perfectly valid account. TIKTOK_REGION=us is the friendly
// switch; an explicit TIKTOK_AUTHORIZE_URL still wins for anything unusual.
const REGION = (process.env.TIKTOK_REGION || 'global').trim().toLowerCase();
const AUTHORIZE_BY_REGION = {
  us:     'https://services.us.tiktokshop.com/open/authorize',
  global: 'https://services.tiktokshop.com/open/authorize',
};
const AUTHORIZE_URL = process.env.TIKTOK_AUTHORIZE_URL
  || AUTHORIZE_BY_REGION[REGION]
  || AUTHORIZE_BY_REGION.global;
// Which region the resolved authorize URL actually targets (derived, so it's right even when
// TIKTOK_AUTHORIZE_URL was set by hand). Surfaced in /config so the UI can show it.
const RESOLVED_REGION = /services\.us\.tiktokshop\.com/i.test(AUTHORIZE_URL) ? 'us' : 'global';
// Open API host for signed data calls (orders, shops). Global host serves every region;
// only the AUTHORIZE page is region-split.
const API_HOST      = (process.env.TIKTOK_API_HOST || 'https://open-api.tiktokglobalshop.com').replace(/\/+$/, '');

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

// ── token helpers ────────────────────────────────────────────────────────────
// TikTok wraps every response as { code, message, data, request_id }; code===0 = ok.
async function ttTokenRequest(path, extraParams) {
  const params = new URLSearchParams({ app_key: APP_KEY, app_secret: APP_SECRET, ...extraParams });
  // GET, NOT POST. auth.tiktok-shops.com registers these two routes on GET only; a POST to the
  // exact same URL falls through to a plain-text `404 page not found` (verified live), which
  // isn't JSON — so the parse failed, the message came out empty, and every connect died on a
  // bare status code. This was switched to POST on the theory that TikTok "documents" it that
  // way; it does not, and it took the token REFRESH down with it, so live shops stopped syncing
  // once their access token aged out. Don't change the method without re-probing both routes.
  const res = await fetch(`${AUTH_HOST}${path}?${params.toString()}`, { method: 'GET' });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON — see below */ }
  // A non-JSON body means we never reached the API at all (wrong host, wrong method, a proxy
  // in the way). Say that, with a snippet, instead of throwing away the only evidence.
  if (!body) {
    throw new Error(`TikTok token endpoint returned non-JSON (HTTP ${res.status}) from ${AUTH_HOST}${path}: ${text.slice(0, 120)}`);
  }
  if (!res.ok || body.code !== 0) {
    throw new Error(body.message || ('TikTok token error ' + res.status));
  }
  return body.data || {};
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
  recordUsage('tiktok', { endpoint: path, ok: res.ok && data && data.code === 0 });
  // TikTok wraps everything as { code, message, data, request_id }; code===0 = ok.
  if (!res.ok || (data && data.code !== 0)) {
    throw new Error(((data && data.message) || ('TikTok API ' + res.status)) + ' @ ' + path);
  }
  return (data && data.data) || {};
}

// Upload one product image to TikTok and return its URI (the token main_images/sku_img
// reference — you can't send a raw URL to Create Product, only a URI from here). This is a
// MULTIPART call, so unlike ttSignedRequest the body is NOT part of the signature — TikTok
// signs query params only for multipart/form-data — and we must NOT set content-type by
// hand (fetch adds the multipart boundary). use_case=MAIN_IMAGE unless a variant swatch.
async function ttUploadImage(conn, img, useCase = 'MAIN_IMAGE') {
  const token = await validToken(conn);
  const path = '/product/202309/images/upload';
  const query = { app_key: APP_KEY, timestamp: String(Math.floor(Date.now() / 1000)) };
  query.sign = signRequest(path, query, '');   // '' → body excluded from the signature
  const fd = new FormData();
  fd.append('data', new Blob([img.buf], { type: img.mime }), 'photo.' + img.ext);
  fd.append('use_case', useCase);
  await rateLimit();
  const res = await fetch(`${API_HOST}${path}?${new URLSearchParams(query).toString()}`, {
    method: 'POST', headers: { 'x-tts-access-token': token }, body: fd,
  });
  const data = await res.json().catch(() => ({}));
  recordUsage('tiktok', { endpoint: path, ok: res.ok && data && data.code === 0 });
  if (!res.ok || (data && data.code !== 0)) {
    throw new Error(((data && data.message) || ('TikTok API ' + res.status)) + ' @ ' + path);
  }
  return (data && data.data && data.data.uri) || null;
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

// Resolve WHICH TikTok shop a publish targets. A seller publishes to their OWN connected
// shop; staff (no shop of their own) fall back to the first factory-connected shop — the
// same rule etsy.js's connectionFor uses, kept identical so a seller can never publish
// into someone else's shop.
async function connectionForPublish(user) {
  const staff = !!(user && user.role && user.role !== 'seller');
  const r = await q(
    staff
      ? `select * from platform_connections pc where platform='tiktok'
           and not exists (select 1 from users u where u.id=pc.connected_by and u.role='seller')
         order by created_at limit 1`
      : `select * from platform_connections where platform='tiktok' and connected_by=$1 order by created_at limit 1`,
    staff ? [] : [user.sub]);
  return r.rows[0] || null;
}

// TikTok is strict about title/description text: no HTML entities (&nbsp; etc.), no
// control chars, not all-symbols, no run of >9 identical chars (errors 12052931/932).
// A competitor's Etsy title/description arrives as plain-ish text, so strip the risky bits
// rather than trust it — an over-clean title beats a rejected listing.
function ttCleanText(s, max) {
  return String(s || '')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')            // kill any HTML entities
    .replace(/[\x00-\x1f\x7f]/g, ' ')       // control chars
    .replace(/(.)\1{9,}/g, '$1$1$1')              // clamp >9 repeats
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
/**
 * TikTok's `description` — HTML, but with TikTok's own text rules applied first: no entities
 * and no bare angle brackets (errors 12052931/932), so the cleaning happens HERE and the
 * shared parser only ever sees safe text.
 *
 * The structure itself comes from listing-description.js, which every publish path now uses.
 * Three channels each had their own version of this and each was wrong differently — Shopify
 * put the raw string into body_html, this one split on blank lines a scraped description does
 * not contain, and Etsy passed it straight through.
 */
function ttDescriptionHtml(text, fallback) {
  const clean = String(text || '')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/<[^>]*>/g, ' ')                     // drop whole source HTML tags, not just <>
    .replace(/[<>]/g, ' ')                        // and any stray angle brackets
    .replace(/&/g, ' and ');                      // no bare ampersands -> no entities
  return descriptionHtml(clean, ttCleanText(fallback, 2000)).slice(0, 10000);
}

// Normalise the dialog's product into a TikTok Create Product body (v202309). `imageUris`
// are the URIs returned by the image-upload API — main_images/sku_img reference those, NOT
// raw URLs. The COMMON fields (title/description/price/tags/variants) mirror the Etsy path;
// the REQUIRED TikTok-only fields (leaf category_id, per-SKU warehouse inventory, package
// weight, category_version) come from the dialog's extra fields. Because publishing is
// gated (TIKTOK_PUBLISH_LIVE), the dry run returns this object for review — the same way the
// S&S/Otto order payloads were validated before ever going live.
function buildTiktokProductPayload(b, imageUris) {
  const title = ttCleanText(b.title, 255);
  const price = Number(b.price) || 0;
  const currency = b.currency || 'USD';
  // Etsy tags → TikTok search terms (ST words): max 15, ≤250 chars total, not buyer-facing.
  const searchTerms = [];
  let stLen = 0;
  for (const t of (Array.isArray(b.tags) ? b.tags : [])) {
    const term = ttCleanText(t, 40);
    if (!term || searchTerms.length >= 15 || stLen + term.length > 250) continue;
    searchTerms.push(term); stLen += term.length;
  }
  const colors = (Array.isArray(b.colors) ? b.colors : []).map(String).filter(Boolean);
  const sizes = (Array.isArray(b.sizes) ? b.sizes : []).map(String).filter(Boolean);
  const skuBase = String(b.sku_base || b.sku || 'EG').toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'EG';
  const perSize = (b.size_prices && typeof b.size_prices === 'object') ? b.size_prices : {};
  const warehouseId = b.warehouse_id != null ? String(b.warehouse_id) : null;
  const qty = Math.min(99999, Math.max(1, Number(b.quantity) || 999));
  const slug = (v) => String(v).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6);
  const multiVariant = (colors.length ? colors.length : 1) * (sizes.length ? sizes.length : 1) > 1;
  // One SKU per colour×size, each stamped with OUR seller_sku so a buyer's order line
  // round-trips back to this exact blank+variant — the same guarantee the Etsy path gives.
  // sales_attributes is omitted for a single-SKU product (TikTok requires it only when >1).
  const skus = [];
  for (const c of (colors.length ? colors : [null])) {
    for (const z of (sizes.length ? sizes : [null])) {
      const sku = [skuBase, c && slug(c), z && slug(z)].filter(Boolean).join('-');
      const amount = (z && perSize[z] != null ? Number(perSize[z]) : price) || price;
      const sku_obj = {
        seller_sku: sku.slice(0, 50),
        inventory: warehouseId ? [{ warehouse_id: warehouseId, quantity: qty }] : [],
        price: { amount: String(amount), currency },
      };
      if (multiVariant) {
        sku_obj.sales_attributes = [];
        if (c) sku_obj.sales_attributes.push({ name: 'Color', value_name: String(c).slice(0, 50) });
        if (z) sku_obj.sales_attributes.push({ name: 'Size', value_name: String(z).slice(0, 50) });
      }
      skus.push(sku_obj);
    }
  }
  // US + SEA shops MUST use the v2 (7-level) category tree; everywhere else v1.
  const categoryVersion = (RESOLVED_REGION === 'us') ? 'v2' : (b.category_version || 'v1');
  const payload = {
    // AS_DRAFT, not LISTING — mirror the Etsy "make a draft you review before it goes live"
    // flow; the seller lists it from Seller Center once the artwork is their own.
    save_mode: b.save_mode === 'LISTING' ? 'LISTING' : 'AS_DRAFT',
    title,
    description: ttDescriptionHtml(b.description, b.title),
    category_id: b.category_id != null ? String(b.category_id) : null,   // REQUIRED — leaf
    category_version: categoryVersion,
    main_images: (Array.isArray(imageUris) ? imageUris : []).filter(Boolean).slice(0, 9).map((uri) => ({ uri })),
    skus,
    package_weight: (b.package_weight != null && String(b.package_weight) !== '')
      ? { value: String(b.package_weight), unit: b.weight_unit || (RESOLVED_REGION === 'us' ? 'POUND' : 'KILOGRAM') }
      : null,   // REQUIRED for physical products
    /*
     * PACKAGE DIMENSIONS — also required, and previously not sent AT ALL.
     *
     * Omitting the key does not make it optional: TikTok reads the absent field as zeroes and
     * refuses the whole create with "`package_dimensions` is invalid because all package
     * dimensions must be positive numeric values". So a listing with a category, a warehouse
     * and a weight — every field the screen asked for — still failed, and the message named a
     * field nobody had been shown.
     *
     * Sent only when all three are positive. A partial object is the same refusal with an
     * extra step, and null is what the payload carried before, so the failure mode does not
     * get worse when a caller omits them.
     */
    package_dimensions: (Number(b.package_length) > 0 && Number(b.package_width) > 0 && Number(b.package_height) > 0)
      ? {
        length: String(b.package_length), width: String(b.package_width), height: String(b.package_height),
        unit: b.dimension_unit || (RESOLVED_REGION === 'us' ? 'INCH' : 'CENTIMETER'),
      }
      : null,
    // A new key per request so a retry can't create a duplicate product.
    idempotency_key: crypto.randomUUID(),
  };
  if (b.brand_id) payload.brand_id = String(b.brand_id);
  if (searchTerms.length) payload.search_terms = searchTerms;
  return payload;
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

/**
 * Bill the TikTok label fee — charged on IMPORT, for TIKTOK-shipped orders only.
 *
 * The split matters and is the whole point of recording shipping_type:
 *   TIKTOK shipping → TikTok already made the label. We fetch and print it, so there is no
 *                     carrier purchase; this flat fee is that handling, charged here.
 *   SELLER shipping → no label exists anywhere. We buy a real one through the normal
 *                     shipping path, which charges for itself. Billing this fee too would
 *                     charge a seller twice for one parcel.
 *
 * Mirrors billExpedite in dispatch.js, deliberately, down to the guarantees:
 *   · Idempotent on the order id, so the 5-minute sync re-importing the same order bills
 *     ONCE. moveFunds de-dupes on (account, type, ref) — this is the property that makes
 *     charging from a polling importer safe at all.
 *   · Money never blocks an order. A short wallet, a settings read failure, anything —
 *     the order still imports. An unbilled order is a number to chase; a lost order is a
 *     parcel that never ships.
 *   · A short wallet is retried, not forgotten: the next sync that touches this order tries
 *     again, and the ref stops it double-charging once it succeeds.
 *   · Factory-owned orders are never billed — there's no seller on the other side, so it
 *     would be the house charging itself.
 *
 * Cancellation refunds, matching the rest of the money model (charge on submit, refund on
 * cancel): if TikTok later reports the order cancelled and we did charge, it's given back.
 */
async function billTiktokLabel({ orderId, sellerId, shipType, cancelled, isFactory }) {
  if (isFactory || !sellerId) return;
  if (String(shipType || '').toUpperCase() !== 'TIKTOK') return;
  const cfg = await readSettings().catch(() => ({}));
  const fee = Number(cfg.tiktok_label_fee ?? 0) || 0;
  if (fee <= 0) return;                        // unset/zero = the feature is off
  const ref = `tiktok-label-${orderId}`;
  const refundRef = `tiktok-label-refund-${orderId}`;

  const charged = await q('select 1 from wallet_ledger where ref=$1 limit 1', [ref])
    .then((r) => r.rowCount > 0).catch(() => false);

  if (cancelled) {
    if (!charged) return;
    const refunded = await q('select 1 from wallet_ledger where ref=$1 limit 1', [refundRef])
      .then((r) => r.rowCount > 0).catch(() => false);
    if (refunded) return;
    // factory is a house account, so this is never refused for balance.
    await moveFunds({ from: 'factory', to: sellerId, amount: fee, type: 'tiktok-label-refund',
      ref: refundRef, note: `TikTok label fee refunded · cancelled order ${orderId}` }).catch(() => {});
    return;
  }

  if (charged) return;
  // Checked before moving so a short wallet is a no-op we retry, not a thrown error that
  // would abort the import mid-order.
  const bal = await balanceOf(sellerId).catch(() => 0);
  if (bal < fee) return;
  await moveFunds({ from: sellerId, to: 'factory', amount: fee, type: 'tiktok-label',
    ref, note: `TikTok label · order ${orderId}` }).catch(() => {});
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
  // WHO produces the label, and the packages to ask for it by.
  //
  // TikTok orders split two ways and the boards could not tell them apart: with TIKTOK
  // shipping the platform generates the label (it exists, but only inside Seller Center);
  // with SELLER shipping we buy our own and push the tracking back. Recording the type is
  // the prerequisite for showing a TikTok-made label at all — without it every order looks
  // like one we still owe a label for. Field name varies by response version, so read the
  // documented one and fall back rather than storing null on a shape we haven't seen.
  const shipType = String(order.shipping_type || order.delivery_type || '').toUpperCase() || null;
  const packageIds = (order.packages || []).map((p) => p && p.id).filter(Boolean).map(String);
  // buyer_message → order Notes; seller_note kept too. Set on INSERT only (out of the
  // conflict update) so a seller's later edits survive a re-sync, same as the other importers.
  const meta = {
    source: 'tiktok', tiktok_status: st, note: order.buyer_message || order.seller_note || '',
    tiktok_shipping_type: shipType, tiktok_package_ids: packageIds,
  };
  // The sync-OWNED half of meta is merged on re-sync; the rest (a seller's note) is not
  // touched. Packages appear AFTER the order does, so insert-only would mean an order that
  // gained a label never learned its package id — but a blanket meta=excluded.meta would
  // wipe whatever a human wrote, which is the one thing sync must never do (CLAUDE.md §2.6).
  const syncMeta = { tiktok_status: st, tiktok_shipping_type: shipType, tiktok_package_ids: packageIds };
  await q(
    `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, tracking, created_at, factory_order, meta)
     values ($1,$2,$3,'tiktok',$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now()), $11, $12)
     on conflict (id) do update set total=excluded.total,
       customer=excluded.customer, address=excluded.address,
       tracking=coalesce(excluded.tracking, orders.tracking),
       meta = coalesce(orders.meta, '{}'::jsonb) || $13::jsonb,
       created_at=coalesce($10::timestamptz, orders.created_at), updated_at=now()`,
    [id, conn.connected_by, conn.shop_name || conn.shop_id,
     { name: custName, email: order.buyer_email || null }, address,
     status, status, total, track, createdIso, !!isFactory, meta, JSON.stringify(syncMeta)]
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
        // 'tt-' + li.id was already derived from TikTok's own id, which is why TikTok is the
        // one importer that never duplicated. on conflict makes that guarantee enforced
        // rather than incidental.
        `insert into order_items (order_id, sku, name, qty, variant, unit_price, img, print_type, line_id)
         values ($1,$2,$3,1,$4,$5,$6,$7,$8)
         on conflict do nothing`,
        [id, li.seller_sku || li.sku_id || null, name, variant, num(li.sale_price), li.sku_image || null, method, 'tt-' + li.id]
      );
    }
  }
  // Billed AFTER the order row exists, and never allowed to throw — an import that fails
  // because of money would lose the order, which is the one outcome worse than not billing.
  await billTiktokLabel({
    orderId: id, sellerId: conn.connected_by, shipType, cancelled, isFactory,
  }).catch(() => {});
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
  const nowSec = Math.floor(Date.now() / 1000);
  const body = {};
  if (full) {
    // Bound the FIRST/full pull so connecting a busy shop never drags in its entire history.
    // The window is the scope the user chose at connect (conn.backfill_days): 0 = new orders
    // only (forward from connect); N = the last N days; null (older connection) = the env
    // default. After this, the 5-min incremental poll keeps the queue current on its own.
    const connectedSec = conn.created_at ? Math.floor(new Date(conn.created_at).getTime() / 1000) : 0;
    // A connection predating the chooser has no stored window; the env default stands in.
    const days = conn.backfill_days != null
      ? conn.backfill_days
      : Math.max(0, parseInt(process.env.TIKTOK_BACKFILL_DAYS, 10) || 30);
    body.create_time_ge = windowStartSec(days, connectedSec || nowSec);
  } else {
    body.update_time_ge = Math.max(0, Math.floor(new Date(conn.last_sync_at).getTime() / 1000) - 300);
  }
  let pageToken = '';
  // Backstop at 10 pages (500 orders) per run — a real monthly volume is a handful; this only
  // ever bites a shop with an unusually large recent window, and the incremental poll follows.
  for (let page = 0; page < 10; page++) {
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

/**
 * Push tracking to TikTok Shop — "Mark Package As Shipped", for a SELLER-fulfilled order we
 * shipped on our own label. Wired exactly to the v202309 spec:
 *   1. GET /order/202309/orders?ids=<id>            → delivery_option_id + line-item ids
 *   2. GET /logistics/202309/delivery_options/{id}/shipping_providers → match our carrier → id
 *   3. POST /fulfillment/202309/orders/{id}/packages { order_line_item_ids, tracking_number,
 *                                                      shipping_provider_id }
 * Marks the order shipped on TikTok (buyer sees tracking). Bound to the order's OWNER shop,
 * no fallback. Throws on any problem. Needs the app's `seller.fulfillment.basic` scope.
 */
/**
 * WHICH TikTok ORDER THIS FULFILS — its own id, or the one it is a copy of.
 *
 * Same rule as Etsy's receiptIdOf: a duplicate carries `FF-dup-…` because a copy of a
 * marketplace order is not that order, but it still fulfils the original's receipt. Only a
 * duplicated_from that is itself a TikTok id is accepted — a copy of a manual order fulfils
 * nothing on a marketplace, and guessing would push tracking at an unrelated order.
 */
function tiktokOrderIdOf(order) {
  const direct = String((order && order.id) || '').match(/^tiktok-(.+)$/i);
  if (direct) return direct[1];
  const meta = order && order.meta && typeof order.meta === 'object' ? order.meta : {};
  const copied = String(meta.duplicated_from || '').match(/^tiktok-(.+)$/i);
  return copied ? copied[1] : null;
}

export async function tiktokPushTracking(order, tracking, carrier) {
  const orderId = tiktokOrderIdOf(order);
  if (!orderId) throw new Error('Not a TikTok order');
  const conns = (await q(`select * from platform_connections where platform='tiktok'`)).rows;
  const conn = conns.find((c) => order && String(c.connected_by) === String(order.seller_id))
    || conns.find((c) => order && c.shop_name && c.shop_name === order.store)
    || null;
  if (!conn) throw new Error("Couldn't tell which connected TikTok shop this order belongs to");
  const cipher = await getShopCipher(conn);

  // 1) order detail → delivery_option_id + the line-item ids to mark shipped
  const od = await ttSignedRequest(conn, 'GET', '/order/202309/orders', { query: { shop_cipher: cipher, ids: orderId } });
  const to = (od.orders || [])[0];
  if (!to) throw new Error('TikTok order not found');
  const deliveryOptionId = to.delivery_option_id;
  const lineItemIds = (to.line_items || []).map((li) => li.id).filter(Boolean);

  // 2) shipping providers for that delivery option → the id matching our carrier (usually USPS)
  if (!deliveryOptionId) throw new Error('Order has no delivery_option_id — cannot resolve a shipping provider');
  const sp = await ttSignedRequest(conn, 'GET', `/logistics/202309/delivery_options/${encodeURIComponent(deliveryOptionId)}/shipping_providers`, { query: { shop_cipher: cipher } });
  const providers = sp.shipping_providers || [];
  const want = String(carrier || 'USPS').toUpperCase();
  const hit = providers.find((p) => String(p.name || '').toUpperCase() === want)
    || providers.find((p) => String(p.name || '').toUpperCase().includes(want))
    || (providers.length === 1 ? providers[0] : null);
  if (!hit || !hit.id) throw new Error(`No TikTok shipping provider matched "${carrier || 'USPS'}" for this order`);

  // 3) mark the package shipped with our tracking
  const body = { tracking_number: tracking, shipping_provider_id: hit.id };
  if (lineItemIds.length) body.order_line_item_ids = lineItemIds;
  const res = await ttSignedRequest(conn, 'POST', `/fulfillment/202309/orders/${encodeURIComponent(orderId)}/packages`, { query: { shop_cipher: cipher }, body });
  return { ok: true, channel: 'tiktok', packageId: (res && res.package_id) || null, warning: (res && res.warning && res.warning.message) || null };
}

export function tiktokRoutes(app, requireAuth, requireStaff) {
  // Reuse the platform_connections table (created by etsy.js). Create it here too so
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
    .then(() => q('alter table platform_connections add column if not exists shop_cipher text').catch(() => {}))
    // How far back the first import reaches, chosen at connect time (null = older connection).
    .then(() => q('alter table platform_connections add column if not exists backfill_days integer').catch(() => {}));

  // Auto-sync: poll TikTok incrementally so new orders land without anyone clicking "Sync
  // now" — mirrors the Etsy poll. Incremental (update_time_ge) → a couple of calls per run.
  if (APP_KEY && APP_SECRET && !globalThis.__egTiktokAutoSync) {
    globalThis.__egTiktokAutoSync = setInterval(() => { syncAllTiktok({ full: false }).catch(() => {}); }, 5 * 60 * 1000);
    if (globalThis.__egTiktokAutoSync.unref) globalThis.__egTiktokAutoSync.unref();
  }

  // Frontend reads this to build the authorize URL (service_id is not a secret).
  app.get('/api/tiktok/config', async () => ({
    service_id: SERVICE_ID, authorize_url: AUTHORIZE_URL, region: RESOLVED_REGION,
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
      // oldest_order_at: the earliest order we actually hold for this shop's owner on this
      // channel. It's the ONLY evidence of how far back a shop has already imported when
      // backfill_days is null — which is every connection made before the chooser existed.
      // The chooser ratchets against whichever is wider, so a shop with 60 days of orders
      // can't be re-connected at "Today" just because nobody recorded a window for it.
    const r = await q(
      staff ? `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at, backfill_days,
                        (select min(o.created_at) from orders o where o.source='tiktok' and o.seller_id = pc.connected_by) as oldest_order_at
                 from platform_connections pc where platform='tiktok' order by created_at`
            : `select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at, backfill_days,
                        (select min(o.created_at) from orders o where o.source='tiktok' and o.seller_id = pc.connected_by) as oldest_order_at
                 from platform_connections pc where platform='tiktok' and connected_by=$1 order by created_at`,
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
    const bd = clampDays((req.body || {}).backfill_days);   // how far back the first import reaches
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
        `insert into platform_connections (platform, shop_id, shop_name, access_token, refresh_token, token_expires_at, scopes, connected_by, backfill_days)
         values ('tiktok',$1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (platform, shop_id) do update set
           shop_name=excluded.shop_name, access_token=excluded.access_token,
           refresh_token=excluded.refresh_token, token_expires_at=excluded.token_expires_at,
           scopes=excluded.scopes, connected_by=excluded.connected_by,
           -- The import window RATCHETS: it may widen, never narrow (see backfill.js).
           -- GREATEST ignores nulls in Postgres, so a reconnect that sends no choice keeps
           -- the stored one, and a first choice on a connection that never had one is taken
           -- as-is. Enforced here rather than only in the UI, because the UI is a suggestion
           -- and the request body is whatever the client sends.
           backfill_days=greatest(platform_connections.backfill_days, excluded.backfill_days),
           -- WIDENING must actually pull. The window above only records the choice; the sync
           -- decides full-vs-incremental from last_sync_at, so without this a seller who moved
           -- 30 → 90 would get 90 stored and no backfill ever run — the chooser would be
           -- lying, which is the whole failure this feature exists to remove. Cleared ONLY on
           -- a genuine widening, so re-authorising an expired token stays a cheap incremental
           -- sync. Safe now that nothing in a sync path deletes: a full pull is an upsert.
           last_sync_at = case
             when excluded.backfill_days is not null
              and excluded.backfill_days > coalesce(platform_connections.backfill_days, -1)
             then null else platform_connections.last_sync_at end,
           updated_at=now()`,
        [shopId, shopName, d.access_token, d.refresh_token, expires, scopes, req.user.sub, bd]
      );
      return { ok: true, shop_id: shopId, shop_name: shopName, scopes };
    } catch (e) {
      // The client only sees e.message, which hides WHERE it came from (TikTok's token
      // endpoint vs the DB insert). Log the full error so a "no schema found"-type message
      // is traceable to its real source in `docker compose logs api`.
      app.log.error({ err: e, phase: 'tiktok/exchange', detail: e && e.message }, 'tiktok exchange failed');
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

  /**
   * The TikTok-GENERATED shipping label for a platform-shipped order.
   *
   * UNVERIFIED against a live order. The path is real — probed unauthenticated, it answers
   * 36009004 "invalid credentials" where an unregistered path answers 36009009 "Invalid
   * path" — and the shop holds seller.fulfillment.package.write. But no TikTok order has
   * ever synced here, so the RESPONSE SHAPE has never been seen. Everything below reads
   * defensively and the raw response is logged, so the first real order tells us what to
   * fix instead of failing blind. Do not describe this as working until that has happened.
   *
   *   order id → packages[].id (from meta, else re-read the order) → GET
   *   /fulfillment/202309/packages/{id}/shipping_documents → { doc_url }
   *
   * Returns the URL rather than proxying the bytes: it's a short-lived signed TikTok link,
   * and streaming a PDF through here would put a 60MB body limit in front of a document we
   * don't need to touch.
   */
  app.get('/api/tiktok/orders/:id/label', { preHandler: requireAuth }, async (req, reply) => {
    const raw = String(req.params.id || '');
    const orderId = raw.replace(/^tiktok-/i, '');
    if (!orderId) { reply.code(400); return { error: 'Not a TikTok order' }; }
    try {
      const row = (await q('select * from orders where id=$1', ['tiktok-' + orderId])).rows[0];
      if (!row) { reply.code(404); return { error: 'Order not found' }; }
      // A seller may only read their OWN order's label; staff read any. Same shape as the
      // rest of this file — the connection is resolved from the order's owner, never a
      // "first shop we find" fallback that could hand one seller another's document.
      const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
      if (!staff && String(row.seller_id) !== String(req.user.sub)) { reply.code(404); return { error: 'Order not found' }; }

      const conns = (await q(`select * from platform_connections where platform='tiktok'`)).rows;
      const conn = conns.find((c) => String(c.connected_by) === String(row.seller_id))
        || conns.find((c) => c.shop_name && c.shop_name === row.store)
        || null;
      if (!conn) { reply.code(400); return { error: "Couldn't tell which connected TikTok shop this order belongs to" }; }
      const cipher = await getShopCipher(conn);

      // Package ids: prefer what the sync recorded, but re-read the order when meta predates
      // this feature or the package was created after the last sync.
      const meta = row.meta || {};
      let packageIds = Array.isArray(meta.tiktok_package_ids) ? meta.tiktok_package_ids.filter(Boolean) : [];
      let shipType = meta.tiktok_shipping_type || null;
      if (!packageIds.length) {
        const od = await ttSignedRequest(conn, 'GET', '/order/202309/orders', { query: { shop_cipher: cipher, ids: orderId } });
        const to = (od.orders || [])[0];
        if (!to) { reply.code(404); return { error: 'TikTok no longer has this order' }; }
        packageIds = (to.packages || []).map((p) => p && p.id).filter(Boolean).map(String);
        shipType = String(to.shipping_type || to.delivery_type || '').toUpperCase() || shipType;
      }
      if (!packageIds.length) {
        reply.code(400);
        return { error: 'This order has no package on TikTok yet, so there is no label to fetch.', shipping_type: shipType };
      }

      const size = String(req.query?.size || process.env.TIKTOK_LABEL_SIZE || 'A6').toUpperCase();
      const docs = [];
      for (const pid of packageIds) {
        const d = await ttSignedRequest(conn, 'GET', `/fulfillment/202309/packages/${encodeURIComponent(pid)}/shipping_documents`, {
          query: { shop_cipher: cipher, document_type: 'SHIPPING_LABEL', document_size: size },
        });
        // Shape unconfirmed — take the documented key, then anything URL-shaped, rather than
        // returning null on a field name that turns out to differ by a word.
        const url = d.doc_url || d.url || (Array.isArray(d.documents) ? (d.documents[0] || {}).doc_url : null) || null;
        app.log.info({ phase: 'tiktok/label', packageId: pid, keys: Object.keys(d || {}), got_url: !!url }, 'tiktok shipping document');
        docs.push({ package_id: pid, url, raw_keys: Object.keys(d || {}) });
      }
      const found = docs.filter((x) => x.url);
      if (!found.length) {
        reply.code(502);
        return { error: 'TikTok returned no document URL for this package — the response shape differs from what we expected.', documents: docs };
      }
      return { ok: true, shipping_type: shipType, documents: found };
    } catch (e) {
      app.log.error({ err: e, phase: 'tiktok/label', order: orderId }, 'tiktok label fetch failed');
      reply.code(400); return { error: e.message };
    }
  });

  // Diagnostic (staff): confirm the stored token still works + show granted scopes.
  // The hosts come back either way — when connect itself is failing there IS no connection to
  // inspect, and "which host are we actually calling" is the first thing you need to know.
  // Hosts are configuration, not secrets; keys and tokens are never echoed.
  app.get('/api/tiktok/debug', { preHandler: requireStaff }, async (req, reply) => {
    const hosts = { auth_host: AUTH_HOST, api_host: API_HOST, authorize_url: AUTHORIZE_URL, region: RESOLVED_REGION };
    try {
      const conn = (await q(`select * from platform_connections where platform='tiktok' order by created_at limit 1`)).rows[0];
      if (!conn) { reply.code(400); return { error: 'No TikTok shop connected', ...hosts }; }
      const token = await validToken(conn);
      return { shop_id: conn.shop_id, shop_name: conn.shop_name, scopes: conn.scopes,
               token_ok: !!token, token_expires_at: conn.token_expires_at, ...hosts };
    } catch (e) { reply.code(400); return { error: e.message, ...hosts }; }
  });

  // ── Product publishing (Make product → TikTok Shop) ──────────────────────────────
  // SAFETY: like the S&S/Otto order paths, this is a DRY RUN until TIKTOK_PUBLISH_LIVE=1.
  // The payload shape is being finalised against TikTok's Create Product doc (v202309); the
  // gate means a shop can never receive a half-mapped product before that's confirmed. The
  // env is read at call time (not module load) so flipping it needs no redeploy.

  // Leaf categories for the publish picker. Thin pass-through — the client renders whatever
  // fields come back (id/local name/is_leaf) so we don't hard-code a shape we haven't seen.
  app.get('/api/tiktok/categories', { preHandler: requireAuth }, async (req, reply) => {
    try {
      // Per-SHOP, like the publish itself: category trees are read against a shop cipher,
      // so with two shops connected the picker must ask the one it's filling in for.
      const conn = await resolveDestination('tiktok', req.query, req.user, connectionForPublish);
      if (!conn) { reply.code(400); return { error: 'No TikTok shop connected' }; }
      const cipher = await getShopCipher(conn);
      /**
       * category_version=v2, because TikTok now refuses anything else.
       *
       * Omitting it returned: "All region shops must use V2 categories. Check the
       * documentation for further details. @ /product/202309/categories" — the picker sat
       * on "Loading categories…" forever, since an error here leaves the list empty and the
       * empty list looks identical to a slow one.
       *
       * It has to be sent on the PRODUCT CREATE too (below). The category id space differs
       * between versions, so a v2 id posted without the flag is a v1 id that doesn't exist —
       * which fails at publish, long after the mistake was made.
       */
      const query = { shop_cipher: cipher, category_version: 'v2' };
      if (req.query && req.query.keyword) query.keyword = String(req.query.keyword);
      const d = await ttSignedRequest(conn, 'GET', '/product/202309/categories', { query });
      return { categories: d.categories || d.category_list || [] };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Warehouses — each SKU's inventory is booked against a warehouse_id.
  app.get('/api/tiktok/warehouses', { preHandler: requireAuth }, async (req, reply) => {
    try {
      // A WAREHOUSE BELONGS TO A SHOP. Returning shop A's warehouses while filling in a
      // product for shop B would put a valid-looking id on a listing that TikTok rejects,
      // or worse accepts against the wrong stock location.
      const conn = await resolveDestination('tiktok', req.query, req.user, connectionForPublish);
      if (!conn) { reply.code(400); return { error: 'No TikTok shop connected' }; }
      const cipher = await getShopCipher(conn);
      const d = await ttSignedRequest(conn, 'GET', '/logistics/202309/warehouses', { query: { shop_cipher: cipher } });
      return { warehouses: d.warehouses || d.warehouse_list || [] };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Create a TikTok Shop product from the publish dialog. GATED: dry run unless
  // TIKTOK_PUBLISH_LIVE=1. On a dry run it returns the assembled payload for review and
  // never calls TikTok (not even the image upload), so the mapping can be validated
  // field-by-field before anything reaches the shop — the S&S/Otto safety pattern.
  app.post('/api/tiktok/publish', { preHandler: requireAuth }, async (req, reply) => {
    if (!APP_KEY || !APP_SECRET) { reply.code(400); return { error: 'Server missing TIKTOK_APP_KEY / TIKTOK_APP_SECRET' }; }
    const b = req.body || {};
    if (!String(b.title || '').trim() || !(Number(b.price) > 0)) {
      reply.code(400); return { error: 'A title and a price are required.' };
    }
    let conn;
    try {
      // The shop named on the request, else the caller's default — see destinations.js.
      // With two TikTok shops connected, `connection_id` is the only thing that says
      // which one, and warehouse_id below belongs to a SHOP, not to TikTok.
      conn = await resolveDestination('tiktok', b, req.user, connectionForPublish);
      if (!conn) { reply.code(400); return { error: 'No TikTok shop connected to publish to.' }; }
      await getShopCipher(conn);   // proves the shop is reachable + caches the cipher
    } catch (e) { reply.code(400); return { error: e.message }; }

    const live = String(process.env.TIKTOK_PUBLISH_LIVE || '') === '1';
    const srcImages = (Array.isArray(b.images) ? b.images : []).filter(Boolean).slice(0, 9);

    if (!live) {
      // Preview only — build with the SOURCE image URLs in the uri slots so the reviewer
      // sees which photos would be pre-uploaded, without actually uploading anything.
      const preview = buildTiktokProductPayload(b, srcImages);
      return {
        dryRun: true,
        shop: conn.shop_name || conn.shop_id,
        note: 'TIKTOK_PUBLISH_LIVE!=1 → NOT sent to TikTok. Review the payload; set TIKTOK_PUBLISH_LIVE=1 (once validated against a real shop) to actually create the product.',
        wouldUploadImages: srcImages.length,
        missing: [
          !preview.category_id && 'category_id (a leaf category is required)',
          !preview.package_weight && 'package_weight',
          !preview.skus.some((s) => s.inventory.length) && 'warehouse_id (SKU inventory has no warehouse)',
          !srcImages.length && 'at least one image',
        ].filter(Boolean),
        payload: preview,
      };
    }

    // LIVE — a clean required-field guard first, so a half-filled product gives a readable
    // error instead of a raw TikTok code (the shop would reject it anyway).
    const problems = [
      !b.category_id && 'a leaf category',
      !b.warehouse_id && 'a warehouse',
      (b.package_weight == null || String(b.package_weight) === '') && 'a package weight',
      !srcImages.length && 'at least one image',
    ].filter(Boolean);
    if (problems.length) { reply.code(400); return { error: 'TikTok needs ' + problems.join(', ') + '.' }; }

    try {
      // 1) Pre-upload each photo → a TikTok image URI (raw URLs aren't accepted on create).
      const uris = [];
      for (const src of srcImages) {
        const bytes = await imageBytesFrom(src);
        if (!bytes) continue;
        const uri = await ttUploadImage(conn, bytes, 'MAIN_IMAGE');
        if (uri) uris.push(uri);
      }
      if (!uris.length) { reply.code(400); return { error: 'None of the images could be uploaded to TikTok.' }; }

      // 2) Create the product.
      const payload = buildTiktokProductPayload(b, uris);
      // category_version must MATCH the version the picker listed from (v2, above) — the id
      // spaces differ, so sending a v2 id without saying so is sending a v1 id that doesn't
      // exist.
      const d = await ttSignedRequest(conn, 'POST', '/product/202309/products', {
        query: { shop_cipher: conn.shop_cipher, category_version: 'v2' }, body: payload,
      });
      const productId = d.product_id || null;

      // 3) Remember what it was built from, so the order it eventually produces arrives
      //    ready to make — best-effort, mirrors the Etsy publish path.
      if (productId) {
        q(`insert into published_listings
             (listing_id, platform, seller_id, blank_sku, design_id, design_data, design_pos, print_type, color, size,
              connection_id, shop_id)
           values ($1,'tiktok',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           on conflict (listing_id) do update set
             blank_sku=excluded.blank_sku, print_type=excluded.print_type,
             color=excluded.color, size=excluded.size,
             connection_id=excluded.connection_id, shop_id=excluded.shop_id`,
          [String(productId), req.user.sub || null, b.blank || b.sku || null, b.designId || null,
           b.designUrl || b.design || null, b.designPos ? JSON.stringify(b.designPos) : null,
           b.printType || b.method || null,
           (Array.isArray(b.colors) && b.colors.length === 1) ? b.colors[0] : null,
           (Array.isArray(b.sizes) && b.sizes.length === 1) ? b.sizes[0] : null,
           // Which shop it went to — warehouses and category ids are per-shop, so an edit
           // that reached the wrong one would be wrong in more than just the token.
           conn.id, conn.shop_id || null]
        ).catch(() => {});
      }
      return { ok: true, product_id: productId, skus: d.skus || [], warnings: d.warnings || [] };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
