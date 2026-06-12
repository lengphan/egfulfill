// Per-seller "my uploads" design library — the re-add gallery in Design Maker.
// Stored SERVER-side, never localStorage: each entry is a multi-MB image data URL,
// and 20 of them blew the browser's ~5MB localStorage cap, which then evicted the
// order list (orders silently vanished). The server is the right home for images.
import { q } from '../db.js';

export function designLibraryRoutes(app, requireAuth) {
  q(`create table if not exists design_library (
       id          serial primary key,
       seller_id   uuid references users(id) on delete cascade,
       name        text,
       data        text,
       created_at  timestamptz default now()
     )`).catch(() => {});
  q('create index if not exists design_library_seller_idx on design_library(seller_id, created_at desc)').catch(() => {});

  const CAP = 30; // keep the N most-recent uploads per seller

  // List this seller's recent uploads (newest first).
  app.get('/api/design_library', { preHandler: requireAuth }, async (req) => {
    const r = await q(
      'select id, name, data, created_at from design_library where seller_id=$1 order by created_at desc limit $2',
      [req.user.sub, CAP]
    );
    return r.rows;
  });

  // Save an upload. Dedupe by (seller, name) — matches the client's re-use dedupe —
  // then trim older entries beyond CAP so the library can't grow unbounded.
  app.post('/api/design_library', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    if (!b.data) { reply.code(400); return { error: 'data required' }; }
    if (b.name) await q('delete from design_library where seller_id=$1 and name=$2', [req.user.sub, b.name]).catch(() => {});
    const r = await q(
      'insert into design_library (seller_id, name, data) values ($1,$2,$3) returning id, name, data, created_at',
      [req.user.sub, b.name || 'Untitled', b.data]
    );
    await q(
      `delete from design_library where seller_id=$1 and id not in (
         select id from design_library where seller_id=$1 order by created_at desc limit $2)`,
      [req.user.sub, CAP]
    ).catch(() => {});
    return r.rows[0];
  });

  // Remove one (only the seller's own).
  app.delete('/api/design_library/:id', { preHandler: requireAuth }, async (req) => {
    await q('delete from design_library where id=$1 and seller_id=$2', [req.params.id, req.user.sub]).catch(() => {});
    return { ok: true };
  });
}
