// Standalone USPS scope/qualification check — no DB, no auth, no Fastify.
// Run:  node --env-file=.env check-usps.mjs
// Reports which scopes USPS granted and whether you can buy labels.
const KEY    = process.env.USPS_CONSUMER_KEY || '';
const SECRET = process.env.USPS_CONSUMER_SECRET || '';
const BASE   = (process.env.USPS_BASE || 'https://apis-tem.usps.com').replace(/\/+$/, '');
const CRID   = process.env.USPS_CRID || '';
const MID    = process.env.USPS_MID || '';
const ACCT   = process.env.USPS_ACCOUNT_NUMBER || '';
const ACCT_TYPE = process.env.USPS_ACCOUNT_TYPE || 'EPS';

const line = (k, v) => console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`\nUSPS check  →  ${BASE}  (${BASE.includes('-tem') ? 'TEM / TEST' : 'PRODUCTION'})\n`);
line('Consumer key', KEY ? 'set' : '✗ MISSING');
line('Consumer secret', SECRET ? 'set' : '✗ MISSING');
line('CRID / MID / EPS', `${CRID || '✗'} / ${MID || '✗'} / ${ACCT || '✗'}`);

if (!KEY || !SECRET) {
  console.log('\n✗ Cannot continue — set USPS_CONSUMER_KEY and USPS_CONSUMER_SECRET in server/.env\n');
  process.exit(1);
}

// 1) OAuth — client_credentials
const body = { grant_type: 'client_credentials', client_id: KEY, client_secret: SECRET };
if (process.env.USPS_SCOPE) body.scope = process.env.USPS_SCOPE;
let oauth;
try {
  const r = await fetch(`${BASE}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error || ('HTTP ' + r.status));
  oauth = d.access_token;
  console.log('\n✓ OAuth login OK');
  line('Granted scopes', d.scope || '(none returned)');
  const sc = ' ' + (d.scope || '').toLowerCase() + ' ';
  line('has addresses', /[\s:]addresses[\s]/.test(sc) ? '✓' : '—');
  line('has prices', /[\s:]prices[\s]/.test(sc) ? '✓' : '—');
  line('has labels', /[\s:]labels[\s]/.test(sc) ? '✓ NEW' : '✗ (needed for labels)');
  line('has payments', /[\s:]payments[\s]/.test(sc) ? '✓ NEW' : '✗ (needed to buy postage)');
  line('has tracking', /[\s:]tracking[\s]/.test(sc) ? '✓' : '—');
} catch (e) {
  console.log('\n✗ OAuth FAILED: ' + e.message + '\n');
  process.exit(1);
}

// 2) Payment authorization (needs CRID + MID + EPS) — the real "can I buy labels" test
if (!CRID || !MID || !ACCT) {
  console.log('\n⚠ Skipping payment-token test — set USPS_CRID, USPS_MID, USPS_ACCOUNT_NUMBER to verify label-buying.\n');
  process.exit(0);
}
try {
  const MANIFEST_MID = process.env.USPS_MANIFEST_MID || MID;
  const r = await fetch(`${BASE}/payments/v3/payment-authorization`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + oauth },
    body: JSON.stringify({ roles: [
      { roleName: 'PAYER', CRID, MID, manifestMID: MANIFEST_MID, accountType: ACCT_TYPE, accountNumber: ACCT },
      { roleName: 'LABEL_OWNER', CRID, MID, manifestMID: MANIFEST_MID },
    ] }),
  });
  const d = await r.json().catch(() => ({}));
  const token = d.paymentAuthorizationToken || d.token;
  if (!r.ok || !token) throw new Error(d.error?.message || d.message || JSON.stringify(d).slice(0, 200));
  console.log('\n✓ Payment authorization OK  →  QUALIFIED to buy labels 🎉\n');
} catch (e) {
  console.log('\n✗ Payment authorization FAILED: ' + e.message);
  console.log('  (If this says "insufficient scope", the payments scope isn\'t active yet.)\n');
  process.exit(1);
}
