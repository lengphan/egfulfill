// Orders API. Permissions enforced in code (your backend replaces Supabase RLS):
//   • seller  → only their own orders
//   • staff   → all orders
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { egBroadcast } from '../events.js';
import { audit } from '../audit.js';

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
    // Sellers only see their OWN orders, never the admin/factory-synced ones. A team member sees
    // their OWNER's orders (if their permissions include 'orders'); a plain seller sees their own.
    const sel = await resolveSeller(req.user);
    if (!_canSurface(sel, 'orders')) return [];
    const r = await q(
      `select o.*, ${agg} from orders o ${join} where o.seller_id=$1 and o.factory_order=false group by o.id order by o.created_at desc`,
      [sel.id]
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
    let ownerId = req.user.sub;
    if (!isStaff(req.user)) {
      const sel = await resolveSeller(req.user);   // a team member creates/edits under the OWNER
      if (!_canSurface(sel, 'orders')) { reply.code(403); return { error: 'No access to orders' }; }
      ownerId = sel.id;
      const ex = await q('select seller_id, factory_order from orders where id=$1', [o.id]);
      const row = ex.rows[0];
      if (row && (row.factory_order || row.seller_id !== sel.id)) {
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
      [o.id, ownerId, o.store || null, o.source || 'manual', o.customer || {}, o.address || {},
       o.status || 'new', o.factoryStatus || o.status || 'new', o.total || 0, o.profit || 0,
       o.delivery || null, o.carrier || null, o.tracking || null,
       (o.seq != null && o.seq !== '') ? parseInt(o.seq, 10) : null,
       (o.meta && typeof o.meta === 'object') ? o.meta : {}]
    );
    if (Array.isArray(o.items)) await replaceItems(o.id, o.items);
    audit(req, 'order.saved', { entityType: 'order', entityId: o.id, after: { status: o.status, total: o.total, customer: (o.customer && o.customer.name) || null } });
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
  app.patch('/api/orders/:id', { preHandler: requireAuth }, async (req, reply) => {
    const map = { factoryStatus: 'factory_status', status: 'status', tracking: 'tracking',
                  carrier: 'carrier', total: 'total', timeline: 'timeline', notes: 'notes', meta: 'meta',
                  address: 'address', customer: 'customer' };
    const sets = [], vals = []; let n = 1;
    for (const k in (req.body || {})) if (map[k]) { sets.push(`${map[k]}=$${n++}`); vals.push(req.body[k]); }
    const body = req.body || {};
    const wantsItems = isStaff(req.user) && Array.isArray(body.items);
    if (!sets.length && !wantsItems) return { ok: true };
    // Snapshot the fields we're about to change, so the audit trail shows the
    // BEFORE value (the "my address/status/tracking was changed" inquiry).
    let before = null;
    if (sets.length) {
      const cols = Object.keys(body).filter((k) => map[k]).map((k) => map[k]);
      if (cols.length) {
        const pre = await q(`select ${cols.join(',')} from orders where id=$1`, [req.params.id]);
        before = pre.rows[0] || null;
      }
    }
    // sellers may only patch their own orders; staff any; a team member patches the OWNER's.
    const sel = isStaff(req.user) ? null : await resolveSeller(req.user);
    if (sel && !_canSurface(sel, 'orders')) { reply.code(403); return { error: 'No access to orders' }; }
    if (sets.length) {
      let where = `id=$${n}`; vals.push(req.params.id);
      if (!isStaff(req.user)) { where += ` and seller_id=$${n + 1}`; vals.push(sel.id); }
      await q(`update orders set ${sets.join(',')} where ${where}`, vals);
    }
    if (wantsItems) await replaceItems(req.params.id, body.items);
    // Record only the changed scalar fields (not the heavy items array).
    const after = {}; for (const k in body) if (map[k]) after[k] = body[k];
    if (Object.keys(after).length || wantsItems) {
      audit(req, 'order.updated', { entityType: 'order', entityId: req.params.id, before, after: Object.keys(after).length ? after : { items: 'replaced' } });
    }
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
    const pre = await q('select factory_status from order_items where order_id=$1 and sku=$2 limit 1', [req.params.id, sku]);
    await q('update order_items set factory_status=$1 where order_id=$2 and sku=$3',
      [status || '', req.params.id, sku]);
    audit(req, 'item.status', { entityType: 'order', entityId: req.params.id,
      before: { sku, status: (pre.rows[0] && pre.rows[0].factory_status) || '' }, after: { sku, status: status || '' } });
    egBroadcast({ type: 'item-status', id: req.params.id, sku: sku, status: status || '' });
    return { ok: true };
  });

  // ── Design uploads (server-stored, so localStorage size is irrelevant) ──────
  // Save one design (data URL) for an order item. Upsert by (order, sku, kind).
  app.post('/api/orders/:id/designs', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const { sku, data, name, kind } = req.body || {};
    if (!sku || !data) return { error: 'sku and data required' };
    await q(
      `insert into order_designs (order_id, sku, kind, data, name, updated_at)
       values ($1,$2,$3,$4,$5, now())
       on conflict (order_id, sku, kind) do update set data=excluded.data, name=excluded.name, updated_at=now()`,
      [req.params.id, sku, kind || 'raster', data, name || null]
    );
    audit(req, 'design.saved', { entityType: 'order', entityId: req.params.id, after: { sku, kind: kind || 'raster', name: name || null } });
    return { ok: true };
  });
  // Fetch all designs for one order — called lazily when the order is opened, so a
  // big base64 payload never rides along on the main /api/orders list.
  app.get('/api/orders/:id/designs', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(`select sku, kind, data, name from order_designs where order_id=$1`, [req.params.id]);
    return r.rows;
  });

  // ── Thread colours (embroidery) — persisted SERVER-side so they survive a refresh
  //    and reach the factory cross-device (they used to live only in the seller's
  //    localStorage, so a reload or a different browser showed none). ──────────────
  q(`create table if not exists order_threads (
       order_id text, sku text, threads jsonb, updated_at timestamptz default now(),
       primary key (order_id, sku)
     )`).catch(() => {});
  app.post('/api/orders/:id/threads', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const { sku, threads } = req.body || {};
    if (!sku) return { error: 'sku required' };
    await q(
      `insert into order_threads (order_id, sku, threads, updated_at) values ($1,$2,$3, now())
       on conflict (order_id, sku) do update set threads=excluded.threads, updated_at=now()`,
      [req.params.id, sku, JSON.stringify(threads || [])]
    );
    return { ok: true };
  });
  app.get('/api/orders/:id/threads', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(`select sku, threads from order_threads where order_id=$1`, [req.params.id]);
    return r.rows;
  });

  // ── Order chat — persisted in order_messages so a conversation survives a
  //    refresh and reaches every board / device (used to live only in the
  //    sender's localStorage under eg_order_chats). meta holds the client's
  //    display fields; client_id makes re-sends idempotent. ─────────────────
  q(`alter table order_messages add column if not exists meta jsonb`).catch(() => {});
  q(`alter table order_messages add column if not exists client_id text`).catch(() => {});
  q(`create unique index if not exists order_messages_client on order_messages (client_id) where client_id is not null`).catch(() => {});

  // A seller who is an ACTIVE team member of an owner acts on the OWNER's board. Returns the effective
  // seller id (owner for a member, else self) + the member's permission surfaces (perms=null means a
  // full owner, not a team member). Staff → own id, not a member. This is what enforces the "team
  // members see their owner's orders" exception server-side, not just in the UI.
  async function resolveSeller(user) {
    if (!user) return { id: null, perms: null, member: false };
    if (isStaff(user)) return { id: user.sub, perms: null, member: false };
    try {
      const r = await q("select owner_id, permissions from team_members where lower(email)=lower($1) and status='active' limit 1", [user.email || '']);
      const row = r.rows[0];
      if (row && row.owner_id) return { id: row.owner_id, perms: Array.isArray(row.permissions) ? row.permissions : [], member: true };
    } catch (e) {}
    return { id: user.sub, perms: null, member: false };
  }
  // A team member is limited to their granted surfaces (hide/unhide). A full owner (perms=null) passes.
  function _canSurface(sel, surface) { return !(sel && sel.member && sel.perms && sel.perms.indexOf(surface) < 0); }

  async function canSeeOrder(user, orderId) {
    if (isStaff(user)) return true;
    // Support conversations ride on order_messages under a synthetic id `support-<sellerId>`.
    // A seller may only see/post to their OWN support thread; staff (above) see all of them.
    if (String(orderId).indexOf('support-') === 0) return orderId === ('support-' + user.sub);
    const sel = await resolveSeller(user);
    if (!_canSurface(sel, 'orders')) return false;
    const r = await q('select seller_id, factory_order from orders where id=$1', [orderId]);
    const row = r.rows[0];
    return !!(row && !row.factory_order && row.seller_id === sel.id);
  }

  // Staff-only: list every seller support thread (one row per seller) with its last message, so the
  // staff chat can show "EGFULFILL Support" conversations that sellers started. Sellers never hit this.
  app.get('/api/support/threads', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(`
      select m.order_id,
             max(m.created_at) as last_at,
             count(*)::int as n,
             (select body from order_messages x where x.order_id = m.order_id order by created_at desc, id desc limit 1) as last_body,
             (select coalesce(nullif(u.name,''), u.email) from users u where u.id::text = replace(m.order_id, 'support-', '')) as seller_name
        from order_messages m
       where m.order_id like 'support-%'
       group by m.order_id
       order by last_at desc`);
    return r.rows.map((x) => ({
      order_id: x.order_id,
      seller_id: String(x.order_id).replace('support-', ''),
      seller_name: x.seller_name || null,
      last: x.last_body || '',
      last_at: x.last_at ? new Date(x.last_at).getTime() : 0,
      n: x.n
    }));
  });

  app.post('/api/orders/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const b = req.body || {};
    const meta = { by: b.by || null, system: !!b.system, internal: !!b.internal, ts: b.ts || null };
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, attachment, meta, client_id)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (client_id) where client_id is not null do nothing`,
      [req.params.id, req.user.sub, b.role || 'seller', b.text || '',
       (b.attachment && typeof b.attachment === 'object') ? b.attachment : null,
       JSON.stringify(meta), b.clientId || null]);
    egBroadcast({ type: 'order-message', id: req.params.id });
    return { ok: true };
  });

  app.get('/api/orders/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await canSeeOrder(req.user, req.params.id))) { reply.code(403); return { error: 'forbidden' }; }
    const r = await q(
      `select id, sender_role, body, attachment, meta, client_id, created_at
         from order_messages where order_id=$1 order by created_at asc, id asc`, [req.params.id]);
    // Reconstruct the client entry shape so getOrderChat round-trips unchanged.
    return r.rows.map((m) => {
      const meta = m.meta || {};
      const e = { id: m.client_id || m.id, by: meta.by || (m.sender_role || 'Unknown'),
        role: m.sender_role || 'seller', text: m.body || '',
        ts: meta.ts || (m.created_at ? new Date(m.created_at).getTime() : 0), system: !!meta.system };
      if (m.attachment) e.attachment = m.attachment;
      if (meta.internal) e.internal = true;
      return e;
    });
  });
}
