// Inventory services — seller-owned stock stored in OUR warehouse (3PL intake).
//
// Deliberately NOT folded into the `inventory` table: that one is keyed by sku alone
// with no owner, because it models stock WE bought. Consigned units belong to a seller,
// must never be picked for someone else's order, and carry an intake lifecycle. Mixing
// the two would silently make one seller's stock fulfil another's order.
//
// Flow: seller announces a shipment (ASN) -> it arrives -> warehouse counts it against
// the declaration -> units are given an internal SKU + barcode and put away in a bin.
// The declaration matters: without it the warehouse opens an unexpected box and has to
// guess, and there's no record to reconcile a short count against.
import { q } from '../db.js';
import { audit } from '../audit.js';
import { notify } from './notifications.js';

const STATUSES = ['announced', 'in_transit', 'received', 'counted', 'shelved', 'closed', 'cancelled'];

// Bin code, e.g. "A-03-2" = aisle A, bay 03, shelf 2.
const BIN_RE = /^[A-Z]-\d{2}-\d$/;

let _ready;
function ensure() {
  if (_ready) return _ready;
  _ready = (async () => {
    await q(`create table if not exists consignment_shipments (
      id text primary key,
      seller_id uuid references users(id) on delete cascade,
      status text not null default 'announced',
      carrier text, tracking text,
      expected_at date,
      note text,
      received_at timestamptz,
      created_at timestamptz default now(),
      updated_at timestamptz default now())`);
    await q(`create table if not exists consignment_lines (
      id bigserial primary key,
      shipment_id text references consignment_shipments(id) on delete cascade,
      seller_sku text,
      internal_sku text,
      name text, variant text,
      qty_declared int not null default 0,
      qty_received int not null default 0,
      qty_reserved int not null default 0,
      location text,
      created_at timestamptz default now())`);
    await q(`create index if not exists consignment_lines_ship on consignment_lines (shipment_id)`);
    await q(`create unique index if not exists consignment_lines_isku on consignment_lines (internal_sku) where internal_sku is not null`);
    // A sequence, not count(*)+1 — two shipments filed at the same moment would read the
    // same count and collide on the primary key.
    await q(`create sequence if not exists consignment_shipment_seq`);
    // Bins. Seeded lazily by staff; chaotic storage means any SKU may live in any bin.
    await q(`create table if not exists warehouse_locations (
      code text primary key,
      zone text,
      capacity int not null default 40,
      note text,
      created_at timestamptz default now())`);
  })().catch(() => {});
  return _ready;
}

const isStaffRole = (u) => !!u && u.role && u.role !== 'seller';
const newId = (n) => 'ASN-' + String(n).padStart(5, '0');

/**
 * Mint OUR sku for a consigned line. Never reuse the seller's: sellers recycle SKUs, and
 * two sellers will eventually send the same string — which would collide in the bin
 * index and mis-pick. Format EG-<seller8>-<seq>, Code128-safe (upper alnum + dash).
 */
async function mintInternalSku(sellerId, lineId) {
  const short = String(sellerId).replace(/-/g, '').slice(0, 8).toUpperCase();
  return `EG-${short}-${String(lineId).padStart(5, '0')}`;
}

/**
 * Where to put a line. Consolidate first — if these units already live somewhere, add to
 * that bin so one SKU isn't scattered. Otherwise the emptiest bin with room.
 *
 * This is chaotic storage WITH an index, not a per-seller zone: reserving a zone per
 * seller strands empty space, and the barcode scan is what binds SKU to location anyway.
 */
async function suggestLocation(internalSku, qty) {
  if (internalSku) {
    const cur = await q(`select location from consignment_lines
                          where internal_sku=$1 and location is not null limit 1`, [internalSku]);
    if (cur.rows[0]?.location) return cur.rows[0].location;
  }
  const r = await q(`
    select l.code, l.capacity, coalesce(sum(cl.qty_received - cl.qty_reserved), 0)::int as used
      from warehouse_locations l
      left join consignment_lines cl on cl.location = l.code
     group by l.code, l.capacity
     having coalesce(sum(cl.qty_received - cl.qty_reserved), 0) + $1 <= l.capacity
     order by used asc, l.code asc
     limit 1`, [Number(qty) || 0]);
  return r.rows[0]?.code ?? null;
}

