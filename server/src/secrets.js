// DB-backed integration secrets — so an admin can set keys in the UI instead of
// editing .env by hand. Values live in `app_secrets` (plaintext, same posture as
// .env). loadSecretsIntoEnv() runs from boot.js BEFORE any route module is imported,
// so each module's `const KEY = process.env.X` captures the DB value. Changing a
// secret in the UI writes here; it takes effect on the next server restart (modules
// capture env at load) — one `docker compose restart api`, no more nano.
import { q } from './db.js';

// The only names an admin may set here — mirrors the Integrations panel. A whitelist
// keeps the endpoint from writing arbitrary env vars.
export const SECRET_NAMES = [
  'ETSY_KEYSTRING', 'ETSY_SHARED_SECRET',
  'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET',
  'TIKTOK_APP_KEY', 'TIKTOK_APP_SECRET',
  'META_APP_ID', 'META_APP_SECRET',
  'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
  'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY',
  'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET',
  'VIETQR_API_USERNAME', 'VIETQR_API_PASSWORD',
  // The rest of the USPS switch. Not secrets in the cryptographic sense — a CRID and an
  // EPS account number are identifiers, and USPS_BASE is a hostname — but this panel is
  // where an admin already goes to point an integration at a different account, and the
  // alternative was an SSH session to edit .env. USPS_BASE is what flips TEM (test, free
  // sample labels) to apis.usps.com (real postage against the EPS account).
  'USPS_BASE', 'USPS_CRID', 'USPS_MID', 'USPS_ACCOUNT_NUMBER', 'USPS_DIRECT',
  'SHIPPO_API_TOKEN',
  'USPS_CONSUMER_KEY', 'USPS_CONSUMER_SECRET',
  'SS_ACCOUNT_NUMBER', 'SS_API_KEY',
  // All FOUR are required — ocConfigured() checks username, password, client id AND
  // secret — plus the base URL, which decides sandbox vs live. Only the client pair was
  // editable, so a live account handed over as an email and password could not be entered
  // anywhere, and even once it was, the base still pointed at sandbox-api.ottocap.com.
  'OTTOCAP_USERNAME', 'OTTOCAP_PASSWORD', 'OTTOCAP_CLIENT_ID', 'OTTOCAP_CLIENT_SECRET', 'OTTOCAP_API_BASE',
  'SANMAR_CUSTOMER_NUMBER', 'SANMAR_USERNAME', 'SANMAR_PASSWORD',
  'GOOGLE_SHEETS_API_KEY', 'ANTHROPIC_API_KEY',
  'BYEASTSIDE_API_KEY', 'PINKDESIGN_API_KEY', 'PINKDESIGN_BOARD_ID', 'PINKDESIGN_WEBHOOK_SECRET',
  'WILCOM_APP_ID', 'WILCOM_APP_KEY',
  // Alibaba was the only integration whose credentials lived exclusively in the .env file,
  // so rotating them meant editing the box and restarting — while every other supplier and
  // channel could be rotated from Settings. alibaba.js already reads both inside creds()
  // at CALL time rather than at module load, so a rotation here takes effect on the next
  // request with no deploy (see the note in CLAUDE.md §3 about module-level env snapshots).
  'ALIBABA_APP_KEY', 'ALIBABA_APP_SECRET',
];
const ALLOWED = new Set(SECRET_NAMES);

/**
 * Secrets whose module SNAPSHOTS process.env at import time, so a save here does not
 * reach the code using them until the API restarts.
 *
 * setSecret() writes the live process.env, which is why the masked preview in Settings
 * updates the instant you save — and that is exactly the trap: the panel showed the NEW
 * key while the integration kept calling with the OLD one, with nothing on screen saying
 * so. Everything not listed reads at call time and takes effect on the next request.
 *
 * Derived by hand from `const X = process.env.Y` at the top of each route module. If you
 * convert one of these to a call-time read (the pattern CLAUDE.md asks for), delete it
 * from this list in the same commit.
 *
 * AUDITED 2026-08-11 against every name in SECRET_NAMES, and it was wrong by eight: Etsy,
 * Otto, S&S and VietQR all snapshot, and all four were listed as live. Those are orders in,
 * blanks out and money in — the worst four to be quietly rotating a key that never takes.
 * Hand-maintained lists rot; this one had. Re-run the check when you add a secret.
 */
export const RESTART_REQUIRED = new Set([
  'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET',          // shopify.js:11
  'TIKTOK_APP_KEY', 'TIKTOK_APP_SECRET',            // tiktok.js:15
  // USPS was here until 2026-08-20. usps.js now reads every value at CALL time and keys
  // its OAuth/payment token caches on (base + key), so a save applies to the very next
  // request — including a switch between the TEM test host and live postage.
  'META_APP_ID', 'META_APP_SECRET',                 // ads.js:17
  'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', // ads.js:21
  'GOOGLE_SHEETS_API_KEY',                          // sheets.js:17
  // Found by the 2026-08-11 audit. Each is read into a module constant and then baked
  // straight into an auth header, so the running process never sees a new value.
  'ETSY_KEYSTRING', 'ETSY_SHARED_SECRET',           // etsy.js:15-16, and API_KEY_HEADER at :24 is itself computed at import
  'OTTOCAP_USERNAME', 'OTTOCAP_PASSWORD',           // ottocap.js:14-15
  'OTTOCAP_CLIENT_ID', 'OTTOCAP_CLIENT_SECRET',     // ottocap.js:17-18 -> basic auth at :47
  'OTTOCAP_API_BASE',                               // ottocap.js:19 — also decides sandbox vs live
  'SS_ACCOUNT_NUMBER', 'SS_API_KEY',                // ss.js:17-18 -> basic auth at :55, :140, :834
  'VIETQR_API_USERNAME', 'VIETQR_API_PASSWORD',     // vietqr.js:26-27 -> basic auth at :30
]);

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists app_secrets (name text primary key, value text, updated_at timestamptz default now(), updated_by uuid)`)
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

// Overlay DB secrets onto process.env (DB wins over .env). Called at boot only.
export async function loadSecretsIntoEnv() {
  await ensure();
  const r = await q('select name, value from app_secrets');
  let n = 0;
  for (const row of r.rows) {
    if (ALLOWED.has(row.name) && row.value != null && row.value !== '') { process.env[row.name] = row.value; n++; }
  }
  return n;
}

// Upsert (or clear) one secret. Also updates the LIVE process.env — helps modules that
// read env at call time; the rest pick it up on the next restart.
export async function setSecret(name, value, byUserId) {
  if (!ALLOWED.has(name)) throw new Error('Unknown secret: ' + name);
  await ensure();
  const v = value == null ? '' : String(value).trim();
  if (!v) {
    await q('delete from app_secrets where name=$1', [name]);
    delete process.env[name];
  } else {
    await q('insert into app_secrets (name, value, updated_at, updated_by) values ($1,$2,now(),$3) on conflict (name) do update set value=excluded.value, updated_at=now(), updated_by=excluded.updated_by', [name, v, byUserId || null]);
    process.env[name] = v;
  }
}

// Which secrets are currently stored in the DB (names only — never values).
export async function storedSecretNames() {
  await ensure();
  const r = await q('select name from app_secrets');
  return r.rows.map((x) => x.name).filter((n) => ALLOWED.has(n));
}
