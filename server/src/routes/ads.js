// ads.js — Meta (Facebook/Instagram) + Google Ads campaigns: read spend/results, and
// create campaigns from EGFUL.
//
// Reuses `platform_connections` (same table as Etsy/Shopify) with
// platform='meta_ads' | 'google_ads' and shop_id = the ad-account id, so tokens,
// refresh and the connect UI all follow the pattern already in the codebase.
//
// APPROVAL REALITY — these are gated by the providers, not by us:
//   Meta   : ads_read to LIST, ads_management to CREATE. Advanced Access needs
//            Business Verification + App Review.
//   Google : OAuth client + a DEVELOPER TOKEN from a Google Ads Manager (MCC)
//            account. Basic access is rate-limited until approved.
// Everything degrades to a clear "not configured" instead of a stack trace, so the
// UI can be honest about which half is switched on.
import { q } from '../db.js';

const META_APP_ID     = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_API        = 'https://graph.facebook.com/v21.0';

const GADS_CLIENT_ID     = process.env.GOOGLE_ADS_CLIENT_ID || '';
const GADS_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || '';
const GADS_DEV_TOKEN     = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
const GADS_LOGIN_CID     = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
const GADS_API           = 'https://googleads.googleapis.com/v18';

export const metaEnabled = () => !!(META_APP_ID && META_APP_SECRET);
export const googleEnabled = () => !!(GADS_CLIENT_ID && GADS_CLIENT_SECRET && GADS_DEV_TOKEN);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── connections ────────────────────────────────────────────────────────────
async function connections(platform) {
  const r = await q('select * from platform_connections where platform=$1 order by created_at', [platform]);
  return r.rows;
}
async function saveConnection({ platform, accountId, name, accessToken, refreshToken, expiresAt, scopes, userId }) {
  await q(
    `insert into platform_connections (platform, shop_id, shop_name, access_token, refresh_token, token_expires_at, scopes, connected_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (platform, shop_id) do update set
       shop_name=excluded.shop_name, access_token=excluded.access_token,
       refresh_token=coalesce(excluded.refresh_token, platform_connections.refresh_token),
       token_expires_at=excluded.token_expires_at, scopes=excluded.scopes, updated_at=now()`,
    [platform, String(accountId), name || null, accessToken || null, refreshToken || null, expiresAt || null, scopes || null, userId || null]
  );
}

// ── Meta ───────────────────────────────────────────────────────────────────
async function metaFetch(path, token, params = {}) {
  const u = new URL(META_API + path);
  u.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  const r = await fetch(u);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error((d.error && d.error.message) || `Meta API error ${r.status}`);
    e.status = r.status >= 400 && r.status < 500 ? r.status : 502;
    throw e;
  }
  return d;
}

// Campaigns + insights for one Meta ad account, folded into our shared shape.
async function metaCampaigns(conn, since, until) {
  const acct = String(conn.shop_id).startsWith('act_') ? conn.shop_id : `act_${conn.shop_id}`;
  const d = await metaFetch(`/${acct}/campaigns`, conn.access_token, {
    fields: `name,status,objective,daily_budget,lifetime_budget,insights.time_range({"since":"${since}","until":"${until}"}){spend,impressions,clicks,actions,action_values}`,
    limit: 100,
  });
  return (d.data || []).map((c) => {
    const ins = (c.insights && c.insights.data && c.insights.data[0]) || {};
    // Meta reports conversions in `actions`; purchase value in `action_values`.
    const purch = (ins.actions || []).find((a) => /purchase/i.test(a.action_type));
    const value = (ins.action_values || []).find((a) => /purchase/i.test(a.action_type));
    const spend = num(ins.spend);
    const revenue = num(value && value.value);
    return {
      channel: 'meta',
      account: conn.shop_name || acct,
      id: c.id,
      name: c.name,
      status: String(c.status || '').toLowerCase(),
      objective: c.objective || null,
      // Meta budgets are in minor units (cents).
      dailyBudget: c.daily_budget ? num(c.daily_budget) / 100 : null,
      spend,
      impressions: num(ins.impressions),
      clicks: num(ins.clicks),
      conversions: num(purch && purch.value),
      revenue,
      roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null,
    };
  });
}

