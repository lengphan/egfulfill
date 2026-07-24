// Manual seller payouts. There is no bank/payout API — a seller saves their payout
// details (PingPong / LianLian / VN bank transfer / a VietQR image) once, then requests a
// withdrawal amount. Admin/warehouse see the pending request WITH those details, pay it by
// hand off-platform, and mark it Paid — which debits the seller's wallet by that amount.
//
// The mirror image of topups.js: same pending → staff-resolve shape, but the ledger row is
// a DEBIT (negative delta) instead of a credit, and paying is gated to admin/warehouse
// because it moves money OUT.
import { q } from '../db.js';
import { balanceOf } from './wallet.js';
import { sendMail, mailConfigured } from '../mailer.js';

// Amount guardrails — ADMIN-CONFIGURABLE via factory settings (Settings › Platform):
//   payout_min  a request must be at least this
//   payout_max  and at most this, UNLESS it's 0 → no fixed ceiling (balance is the cap)
// The seller's own balance is ALWAYS the hard cap regardless — a debit past zero would
// invent money the ledger doesn't have. Read at call time so an admin edit applies with no
// redeploy, and fall back to sane defaults if the settings row was never written.
const DEFAULT_MIN = 10;
async function payoutBounds() {
  const rows = await q("select key, value from settings where key in ('payout_min','payout_max')")
    .then((r) => r.rows).catch(() => []);
  const m = {};
  for (const r of rows) m[r.key] = Number(r.value);
  const min = Number.isFinite(m.payout_min) && m.payout_min > 0 ? m.payout_min : DEFAULT_MIN;
  const max = Number.isFinite(m.payout_max) && m.payout_max > 0 ? m.payout_max : 0; // 0 = balance-limited
  return { min, max };
}

const canPay = (u) => ['admin', 'warehouse'].includes(String(u && u.role));

