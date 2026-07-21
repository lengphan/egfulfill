// admin_secrets.js — READ-ONLY masked metadata of integration credentials (staff).
//
// No plaintext, no write path. Returns only "is it set" + a last-4 hint per known
// credential (exactly what Stripe/AWS dashboards show). Reads straight from
// process.env — no DB, no decryption. Powers the last-4 display in Settings ›
// Integrations, which is already gated to staff in the UI.
import { setSecret, SECRET_NAMES } from '../secrets.js';

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
  { name: 'EASYPOST_API_KEY',      label: 'EasyPost key',     integration: 'shipping' },
  { name: 'SHIPPO_API_TOKEN',      label: 'Shippo token',     integration: 'shipping' },
  { name: 'USPS_CONSUMER_KEY',     label: 'Consumer key',     integration: 'usps' },
  { name: 'USPS_CONSUMER_SECRET',  label: 'Consumer secret',  integration: 'usps' },
  { name: 'SS_API_KEY',            label: 'API key',          integration: 'ss' },
  { name: 'OTTOCAP_CLIENT_ID',     label: 'Client ID',        integration: 'otto' },
  { name: 'OTTOCAP_CLIENT_SECRET', label: 'Client secret',    integration: 'otto' },
  { name: 'GOOGLE_SHEETS_API_KEY', label: 'API key',          integration: 'sheets' },
  { name: 'BYEASTSIDE_API_KEY',    label: 'API key',          integration: 'dispatch' },
  { name: 'PINKDESIGN_API_KEY',    label: 'API key',          integration: 'pinkdesign' },
  { name: 'PINKDESIGN_BOARD_ID',   label: 'Board ID',         integration: 'pinkdesign' },
  { name: 'META_APP_ID',           label: 'App ID',           integration: 'meta_ads' },
  { name: 'META_APP_SECRET',       label: 'App secret',       integration: 'meta_ads' },
  { name: 'GOOGLE_ADS_CLIENT_ID',     label: 'Client ID',        integration: 'google_ads' },
  { name: 'GOOGLE_ADS_CLIENT_SECRET', label: 'Client secret',    integration: 'google_ads' },
  { name: 'GOOGLE_ADS_DEVELOPER_TOKEN', label: 'Developer token', integration: 'google_ads' },
  { name: 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', label: 'Manager (MCC) ID', integration: 'google_ads' },
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
function maskSecret(v) {
  const s = String(v || '');
  if (!s) return null;
  if (s.length <= 16) return '•'.repeat(Math.max(8, s.length));
  const head = s.slice(0, 12);
  const tail = s.slice(-8);
  return `${head}${'•'.repeat(6)}${tail}`;
}

export function adminSecretsRoutes(app, requireStaff) {
  app.get('/api/admin/secrets', { preHandler: requireStaff }, async () => ({
    secrets: SECRET_DEFS.map((d) => {
      const v = (process.env[d.name] || '').trim();
      const editable = SECRET_NAMES.includes(d.name);
      // `last4` stays for older clients; `masked` is the preview to show.
      return { name: d.name, label: d.label, integration: d.integration, set: !!v,
               masked: maskSecret(v), last4: v ? v.slice(-4) : null, editable };
    }),
  }));

  // Admin: set/replace/clear one secret in the DB (loaded into env at boot; also
  // applied live). Whitelisted names only. Takes full effect on the next restart.
  app.put('/api/admin/secrets', { preHandler: requireStaff }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only' }; }
    const b = req.body || {};
    const name = String(b.name || '');
    if (!SECRET_NAMES.includes(name)) { reply.code(400); return { error: 'Unknown or non-editable secret' }; }
    try { await setSecret(name, b.value, req.user.sub); }
    catch (e) { reply.code(400); return { error: (e && e.message) || 'Save failed' }; }
    const v = (process.env[name] || '').trim();
    return { ok: true, name, set: !!v, masked: maskSecret(v), last4: v ? v.slice(-4) : null };
  });
}