// ── Google Ads ─────────────────────────────────────────────────────────────
// Access tokens last ~1h; the refresh token is long-lived.
async function googleToken(conn) {
  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (conn.access_token && exp > Date.now() + 60000) return conn.access_token;
  if (!conn.refresh_token) { const e = new Error('Google Ads connection has no refresh token — reconnect'); e.status = 400; throw e; }
  const body = new URLSearchParams({
    client_id: GADS_CLIENT_ID, client_secret: GADS_CLIENT_SECRET,
    refresh_token: conn.refresh_token, grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) { const e = new Error((d.error_description || d.error) || 'Google token refresh failed'); e.status = 502; throw e; }
  const expires = new Date(Date.now() + (num(d.expires_in) || 3600) * 1000);
  await q('update platform_connections set access_token=$1, token_expires_at=$2, updated_at=now() where id=$3', [d.access_token, expires, conn.id]);
  return d.access_token;
}

async function googleCampaigns(conn, since, until) {
  const token = await googleToken(conn);
  const cid = String(conn.shop_id).replace(/-/g, '');
  // GAQL. metrics.cost_micros is micros (1e6); conversions_value is account currency.
  const query = `
    SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros,
           metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const headers = {
    'authorization': 'Bearer ' + token,
    'developer-token': GADS_DEV_TOKEN,
    'content-type': 'application/json',
  };
  if (GADS_LOGIN_CID) headers['login-customer-id'] = GADS_LOGIN_CID;
  const r = await fetch(`${GADS_API}/customers/${cid}/googleAds:searchStream`, {
    method: 'POST', headers, body: JSON.stringify({ query }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (Array.isArray(d) ? d[0] : d);
    const e = new Error((msg && msg.error && msg.error.message) || `Google Ads error ${r.status}`);
    e.status = r.status >= 400 && r.status < 500 ? r.status : 502;
    throw e;
  }
  // searchStream returns an ARRAY of chunks, each { results: [...] }.
  const rows = (Array.isArray(d) ? d : [d]).flatMap((chunk) => chunk.results || []);
  return rows.map((row) => {
    const m = row.metrics || {};
    const spend = num(m.costMicros) / 1e6;
    const revenue = num(m.conversionsValue);
    return {
      channel: 'google',
      account: conn.shop_name || cid,
      id: String(row.campaign && row.campaign.id),
      name: (row.campaign && row.campaign.name) || '',
      status: String((row.campaign && row.campaign.status) || '').toLowerCase(),
      objective: null,
      dailyBudget: row.campaignBudget ? num(row.campaignBudget.amountMicros) / 1e6 : null,
      spend,
      impressions: num(m.impressions),
      clicks: num(m.clicks),
      conversions: num(m.conversions),
      revenue,
      roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null,
    };
  });
}

const ymd = (d) => d.toISOString().slice(0, 10);

// ADMIN-only. These routes don't just REPORT ad spend, they create and pause campaigns —
// i.e. they move money. That sat behind requireAdmin, which includes warehouse, operator
// and designer. The nav already hid the page (roles: [] in staff-nav), but hiding a menu
// item is not a permission: the endpoint was callable by any staff account.
export function adsRoutes(app, requireAdmin) {
  // What's switched on + where to send the OAuth flow. Public config only — never
  // the secrets.
  app.get('/api/ads/config', { preHandler: requireAdmin }, async () => ({
    meta: { enabled: metaEnabled(), appId: META_APP_ID || null, scopes: 'ads_read,ads_management,business_management' },
    google: { enabled: googleEnabled(), clientId: GADS_CLIENT_ID || null, scopes: 'https://www.googleapis.com/auth/adwords' },
  }));

  app.get('/api/ads/connections', { preHandler: requireAdmin }, async () => {
    const r = await q(`select id, platform, shop_id as account_id, shop_name, created_at, updated_at
                         from platform_connections where platform in ('meta_ads','google_ads') order by created_at`);
    return r.rows;
  });

  app.delete('/api/ads/connections/:id', { preHandler: requireAdmin }, async (req) => {
    await q(`delete from platform_connections where id=$1 and platform in ('meta_ads','google_ads')`, [req.params.id]);
    return { ok: true };
  });

  // ── Meta connect: exchange the short-lived code for a long-lived token, then
  //    store one connection PER ad account the user can see.
  app.post('/api/ads/meta/exchange', { preHandler: requireAdmin }, async (req, reply) => {
    if (!metaEnabled()) { reply.code(400); return { error: 'Meta is not configured — add META_APP_ID / META_APP_SECRET in Settings › Integrations.' }; }
    const { code, redirectUri } = req.body || {};
    if (!code || !redirectUri) { reply.code(400); return { error: 'Missing code or redirectUri' }; }
    try {
      // The token exchange takes no access_token, so it can't go through metaFetch.
      const u = new URL(META_API + '/oauth/access_token');
      u.searchParams.set('client_id', META_APP_ID);
      u.searchParams.set('client_secret', META_APP_SECRET);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('code', code);
      const tr = await fetch(u);
      const t = await tr.json().catch(() => ({}));
      if (!tr.ok) { reply.code(502); return { error: (t.error && t.error.message) || 'Meta token exchange failed' }; }
      const short = t.access_token;
      if (!short) { reply.code(502); return { error: 'Meta returned no access token' }; }
      // Upgrade to a ~60-day token; the short one expires in ~1h.
      const long = await metaFetch('/oauth/access_token', short, {
        grant_type: 'fb_exchange_token', client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: short,
      }).catch(() => ({}));
      const token = long.access_token || short;
      const expiresAt = long.expires_in ? new Date(Date.now() + num(long.expires_in) * 1000) : null;

      const accts = await metaFetch('/me/adaccounts', token, { fields: 'name,account_id,currency', limit: 50 });
      const list = accts.data || [];
      if (!list.length) { reply.code(400); return { error: 'No ad accounts found on this Meta login' }; }
      for (const a of list) {
        await saveConnection({
          platform: 'meta_ads', accountId: a.id || `act_${a.account_id}`, name: a.name,
          accessToken: token, expiresAt, scopes: 'ads_read,ads_management', userId: req.user.sub,
        });
      }
      return { ok: true, accounts: list.map((a) => ({ id: a.id, name: a.name })) };
    } catch (e) { reply.code(e.status || 502); return { error: e.message }; }
  });

  // ── Google connect
  app.post('/api/ads/google/exchange', { preHandler: requireAdmin }, async (req, reply) => {
    if (!googleEnabled()) { reply.code(400); return { error: 'Google Ads is not configured — needs client id/secret and a developer token.' }; }
    const { code, redirectUri } = req.body || {};
    if (!code || !redirectUri) { reply.code(400); return { error: 'Missing code or redirectUri' }; }
    try {
      const body = new URLSearchParams({
        code, client_id: GADS_CLIENT_ID, client_secret: GADS_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      });
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.access_token) { reply.code(502); return { error: (d.error_description || d.error) || 'Google token exchange failed' }; }
      if (!d.refresh_token) {
        // Without prompt=consent+access_type=offline Google omits it on re-auth, and
        // the connection would die in an hour with no way to refresh.
        reply.code(400);
        return { error: 'Google returned no refresh token — reconnect with prompt=consent and access_type=offline.' };
      }
      const expires = new Date(Date.now() + (num(d.expires_in) || 3600) * 1000);
      const heads = { 'authorization': 'Bearer ' + d.access_token, 'developer-token': GADS_DEV_TOKEN };
      if (GADS_LOGIN_CID) heads['login-customer-id'] = GADS_LOGIN_CID;
      const lr = await fetch(`${GADS_API}/customers:listAccessibleCustomers`, { headers: heads });
      const ld = await lr.json().catch(() => ({}));
      if (!lr.ok) { reply.code(502); return { error: (ld.error && ld.error.message) || 'Could not list Google Ads accounts' }; }
      const names = ld.resourceNames || [];
      if (!names.length) { reply.code(400); return { error: 'No Google Ads accounts on this login' }; }
      for (const rn of names) {
        const cid = String(rn).split('/').pop();
        await saveConnection({
          platform: 'google_ads', accountId: cid, name: `Google Ads ${cid}`,
          accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: expires,
          scopes: 'adwords', userId: req.user.sub,
        });
      }
      return { ok: true, accounts: names.map((n) => String(n).split('/').pop()) };
    } catch (e) { reply.code(e.status || 502); return { error: e.message }; }
  });

  // ── The dashboard: every campaign across both channels, plus totals.
  app.get('/api/ads/campaigns', { preHandler: requireAdmin }, async (req) => {
    const days = Math.min(90, Math.max(1, Number(req.query?.days) || 7));
    const until = ymd(new Date());
    const since = ymd(new Date(Date.now() - (days - 1) * 86400000));

    const out = [];
    const errors = [];
    // One channel failing must not blank the other — report both.
    for (const conn of await connections('meta_ads')) {
      try { out.push(...await metaCampaigns(conn, since, until)); }
      catch (e) { errors.push({ channel: 'meta', account: conn.shop_name || conn.shop_id, error: e.message }); }
    }
    for (const conn of await connections('google_ads')) {
      try { out.push(...await googleCampaigns(conn, since, until)); }
      catch (e) { errors.push({ channel: 'google', account: conn.shop_name || conn.shop_id, error: e.message }); }
    }
    out.sort((a, b) => b.spend - a.spend);
    const totals = out.reduce((t, c) => ({
      spend: t.spend + c.spend, impressions: t.impressions + c.impressions,
      clicks: t.clicks + c.clicks, conversions: t.conversions + c.conversions, revenue: t.revenue + c.revenue,
    }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 });
    totals.roas = totals.spend > 0 ? Math.round((totals.revenue / totals.spend) * 100) / 100 : null;
    totals.spend = Math.round(totals.spend * 100) / 100;
    totals.revenue = Math.round(totals.revenue * 100) / 100;
    return { days, since, until, campaigns: out, totals, errors };
  });

  // ── Create a campaign.
  //
  // Deliberately creates it PAUSED. A campaign that goes live the instant you click
  // is a great way to spend real money on a typo; you review it in Ads Manager (or
  // hit Resume here) once it looks right.
  //
  // Scope note: this creates the CAMPAIGN shell (name, objective, budget). Ad sets,
  // targeting and creatives are a much larger surface and still live in Meta/Google's
  // own tools — building a full ad composer here would be a product of its own.
  app.post('/api/ads/campaigns', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    const channel = String(b.channel || '').toLowerCase();
    const name = String(b.name || '').trim();
    const daily = Number(b.dailyBudget);
    if (!name) { reply.code(400); return { error: 'Campaign name is required' }; }
    if (!(daily > 0)) { reply.code(400); return { error: 'Daily budget must be greater than 0' }; }

    try {
      if (channel === 'meta') {
        if (!metaEnabled()) { reply.code(400); return { error: 'Meta is not configured' }; }
        const conn = (await connections('meta_ads')).find((c) => !b.accountId || String(c.shop_id) === String(b.accountId)) || (await connections('meta_ads'))[0];
        if (!conn) { reply.code(400); return { error: 'No Meta ad account connected' }; }
        const acct = String(conn.shop_id).startsWith('act_') ? conn.shop_id : `act_${conn.shop_id}`;
        const u = new URL(`${META_API}/${acct}/campaigns`);
        u.searchParams.set('access_token', conn.access_token);
        const r = await fetch(u, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name,
            objective: b.objective || 'OUTCOME_SALES',
            status: 'PAUSED',
            special_ad_categories: [],
            daily_budget: Math.round(daily * 100),   // Meta takes minor units
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { reply.code(502); return { error: (d.error && d.error.message) || 'Meta could not create the campaign' }; }
        return { ok: true, id: d.id, channel: 'meta', status: 'paused' };
      }

      if (channel === 'google') {
        if (!googleEnabled()) { reply.code(400); return { error: 'Google Ads is not configured' }; }
        const conn = (await connections('google_ads')).find((c) => !b.accountId || String(c.shop_id) === String(b.accountId)) || (await connections('google_ads'))[0];
        if (!conn) { reply.code(400); return { error: 'No Google Ads account connected' }; }
        const token = await googleToken(conn);
        const cid = String(conn.shop_id).replace(/-/g, '');
        const headers = { 'authorization': 'Bearer ' + token, 'developer-token': GADS_DEV_TOKEN, 'content-type': 'application/json' };
        if (GADS_LOGIN_CID) headers['login-customer-id'] = GADS_LOGIN_CID;

        // Google needs the budget as its own resource first, then the campaign
        // references it — there's no single-call create.
        const br = await fetch(`${GADS_API}/customers/${cid}/campaignBudgets:mutate`, {
          method: 'POST', headers,
          body: JSON.stringify({ operations: [{ create: { name: `${name} budget ${Date.now()}`, amountMicros: String(Math.round(daily * 1e6)), deliveryMethod: 'STANDARD' } }] }),
        });
        const bd = await br.json().catch(() => ({}));
        if (!br.ok) { reply.code(502); return { error: (bd.error && bd.error.message) || 'Google could not create the budget' }; }
        const budgetRes = bd.results && bd.results[0] && bd.results[0].resourceName;
        if (!budgetRes) { reply.code(502); return { error: 'Google returned no budget resource' }; }

        const cr = await fetch(`${GADS_API}/customers/${cid}/campaigns:mutate`, {
          method: 'POST', headers,
          body: JSON.stringify({ operations: [{ create: {
            name, status: 'PAUSED', campaignBudget: budgetRes,
            advertisingChannelType: b.channelType || 'SEARCH',
            manualCpc: {},
          } }] }),
        });
        const cd = await cr.json().catch(() => ({}));
        if (!cr.ok) { reply.code(502); return { error: (cd.error && cd.error.message) || 'Google could not create the campaign' }; }
        const res = cd.results && cd.results[0] && cd.results[0].resourceName;
        return { ok: true, id: res ? String(res).split('/').pop() : null, channel: 'google', status: 'paused' };
      }

      reply.code(400); return { error: 'channel must be meta or google' };
    } catch (e) { reply.code(e.status || 502); return { error: e.message }; }
  });

  // Pause / resume — the safest write, and the one you actually need mid-flight.
  app.post('/api/ads/campaigns/:channel/:id/status', { preHandler: requireAdmin }, async (req, reply) => {
    const { channel, id } = req.params;
    const want = String((req.body && req.body.status) || '').toUpperCase();
    if (!['ACTIVE', 'PAUSED'].includes(want)) { reply.code(400); return { error: 'status must be ACTIVE or PAUSED' }; }
    try {
      if (channel === 'meta') {
        const conn = (await connections('meta_ads'))[0];
        if (!conn) { reply.code(400); return { error: 'No Meta ad account connected' }; }
        const u = new URL(`${META_API}/${id}`);
        u.searchParams.set('access_token', conn.access_token);
        const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: want }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { reply.code(502); return { error: (d.error && d.error.message) || 'Meta update failed' }; }
        return { ok: true };
      }
      if (channel === 'google') {
        const conn = (await connections('google_ads'))[0];
        if (!conn) { reply.code(400); return { error: 'No Google Ads account connected' }; }
        const token = await googleToken(conn);
        const cid = String(conn.shop_id).replace(/-/g, '');
        const headers = { 'authorization': 'Bearer ' + token, 'developer-token': GADS_DEV_TOKEN, 'content-type': 'application/json' };
        if (GADS_LOGIN_CID) headers['login-customer-id'] = GADS_LOGIN_CID;
        const r = await fetch(`${GADS_API}/customers/${cid}/campaigns:mutate`, {
          method: 'POST', headers,
          body: JSON.stringify({ operations: [{ update: { resourceName: `customers/${cid}/campaigns/${id}`, status: want }, updateMask: 'status' }] }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { reply.code(502); return { error: (d.error && d.error.message) || 'Google update failed' }; }
        return { ok: true };
      }
      reply.code(400); return { error: 'Unknown channel' };
    } catch (e) { reply.code(e.status || 502); return { error: e.message }; }
  });
}