/**
 * Reserve consigned units for an order.
 *
 * Called when an order is submitted to production. For each line, if the SELLER has their
 * own stock of it here, hold those units so another order can't take them — that's the
 * whole point of consignment: their stock fulfils their orders, nobody else's.
 *
 * Matching is per-seller AND per-sku, and only ever against lines that seller owns. Sold
 * out of their own stock, an order simply falls through to us buying a blank as before —
 * partial cover is normal and fine.
 *
 * Idempotent by (order, line): re-submitting cannot double-reserve, because the reserved
 * amount for a line is SET from the order's own requirement rather than incremented.
 */
export async function reserveConsigned(orderId) {
  await ensure();
  const order = (await q('select seller_id from orders where id=$1', [orderId])).rows[0];
  if (!order || !order.seller_id) return { reserved: 0 };

  const items = (await q('select sku, qty from order_items where order_id=$1', [orderId])).rows;
  let reserved = 0;
  for (const it of items) {
    const sku = String(it.sku || '').trim();
    if (!sku) continue;
    const want = Math.max(1, parseInt(it.qty, 10) || 1);

    // That seller's own consigned lines for this sku, oldest first (FIFO — the stock
    // that has been sitting longest should move first).
    const lines = (await q(`
      select cl.id, cl.qty_received, cl.qty_reserved
        from consignment_lines cl
        join consignment_shipments s on s.id = cl.shipment_id
       where s.seller_id = $1
         and (upper(cl.seller_sku) = upper($2) or upper(cl.internal_sku) = upper($2))
         and cl.qty_received > cl.qty_reserved
       order by cl.id`, [order.seller_id, sku])).rows;

    let remaining = want;
    for (const l of lines) {
      if (remaining <= 0) break;
      const free = Number(l.qty_received) - Number(l.qty_reserved);
      const take = Math.min(free, remaining);
      if (take <= 0) continue;
      await q('update consignment_lines set qty_reserved = qty_reserved + $1 where id=$2', [take, l.id]);
      remaining -= take;
      reserved += take;
    }
  }
  return { reserved };
}

/**
 * Release what an order was holding — cancelled, refunded, or never produced.
 * Without this a cancelled order would strand the seller's stock permanently.
 */
export async function releaseConsigned(orderId) {
  await ensure();
  const order = (await q('select seller_id from orders where id=$1', [orderId])).rows[0];
  if (!order || !order.seller_id) return { released: 0 };
  const items = (await q('select sku, qty from order_items where order_id=$1', [orderId])).rows;
  let released = 0;
  for (const it of items) {
    const sku = String(it.sku || '').trim();
    if (!sku) continue;
    let remaining = Math.max(1, parseInt(it.qty, 10) || 1);
    const lines = (await q(`
      select cl.id, cl.qty_reserved
        from consignment_lines cl
        join consignment_shipments s on s.id = cl.shipment_id
       where s.seller_id = $1
         and (upper(cl.seller_sku) = upper($2) or upper(cl.internal_sku) = upper($2))
         and cl.qty_reserved > 0
       order by cl.id desc`, [order.seller_id, sku])).rows;
    for (const l of lines) {
      if (remaining <= 0) break;
      const give = Math.min(Number(l.qty_reserved), remaining);
      if (give <= 0) continue;
      await q('update consignment_lines set qty_reserved = greatest(0, qty_reserved - $1) where id=$2', [give, l.id]);
      remaining -= give;
      released += give;
    }
  }
  return { released };
}

