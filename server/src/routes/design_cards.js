// Design-cards API. Staff (operator/admin/warehouse/designer) read+write all;
// a seller may read the cards tied to their own orders. Frontend sends the FULL
// list (DB-shaped) on change → upsert all + drop removed (staff only).
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { moveFunds } from './wallet.js';
import { audit } from '../audit.js';

export function designCardsRoutes(app, requireAuth, requireStaff, requireAdmin) {
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

  /**
   * Credit the designer who actually did the work, when a card is approved.
   *
   * Server-side because it decides who gets paid, which a client must not. Two rules:
   *
   *  1. Only a DESIGNER earns a design payout. Operator, warehouse and admin can upload
   *     files too — that's part of running the floor, not billable design work — so an
   *     approval on their card credits nobody.
   *  2. The payout follows the CLAIM, not the board. A shared board means several
   *     designers work the same queue; paying a common pool would pay whoever happens to
   *     collect it rather than whoever cut the file.
   *
   * Falls back to the shared 'designer' account only when the claimer can't be resolved
   * to a real designer — better a pooled credit than a silently dropped one.
   */
  app.post('/api/design_cards/:id/credit', { preHandler: requireStaff }, async (req, reply) => {
    const amount = Math.max(0, Number((req.body || {}).amount) || 0);
    if (!amount) { reply.code(400); return { error: 'amount required' }; }
    const card = await q('select id, title, claimed_by, credited from design_cards where id=$1::bigint', [String(req.params.id)])
      .then((r) => r.rows[0]).catch(() => null);
    if (!card) { reply.code(404); return { error: 'Card not found' }; }
    if (card.credited) return { ok: true, already: true };

    // Resolve the claimer by name or email — the board records whichever it has.
    const who = String(card.claimed_by || '').trim();
    let target = null, role = null;
    if (who) {
      const u = await q(
        "select id, role from users where lower(email)=lower($1) or lower(name)=lower($1) limit 1", [who]
      ).then((r) => r.rows[0]).catch(() => null);
      if (u) { target = u.id; role = u.role; }
    }

    // Rule 1 — staff uploads aren't billable design work.
    if (role && role !== 'designer') {
      return { ok: true, credited: false, reason: 'not-a-designer' };
    }
    const account = target && role === 'designer' ? String(target) : 'designer';
    await moveFunds({
      from: 'factory', to: account, amount,
      type: 'design-pay', ref: `DSN-${card.id}`,
      note: `Design payout · ${card.title || card.id}`,
    });
    await q('update design_cards set credited=true, pay_status=$2, payment=$3 where id=$1::bigint',
      [String(card.id), 'paid', amount]).catch(() => {});
    audit(req, 'design.credited', { entityType: 'design_card', entityId: String(card.id), after: { account, amount } });
    return { ok: true, credited: true, account };
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
    // Cast explicitly. design_cards.id is bigint, but node-pg returns bigint as a STRING,
    // so a client round-trip sends string ids back — Postgres then infers text[] and
    // `bigint <> text[]` throws. The upserts had already succeeded, so a deleted card
    // silently reappeared on the next load: the delete was the only part that failed, and
    // the client swallowed the error.
    const ids = rows.map((c) => String(c.id)).filter((x) => x && x !== 'null');
    if (ids.length) await q('delete from design_cards where id <> all($1::bigint[])', [ids]);
    return { ok: true, count: rows.length };
  });

  // Wipe the whole Design Board (the "Clear board" action). ADMIN-only — it clears
  // the shared board for everyone. The empty POST above intentionally can't do
  // this (it skips the delete when sent []), so clearing needs its own endpoint.
  app.delete('/api/design_cards', { preHandler: requireAdmin }, async () => {
    await q('delete from design_cards');
    return { ok: true };
  });
}
