// purchase.js — purchase orders (staff). A PO groups line items for one supplier; it
// moves draft → placed (sent to S&S/Otto via their order APIs, done from the client) →
// received (quantities added back into inventory). Whole-object upsert by `num`.

import { q, softQ } from '../db.js';
import { recordCost, recordCredit } from '../costs.js';

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
    // A failed query used to return [] — "no purchase orders", which is exactly what a
    // warehouse with nothing on order also sees. Log it and keep the fallback so the
    // page still renders, but the reason is now in the API log instead of nowhere.
    const r = await softQ('purchase orders list',
      'select num, supplier, items, status, total, meta, created_at from purchase_orders order by created_at desc');
    return r.rows;
  });

  /**
   * Which supplier each SKU actually comes from.
   *
   * The client used to infer this from the PO's supplier NAME with a substring match,
   * which sent every "Unassigned" PO to S&S because "unassigned" contains "ss". A PO's
   * name is a label someone typed; the supplier is a property of the PRODUCT, and both
   * catalogs are keyed by sku, so it can simply be looked up.
   *
   * Resolution order, most authoritative first:
   *   1. the synced catalogs — the sku IS theirs, which is as certain as this gets
   *   2. inventory.supplier — what a human recorded when the blank was stocked
   * A sku in neither resolves to no API: placeable by hand, never guessed at.
   */
  app.post('/api/purchase/resolve-suppliers', { preHandler: requireStaff }, async (req) => {
    await ensure();
    const skus = [...new Set((Array.isArray(req.body?.skus) ? req.body.skus : [])
      .map((x) => String(x || '').trim()).filter(Boolean))];
    if (!skus.length) return { bySku: {} };

    // Pull the IMAGE alongside the supplier. Product names differ by a word — "Unisex
    // DryBlend Crewneck" against "Unisex Heavy Blend Crewneck" — so a picture on the line
    // is what makes a mis-picked sku obvious before it's ordered rather than after it
    // arrives. One query already runs here; taking the image with it costs nothing.
    const [ss, otto, inv] = await Promise.all([
      softQ('ss supplier lookup', 'select sku, image, color, size from ss_products where sku = any($1)', [skus]),
      softQ('otto supplier lookup', 'select sku, image, color, size from otto_products where sku = any($1)', [skus]),
      softQ('inventory supplier lookup', 'select sku, supplier from inventory where sku = any($1)', [skus]),
    ]);
    const ssRow = new Map(ss.rows.map((r) => [String(r.sku), r]));
    const ottoRow = new Map(otto.rows.map((r) => [String(r.sku), r]));
    const ssSet = new Set(ssRow.keys());
    const ottoSet = new Set(ottoRow.keys());
    const invSup = new Map(inv.rows.map((r) => [String(r.sku), r.supplier || null]));

    // Only a name we can tie to an actual integration becomes an api. Anything else is
    // recorded as a supplier NAME with no api, so it's ordered by hand rather than sent
    // somewhere on the strength of a loose match.
    const apiFromName = (name) => {
      const n = String(name || '').trim().toLowerCase();
      if (!n || n === 'unassigned') return null;
      if (/\botto\b|ottocap/.test(n)) return 'otto';
      if (/s&s|\bss\b|activewear/.test(n)) return 'ss';
      return null;
    };

    // Both suppliers store raw URLs the browser can't load cross-origin, so route them
    // through the same proxy everything else uses. ssImg is idempotent.
    const { ssImgUrl } = await import('./ss.js').then((m) => ({ ssImgUrl: m.ssImgUrl })).catch(() => ({ ssImgUrl: null }));
    const proxied = (u) => (u && ssImgUrl ? ssImgUrl(u) : u || null);

    const bySku = {};
    for (const sku of skus) {
      const r = ssRow.get(sku) || ottoRow.get(sku) || null;
      const variant = r ? [r.color, r.size].filter(Boolean).join(' / ') || null : null;
      const image = proxied(r ? r.image : null);
      if (ssSet.has(sku)) { bySku[sku] = { api: 'ss', supplier: 'S&S Activewear', source: 'catalog', image, variant }; continue; }
      if (ottoSet.has(sku)) { bySku[sku] = { api: 'otto', supplier: 'Otto Cap', source: 'catalog', image, variant }; continue; }
      const name = invSup.get(sku) || null;
      bySku[sku] = { api: apiFromName(name), supplier: name, source: name ? 'inventory' : 'unknown', image: null, variant: null };
    }
    return { bySku };
  });

  /**
   * Everything a real supplier order needs, gathered in one read: where it ships, how it
   * pays, how it moves — plus an honest account of what's missing.
   *
   * Both supplier payloads have always ACCEPTED an address, a PO number and shipping and
   * payment methods; the UI simply never sent any of them, so the orders were routed
   * correctly and still incomplete. This is what lets the client fill them in.
   *
   * The ship-to is the factory's existing `ship_from` address — the warehouse is where
   * blanks are delivered, and it's already entered for shipping labels. A second address
   * field for the same building is a second thing to keep correct.
   *
   * Payment and shipping methods are fetched LIVE from Otto rather than hardcoded: they
   * are per-account (terms, negotiated carriers), so a baked-in list would be wrong for
   * anyone but whoever it was copied from, and wrong silently. S&S has no such endpoint —
   * it bills the account on file — which is stated rather than faked with an empty list.
   */
  app.get('/api/purchase/supplier-options', { preHandler: requireStaff }, async () => {
    const { readShipFrom, shipFromComplete, readAll } = await import('./factory_settings.js');
    const [shipFrom, cfg] = await Promise.all([readShipFrom().catch(() => ({})), readAll().catch(() => ({}))]);

    // Otto's methods come from THEIR API. A failure here is reported, not swallowed into
    // an empty list — "no payment methods" and "couldn't ask" look identical otherwise,
    // and one of them means the order will be placed on the wrong terms.
    let otto = { available: false, reason: 'Otto Cap is not configured.', paymentMethods: [], shippingMethods: [] };
    try {
      const { ottoEnabled, ottoGet } = await import('./ottocap.js');
      if (typeof ottoEnabled === 'function' && ottoEnabled()) {
        const [pay, ship] = await Promise.all([
          ottoGet('/payment_methods').catch((e) => ({ ok: false, error: e.message })),
          ottoGet('/shipping_methods').catch((e) => ({ ok: false, error: e.message })),
        ]);
        otto = {
          available: !!(pay && pay.ok),
          reason: pay && pay.ok ? null : `Couldn't read Otto's payment methods${pay && pay.error ? ` — ${pay.error}` : ''}.`,
          paymentMethods: (pay && pay.ok && pay.data) || [],
          shippingMethods: (ship && ship.ok && ship.data) || [],
        };
      }
    } catch (e) {
      otto = { available: false, reason: `Couldn't reach Otto Cap — ${e.message}`, paymentMethods: [], shippingMethods: [] };
    }

    return {
      shipTo: shipFrom || {},
      shipToComplete: shipFromComplete(shipFrom || {}),
      suppliers: {
        ss: {
          // S&S numbers its shipping methods; 1 is ground. Their API has no method list to
          // read, so this is the documented set rather than a live one — flagged as such
          // so nobody assumes it reflects the account.
          live: String(process.env.SS_ORDER_LIVE || '') === '1',
          paymentMethods: null,
          paymentNote: 'S&S bills the account on file — there is no payment method to choose per order.',
          shippingMethods: [{ id: '1', label: 'Ground' }, { id: '2', label: '2nd Day Air' }, { id: '3', label: 'Next Day Air' }],
          shippingNote: 'From the S&S Orders doc, not read from your account.',
        },
        otto: { live: String(process.env.OTTOCAP_ORDER_LIVE || '') === '1', ...otto },
      },
      defaults: {
        ss_shipping_method: cfg.ss_shipping_method ?? '1',
        otto_payment_method: cfg.otto_payment_method ?? 'net30',
        otto_shipping_method: cfg.otto_shipping_method ?? '',
        order_email: cfg.order_email ?? '',
      },
    };
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

    // Blanks are the largest thing the factory buys and were the ONE external cost never
    // reaching the ledger — costs.js has always had a category for them, but nothing ever
    // called it. So the P&L counted every label, dispatch and design fee, and none of the
    // stock.
    //
    // Booked on RECEIPT, not on placing. A placed PO can still be cancelled, and a cost
    // recorded for goods that never arrive overstates spend. Receipt is the point the
    // money is genuinely gone.
    //
    // Idempotent on the PO number, so re-saving a received PO (editing a line, pasting a
    // tracking number) books once and only once.
    if (String(b.status || '') === 'received' && total > 0) {
      await recordCost('blanks', total, `po-${num}`,
        `Blanks · ${b.supplier || 'unassigned supplier'} · PO ${num}`);
    }
    return { ok: true, num };
  });

  /**
   * Send stock back to a supplier.
   *
   * The purchase-order equivalent of a refund, and deliberately a two-step: goods go back
   * now, the credit lands whenever the supplier decides it does. Booking the credit at
   * return time would put money in the P&L that hasn't arrived — the same mistake as
   * marking an order Refunded without refunding it.
   *
   * NOTE: this does NOT tell the supplier anything. Neither S&S's nor Otto's API has a
   * documented return endpoint in anything we hold, so the RMA is raised with them the
   * usual way; this records what left and what is owed back.
   */
  app.post('/api/purchase/:num/return', { preHandler: requireWarehouse }, async (req, reply) => {
    await ensure();
    const num = String(req.params.num);
    const b = req.body || {};
    const po = (await q('select num, supplier, items, status, meta from purchase_orders where num=$1', [num])).rows[0];
    if (!po) { reply.code(404); return { error: 'Purchase order not found' }; }
    if (po.status !== 'received') {
      reply.code(409);
      return { error: 'Only a received order can be returned — nothing has arrived on this one yet.' };
    }

    const onPo = new Map((Array.isArray(po.items) ? po.items : []).map((l) => [String(l.sku), l]));
    const lines = (Array.isArray(b.lines) ? b.lines : [])
      .map((l) => ({ sku: String(l.sku || '').trim(), qty: parseInt(l.qty, 10) || 0, credit: Number(l.credit) || 0 }))
      .filter((l) => l.sku && l.qty > 0 && onPo.has(l.sku));
    if (!lines.length) { reply.code(400); return { error: 'Pick at least one line to return.' }; }

    // Never return more than arrived. A return larger than the receipt would pull stock
    // that was never on the shelf and claim a credit larger than the purchase.
    for (const l of lines) {
      const had = parseInt(onPo.get(l.sku).qty, 10) || 0;
      if (l.qty > had) {
        reply.code(400);
        return { error: `Can't return ${l.qty} of ${l.sku} — only ${had} were received.` };
      }
    }

    const meta = (po.meta && typeof po.meta === 'object') ? po.meta : {};
    const returns = Array.isArray(meta.returns) ? meta.returns : [];
    const entry = {
      id: String(returns.length + 1),
      at: new Date().toISOString(),
      by: req.user && req.user.sub ? String(req.user.sub) : null,
      note: b.note ? String(b.note).slice(0, 500) : null,
      rma: b.rma ? String(b.rma).slice(0, 120) : null,
      lines,
      credit: Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100,
      status: 'pending',
    };

    // Stock leaves the shelf NOW — the goods are physically going back, whatever the
    // supplier decides about the money.
    for (const l of lines) {
      await q('update inventory set in_stock = greatest(0, coalesce(in_stock,0) - $2) where sku=$1', [l.sku, l.qty])
        .catch(() => {});
    }

    await q('update purchase_orders set meta=$2 where num=$1',
      [num, JSON.stringify({ ...meta, returns: [...returns, entry] })]);
    return { ok: true, return: entry };
  });

  /**
   * The credit actually landed. Books it as a positive row against the blanks cost —
   * append-only, so "spent $400, got $120 back" stays two facts rather than one net $280.
   */
  app.post('/api/purchase/:num/return/:id/credit', { preHandler: requireWarehouse }, async (req, reply) => {
    await ensure();
    const num = String(req.params.num);
    const po = (await q('select num, supplier, meta from purchase_orders where num=$1', [num])).rows[0];
    if (!po) { reply.code(404); return { error: 'Purchase order not found' }; }
    const meta = (po.meta && typeof po.meta === 'object') ? po.meta : {};
    const returns = Array.isArray(meta.returns) ? meta.returns : [];
    const idx = returns.findIndex((r) => String(r.id) === String(req.params.id));
    if (idx < 0) { reply.code(404); return { error: 'Return not found' }; }
    if (returns[idx].status === 'credited') return { ok: true, already: true, return: returns[idx] };

    // The amount that actually arrived can differ from what was expected — restocking
    // fees, a partial credit — so the confirmed figure wins over the estimate.
    const amount = req.body && req.body.amount != null
      ? Math.max(0, Number(req.body.amount) || 0)
      : Number(returns[idx].credit) || 0;
    if (amount <= 0) { reply.code(400); return { error: 'A credit needs an amount greater than zero.' }; }

    await recordCredit('blanks', amount, `po-return-${num}-${returns[idx].id}`,
      `Supplier credit · ${po.supplier || 'unassigned supplier'} · PO ${num}`);

    returns[idx] = { ...returns[idx], status: 'credited', creditedAt: new Date().toISOString(), credit: amount };
    await q('update purchase_orders set meta=$2 where num=$1', [num, JSON.stringify({ ...meta, returns })]);
    return { ok: true, return: returns[idx] };
  });

  app.delete('/api/purchase/:num', { preHandler: requireWarehouse }, async (req) => {
    await ensure();
    await q('delete from purchase_orders where num=$1', [req.params.num]).catch(() => {});
    return { ok: true };
  });
}
