// check-paypal.mjs — standalone PayPal credential check (no DB needed).
// Verifies PAYPAL_CLIENT_ID/SECRET are valid for the configured PAYPAL_ENV, and
// prints the exact "Log in with PayPal" authorize URL the Connect button builds so
// you can eyeball the domain + redirect_uri.
//
//   cd server && node --env-file=.env check-paypal.mjs
//
// Secrets stay in .env — this never prints them.

const CID = process.env.PAYPAL_CLIENT_ID || '';
const SEC = process.env.PAYPAL_SECRET || '';
const ENV = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const BASE = ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const CONNECT = ENV === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';

const mask = (s) => s ? s.slice(0, 8) + '…' + s.slice(-4) + ' (' + s.length + ' chars)' : '(empty)';

console.log('PAYPAL_ENV       :', ENV);
console.log('PAYPAL_CLIENT_ID :', mask(CID));
console.log('PAYPAL_SECRET    :', SEC ? '(set, ' + SEC.length + ' chars)' : '(EMPTY)');
console.log('APP_URL          :', APP_URL || '(unset — redirect derived from request host at runtime)');
console.log('OAuth host       :', BASE);
console.log('Login host       :', CONNECT);
console.log();

if (!CID || !SEC) { console.error('✗ Missing PAYPAL_CLIENT_ID / PAYPAL_SECRET in env.'); process.exit(1); }

const auth = Buffer.from(CID + ':' + SEC).toString('base64');
const r = await fetch(BASE + '/v1/oauth2/token', {
  method: 'POST',
  headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials'
});
const d = await r.json().catch(() => ({}));

if (r.ok && d.access_token) {
  console.log('✓ Credentials VALID for', ENV.toUpperCase(), '— got an access token.');
  console.log('  app id  :', d.app_id || '(n/a)');
  console.log('  expires :', d.expires_in, 's');
  console.log('  openid/login scope present:',
    /openid/.test(d.scope || '') ? 'yes' : 'not in client-credentials scope (informational only — the real Login gate is app config + live eligibility)');
} else {
  console.error('✗ Token request FAILED (' + r.status + '):', d.error || '', d.error_description || JSON.stringify(d));
  console.error('  → client/secret wrong for this ENV, OR env mismatch (e.g. live keys with PAYPAL_ENV=sandbox, or sandbox keys with =live).');
  process.exit(1);
}

const redirectUri = (APP_URL || 'https://egful.store') + '/api/paypal/connect/callback';
const url = CONNECT + '/connect?flowEntry=static&client_id=' + encodeURIComponent(CID)
  + '&response_type=code&scope=' + encodeURIComponent('openid email')
  + '&redirect_uri=' + encodeURIComponent(redirectUri);

console.log();
console.log('Authorize URL the Connect button will use:');
console.log(' ', url);
console.log();
console.log('Open it in a browser:');
console.log('  • shows the ' + (ENV === 'live' ? 'paypal.com' : 'sandbox.paypal.com') + ' login  → creds + redirect OK'
  + (ENV === 'sandbox' ? ' (log in with a Sandbox personal account)' : ''));
console.log('  • "invalid client_id or redirect_uri" → redirect_uri not registered under this app\'s');
console.log('    "Log in with PayPal" Return URL, or "Log in with PayPal" not enabled/approved for this env.');
