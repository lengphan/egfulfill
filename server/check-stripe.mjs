// check-stripe.mjs — standalone Stripe key check (no DB needed).
// Verifies STRIPE_SECRET_KEY works (and that the publishable key matches the same
// live/test mode), by calling Stripe's /v1/balance. Never prints the secret.
//
//   cd server && node --env-file=.env check-stripe.mjs

const SK = process.env.STRIPE_SECRET_KEY || '';
const PK = process.env.STRIPE_PUBLISHABLE_KEY || '';

const mask = (s) => s ? s.slice(0, 11) + '…' + s.slice(-4) + ' (' + s.length + ' chars)' : '(empty)';
const modeOf = (k) => /^[a-z]+_live_/.test(k) ? 'LIVE' : (/^[a-z]+_test_/.test(k) ? 'TEST' : '???');

console.log('STRIPE_SECRET_KEY      :', mask(SK), '→', modeOf(SK));
console.log('STRIPE_PUBLISHABLE_KEY :', mask(PK), '→', modeOf(PK));
console.log();

if (!SK) { console.error('✗ STRIPE_SECRET_KEY is empty.'); process.exit(1); }
if (!/^sk_/.test(SK)) { console.error('✗ STRIPE_SECRET_KEY should start with "sk_". This looks wrong (publishable key in the wrong slot?).'); process.exit(1); }
if (PK && modeOf(SK) !== modeOf(PK)) {
  console.error('✗ Secret and publishable keys are in DIFFERENT modes (' + modeOf(SK) + ' vs ' + modeOf(PK) + ').');
  console.error('  Both must be live (sk_live_/pk_live_) or both test — mixing them breaks the Payment Element.');
}

const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: 'Bearer ' + SK } });
const d = await r.json().catch(() => ({}));

if (r.ok) {
  console.log('✓ Stripe SECRET key is VALID (' + modeOf(SK) + ' mode).');
  console.log('  livemode :', d.livemode);
  const avail = (d.available || []).map((a) => (a.amount / 100).toFixed(2) + ' ' + (a.currency || '').toUpperCase()).join(', ');
  console.log('  balance  :', avail || '(none yet)');
  console.log();
  console.log('→ Card top-ups should now work. If the Payment Element still errors, hard-refresh');
  console.log('  the wallet page and confirm the server was recreated (docker compose up -d).');
} else {
  console.error('✗ Stripe REJECTED the secret key (HTTP ' + r.status + '): ' + ((d.error && d.error.message) || JSON.stringify(d)));
  console.error('  Common causes: expired/rolled key, wrong mode, or trailing whitespace in .env.');
  console.error('  Roll a fresh Secret key in Dashboard → Developers → API keys, update .env, then');
  console.error('  docker compose up -d (recreate so it re-reads .env).');
  process.exit(1);
}
