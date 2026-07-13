// Standalone Otto Cap credential check — verifies the OAuth2 password-grant token exchange
// against Otto Cap's /authenticate/token/ endpoint. No DB needed.
//
//   Run on the VPS:  cd server && node check-ottocap.mjs
//   (or point it at a specific env file:  node check-ottocap.mjs /path/to/.env )
//
// It loads the .env itself (older Node lacks --env-file), searching an optional CLI path,
// then ../.env (repo root) and ./.env. Reads OTTOCAP_USERNAME / PASSWORD / CLIENT_ID /
// CLIENT_SECRET / API_BASE.
import { readFileSync } from 'node:fs';

(function loadEnv() {
  const paths = [process.argv[2], '../.env', './.env', './server/.env'].filter(Boolean);
  let loadedFrom = null;
  for (const p of paths) {
    let txt; try { txt = readFileSync(p, 'utf8'); } catch (e) { continue; }
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m || /^\s*#/.test(line)) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;   // don't override real env vars
    }
    loadedFrom = p; break;   // first readable file wins
  }
  console.log(loadedFrom ? ('Loaded env from ' + loadedFrom) : 'No .env file found — using process env only');
})();

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
