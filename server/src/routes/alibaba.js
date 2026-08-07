// Alibaba.com Open Platform — BUYER APIs (sourcing), not seller.
// -----------------------------------------------------------------------------
// Gateway: the "eco" / IOP gateway (the same family Lazada and AliExpress use — the docs'
// Java sample constructs an `IopClient`). Two things about it are easy to get wrong and are
// pinned here from the documented CURL sample rather than from memory:
//
//   1. THE COMMON PARAMS GO IN THE QUERY STRING, alongside the business params:
//        app_key, timestamp, access_token, sign_method, sign
//      The docs' curl sample sends them as HEADERS. It does not work — the live gateway
//      answers MissingParameter for app_key, i.e. it never reads the headers at all.
//   2. `timestamp` is MILLISECONDS since epoch, and `sign` is UPPERCASE hex HMAC-SHA256.
//
// Documented sample this was written against:
//   curl -X GET url + '/eco/buyer/product/search?param0=001' --http1.1 \
//     -H 'app_key=12345678' -H 'timestamp=1785826176980' \
//     -H 'access_token=37c6...dbd0' -H 'sign_method=sha256' \
//     -H 'sign=D13F2A03BE94D9AAE9F933FFA7B13E0A5AD84A3DAEBC62A458A3C382EC2E91EC'
//
// ✅ THE SIGNATURE IS VERIFIED (2026-08-06, app 503552). API path + every param as
// key+value sorted by key, HMAC-SHA256 with the app secret, uppercase hex. Proven by the
// error CHANGING from MissingParameter to InsufficientPermission: the gateway only reports
// a permission problem once it has read the key and accepted the signature.
//
// REMAINING BLOCKER IS PERMISSION, NOT CODE. The app must be granted access to each API in
// the Alibaba console (App Console → Apply process), and App Status must leave "Test".
//
// AUTH IS OAUTH, NOT A STATIC KEY. /auth/token/create exchanges a `code` (obtained by a
// human authorising in a browser) for an access_token + refresh_token. So this behaves like
// the Etsy/Shopify/TikTok connects, not like SanMar's username+password.
import crypto from 'node:crypto';
import { q } from '../db.js';
import { recordUsage } from '../usage.js';

// Host is configurable because the docs render it as a literal "url +" placeholder; this is
// the documented IOP gateway host, overridable without a code change if it differs per app.
const DEFAULT_BASE = 'https://openapi-api.alibaba.com/rest';

// Registered as the app's Callback URL on the Alibaba console. Changing it means changing
// it THERE too — same category as the Etsy/Shopify redirect URIs (see CLAUDE.md §3).
const ALIBABA_REDIRECT_URI = (process.env.ALIBABA_REDIRECT_URI
  || 'https://app.egful.store/oauth-callback').trim();

// Read at CALL time, never at module load, so a key saved in Settings applies without a
// restart — the same rule the other integrations follow.
function cfg() {
  return {
    key: (process.env.ALIBABA_APP_KEY || '').trim(),
    secret: (process.env.ALIBABA_APP_SECRET || '').trim(),
    base: (process.env.ALIBABA_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, ''),
  };
}
const alibabaConfigured = () => { const c = cfg(); return !!(c.key && c.secret); };

/**
 * IOP signature.
 *
 * base string = apiPath + for each param sorted by key: key immediately followed by value
 * sign        = HMAC-SHA256(base, appSecret), hex, UPPERCASE
 *
 * Every param is included — the common ones (app_key, timestamp, sign_method, access_token)
 * as well as the business ones — even though the common ones travel as headers. Leaving the
 * headers out of the base is the classic way to get a signature that looks right and is
 * rejected.
 */
function sign(apiPath, params, secret) {
  const base = apiPath + Object.keys(params).sort()
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => k + params[k])
    .join('');
  return crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex').toUpperCase();
}

/**
 * One signed call. Business params go in the query string, common params in headers.
 * `accessToken` is omitted for the token-exchange call itself, which has none yet.
 */
