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
    const r = await q('select data from catalog_products order by created_at desc');
    const rows = r.rows.map((row) => row.data).filter(Boolean);
    return isStaff(req.user) ? rows : rows.map(sellerSafe);
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
