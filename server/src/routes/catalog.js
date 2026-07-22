// Catalog products API — the shared product catalog the factory publishes and
// sellers browse. GET is readable by any signed-in user; writes are staff-only.
// Products carry image data URLs, so we store the whole product object in a
// `data` jsonb column (lossless round-trip) plus a few typed columns for TablePlus.
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { quoteSpec } from '../pricing.js';
import { notify } from './notifications.js';
import { audit } from '../audit.js';

// Roles that OWN pricing. A change by anyone else is legitimate — operators build
// products, and that is the point — but it should not happen unseen, because a base
// cost is what every seller is charged.
const PRICE_OWNERS = new Set(['admin', 'warehouse']);
const money = (v) => Number(v || 0);

export function catalogRoutes(app, requireAuth, requireStaff) {
  // Add the lossless `data` column if an older schema doesn't have it (idempotent).
  q('alter table catalog_products add column if not exists data jsonb').catch(() => {});
  /**
   * THE PUBLISHED CATALOGUE — a curated shop window, deliberately separate from billing.
   *
   * `catalog_price` is what a buyer is SHOWN. `base_price` is what an order CHARGES. They
   * are different numbers on purpose: this catalogue is presented to US companies at trade
   * prices that are not what our sellers pay, and writing those into base_price would move
   * every seller's next invoice.
   *
   * The cost is never involved in what leaves here. A markup is computed server-side FROM
   * cost and only the RESULT is stored — so the percentage and the supplier price stay
   * ours, and sellerSafe below has nothing extra to strip.
   */
  q('alter table catalog_products add column if not exists in_catalog boolean not null default false').catch(() => {});
  q('alter table catalog_products add column if not exists catalog_price numeric(12,2)').catch(() => {});

  // What one unit of a spec costs us to make + ship. Powers the margin readout in the
  // publish dialog, using the SAME pricing path that bills an order.
  app.get('/api/pricing/spec', { preHandler: requireAuth }, async (req) => {
    const qy = req.query || {};
    return quoteSpec({ blank: qy.blank, sku: qy.sku, size: qy.size, printType: qy.printType });
  });

  // What a SELLER may not see: what the blank costs US. `productCost` and each size
  // tier's `cost` are supplier prices — the seller's own number is the base price, which
  // is productCost + markup (see unitCostOf in pricing.js). Handing back the raw blob let
  // any signed-in seller read our supplier cost AND derive the markup from it, on a route
  // every seller-facing page already calls. Stripped on the way out rather than at each
  // call site, so a new consumer can't reintroduce the leak.
  const sellerSafe = (data) => {
    if (!data || typeof data !== 'object') return data;
    const { productCost, product_cost, ...rest } = data;
    if (Array.isArray(rest.sizePrices)) {
      rest.sizePrices = rest.sizePrices.map((t) => {
        if (!t || typeof t !== 'object') return t;
        const { cost, ...tier } = t;
        return tier;
      });
    }
    return rest;
  };

  app.get('/api/catalog_products', { preHandler: requireAuth }, async (req) => {
    const r = await q('select data, in_catalog, catalog_price from catalog_products order by created_at desc');
    const rows = r.rows
      .filter((row) => row.data)
      // The catalogue fields ride on the product rather than in a parallel list, so a
      // consumer can't hold a product and miss whether it's published.
      .map((row) => ({ ...row.data, inCatalog: !!row.in_catalog, catalogPrice: row.catalog_price == null ? null : Number(row.catalog_price) }));
    return isStaff(req.user) ? rows : rows.map(sellerSafe);
  });

  /**
   * Include or exclude products from the published catalogue.
   *
   * Staff-only, and separate from the price routes: choosing what to show and choosing what
   * to charge for it are different decisions, and bundling them means one careless call
   * does both.
   */
  app.post('/api/catalog/selection', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? b.ids.map(String).filter(Boolean) : [];
    if (!ids.length) { reply.code(400); return { error: 'No products selected.' }; }
    const on = !!b.include;
    const r = await q('update catalog_products set in_catalog=$2 where id = any($1::text[])', [ids, on]);
    audit(req, 'catalog.selection', { entityType: 'catalog', entityId: 'selection', after: { include: on, count: r.rowCount } });
    return { ok: true, updated: r.rowCount, include: on };
  });

  /**
   * Set the catalogue price — one product at a time, or a markup across a selection.
   *
   * NEVER touches base_price. That number bills orders, and a catalogue is a presentation
   * of prices to people who are not our sellers; moving it here would raise a seller's
   * invoice as a side effect of preparing a trade brochure.
   *
   * The markup is computed from OUR COST, server-side, and only the result is stored. The
   * percentage and the cost never leave this function — so a published catalogue cannot be
   * worked backwards into what we pay S&S.
   */
  app.post('/api/catalog/pricing', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};

    // One explicit price.
    if (b.id != null && b.price !== undefined) {
      const price = b.price === null || b.price === '' ? null : Math.max(0, Number(b.price));
      if (price !== null && !isFinite(price)) { reply.code(400); return { error: 'Price must be a number.' }; }
      const r = await q('update catalog_products set catalog_price=$2 where id=$1', [String(b.id), price]);
      if (!r.rowCount) { reply.code(404); return { error: 'No such product.' }; }
      audit(req, 'catalog.price', { entityType: 'catalog', entityId: String(b.id), after: { catalogPrice: price } });
      return { ok: true, id: String(b.id), catalogPrice: price };
    }

    // Or a markup over cost, across a set.
    const ids = Array.isArray(b.ids) ? b.ids.map(String).filter(Boolean) : [];
    const pct = Number(b.markupPct);
    if (!ids.length || !isFinite(pct)) { reply.code(400); return { error: 'Send either {id, price} or {ids, markupPct}.' }; }
    if (pct < 0) { reply.code(400); return { error: 'A negative markup would price below cost — set the price explicitly if that is intended.' }; }

    const rows = await q('select id, data from catalog_products where id = any($1::text[])', [ids])
      .then((r) => r.rows).catch(() => []);
    let priced = 0;
    const noCost = [];
    for (const row of rows) {
      const d = row.data || {};
      const cost = Number(d.productCost ?? d.product_cost);
      // A product with no recorded cost cannot be marked up, and guessing one would put a
      // made-up number in front of a buyer. Reported back rather than skipped in silence.
      if (!isFinite(cost) || cost <= 0) { noCost.push(row.id); continue; }
      const price = Math.round(cost * (1 + pct / 100) * 100) / 100;
      await q('update catalog_products set catalog_price=$2 where id=$1', [row.id, price]).catch(() => {});
      priced++;
    }
    audit(req, 'catalog.markup', { entityType: 'catalog', entityId: 'bulk', after: { markupPct: pct, priced, skipped: noCost.length } });
    return { ok: true, priced, skippedNoCost: noCost };
  });

  // Full-list upsert: insert/update everything sent, then drop products removed locally.
  app.post('/api/catalog_products', { preHandler: requireStaff }, async (req, reply) => {
    const products = Array.isArray(req.body) ? req.body : [];
    // An empty list used to mean "delete every product", which is never what a full-list
    // sync intends — it's what a caller sends when it has nothing to send. The client
    // seeds this from localStorage, and the store deliberately clears the catalog cache
    // under quota pressure, so a cleared cache became: POST [] → the shared catalog every
    // seller browses is destroyed, taking base_price (which bills orders) with it. The
    // read path already refuses to treat "empty" as "none" for the same reason; this is
    // the write side of that guard. Deleting the last product is a per-id DELETE.
    if (!products.length) {
      reply.code(400);
      return { error: 'Refusing to replace the catalog with an empty list. To remove products, delete them individually.' };
    }
    const keep = [];
    // Snapshot the prices BEFORE the upsert, so a change can be reported as
    // before → after rather than just "something was edited".
    const actorOwnsPricing = PRICE_OWNERS.has(req.user && req.user.role);
    let before = new Map();
    if (!actorOwnsPricing) {
      try {
        const r = await q('select id, name, base_price, price from catalog_products');
        before = new Map(r.rows.map((x) => [String(x.id), x]));
      } catch (e) { req.log?.warn?.({ err: String(e) }, 'catalog price snapshot failed'); }
    }
    const priceChanges = [];

    for (const p of products) {
      const id = String(p.id != null ? p.id : '');
      if (!id) continue;
      keep.push(id);
      if (!actorOwnsPricing) {
        const was = before.get(id);
        if (was) {
          const newBase = money(p.basePrice ?? p.base_price ?? 0);
          const newRetail = money(p.price ?? 0);
          if (money(was.base_price) !== newBase || money(was.price) !== newRetail) {
            priceChanges.push({
              id, name: p.name || was.name || id,
              baseFrom: money(was.base_price), baseTo: newBase,
              priceFrom: money(was.price), priceTo: newRetail,
            });
          }
        }
      }
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
    // Same reasoning as the empty-body guard: a payload whose every entry lacked an id
    // leaves `keep` empty, and pruning against an empty keep-list is a full wipe. Prune
    // only when we actually know what to keep.
    if (keep.length) {
      await q(`delete from catalog_products where id <> all($1::text[])`, [keep]);
    }
    // Operators building products is intended; changing what sellers are charged is
    // the part that needs an owner's eyes. One notification per save, naming the
    // products and the movement — not one per product, which would bury it.
    if (priceChanges.length) {
      const who = (req.user && (req.user.email || req.user.sub)) || 'a staff member';
      const first = priceChanges[0];
      const more = priceChanges.length - 1;
      const fmt = (n) => '$' + Number(n).toFixed(2);
      notify({
        roles: ['admin'],
        type: 'price-changed',
        title: `Price changed by ${req.user?.role || 'staff'}`,
        body: `${who} changed ${first.name}: base ${fmt(first.baseFrom)} → ${fmt(first.baseTo)}`
          + (first.priceFrom !== first.priceTo ? `, retail ${fmt(first.priceFrom)} → ${fmt(first.priceTo)}` : '')
          + (more > 0 ? ` (and ${more} other product${more === 1 ? '' : 's'})` : ''),
        href: '/products',
      }).catch(() => {});
      audit(req, 'product.price', { entityType: 'catalog_product', entityId: first.id,
        before: priceChanges.map((c) => ({ id: c.id, base: c.baseFrom, price: c.priceFrom })),
        after: priceChanges.map((c) => ({ id: c.id, base: c.baseTo, price: c.priceTo })) });
    }
    return { ok: true, count: keep.length, priceChanges: priceChanges.length };
  });
}