async function call(apiPath, businessParams = {}, { accessToken, method = 'GET' } = {}) {
  const c = cfg();
  if (!c.key || !c.secret) throw new Error('Alibaba is not configured (ALIBABA_APP_KEY / ALIBABA_APP_SECRET).');

  const common = {
    app_key: c.key,
    timestamp: String(Date.now()),      // milliseconds, per the documented sample
    sign_method: 'sha256',
    ...(accessToken ? { access_token: accessToken } : {}),
  };
  const signature = sign(apiPath, { ...common, ...businessParams }, c.secret);

  // EVERYTHING IN THE QUERY STRING — common params included.
  //
  // This was written from the docs' curl sample, which sends app_key/timestamp/sign as
  // HEADERS. Against the live gateway that returns:
  //   MissingParameter — "the input parameter app_key ... is not supplied"
  // i.e. the headers are ignored outright. Moving the common params into the query string
  // changed the reply to InsufficientPermission, which is the gateway telling us it read
  // the key AND accepted the signature. Verified against the live account 2026-08-06.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...common, ...businessParams, sign: signature })) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${c.base}${apiPath}?${qs.toString()}`;

  let r, text;
  try {
    r = await fetch(url, { method, signal: AbortSignal.timeout(20000) });
    text = await r.text();
  } catch (e) {
    recordUsage('alibaba', { endpoint: apiPath, ok: false });
    throw new Error(`Couldn't reach Alibaba (${String(e && e.message || e)}).`);
  }
  recordUsage('alibaba', { endpoint: apiPath, ok: r.ok });

  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 800) }; }
  if (!r.ok) {
    const e = new Error(`Alibaba HTTP ${r.status}`);
    e.status = r.status; e.body = body; throw e;
  }
  /**
   * The gateway answers 200 with an error payload for auth and signature problems, so a 200
   * is not success on its own. But `code` is not one vocabulary across their endpoints:
   *
   *   /auth/token/create  success -> code "0"
   *   REST gateway        success -> no `code` at all; errors carry a STRING like
   *                                  "InsufficientPermission" plus type "ISV"
   *
   * Treating only "200" as success rejected a token exchange that had actually worked and
   * reported it as `Alibaba: 0` — an error message consisting of the success code. The code
   * was spent, so the only recovery was to authorise again.
   */
  const codeStr = String((body && body.code) ?? '');
  const codeOk = codeStr === '' || codeStr === '0' || codeStr === '200';
  const err = body && (body.error_code || !codeOk)
    ? (body.error_message || body.message || body.error_code || body.code) : null;
  if (err && !body.result) { const e = new Error(`Alibaba: ${err}`); e.body = body; throw e; }
  return body;
}

