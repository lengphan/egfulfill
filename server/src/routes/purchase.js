// purchase.js — purchase orders (staff). A PO groups line items for one supplier; it
// moves draft → placed (sent to S&S/Otto via their order APIs, done from the client) →
// received (quantities added back into inventory). Whole-object upsert by `num`.

import { q } from '../db.js';

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists purchase_orders (
       num text primary key, supplier text, items jsonb default '[]',
       status text default 'draft', total numeric default 0, created_at timestamptz default now()
     )`).then(() => q(`alter table purchase_orders add column if not exists meta jsonb`).catch(() => {}))
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

export function purchaseRoutes(app, requireAuth, requireStaff, requireWarehouse) {
  app.get('/api/purchase', { preHandler: requireStaff }, async () => {
    await ensure();
    try { const r = await q('select num, supplier, items, status, total, meta, created_at from purchase_orders order by created_at desc'); return r.rows; }
    catch { return []; }
  });

  // Create/update one PO (draft edits, or status/meta after placing/receiving).
  // Writing a PO commits the factory to spend, so it is warehouse/admin — operator was
  // explicitly allowed here, which contradicted every other spend boundary in the app.
  // Reading stays open to any staff: knowing what's on order is not the same as ordering.
  app.post('/api/purchase', { preHandler: requireWarehouse }, async (req, reply) => {
    await ensure();
    const b = req.body || {};
    const num = String(b.num || '').trim();
    if (!num) { reply.code(400); return { error: 'num required' }; }
    const items = Array.isArray(b.items) ? b.items : [];
    const total = Number(b.total) || items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    await q(
      `insert into purchase_orders (num, supplier, items, status, total, meta)
         values ($1,$2,$3,$4,$5,$6)
       on conflict (num) do update set supplier=excluded.supplier, items=excluded.items,
         status=excluded.status, total=excluded.total, meta=excluded.meta`,
      [num, b.supplier || null, JSON.stringify(items), b.status || 'draft', total, b.meta ? JSON.stringify(b.meta) : null]
    );
    return { ok: true, num };
  });

  app.delete('/api/purchase/:num', { preHandler: requireWarehouse }, async (req) => {
    await ensure();
    await q('delete from purchase_orders where num=$1', [req.params.num]).catch(() => {});
    return { ok: true };
  });
}
