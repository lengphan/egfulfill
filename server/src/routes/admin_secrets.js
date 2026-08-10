// admin_secrets.js — READ-ONLY masked metadata of integration credentials (staff).
//
// No plaintext, no write path. Returns only "is it set" + a last-4 hint per known
// credential (exactly what Stripe/AWS dashboards show). Reads straight from
// process.env — no DB, no decryption. Powers the last-4 display in Settings ›
// Integrations, which is already gated to staff in the UI.
import { setSecret, SECRET_NAMES, RESTART_REQUIRED } from '../secrets.js';

const SECRET_DEFS = [
  { name: 'ETSY_KEYSTRING',        label: 'Keystring',        integration: 'etsy' },
  { name: 'ETSY_SHARED_SECRET',    label: 'Shared secret',    integration: 'etsy' },
  { name: 'SHOPIFY_API_KEY',       label: 'API key',          integration: 'shopify' },
  { name: 'SHOPIFY_API_SECRET',    label: 'API secret',       integration: 'shopify' },
  { name: 'TIKTOK_APP_KEY',        label: 'App key',          integration: 'tiktok' },
  { name: 'TIKTOK_APP_SECRET',     label: 'App secret',       integration: 'tiktok' },
  { name: 'STRIPE_SECRET_KEY',     label: 'Secret key',       integration: 'stripe' },
  { name: 'STRIPE_PUBLISHABLE_KEY', label: 'Publishable key', integration: 'stripe' },
  { name: 'PAYPAL_CLIENT_ID',      label: 'Client ID',        integration: 'paypal' },
  { name: 'PAYPAL_SECRET',         label: 'Secret',           integration: 'paypal' },
  { name: 'VIETQR_API_USERNAME',   label: 'Username',         integration: 'vietqr' },
  { name: 'VIETQR_API_PASSWORD',   label: 'Password',         integration: 'vietqr' },
  // integration must equal the PANEL CARD's `key`, or the edit fields attach to no card and
  // the secret becomes unreachable from Settings. These said 'shipping' while the cards are
  // 'shippo' and 'easypost' — so the Shippo token, the one key that decides whether labels
  // are test or live, could not be changed anywhere in the product.
  // EASYPOST removed from the editable set (2026-08-10): Shippo covers everything USPS
  // direct does not, so a second aggregator is a second key to misconfigure — which it
  // already was, absorbing a Shippo token typed into the wrong field. The CODE stays for
  // now and is inert without a key (every call site guards on epKey()); tearing 41
  // references out of the label-buying path is a separate change, not one to make on the
  // day live labels start being bought.
  { name: 'SHIPPO_API_TOKEN',      label: 'API token',        integration: 'shippo' },
  { name: 'USPS_CONSUMER_KEY',     label: 'Consumer key',     integration: 'usps' },
  { name: 'USPS_CONSUMER_SECRET',  label: 'Consumer secret',  integration: 'usps' },
  { name: 'SS_API_KEY',            label: 'API key',          integration: 'ss' },
  { name: 'OTTOCAP_CLIENT_ID',     label: 'Client ID',        integration: 'otto' },
  { name: 'OTTOCAP_CLIENT_SECRET', label: 'Client secret',    integration: 'otto' },
  { name: 'SANMAR_CUSTOMER_NUMBER', label: 'Customer number', integration: 'sanmar' },
  { name: 'SANMAR_USERNAME',       label: 'Web username',     integration: 'sanmar' },
  { name: 'SANMAR_PASSWORD',       label: 'Web password',     integration: 'sanmar' },
  { name: 'GOOGLE_SHEETS_API_KEY', label: 'API key',          integration: 'sheets' },
  { name: 'BYEASTSIDE_API_KEY',    label: 'API key',          integration: 'dispatch' },
  { name: 'PINKDESIGN_API_KEY',    label: 'API key',          integration: 'pinkdesign' },
  { name: 'PINKDESIGN_BOARD_ID',   label: 'Board ID',         integration: 'pinkdesign' },
  { name: 'PINKDESIGN_WEBHOOK_SECRET', label: 'Webhook key',  integration: 'pinkdesign' },
  { name: 'META_APP_ID',           label: 'App ID',           integration: 'meta_ads' },
  { name: 'META_APP_SECRET',       label: 'App secret',       integration: 'meta_ads' },
  { name: 'GOOGLE_ADS_CLIENT_ID',     label: 'Client ID',        integration: 'google_ads' },
  { name: 'GOOGLE_ADS_CLIENT_SECRET', label: 'Client secret',    integration: 'google_ads' },
  { name: 'GOOGLE_ADS_DEVELOPER_TOKEN', label: 'Developer token', integration: 'google_ads' },
  { name: 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', label: 'Manager (MCC) ID', integration: 'google_ads' },
  { name: 'ALIBABA_APP_KEY',       label: 'App key',          integration: 'alibaba' },
  { name: 'ALIBABA_APP_SECRET',    label: 'App secret',       integration: 'alibaba' },
  { name: 'WILCOM_APP_ID',         label: 'Application ID',   integration: 'wilcom' },
  { name: 'WILCOM_APP_KEY',        label: 'Application key',  integration: 'wilcom' },
];

/**
 * A recognisable-but-safe preview of a credential: a leading run, dots, then a trailing
 * run — the shape Stripe/GitHub/Supabase use.
 *
 * last-4 alone is nearly useless when several keys end in similar characters, and it
 * hides the PREFIX, which is the part that identifies a credential at a glance:
 * "eyJhbGci…" is a JWT, "sk_live_"/"sk_test_" is the difference between real and test
 * money, "shippo_live_" vs "shippo_test_". Showing the head is what makes "is the right
 * key installed?" answerable without revealing the secret.
 *
 * Short values are masked entirely rather than half-revealed — for a 12-char key,
 * head+tail would expose most of it.
 */
function maskSecret(v, full) {
  const s = String(v || '');
  if (!s) return null;
  // Consistent "first 4 · dot run · last 4" across every credential — the shape a Kiloship /
  // Stripe dashboard shows, easy to eyeball "is the right key in?". ADMINS only; other staff
  // on this requireAdmin route get last-4, so a short secret isn't largely revealed to them.
  if (full && s.length >= 10) return `${s.slice(0, 4)}${'•'.repeat(8)}${s.slice(-4)}`;
  return `${'•'.repeat(8)}${s.slice(-4)}`;
}

/** live vs test, derived server-side so the prefix itself never has to be shown. */
function keyMode(v) {
  const s = String(v || '');
  if (!s) return null;
  if (/(^|_)test(_|$)|sk_test|pk_test|sandbox/i.test(s)) return 'test';
  if (/(^|_)live(_|$)|sk_live|pk_live/i.test(s)) return 'live';
  return null;
}

// ADMIN-only. Even masked, this enumerates which integrations hold credentials and shows
// the last 4 — a map of what's worth attacking. The PUT was already admin-checked inline.
export function adminSecretsRoutes(app, requireAdmin) {
  app.get('/api/admin/secrets', { preHandler: requireAdmin }, async (req) => {
    const full = req.user?.role === 'admin';
    return {
      secrets: SECRET_DEFS.map((d) => {
        const v = (process.env[d.name] || '').trim();
        const editable = SECRET_NAMES.includes(d.name);
        // `last4` stays for older clients; `masked` is the preview to show (head…tail for admins).
        return { name: d.name, label: d.label, integration: d.integration, set: !!v,
                 masked: maskSecret(v, full), last4: v ? v.slice(-4) : null, mode: keyMode(v), editable,
                 // Whether saving this one reaches the code that uses it, or waits for a
                 // restart. The panel showed a fresh last-4 either way, which is how a save
                 // could look applied while the integration still called with the old key.
                 restartRequired: RESTART_REQUIRED.has(d.name) };
      }),
    };
  });

  // Admin: set/replace/clear one secret in the DB (loaded into env at boot; also
  // applied live). Whitelisted names only. Takes full effect on the next restart.
  app.put('/api/admin/secrets', { preHandler: requireAdmin }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only' }; }
    const b = req.body || {};
    const name = String(b.name || '');
    if (!SECRET_NAMES.includes(name)) { reply.code(400); return { error: 'Unknown or non-editable secret' }; }
    try { await setSecret(name, b.value, req.user.sub); }
    catch (e) { reply.code(400); return { error: (e && e.message) || 'Save failed' }; }
    const v = (process.env[name] || '').trim();
    return { ok: true, name, set: !!v, masked: maskSecret(v, true), last4: v ? v.slice(-4) : null,
             restartRequired: RESTART_REQUIRED.has(name) };
  });
}
