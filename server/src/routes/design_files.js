// Machine deliverable files (.pes/.emb/.dst/.exp/.jef/.vp3) stored SERVER-SIDE — the raw bytes the
// client used to keep only in localStorage (eg_design_files), which vanished on a cache clear and
// never reached another device. Bytes are stored inline as a base64 data-URL string, keyed by the
// design id (DL-…/DSN-…). Access-controlled: staff any; a seller only their OWN files (seller_id,
// resolved from the order the design belongs to; a seller's active team member counts as the owner).
import { q } from '../db.js';
import { isStaff } from '../auth.js';

export function designFilesRoutes(app, requireAuth) {
  q(`create table if not exists design_file_data (
       design_id    text primary key,
       order_id     text,
       sku          text,
       seller_id    uuid,
       file_name    text,
       mime         text,
       data         text,
       content_hash text,
       created_at   timestamptz default now(),
       updated_at   timestamptz default now()
     )`).catch(() => {});

  // Effective owner for a request (a team member acts as the owner; a plain seller is themselves).
  async function effectiveSeller(user) {
    if (!user || isStaff(user)) return null;   // staff → no seller filter (see all)
    try {
      const r = await q("select owner_id from team_members where lower(email)=lower($1) and status='active' limit 1", [user.email || '']);
      if (r.rows[0] && r.rows[0].owner_id) return r.rows[0].owner_id;
    } catch (e) {}
    return user.sub;
  }
  async function ownerOfOrder(orderId, fallback) {
    if (orderId) { try { const r = await q('select seller_id from orders where id=$1', [orderId]); if (r.rows[0] && r.rows[0].seller_id) return r.rows[0].seller_id; } catch (e) {} }
    return fallback;
  }

  // Save/replace a machine file. Staff (the factory uploads the .PES) or the owning seller.
  // body: { designId, data (base64 data-URL), orderId?, sku?, name?, mime?, hash? }
  app.post('/api/design_files', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    if (!b.designId || !b.data) { reply.code(400); return { error: 'designId + data required' }; }
    const seller = await ownerOfOrder(b.orderId, req.user.sub);
    // A non-staff caller may only write under their OWN order/design.
    if (!isStaff(req.user) && seller && seller !== (await effectiveSeller(req.user))) { reply.code(403); return { error: 'forbidden' }; }
    await q(
      `insert into design_file_data (design_id, order_id, sku, seller_id, file_name, mime, data, content_hash, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now(), now())
       on conflict (design_id) do update set
         order_id=coalesce(excluded.order_id, design_file_data.order_id),
         sku=coalesce(excluded.sku, design_file_data.sku),
         seller_id=coalesce(excluded.seller_id, design_file_data.seller_id),
         file_name=excluded.file_name, mime=excluded.mime, data=excluded.data,
         content_hash=excluded.content_hash, updated_at=now()`,
      [String(b.designId), b.orderId || null, b.sku || null, seller || null, b.name || null, b.mime || null, String(b.data), b.hash || null]);
    return { ok: true };
  });

  // Download a machine file. Staff any; a seller only their own (by seller_id).
  app.get('/api/design_files/:designId', { preHandler: requireAuth }, async (req, reply) => {
    const r = await q('select design_id, order_id, sku, seller_id, file_name, mime, data from design_file_data where design_id=$1', [String(req.params.designId)]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (!isStaff(req.user)) {
      const eff = await effectiveSeller(req.user);
      if (row.seller_id && row.seller_id !== eff) { reply.code(403); return { error: 'forbidden' }; }
    }
    return { designId: row.design_id, orderId: row.order_id, sku: row.sku, name: row.file_name, mime: row.mime, data: row.data };
  });
}
