// Standalone TikTok Shop Partner API connection + scope check — no DB, no Fastify.
// Run:  cd server && node --env-file=.env check-tiktok.mjs [AUTH_CODE]
//
// What it proves:
//   1) that TIKTOK_APP_KEY / TIKTOK_APP_SECRET are actually loaded, and
//   2) which scopes TikTok GRANTED your app — the `granted_scopes` list in the
//      token response is the authoritative answer to "are my scopes turned on?".
//
// You need a fresh `auth_code`. It comes from a shop completing your app's
// authorization redirect (single-use, expires in minutes). Get one, then run:
//   node --env-file=.env check-tiktok.mjs <the-code-from-the-redirect-url>
// (or set TIKTOK_AUTH_CODE in .env).

const APP_KEY    = process.env.TIKTOK_APP_KEY || '';
const APP_SECRET = process.env.TIKTOK_APP_SECRET || '';
const SERVICE_ID = process.env.TIKTOK_SERVICE_ID || '';   // optional — to print the authorize URL
const AUTH_CODE  = process.argv[2] || process.env.TIKTOK_AUTH_CODE || '';

// TikTok Shop v2 auth host (stable across 202309/202407). token/get + token/refresh
// take app_key/app_secret directly — NO request signature is required for these two.
const AUTH_HOST = (process.env.TIKTOK_AUTH_HOST || 'https://auth.tiktok-shops.com').replace(/\/+$/, '');

const line = (k, v) => console.log(`  ${String(k).padEnd(22)} ${v}`);
console.log(`\nTikTok Shop check  →  ${AUTH_HOST}\n`);
line('App key',    APP_KEY ? APP_KEY.slice(0, 4) + '…' + APP_KEY.slice(-3) + ' (set)' : '✗ MISSING');
line('App secret', APP_SECRET ? 'set (' + APP_SECRET.length + ' chars)' : '✗ MISSING');
line('Service ID', SERVICE_ID || '(not set — optional)');

if (!APP_KEY || !APP_SECRET) {
  console.log('\n✗ Cannot continue — set TIKTOK_APP_KEY and TIKTOK_APP_SECRET in server/.env\n');
  process.exit(1);
}

if (!AUTH_CODE) {
  console.log('\n⚠ No auth_code given, so I can only check that the credentials are present.');
  console.log('  To verify the GRANTED SCOPES I need a fresh auth_code:');
  if (SERVICE_ID) {
    console.log('\n  1) Open this authorization URL and approve with your shop:');
    console.log(`     https://services.tiktokshop.com/open/authorize?service_id=${encodeURIComponent(SERVICE_ID)}`);
  } else {
    console.log('\n  1) In TikTok Shop Partner Center → your app → "Test my app" (or the');
    console.log('     authorization link), approve with your shop.');
  }
  console.log('  2) The browser redirects to your redirect URL with ?code=XXXX (or ?auth_code=XXXX).');
  console.log('  3) Copy that code and re-run within a few minutes:');
  console.log('       node --env-file=.env check-tiktok.mjs <code>\n');
  process.exit(0);
}

// Exchange the auth_code for tokens. token/get is a GET with query params.
const url = `${AUTH_HOST}/api/v2/token/get`
  + `?app_key=${encodeURIComponent(APP_KEY)}`
  + `&app_secret=${encodeURIComponent(APP_SECRET)}`
  + `&auth_code=${encodeURIComponent(AUTH_CODE)}`
  + `&grant_type=authorized_code`;

let d;
try {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  d = await r.json().catch(() => ({}));
  console.log(`\nHTTP ${r.status}`);
} catch (e) {
  console.log('\n✗ Request failed (network/DNS): ' + e.message + '\n');
  process.exit(1);
}

// TikTok wraps everything as { code, message, data, request_id }. code === 0 = success.
if (d && d.code !== 0) {
  console.log(`\n✗ TikTok returned an error:  code=${d.code}  message="${d.message}"`);
  if (/auth_code|expired|invalid/i.test(d.message || '')) {
    console.log('  → The auth_code is likely used/expired. Generate a fresh one and retry.');
  }
  if (/app_key|secret|signature/i.test(d.message || '')) {
    console.log('  → Check TIKTOK_APP_KEY / TIKTOK_APP_SECRET match the app in Partner Center.');
  }
  console.log('\nRaw response:\n' + JSON.stringify(d, null, 2) + '\n');
  process.exit(1);
}

const data = (d && d.data) || {};
console.log('\n✓ Token exchange OK — credentials + scopes are live.\n');
line('Access token',  data.access_token ? data.access_token.slice(0, 8) + '…' : '(none)');
line('Refresh token', data.refresh_token ? data.refresh_token.slice(0, 8) + '…' : '(none)');
line('Seller name',   data.seller_name || '(n/a)');
line('Seller region', data.seller_base_region || '(n/a)');
line('open_id',       data.open_id || '(n/a)');

// The headline answer: which scopes are actually turned on.
const scopes = data.granted_scopes || data.scope || data.scopes;
console.log('\n── GRANTED SCOPES ' + '─'.repeat(40));
if (Array.isArray(scopes) && scopes.length) {
  scopes.forEach(s => console.log('  ✓ ' + s));
} else if (typeof scopes === 'string' && scopes) {
  scopes.split(/[,\s]+/).filter(Boolean).forEach(s => console.log('  ✓ ' + s));
} else {
  console.log('  (No scope list in the response — see the raw dump below to find where TikTok put it.)');
}

console.log('\n── RAW RESPONSE ' + '─'.repeat(42));
console.log(JSON.stringify(d, null, 2) + '\n');
