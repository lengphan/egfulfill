// Catalog products API — the shared product catalog the factory publishes and
// sellers browse. GET is readable by any signed-in user; writes are staff-only.
// Products carry image data URLs, so we store the whole product object in a
// `data` jsonb column (lossless round-trip) plus a few typed columns for TablePlus.
import { q } from '../db.js';

export function catalogRoutes(app, requireAuth, requireStaff) {
  // Add the lossless `data` column if an older schema doesn't have it (idempotent).
  q('alter table catalog_products add column if not exists data jsonb').catch(() => {});

  app.get('/api/catalog_products', { preHandler: requireAuth }, async () => {
    const r = await q('select data from catalog_products order by created_at desc');
    return r.rows.map((row) => row.data).filter(Boolean);
  });

  // Full-list upsert: insert/update everything sent, then drop products removed locally.
  app.post('/api/catalog_products', { preHandler: requireStaff }, async (req) => {
    const products = Array.isArray(req.body) ? req.body : [];
    const keep = [];
    for (const p of products) {
      const id = String(p.id != null ? p.id : '');
      if (!id) continue;
      keep.push(id);
      await q(
        `insert into catalog_products (id, name, sku, type, method, status, base_price, price, main_color, data, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         on conflict (id) do update set
           name=excluded.name, sku=excluded.sku, type=excluded.type, method=excluded.method,
           status=excluded.status, base_price=excluded.base_price, price=excluded.price,
           main_color=excluded.main_color, data=excluded.data, updated_at=now()`,
        [
          id, p.name || '', p.sku || null, p.type || null, p.method || null,
          p.status || 'Active', Number(p.basePrice ?? p.base_price ?? 0) || 0,
          Number(p.price ?? 0) || 0, p.mainColor || p.main_color || null, p
        ]
      );
    }
    if (keep.length) {
      await q(`delete from catalog_products where id <> all($1::text[])`, [keep]);
    } else {
      await q('delete from catalog_products');
    }
    return { ok: true, count: keep.length };
  });
}
