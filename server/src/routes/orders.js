// Orders API. Permissions enforced in code (your backend replaces Supabase RLS):
//   • seller  → only their own orders
//   • staff   → all orders
import { q } from '../db.js';
import { isStaff } from '../auth.js';

export function ordersRoutes(app, requireAuth) {
  // List
  app.get('/api/orders', { preHandler: requireAuth }, async (req) => {
    const join = `left join order_items i on i.order_id = o.id`;
    const agg  = `coalesce(json_agg(i.*) filter (where i.id is not null), '[]') as items`;
    if (isStaff(req.user)) {
      const r = await q(`select o.*, ${agg} from orders o ${join} group by o.id order by o.created_at desc`);
      return r.rows;
    }
    const r = await q(
      `select o.*, ${agg} from orders o ${join} where o.seller_id=$1 group by o.id order by o.created_at desc`,
      [req.user.sub]
    );
    return r.rows;
  });

  // Create / upsert (the seller who creates it owns it)
  app.post('/api/orders', { preHandler: requireAuth }, async (req) => {
    const o = req.body || {};
    if (!o.id) { return { error: 'order id required' }; }
    await q(
      `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, profit, delivery, carrier, tracking)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do update set
         store=excluded.store, customer=excluded.customer, address=excluded.address,
         status=excluded.status, factory_status=excluded.factory_status,
         total=excluded.total, profit=excluded.profit, delivery=excluded.delivery,
         carrier=excluded.carrier, tracking=excluded.tracking`,
      [o.id, req.user.sub, o.store || null, o.source || 'manual', o.customer || {}, o.address || {},
       o.status || 'new', o.factoryStatus || o.status || 'new', o.total || 0, o.profit || 0,
       o.delivery || null, o.carrier || null, o.tracking || null]
    );
    if (Array.isArray(o.items)) {
      await q('delete from order_items where order_id=$1', [o.id]);
      for (const it of o.items) {
        await q(
          `insert into order_items (order_id, sku, name, print_type, qty, color, size, variant, unit_price, design_src)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [o.id, it.sku || null, it.name || null, it.printType || it.tech || null, it.qty || 1,
           it.color || null, it.size || null, it.variant || null, it.unitPrice || 0, it.designSrc || null]
        );
      }
    }
    return { ok: true, id: o.id };
  });

  // Patch status/tracking/etc.
  app.patch('/api/orders/:id', { preHandler: requireAuth }, async (req) => {
    const map = { factoryStatus: 'factory_status', status: 'status', tracking: 'tracking',
                  carrier: 'carrier', total: 'total', timeline: 'timeline', notes: 'notes' };
    const sets = [], vals = []; let n = 1;
    for (const k in (req.body || {})) if (map[k]) { sets.push(`${map[k]}=$${n++}`); vals.push(req.body[k]); }
    if (!sets.length) return { ok: true };
    // sellers may only patch their own orders; staff any
    let where = `id=$${n}`; vals.push(req.params.id);
    if (!isStaff(req.user)) { where += ` and seller_id=$${n + 1}`; vals.push(req.user.sub); }
    await q(`update orders set ${sets.join(',')} where ${where}`, vals);
    return { ok: true };
  });
}
