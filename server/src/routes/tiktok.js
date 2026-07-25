// TikTok Shop integration — OAuth connect (mirrors the Etsy flow).
// A SELLER connects their OWN TikTok shop; an ADMIN/staff connects the factory shop.
// Auth model differs from Etsy: no PKCE. The app has a service_id; the seller
// authorizes at services.tiktokshop.com (US: services.us.tiktokshop.com), TikTok redirects
// back to the callback registered in Partner Center as ?auth_code=<code>&state=… (NO app_key),
// and we exchange the code at auth.tiktok-shops.com (app_key + app_secret required, NO signature).
import { q } from '../db.js';

const APP_KEY    = process.env.TIKTOK_APP_KEY || '';
const APP_SECRET = process.env.TIKTOK_APP_SECRET || '';
const SERVICE_ID = process.env.TIKTOK_SERVICE_ID || '';
// Auth host is stable across regions; the authorize page is services.tiktokshop.com.
const AUTH_HOST     = (process.env.TIKTOK_AUTH_HOST || 'https://auth.tiktok-shops.com').replace(/\/+$/, '');
const AUTHORIZE_URL = process.env.TIKTOK_AUTHORIZE_URL || 'https://services.tiktokshop.com/open/authorize';

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

export function tiktokRoutes(app, requireAuth, requireStaff) {
  // Reuse the platform_connections table (created by etsy.js). Create it here too so
  // TikTok works even on a DB that never loaded the Etsy route first (idempotent).
  q(`create table if not exists platform_connections (
       id uuid primary key default gen_random_uuid(),
       platform text not null default 'etsy', shop_id text not null, shop_name text,
       access_token text, refresh_token text, token_expires_at timestamptz, scopes text,
       last_sync_at timestamptz, connected_by uuid references users(id) on delete set null,
       created_at timestamptz default now(), updated_at timestamptz default now(),
       unique (platform, shop_id))`).catch(() => {});

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
