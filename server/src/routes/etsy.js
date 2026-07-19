// Etsy integration — OAuth 2.0 (PKCE) connect + order/listing sync.
// Etsy v3 uses PKCE with the keystring as client_id; NO client secret is needed
// for the token exchange. Access tokens last ~1h and are refreshed automatically.
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { audit } from '../audit.js';
import { usdRates } from '../fx.js';
import { requireSpydeck } from '../entitlements.js';
import { fetchSheetRows } from './sheets.js';

const KEYSTRING   = (process.env.ETSY_KEYSTRING || '').trim();
const SHARED_SECRET = (process.env.ETSY_SHARED_SECRET || '').trim();
// x-api-key for Etsy v3 data calls. THIS app REQUIRES the combined "keystring:shared_secret"
// form — Etsy rejects keystring-alone with "Shared secret is required in x-api-key header"
// (confirmed live from the receipts endpoint, 2026-07). So combined is correct and MANDATORY,
// which also proves it is NOT the cause of buyer-address redaction — that is Etsy's Commercial
// Access entitlement, applied server-side, independent of this header. Default = combined; set
// ETSY_API_KEY_MODE=keystring only to reproduce the 400. .trim() guards .env whitespace.
const API_KEY_MODE = (process.env.ETSY_API_KEY_MODE || 'combined').trim().toLowerCase();
const API_KEY_HEADER = (API_KEY_MODE === 'keystring' || !SHARED_SECRET)
  ? KEYSTRING
  : (KEYSTRING + ':' + SHARED_SECRET);
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
    // Gunjan step 2: bypass any local/intermediary cache so we never read a stale redacted response.
    headers: { 'x-api-key': API_KEY_HEADER, Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' }
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
  const res = await fetch(API + path, { method: opts.method || 'GET', headers: Object.assign({ 'x-api-key': API_KEY_HEADER, Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' }, opts.headers || {}), body: opts.body });
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
  // Etsy's sale notifications go to the SHOP's email, which is usually not the seller's
  // EGFULFILL login. Capture it so a forwarded sale email can be traced back to the right
  // seller without them registering anything.
  if (rc.seller_email) {
    q(`update platform_connections set seller_email=$1 where id=$2 and (seller_email is null or seller_email <> $1)`,
      [String(rc.seller_email).toLowerCase(), conn.id]).catch(() => {});
  }
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
       customer=excluded.customer,
       -- NEVER overwrite a real address with Etsy's redacted nulls. Etsy withholds the
       -- buyer address from unapproved apps, so a re-sync used to blank whatever was
       -- there — wiping a CSV-imported or hand-typed address within minutes, since the
       -- auto-sync runs every 5 minutes. Adopt the incoming address only when it
       -- actually carries a street; otherwise keep what we have.
       -- This also self-heals: the moment Etsy grants the entitlement and starts
       -- returning real values, the next sync adopts them automatically.
       address = case
         when coalesce(nullif(excluded.address->>'line1', ''), null) is not null
           then excluded.address
         else orders.address
       end,
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

// Public listing search (keystring only, no seller OAuth) → normalized cards. Reused
// by the /api/etsy/search route AND the SpyDeck trending aggregator. Throws on failure
// with an `.status` for the caller to map.
export async function searchListings(query, opts = {}) {
  if (!KEYSTRING) { const e = new Error('Server missing ETSY_KEYSTRING'); e.status = 500; throw e; }
  const limit = Math.min(48, Math.max(1, parseInt(opts.limit, 10) || 24));
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
  const sort = ['created', 'price'].includes(opts.sort) ? opts.sort : 'score';
  const sortOrder = opts.sortOrder === 'asc' ? 'asc' : opts.sortOrder === 'desc' ? 'desc' : null;
  // keywords is optional — you can browse a category / price range with no search term.
  const params = ['limit=' + limit, 'offset=' + offset, 'sort_on=' + sort, 'includes=Images,Shop'];
  const kw = String(query || '').trim();
  if (kw) params.unshift('keywords=' + encodeURIComponent(kw));
  if (sortOrder) params.push('sort_order=' + sortOrder);
  if (opts.taxonomyId && /^\d+$/.test(String(opts.taxonomyId))) params.push('taxonomy_id=' + opts.taxonomyId);
  const minP = Number(opts.minPrice); if (minP > 0) params.push('min_price=' + minP);
  const maxP = Number(opts.maxPrice); if (maxP > 0) params.push('max_price=' + maxP);
  const u = API + '/listings/active?' + params.join('&');
  const r = await fetch(u, { headers: { 'x-api-key': API_KEY_HEADER } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((d && d.error) || ('Etsy search error ' + r.status)); e.status = (r.status >= 400 && r.status < 500) ? r.status : 502; throw e; }
  const base = d.results || [];
  const pickImg = (im) => (im && (im.url_570xN || im.url_fullxfull || im.url_680x540 || im.url_300x300)) || null;
  // findAllListingsActive frequently DROPS the Images include → batch-fetch images and merge.
  const imgsById = {};
  const ids = base.map((l) => l.listing_id).filter(Boolean);
  if (ids.length && base.some((l) => !(l.images && l.images[0]))) {
    try {
      const bu = API + '/listings/batch?listing_ids=' + ids.slice(0, 100).join(',') + '&includes=Images';
      const br = await fetch(bu, { headers: { 'x-api-key': API_KEY_HEADER } });
      if (br.ok) {
        const bd = await br.json().catch(() => ({}));
        (bd.results || []).forEach((l) => { const arr = (l.images || []).map(pickImg).filter(Boolean); if (arr.length) imgsById[l.listing_id] = arr; });
      }
    } catch (e) { /* image enrich is best-effort */ }
  }
  const results = await attachUsd(base.map((l) => mapListing(l, imgsById)));
  return { count: d.count || results.length, query, offset, limit, results };
}

/**
 * Annotate listings with a USD price. Etsy returns each listing in the SHOP's currency,
 * so results mixed "$39.00" with "MYR 111.00" — not comparable, and not sortable by
 * price in any meaningful way. Rates are fetched ONCE per response (cached 12h in fx.js).
 *
 * price_usd stays NULL when we have no rate, and price_converted marks an approximation,
 * so the UI can show the real number instead of relabelling a foreign amount as dollars.
 */
export async function attachUsd(results) {
  const list = Array.isArray(results) ? results : [];
  const foreign = list.some((r) => r.price != null && String(r.currency || 'USD').toUpperCase() !== 'USD');
  const rates = foreign ? await usdRates() : null;
  for (const r of list) {
    const code = String(r.currency || 'USD').toUpperCase();
    if (r.price == null) { r.price_usd = null; r.price_converted = false; continue; }
    if (code === 'USD') { r.price_usd = r.price; r.price_converted = false; continue; }
    const rate = rates && Number(rates[code]);
    if (rate > 0) { r.price_usd = Math.round((r.price / rate) * 100) / 100; r.price_converted = true; }
    else { r.price_usd = null; r.price_converted = false; }
  }
  return list;
}

// The ONE Etsy listing → app shape mapper. Search AND the shop analyzer both use it,
// so a listing has identical fields wherever SpyDeck renders it.
export function mapListing(l, imgsById = {}) {
  const pick = (im) => (im && (im.url_570xN || im.url_fullxfull || im.url_680x540 || im.url_300x300)) || null;
  const inlineImgs = (l.images || []).map(pick).filter(Boolean);
  const images = inlineImgs.length ? inlineImgs : (imgsById[l.listing_id] || []);
  return {
    listing_id: l.listing_id,
    title: l.title || '',
    description: l.description || '',
    price: l.price ? (Number(l.price.amount) / (Number(l.price.divisor) || 100)) : null,
    currency: (l.price && l.price.currency_code) || 'USD',
    url: l.url || ('https://www.etsy.com/listing/' + l.listing_id),
    tags: Array.isArray(l.tags) ? l.tags : [],
    image: images[0] || null,
    images: images,
    created: l.original_creation_timestamp || l.created_timestamp || l.creation_tsz || null,
    views: (typeof l.views === 'number' ? l.views : null),
    shop_name: (l.shop && l.shop.shop_name) || null,
    num_favorers: l.num_favorers || 0,
  };
}

/** The Etsy connection to act as: a seller's own, or (for staff, who have no shop
 *  of their own) the first connected shop — matching /api/etsy/connected. */
export async function connectionFor(user) {
  const staff = !!(user && user.role && user.role !== 'seller');
  const r = await q(
    staff ? `select * from platform_connections where platform='etsy' order by created_at limit 1`
          : `select * from platform_connections where platform='etsy' and connected_by=$1 order by created_at limit 1`,
    staff ? [] : [user.sub]
  );
  return r.rows[0] || null;
}

/** A connected shop + its active listings, normalized through mapListing so they
 *  score identically to search results. */
export async function shopListings(conn) {
  if (!conn.shop_id) { const e = new Error('Connected shop has no shop_id — reconnect the shop'); e.status = 400; throw e; }
  const shop = await etsyGet(conn, `/shops/${conn.shop_id}`).catch(() => null);
  // Etsy caps this at 100/page; one page is plenty to characterise a shop.
  const r = await etsyGet(conn, `/shops/${conn.shop_id}/listings/active?limit=100&includes=Images`);
  const base = Array.isArray(r.results) ? r.results : [];

  // Same image-enrich fallback as search: the list endpoint often drops Images.
  const imgsById = {};
  const ids = base.map((l) => l.listing_id).filter(Boolean);
  if (ids.length && base.some((l) => !(l.images && l.images[0]))) {
    try {
      const bd = await etsyGet(conn, `/listings/batch?listing_ids=${ids.slice(0, 100).join(',')}&includes=Images`);
      (bd.results || []).forEach((l) => {
        const arr = (l.images || []).map((im) => (im && (im.url_570xN || im.url_fullxfull || im.url_300x300)) || null).filter(Boolean);
        if (arr.length) imgsById[l.listing_id] = arr;
      });
    } catch (e) { /* best-effort */ }
  }
  return {
    shop: {
      shop_id: conn.shop_id,
      shop_name: (shop && shop.shop_name) || conn.shop_name || null,
      url: (shop && shop.url) || null,
      num_favorers: (shop && shop.num_favorers) || 0,
      listing_active_count: (shop && shop.listing_active_count) || base.length,
      review_count: (shop && shop.review_count) || null,
      review_average: (shop && shop.review_average) || null,
    },
    count: (typeof r.count === 'number') ? r.count : base.length,
    listings: await attachUsd(base.map((l) => mapListing(l, imgsById))),
  };
}

// ── routes ───────────────────────────────────────────────────────────────--
export function etsyRoutes(app, requireAuth, requireStaff) {
  q('alter table platform_connections add column if not exists seller_email text').catch(() => {});
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

  /**
   * Address backfill sweep.
   *
   * Etsy currently redacts buyer addresses for apps not mapped to an approved category.
   * When that entitlement is granted there is no notification — the fields simply start
   * populating. This re-fetches receipts for orders that are STILL missing an address and
   * re-imports them; the upsert above adopts an address only when it carries a street, so
   * this is a no-op while redaction continues and self-heals the moment it lifts.
   *
   * Note this cannot fetch Etsy's CSV export — that lives behind the seller's Shop Manager
   * web session, not the API. Automating it would mean storing seller credentials and
   * scripting their UI, which breaks Etsy's terms and risks the seller's account. The CSV
   * path stays a deliberate manual upload; this covers the API side.
   */
  async function backfillMissingAddresses(limit = 40) {
    const conn = (await q(`select * from platform_connections where platform='etsy' order by created_at limit 1`)).rows[0];
    if (!conn) return { skipped: 'no-connection' };
    // Same ownership flag the sync computes. Passing undefined would rewrite
    // factory_order to false and hand a factory-owned order back to the seller.
    const isFactory = await ownerIsStaff(conn.connected_by);
    // Only orders we could still act on — a shipped order needs no address now.
    const rows = (await q(`
      select id from orders
       where source='etsy'
         and coalesce(factory_status,'') not in ('shipped','cancelled','refunded')
         and coalesce(address->>'line1', '') = ''
         and coalesce(address->>'street', '') = ''
       order by created_at desc limit $1`, [limit])).rows;
    let filled = 0;
    for (const r of rows) {
      const receiptId = String(r.id).replace(/^etsy-/, '');
      if (!/^\d+$/.test(receiptId)) continue;
      try {
        const rc = await etsyGet(conn, `/shops/${conn.shop_id}/receipts/${receiptId}?includes=Transactions`);
        if (!rc || !rc.receipt_id) continue;
        if (!rc.first_line) continue;                 // still redacted — nothing to adopt
        await importReceipt(conn, rc, null, {}, isFactory);
        filled++;
      } catch (e) { /* one bad receipt must not stop the sweep */ }
    }
    return { checked: rows.length, filled };
  }

  // Staff can run it on demand; it also runs on a timer below.
  app.post('/api/etsy/backfill-addresses', { preHandler: requireStaff }, async () => backfillMissingAddresses(200));

  // ── Address sheet (optional automation of the CSV step) ──────────────────────
  // The seller still exports from Etsy by hand — that download is behind their Shop
  // Manager session and automating it would mean holding their credentials, which we
  // will not do. What IS automated is the INGESTION: drop the export into a
  // link-shared Google Sheet and this reads it on a timer. Read-only, key-based, and
  // it touches no seller credential.
  const SHEET_KEY = 'etsy_address_sheet';

  /** Map a sheet/CSV header row + rows into the address shape applyAddressRows expects.
   *  Header matching is forgiving: Etsy has renamed these columns over the years and
   *  sellers re-save through Excel. */
  function mapAddressRows(rows) {
    if (!rows || rows.length < 2) return [];
    const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const headers = rows[0].map(norm);
    const pick = (...cands) => {
      for (const c of cands) { const i = headers.indexOf(norm(c)); if (i >= 0) return i; }
      for (const c of cands) { const i = headers.findIndex((h) => h.includes(norm(c))); if (i >= 0) return i; }
      return -1;
    };
    const iOrder = pick('Order ID', 'Receipt ID', 'orderid');
    const iStreet = pick('Ship Address1', 'Shipping Address1', 'Street 1', 'address1');
    if (iOrder < 0 || iStreet < 0) return [];
    const iName = pick('Ship Name', 'Full Name', 'Buyer', 'name');
    const iStreet2 = pick('Ship Address2', 'Shipping Address2', 'Street 2', 'address2');
    const iCity = pick('Ship City', 'Shipping City', 'city');
    const iState = pick('Ship State', 'Shipping State', 'state', 'province');
    const iZip = pick('Ship Zipcode', 'Ship Zip', 'Shipping Zip', 'zip', 'postalcode');
    const iCountry = pick('Ship Country', 'Shipping Country', 'country');
    const at = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    return rows.slice(1).filter((r) => at(r, iOrder)).map((r) => ({
      order_id: at(r, iOrder), name: at(r, iName), street: at(r, iStreet), street2: at(r, iStreet2),
      city: at(r, iCity), state: at(r, iState), zip: at(r, iZip), country: at(r, iCountry),
    }));
  }

  async function pollAddressSheet() {
    const row = (await q('select value from settings where key=$1', [SHEET_KEY])).rows[0];
    const url = row && String(row.value || '').replace(/^"|"$/g, '');
    if (!url) return { skipped: 'not-configured' };
    const { rows } = await fetchSheetRows(url);
    const mapped = mapAddressRows(rows);
    if (!mapped.length) return { skipped: 'no-mappable-rows' };
    // No user → staff privileges, which is correct for a platform-level job. Because it
    // writes with those privileges on a TIMER, it must leave a record: an unattended job
    // changing seller orders with no trail is how a bad sheet becomes an unexplainable
    // data problem.
    const res = await applyAddressRows(mapped, null);
    if (res.updated > 0) {
      await q(`insert into audit_log (actor, actor_role, action, entity_type, note)
               values ($1,$2,$3,$4,$5)`,
        ['system', 'system', 'etsy.address_sheet_poll', 'order',
         `sheet poll filled ${res.updated} address(es); ${res.alreadyHad} already set, ${res.notFound} unmatched`])
        .catch(() => {});
    }
    return res;
  }

  app.get('/api/etsy/address-sheet', { preHandler: requireStaff }, async () => {
    const row = (await q('select value from settings where key=$1', [SHEET_KEY])).rows[0];
    return { url: row ? String(row.value || '').replace(/^"|"$/g, '') : '' };
  });

  app.put('/api/etsy/address-sheet', { preHandler: requireStaff }, async (req) => {
    const url = String((req.body || {}).url || '').trim();
    await q(`create table if not exists settings (key text primary key, value text, updated_at timestamptz default now())`).catch(() => {});
    await q('insert into settings (key,value,updated_at) values ($1,to_jsonb($2::text),now()) on conflict (key) do update set value=excluded.value, updated_at=now()', [SHEET_KEY, url]).catch(() => {});
    audit(req, 'etsy.address_sheet', { entityType: 'settings', entityId: SHEET_KEY, after: { url } });
    return { ok: true, url };
  });

  // Run it now (staff) — so the sheet can be verified without waiting for the timer.
  app.post('/api/etsy/address-sheet/run', { preHandler: requireStaff }, async (req, reply) => {
    try { return { ok: true, ...(await pollAddressSheet()) }; }
    catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Every 5 minutes, matching the order sync — a fresh export should appear while someone
  // is still at their desk, not an hour later. Two API calls per run, and a no-op when
  // nothing is missing an address, so the cost is negligible.
  if (!globalThis.__egEtsyAddrSheet) {
    globalThis.__egEtsyAddrSheet = setInterval(() => { pollAddressSheet().catch(() => {}); }, 5 * 60 * 1000);
    if (globalThis.__egEtsyAddrSheet.unref) globalThis.__egEtsyAddrSheet.unref();
  }

  // Hourly — far rarer than the 5-minute order sync, because this only matters on the
  // day Etsy flips the entitlement. Same single-instance guard + unref as the sync.
  if (KEYSTRING && SHARED_SECRET && !globalThis.__egEtsyAddrBackfill) {
    globalThis.__egEtsyAddrBackfill = setInterval(() => { backfillMissingAddresses().catch(() => {}); }, 60 * 60 * 1000);
    if (globalThis.__egEtsyAddrBackfill.unref) globalThis.__egEtsyAddrBackfill.unref();
  }

  // Frontend reads this to build the Etsy authorize URL (keystring is public).
  app.get('/api/etsy/config', async () => ({
    keystring: KEYSTRING, redirect_uri: REDIRECT_URI, scopes: SCOPES,
    configured: !!KEYSTRING
  }));

  // ── Product Scout: public Etsy listing search (product research). No seller OAuth —
  // the app keystring alone can query public active listings. requireAuth so only signed-in
  // users hit it (plan-gating layers on top later). Shared by the seller + admin Scout modal.
  // SpyDeck-only surfaces: the research data IS the paid feature, so gate them with
  // the same entitlement as /api/spydeck/*. Left on requireAuth these were a back
  // door straight around the paywall.
  app.get('/api/etsy/search', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    const qy = req.query || {};
    const query = String((qy.q || qy.keywords) || '').trim();
    const hasFilter = !!(qy.taxonomyId || qy.taxonomy_id || qy.minPrice || qy.maxPrice);
    if (!query && !hasFilter) { reply.code(400); return { error: 'Enter a search term or pick a filter (category / price).' }; }
    try {
      return await searchListings(query, {
        limit: qy.limit, offset: qy.offset, sort: qy.sort, sortOrder: qy.sortOrder,
        taxonomyId: qy.taxonomyId || qy.taxonomy_id, minPrice: qy.minPrice, maxPrice: qy.maxPrice,
      });
    } catch (e) { reply.code(e.status || 502); return { error: e.message }; }
  });

  // Etsy's real top-level categories (buyer taxonomy) for the SpyDeck filter. Public
  // (keystring), rarely changes → cached in memory for the process lifetime.
  let _taxCache = null;
  app.get('/api/etsy/categories', { preHandler: [requireAuth, requireSpydeck] }, async () => {
    if (_taxCache) return { categories: _taxCache };
    try {
      const r = await fetch(API + '/buyer-taxonomy/nodes', { headers: { 'x-api-key': API_KEY_HEADER } });
      const d = await r.json().catch(() => ({}));
      const top = (d.results || []).filter((n) => (n.level === 1 || n.level === 0) && n.id && n.name)
        .map((n) => ({ id: n.id, name: n.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (top.length) _taxCache = top;
      return { categories: top };
    } catch (e) { return { categories: [] }; }
  });

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

  // Connection check + shop names, gated by role. A SELLER sees only the shop(s) THEY connected.
  // FACTORY/staff share ONE pool of factory-connected shops (any non-seller connector) — gated
  // against seller shops, so a seller's shop never shows on a factory board and vice-versa.
  // The signed-in seller's OWN shop + its active listings, for the SpyDeck Account
  // Analyzer. Returns listings in the same shape as /api/etsy/search (mapListing), so
  // the client scores them with the very same estimate logic it uses on everyone
  // else's — an analyzer that measured your shop differently would be worthless.
  // Staff (no shop of their own) fall back to the first connection, matching how
  // /api/etsy/connected already behaves for them.
  app.get('/api/etsy/my-shop', { preHandler: requireAuth }, async (req, reply) => {
    const conn = await connectionFor(req.user);
    if (!conn) { reply.code(400); return { error: 'No Etsy shop connected' }; }
    try {
      return await shopListings(conn);
    } catch (e) {
      reply.code(e.status || 502);
      return { error: e.message || 'Etsy request failed' };
    }
  });

  app.get('/api/etsy/connected', { preHandler: requireAuth }, async (req) => {
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const r = await q(staff
      ? `select shop_name from platform_connections pc where platform='etsy' and not exists (select 1 from users u where u.id=pc.connected_by and u.role='seller') order by created_at`
      : `select shop_name from platform_connections where platform='etsy' and connected_by=$1 order by created_at`,
      staff ? [] : [req.user.sub]);
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
      // Gunjan step 4: ?id=<receipt_id> targets a SPECIFIC (e.g. brand-new, post-approval)
      // receipt to check whether the redaction is legacy-only; else audit the newest one.
      const wantId = String((req.query && req.query.id) || '').trim();
      let rc;
      if (wantId) {
        rc = await etsyGet(conn, `/shops/${conn.shop_id}/receipts/${wantId}?includes=Transactions`).catch((e) => ({ error: e.message }));
      } else {
        const r = await etsyGet(conn, `/shops/${conn.shop_id}/receipts?limit=1&includes=Transactions`);
        rc = (r.results || [])[0] || {};
      }
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
          const res = await fetch(API + `/shops/${conn.shop_id}/receipts/${rc.receipt_id}`, { headers: { 'x-api-key': KEYSTRING, Authorization: 'Bearer ' + tok, 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } });
          keyOnly = await res.json().catch(() => ({}));
          if (!res.ok) keyOnly = { http: res.status, body: keyOnly };
        }
      } catch (e) { keyOnly = { error: e.message }; }
      // Capture the raw RESPONSE HEADERS + address from a CORRECTLY-authed single-receipt fetch
      // (x-api-key = keystring:shared_secret — the working auth). Etsy support asks for these headers +
      // a receipt id for a deeper audit after Commercial Access is applied to the keystring.
      let responseStatus = null, responseHeaders = {}, addrFromProbe = {}, fullBody = null;
      try {
        if (rc.receipt_id) {
          const tok2 = await validToken(conn);
          // Explicit COMBINED key here so this stays a genuine A/B vs address_keystring_only above,
          // even though the app now DEFAULTS to keystring-alone.
          const combinedKey = SHARED_SECRET ? (KEYSTRING + ':' + SHARED_SECRET) : KEYSTRING;
          const res2 = await fetch(API + `/shops/${conn.shop_id}/receipts/${rc.receipt_id}`, { headers: { 'x-api-key': combinedKey, Authorization: 'Bearer ' + tok2, 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } });
          responseStatus = res2.status;
          res2.headers.forEach((v, k) => { responseHeaders[k] = v; });
          const b2 = await res2.json().catch(() => ({}));
          fullBody = b2;
          addrFromProbe = res2.ok
            ? { name: b2.name, first_line: b2.first_line, city: b2.city, state: b2.state, zip: b2.zip, formatted_address: b2.formatted_address }
            : { http: res2.status, body: b2 };
        }
      } catch (e) { responseHeaders = { error: e.message }; }
      const addr = (x) => ({ name: x.name, first_line: x.first_line, city: x.city, state: x.state, zip: x.zip, formatted_address: x.formatted_address });
      return {
        // Copy-paste-ready trace for Etsy support: the exact request we send + the exact
        // response Etsy returns for this one receipt (keystring shown, secret+token redacted).
        support_log: {
          note: 'Paste this whole support_log block to Etsy — the recipient name populates while every address field is null in response.body.',
          request: {
            method: 'GET',
            url: API + `/shops/${conn.shop_id}/receipts/${rc.receipt_id}`,
            headers: {
              'x-api-key': (KEYSTRING || '<keystring>') + ':<shared_secret redacted>',
              authorization: 'Bearer <oauth access token redacted>'
            }
          },
          response: { status: responseStatus, headers: responseHeaders, body: fullBody }
        },
        sharedSecretSet: !!SHARED_SECRET,
        apiKeyMode: API_KEY_HEADER && API_KEY_HEADER.indexOf(':') >= 0 ? 'keystring:shared_secret' : 'keystring-only',
        connScopes: conn.scopes,
        scopes: conn.scopes,
        receipt_id: rc.receipt_id,
        state: { is_paid: rc.is_paid, is_shipped: rc.is_shipped, status: rc.status, receipt_type: rc.receipt_type, buyer_user_id: rc.buyer_user_id },
        address_from_list: addr(rc),
        address_from_single: single.error ? single : addr(single),
        address_keystring_only: keyOnly.error || keyOnly.http ? keyOnly : addr(keyOnly),
        response_status: responseStatus,
        response_headers: responseHeaders,
        address_from_authed_probe: addrFromProbe,
        receipt_keys: Object.keys(rc)
      };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Address scan (staff): the definitive "are buyer shipping addresses coming through now?"
  // test. Scans recent receipts (or one via ?id) and returns a plain VERDICT plus, per
  // receipt, whether Etsy sent the shipping address — so you can tell at a glance whether
  // ANY recent order has one. New receipts populate first once Commercial Access
  // propagates, so legacy orders may stay redacted while fresh ones fill in. Uncached
  // (etsyGet sends no-cache). Read-only, mutates nothing.
  //   GET /api/etsy/address-scan            -> newest ~10 receipts
  //   GET /api/etsy/address-scan?limit=25   -> newest 25 (capped at 100)
  //   GET /api/etsy/address-scan?id=<rid>   -> just that one receipt (test a brand-new order)
  app.get('/api/etsy/address-scan', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const conn = (await q(`select * from platform_connections where platform='etsy' order by created_at limit 1`)).rows[0];
      if (!conn) { reply.code(400); return { error: 'No Etsy shop connected' }; }
      // Etsy v3 carries the shipping address inline on the receipt object (no nested obj).
      const ADDR_FIELDS = ['name', 'first_line', 'second_line', 'city', 'state', 'zip', 'country_iso', 'formatted_address'];
      const pickAddr = (r) => {
        const a = {};
        for (const f of ADDR_FIELDS) a[f] = (r && r[f] != null && r[f] !== '') ? r[f] : null;
        return a;
      };
      // "Has a SHIPPING address" = a DELIVERABLE line is present (street/city/zip/formatted).
      // The recipient NAME alone does NOT count: Etsy releases the name on the standard tier
      // while redacting the address lines, so counting the name would falsely report success.
      const hasAddr = (a) => !!(a.first_line || a.city || a.zip || a.formatted_address);
      const isoDate = (secs) => { try { return secs ? new Date(secs * 1000).toISOString() : null; } catch (e) { return null; } };

      let receipts = [], total = null;
      const wantId = String((req.query && req.query.id) || '').trim();
      if (wantId) {
        // .catch → a mistyped / not-yet-propagated id degrades to NO_RECEIPTS_FOUND, not a 400.
        const one = await etsyGet(conn, `/shops/${conn.shop_id}/receipts/${wantId}?includes=Transactions`).catch(() => null);
        receipts = one && one.receipt_id ? [one] : [];
      } else {
        let limit = parseInt((req.query && req.query.limit) || '10', 10);
        if (!(limit > 0)) limit = 10;
        if (limit > 100) limit = 100;
        // Etsy returns receipts newest-first by default; sort desc client-side too so the
        // newest is always on top regardless of Etsy's ordering.
        const r = await etsyGet(conn, `/shops/${conn.shop_id}/receipts?limit=${limit}&offset=0&includes=Transactions`);
        receipts = Array.isArray(r.results) ? r.results : [];
        total = (typeof r.count === 'number') ? r.count : null;
      }

      const rows = receipts.filter(Boolean).map((r) => {
        const a = pickAddr(r);
        return {
          receipt_id: r.receipt_id,
          order_date: isoDate(r.created_timestamp || r.create_timestamp),
          status: r.status,
          buyer_email: (r.buyer_email != null && r.buyer_email !== '') ? r.buyer_email : null, // also address_r-gated — a second signal
          address: a,
          has_name: !!a.name,
          has_shipping_address: hasAddr(a)
        };
      }).sort((x, y) => String(y.order_date || '').localeCompare(String(x.order_date || '')));

      const withAddr = rows.filter((x) => x.has_shipping_address).length;
      const withName = rows.filter((x) => x.has_name).length;
      const scopes = String(conn.scopes || '');
      return {
        verdict: rows.length === 0 ? 'NO_RECEIPTS_FOUND'
          : withAddr > 0 ? `ADDRESS_PRESENT — ${withAddr}/${rows.length} scanned receipts have a full shipping address`
          : withName > 0 ? `REDACTED — buyer NAME shows on ${withName}/${rows.length} but street/city/state/zip are all null. Etsy is still withholding the address (Commercial Access is not releasing address PII on this keystring).`
          : `REDACTED — 0/${rows.length} scanned receipts have any address`,
        note: 'Buyer shipping address on receipts is gated by Etsy Commercial Access (app tier), NOT by an OAuth scope. REDACTED across fresh receipts = the entitlement has not propagated on Etsy\'s side; there is nothing to fix in our code.',
        address_r_in_scopes: /(^|\s)address_r(\s|$)/.test(scopes),
        granted_scopes: conn.scopes || null,
        apiKeyMode: API_KEY_HEADER && API_KEY_HEADER.indexOf(':') >= 0 ? 'keystring:shared_secret' : 'keystring-only',
        server_keystring: KEYSTRING ? (KEYSTRING.slice(0, 5) + '…' + KEYSTRING.slice(-4)) : '(unset)',
        shop_id: conn.shop_id,
        total_receipts_in_shop: total,
        scanned: rows.length,
        with_address: withAddr,
        receipts: rows
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
      // Find the shop owned by the AUTHORIZED account. Authorizing != owning: OAuth grants access
      // to whatever Etsy account was logged in (which may be a buyer account, or the wrong login),
      // NOT proof of shop ownership. If Etsy returns no shop for this user, refuse the connect with
      // a clear message rather than silently storing shop_id=user_id — that fallback 404s every
      // later receipts call ("Could not find a shop for user …") and forces a manual repair.
      let shopId = '', shopName = '';
      try {
        const shops = await etsyGet(tmp, `/users/${userId}/shops`);
        const shop = shops && (shops.shop_id ? shops : (Array.isArray(shops.results) ? shops.results[0] : null));
        if (shop && shop.shop_id) { shopId = String(shop.shop_id); shopName = shop.shop_name || ('Etsy shop ' + shopId); }
      } catch (e) { /* fall through to the no-shop guard below */ }
      if (!shopId) {
        reply.code(400);
        return { error: 'That Etsy account has no shop we can access — you likely authorized while logged in as the wrong Etsy account (a buyer account, or one that doesn’t own your shop). Log in to Etsy as the shop OWNER, then connect again.' };
      }

      // NB: last_sync_at=null on reconnect → the next sync is a FULL pull, so a newly-granted scope
      // (e.g. address_r just approved by Etsy) BACKFILLS shipping addresses onto existing unshipped orders.
      await q(
        `insert into platform_connections (platform, shop_id, shop_name, access_token, refresh_token, token_expires_at, scopes, connected_by)
         values ('etsy',$1,$2,$3,$4,$5,$6,$7)
         on conflict (platform, shop_id) do update set
           shop_name=excluded.shop_name, access_token=excluded.access_token,
           refresh_token=excluded.refresh_token, token_expires_at=excluded.token_expires_at,
           scopes=excluded.scopes, connected_by=excluded.connected_by,
           last_sync_at=null, updated_at=now()`,
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
      ['TEE-WHT-L', 'Custom Print Cotton Tee', 2, 'White / L', 5.00, 'https://placehold.co/600x600/efefef/333333?text=Tee+Listing', null, null]   // method UNSET → arrives "Select" (no auto-DTG), demoing the new variant policy
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

  /**
   * Backfill buyer addresses from the seller's own Etsy CSV export.
   *
   * Etsy redacts the address from the API for apps not mapped to an approved category,
   * but the seller's own "Download Data" export in Shop Manager still contains it. This
   * takes those rows and fills the gap for orders we've already synced, so parcels can
   * actually be labelled while the API entitlement is pending.
   *
   * Matched on RECEIPT ID (the Etsy "Order ID" column) against our `etsy-<id>` ids —
   * never on buyer name, which is neither unique nor stable.
   *
   * body: { rows: [{ order_id, name, street, street2, city, state, zip, country }] }
   */
  /**
   * Apply address rows to synced orders. Shared by the manual CSV upload and the
   * scheduled sheet poll so both behave identically.
   *
   * Safety rules that must not be relaxed — these touch real seller orders:
   *   • match on RECEIPT ID only (never buyer name: not unique, not stable)
   *   • never overwrite an address that already exists (a re-import must not clobber a
   *     hand-typed correction)
   *   • a seller may only fill their OWN orders
   */
  async function applyAddressRows(rows, user) {
    let updated = 0, skipped = 0, notFound = 0, alreadyHad = 0;
    const missing = [];
    const rejected = [];
    for (const r of rows) {
      const rid = String(r.order_id || '').replace(/[^0-9]/g, '');
      if (!rid) { skipped++; continue; }
      const id = 'etsy-' + rid;
      const staff = !user || isStaff(user);
      const cur = staff
        ? (await q('select id, address from orders where id=$1', [id])).rows[0]
        : (await q('select id, address from orders where id=$1 and seller_id=$2', [id, user.sub])).rows[0];
      if (!cur) { notFound++; missing.push(rid); continue; }
      const existing = cur.address || {};
      if (existing.street || existing.first_line || existing.line1) { alreadyHad++; continue; }
      const cap = (v, n) => String(v || '').trim().slice(0, n) || null;
      const street = cap(r.street, 120);
      if (!street) { skipped++; continue; }
      // The sheet lives outside our control — anyone with edit access could mangle it,
      // deliberately or by dragging a cell. Treat every row as untrusted and refuse
      // anything not shaped like a US address rather than printing it on a label.
      const st = String(r.state || '').trim().toUpperCase();
      const zp = String(r.zip || '').trim();
      const badState = st && !/^[A-Z]{2}$/.test(st);
      const badZip = zp && !/^\d{5}(-\d{4})?$/.test(zp);
      if (badState || badZip || !String(r.city || '').trim()) {
        rejected.push({ order_id: rid, why: badState ? 'state is not 2 letters' : badZip ? 'zip is not 5 or 5-4 digits' : 'no city' });
        skipped++; continue;
      }
      // Scoped on the WRITE as well as the read. The select above already proved
      // ownership, so this is belt-and-braces — but a write guarded only by an earlier
      // select is one careless refactor away from being cross-tenant, and this touches
      // other people's orders.
      const wSql = staff
        ? 'update orders set address=$1 where id=$2'
        : 'update orders set address=$1 where id=$2 and seller_id=$3';
      const wArgs = staff ? [null, id] : [null, id, user.sub];
      wArgs[0] = JSON.stringify({
        ...existing,
        name: cap(r.name || existing.name, 120),
        street, street2: cap(r.street2, 120),
        city: cap(r.city, 80),
        state: cap(r.state, 40),
        zip: cap(r.zip, 20),
        country: cap(r.country, 40),
        source: 'etsy-csv',
      });
      await q(wSql, wArgs);
      updated++;
    }
    return { updated, skipped, notFound, alreadyHad, missing: missing.slice(0, 20), rejected: rejected.slice(0, 20) };
  }

  app.post('/api/etsy/import-addresses', { preHandler: requireAuth }, async (req, reply) => {
    const rows = Array.isArray((req.body || {}).rows) ? req.body.rows : [];
    if (!rows.length) { reply.code(400); return { error: 'No rows to import.' }; }
    const res = await applyAddressRows(rows, req.user);
    audit(req, 'etsy.import_addresses', { entityType: 'order', after: res });
    return { ok: true, ...res };
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
      // Tags. The client has always SENT these; this route used to ignore them, so every
      // tag a seller picked was silently dropped. Etsy's rules are strict and it rejects
      // the whole listing on a bad one, so sanitize rather than pass through: max 13, max
      // 20 chars each, letters/numbers/space/hyphen only (Etsy also allows a few accents,
      // but stripping is safer than a 400 that loses the draft).
      const tags = (Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(','))
        .map((t) => String(t).replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 20))
        .filter(Boolean);
      const uniqueTags = [...new Set(tags.map((t) => t.toLowerCase()))].slice(0, 13);
      if (uniqueTags.length) form.append('tags', uniqueTags.join(','));
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

      // ── Variants ─────────────────────────────────────────────────────────────
      // Publish OUR sku on every offering. This is what makes a variant round-trip: the
      // buyer's order line comes back carrying it, so we resolve the exact variant by sku
      // instead of matching the marketplace's display name — which the seller is free to
      // rename at any time, and which breaks silently when they do.
      //
      // Custom properties (513/514) rather than the taxonomy's Colour/Size ids: those are
      // per-category and 400 the whole request when the taxonomy doesn't carry them,
      // whereas custom properties work for any physical listing.
      const vColors = (Array.isArray(b.colors) ? b.colors : []).map(String).filter(Boolean);
      const vSizes = (Array.isArray(b.sizes) ? b.sizes : []).map(String).filter(Boolean);
      const skuBase = String(b.sku_base || b.sku || '').toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'EG';
      const variantSkus = [];
      let variants_applied = 0;
      let variants_error = null;
      if (vColors.length || vSizes.length) {
        const slug = (v) => String(v).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6);
        const products = [];
        for (const c of (vColors.length ? vColors : [null])) {
          for (const z of (vSizes.length ? vSizes : [null])) {
            const sku = [skuBase, c && slug(c), z && slug(z)].filter(Boolean).join('-');
            variantSkus.push(sku);
            const property_values = [];
            if (c) property_values.push({ property_id: 513, property_name: 'Color', values: [String(c).slice(0, 45)] });
            if (z) property_values.push({ property_id: 514, property_name: 'Size', values: [String(z).slice(0, 45)] });
            products.push({
              sku,
              property_values,
              offerings: [{ price, quantity: Number(b.quantity) || 999, is_enabled: true }],
            });
          }
        }
        try {
          await etsyFetch(conn, `/listings/${listingId}/inventory`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              products,
              // Price/quantity stay uniform across variants; only the sku varies, which is
              // all we need for resolution. Per-variant pricing can be layered on later.
              price_on_property: [], quantity_on_property: [],
              // The sku varies on whichever properties we actually sent.
              sku_on_property: [vColors.length ? 513 : null, vSizes.length ? 514 : null].filter((n) => n != null),
            }),
          });
          variants_applied = products.length;
        } catch (e) {
          // The draft still exists as a flat listing — better a listing without variants
          // than a failed publish, but say so rather than reporting success.
          variants_error = e && e.message ? String(e.message).slice(0, 300) : 'inventory update failed';
        }
      }

      return {
        ok: true, listing_id: listingId, state: listing.state || 'draft', images_uploaded: uploaded,
        tags_applied: uniqueTags.length,
        variants_applied, variant_skus: variantSkus, variants_error,
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
                  apiKeyMode: API_KEY_HEADER.indexOf(':') >= 0 ? 'keystring:shared_secret' : 'keystring-only' };
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
      const idChanged = String(shop.shop_id) !== String(conn.shop_id);
      const nameChanged = shop.shop_name && shop.shop_name !== conn.shop_name;
      if (idChanged || nameChanged) {
        await q('update platform_connections set shop_id=$1, shop_name=$2, updated_at=now() where id=$3',
          [String(shop.shop_id), shop.shop_name || conn.shop_name, conn.id]);
        conn.shop_id = String(shop.shop_id); conn.shop_name = shop.shop_name || conn.shop_name;
        out.repaired = { new_shop_id: conn.shop_id, shop_name: conn.shop_name, id_changed: idChanged, name_changed: nameChanged };
      }
      // The definitive test: can THIS token read the shop's receipts? 200 = owner/authorized;
      // "Could not find a shop for user…" / 403 = the connected Etsy account does NOT own this
      // shop (the wrong account authorized) → reconnect as the shop owner.
      try {
        const rc = await etsyGet(conn, `/shops/${conn.shop_id}/receipts?limit=1&includes=Transactions`);
        out.receipts_access = { ok: true, count: (rc.results || []).length };
      } catch (e) {
        out.receipts_access = { ok: false, error: e.message };
        if (/could not find a shop for user|not authorized|403/i.test(e.message || '')) {
          out.diagnosis = `The connected Etsy account (user ${userId}) does NOT own shop ${conn.shop_id} (${conn.shop_name}). ` +
            `Disconnect, log in to Etsy as the shop owner, then reconnect.`;
        }
      }
    }
    return out;
  });
}
