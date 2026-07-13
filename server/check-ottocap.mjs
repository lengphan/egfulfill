// Standalone Otto Cap credential check — verifies the OAuth2 password-grant token exchange
// against Otto Cap's /authenticate/token/ endpoint. No DB needed.
//
//   Run on the VPS:  cd server && node --env-file=.env check-ottocap.mjs
//
// Reads OTTOCAP_USERNAME / OTTOCAP_PASSWORD / OTTOCAP_CLIENT_ID / OTTOCAP_CLIENT_SECRET /
// OTTOCAP_API_BASE from the environment (defaults to the sandbox base).

const USER = (process.env.OTTOCAP_USERNAME || '').trim();
const PASS = (process.env.OTTOCAP_PASSWORD || '').trim();
const CID  = (process.env.OTTOCAP_CLIENT_ID || '').trim();
const SEC  = (process.env.OTTOCAP_CLIENT_SECRET || '').trim();
const BASE = (process.env.OTTOCAP_API_BASE || 'https://sandbox-api.ottocap.com').trim().replace(/\/$/, '');

const mask = (s) => (s ? s.slice(0, 3) + '…' + s.slice(-2) + ' (' + s.length + ' chars)' : '(empty)');

console.log('Otto Cap credential check');
console.log('  base     :', BASE);
console.log('  username :', USER || '(empty)');
console.log('  password :', PASS ? 'SET (' + PASS.length + ' chars)' : '(empty)');
console.log('  clientId :', mask(CID));
console.log('  secret   :', mask(SEC));

if (!USER || !PASS || !CID || !SEC) {
  console.error('\n✗ Missing OTTOCAP_USERNAME / PASSWORD / CLIENT_ID / CLIENT_SECRET in .env');
  process.exit(1);
}

const auth = Buffer.from(CID + ':' + SEC).toString('base64');
const body = new URLSearchParams({ username: USER, password: PASS, grant_type: 'password' });
const url = BASE + '/authenticate/token/';

console.log('\nPOST', url);
try {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + auth },
    body
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = text; }
  if (r.ok && data && data.access_token) {
    console.log('\n✓ SUCCESS — Otto Cap issued an access token.');
    console.log('  token_type   :', data.token_type);
    console.log('  expires_in   :', data.expires_in, 'sec');
    console.log('  scope        :', data.scope);
    console.log('  access_token :', String(data.access_token).slice(0, 10) + '…');
    console.log('  refresh_token:', data.refresh_token ? 'present' : 'none');
    process.exit(0);
  }
  console.error('\n✗ FAILED — HTTP', r.status);
  console.error('  response:', typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500));
  console.error('\n  Hints: 401 = service not enabled for customer · 403 = forbidden · 400 = bad request');
  console.error('  Double-check the CLIENT_ID/SECRET (Basic auth) and that username is your Otto account email.');
  process.exit(1);
} catch (e) {
  console.error('\n✗ Request error:', e.message);
  console.error('  (Check OTTOCAP_API_BASE and that the VPS can reach ' + BASE + ')');
  process.exit(1);
}