export function consignmentRoutes(app, requireAuth, requireStaff) {
  ensure();

  // ── Bins ───────────────────────────────────────────────────────────────────
  app.get('/api/consignment/locations', { preHandler: requireStaff }, async () => {
    await ensure();
    const r = await q(`
      select l.code, l.zone, l.capacity, l.note,
             coalesce(sum(cl.qty_received - cl.qty_reserved), 0)::int as used
        from warehouse_locations l
        left join consignment_lines cl on cl.location = l.code
       group by l.code, l.zone, l.capacity, l.note
       order by l.code`);
    return r.rows;
  });

  app.post('/api/consignment/locations', { preHandler: requireStaff }, async (req, reply) => {
    await ensure();
    const b = req.body || {};
    const code = String(b.code || '').toUpperCase().trim();
    if (!BIN_RE.test(code)) { reply.code(400); return { error: 'Bin code must look like A-03-2 (aisle-bay-shelf).' }; }
    await q(`insert into warehouse_locations (code, zone, capacity, note) values ($1,$2,$3,$4)
             on conflict (code) do update set zone=excluded.zone, capacity=excluded.capacity, note=excluded.note`,
      [code, b.zone || code[0], Math.max(1, Number(b.capacity) || 40), b.note || null]);
    return { ok: true, code };
  });

  // ── Shipments ──────────────────────────────────────────────────────────────
  // Seller announces what they're sending. Staff see every shipment; a seller sees
  // only their own.
  app.get('/api/consignment/shipments', { preHandler: requireAuth }, async (req) => {
    await ensure();
    const staff = isStaffRole(req.user);
    const r = staff
      ? await q(`select s.*, coalesce(nullif(u.name,''), u.email) as seller_name
                   from consignment_shipments s left join users u on u.id = s.seller_id
                  order by s.created_at desc limit 200`)
      : await q(`select * from consignment_shipments where seller_id=$1 order by created_at desc limit 200`, [req.user.sub]);
    const ids = r.rows.map((x) => x.id);
    const lines = ids.length
      ? (await q(`select * from consignment_lines where shipment_id = any($1::text[]) order by id`, [ids])).rows
      : [];
    return r.rows.map((s) => ({ ...s, lines: lines.filter((l) => l.shipment_id === s.id) }));
  });

  app.post('/api/consignment/shipments', { preHandler: requireAuth }, async (req, reply) => {
    await ensure();
    const b = req.body || {};
    const lines = Array.isArray(b.lines) ? b.lines.filter((l) => l && (l.seller_sku || l.name)) : [];
    if (!lines.length) { reply.code(400); return { error: 'Add at least one line — we need to know what is arriving.' }; }
    // Staff may file on a seller's behalf (a phone call, a walk-in); a seller only for
    // themselves.
    const sellerId = isStaffRole(req.user) && b.seller_id ? String(b.seller_id) : req.user.sub;

    const n = (await q(`select nextval('consignment_shipment_seq')::int as n`)).rows[0].n;
    const id = newId(n);
    await q(`insert into consignment_shipments (id, seller_id, status, carrier, tracking, expected_at, note)
             values ($1,$2,'announced',$3,$4,$5,$6)`,
      [id, sellerId, b.carrier || null, b.tracking || null, b.expected_at || null, b.note || null]);
    for (const l of lines) {
      await q(`insert into consignment_lines (shipment_id, seller_sku, name, variant, qty_declared)
               values ($1,$2,$3,$4,$5)`,
        [id, l.seller_sku || null, l.name || null, l.variant || null, Math.max(0, Number(l.qty_declared) || 0)]);
    }
    audit(req, 'consignment.announce', { entityType: 'consignment_shipment', entityId: id, after: { lines: lines.length } });
    notify({ roles: ['admin', 'warehouse'], type: 'consignment-inbound', title: `Inbound stock ${id}`,
      body: `${lines.length} line${lines.length === 1 ? '' : 's'} announced`, href: '/inventory', entityId: id });
    return { ok: true, id };
  });

  // Putaway suggestion for a line, so the warehouse isn't inventing bins.
  app.get('/api/consignment/suggest-bin', { preHandler: requireStaff }, async (req) => {
    await ensure();
    const code = await suggestLocation(req.query?.internal_sku || null, Number(req.query?.qty) || 0);
    return { location: code };
  });

  /**
   * Receive a shipment: count each line, mint its internal SKU, shelve it.
   * body: { lines: [{ id, qty_received, location }] }
   *
   * Counts are recorded against the DECLARATION rather than replacing it, so a short or
   * over shipment stays visible as a discrepancy instead of being quietly overwritten.
   */
  app.post('/api/consignment/shipments/:id/receive', { preHandler: requireStaff }, async (req, reply) => {
    await ensure();
    const ship = (await q(`select * from consignment_shipments where id=$1`, [req.params.id])).rows[0];
    if (!ship) { reply.code(404); return { error: 'No such shipment' }; }
    if (ship.status === 'closed' || ship.status === 'cancelled') {
      reply.code(409); return { error: `Shipment is ${ship.status}.` };
    }
    const rows = Array.isArray((req.body || {}).lines) ? req.body.lines : [];
    const out = [];
    for (const r of rows) {
      const line = (await q(`select * from consignment_lines where id=$1 and shipment_id=$2`, [r.id, req.params.id])).rows[0];
      if (!line) continue;
      const qty = Math.max(0, Number(r.qty_received) || 0);
      const internal = line.internal_sku || (await mintInternalSku(ship.seller_id, line.id));
      const loc = String(r.location || '').toUpperCase().trim() || line.location || (await suggestLocation(internal, qty));
      if (loc && !BIN_RE.test(loc)) { reply.code(400); return { error: `Bin "${loc}" must look like A-03-2.` }; }
      await q(`update consignment_lines set qty_received=$1, internal_sku=$2, location=$3 where id=$4`,
        [qty, internal, loc, line.id]);
      out.push({ id: line.id, internal_sku: internal, location: loc, qty_received: qty, qty_declared: line.qty_declared });
    }
    const all = (await q(`select qty_declared, qty_received from consignment_lines where shipment_id=$1`, [req.params.id])).rows;
    const short = all.some((l) => Number(l.qty_received) !== Number(l.qty_declared));
    await q(`update consignment_shipments set status='shelved', received_at=now(), updated_at=now() where id=$1`, [req.params.id]);
    audit(req, 'consignment.receive', { entityType: 'consignment_shipment', entityId: req.params.id, after: { lines: out.length, discrepancy: short } });
    notify({ userIds: [ship.seller_id], type: 'consignment-received', title: `We received ${req.params.id}`,
      body: short ? 'Counted with a discrepancy against your declaration.' : 'Counted and shelved as declared.',
      href: '/inventory', entityId: req.params.id });
    return { ok: true, lines: out, discrepancy: short };
  });

  // Owned stock on hand, per seller. This is what a pick would draw from.
  app.get('/api/consignment/stock', { preHandler: requireAuth }, async (req) => {
    await ensure();
    const staff = isStaffRole(req.user);
    const r = await q(`
      select cl.internal_sku, cl.seller_sku, cl.name, cl.variant, cl.location,
             sum(cl.qty_received)::int as on_hand,
             sum(cl.qty_reserved)::int as reserved,
             s.seller_id, coalesce(nullif(u.name,''), u.email) as seller_name
        from consignment_lines cl
        join consignment_shipments s on s.id = cl.shipment_id
        left join users u on u.id = s.seller_id
       where cl.qty_received > 0 ${staff ? '' : 'and s.seller_id = $1'}
       group by cl.internal_sku, cl.seller_sku, cl.name, cl.variant, cl.location, s.seller_id, u.name, u.email
       order by seller_name nulls last, cl.name`,
      staff ? [] : [req.user.sub]);
    return r.rows;
  });

  app.patch('/api/consignment/shipments/:id', { preHandler: requireStaff }, async (req, reply) => {
    await ensure();
    const status = String((req.body || {}).status || '');
    if (!STATUSES.includes(status)) { reply.code(400); return { error: 'Invalid status' }; }
    const r = await q(`update consignment_shipments set status=$1, updated_at=now() where id=$2 returning id`, [status, req.params.id]);
    if (!r.rows[0]) { reply.code(404); return { error: 'No such shipment' }; }
    audit(req, 'consignment.status', { entityType: 'consignment_shipment', entityId: req.params.id, after: { status } });
    return { ok: true, status };
  });
}