export function alibabaRoutes(app, requireAdmin) {
  // Where a connected account's tokens live. One row: this is OUR buying account, not a
  // per-seller connection — sourcing is a company-level decision, not a seller-level one.
  q(`create table if not exists alibaba_auth (
       id integer primary key default 1,
       access_token text,
       refresh_token text,
       account text,
       expires_at timestamptz,
       refresh_expires_at timestamptz,
       updated_at timestamptz default now()
     )`).catch(() => {});

  const tokenRow = async () => {
    const r = await q('select * from alibaba_auth where id=1').catch(() => ({ rows: [] }));
    return r.rows[0] || null;
  };

  // Config check — no network call, so it answers even when the app is still in review.
  app.get('/api/alibaba/config', { preHandler: requireAdmin }, async () => {
    const c = cfg();
    const row = await tokenRow();
    return {
      configured: alibabaConfigured(),
      base: c.base,
      connected: !!(row && row.access_token),
      account: row?.account || null,
      expiresAt: row?.expires_at || null,
      /**
       * Where a human goes to authorise. Built HERE, not in the browser, because it needs
       * the app key and the key belongs on the server.
       *
       * `sp=ICBU` selects Alibaba.com International — the same gateway family also serves
       * Taobao and AliExpress, and without it the consent screen can authorise against the
       * wrong marketplace, which fails later at the token exchange rather than here.
       * The redirect_uri must match the Callback URL registered on the app exactly.
       */
      // openapi-AUTH, matching the openapi-API gateway. `oauth.alibaba.com` is a DIFFERENT
      // platform and answers `param-appkey.not.exists` for a key that is perfectly valid
      // here — an error that reads like a bad key and is actually a bad host.
      authorizeUrl: alibabaConfigured()
        ? 'https://openapi-auth.alibaba.com/oauth/authorize?' + new URLSearchParams({
            response_type: 'code',
            client_id: c.key,
            redirect_uri: ALIBABA_REDIRECT_URI,
            sp: 'ICBU',
            view: 'web',
            // REQUIRED here, unlike most OAuth providers where it's an optional CSRF nonce.
            // Omitting it gets you past the consent screen and then "Missing parameter"
            // AFTER login, which reads like a broken app rather than a missing field.
            // Random per call so it also does the job it exists for.
            state: crypto.randomBytes(8).toString('hex'),
          }).toString()
        : null,
      redirectUri: ALIBABA_REDIRECT_URI,
    };
  });

  /**
   * Connectivity + signature test. This is the point of the whole file until the app is
   * approved: it makes ONE signed call and hands back Alibaba's own response verbatim, so a
   * signature mismatch is readable rather than mysterious. Mirrors the SanMar test button.
   */
  app.get('/api/alibaba/test', { preHandler: requireAdmin }, async (req, reply) => {
    if (!alibabaConfigured()) {
      reply.code(400);
      return { error: 'Alibaba is not configured — add ALIBABA_APP_KEY and ALIBABA_APP_SECRET.' };
    }
    const row = await tokenRow();
    if (!row?.access_token) {
      reply.code(400);
      return { error: 'No access token yet — connect the Alibaba account first (OAuth).', configured: true };
    }
    try {
      const keyword = String(req.query?.keyword || 'blank cotton tote bag');
      const body = await call('/eco/buyer/product/search',
        { param0: JSON.stringify({ keyword, page: 1, pageSize: 5 }) },
        { accessToken: row.access_token });
      const products = body?.result?.data?.products;
      return {
        ok: true,
        signatureAccepted: true,
        returned: Array.isArray(products) ? products.length : 0,
        pagination: body?.result?.data?.pagination || null,
        sample: Array.isArray(products) ? products.slice(0, 2) : null,
      };
    } catch (e) {
      reply.code(400);
      // The raw body is the whole value here — Alibaba names the failing param on a
      // signature error, which is what tells us how to correct the base string.
      return { error: String(e && e.message || e), detail: e?.body || null };
    }
  });

  /**
   * Exchange an OAuth `code` for tokens. The code comes from a human authorising in a
   * browser, so this is the tail of a popup flow like Etsy/Shopify/TikTok — not a
   * server-to-server key exchange.
   */
  app.post('/api/alibaba/exchange', { preHandler: requireAdmin }, async (req, reply) => {
    const code = String((req.body && req.body.code) || '').trim();
    if (!code) { reply.code(400); return { error: 'An authorization code is required.' }; }
    try {
      const body = await call('/auth/token/create', { code }, { method: 'POST' });
      const t = body?.access_token ? body : (body?.result || body);
      if (!t?.access_token) { reply.code(400); return { error: 'No access token in the reply.', detail: body }; }
      // expires_in / refresh_expires_in are seconds per the docs; store absolute instants so
      // a restart can't lose track of when a refresh is due.
      const secs = (v) => (Number(v) > 0 ? Number(v) : null);
      await q(`insert into alibaba_auth (id, access_token, refresh_token, account, expires_at, refresh_expires_at, updated_at)
               values (1,$1,$2,$3,$4,$5,now())
               on conflict (id) do update set access_token=excluded.access_token,
                 refresh_token=excluded.refresh_token, account=excluded.account,
                 expires_at=excluded.expires_at, refresh_expires_at=excluded.refresh_expires_at,
                 updated_at=now()`,
        [t.access_token, t.refresh_token || null, t.account || t.account_id || null,
         secs(t.expires_in) ? new Date(Date.now() + secs(t.expires_in) * 1000) : null,
         secs(t.refresh_expires_in) ? new Date(Date.now() + secs(t.refresh_expires_in) * 1000) : null]);
      return { ok: true, account: t.account || t.account_id || null };
    } catch (e) {
      reply.code(400);
      return { error: String(e && e.message || e), detail: e?.body || null };
    }
  });

  /**
   * Product search — the endpoint the Sourcing panel will call once the app is approved.
   * Returns a flattened shape so the UI never has to know about result.data.products.
   *
   * NOTE: param0's exact field names are not yet confirmed (the docs collapse the object),
   * so the keyword/page/pageSize names below are the likely ones and may need correcting
   * against the first live response. That is what /api/alibaba/test is for.
   */
  app.get('/api/alibaba/search', { preHandler: requireAdmin }, async (req, reply) => {
    const row = await tokenRow();
    if (!row?.access_token) { reply.code(400); return { error: 'Alibaba is not connected.' }; }
    const keyword = String(req.query?.keyword || '').trim();
    if (!keyword) { reply.code(400); return { error: 'A keyword is required.' }; }
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    try {
      /**
       * param0 IS {index, size, keyword} — confirmed against the live account 2026-08-07.
       *
       * Not page/pageSize, which is what the collapsed docs suggested and what this sent.
       * The gateway names one missing field at a time, so it took four probes: `index` alone
       * asks for param0, param0 alone asks for index, index BESIDE param0 still asks for
       * index (it has to be INSIDE it), and index+keyword then asks for `size`.
       */
      const body = await call('/eco/buyer/product/search',
        { param0: JSON.stringify({ index: page, size: 20, keyword }) },
        { accessToken: row.access_token });
      const d = body?.result?.data || {};
      return {
        page,
        products: (Array.isArray(d.products) ? d.products : []).map((p) => ({
          id: p.product_id != null ? String(p.product_id) : null,
          title: p.title || null,
          image: p.image?.main_image || null,
          // A live product carries "$0.88-1.05" — a RANGE, as a string, because Alibaba
          // prices by quantity band. Don't parse it to a number; there isn't one.
          price: p.price != null ? String(p.price) : null,
          // permalink comes back protocol-relative ("//www.alibaba.com/..."), which is a
          // dead link in an href on its own.
          url: p.permalink ? (String(p.permalink).startsWith('//') ? 'https:' + p.permalink : String(p.permalink)) : null,
        })),
      };
    } catch (e) {
      reply.code(400);
      return { error: String(e && e.message || e), detail: e?.body || null };
    }
  });
}

export const alibabaEnabled = () => alibabaConfigured();
