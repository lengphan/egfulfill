// Design-cards API. Staff (operator/admin/warehouse/designer) read+write all;
// a seller may read the cards tied to their own orders. Frontend sends the FULL
// list (DB-shaped) on change → upsert all + drop removed (staff only).
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { moveFunds } from './wallet.js';
import { audit } from '../audit.js';
import { notify } from './notifications.js';
import { bookDesignCost } from './pinkdesign.js';
import { storageEnabled, fromDataUrl, designUrlTtlDays, presignGet, publicUrl } from '../storage.js';
import { putObject } from '../storage.js';
import { hashOf } from '../fingerprint.js';

export function designCardsRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse) {
  // Where this card's design work happens. null = our own designers (the default and the
  // whole history of this table). A value means it's OUTSOURCED — e.g. 'pinkdesign' —
  // because our designers are embroidery specialists and DTG/DTF goes to a partner.
  // vendor_ref holds the partner's own task id, so their webhooks can find the card.
  q('alter table design_cards add column if not exists vendor text').catch(() => {});
  q('alter table design_cards add column if not exists vendor_ref text').catch(() => {});
  // Pink's task carries TWO ids: ref_id (what they send us on push = our primary match key,
  // stored in vendor_ref) and their internal task_id. We keep the task_id too so the board
  // can show BOTH — their test-webhook form asks for each.
  q('alter table design_cards add column if not exists vendor_task_id text').catch(() => {});
  // Deliverable links the partner RETURNED (via their webhook) — so the card can show
  // "Received from <partner>". Often a Google Drive folder we can't copy, so the link
  // itself is what's kept.
  q("alter table design_cards add column if not exists vendor_files jsonb default '[]'::jsonb").catch(() => {});
  // Notes WE post to the partner's task. Their board can't send comments back, so this is
  // our own running record of what we asked for — "change to New", "please cancel" — kept
  // APART from the design description. Append-only; the whole-list card save never lists
  // this column, so a board drag/edit can't wipe the log.
  q("alter table design_cards add column if not exists partner_notes jsonb default '[]'::jsonb").catch(() => {});
  // The exact image URLs we sent to the partner on push — so the card can show a small
  // "this is what we sent" preview. Not listed in the whole-list save, so a board edit
  // can't wipe it.
  q("alter table design_cards add column if not exists pushed_images jsonb default '[]'::jsonb").catch(() => {});
  // Which ORDER LINE this card is for. The client has always sent it (orders-hub builds
  // every card with line_id) but no column existed, so it was dropped on every save and
  // read back as null. That broke the "already has a card" check, which falls back to
  // matching on sku alone — and two lines of the same sku are different jobs, so a second
  // line either silently reused the first card or duplicated it. See CLAUDE.md §5.
  q('alter table design_cards add column if not exists line_id text').catch(() => {});
  // A MANUAL card carries its own artwork, because it exists before any order does. The
  // bytes go to object storage under the SAME namespace order designs use — identical
  // content whichever door it came in by — so assigning the card to an order later is a
  // key copy rather than a re-upload.
  q('alter table design_cards add column if not exists art_key text').catch(() => {});
  q('alter table design_cards add column if not exists art_hash text').catch(() => {});
  q('alter table design_cards add column if not exists art_data text').catch(() => {});
  // Who made it and when — a manual card has no order to inherit provenance from.
  q('alter table design_cards add column if not exists created_by text').catch(() => {});
  q('alter table design_cards add column if not exists created_at timestamptz default now()').catch(() => {});

  const artUrlOf = (row) => {
    if (!row || !row.art_key) return null;
    return designUrlTtlDays() > 0 ? presignGet(row.art_key) : publicUrl(row.art_key);
  };
  const extFromMime = (mime) => {
    const m = String(mime || '').toLowerCase();
    if (m.includes('png')) return '.png';
    if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
    if (m.includes('webp')) return '.webp';
    if (m.includes('svg')) return '.svg';
    if (m.includes('pdf')) return '.pdf';
    return '';
  };

  /**
   * Create ONE card that belongs to no order.
   *
   * Every card until now was born from an order line, and the whole-list upsert below
   * skips rows with no id — so there was no way to create one at all. This is the door for
   * work that arrives before an order exists: a seller emails artwork, someone drops a file
   * on the board, a design gets made speculatively.
   *
   * Deliberately NOT part of the bulk upsert. That endpoint replaces the board wholesale
   * from client state; a create that went through it would race any other tab saving at the
   * same time, and losing a just-uploaded design to someone else's stale board is not a
   * recoverable mistake.
   */
  app.post('/api/design_cards/new', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) { reply.code(400); return { error: 'Give the card a name — an untitled card is unfindable the moment there are two.' }; }
    const data = b.data ? String(b.data) : null;

    let artKey = null, artHash = null, artData = null;
    if (data) {
      artHash = hashOf(data);
      if (storageEnabled()) {
        try {
          const parsed = fromDataUrl(data);
          // Same namespace as order designs: the bytes are the same thing, and assigning
          // this card to an order should not have to move or duplicate them.
          const key = `order-designs/${artHash}${extFromMime(parsed.mime)}`;
          await putObject(key, parsed.buffer, parsed.mime, designUrlTtlDays() > 0 ? 'private' : 'public-read');
          artKey = key;
        } catch (e) {
          // Storage off or failing must not lose the upload — fall back to inline, exactly
          // as the order-design path does.
          req.log?.warn?.({ err: e }, 'manual design card upload failed - keeping inline');
          artData = data;
        }
      } else {
        artData = data;
      }
    }

    const r = await q(
      `insert into design_cards (title, type, col, sku, order_id, line_id, art_key, art_hash, art_data, thumb, created_by)
       values ($1,$2,'incoming',$3,null,null,$4,$5,$6,$7,$8)
       returning *`,
      [title, b.type ? String(b.type) : null, b.sku ? String(b.sku) : null,
       artKey, artHash, artData, artKey ? null : artData, String((req.user && req.user.sub) || '')]
    ).catch((e) => { reply.code(500); return { error: e.message }; });
    if (!r || r.error) return r || { error: 'Could not create the card.' };

    const row = r.rows[0];
    audit(req, 'design.card.created', { entityType: 'design_card', entityId: String(row.id), after: { title, manual: true } });
    return { ...row, thumb: artUrlOf(row) || row.art_data || row.thumb };
  });

  /**
   * Attach a card to an order line.
   *
   * THE JOIN BETWEEN THE TWO SYSTEMS, and the part most likely to go quietly wrong. Setting
   * order_id alone would give you a card that points at an order whose design tag still
   * reads empty — the board says the work is done, the order says no artwork was ever
   * attached, and both are reading their own table honestly. So the artwork is written into
   * order_designs in the same request, which is what every reader of "does this line have a
   * design" actually consults.
   *
   * No re-upload: the card already stored its bytes under the order-design namespace, so
   * this copies the key. When storage is off both sides hold the same inline data.
   */
  app.post('/api/design_cards/:id/assign', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const orderId = String(b.orderId || '').trim();
    const sku = String(b.sku || '').trim();
    if (!orderId || !sku) { reply.code(400); return { error: 'An order and a line are both required — a card on an order but no line belongs to no job.' }; }

    const card = await q('select * from design_cards where id=$1::bigint', [String(req.params.id)])
      .then((r) => r.rows[0]).catch(() => null);
    if (!card) { reply.code(404); return { error: 'Card not found.' }; }
    if (card.order_id) { reply.code(409); return { error: `Already assigned to order ${card.order_id}. Detach it there first — silently moving a design between orders is how one seller's artwork ends up on another's job.` }; }

    const order = await q('select id from orders where id=$1', [orderId]).then((r) => r.rows[0]).catch(() => null);
    if (!order) { reply.code(404); return { error: 'No such order.' }; }

    // The artwork has to exist, or this "assignment" attaches nothing and the order's
    // design tag stays dark while the board claims otherwise.
    if (!card.art_key && !card.art_data && !card.thumb) {
      reply.code(400);
      return { error: 'This card has no artwork, so there is nothing to attach to the order.' };
    }

    // line_id, not just sku. Two lines of the same sku are different jobs, so attaching by
    // sku alone would put this artwork on whichever sibling the key happened to reach and
    // leave the other showing it too.
    const lineId = b.lineId ? String(b.lineId) : null;
    await q(
      `insert into order_designs (order_id, sku, line_id, kind, data, storage_key, name, art_hash, updated_at)
       values ($1,$2,$7,'raster',$3,$4,$5,$6, now())
       on conflict (order_id, (coalesce('L:' || line_id, 'S:' || sku)), kind) do update set
         data=excluded.data, storage_key=excluded.storage_key, name=excluded.name,
         art_hash=excluded.art_hash, updated_at=now()`,
      [orderId, sku, card.art_data || null, card.art_key || null, card.title || null, card.art_hash || null, lineId]
    );

    await q('update design_cards set order_id=$2, line_id=$3, sku=$4 where id=$1::bigint',
      [String(card.id), orderId, lineId, sku]);

    audit(req, 'design.card.assigned', {
      entityType: 'design_card', entityId: String(card.id),
      after: { orderId, sku, lineId: b.lineId || null },
    });
    // Audited against the ORDER too. Someone auditing an order should not have to know a
    // design board exists to find out where its artwork came from.
    audit(req, 'design.saved', { entityType: 'order', entityId: orderId, after: { sku, via: 'design-card', cardId: String(card.id) } });
    return { ok: true, orderId, sku };
  });


  /**
   * Board history — every audited board action, deletions foremost, newest first.
   *
   * Its own endpoint rather than the general /api/audit feed because THAT one is admin-only,
   * and this is warehouse-and-admin: the same people who may delete a card are the ones who
   * need to see what was deleted and by whom. Scoped to entity_type='design_card', so it's
   * the board's story and nothing else — a warehouse reading it never sees orders, wallet
   * or seller data it isn't entitled to.
   *
   * Declared BEFORE '/api/design_cards/:id' so the static path wins the route match.
   */
  app.get('/api/design_cards/history', { preHandler: requireWarehouse }, async () => {
    const r = await q(
      `select id, ts, action, actor as actor_email, actor_name, actor_role,
              entity_id, before, after, note
         from audit_log
        where entity_type = 'design_card'
        order by ts desc, id desc limit 300`).catch(() => ({ rows: [] }));
    return r.rows;
  });

  app.get('/api/design_cards', { preHandler: requireAuth }, async (req) => {
    if (isStaff(req.user)) {
      // claimed_role resolves the CLAIMER to a role the SAME way the credit route does, so
      // the board can show whether a payout will actually pay out (designers only) instead of
      // implying a credit the server would refuse for an operator/warehouse/admin claim.
      const r = await q(
        `select *,
           (select role from users u
              where lower(u.email) = lower(design_cards.claimed_by)
                 or lower(u.name)  = lower(design_cards.claimed_by)
              limit 1) as claimed_role,
           (select count(*)::int from design_file_data f
              where f.order_id = design_cards.order_id) as file_count
           from design_cards order by id`);
      // Manual cards keep their artwork in object storage, and a signed URL expires — so it
      // is minted per read rather than stored. `thumb` is what every client already renders,
      // so the URL goes there and nothing downstream needs to know where it came from.
      return r.rows.map((row) => {
        // A VENDOR card's avatar should be the design we actually SENT — the card's own art
        // can differ from what went out (e.g. an attached reference became the artwork on
        // push), and showing the wrong image is worse than showing the real one.
        const pushed = Array.isArray(row.pushed_images) ? row.pushed_images : [];
        const thumb = (row.vendor && pushed[0]) ? pushed[0] : (artUrlOf(row) || row.art_data || row.thumb);
        return { ...row, thumb };
      });
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
    // Named apart from the `ids` used by the prune below: that one is the set to KEEP,
    // this one is the set to read lanes from. Same shape, opposite purpose.
    const priorIds = rows.map((c) => c.id).filter((v) => v != null).map(String);
    // Read the CURRENT lanes before writing. A card coming back — approved, or bounced to
    // Fix — was completely silent: this endpoint is the only place lanes change, and it
    // notified nobody, so "when the design comes back you'd know" was only true for someone
    // already staring at the board. The before/after pair is the only place that transition
    // is visible; once the upsert runs it's gone.
    const before = new Map();
    if (priorIds.length) {
      const ex = await q(
        'select id, vendor, vendor_ref, claimed_by, col, title, order_id from design_cards where id = any($1::bigint[])',
        [priorIds]
      ).catch(() => ({ rows: [] }));
      for (const r of ex.rows) before.set(String(r.id), r);
    }
    let guarded = null;
    if (isDesigner) {
      guarded = new Map();
      for (const [id, r] of before.entries()) if (r.vendor) guarded.set(id, r);
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
            thumb_ref, files, specs, notes, history, checklist, vendor, vendor_ref, line_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         on conflict (id) do update set
           order_id=excluded.order_id, sku=excluded.sku, design_id=excluded.design_id,
           title=excluded.title, col=excluded.col, type=excluded.type, product=excluded.product,
           priority=excluded.priority, due=excluded.due, assignee=excluded.assignee,
           claimed_by=excluded.claimed_by, payment=excluded.payment, pay_status=excluded.pay_status,
           is_emb=excluded.is_emb, emb_file_name=excluded.emb_file_name, thumb=excluded.thumb,
           thumb_ref=excluded.thumb_ref, files=excluded.files, specs=excluded.specs,
           notes=excluded.notes, history=excluded.history, checklist=excluded.checklist,
           vendor=excluded.vendor, vendor_ref=excluded.vendor_ref, line_id=excluded.line_id,
           updated_at=now()`,
        [c.id, c.order_id || null, c.sku || null, c.design_id || null, c.title || null,
         c.col || 'incoming', c.type || null, c.product || null, c.priority || 'normal', c.due || null,
         c.assignee || null, c.claimed_by || null, c.payment || 0, c.pay_status || 'pending',
         !!c.is_emb, c.emb_file_name || null, c.thumb || null, c.thumb_ref || null,
         JSON.stringify(c.files || []), JSON.stringify(c.specs || {}), JSON.stringify(c.notes || []),
         JSON.stringify(c.history || []), JSON.stringify(c.checklist || []),
         c.vendor || null, c.vendor_ref || null, c.line_id || null]
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
    /**
     * Tell the floor when a card comes back.
     *
     * Only the transitions someone is waiting on. A card moving incoming → in progress is
     * a designer picking up work and needs no announcement; approved and fix are the two
     * that hand the job BACK, and they were both silent.
     *
     * Role fan-out to operator/warehouse/admin, excluding whoever moved it — the person
     * who dragged the card does not need telling what they just did, and in a shared queue
     * that self-notification is most of the noise.
     */
    for (const c of rows) {
      if (c.id == null) continue;
      const prev = before.get(String(c.id));
      if (!prev) continue;
      const from = String(prev.col || '').toLowerCase();
      const to = String(c.col || '').toLowerCase();
      if (from === to) continue;
      const label = prev.title || c.title || `Card ${c.id}`;
      if (to === 'approved') {
        notify({
          roles: ['operator', 'warehouse', 'admin'], excludeUserId: req.user && req.user.sub,
          type: 'design-card', title: 'Design approved',
          body: label, entityId: String(c.id),
          href: c.order_id || prev.order_id ? `/operator?order=${c.order_id || prev.order_id}` : '/designer',
        }).catch(() => {});
      } else if (to === 'fix') {
        notify({
          roles: ['operator', 'warehouse', 'admin'], excludeUserId: req.user && req.user.sub,
          // Says what is needed, not just what happened — "sent back" without "needs
          // changes" reads as a status rather than a request.
          type: 'design-card', title: 'Design sent back — needs changes',
          body: label, entityId: String(c.id),
          href: c.order_id || prev.order_id ? `/operator?order=${c.order_id || prev.order_id}` : '/designer',
        }).catch(() => {});
      }
      audit(req, 'design.lane', { entityType: 'design_card', entityId: String(c.id), before: { col: from }, after: { col: to } });
    }
    return { ok: true, count: rows.length };
  });

  /**
   * Delete ONE card.
   *
   * The board previously removed a card by POSTing the entire board back minus that card
   * and letting the server drop whatever was missing. Every card carries a base64 `thumb`,
   * so on a busy board that payload is enormous — and if it exceeded the body limit, or
   * any single upsert failed, the request died, the delete never ran, and the card
   * reappeared on reload. The client swallowed the error, so it looked like nothing
   * happened. That is why one card could survive repeated attempts.
   *
   * An explicit delete carries one id. It cannot be too big to send, it cannot half-apply,
   * and it fails loudly.
   *
   * WAREHOUSE or ADMIN only. Removing a card destroys the record of work someone did —
   * that is a custody decision, not a board tidy, so an operator or designer cannot make
   * it. Deliberately narrower than the rest of this file, which is requireStaff.
   *
   * What was PAID survives regardless: design costs and designer credits live in
   * wallet_ledger, which is append-only and keyed by a ref string rather than a foreign
   * key to this table. Deleting the card frees the row and leaves the money history
   * intact. The audit entry below records what the card was worth at the moment it went,
   * so the ledger can still be explained afterwards.
   */
  app.delete('/api/design_cards/:id', { preHandler: requireWarehouse }, async (req, reply) => {
    const id = String(req.params.id || '').trim();
    if (!/^\d+$/.test(id)) { reply.code(400); return { error: 'Card id must be numeric.' }; }
    const before = await q(
      `select id, order_id, sku, title, col, payment, pay_status, claimed_by, vendor, vendor_ref
         from design_cards where id=$1::bigint`, [id]
    ).then((r) => r.rows[0]).catch(() => null);
    if (!before) { reply.code(404); return { error: 'No such card.' }; }
    const r = await q('delete from design_cards where id=$1::bigint', [id]);
    // Record the money-bearing fields, not just "a card was deleted" — otherwise a
    // ledger entry for a card that no longer exists has nothing to point back at.
    audit(req, 'design_card.deleted', {
      entityType: 'design_card', entityId: id,
      before: {
        order_id: before.order_id, sku: before.sku, title: before.title, col: before.col,
        payment: before.payment, pay_status: before.pay_status,
        claimed_by: before.claimed_by, vendor: before.vendor, vendor_ref: before.vendor_ref,
      },
    });
    return { ok: true, deleted: r.rowCount, card: before };
  });

  // Wipe the whole Design Board (the "Clear board" action). ADMIN-only — it clears
  // the shared board for everyone. The empty POST above intentionally can't do
  // this (it skips the delete when sent []), so clearing needs its own endpoint.
  app.delete('/api/design_cards', { preHandler: requireAdmin }, async () => {
    await q('delete from design_cards');
    return { ok: true };
  });
}
