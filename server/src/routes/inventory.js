// Inventory API — factory data, staff only. The frontend sends the FULL list
// (DB-shaped rows) on every change; we upsert all and drop any SKUs no longer
// present, so the table mirrors the client. Empty body never wipes (safety).
import { q } from '../db.js';

export function inventoryRoutes(app, requireStaff) {
  q('alter table inventory add column if not exists supplier text').catch(() => {});
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

  app.post('/api/inventory', { preHandler: requireStaff }, async (req) => {
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
    const skus = rows.map((r) => r.sku).filter(Boolean);
    if (skus.length) await q('delete from inventory where sku <> all($1)', [skus]); // drop removed SKUs
    return { ok: true, count: rows.length };
  });

  // Partial update of ONE sku. Prefer this over the whole-list POST above: that
  // one re-sends every row from the client's snapshot, so editing an unrelated
  // field (say reorder_at) writes back a stale in_stock and silently erases any
  // stock scanned in since the page loaded. Here only the named fields move.
  const PATCHABLE = ['name', 'variant', 'in_stock', 'reserved', 'reorder_at', 'category', 'supplier'];
  app.patch('/api/inventory/:sku', { preHandler: requireStaff }, async (req, reply) => {
    const sku = String(req.params.sku || '');
    const b = req.body || {};
    const sets = [], vals = [];
    for (const f of PATCHABLE) {           // whitelist — field names are never taken from input
      if (b[f] !== undefined) { vals.push(b[f]); sets.push(f + '=$' + vals.length); }
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
  app.post('/api/inventory/item', { preHandler: requireStaff }, async (req, reply) => {
    const r = req.body || {};
    if (!r.sku) { reply.code(400); return { error: 'sku is required' }; }
    const out = await q(
      `insert into inventory (sku, name, variant, in_stock, reserved, reorder_at, category, supplier)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (sku) do update set
         name=excluded.name, variant=excluded.variant, in_stock=excluded.in_stock,
         reserved=excluded.reserved, reorder_at=excluded.reorder_at,
         category=excluded.category, supplier=excluded.supplier, updated_at=now()
       returning *`,
      [r.sku, r.name || null, r.variant || null, r.in_stock || 0, r.reserved || 0,
       (r.reorder_at == null ? 25 : r.reorder_at), r.category || null, r.supplier || null]
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
  app.post('/api/inventory/scan', { preHandler: requireStaff }, async (req, reply) => {
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
    if (!upd.rows.length) { reply.code(404); return { error: 'Unknown SKU: ' + sku }; }

    const hist = await q(
      'insert into scan_history (sku, direction, qty, order_ref, by_id) values ($1,$2,$3,$4,$5) returning id, created_at',
      [sku, direction, qty, b.order_ref || null, req.user?.id || null]
    );
    return { ok: true, item: upd.rows[0], scan: { id: hist.rows[0].id, sku, direction, qty, order_ref: b.order_ref || null, created_at: hist.rows[0].created_at, by_name: req.user?.name || null } };
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
  app.delete('/api/inventory/scan/:id', { preHandler: requireStaff }, async (req, reply) => {
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

  app.delete('/api/inventory/:sku', { preHandler: requireStaff }, async (req) => {
    await q('delete from inventory where sku=$1', [req.params.sku]);
    return { ok: true };
  });
}
