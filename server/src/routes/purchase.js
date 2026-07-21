// purchase.js — purchase orders (staff). A PO groups line items for one supplier; it
// moves draft → placed (sent to S&S/Otto via their order APIs, done from the client) →
// received (quantities added back into inventory). Whole-object upsert by `num`.

import { q, softQ } from '../db.js';

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

    const [ss, otto, inv] = await Promise.all([
      softQ('ss supplier lookup', 'select sku from ss_products where sku = any($1)', [skus]),
      softQ('otto supplier lookup', 'select sku from otto_products where sku = any($1)', [skus]),
      softQ('inventory supplier lookup', 'select sku, supplier from inventory where sku = any($1)', [skus]),
    ]);
    const ssSet = new Set(ss.rows.map((r) => String(r.sku)));
    const ottoSet = new Set(otto.rows.map((r) => String(r.sku)));
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

    const bySku = {};
    for (const sku of skus) {
      if (ssSet.has(sku)) { bySku[sku] = { api: 'ss', supplier: 'S&S Activewear', source: 'catalog' }; continue; }
      if (ottoSet.has(sku)) { bySku[sku] = { api: 'otto', supplier: 'Otto Cap', source: 'catalog' }; continue; }
      const name = invSup.get(sku) || null;
      bySku[sku] = { api: apiFromName(name), supplier: name, source: name ? 'inventory' : 'unknown' };
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
    return { ok: true, num };
  });

  app.delete('/api/purchase/:num', { preHandler: requireWarehouse }, async (req) => {
    await ensure();
    await q('delete from purchase_orders where num=$1', [req.params.num]).catch(() => {});
    return { ok: true };
  });
}
