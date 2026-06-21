// Orders API. Permissions enforced in code (your backend replaces Supabase RLS):
//   • seller  → only their own orders
//   • staff   → all orders
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { egBroadcast } from '../events.js';

export function ordersRoutes(app, requireAuth) {
  // Idempotent: ensure the factory_order column exists (also created in etsy.js).
  q('alter table orders add column if not exists factory_order boolean not null default false').catch(() => {});
  // Per-seller display number ("#1, #2 …" for manual orders). The id stays the
  // globally-unique PK; this is just the friendly number the seller sees.
  q('alter table orders add column if not exists seq integer').catch(() => {});
  // Free-form editable order info (notes, priority, gift message, …) kept on the
  // seller's order-detail panel. One jsonb bag so new fields don't need migrations.
  q(`alter table orders add column if not exists meta jsonb default '{}'`).catch(() => {});
  // Classify factory_order by OWNER ROLE, not by id: an Etsy order is factory-owned
  // ONLY when its connection owner is staff (the admin/factory shop). A seller's own
  // Etsy shop → factory_order=false so it shows on their dashboard (seller-managed
  // until pushed). Manual seller orders stay false. Idempotent (only fixes wrong rows).
  q(`update orders set factory_order = (id like 'etsy-%' and exists (select 1 from users u where u.id = orders.seller_id and u.role <> 'seller'))
      where factory_order is distinct from (id like 'etsy-%' and exists (select 1 from users u where u.id = orders.seller_id and u.role <> 'seller'))`).catch(() => {});
  // Composite design position {x,y,w,h} per line item — persisted so the mockup
  // overlay lands in the same spot on every board + the mobile app after a sync.
  // schema.sql already declares it for fresh DBs; this covers older ones.
  q('alter table order_items add column if not exists design_pos jsonb').catch(() => {});
  // Stable per-line id (client-generated) so a line item's design/image/status keys
  // never collide between identical-SKU siblings. Preserved across replaceItems.
  q('alter table order_items add column if not exists line_id text').catch(() => {});
  // Design uploads live SERVER-side, not in browser localStorage (~5MB, overflows
  // the moment a seller uploads a few images → "Browser storage is full"). One row
  // per (order, item, kind): kind='raster' for png/jpg/etc, 'emb' for stitch files.
  q(`create table if not exists order_designs (
       order_id text not null, sku text not null, kind text not null default 'raster',
       data text, name text, updated_at timestamptz default now(),
       primary key (order_id, sku, kind))`).catch(() => {});

  // List
  app.get('/api/orders', { preHandler: requireAuth }, async (req) => {
    const join = `left join order_items i on i.order_id = o.id`;
    // ORDER BY i.id keeps line-item order stable across every board, so the per-line
    // design "slot" (1st vs 2nd same-SKU item) resolves to the same artwork everywhere.
    const agg  = `coalesce(json_agg(i.* order by i.id) filter (where i.id is not null), '[]') as items`;
    if (isStaff(req.user)) {
      // Staff (factory) see factory-OWNED orders (the admin marketplace shops, which
      // need factory setup) PLUS any SELLER order that's been PUSHED to production.
      // A seller order sits at factory_status 'new'/'draft' while the seller is still
      // managing it; Push moves it to 'in_review'. So until Push it stays OFF the
      // factory boards (seller-managed). factory_order rows show regardless of status.
      const r = await q(
        `select o.*, ${agg} from orders o ${join}
         where o.factory_order = true
            or coalesce(o.factory_status, '') not in ('new', 'draft', '')
         group by o.id order by o.created_at desc`);
      return r.rows;
    }
    // Sellers only see their OWN orders, never the admin/factory-synced ones
    // (admin's Etsy store is separate from a seller's own connected stores).
    const r = await q(
      `select o.*, ${agg} from orders o ${join} where o.seller_id=$1 and o.factory_order=false group by o.id order by o.created_at desc`,
      [req.user.sub]
    );
    return r.rows;
  });

  // Create / upsert (the seller who creates it owns it)
  app.post('/api/orders', { preHandler: requireAuth }, async (req, reply) => {
    const o = req.body || {};
    if (!o.id) { return { error: 'order id required' }; }
    // Ownership guard: a seller may only create/update THEIR OWN, non-factory
    // orders. Block a crafted id from overwriting another seller's order or
    // un-flagging a factory order into the seller's own view. Staff may upsert any.
    if (!isStaff(req.user)) {
      const ex = await q('select seller_id, factory_order from orders where id=$1', [o.id]);
      const row = ex.rows[0];
      if (row && (row.factory_order || row.seller_id !== req.user.sub)) {
        reply.code(403); return { error: 'Not allowed to modify this order' };
      }
    }
    // This route only ever creates SELLER/staff-made orders — Etsy imports use
    // importReceipt(). So factory_order is always false here (insert AND on
    // conflict), guaranteeing manual orders stay visible to the seller even if a
    // prior run mis-flagged them.
    await q(
      `insert into orders (id, seller_id, store, source, customer, address, status, factory_status, total, profit, delivery, carrier, tracking, seq, meta, factory_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, false)
       on conflict (id) do update set
         store=excluded.store, customer=excluded.customer, address=excluded.address,
         status=excluded.status, factory_status=excluded.factory_status,
         total=excluded.total, profit=excluded.profit, delivery=excluded.delivery,
         carrier=excluded.carrier, tracking=excluded.tracking,
         seq=coalesce(orders.seq, excluded.seq),
         meta=coalesce(excluded.meta, orders.meta), factory_order=false`,
      [o.id, req.user.sub, o.store || null, o.source || 'manual', o.customer || {}, o.address || {},
       o.status || 'new', o.factoryStatus || o.status || 'new', o.total || 0, o.profit || 0,
       o.delivery || null, o.carrier || null, o.tracking || null,
       (o.seq != null && o.seq !== '') ? parseInt(o.seq, 10) : null,
       (o.meta && typeof o.meta === 'object') ? o.meta : {}]
    );
    if (Array.isArray(o.items)) await replaceItems(o.id, o.items);
    egBroadcast({ type: 'orders', id: o.id });
    return { ok: true, id: o.id };
  });

  // Replace an order's line items wholesale. Carries the factory-chosen blank +
  // its composite image (it.img / it.blank) so a scanned order shows the right
  // mockup on the mobile app — the boards persist these when an operator picks a
  // base blank for a still-"new" item.
  async function replaceItems(orderId, items) {
    // The seller's uploaded LISTING image (it.img) is heavy, and a lean client
    // patch may legitimately omit it (send null) to keep the payload small. Snapshot
    // the existing img per SKU and re-inherit it when an incoming item doesn't carry
    // one — otherwise an edit (e.g. picking a blank, changing qty) wipes the stored
    // picture. That wipe is the root of "the image disappears every time I edit".
    const prev = await q('select sku, img from order_items where order_id=$1', [orderId]);
    const imgBySku = {};
    for (const r of prev.rows) { if (r.sku != null && r.img && !(r.sku in imgBySku)) imgBySku[r.sku] = r.img; }
    await q('delete from order_items where order_id=$1', [orderId]);
    for (const it of items) {
      const img = (it.img != null && it.img !== '') ? it.img : (imgBySku[it.sku] || null);
      const designPos = (it.designPos && typeof it.designPos === 'object') ? JSON.stringify(it.designPos) : null;
      await q(
        `insert into order_items (order_id, sku, name, print_type, qty, color, size, variant, unit_price, design_src, img, blank, design_pos, line_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [orderId, it.sku || null, it.name || null, it.printType || it.tech || null, it.qty || 1,
         it.color || null, it.size || null, it.variant || null, it.unitPrice || 0, it.designSrc || null,
         img, it.blank || null, designPos, it.lineId || null]
      );
    }
  }

  // Patch status/tracking/etc. Staff may also replace the line items (used when a
  // factory board picks a base blank → the chosen mockup must reach mobile scan).
  app.patch('/api/orders/:id', { preHandler: requireAuth }, async (req) => {
    const map = { factoryStatus: 'factory_status', status: 'status', tracking: 'tracking',
                  carrier: 'carrier', total: 'total', timeline: 'timeline', notes: 'notes', meta: 'meta' };
    const sets = [], vals = []; let n = 1;
    for (const k in (req.body || {})) if (map[k]) { sets.push(`${map[k]}=$${n++}`); vals.push(req.body[k]); }
    const body = req.body || {};
    const wantsItems = isStaff(req.user) && Array.isArray(body.items);
    if (!sets.length && !wantsItems) return { ok: true };
    // sellers may only patch their own orders; staff any
    if (sets.length) {
      let where = `id=$${n}`; vals.push(req.params.id);
      if (!isStaff(req.user)) { where += ` and seller_id=$${n + 1}`; vals.push(req.user.sub); }
      await q(`update orders set ${sets.join(',')} where ${where}`, vals);
    }
    if (wantsItems) await replaceItems(req.params.id, body.items);
    egBroadcast({ type: 'orders', id: req.params.id });
    return { ok: true };
  });

  // Per-item production status — the warehouse "Working" flag. Staff-only. Keyed
  // by (order, sku) to match the boards' item-status store; order_items already
  // has factory_status and /api/orders returns it on each item, so mobile and all
  // factory boards converge on the server instead of per-browser localStorage.
  app.post('/api/orders/:id/item-status', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const { sku, status } = req.body || {};
    if (!sku) { reply.code(400); return { error: 'sku required' }; }
    await q('update order_items set factory_status=$1 where order_id=$2 and sku=$3',
      [status || '', req.params.id, sku]);
    egBroadcast({ type: 'item-status', id: req.params.id, sku: sku, status: status || '' });
    return { ok: true };
  });

  // ── Design uploads (server-stored, so localStorage size is irrelevant) ──────
  // Save one design (data URL) for an order item. Upsert by (order, sku, kind).
  app.post('/api/orders/:id/designs', { preHandler: requireAuth }, async (req) => {
    const { sku, data, name, kind } = req.body || {};
    if (!sku || !data) return { error: 'sku and data required' };
    await q(
      `insert into order_designs (order_id, sku, kind, data, name, updated_at)
       values ($1,$2,$3,$4,$5, now())
       on conflict (order_id, sku, kind) do update set data=excluded.data, name=excluded.name, updated_at=now()`,
      [req.params.id, sku, kind || 'raster', data, name || null]
    );
    return { ok: true };
  });
  // Fetch all designs for one order — called lazily when the order is opened, so a
  // big base64 payload never rides along on the main /api/orders list.
  app.get('/api/orders/:id/designs', { preHandler: requireAuth }, async (req) => {
    const r = await q(`select sku, kind, data, name from order_designs where order_id=$1`, [req.params.id]);
    return r.rows;
  });
}