export function payoutsRoutes(app, requireAuth) {
  // Where a payout landed — a request carries a SNAPSHOT of the seller's details (method),
  // so editing the profile later never rewrites the instructions for a payout already made.
  q(`create table if not exists payout_requests (
       id uuid primary key default gen_random_uuid(),
       seller_id   uuid references users(id) on delete set null,
       seller_name text,
       seller_email text,
       amount_usd  numeric not null,
       method      jsonb,
       note        text,
       status      text not null default 'pending',   -- pending | paid | rejected
       created_at  timestamptz default now(),
       resolved_at timestamptz,
       resolved_by uuid)`).catch(() => {});
  // The seller's saved payout profile lives on the user row — one current profile per
  // seller, snapshotted into each request.
  q(`alter table users add column if not exists payout_info jsonb`).catch(() => {});

  // Seller reads / saves their payout profile. Bounds ride along so the withdraw dialog
  // knows the limits without a second call.
  app.get('/api/payout/method', { preHandler: requireAuth }, async (req) => {
    const r = await q('select payout_info from users where id=$1', [req.user.sub]).catch(() => null);
    const { min, max } = await payoutBounds();
    return { info: (r && r.rows[0] && r.rows[0].payout_info) || null, min, max, balance: await balanceOf(req.user.sub) };
  });
  app.put('/api/payout/method', { preHandler: requireAuth }, async (req, reply) => {
    const info = (req.body && req.body.info) || null;
    if (!info || typeof info !== 'object') { reply.code(400); return { error: 'Payout details are required.' }; }
    await q('update users set payout_info=$2 where id=$1', [req.user.sub, JSON.stringify(info)]).catch(() => {});
    return { ok: true, info };
  });

  // Seller requests a payout. Validates the amount against the min/max AND the live balance
  // (re-checked at pay time), and snapshots the saved profile so admin has what they need.
  app.post('/api/payout/requests', { preHandler: requireAuth }, async (req, reply) => {
    const amount = Number((req.body || {}).amount) || 0;
    const note = (req.body || {}).note || null;
    const { min, max } = await payoutBounds();
    if (amount < min) { reply.code(400); return { error: `The minimum payout is $${min}.` }; }
    if (max > 0 && amount > max) { reply.code(400); return { error: `The maximum payout is $${max}.` }; }
    const bal = await balanceOf(req.user.sub);
    if (amount > bal) { reply.code(400); return { error: `You can withdraw up to $${bal.toFixed(2)}.` }; }
    // name isn't in the JWT (only sub/role/email), so read it from the row along with the
    // saved profile — the admin panel wants a name, not a bare id.
    const me = await q('select payout_info, name, email from users where id=$1', [req.user.sub]).then((r) => r.rows[0]).catch(() => null);
    const prof = me && me.payout_info;
    if (!prof) { reply.code(400); return { error: 'Add your payout details before requesting a withdrawal.' }; }
    const r = await q(
      `insert into payout_requests (seller_id, seller_name, seller_email, amount_usd, method, note, status)
       values ($1,$2,$3,$4,$5,$6,'pending') returning *`,
      [req.user.sub, (me && me.name) || null, (me && me.email) || req.user.email || null, amount, JSON.stringify(prof), note]
    );
    // Best-effort admin heads-up. Fire-and-forget — the pending row is the source of truth.
    (async () => {
      try {
        if (!mailConfigured()) return;
        const admins = await q("select email from users where role in ('admin','warehouse') and email is not null and email <> ''");
        const who = req.user.email || req.user.name || 'A seller';
        const subject = `Payout requested — $${amount.toFixed(2)}`;
        const text = `${who} requested a $${amount.toFixed(2)} payout. Review it in the Factory Wallet → Pending payouts.`;
        for (const row of admins.rows) { if (row.email) sendMail({ to: row.email, subject, text }).catch(() => {}); }
      } catch { /* never blocks the request */ }
    })();
    return r.rows[0];
  });

  // List: staff see all (optional ?status=); a seller sees only their own.
  app.get('/api/payout/requests', { preHandler: requireAuth }, async (req) => {
    if (canPay(req.user) || String(req.user.role) !== 'seller') {
      const st = req.query && req.query.status;
      const r = st
        ? await q('select * from payout_requests where status=$1 order by created_at desc limit 200', [st])
        : await q('select * from payout_requests order by created_at desc limit 200');
      return r.rows;
    }
    const r = await q('select * from payout_requests where seller_id=$1 order by created_at desc limit 100', [req.user.sub]);
    return r.rows;
  });

  // Admin/warehouse mark a payout Paid → DEBIT the seller's wallet. Balance is re-checked
  // here (it may have moved since the request), and the ledger row is idempotent by
  // (account,type,ref) with ref=the request id, so a double-click can't debit twice.
  app.post('/api/payout/requests/:id/pay', { preHandler: requireAuth }, async (req, reply) => {
    if (!canPay(req.user)) { reply.code(403); return { error: 'Admin or warehouse only' }; }
    const pre = await q('select * from payout_requests where id=$1', [req.params.id]).then((r) => r.rows[0]).catch(() => null);
    if (!pre) { reply.code(404); return { error: 'Not found' }; }
    if (pre.status !== 'pending') { reply.code(409); return { error: `Already ${pre.status}` }; }
    const amount = Number(pre.amount_usd) || 0;
    if (pre.seller_id) {
      const bal = await balanceOf(pre.seller_id);
      if (amount > bal) { reply.code(409); return { error: `Seller's balance is only $${bal.toFixed(2)} — can't pay out $${amount.toFixed(2)}.` }; }
    }
    const r = await q(
      "update payout_requests set status='paid', resolved_at=now(), resolved_by=$2 where id=$1 and status='pending' returning *",
      [req.params.id, req.user.sub]
    );
    const rec = r.rows[0];
    if (!rec) { reply.code(409); return { error: 'Already processed' }; }
    if (rec.seller_id) {
      const label = (rec.method && (rec.method.type || rec.method.method)) ? `Payout · ${rec.method.type || rec.method.method}` : 'Payout';
      await q(
        `insert into wallet_ledger (account, delta, type, ref, note, created_by)
         values ($1,$2,'withdrawal',$3,$4,$5) on conflict do nothing`,
        [rec.seller_id, -Math.abs(amount), String(rec.id), label, req.user.sub]
      ).catch(() => {});
    }
    return rec;
  });

  // Admin/warehouse reject a payout (bad details, etc.) → status flips, NO ledger movement.
  app.post('/api/payout/requests/:id/reject', { preHandler: requireAuth }, async (req, reply) => {
    if (!canPay(req.user)) { reply.code(403); return { error: 'Admin or warehouse only' }; }
    const r = await q(
      "update payout_requests set status='rejected', resolved_at=now(), resolved_by=$2 where id=$1 and status='pending' returning *",
      [req.params.id, req.user.sub]
    );
    if (!r.rows[0]) { reply.code(404); return { error: 'Not found or already processed' }; }
    return r.rows[0];
  });
}
