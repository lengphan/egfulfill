// Etsy integration — OAuth 2.0 (PKCE) connect + order/listing sync.
// Etsy v3 uses PKCE with the keystring as client_id; NO client secret is needed
// for the token exchange. Access tokens last ~1h and are refreshed automatically.
import { q } from '../db.js';

const KEYSTRING   = process.env.ETSY_KEYSTRING || '';
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
    headers: { 'x-api-key': KEYSTRING, Authorization: 'Bearer ' + token }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error || ('Etsy API ' + res.status)) + ' @ ' + path);
  return data;
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

  // Frontend reads this to build the Etsy authorize URL (keystring is public).
  app.get('/api/etsy/config', async () => ({
    keystring: KEYSTRING, redirect_uri: REDIRECT_URI, scopes: SCOPES,
    configured: !!KEYSTRING
  }));

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

  // Pull orders (receipts) + listings for one shop (or all if no shop_id) into our DB.
  app.post('/api/etsy/sync', { preHandler: requireStaff }, async (req, reply) => {
    const shopId = (req.body && req.body.shop_id) || null;
    const rows = (await q(
      shopId ? `select * from platform_connections where platform='etsy' and shop_id=$1`
             : `select * from platform_connections where platform='etsy'`,
      shopId ? [shopId] : []
    )).rows;
    if (!rows.length) { reply.code(400); return { error: 'No Etsy shop connected' }; }

    const summary = [];
    for (const conn of rows) {
      let orders = 0, listings = 0, sample = null;
      try {
        // ── Orders (receipts), paginated up to 500 ──
        for (let offset = 0; offset < 500; offset += 100) {
          const r = await etsyGet(conn, `/shops/${conn.shop_id}/receipts?limit=100&offset=${offset}&includes=Transactions`);
          const results = r.results || [];
          if (!sample && results[0]) sample = results[0];
          for (const rc of results) {
            const id = 'etsy-' + rc.receipt_id;
            const status = rc.is_shipped || rc.was_shipped ? 'shipped' : (rc.is_paid || rc.was_paid ? 'new' : 'new');
            await q(
              `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, tracking)
               values ($1,$2,$3,'etsy',$4,$5,$6,$7,$8,$9)
               on conflict (id) do update set status=excluded.status, total=excluded.total,
                 customer=excluded.customer, address=excluded.address, updated_at=now()`,
              [id, conn.connected_by, conn.shop_name,
               { name: rc.name, email: rc.buyer_email || null },
               { line1: rc.first_line, line2: rc.second_line, city: rc.city, state: rc.state,
                 zip: rc.zip, country: rc.country_iso, formatted: rc.formatted_address },
               status, status, money(rc.grandtotal), (rc.shipments && rc.shipments[0]?.tracking_code) || null]
            );
            await q('delete from order_items where order_id=$1', [id]);
            for (const tr of (rc.transactions || [])) {
              await q(
                `insert into order_items (order_id, sku, name, qty, variant, unit_price, img)
                 values ($1,$2,$3,$4,$5,$6,$7)`,
                [id, tr.sku || null, tr.title || null, tr.quantity || 1,
                 (tr.variations || []).map(v => v.formatted_value || v.value).join(', ') || null,
                 money(tr.price), (tr.product_data && tr.product_data.image_url) || null]
              );
            }
            orders++;
          }
          if (results.length < 100) break;
        }
        // ── Listings → catalog_products, paginated up to 500 ──
        for (let offset = 0; offset < 500; offset += 100) {
          const r = await etsyGet(conn, `/shops/${conn.shop_id}/listings?limit=100&offset=${offset}&includes=Images`);
          const results = r.results || [];
          for (const ls of results) {
            const img = (ls.images && ls.images[0] && (ls.images[0].url_fullxfull || ls.images[0].url_570xN)) || null;
            const product = {
              id: 'etsy-' + ls.listing_id, name: ls.title || 'Etsy listing',
              sku: (ls.skus && ls.skus[0]) || null, price: money(ls.price), basePrice: money(ls.price),
              status: ls.state === 'active' ? 'Active' : 'Inactive', source: 'etsy',
              img, mockup: img, type: ls.taxonomy_id ? String(ls.taxonomy_id) : null
            };
            await q(
              `insert into catalog_products (id, name, sku, status, base_price, price, img_path, mockup_path, data, updated_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
               on conflict (id) do update set name=excluded.name, sku=excluded.sku, status=excluded.status,
                 base_price=excluded.base_price, price=excluded.price, img_path=excluded.img_path,
                 mockup_path=excluded.mockup_path, data=excluded.data, updated_at=now()`,
              [product.id, product.name, product.sku, product.status, product.basePrice, product.price, img, img, product]
            );
            listings++;
          }
          if (results.length < 100) break;
        }
        await q('update platform_connections set last_sync_at=now() where id=$1', [conn.id]);
        summary.push({ shop: conn.shop_name, shop_id: conn.shop_id, orders, listings });
      } catch (e) {
        summary.push({ shop: conn.shop_name, shop_id: conn.shop_id, orders, listings, error: e.message,
                       sample_keys: sample ? Object.keys(sample) : null });
      }
    }
    return { ok: true, synced: summary };
  });
}
