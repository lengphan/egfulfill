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
  'EASYPOST_API_KEY', 'SHIPPO_API_TOKEN',
  'USPS_CONSUMER_KEY', 'USPS_CONSUMER_SECRET',
  'SS_ACCOUNT_NUMBER', 'SS_API_KEY',
  'OTTOCAP_CLIENT_ID', 'OTTOCAP_CLIENT_SECRET',
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
