// Manual VietQR top-up reconciliation. Until VietQR's auto-callback is live (or
// as a fallback), a seller clicks "I've transferred" → a PENDING top-up is created
// here and the admin sees it in the Factory Wallet with a "Received" button. When
// an admin/staff confirms, status flips to 'received' and the seller's wallet
// (polling its own top-ups) credits itself.
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { sendMail, mailConfigured } from '../mailer.js';

export function topupsRoutes(app, requireAuth) {
  q(`create table if not exists topup_requests (
       id uuid primary key default gen_random_uuid(),
       seller_id   uuid references users(id) on delete set null,
       seller_email text,
       seller_name  text,
       amount_usd  numeric not null,
       vnd         bigint,
       ref         text,
       note        text,
       status      text not null default 'pending',   -- pending | received | rejected
       txn_id      text,                               -- VietQR/provider transaction id (filled on credit)
       created_at  timestamptz default now(),
       confirmed_at timestamptz,
       confirmed_by uuid)`).catch(() => {});
  q(`alter table topup_requests add column if not exists txn_id text`).catch(() => {});
  q(`alter table topup_requests add column if not exists method text`).catch(() => {});
  q(`alter table topup_requests add column if not exists attachment text`).catch(() => {});

  // Seller creates a pending top-up (after they've transferred via VietQR).
  app.post('/api/topups', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    const amount = Number(b.amount) || 0;
    // Enforce the admin-set top-up minimum (default $200) — same settings key vietqr.js writes.
    // Client gates too, but this is the boundary a direct API call hits.
    try {
      const mr = await q("select value from settings where key='vqr_min_usd'");
      const floor = mr.rows[0] != null && mr.rows[0].value !== '' && mr.rows[0].value != null
        ? Math.max(0, Math.round(Number(mr.rows[0].value) || 0)) : 200;
      if (amount < floor) { reply.code(400); return { error: `Minimum top-up is $${floor}.` }; }
    } catch { /* settings unreadable — don't block a legitimate transfer */ }
    const r = await q(
      `insert into topup_requests (seller_id, seller_email, seller_name, amount_usd, vnd, ref, note, method, attachment, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') returning *`,
      [req.user.sub, req.user.email || null, b.name || null, Number(b.amount) || 0, Math.round(Number(b.vnd) || 0), b.ref || null, b.note || null, b.method || null, b.attachment || null]
    );
    // Best-effort: email the admins that a manual top-up is awaiting review. Fire-and-
    // forget so it NEVER blocks or fails the response (the pending row is the source of truth).
    (async () => {
      try {
        if (!mailConfigured()) return;
        const admins = await q("select email from users where role='admin' and email is not null and email <> ''");
        const amt = (Number(b.amount) || 0).toFixed(2);
        const who = req.user.email || b.name || 'A seller';
        const how = b.method ? (' via ' + b.method) : '';
        const subject = `Top-up pending review — $${amt}${how}`;
        const text = `${who} submitted a $${amt} top-up${how}. It's awaiting your confirmation in the Factory Wallet → Pending top-ups.`;
        for (const row of admins.rows) { if (row.email) sendMail({ to: row.email, subject, text }).catch(() => {}); }
      } catch (e) {}
    })();
    return r.rows[0];
  });

  // List: staff (admin/warehouse share the factory wallet) see all (optional
  // ?status=pending); sellers see only their own.
  /*
   * AGE OUT THE ONES NOBODY EVER PAID.
   *
   * A VietQR request is written the moment the QR is drawn, so opening the dialog and
   * closing it left a row in this queue forever. The client marks its own row abandoned on
   * close, but a force-quit, a dead battery or a lost connection never sends that — so age
   * is the backstop.
   *
   * THIRTY MINUTES, and only VietQR. Short is safe here precisely because aging does not
   * throw the request away: vietqr.js still settles an abandoned ref, so someone who saved
   * the QR and paid tomorrow is still credited. The window only decides how long an unpaid
   * request sits in a queue someone is supposed to act on — and nobody can act on a VietQR
   * request anyway, since it confirms itself on payment.
   *
   * A MANUAL transfer is genuinely waiting on a human to check a receipt and must never be
   * aged out from under them.
   *
   * 'abandoned', not deleted — the virtual account stays live and vietqr.js still settles an
   * abandoned ref if the money turns up late.
   */
  async function ageOutStale() {
    await q(`update topup_requests set status='abandoned'
              where method='VietQR' and status='pending'
                and created_at < now() - interval '30 minutes'`).catch(() => {});
  }

  app.get('/api/topups', { preHandler: requireAuth }, async (req) => {
    await ageOutStale();
    if (isStaff(req.user)) {
      const st = req.query && req.query.status;
      const r = st
        ? await q('select * from topup_requests where status=$1 order by created_at desc limit 200', [st])
        : await q("select * from topup_requests where status <> 'abandoned' order by created_at desc limit 200");
      return r.rows;
    }
    const r = await q(
      "select * from topup_requests where seller_id=$1 and status <> 'abandoned' order by created_at desc limit 100",
      [req.user.sub]);
    return r.rows;
  });

  // Admin/staff confirm a transfer was received → credits the seller (their wallet
  // polls this and credits itself).
  app.post('/api/topups/:id/confirm', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const r = await q(
      "update topup_requests set status='received', confirmed_at=now(), confirmed_by=$2 where id=$1 and status='pending' returning *",
      [req.params.id, req.user.sub]
    );
    const rec = r.rows[0];
    if (!rec) { reply.code(404); return { error: 'Not found or already processed' }; }
    // Credit the SELLER's wallet the instant an admin approves — append-only and
    // idempotent by (account,type,ref) with ref=the topup id (the same ref the client
    // reconciler uses), so it can never double-credit. No more slow client polling.
    if (rec.seller_id) {
      await q(
        `insert into wallet_ledger (account, delta, type, ref, note, created_by)
         values ($1,$2,'topup',$3,$4,$5) on conflict do nothing`,
        [rec.seller_id, Number(rec.amount_usd) || 0, String(rec.id), (rec.method ? rec.method + ' top-up' : 'Wallet top-up'), req.user.sub]
      ).catch(() => {});

      /**
       * THE TRANSFER FEE, entered at the moment it becomes knowable.
       *
       * $2,446 has arrived through PingPong, VietQR and bank transfer, and every one of
       * those takes a cut that nobody can predict at the time the seller submits — it
       * depends on their bank, the corridor and the day's FX. It is only knowable when the
       * money lands, which is this moment, by the person looking at what actually arrived.
       * (Card processing, where a percentage rule WOULD work, has never completed a single
       * top-up here: PayPal's attempts were all rejected and the Stripe key is expired.)
       *
       * TWO ROWS, NOT ONE NET CREDIT. Crediting $980 for a $1,000 transfer would show the
       * seller a number they cannot reconcile against the amount they sent, and would look
       * exactly like being short-changed. So the full amount is credited and the fee is a
       * separate, named debit they can read: "you sent 1,000, the transfer cost 20".
       *
       * Idempotent on its own ref, so confirming twice cannot charge the fee twice.
       */
      const fee = Number((req.body && (req.body.fee ?? req.body.transferFee)) || 0);
      if (isFinite(fee) && fee > 0) {
        await q(
          `insert into wallet_ledger (account, delta, type, ref, note, created_by)
           values ($1,$2,'topup-fee',$3,$4,$5) on conflict do nothing`,
          [rec.seller_id, -Math.abs(fee), `fee-${rec.id}`,
           `${rec.method || 'Transfer'} fee on $${(Number(rec.amount_usd) || 0).toFixed(2)} top-up`,
           req.user.sub]
        ).catch(() => {});
      }
    }
    return rec;
  });

  // Admin/staff reject a top-up (e.g. money never arrived) → status flips to 'rejected'
  // (NO credit). The seller's wallet reads this and shows the row as Rejected.
  app.post('/api/topups/:id/reject', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const r = await q(
      "update topup_requests set status='rejected', confirmed_at=now(), confirmed_by=$2 where id=$1 and status='pending' returning *",
      [req.params.id, req.user.sub]
    );
    if (!r.rows[0]) { reply.code(404); return { error: 'Not found or already processed' }; }
    return r.rows[0];
  });
}
