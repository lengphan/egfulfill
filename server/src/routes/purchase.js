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

/**
 * What the supplier ACTUALLY CHARGED for this PO, out of the response they returned when
 * it was placed. `null` when their reply carries no total — never 0, because "they billed
 * nothing" and "we can't read what they billed" must not book the same number.
 *
 * Only fields seen coming back from a live call are read:
 *   Otto  `ottoResponse[].grand_total` — goods + freight + tax, the figure on the card.
 *         Their `sub_total` is the goods alone and is exactly what our line sum already is.
 *   S&S   `orders[].total` — one order per warehouse on a split, so they SUM.
 *   Alibaba `alibabaOrder.total` — what they billed, freight included. Imported from a
 *         real order rather than placed here, so this figure is settled fact, not an
 *         estimate: the goods were already paid for on their site.
 * Anything else falls through to null and the caller uses the line total, which is the
 * behaviour that was there before.
 *
 * A dry run or a rejection is skipped: no money moved, so there is nothing to prefer over
 * the line sum.
 */
function supplierCharged(meta) {
  const r = (meta && typeof meta === 'object' && meta.response) || null;
  if (!r || typeof r !== 'object' || r.dryRun === true || r.error) return null;
  const sum = (rows, field) => {
    const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    let t = 0, seen = false;
    for (const x of list) {
      const v = Number(x && x[field]);
      if (isFinite(v) && v > 0) { t += v; seen = true; }
    }
    return seen ? t : null;
  };
  return sum(r.ottoResponse, 'grand_total') ?? sum(r.orders, 'total') ?? sum(r.alibabaOrder, 'total') ?? null;
}

/**
 * ONE NAME PER SUPPLIER, so their spend doesn't split across spellings.
 *
 * `purchase_orders.supplier` holds a display name typed or picked in the UI, not a key —
 * live values include "Otto Cap", "S&S Activewear", "SanMar", "Unassigned" and the names of
 * individual Alibaba sellers. That is the right thing to store (an Alibaba seller has no
 * key and shouldn't be forced one), but booked straight into the ledger it means "S&S
 * Activewear" and "S&S ActiveWear" become two suppliers who each look half as expensive.
 *
 * So the three we integrate with are pinned to a canonical name, and everyone else passes
 * through trimmed — which is what keeps each Alibaba seller its own line rather than being
 * swallowed into one "Alibaba" total, since they are separate people we pay separately.
 *
 * "Unassigned" and blank both become null: a cost with no supplier is unattributed, and
 * saying so is better than inventing a supplier called Unassigned to carry it.
 */
function supplierKey(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n || /^unassigned$/i.test(n)) return null;
  // Matched on a LETTERS-ONLY form, because the variants differ by exactly the characters a
  // regex on the raw string trips over: "S&S Activewear", "S&S ActiveWear", "ss activewear"
  // and "SSActivewear" are one supplier separated by an ampersand and a space.
  const flat = n.toLowerCase().replace(/[^a-z]/g, '');
  /**
   * ANCHORED, not `includes`. `flat.includes('otto')` also matches "cotton" — so "Cotton
   * Heritage", a different supplier entirely, was booking every purchase against Otto Cap
   * and quietly corrupting the per-supplier spend breakdown that exists to answer "what do
   * we spend with whom".
   *
   * A substring test is the right shape for the S&S variants (the name itself varies:
   * "S&S Activewear", "SSActivewear"), and the wrong shape for a short word that lives
   * inside other words. So `otto` must START the name — Otto Cap, Ottocap, "otto cap
   * inc" — while "cottonheritage" no longer does.
   */
  if (/^otto/.test(flat)) return 'Otto Cap';
  if (flat.includes('sanmar')) return 'SanMar';
  if (flat.includes('activewear') || flat === 'ss') return 'S&S Activewear';
  return n;
}

/**
 * The BANK/CARD FEE on a purchase order, typed in by whoever reconciled the statement.
 *
 * Deliberately hand-entered, not a percentage rule. Paying a supplier by card can add a
 * foreign-transaction fee, an FX margin and a wire fee — three different numbers that vary
 * by card and by supplier — so a configured rate would be an estimate that drifts from the
 * statement it is meant to match. Typed once against the PO it belongs to, it is exact.
 *
 * Read from meta so no column has to be added, and tolerated in either spelling because
 * this is filled in by a human through a form, not by a system.
 */
