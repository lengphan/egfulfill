// Stripe card wallet top-up (PaymentIntents + Payment Element). PCI-light: card
// data goes straight from the browser to Stripe via the Payment Element; we only
// create the intent and read its status. Works with test keys (pk_test/sk_test).
//
// .env:  STRIPE_SECRET_KEY=sk_...   STRIPE_PUBLISHABLE_KEY=pk_...
const SK = process.env.STRIPE_SECRET_KEY || '';
const PK = process.env.STRIPE_PUBLISHABLE_KEY || '';

async function stripe(path, body, method) {
  if (!SK) throw new Error('Server missing STRIPE_SECRET_KEY');
  const opts = { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: 'Bearer ' + SK } };
  if (body) { opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = new URLSearchParams(body).toString(); }
  const r = await fetch('https://api.stripe.com/v1' + path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || ('HTTP ' + r.status));
  return d;
}

export function stripeRoutes(app, requireAuth) {
  // Publishable key is public — the frontend needs it to mount the Payment Element.
  app.get('/api/stripe/config', { preHandler: requireAuth }, async () => ({ publishableKey: PK, enabled: !!(SK && PK) }));

  app.get('/api/stripe/test', { preHandler: requireAuth }, async () => {
    try { await stripe('/balance'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });

  // Create a PaymentIntent for the entered amount (USD).
  app.post('/api/stripe/create-intent', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const amt = Number((req.body || {}).amount) || 0;
      if (amt <= 0) { reply.code(400); return { error: 'Invalid amount' }; }
      const pi = await stripe('/payment_intents', {
        amount: String(Math.round(amt * 100)),
        currency: 'usd',
        'automatic_payment_methods[enabled]': 'true',
        description: 'EGFULFILL wallet top-up',
        'metadata[seller]': (req.user && (req.user.email || req.user.sub)) || ''
      });
      return { clientSecret: pi.client_secret, id: pi.id };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Confirm the intent really succeeded before crediting (defense against a faked
  // client success). The frontend calls this after stripe.confirmPayment.
  app.post('/api/stripe/verify-intent', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const id = (req.body || {}).id;
      if (!id) { reply.code(400); return { error: 'id required' }; }
      const pi = await stripe('/payment_intents/' + encodeURIComponent(id));
      const ok = pi.status === 'succeeded';
      return { ok, amount: (Number(pi.amount_received) || 0) / 100, status: pi.status };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
