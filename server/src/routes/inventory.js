// Inventory API — factory data, staff only. The frontend sends the FULL list
// (DB-shaped rows) on every change; we upsert all and drop any SKUs no longer
// present, so the table mirrors the client. Empty body never wipes (safety).
import { q } from '../db.js';

export function inventoryRoutes(app, requireStaff) {
  q('alter table inventory add column if not exists supplier text').catch(() => {});

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

  app.delete('/api/inventory/:sku', { preHandler: requireStaff }, async (req) => {
    await q('delete from inventory where sku=$1', [req.params.sku]);
    return { ok: true };
  });
}
