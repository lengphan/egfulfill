// admin_secrets.js — READ-ONLY masked metadata of integration credentials (staff).
//
// No plaintext, no write path. Returns only "is it set" + a last-4 hint per known
// credential (exactly what Stripe/AWS dashboards show). Reads straight from
// process.env — no DB, no decryption. Powers the last-4 display in Settings ›
// Integrations, which is already gated to staff in the UI.
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
];

export function adminSecretsRoutes(app, requireStaff) {
  app.get('/api/admin/secrets', { preHandler: requireStaff }, async () => ({
    secrets: SECRET_DEFS.map((d) => {
      const v = (process.env[d.name] || '').trim();
      return { name: d.name, label: d.label, integration: d.integration, set: !!v, last4: v ? v.slice(-4) : null };
    }),
  }));
}
