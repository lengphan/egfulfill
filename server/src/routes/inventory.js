// Inventory API — factory data, staff only. The frontend sends the FULL list
// (DB-shaped rows) on every change; we upsert all and drop any SKUs no longer
// present, so the table mirrors the client. Empty body never wipes (safety).
import { q } from '../db.js';
// Receiving against a PO writes an audit entry and nudges both boards, the same way every
// other stock-moving route in this file's neighbourhood does.
import { audit } from '../audit.js';
import { egBroadcast } from '../events.js';


/**
 * Scan against seller-consigned stock.
 *
 * Picking a unit both REMOVES it and consumes the hold that was placed on it when the
 * order was submitted — so qty_received and qty_reserved fall together. Decrementing only
 * one would either leave phantom stock or strand a reservation against goods that have
 * already left the building.
 *
 * Returns null when the sku isn't consigned, so the caller can fall through to its 404.
 */
async function consignedScan(sku, delta, direction, qty, req, b) {
  const line = (await q(`
    select cl.*, s.seller_id, coalesce(nullif(u.name,''), u.email) as seller_name
      from consignment_lines cl
      join consignment_shipments s on s.id = cl.shipment_id
      left join users u on u.id = s.seller_id
     where upper(cl.internal_sku) = upper($1)
     limit 1`, [sku]).catch(() => ({ rows: [] }))).rows[0];
  if (!line) return null;

  if (direction === 'out') {
    const have = Number(line.qty_received) || 0;
    if (have < qty) {
      return { error: `Only ${have} of ${sku} on hand — can't pick ${qty}.`, consigned: true, onHand: have };
    }
    await q(`update consignment_lines
                set qty_received = greatest(0, qty_received - $1),
                    qty_reserved = greatest(0, qty_reserved - $1)
              where id = $2`, [qty, line.id]);
  } else {
    await q('update consignment_lines set qty_received = qty_received + $1 where id = $2', [qty, line.id]);
  }

  const after = (await q('select qty_received, qty_reserved, location from consignment_lines where id=$1', [line.id])).rows[0] || {};
  await q('insert into scan_history (sku, direction, qty, order_ref, by_id) values ($1,$2,$3,$4,$5)',
    [sku, direction, qty, b.order_ref || null, req.user?.sub || null]).catch(() => {});

  // Same shape the inventory path returns, so the scan station needs no special case —
  // plus whose it is and where it lives, which is what matters at the shelf.
  return {
    ok: true,
    consigned: true,
    item: {
      sku,
      name: line.name || line.seller_sku || 'Consigned item',
      variant: [line.seller_name, after.location].filter(Boolean).join(' · ') || null,
      in_stock: Number(after.qty_received) || 0,
      reserved: Number(after.qty_reserved) || 0,
      reorder_at: 0,
      category: 'Consigned',
    },
    seller: line.seller_name || null,
    location: after.location || null,
  };
}

/**
 * How far a stocked SKU is allowed to travel.
 *
 *   factory  internal only. Never appears outside the factory's own screens.
 *   seller   published in the partner/seller stock feed (GET /api/v1/stock).
 *   public   cleared for unauthenticated surfaces as well.
 *
 * Exported because the enforcement has to be the SAME set everywhere a row leaves the
 * building — a second copy of this list in the partner API is how "factory" quietly stops
 * meaning factory.
 */
export const VISIBILITY = ['factory', 'seller', 'public'];
/** null for anything not on the list — callers decide between 400 and "leave it alone". */
export const normVisibility = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return VISIBILITY.includes(s) ? s : null;
};
/** The one predicate that decides whether a row may be published outside the factory. */
export const VISIBLE_TO_PARTNERS = `coalesce(visibility, 'factory') <> 'factory'`;

