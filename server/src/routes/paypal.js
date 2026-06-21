// PayPal wallet top-up (Orders API v2). Fully automatic: the buyer approves in the
// PayPal Buttons, we capture server-side, and on COMPLETED the seller's wallet is
// credited + recorded. Works with sandbox keys for testing, live keys in prod.
//
// .env:  PAYPAL_CLIENT_ID=...  PAYPAL_SECRET=...  PAYPAL_ENV=sandbox|live
import { q } from '../db.js';

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
  // Designer payout destinations (PayPal account + linked local banks) and the
  // request log. Idempotent so fresh + existing DBs both converge.
  q(`create table if not exists payout_accounts (
       id          serial primary key,
       seller_id   uuid references users(id) on delete cascade,
       provider    text not null,                 -- 'paypal' | 'bank'
       handle      text,                           -- paypal email OR bank account number
       label       text,                           -- bank name (banks)
       meta        jsonb default '{}',             -- { name, last4 }
       is_default  boolean not null default false,
       created_at  timestamptz default now())`).catch(() => {});
  q('create index if not exists payout_accounts_seller_idx on payout_accounts(seller_id)').catch(() => {});
  q(`create table if not exists payout_requests (
       id          serial primary key,
       seller_id   uuid references users(id) on delete cascade,
       amount_usd  numeric not null,
       destination text,                           -- 'paypal' | 'bank:<id>'
       status      text not null default 'pending',
       created_at  timestamptz default now())`).catch(() => {});

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
      const amount = Number(cap.amount && cap.amount.value) || 0;
      // Real money in → record it like any top-up so the factory (admin+warehouse) is
      // credited via the same reconcile path. Idempotent per capture: clean sequential
      // EG reference + the PayPal capture id as the transaction id.
      let ref = null;
      try {
        const ex = await q('select ref from topup_requests where txn_id=$1 limit 1', [cap.id]);
        if (ex.rows[0]) { ref = ex.rows[0].ref; }
        else {
          const seqRow = await q("insert into settings (key,value,updated_at) values ('topup_seq','1',now()) on conflict (key) do update set value=(settings.value::int + 1)::text, updated_at=now() returning value");
          ref = 'EG' + String(parseInt(seqRow.rows[0].value, 10)).padStart(6, '0');
          await q(
            "insert into topup_requests (seller_id, seller_email, amount_usd, ref, note, status, txn_id, confirmed_at) values ($1,$2,$3,$4,'PayPal top-up','received',$5, now())",
            [req.user.sub, req.user.email || null, amount, ref, cap.id]
          );
        }
      } catch (e) { app.log.error('paypal topup record failed: ' + e.message); }
      return { ok: true, amount, captureId: cap.id, status: d.status, ref, txnId: cap.id };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // ── Designer payout accounts (connect PayPal + linked local banks) ───────────
  // List this designer's payout destinations.
  app.get('/api/paypal/payout-account', { preHandler: requireAuth }, async (req) => {
    const r = await q('select id, provider, handle, label, meta, is_default from payout_accounts where seller_id=$1 order by created_at asc', [req.user.sub]);
    return r.rows;
  });

  // Link a PayPal account (one per designer, replaced on re-connect) or add a bank.
  // makeDefault (or first-ever account) becomes the default destination.
  app.post('/api/paypal/payout-account', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    const provider = b.provider === 'bank' ? 'bank' : 'paypal';
    if (provider === 'paypal' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.handle || ''))) { reply.code(400); return { error: 'valid PayPal email required' }; }
    const had = await q('select count(*)::int as n from payout_accounts where seller_id=$1', [req.user.sub]);
    const first = (had.rows[0] && had.rows[0].n) === 0;
    let id;
    if (provider === 'paypal') {
      await q("delete from payout_accounts where seller_id=$1 and provider='paypal'", [req.user.sub]);
      const ins = await q('insert into payout_accounts (seller_id, provider, handle) values ($1,$2,$3) returning id', [req.user.sub, 'paypal', b.handle]);
      id = ins.rows[0].id;
    } else {
      const meta = (b.meta && typeof b.meta === 'object') ? b.meta : {};
      const ins = await q('insert into payout_accounts (seller_id, provider, handle, label, meta) values ($1,$2,$3,$4,$5) returning id', [req.user.sub, 'bank', b.handle || '', b.label || 'Bank', meta]);
      id = ins.rows[0].id;
    }
    if (b.makeDefault || first) {
      await q('update payout_accounts set is_default=false where seller_id=$1', [req.user.sub]);
      await q('update payout_accounts set is_default=true where seller_id=$1 and id=$2', [req.user.sub, id]);
    }
    return { ok: true, id, provider };
  });

  // Choose which destination is the default payout target.
  app.post('/api/paypal/payout-account/default', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    await q('update payout_accounts set is_default=false where seller_id=$1', [req.user.sub]);
    if (b.provider === 'paypal') await q("update payout_accounts set is_default=true where seller_id=$1 and provider='paypal'", [req.user.sub]);
    else await q('update payout_accounts set is_default=true where seller_id=$1 and id=$2', [req.user.sub, parseInt(b.id, 10) || -1]);
    return { ok: true };
  });

  // Remove a destination. ':id' = 'paypal' drops the PayPal link; a number drops a bank.
  app.delete('/api/paypal/payout-account/:id', { preHandler: requireAuth }, async (req) => {
    const id = req.params.id;
    if (id === 'paypal') await q("delete from payout_accounts where seller_id=$1 and provider='paypal'", [req.user.sub]);
    else await q('delete from payout_accounts where seller_id=$1 and id=$2', [req.user.sub, parseInt(id, 10) || -1]);
    return { ok: true };
  });

  // Record a payout REQUEST. Intentionally does NOT move money — it logs a pending
  // request that an admin releases through the existing payout flow, so there's no
  // unguarded self-service money path. (The PayPal Payouts API call belongs on that
  // admin release step.)
  app.post('/api/paypal/payout', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    const amt = Number(b.amount) || 0;
    if (amt <= 0) { reply.code(400); return { error: 'invalid amount' }; }
    const acct = await q('select count(*)::int as n from payout_accounts where seller_id=$1', [req.user.sub]);
    if (!(acct.rows[0] && acct.rows[0].n)) { reply.code(400); return { error: 'no payout account linked' }; }
    const r = await q('insert into payout_requests (seller_id, amount_usd, destination, status) values ($1,$2,$3,$4) returning id, created_at',
      [req.user.sub, amt, String(b.account || ''), 'pending']);
    return { ok: true, id: r.rows[0].id, status: 'pending', requestedAt: r.rows[0].created_at };
  });
}
