// Design-cards API. Staff (operator/admin/warehouse/designer) read+write all;
// a seller may read the cards tied to their own orders. Frontend sends the FULL
// list (DB-shaped) on change → upsert all + drop removed (staff only).
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { moveFunds } from './wallet.js';
import { audit } from '../audit.js';
import { bookDesignCost } from './pinkdesign.js';

export function designCardsRoutes(app, requireAuth, requireStaff, requireAdmin) {
  // Where this card's design work happens. null = our own designers (the default and the
  // whole history of this table). A value means it's OUTSOURCED — e.g. 'pinkdesign' —
  // because our designers are embroidery specialists and DTG/DTF goes to a partner.
  // vendor_ref holds the partner's own task id, so their webhooks can find the card.
  q('alter table design_cards add column if not exists vendor text').catch(() => {});
  q('alter table design_cards add column if not exists vendor_ref text').catch(() => {});

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
    const card = await q('select id, title, claimed_by, credited, vendor from design_cards where id=$1::bigint', [String(req.params.id)])
      .then((r) => r.rows[0]).catch(() => null);
    if (!card) { reply.code(404); return { error: 'Card not found' }; }
    if (card.credited) return { ok: true, already: true };
    // Rule 0 — an OUTSOURCED card was worked by a partner we pay by invoice. Crediting a
    // designer here would pay twice for one job: their invoice plus an internal payout to
    // whoever happened to be on the card.
    if (card.vendor) {
      return { ok: true, credited: false, reason: 'outsourced', vendor: card.vendor };
    }

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
    // A DESIGNER may not take an outsourced card. Our designers do embroidery; a DTG/DTF
    // card is being worked by a partner, and letting one claim it would put their name on
    // someone else's job and (via the credit path) make it look payable.
    //
    // Enforced by PRESERVING the stored values rather than rejecting: this endpoint is a
    // whole-list upsert, so a 403 would throw away every unrelated edit in the same save.
    // The vendor is read from the DB, never from the payload — otherwise a designer could
    // send vendor:null and claim it anyway. Factory roles are untouched: operator,
    // warehouse and admin can still move, delete, and attach files to these cards.
    const isDesigner = (req.user && req.user.role) === 'designer';
    let guarded = null;
    if (isDesigner) {
      const ids = rows.map((c) => c.id).filter((v) => v != null).map(String);
      guarded = new Map();
      if (ids.length) {
        const ex = await q(
          'select id, vendor, vendor_ref, claimed_by, col from design_cards where id = any($1::bigint[])',
          [ids]
        ).catch(() => ({ rows: [] }));
        for (const r of ex.rows) if (r.vendor) guarded.set(String(r.id), r);
      }
    }
    for (const c of rows) {
      if (c.id == null) continue;
      const lock = guarded && guarded.get(String(c.id));
      if (lock) {
        c.claimed_by = lock.claimed_by;   // can't put their name on a partner's job
        c.col = lock.col;                 // can't drag it through the lanes
        c.vendor = lock.vendor;           // can't un-outsource it to unlock the above
        c.vendor_ref = lock.vendor_ref;
      }
      await q(
        `insert into design_cards
           (id, order_id, sku, design_id, title, col, type, product, priority, due,
            assignee, claimed_by, payment, pay_status, is_emb, emb_file_name, thumb,
            thumb_ref, files, specs, notes, history, checklist, vendor, vendor_ref)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         on conflict (id) do update set
           order_id=excluded.order_id, sku=excluded.sku, design_id=excluded.design_id,
           title=excluded.title, col=excluded.col, type=excluded.type, product=excluded.product,
           priority=excluded.priority, due=excluded.due, assignee=excluded.assignee,
           claimed_by=excluded.claimed_by, payment=excluded.payment, pay_status=excluded.pay_status,
           is_emb=excluded.is_emb, emb_file_name=excluded.emb_file_name, thumb=excluded.thumb,
           thumb_ref=excluded.thumb_ref, files=excluded.files, specs=excluded.specs,
           notes=excluded.notes, history=excluded.history, checklist=excluded.checklist,
           vendor=excluded.vendor, vendor_ref=excluded.vendor_ref,
           updated_at=now()`,
        [c.id, c.order_id || null, c.sku || null, c.design_id || null, c.title || null,
         c.col || 'incoming', c.type || null, c.product || null, c.priority || 'normal', c.due || null,
         c.assignee || null, c.claimed_by || null, c.payment || 0, c.pay_status || 'pending',
         !!c.is_emb, c.emb_file_name || null, c.thumb || null, c.thumb_ref || null,
         JSON.stringify(c.files || []), JSON.stringify(c.specs || {}), JSON.stringify(c.notes || []),
         JSON.stringify(c.history || []), JSON.stringify(c.checklist || []),
         c.vendor || null, c.vendor_ref || null]
      );
    }
    // Cast explicitly. design_cards.id is bigint, but node-pg returns bigint as a STRING,
    // so a client round-trip sends string ids back — Postgres then infers text[] and
    // `bigint <> text[]` throws. The upserts had already succeeded, so a deleted card
    // silently reappeared on the next load: the delete was the only part that failed, and
    // the client swallowed the error.
    const ids = rows.map((c) => String(c.id)).filter((x) => x && x !== 'null');
    if (ids.length) await q('delete from design_cards where id <> all($1::bigint[])', [ids]);

    // An outsourced card reaching Approved is the moment we accept the partner's work,
    // so it's the moment their fee is owed. Read the vendor back from the DB rather than
    // trusting the payload — the same reason the designer guard above does.
    //
    // Best-effort and idempotent: this is a board save, and a bookkeeping row must never
    // be the thing that loses someone's drag. Re-saving an already-approved board books
    // nothing further.
    if (ids.length) {
      const approved = await q(
        `select id, order_id, sku, vendor from design_cards
          where id = any($1::bigint[]) and col='approved' and vendor is not null`,
        [ids]
      ).catch(() => ({ rows: [] }));
      for (const c of approved.rows) {
        await bookDesignCost({ orderId: c.order_id, sku: c.sku, cardId: c.id, vendor: c.vendor }).catch(() => {});
      }
    }
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