export function inventoryRoutes(app, requireStaff, requireWarehouse) {
  // READS stay open to any staff — an operator needs to look stock up. WRITES are
  // warehouse/admin: a stock level is a claim about physical custody, and the whole-list
  // upsert below DELETES any sku missing from the body, so an operator token could wipe
  // inventory. The Scan station already rendered read-only for operators; this is the
  // half that was missing.
  q('alter table inventory add column if not exists supplier text').catch(() => {});
  /**
   * VISIBILITY, added in two steps on purpose — and route-load only, never schema.sql,
   * so a fresh database and a four-month-old one end up in exactly the same state.
   *
   * The column is ADDED with default 'seller' and then has its default CHANGED to
   * 'factory'. That is not redundant:
   *
   *   step 1 backfills EXISTING rows to 'seller'. Every row already on the shelf is
   *          already published in GET /api/v1/stock, and silently emptying a partner's
   *          stock feed overnight would tell them we can make nothing — a live
   *          integration must not change behaviour because a column appeared.
   *   step 2 makes every FUTURE row 'factory'. Which is the actual point: stock arriving
   *          from a supplier is not a decision to sell it, and receiving must not be the
   *          moment it becomes visible.
   *
   * Both are no-ops on the second boot, so this is safe to run on every start.
   */
  q(`alter table inventory add column if not exists visibility text not null default 'seller'`)
    .then(() => q(`alter table inventory alter column visibility set default 'factory'`))
    .catch(() => {});
  // scan_history is declared in schema.sql, but that only runs on FIRST db init —
  // an existing deployment never got it. Create it idempotently at route-load (same
  // pattern as order_designs/wallet_ledger) so /scan works on an older database.
  // The index MUST be chained after the table: two bare q() calls can land on
  // different pool connections and run out of order, so the index would fail with
  // "relation does not exist" and the .catch would swallow it — silently no index.
  q(`create table if not exists scan_history (
       id uuid primary key default gen_random_uuid(),
       sku text, direction text, qty int default 1, order_ref text,
       by_id uuid references users(id) on delete set null,
       created_at timestamptz default now()
     )`)
    .then(() => q('create index if not exists scan_history_sku_idx on scan_history (sku, created_at desc)'))
    .catch(() => {});

  app.get('/api/inventory', { preHandler: requireStaff }, async () => {
    const r = await q('select * from inventory order by name, sku');
    return r.rows;
  });

  /**
   * VISIBILITY IS DELIBERATELY ABSENT FROM THIS ROUTE — do not add it.
   *
   * Both receiving paths (Purchase board "Receive", and the S&S box scanner) build their
   * payload by reading the whole inventory, merging quantities in, and POSTing it back
   * here. So anything this route accepts, receiving silently re-asserts from a client
   * snapshot: a SKU a human had set to factory-only would be flipped back by the next
   * delivery that happened to touch it, and a brand-new SKU would arrive carrying whatever
   * the page had in memory.
   *
   * Omitting the column from the INSERT means a new row takes the table default
   * ('factory'), and omitting it from the DO UPDATE means an existing row keeps whatever a
   * human chose. Receiving therefore cannot publish stock — which is the whole point of
   * landing this before the receiving bridge. Visibility moves only through PATCH below.
   */
  app.post('/api/inventory', { preHandler: requireWarehouse }, async (req) => {
    const rows = Array.isArray(req.body) ? req.body : [];
    for (const r of rows) {
      if (!r.sku) continue;
      await q(
        `insert into inventory (sku, name, variant, in_stock, reserved, reorder_at, category, supplier)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (sku) do update set
           name=excluded.name, variant=excluded.variant, in_stock=excluded.in_stock,
           reserved=excluded.reserved, reorder_at=excluded.reorder_at, category=excluded.category, supplier=excluded.supplier`,
        [r.sku, r.name || null, r.variant || null, r.in_stock || 0, r.reserved || 0,
         (r.reorder_at == null ? 25 : r.reorder_at), r.category || null, r.supplier || null]
      );
    }
    // Pruning is OPT-IN. This used to delete every sku absent from the body, which made
    // any short payload a shelf wipe — and the Purchase board builds its payload from a
    // GET whose .catch() yields [], so a failed inventory fetch looked exactly like an
    // empty factory and the next "Receive" deleted everything not on that PO. A caller
    // that genuinely means "this list is now the whole inventory" says so explicitly.
    const skus = rows.map((r) => r.sku).filter(Boolean);
    const prune = String((req.query || {}).prune || '') === '1';
    let removed = 0;
    if (prune && skus.length) {
      const del = await q('delete from inventory where sku <> all($1)', [skus]);
      removed = del.rowCount || 0;
    }
    return { ok: true, count: rows.length, removed, pruned: prune };
  });

  // Partial update of ONE sku. Prefer this over the whole-list POST above: that
  // one re-sends every row from the client's snapshot, so editing an unrelated
  // field (say reorder_at) writes back a stale in_stock and silently erases any
  // stock scanned in since the page loaded. Here only the named fields move.
  const PATCHABLE = ['name', 'variant', 'in_stock', 'reserved', 'reorder_at', 'category', 'supplier', 'visibility'];
  // requireWarehouse, not requireStaff: in_stock is PATCHABLE, and a stock level is a
  // claim about physical custody (see the header note above). Every sibling write here
  // is warehouse/admin; this route was the one gap, letting an operator set any stock to
  // any number while bypassing the scan audit trail entirely.
  app.patch('/api/inventory/:sku', { preHandler: requireWarehouse }, async (req, reply) => {
    const sku = String(req.params.sku || '');
    const b = req.body || {};
    const sets = [], vals = [];
    for (const f of PATCHABLE) {           // whitelist — field names are never taken from input
      if (b[f] === undefined) continue;
      let v = b[f];
      // A typo'd visibility must FAIL, not fall back. Coercing an unknown value to a
      // default would silently pick a side on the one field that decides whether stock
      // leaves the factory, and 'sellers' vs 'seller' is exactly the sort of near-miss
      // that would then read as deliberate.
      if (f === 'visibility') {
        v = normVisibility(v);
        if (!v) { reply.code(400); return { error: `visibility must be one of: ${VISIBILITY.join(', ')}` }; }
      }
      vals.push(v); sets.push(f + '=$' + vals.length);
    }
    if (!sets.length) { reply.code(400); return { error: 'No updatable fields supplied' }; }
    vals.push(sku);
    const r = await q(
      'update inventory set ' + sets.join(', ') + ', updated_at = now() where sku = $' + vals.length + ' returning *',
      vals
    );
    if (!r.rows.length) { reply.code(404); return { error: 'Unknown SKU: ' + sku }; }
    return { ok: true, item: r.rows[0] };
  });

  // Create/upsert a SINGLE item (the Add-item dialog) — again, no whole-list write.
  //
  // Unlike the bulk route this DOES take a visibility, because a person filling in this
  // dialog is making a decision rather than replaying a snapshot. It still defaults to
  // 'factory' when omitted, and `coalesce($9, inventory.visibility)` on the conflict path
  // means re-adding an existing SKU without naming a visibility leaves the one already
  // chosen alone — `excluded.visibility` would have quietly reset it to the default.
  app.post('/api/inventory/item', { preHandler: requireWarehouse }, async (req, reply) => {
    const r = req.body || {};
    if (!r.sku) { reply.code(400); return { error: 'sku is required' }; }
    let vis = null;
    if (r.visibility !== undefined) {
      vis = normVisibility(r.visibility);
      if (!vis) { reply.code(400); return { error: `visibility must be one of: ${VISIBILITY.join(', ')}` }; }
    }
    const out = await q(
      `insert into inventory (sku, name, variant, in_stock, reserved, reorder_at, category, supplier, visibility)
       values ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9,'factory'))
       on conflict (sku) do update set
         name=excluded.name, variant=excluded.variant, in_stock=excluded.in_stock,
         reserved=excluded.reserved, reorder_at=excluded.reorder_at,
         category=excluded.category, supplier=excluded.supplier,
         visibility=coalesce($9, inventory.visibility), updated_at=now()
       returning *`,
      [r.sku, r.name || null, r.variant || null, r.in_stock || 0, r.reserved || 0,
       (r.reorder_at == null ? 25 : r.reorder_at), r.category || null, r.supplier || null, vis]
    );
    return { ok: true, item: out.rows[0] };
  });

  // ── Scan in/out ────────────────────────────────────────────────────────────
  // NB: deliberately NOT the whole-list upsert above. A scan is an ATOMIC DELTA
  // (`in_stock = in_stock + $delta` in one statement) so two people scanning at
  // the same time can't clobber each other the way a read-modify-write POST of
  // the full table would. Every scan is recorded in scan_history for the audit
  // drawer. Stock is allowed to go negative — a negative count is a real signal
  // that something was shipped without an intake, and hiding it loses the error.
  app.post('/api/inventory/scan', { preHandler: requireWarehouse }, async (req, reply) => {
    const b = req.body || {};
    const sku = String(b.sku || '').trim();
    const direction = b.direction === 'out' ? 'out' : 'in';
    const qty = Math.max(1, Math.round(Number(b.qty) || 1));
    if (!sku) { reply.code(400); return { error: 'sku is required' }; }

    const delta = direction === 'out' ? -qty : qty;
    const upd = await q(
      'update inventory set in_stock = coalesce(in_stock,0) + $1, updated_at = now() where sku = $2 returning *',
      [delta, sku]
    );

    // Not ours? It may be CONSIGNED stock — the barcodes printed at receiving carry an
    // internal SKU (EG-…) that lives in consignment_lines, not inventory. Without this a
    // scan of a label we printed ourselves answers "Unknown SKU".
    if (!upd.rows.length) {
      const con = await consignedScan(sku, delta, direction, qty, req, b);
      if (con) return con;
      reply.code(404); return { error: 'Unknown SKU: ' + sku };
    }

    const hist = await q(
      'insert into scan_history (sku, direction, qty, order_ref, by_id) values ($1,$2,$3,$4,$5) returning id, created_at',
      [sku, direction, qty, b.order_ref || null, req.user?.sub || null]
    );
    return { ok: true, item: upd.rows[0], scan: { id: hist.rows[0].id, sku, direction, qty, order_ref: b.order_ref || null, created_at: hist.rows[0].created_at, by_name: req.user?.name || null } };
  });

  /**
   * RECEIVE AGAINST A PURCHASE ORDER.
   *
   * Until now a delivery was booked in by scanning a sku — `/api/inventory/scan` credits
   * whatever string it is given. That works for consigned goods, because we print those
   * labels ourselves and they already carry an EG- sku. It does NOT work for a supplier PO:
   * S&S, SanMar and Otto ship cartons labelled with THEIR sku, nothing mapped it to ours,
   * and nothing ever decremented what the PO was still waiting on. So "what is still on
   * order" was unanswerable and the shelf only moved if a human typed our sku correctly.
   *
   * This receives against the LINE instead. The mapping was already done when the PO was
   * raised — the line carries our sku — so the door does not have to know anything.
   *
   * IT LIVES HERE, NOT IN purchase.js, and that is deliberate: purchasing is admin-only
   * because it commits company money, while receiving is a floor job on the warehouse gate.
   * purchase.js says exactly this at the top of the file; this is the route it points at.
   *
   * Every credit also writes scan_history, so a delivery booked through a PO and one booked
   * through the scan gun leave the same audit trail — one place to read "what came in".
   */
  app.post('/api/purchase/:num/receive', { preHandler: requireWarehouse }, async (req, reply) => {
    const num = String(req.params.num || '').trim();
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!num) { reply.code(400); return { error: 'purchase order number required' }; }
    if (!lines.length) { reply.code(400); return { error: 'nothing to receive' }; }

    const po = await q('select num, items, status from purchase_orders where num = $1', [num]).then((r) => r.rows[0]);
    if (!po) { reply.code(404); return { error: 'Purchase order not found: ' + num }; }
    const items = Array.isArray(po.items) ? po.items : [];
    if (!items.length) { reply.code(409); return { error: 'This purchase order has no lines to receive.' }; }

    const received = [];
    const problems = [];
    for (const l of lines) {
      const sku = String(l?.sku || '').trim();
      const qty = Math.max(1, Math.round(Number(l?.qty) || 0));
      if (!sku || !(qty > 0)) continue;
      const idx = items.findIndex((it) => String(it?.sku || '').toUpperCase() === sku.toUpperCase());
      if (idx < 0) { problems.push(`${sku} is not on ${num}`); continue; }

      /**
       * NEVER MORE THAN THE LINE IS OWED.
       *
       * A double-press — a slow connection, a second click, a page left open on two screens
       * — credited the shelf twice, and nothing on screen said so afterwards. Stock is the
       * one number here nobody re-counts, which is what makes a silent double the worst
       * failure this route can have.
       *
       * The line's own `received` is the ledger: what is outstanding is qty − received, and
       * a receive is clamped to it. Press twice and the second press books nothing and says
       * why. It is the same shape as wallet_ledger's idempotency — the record of what has
       * already happened decides what may happen next, rather than a token that has to be
       * remembered.
       */
      const want = Math.max(0, Math.round(Number(items[idx].qty) || 0));
      const had = Math.max(0, Math.round(Number(items[idx].received) || 0));
      const owed = Math.max(0, want - had);
      if (owed <= 0) { problems.push(`${items[idx].sku} is already fully received on ${num}`); continue; }
      const take = Math.min(qty, owed);

      // The shelf. Same statement the scan gun runs, so the two can never disagree about
      // what receiving means.
      const upd = await q(
        'update inventory set in_stock = coalesce(in_stock,0) + $1, updated_at = now() where sku = $2 returning sku, in_stock',
        [take, items[idx].sku]
      );
      if (!upd.rows.length) {
        // NOT created blind. An inventory row carries a name, a category and a reorder
        // point that belong to the product, and inventing one here would put a bare sku on
        // the shelf that nobody can read. Say which line has no shelf to credit.
        problems.push(`${items[idx].sku} has no inventory row — open it in Inventory first`);
        continue;
      }

      // What the LINE has had. Kept on the line rather than derived from scan history:
      // history is per sku, and the same blank can sit on two purchase orders at once.
      items[idx] = { ...items[idx], received: had + take };

      await q(
        'insert into scan_history (sku, direction, qty, order_ref, by_id) values ($1,$2,$3,$4,$5)',
        [items[idx].sku, 'in', take, num, req.user?.sub || null]
      ).catch(() => {});
      // `qty` is what was ASKED for, `take` what was allowed — a short-ship that over-sends
      // should read as "3 of the 5 you asked for", not silently as 3.
      received.push({ sku: items[idx].sku, qty: take, asked: qty, inStock: Number(upd.rows[0].in_stock) || 0, received: items[idx].received });
      if (take < qty) problems.push(`${items[idx].sku}: only ${owed} were still owed, so ${take} went in`);
    }

    if (!received.length) {
      reply.code(409);
      return { error: problems.join('; ') || 'Nothing was received.', problems };
    }

    /**
     * THE STATUS FOLLOWS THE LINES, and only reaches `received` when every one of them is
     * full. A PO that is part-delivered has to keep reading as outstanding — that is the
     * whole question this route exists to answer — so short deliveries land on `partial`.
     */
    const outstanding = items.some((it) => {
      const want = Math.max(0, Math.round(Number(it?.qty) || 0));
      const got = Math.max(0, Math.round(Number(it?.received) || 0));
      return want > got;
    });
    const status = outstanding ? 'partial' : 'received';
    await q('update purchase_orders set items = $2, status = $3 where num = $1',
      [num, JSON.stringify(items), status]);

    audit(req, 'purchase.receive', { entityType: 'purchase', entityId: num, after: { received, status } });
    egBroadcast({ type: 'inventory' });
    egBroadcast({ type: 'purchase' });
    return { ok: true, num, status, received, problems };
  });

  // Recent scans — all, or one SKU's history for the row drawer.
  app.get('/api/inventory/scan', { preHandler: requireStaff }, async (req) => {
    const sku = req.query?.sku ? String(req.query.sku) : null;
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
    const r = await q(
      `select s.id, s.sku, s.direction, s.qty, s.order_ref, s.created_at, u.name as by_name, i.name as item_name
         from scan_history s
         left join users u on u.id = s.by_id
         left join inventory i on i.sku = s.sku
        where ($1::text is null or s.sku = $1)
        order by s.created_at desc limit $2`,
      [sku, limit]
    );
    return r.rows;
  });

  // Undo a mis-scan: reverse the delta and drop the row. Mis-scans are constant
  // on a scan gun and the correction has to be instant, so this removes the
  // record rather than logging a compensating entry that clutters the history.
  app.delete('/api/inventory/scan/:id', { preHandler: requireWarehouse }, async (req, reply) => {
    const id = String(req.params.id || '');
    // Guard the cast: a non-uuid makes Postgres throw 22P02 → a 500 with a stack,
    // where this route means to answer 404.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { reply.code(404); return { error: 'Scan not found' }; }
    const del = await q('delete from scan_history where id=$1 returning sku, direction, qty', [id]);
    if (!del.rows.length) { reply.code(404); return { error: 'Scan not found' }; }
    const s = del.rows[0];
    const reverse = s.direction === 'out' ? s.qty : -s.qty; // undo the original delta
    const upd = await q(
      'update inventory set in_stock = coalesce(in_stock,0) + $1, updated_at = now() where sku = $2 returning *',
      [reverse, s.sku]
    );
    return { ok: true, item: upd.rows[0] || null };
  });

  /**
   * SET THE SHELF FOR A PRODUCT'S VARIANTS, in one write.
   *
   * The product editor holds a size × colour grid, and "apply to all" can touch every cell
   * of it — a tee with 8 sizes and 62 colours is 496 rows. One request, not 496 PATCHes.
   *
   * NOT the bulk POST above, which writes every column from the caller's snapshot: this one
   * only ever moves `in_stock` (plus the name/variant labels a new row needs to be readable
   * in the Inventory table and on a scanner). `reserved`, `reorder_at`, `category`,
   * `supplier` and `visibility` are left exactly as they are, so setting a count cannot
   * quietly reset a reorder point somebody chose or publish a factory-only sku.
   *
   * NEVER PRUNES. Removing a colour from a product is not a statement that its shelf is
   * empty — the stock is still on the rack. Deleting a stock row stays an explicit act
   * through DELETE below.
   *
   * A null/absent `in_stock` means "don't track this variant": the row is skipped rather
   * than written as 0, because stock-status.ts reads an absent sku as "we don't stock this"
   * and a 0 as "we are out", and those two send a person to different places.
   */
  app.post('/api/inventory/stock', { preHandler: requireWarehouse }, async (req, reply) => {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    if (!rows.length) { reply.code(400); return { error: 'rows required' }; }
    let written = 0;
    for (const r of rows) {
      const sku = String(r && r.sku != null ? r.sku : '').trim();
      if (!sku) continue;
      if (r.in_stock == null || r.in_stock === '') continue;
      const n = Math.round(Number(r.in_stock));
      if (!Number.isFinite(n)) continue;
      await q(
        `insert into inventory (sku, name, variant, in_stock)
         values ($1,$2,$3,$4)
         on conflict (sku) do update set
           name = coalesce(excluded.name, inventory.name),
           variant = coalesce(excluded.variant, inventory.variant),
           in_stock = excluded.in_stock,
           updated_at = now()`,
        [sku, r.name || null, r.variant || null, n]
      );
      written++;
    }
    return { ok: true, written };
  });

  app.delete('/api/inventory/:sku', { preHandler: requireWarehouse }, async (req) => {
    await q('delete from inventory where sku=$1', [req.params.sku]);
    return { ok: true };
  });
}
