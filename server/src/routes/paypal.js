// PayPal wallet top-up (Orders API v2). Fully automatic: the buyer approves in the
// PayPal Buttons, we capture server-side, and on COMPLETED the seller's wallet is
// credited + recorded. Works with sandbox keys for testing, live keys in prod.
//
// .env:  PAYPAL_CLIENT_ID=...  PAYPAL_SECRET=...  PAYPAL_ENV=sandbox|live
const CID = process.env.PAYPAL_CLIENT_ID || '';
const SEC = process.env.PAYPAL_SECRET || '';
const ENV = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
const BASE = ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

async function ppToken() {
  if (!CID || !SEC) throw new Error('Server missing PAYPAL_CLIENT_ID / PAYPAL_SECRET');
  const auth = Buffer.from(CID + ':' + SEC).toString('base64');
  const r = await fetch(BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('PayPal OAuth failed: ' + (d.error_description || d.error || ('HTTP ' + r.status)));
  return d.access_token;
}

export function paypalRoutes(app, requireAuth) {
  // The client-id is public (it goes in the PayPal JS SDK URL); the frontend fetches it.
  app.get('/api/paypal/config', { preHandler: requireAuth }, async () => ({ clientId: CID, env: ENV, enabled: !!(CID && SEC) }));

  app.get('/api/paypal/test', { preHandler: requireAuth }, async () => {
    try { await ppToken(); return { ok: true, env: ENV }; } catch (e) { return { ok: false, error: e.message }; }
  });

  // 1) Create an order for the entered amount (USD).
  app.post('/api/paypal/create-order', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const amt = Number((req.body || {}).amount) || 0;
      if (amt <= 0) { reply.code(400); return { error: 'Invalid amount' }; }
      const tok = await ppToken();
      const r = await fetch(BASE + '/v2/checkout/orders', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: amt.toFixed(2) }, description: 'EGFULFILL wallet top-up' }]
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) { reply.code(400); return { error: 'PayPal create failed: ' + JSON.stringify(d).slice(0, 300) }; }
      return { id: d.id };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // 2) Capture the approved order → returns the captured amount on success.
  app.post('/api/paypal/capture-order', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const id = (req.body || {}).orderID;
      if (!id) { reply.code(400); return { error: 'orderID required' }; }
      const tok = await ppToken();
      const r = await fetch(BASE + '/v2/checkout/orders/' + encodeURIComponent(id) + '/capture', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
      });
      const d = await r.json().catch(() => ({}));
      const cap = d && d.purchase_units && d.purchase_units[0] && d.purchase_units[0].payments
        && d.purchase_units[0].payments.captures && d.purchase_units[0].payments.captures[0];
      const ok = r.ok && d.status === 'COMPLETED' && cap && cap.status === 'COMPLETED';
      if (!ok) { reply.code(400); return { error: 'Capture not completed: ' + JSON.stringify(d).slice(0, 300) }; }
      return { ok: true, amount: Number(cap.amount && cap.amount.value) || 0, captureId: cap.id, status: d.status };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
