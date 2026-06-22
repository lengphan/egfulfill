// Stripe card wallet top-up (PaymentIntents + Payment Element). PCI-light: card
// data goes straight from the browser to Stripe via the Payment Element; we only
// create the intent and read its status. Works with test keys (pk_test/sk_test).
//
// .env:  STRIPE_SECRET_KEY=sk_...   STRIPE_PUBLISHABLE_KEY=pk_...
import { q } from '../db.js';

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

// Record a confirmed top-up ONCE (idempotent per Stripe id) so the wallet + factory
// reconcile via the same path as every other deposit. Returns the EG reference.
async function recordTopup(app, user, amount, txnId, note) {
  let ref = null;
  try {
    const ex = await q('select ref from topup_requests where txn_id=$1 limit 1', [txnId]);
    if (ex.rows[0]) return ex.rows[0].ref;
    const seqRow = await q("insert into settings (key,value,updated_at) values ('topup_seq','1',now()) on conflict (key) do update set value=(settings.value::int + 1)::text, updated_at=now() returning value");
    ref = 'EG' + String(parseInt(seqRow.rows[0].value, 10)).padStart(6, '0');
    await q(
      "insert into topup_requests (seller_id, seller_email, amount_usd, ref, note, status, txn_id, confirmed_at) values ($1,$2,$3,$4,$5,'received',$6, now())",
      [user.sub, user.email || null, amount, ref, note || 'Card top-up', txnId]
    );
  } catch (e) { app.log.error('stripe topup record failed: ' + e.message); }
  return ref;
}

// Find or create the seller's Stripe Customer so cards can be SAVED + reused. Cached
// in stripe_customers (created on first use; no schema migration needed).
async function customerFor(user) {
  await q('create table if not exists stripe_customers (seller_id text primary key, customer_id text, created_at timestamptz default now())');
  const ex = await q('select customer_id from stripe_customers where seller_id=$1', [user.sub]);
  if (ex.rows[0] && ex.rows[0].customer_id) return ex.rows[0].customer_id;
  const c = await stripe('/customers', { email: user.email || '', 'metadata[seller]': String(user.sub) });
  await q('insert into stripe_customers (seller_id, customer_id) values ($1,$2) on conflict (seller_id) do update set customer_id=$2', [user.sub, c.id]);
  return c.id;
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
      const amount = (Number(pi.amount_received) || 0) / 100;
      if (!ok) return { ok, amount, status: pi.status };
      const ref = await recordTopup(app, req.user, amount, id, 'Card top-up');
      return { ok, amount, status: pi.status, ref, txnId: id };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // ── Save a card (NO charge) — a SetupIntent under the seller's Customer. The
  //    "Add New Card" form confirms this; the card is then chargeable from Add Funds.
  app.post('/api/stripe/setup-intent', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const customer = await customerFor(req.user);
      const si = await stripe('/setup_intents', { customer, 'payment_method_types[]': 'card', usage: 'off_session' });
      return { clientSecret: si.client_secret };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // ── List the seller's saved cards (Stripe is the source of truth — we never
  //    store card data ourselves).
  app.get('/api/stripe/cards', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const customer = await customerFor(req.user);
      const pms = await stripe('/payment_methods?type=card&customer=' + encodeURIComponent(customer));
      const cards = (pms.data || []).map(function (pm) {
        const c = pm.card || {};
        return { id: pm.id, brand: c.brand || 'card', last4: c.last4 || '', exp: c.exp_month ? (String(c.exp_month).padStart(2, '0') + '/' + String(c.exp_year).slice(-2)) : '', name: (pm.billing_details && pm.billing_details.name) || '' };
      });
      return { cards };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // ── Charge a SAVED card for the entered amount → credit the wallet on success.
  //    Customer is present, so 3-D Secure (requires_action) hands a clientSecret back
  //    for the client to finish; the wallet is credited only after verify-intent.
  app.post('/api/stripe/charge-saved', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const amt = Number((req.body || {}).amount) || 0;
      const pmId = (req.body || {}).paymentMethodId;
      if (amt <= 0) { reply.code(400); return { error: 'Invalid amount' }; }
      if (!pmId) { reply.code(400); return { error: 'paymentMethodId required' }; }
      const customer = await customerFor(req.user);
      const pi = await stripe('/payment_intents', {
        amount: String(Math.round(amt * 100)), currency: 'usd', customer, payment_method: pmId,
        confirm: 'true', description: 'EGFULFILL wallet top-up (saved card)',
        'metadata[seller]': (req.user && (req.user.email || req.user.sub)) || ''
      });
      if (pi.status === 'succeeded') {
        const amount = (Number(pi.amount_received) || 0) / 100 || amt;
        const ref = await recordTopup(app, req.user, amount, pi.id, 'Card top-up (saved)');
        return { ok: true, amount, status: pi.status, ref, txnId: pi.id };
      }
      // requires_action (3-D Secure) etc. → let the client finish with the clientSecret.
      return { ok: false, status: pi.status, clientSecret: pi.client_secret, id: pi.id };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