function supplierFee(meta) {
  const m = (meta && typeof meta === 'object') ? meta : {};
  const v = Number(m.bankFee ?? m.bank_fee ?? m.fee);
  return isFinite(v) && v > 0 ? v : 0;
}

/**
 * A credential preview — enough to tell WHICH key is configured, never enough to use it.
 * Short values are masked entirely: revealing half of a 12-character secret is most of it.
 */
function maskKey(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.length < 12) return '••••••••';
  return s.slice(0, 4) + '••••••' + s.slice(-4);
}

// ADMIN-only, both the reads and the writes. Purchasing commits company money to a supplier
// and the list itself shows unit costs across every blank we buy. Receiving stock is NOT
// here — that's /api/inventory/scan and /api/inventory/item in inventory.js, still on the
// warehouse gate — so locking this does not stop the floor booking deliveries in.
export function purchaseRoutes(app, requireAuth, requireAdmin, requireAdminWrite) {
  app.get('/api/purchase', { preHandler: requireAdmin }, async () => {
    await ensure();
    // A failed query used to return [] — "no purchase orders", which is exactly what a
    // warehouse with nothing on order also sees. Log it and keep the fallback so the
    // page still renders, but the reason is now in the API log instead of nowhere.
    const r = await softQ('purchase orders list',
      'select num, supplier, items, status, total, meta, created_at from purchase_orders order by created_at desc');
    return r.rows;
  });

  /**
   * Every brand, category and the price range across BOTH suppliers' catalogues.
   *
   * The filters were built from whatever happened to be on screen, so a brand two pages
   * deep simply wasn't offered — and the fewer results a search returned, the fewer ways
   * there were to narrow it. That's backwards: a filter exists to reach what you can't
   * already see.
   *
   * DISTINCT over indexed columns rather than loading rows to derive it — the point is to
   * avoid paging through a catalogue, not to page through it server-side instead.
   */
  app.get('/api/purchase/catalog-filters', { preHandler: requireAdmin }, async () => {
    const [ssB, ottoB, ssC, ottoC, ssP, ottoP] = await Promise.all([
      softQ('ss brands', "select distinct brand from ss_products where coalesce(brand,'') <> ''"),
      softQ('otto brands', "select distinct brand from otto_products where coalesce(brand,'') <> ''"),
      softQ('ss cats', "select distinct category from ss_products where coalesce(category,'') <> ''"),
      softQ('otto cats', "select distinct category from otto_products where coalesce(category,'') <> ''"),
      softQ('ss price', 'select min(price)::float lo, max(price)::float hi from ss_products where price > 0'),
      softQ('otto price', 'select min(price)::float lo, max(price)::float hi from otto_products where price > 0'),
    ]);
    const uniq = (rows, col) => rows.map((r) => String(r[col]).trim()).filter(Boolean);
    const brands = [...new Set([...uniq(ssB.rows, 'brand'), ...uniq(ottoB.rows, 'brand')])]
      .sort((a, b) => a.localeCompare(b));
    const categories = [...new Set([...uniq(ssC.rows, 'category'), ...uniq(ottoC.rows, 'category')])]
      .sort((a, b) => a.localeCompare(b));
    const lows = [ssP.rows[0]?.lo, ottoP.rows[0]?.lo].filter((n) => n != null);
    const highs = [ssP.rows[0]?.hi, ottoP.rows[0]?.hi].filter((n) => n != null);
    return {
      brands, categories,
      priceMin: lows.length ? Math.floor(Math.min(...lows)) : null,
      priceMax: highs.length ? Math.ceil(Math.max(...highs)) : null,
    };
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
  app.post('/api/purchase/resolve-suppliers', { preHandler: requireAdmin }, async (req) => {
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
  app.get('/api/purchase/supplier-options', { preHandler: requireAdmin }, async () => {
    const { readShipFrom, shipFromComplete, readAll } = await import('./factory_settings.js');
    const [shipFrom, cfg] = await Promise.all([readShipFrom().catch(() => ({})), readAll().catch(() => ({}))]);

    // Otto's methods come from THEIR API. A failure here is reported, not swallowed into
    // an empty list — "no payment methods" and "couldn't ask" look identical otherwise,
    // and one of them means the order will be placed on the wrong terms.
    /**
     * WHAT OTTO WILL ACTUALLY ACCEPT.
     *
     * Their /shipping_methods endpoint returns their whole global catalogue — Library Mail,
     * every USPS service, every UPS service, FedEx — and their ORDER validator then refuses
     * most of it. Picking USPS Priority off their own list came back as:
     *
     *   "shipping_method: The USPS service is not available … type: no_service · options:
     *    FEDEX Priority Overnight®, FEDEX Priority Overnight® Third Party, FEDEX Standard
     *    Overnight®, FEDEX Standard Overnight® Third Party, FEDEX Ground, FEDEX Ground
     *    Third Party, FEDEX 2Day®, FEDEX 2Day® Third Party"
     *
     * So the two endpoints disagree, and rendering the catalogue verbatim offered forty
     * choices where EIGHT work. That is Otto's complete list, quoted above verbatim.
     *
     * Matched loosely on the label because their list carries the ® and the "Third Party"
     * suffixes, and an exact-string allow-list would silently empty the dropdown the first
     * time they reworded one. 2Day was missing from the first cut of this because the
     * screenshot of their refusal was truncated — the fix for guessing at a truncated list
     * is to read the whole one, not to guess better.
     */
    const OTTO_OK = /^fedex\s+(priority overnight|standard overnight|ground|2day)/i;
    const ottoUsable = (list) => {
      const rows = Array.isArray(list) ? list : [];
      const text = (m) => String((m && (m.label ?? m.name ?? m.description ?? m.value)) ?? m ?? '');
      const kept = rows.filter((m) => OTTO_OK.test(text(m).trim()));
      // Never hand back an empty picker: if Otto rename these, showing everything is worse
      // than showing nothing but far better than showing nothing AND blocking every order.
      return kept.length ? kept : rows;
    };

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
          shippingMethods: ottoUsable((ship && ship.ok && ship.data) || []),
        };
      }
    } catch (e) {
      otto = { available: false, reason: `Couldn't reach Otto Cap — ${e.message}`, paymentMethods: [], shippingMethods: [] };
    }

    // S&S payment profiles — the stored cards and bank accounts on the account. Read here
    // so the settings window can show WHICH card pays each supplier: their `name` already
    // carries the last four ("BMO Harris Bank 1234"), which is the useful part, and no
    // full number is ever returned by their API or stored by us.
    let ssProfiles = { available: false, reason: null, profiles: [] };
    try {
      // S&S's own address first — their profiles belong to the person who registered.
      const email = String(cfg.ss_order_email || cfg.order_email || '').trim();
      if (!email) {
        ssProfiles.reason = 'Set an order confirmation email — S&S payment profiles belong to a person on the account, not the account itself.';
      } else {
        const { ssPaymentProfiles } = await import('./ss.js');
        const r = await ssPaymentProfiles(email);
        ssProfiles = r.error
          ? { available: false, reason: r.error, profiles: [] }
          : { available: true, reason: null, profiles: r.profiles || [] };
      }
    } catch (e) {
      ssProfiles = { available: false, reason: `Couldn't read S&S payment profiles — ${e.message}`, profiles: [] };
    }

    // Masked credential previews, so "is S&S actually connected" is answerable here
    // rather than by navigating to Integrations. Read-only and never full values — this
    // endpoint has no business handing out a key it only needs to confirm the shape of.
    let keys = {};
    try {
      const r = await q("select key, value from settings where key like 'secret:%'").catch(() => ({ rows: [] }));
      void r;
      keys = {
        ss: { set: !!process.env.SS_API_KEY, masked: maskKey(process.env.SS_API_KEY), account: process.env.SS_ACCOUNT_NUMBER || null },
        otto: { set: !!(process.env.OTTOCAP_CLIENT_ID && process.env.OTTOCAP_CLIENT_SECRET),
                masked: maskKey(process.env.OTTOCAP_CLIENT_SECRET), user: process.env.OTTOCAP_USERNAME || null },
      };
    } catch { keys = {}; }

    // Otto's customers + their contacts. Required on every order and only obtainable from
    // them, so the settings window offers a choice rather than expecting someone to paste
    // a GUID.
    let ottoCustomers = [];
    try {
      const { ottoEnabled, ottoGet } = await import('./ottocap.js');
      if (ottoEnabled()) {
        const c = await ottoGet('/customers').catch(() => null);
        if (c && c.ok && Array.isArray(c.data)) {
          ottoCustomers = c.data.map((x) => ({
            id: String(x.id || ''),
            name: x.company_name || [x.first_name, x.last_name].filter(Boolean).join(' ') || x.email || x.id,
            contacts: (Array.isArray(x.contacts) ? x.contacts : []).map((k) => ({
              id: String(k.id || ''),
              name: [k.first_name, k.last_name].filter(Boolean).join(' ') || k.email || k.id,
            })).filter((k) => k.id),
          })).filter((x) => x.id);
        }
      }
    } catch { ottoCustomers = []; }

    return {
      keys,
      ottoCustomers,
      shipTo: shipFrom || {},
      shipToComplete: shipFromComplete(shipFrom || {}),
      suppliers: {
        ss: {
          paymentProfiles: ssProfiles,
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
        ss_payment_profile: cfg.ss_payment_profile ?? '',
        ss_order_email: cfg.ss_order_email ?? '',
        otto_order_email: cfg.otto_order_email ?? '',
        otto_customer: cfg.otto_customer ?? '',
        otto_contact: cfg.otto_contact ?? '',
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
  app.post('/api/purchase', { preHandler: requireAdminWrite }, async (req, reply) => {
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
    //
    // What is booked is what the SUPPLIER CHARGED, not what the lines add up to. Otto bill
    // freight on top of the goods: a real order of one cap came back sub_total 3.60,
    // shipping_total 17.75, grand_total 21.35 — so the line sum understated that PO by 83%
    // of it, and every Otto order in the P&L was short by its whole shipping cost. Freight
    // on inbound stock is part of what the stock cost; it does not become free by arriving
    // on a different line of their invoice.
    if (String(b.status || '') === 'received') {
      const charged = supplierCharged(b.meta);
      const amount = charged ?? total;
      if (amount > 0) {
        await recordCost('blanks', amount, `po-${num}`,
          `Blanks · ${b.supplier || 'unassigned supplier'} · PO ${num}`
          // Say which figure this is. "$21.35 against a $3.60 PO" is a discrepancy someone
          // will otherwise have to open the supplier's invoice to explain.
          + (charged != null && Math.abs(charged - total) >= 0.01
              ? ` · supplier charged ${charged.toFixed(2)} (goods ${total.toFixed(2)} + freight/tax)`
              : ''),
          // WHICH supplier. Without this every PO books as an anonymous 'suppliers' row and
          // the spend with S&S, Otto, SanMar and Alibaba can never be told apart.
          { partner: supplierKey(b.supplier) });

        /**
         * THE BANK'S CUT, when there was one.
         *
         * Entered by hand because only the statement knows it: a foreign-transaction fee, an
         * FX margin and a wire fee are three different numbers, they differ by card and by
         * supplier, and a percentage rule would be a guess that quietly drifts from the real
         * charge. Typed once against the PO it belongs to, it is exact.
         *
         * Booked against the SAME supplier, so their landed cost is complete, but under its
         * own type so "what they charged" and "what it cost to pay them" stay separable.
         */
        const fee = Number(supplierFee(b.meta));
        if (isFinite(fee) && fee > 0) {
          await recordCost('bank', fee, `po-fee-${num}`,
            `Bank/card fee · ${b.supplier || 'unassigned supplier'} · PO ${num}`,
            { partner: supplierKey(b.supplier) });
        }
      }
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
  app.post('/api/purchase/:num/return', { preHandler: requireAdminWrite }, async (req, reply) => {
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
  app.post('/api/purchase/:num/return/:id/credit', { preHandler: requireAdminWrite }, async (req, reply) => {
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

  app.delete('/api/purchase/:num', { preHandler: requireAdminWrite }, async (req) => {
    await ensure();
    await q('delete from purchase_orders where num=$1', [req.params.num]).catch(() => {});
    return { ok: true };
  });
}
