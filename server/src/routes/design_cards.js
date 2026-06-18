// Design-cards API. Staff (operator/admin/warehouse/designer) read+write all;
// a seller may read the cards tied to their own orders. Frontend sends the FULL
// list (DB-shaped) on change → upsert all + drop removed (staff only).
import { q } from '../db.js';
import { isStaff } from '../auth.js';

export function designCardsRoutes(app, requireAuth, requireStaff) {
  app.get('/api/design_cards', { preHandler: requireAuth }, async (req) => {
    if (isStaff(req.user)) {
      const r = await q('select * from design_cards order by id');
      return r.rows;
    }
    // seller → only cards for their own orders
    const r = await q(
      `select c.* from design_cards c
       join orders o on o.id = c.order_id
       where o.seller_id = $1 order by c.id`,
      [req.user.sub]
    );
    return r.rows;
  });

  app.post('/api/design_cards', { preHandler: requireStaff }, async (req) => {
    const rows = Array.isArray(req.body) ? req.body : [];
    for (const c of rows) {
      if (c.id == null) continue;
      await q(
        `insert into design_cards
           (id, order_id, sku, design_id, title, col, type, product, priority, due,
            assignee, claimed_by, payment, pay_status, is_emb, emb_file_name, thumb,
            thumb_ref, files, specs, notes, history, checklist)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         on conflict (id) do update set
           order_id=excluded.order_id, sku=excluded.sku, design_id=excluded.design_id,
           title=excluded.title, col=excluded.col, type=excluded.type, product=excluded.product,
           priority=excluded.priority, due=excluded.due, assignee=excluded.assignee,
           claimed_by=excluded.claimed_by, payment=excluded.payment, pay_status=excluded.pay_status,
           is_emb=excluded.is_emb, emb_file_name=excluded.emb_file_name, thumb=excluded.thumb,
           thumb_ref=excluded.thumb_ref, files=excluded.files, specs=excluded.specs,
           notes=excluded.notes, history=excluded.history, checklist=excluded.checklist,
           updated_at=now()`,
        [c.id, c.order_id || null, c.sku || null, c.design_id || null, c.title || null,
         c.col || 'incoming', c.type || null, c.product || null, c.priority || 'normal', c.due || null,
         c.assignee || null, c.claimed_by || null, c.payment || 0, c.pay_status || 'pending',
         !!c.is_emb, c.emb_file_name || null, c.thumb || null, c.thumb_ref || null,
         JSON.stringify(c.files || []), JSON.stringify(c.specs || {}), JSON.stringify(c.notes || []),
         JSON.stringify(c.history || []), JSON.stringify(c.checklist || [])]
      );
    }
    const ids = rows.map((c) => c.id).filter((x) => x != null);
    if (ids.length) await q('delete from design_cards where id <> all($1)', [ids]);
    return { ok: true, count: rows.length };
  });

  // Wipe the whole Design Board (the "Clear board" action). Staff-only; the empty
  // POST above intentionally can't do this (it skips the delete when sent []), so
  // clearing needs its own explicit endpoint.
  app.delete('/api/design_cards', { preHandler: requireStaff }, async () => {
    await q('delete from design_cards');
    return { ok: true };
  });
}
