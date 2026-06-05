// Manual VietQR top-up reconciliation. Until VietQR's auto-callback is live (or
// as a fallback), a seller clicks "I've transferred" → a PENDING top-up is created
// here and the admin sees it in the Factory Wallet with a "Received" button. When
// an admin/staff confirms, status flips to 'received' and the seller's wallet
// (polling its own top-ups) credits itself.
import { q } from '../db.js';
import { isStaff } from '../auth.js';

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

  // Seller creates a pending top-up (after they've transferred via VietQR).
  app.post('/api/topups', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    const r = await q(
      `insert into topup_requests (seller_id, seller_email, seller_name, amount_usd, vnd, ref, note, status)
       values ($1,$2,$3,$4,$5,$6,$7,'pending') returning *`,
      [req.user.sub, req.user.email || null, b.name || null, Number(b.amount) || 0, Math.round(Number(b.vnd) || 0), b.ref || null, b.note || null]
    );
    return r.rows[0];
  });

  // List: staff (admin/warehouse share the factory wallet) see all (optional
  // ?status=pending); sellers see only their own.
  app.get('/api/topups', { preHandler: requireAuth }, async (req) => {
    if (isStaff(req.user)) {
      const st = req.query && req.query.status;
      const r = st
        ? await q('select * from topup_requests where status=$1 order by created_at desc limit 200', [st])
        : await q('select * from topup_requests order by created_at desc limit 200');
      return r.rows;
    }
    const r = await q('select * from topup_requests where seller_id=$1 order by created_at desc limit 100', [req.user.sub]);
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
    if (!r.rows[0]) { reply.code(404); return { error: 'Not found or already processed' }; }
    return r.rows[0];
  });

  // Admin/staff reject a top-up (e.g. money never arrived).
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
