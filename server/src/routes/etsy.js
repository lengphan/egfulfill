// Etsy integration — OAuth 2.0 (PKCE) connect + order/listing sync.
// Etsy v3 uses PKCE with the keystring as client_id; NO client secret is needed
// for the token exchange. Access tokens last ~1h and are refreshed automatically.
import { q } from '../db.js';

const KEYSTRING   = process.env.ETSY_KEYSTRING || '';
// Etsy's x-api-key header for API data calls must be "keystring:shared_secret"
// (the shared secret is NOT needed for the PKCE token exchange, only here).
const SHARED_SECRET = process.env.ETSY_SHARED_SECRET || '';
const API_KEY_HEADER = SHARED_SECRET ? (KEYSTRING + ':' + SHARED_SECRET) : KEYSTRING;
const REDIRECT_URI = process.env.ETSY_REDIRECT_URI || 'https://egful.store/oauth-callback.html';
const SCOPES = 'transactions_r transactions_w listings_r listings_w';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const API = 'https://api.etsy.com/v3/application';

// ── helpers ────────────────────────────────────────────────────────────────
function money(m) { return m && m.divisor ? (m.amount / m.divisor) : 0; }

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

// Authenticated GET against the Etsy API.
async function etsyGet(conn, path) {
  const token = await validToken(conn);
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
  const headers = Object.assign({ 'x-api-key': API_KEY_HEADER, Authorization: 'Bearer ' + token }, opts.headers || {});
  const res = await fetch(API + path, { method: opts.method || 'GET', headers, body: opts.body });
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

// Upsert one Etsy receipt into orders. Returns 'imported' or 'skipped'.
// Re-syncs never overwrite the internal pipeline (status/factory_status) or items.
async function importReceipt(conn, rc, connectedSec, imgCache) {
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
  await q(
    `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, tracking, created_at, factory_order)
     values ($1,$2,$3,'etsy',$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now()), true)
     on conflict (id) do update set total=excluded.total,
       customer=excluded.customer, address=excluded.address,
       created_at=coalesce($10::timestamptz, orders.created_at), updated_at=now()`,
    [id, conn.connected_by, conn.shop_name,
     { name: rc.name, email: rc.buyer_email || null },
     { line1: rc.first_line, line2: rc.second_line, city: rc.city, state: rc.state,
       zip: rc.zip, country: rc.country_iso, formatted: rc.formatted_address },
     status, status, money(rc.grandtotal), (rc.shipments && rc.shipments[0]?.tracking_code) || null, createdIso]
  );
  const hasItems = await q('select 1 from order_items where order_id=$1 limit 1', [id]);
  // Pre-load existing items so re-syncs DON'T refetch listing images (Etsy rate limit:
  // 10/sec, 10k/day). We only call the image API for items that have no image yet.
  const existing = {};
  if (hasItems.rowCount) {
    const ex = await q('select sku, img, design_src, personalization from order_items where order_id=$1', [id]);
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
    const exItem = existing[String(tr.sku || '')];
    if (!hasItems.rowCount) {
      const img = await listingImage(conn, tr.listing_id, tr.listing_image_id, imgCache);   // first import → fetch once
      await q(
        `insert into order_items (order_id, sku, name, qty, variant, unit_price, img, design_src, personalization)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, tr.sku || null, tr.title || null, tr.quantity || 1, variant, money(tr.price), img, uploadUrl, personalization]
      );
    } else if (exItem) {
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
        if ((await importReceipt(conn, rc, connectedSec, imgCache)) === 'skipped') skipped++; else orders++;
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
  const rows = (await q(
    opts.shopId ? `select * from platform_connections where platform='etsy' and shop_id=$1`
                : `select * from platform_connections where platform='etsy'`,
    opts.shopId ? [opts.shopId] : [])).rows;
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
  // factory_order: orders synced from the ADMIN/factory connection belong to the
  // factory boards, not to sellers. Sellers' GET excludes these (see orders.js).
  q('alter table orders add column if not exists factory_order boolean not null default false').catch(() => {});
  // Backfill: real Etsy imports (etsy- id) are factory orders. Keyed on the id, not
  // source, so a seller's manual order tagged with a marketplace source isn't caught.
  q(`update orders set factory_order=true where id like 'etsy-%' and factory_order=false`).catch(() => {});

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

  // Lightweight connection check for ANY logged-in user (sellers publish to the
  // shop connected on the admin side). No tokens leaked — just names.
  app.get('/api/etsy/connected', { preHandler: requireAuth }, async () => {
    const r = await q(`select shop_name from platform_connections where platform='etsy' order by created_at`);
    return { connected: r.rowCount > 0, shops: r.rows.map(x => x.shop_name).filter(Boolean) };
  });

  // List connected shops (no tokens leaked).
  app.get('/api/etsy/connections', { preHandler: requireStaff }, async () => {
    const r = await q(`select id, platform, shop_id, shop_name, scopes, last_sync_at, created_at
                       from platform_connections where platform='etsy' order by created_at`);
    return r.rows;
  });

  // OAuth code → tokens. Called by oauth-callback.html after Etsy redirects back.
  app.post('/api/etsy/exchange', { preHandler: requireStaff }, async (req, reply) => {
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

  app.delete('/api/etsy/connections/:shop_id', { preHandler: requireStaff }, async (req) => {
    await q(`delete from platform_connections where platform='etsy' and shop_id=$1`, [req.params.shop_id]);
    return { ok: true };
  });

  // Pull orders (receipts) into our DB. Incremental by default (only what changed
  // since the last sync); pass { full: true } in the body to force a complete pull.
  app.post('/api/etsy/sync', { preHandler: requireStaff }, async (req, reply) => {
    if (!SHARED_SECRET) { reply.code(400); return { error: 'Server is missing ETSY_SHARED_SECRET. Add it to the server .env and redeploy.' }; }
    const has = await q(`select 1 from platform_connections where platform='etsy' limit 1`);
    if (!has.rowCount) { reply.code(400); return { error: 'No Etsy shop connected' }; }
    // One-time cleanup: purge any Etsy listings a previous version imported into
    // the base-product catalog (they don't belong there).
    const purged = await q(`delete from catalog_products where id like 'etsy-%'`);
    const res = await syncAllEtsy({ full: !!(req.body && req.body.full), shopId: (req.body && req.body.shop_id) || null });
    return { ...res, catalog_listings_purged: purged.rowCount || 0 };
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

      // Shipping profile lives on ETSY (Shop Manager → Settings → Shipping), not on
      // our platform. Optional for a DRAFT — include it if the shop has one, else
      // create the draft without it and let the seller set shipping on Etsy before
      // going live. (Caller may also pass shipping_profile_id explicitly.)
      let shipId = (b.shipping_profile_id != null) ? String(b.shipping_profile_id) : null;
      if (!shipId) {
        try {
          const sp = await etsyFetch(conn, `/shops/${conn.shop_id}/shipping-profiles`);
          shipId = sp.results && sp.results[0] && sp.results[0].shipping_profile_id;
        } catch (e) { /* no scope / none yet — proceed without it for the draft */ }
      }

      // Taxonomy/category: use the one passed in, else borrow from an existing listing.
      let taxId = b.taxonomy_id;
      if (!taxId) {
        try {
          const al = await etsyFetch(conn, `/shops/${conn.shop_id}/listings?state=active&limit=1`);
          taxId = al.results && al.results[0] && al.results[0].taxonomy_id;
        } catch (e) {}
      }
      if (!taxId) { reply.code(400); return { error: 'No category (taxonomy_id) available — pass one, or publish one listing manually on Etsy first so we can reuse its category.' }; }

      // Create the DRAFT listing.
      const form = new URLSearchParams({
        quantity: String(b.quantity || 999),
        title: title.slice(0, 140),
        description: String(b.description || title),
        price: String(price),
        who_made: 'i_did', when_made: 'made_to_order', type: 'physical', state: 'draft',
        taxonomy_id: String(taxId)
      });
      if (shipId) form.append('shipping_profile_id', String(shipId));
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
}
