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
const SCOPES      = process.env.SHOPIFY_SCOPES || 'read_orders,write_orders,read_products';
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

export function shopifyRoutes(app, requireAuth, requireStaff) {
  // Shared connections table (created by etsy.js too) — idempotent.
  q(`create table if not exists platform_connections (
       id uuid primary key default gen_random_uuid(),
       platform text not null default 'etsy', shop_id text not null, shop_name text,
       access_token text, refresh_token text, token_expires_at timestamptz, scopes text,
       last_sync_at timestamptz, connected_by uuid references users(id) on delete set null,
       created_at timestamptz default now(), updated_at timestamptz default now(),
       unique (platform, shop_id))`).catch(() => {});

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
        `insert into platform_connections (platform, shop_id, shop_name, access_token, refresh_token, token_expires_at, scopes, connected_by)
         values ('shopify',$1,$2,$3,null,null,$4,$5)
         on conflict (platform, shop_id) do update set
           shop_name=excluded.shop_name, access_token=excluded.access_token,
           scopes=excluded.scopes, connected_by=excluded.connected_by, updated_at=now()`,
        [shop, shopName, t.access_token, t.scope || SCOPES, req.user.sub]
      );
      return { ok: true, shop_id: shop, shop_name: shopName, scopes: t.scope || SCOPES };
    } catch (e) {
      reply.code(400); return { error: e.message };
    }
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
