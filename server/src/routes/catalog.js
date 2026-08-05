// Catalog products API — the shared product catalog the factory publishes and
// sellers browse. GET is readable by any signed-in user; writes are staff-only.
// Products carry image data URLs, so we store the whole product object in a
// `data` jsonb column (lossless round-trip) plus a few typed columns for TablePlus.
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { quoteSpec } from '../pricing.js';
import { notify } from './notifications.js';
import { audit } from '../audit.js';
import { ssImgUrl, ssStyleDescriptions, ssSpecs } from './ss.js';

// Roles that OWN pricing. A change by anyone else is legitimate — operators build
// products, and that is the point — but it should not happen unseen, because a base
// cost is what every seller is charged.
const PRICE_OWNERS = new Set(['admin', 'warehouse']);
const money = (v) => Number(v || 0);

export function catalogRoutes(app, requireAuth, requireStaff, requireWarehouse) {
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

  /**
   * PUBLIC product cards for the marketing site. NO AUTH — the only route here without it.
   *
   * Because of that it is an ALLOW-LIST, not a redaction. sellerSafe() strips known-sensitive
   * keys from whatever the row happens to hold, which is the right shape for a logged-in
   * seller but the wrong one for the open internet: the day someone adds a field to
   * catalog_products, a redaction list silently starts publishing it. This builds a new object
   * from four named fields and nothing else can leak by being added upstream.
   *
   * Published only (in_catalog), priced only. An unpriced product on a pricing-led page
   * reads as "free" or as broken, and a draft nobody chose to publish should not be visible
   * at all — that flag is what "published" MEANS.
   */
  app.get('/api/public/products', async () => {
    const r = await q(
      `select data, catalog_price from catalog_products
        where in_catalog = true and catalog_price is not null
        order by catalog_price asc nulls last limit 24`
    ).catch(() => ({ rows: [] }));
    return {
      products: r.rows
        .filter((row) => row.data && row.data.name)
        .map((row) => ({
          name: String(row.data.name),
          // The mockup a seller sees, if there is one. Never a supplier URL or an internal key.
          image: typeof row.data.image === 'string' ? row.data.image : null,
          category: typeof row.data.category === 'string' ? row.data.category : null,
          price: Number(row.catalog_price),
        })),
    };
  });

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
   * PUBLISHING A SUPPLIER STYLE, without copying it.
   *
   * catalog_products holds products WE built — priced, named, print method chosen. Turning
   * 825 synced S&S styles into products to publish them would mean 825 rows of duplicated
   * supplier data that goes stale the moment they re-sync, on a box with 1GB of RAM.
   *
   * So a pick is one small row: which supplier, which style, what we charge for it.
   * Everything shown — images, colourways, sizes, names — is READ from ss_products at
   * export time, which is already synced and already current. Nothing is copied, so
   * nothing can drift.
   */
  q(`create table if not exists catalog_picks (
       source text not null,
       ref text not null,
       catalog_price numeric(12,2),
       created_at timestamptz default now(),
       primary key (source, ref)
     )`).catch(() => {});

  /** Browse the synced supplier catalogue, style by style. Paged, because 825 styles is
   *  not a dropdown and the box holding them has 1GB of RAM. */
  app.get('/api/catalog/supplier-styles', { preHandler: requireStaff }, async (req) => {
    const qy = req.query || {};
    const term = String(qy.q || '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(qy.limit) || 40));
    const offset = Math.max(0, Number(qy.offset) || 0);
    const args = [];
    let where = "where p.style_id is not null and p.style_id <> ''";
    if (term) {
      args.push('%' + term + '%');
      where += ` and (lower(p.style_name) like $${args.length} or lower(p.brand) like $${args.length} or lower(p.style_id) like $${args.length})`;
    }
    args.push(limit, offset);
    // One row per STYLE, with its colourways and sizes rolled up. Aggregated in SQL rather
    // than fetched and grouped in Node — 825 styles across ~30k skus is not a thing to pull
    // into memory on this box.
    const r = await q(
      `select p.style_id, min(p.brand) as brand, min(p.style_name) as style_name,
              min(p.category) as category,
              max(p.image) filter (where p.image is not null and p.image <> '') as image,
              array_agg(distinct p.color) filter (where p.color is not null and p.color <> '') as colors,
              array_agg(distinct p.size)  filter (where p.size  is not null and p.size  <> '') as sizes,
              max(p.price)::float as max_price,
              (select cp.catalog_price from catalog_picks cp where cp.source='ss' and cp.ref = p.style_id) as catalog_price,
              exists (select 1 from catalog_picks cp where cp.source='ss' and cp.ref = p.style_id) as picked
         from ss_products p
         ${where}
        group by p.style_id
        order by min(p.style_name)
        limit $${args.length - 1} offset $${args.length}`, args
    ).catch(() => ({ rows: [] }));
    const total = await q(`select count(distinct style_id)::int as n from ss_products ${term ? '' : ''}`)
      .then((x) => x.rows[0]?.n ?? 0).catch(() => 0);
    return {
      total,
      styles: r.rows.map((x) => ({
        source: 'ss', ref: x.style_id, name: x.style_name, brand: x.brand,
        category: x.category, image: ssImgUrl(x.image), colors: x.colors || [], sizes: x.sizes || [],
        // Our COST, staff-only — this route is requireStaff and never reaches a seller.
        maxCost: x.max_price, catalogPrice: x.catalog_price == null ? null : Number(x.catalog_price),
        picked: !!x.picked,
      })),
    };
  });

  /** Publish or unpublish supplier styles. */
  app.post('/api/catalog/picks', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const refs = Array.isArray(b.refs) ? b.refs.map(String).filter(Boolean) : [];
    const source = String(b.source || 'ss');
    if (!refs.length) { reply.code(400); return { error: 'Nothing selected.' }; }
    if (b.include === false) {
      const r = await q('delete from catalog_picks where source=$1 and ref = any($2::text[])', [source, refs]);
      audit(req, 'catalog.pick', { entityType: 'catalog', entityId: 'picks', after: { source, removed: r.rowCount } });
      return { ok: true, removed: r.rowCount };
    }
    let added = 0;
    for (const ref of refs) {
      const r = await q(
        `insert into catalog_picks (source, ref) values ($1,$2) on conflict (source, ref) do nothing`,
        [source, ref]).catch(() => null);
      if (r && r.rowCount) added++;
    }
    audit(req, 'catalog.pick', { entityType: 'catalog', entityId: 'picks', after: { source, added } });
    return { ok: true, added, already: refs.length - added };
  });

  /** Price picked styles — explicitly, or a markup over what they cost us. */
  app.post('/api/catalog/picks/pricing', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const source = String(b.source || 'ss');
    /**
     * PRICING A STYLE PUBLISHES IT. There is no state worth having where a style carries a
     * catalogue price and is not in the catalogue — that combination only existed because
     * the pick row and the price landed in two separate calls, and it produced a dead end:
     * "publish first" on a field someone had just typed a price into.
     */
    if (b.ref && b.price !== undefined) {
      const price = b.price === null || b.price === '' ? null : Math.max(0, Number(b.price));
      await q(
        `insert into catalog_picks (source, ref, catalog_price) values ($1,$2,$3)
         on conflict (source, ref) do update set catalog_price = excluded.catalog_price`,
        [source, String(b.ref), price]);
      return { ok: true, ref: String(b.ref), catalogPrice: price, published: true };
    }
    const refs = Array.isArray(b.refs) ? b.refs.map(String).filter(Boolean) : [];
    const pct = Number(b.markupPct);
    if (!refs.length || !isFinite(pct) || pct < 0) { reply.code(400); return { error: 'Send {ref, price} or {refs, markupPct} with a non-negative percent.' }; }
    // Cost is the HIGHEST sku price in the style — one catalogue price stands for every
    // size, and deriving it from the cheapest would sell the largest sizes under cost.
    //
    // Inserts as well as updates, for the same reason as above: applying a markup to a
    // selection is the act of putting those styles in the catalogue. Requiring a separate
    // publish first made the obvious gesture do nothing.
    const r = await q(
      `insert into catalog_picks (source, ref, catalog_price)
       select $1, c.style_id, round((c.cost * (1 + $3::numeric / 100))::numeric, 2)
         from (select style_id, max(price) as cost from ss_products
                where style_id = any($2::text[]) and price is not null
                group by style_id) c
        where c.cost > 0
       on conflict (source, ref) do update set catalog_price = excluded.catalog_price`,
      [source, refs, pct]).catch(() => ({ rowCount: 0 }));
    audit(req, 'catalog.pick.markup', { entityType: 'catalog', entityId: 'picks', after: { markupPct: pct, priced: r.rowCount } });
    return { ok: true, priced: r.rowCount, skippedNoCost: refs.length - r.rowCount };
  });

  /**
   * WHAT IS IN THE CATALOGUE RIGHT NOW.
   *
   * Publishing is persistent — closing the lookbook does not unpublish anything — but
   * nothing on the page said so, so the only way to learn what was in it was to open the
   * preview and count. That is how someone adds two, closes the window, adds a third, and
   * is surprised to see three.
   *
   * `unpriced` matters as much as the count: a published style with no price prints a blank
   * where a number should be, and that is the kind of thing you notice after sending it.
   */
  app.get('/api/catalog/summary', { preHandler: requireStaff }, async () => {
    const prod = await q(
      `select count(*)::int as n, count(*) filter (where catalog_price is null)::int as unpriced
         from catalog_products where in_catalog = true`
    ).then((r) => r.rows[0] || { n: 0, unpriced: 0 }).catch(() => ({ n: 0, unpriced: 0 }));
    const picks = await q(
      `select count(*)::int as n, count(*) filter (where catalog_price is null)::int as unpriced
         from catalog_picks`
    ).then((r) => r.rows[0] || { n: 0, unpriced: 0 }).catch(() => ({ n: 0, unpriced: 0 }));
    return {
      products: prod.n, styles: picks.n, total: prod.n + picks.n,
      unpriced: (prod.unpriced || 0) + (picks.unpriced || 0),
    };
  });

  /** Empty the catalogue. Warehouse/admin only — it is one click that undoes an afternoon
   *  of curation, and it should not be reachable by whoever happens to be logged in. */
  app.delete('/api/catalog/summary', { preHandler: requireWarehouse }, async (req) => {
    const a = await q('update catalog_products set in_catalog=false where in_catalog=true').catch(() => ({ rowCount: 0 }));
    const b = await q('delete from catalog_picks').catch(() => ({ rowCount: 0 }));
    const cleared = (a.rowCount || 0) + (b.rowCount || 0);
    audit(req, 'catalog.cleared', { entityType: 'catalog', entityId: 'all', after: { cleared } });
    return { ok: true, cleared };
  });

  /**
   * EXPORT HISTORY — a catalogue you handed someone is a commercial document.
   *
   * Send a buyer a lookbook in July and they order from it in September: prices have moved,
   * styles may have gone, and without a record there is no answering "what was on page 3".
   * That gap surfaces during a dispute, which is the worst moment to find it.
   *
   * We SNAPSHOT the content, not the file. The PDF is made by the browser so there is no
   * file here to keep, and storing one would mean asking the user to upload their own
   * download back. A snapshot is a few KB, survives, and regenerates both the PDF and the
   * CSV from one row.
   *
   * The honest limit: it reproduces the same CONTENT at the same PRICES, not the same
   * bytes. Images are referenced, so a supplier withdrawing a photo changes how an old
   * catalogue looks — the words and the numbers are what a dispute turns on.
   */
  q(`create table if not exists catalog_exports (
       id bigserial primary key,
       created_at timestamptz not null default now(),
       created_by text,
       kind text not null default 'lookbook',
       title text,
       style_count int not null default 0,
       snapshot jsonb not null
     )`).catch(() => {});

  app.get('/api/catalog/exports', { preHandler: requireStaff }, async () => {
    const r = await q(
      `select e.id, e.created_at, e.kind, e.title, e.style_count,
              (select u.name from users u where u.id::text = e.created_by) as by_name
         from catalog_exports e order by e.created_at desc limit 100`
    ).catch(() => ({ rows: [] }));
    return {
      exports: r.rows.map((x) => ({
        id: String(x.id), createdAt: x.created_at, kind: x.kind,
        title: x.title, styleCount: x.style_count, by: x.by_name || null,
      })),
    };
  });

  /** Save what was in the catalogue at this moment. */
  app.post('/api/catalog/exports', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const styles = Array.isArray(b.styles) ? b.styles : [];
    if (!styles.length) { reply.code(400); return { error: 'Nothing to save — the catalogue is empty.' }; }
    const title = String(b.title || '').trim() || `Catalogue · ${new Date().toISOString().slice(0, 10)}`;
    const r = await q(
      `insert into catalog_exports (created_by, kind, title, style_count, snapshot)
       values ($1,$2,$3,$4,$5) returning id, created_at`,
      [String((req.user && req.user.sub) || ''), String(b.kind || 'lookbook'), title, styles.length,
       JSON.stringify({ styles })]
    );
    audit(req, 'catalog.exported', { entityType: 'catalog', entityId: String(r.rows[0].id), after: { title, styles: styles.length } });
    return { ok: true, id: String(r.rows[0].id), title, createdAt: r.rows[0].created_at };
  });

  /** Reopen one — the catalogue exactly as it was sent. */
  app.get('/api/catalog/exports/:id', { preHandler: requireStaff }, async (req, reply) => {
    const r = await q('select id, created_at, title, kind, style_count, snapshot from catalog_exports where id=$1::bigint',
      [String(req.params.id)]).catch(() => ({ rows: [] }));
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'No such export.' }; }
    return {
      id: String(row.id), createdAt: row.created_at, title: row.title, kind: row.kind,
      styleCount: row.style_count,
      // The snapshot IS the answer — deliberately not re-read from the live catalogue,
      // which is the entire point of having kept it.
      styles: (row.snapshot && row.snapshot.styles) || [],
    };
  });

  /**
   * Everything the printed lookbook needs, in one call.
   *
   * A spread per style: the hero shot, the description, the size run, and every colourway
   * with its own photo, name and sku. The export CSV answers "what can I import"; this
   * answers "what does it look like", and they need different shapes — a flat variant list
   * cannot be laid out as a page.
   *
   * Colourways come from ss_products, grouped per style, so a picked style carries the
   * supplier's own photo of each colour rather than one image repeated ten times.
   */
  app.get('/api/catalog/lookbook', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }

    const mineRows = (await q(
      `select data, catalog_price from catalog_products where in_catalog = true order by created_at desc`
    ).catch(() => ({ rows: [] }))).rows;

    /**
     * PREFER THE SUPPLIER'S PHOTOGRAPHY over whatever was uploaded on our product.
     *
     * A product's own image is whatever someone attached while setting it up — a phone
     * photo, a mockup, in one case a screenshot. S&S ship real studio shots per colourway,
     * already synced, and this document goes to a buyer who is deciding by looking.
     *
     * The link is by SKU CONVENTION: our ids are prefixed by supplier, so SS-16468 is
     * their style 16468. Matched on the stripped id only — an exact key, never a fuzzy
     * name match, because putting the wrong garment's photo in a catalogue is worse than
     * printing our own mediocre one. No match falls back to ours.
     */
    const styleIdOf = (sku) => {
      const v = String(sku || '').trim();
      const m = v.match(/^(?:SS|OTTO)-(.+)$/i);
      return (m ? m[1] : v).trim();
    };
    const wanted = mineRows.map((r) => styleIdOf((r.data || {}).sku)).filter(Boolean);
    const supplierArt = new Map();
    if (wanted.length) {
      const ar = await q(
        `select style_id,
                max(image) filter (where image is not null and image <> '') as image
           from ss_products where style_id = any($1::text[]) group by style_id`, [wanted]
      ).catch(() => ({ rows: [] }));
      for (const row of ar.rows) supplierArt.set(row.style_id, ssImgUrl(row.image));

      const cr = await q(
        `select distinct on (style_id, color) style_id, color, sku, image
           from ss_products
          where style_id = any($1::text[]) and color is not null and color <> ''
          order by style_id, color, (image is null), sku`, [wanted]
      ).catch(() => ({ rows: [] }));
      for (const row of cr.rows) {
        const key = 'c:' + row.style_id;
        if (!supplierArt.has(key)) supplierArt.set(key, []);
        supplierArt.get(key).push({ name: row.color, sku: row.sku, image: ssImgUrl(row.image) });
      }
    }

    const mine = mineRows.map((row) => {
      const d = sellerSafe(row.data) || {};
      const ci = (d.colorImages && typeof d.colorImages === 'object') ? d.colorImages : {};
      const sid = styleIdOf(d.sku);
      const supplierColours = supplierArt.get('c:' + sid);
      return {
        ref: String(d.id ?? d.sku ?? ''), name: d.name || '', sku: d.sku || '',
        description: d.description || '', brand: d.brand || '',
        image: supplierArt.get(sid) || d.image || d.img || '',
        price: row.catalog_price == null ? null : Number(row.catalog_price),
        sizes: Array.isArray(d.sizes) ? d.sizes
          : (Array.isArray(d.sizePrices) ? d.sizePrices.map((t) => t && t.size).filter(Boolean) : []),
        // Supplier colourways when we can match the style — they carry a real photo AND an
        // orderable sku per colour, which our colorImages map has no room for.
        colors: (supplierColours && supplierColours.length)
          ? supplierColours
          : Object.keys(ci).map((name) => ({ name, sku: '', image: ci[name] || '' })),
        // Our own products carry no supplier spec chart unless their sku resolves to a
        // style; filled below for the ones that do.
        specs: [],
      };
    });

    // Picked supplier styles — colourways rolled up from their sku rows. One row per
    // COLOUR, not per sku, so a style with 5 colours x 6 sizes gives 5 swatches and not 30.
    const picked = (await q(
      `select cp.ref, cp.catalog_price,
              min(p.style_name) as name, min(p.brand) as brand,
              max(p.image) filter (where p.image is not null and p.image <> '') as image,
              array_agg(distinct p.size) filter (where p.size is not null and p.size <> '') as sizes
         from catalog_picks cp
         join ss_products p on p.style_id = cp.ref
        where cp.source = 'ss'
        group by cp.ref, cp.catalog_price`
    ).catch(() => ({ rows: [] }))).rows;

    const styleRefs = picked.map((p) => p.ref);
    const coloursByStyle = new Map();
    if (styleRefs.length) {
      const cr = await q(
        `select distinct on (style_id, color) style_id, color, sku, image
           from ss_products
          where style_id = any($1::text[]) and color is not null and color <> ''
          order by style_id, color, (image is null), sku`, [styleRefs]
      ).catch(() => ({ rows: [] }));
      for (const row of cr.rows) {
        if (!coloursByStyle.has(row.style_id)) coloursByStyle.set(row.style_id, []);
        coloursByStyle.get(row.style_id).push({ name: row.color, sku: row.sku, image: ssImgUrl(row.image) });
      }
    }

    // Descriptions, from the per-style cache. Absent for styles nobody has opened — the
    // text lives on /styles/:id, not in the product feed, so it is stored the first time
    // someone views that style. Missing is left EMPTY rather than filled with the style
    // name dressed up as prose.
    const descs = await ssStyleDescriptions(styleRefs).catch(() => new Map());

    /**
     * Size charts, one style at a time and capped.
     *
     * Each is a single S&S call the first time and cached thereafter, so a settled
     * catalogue costs nothing. Capped at 24 so a 200-style catalogue cannot spend the rate
     * limit on a preview — beyond that the pages print without a chart rather than making
     * everyone wait.
     */
    const specsByStyle = new Map();
    for (const ref of styleRefs.slice(0, 24)) {
      const rows = await ssSpecs(ref).catch(() => []);
      if (rows.length) specsByStyle.set(ref, rows);
    }

    const supplier = picked.map((p) => ({
      ref: p.ref, name: p.name || p.ref, sku: p.ref,
      description: descs.get(p.ref) || '', brand: p.brand || 'S&S',
      image: ssImgUrl(p.image),
      price: p.catalog_price == null ? null : Number(p.catalog_price),
      sizes: p.sizes || [],
      colors: coloursByStyle.get(p.ref) || [],
      specs: specsByStyle.get(p.ref) || [],
    }));

    return { styles: [...mine, ...supplier] };
  });

  /**
   * Download the published catalogue.
   *
   * ONE ROW PER VARIANT, because that is what an importer needs: a buyer pasting this into
   * their own system wants a line per orderable thing, not a product with sizes buried in a
   * cell they have to split. Reading it is the secondary use; the row-per-product version
   * is a report, and this is a price list.
   *
   * Goes through sellerSafe for everyone, staff included. That is deliberate: this file
   * leaves the building. A staff member exporting "for themselves" and forwarding it is the
   * exact path by which our supplier cost reaches a customer, and the export has no way to
   * know where it ends up. The margin readouts stay in the app, where the audience is known.
   *
   * IMAGES ARE PROXIED. S&S CDN links are CORP-blocked, so a sheet full of raw supplier URLs
   * looks complete and half of it fails to open — the same failure that made catalogue
   * images silently blank before.
   */
  app.get('/api/catalog/export', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const qy = req.query || {};
    // Published only, unless staff explicitly ask for everything — an export that quietly
    // included unpublished drafts would put products in front of a buyer that nobody chose.
    const all = String(qy.all || '') === '1';
    const rows = (await q(
      `select data, catalog_price from catalog_products
        ${all ? '' : 'where in_catalog = true'}
        order by created_at desc`
    ).catch(() => ({ rows: [] }))).rows;

    const base = String(process.env.APP_URL || 'https://app.egful.store').replace(/\/$/, '');
    // Route supplier images through our proxy so they actually load for the recipient.
    const img = (u) => {
      const v = String(u || '').trim();
      if (!v) return '';
      if (/^https?:\/\/(www\.)?(cdn\.)?ssactivewear\.com/i.test(v) || /ottocap\.com/i.test(v)) {
        // /api/ss/img — the shared supplier proxy, used by Otto's images too (ottocap.js
        // routes through the same one). Guessing /api/img would have produced a sheet of
        // dead links that looked perfectly well-formed.
        return `${base}/api/ss/img?u=${encodeURIComponent(v)}`;
      }
      return v;
    };

    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['sku', 'product', 'description', 'colour', 'size', 'price', 'currency', 'image', 'variant_image', 'supplier'];
    const out = [head.map(esc).join(',')];

    let variants = 0;
    for (const row of rows) {
      const d = sellerSafe(row.data) || {};
      // The catalogue price is the whole point of this file. A product included but never
      // priced is exported with an empty price rather than base_price — quietly
      // substituting the seller's billing price into a trade brochure is precisely the
      // mix-up catalog_price exists to prevent.
      const price = row.catalog_price == null ? '' : Number(row.catalog_price).toFixed(2);
      const tiers = Array.isArray(d.sizePrices) && d.sizePrices.length ? d.sizePrices : [null];
      const colours = Array.isArray(d.colors) && d.colors.length ? d.colors : [null];
      for (const c of colours) {
        for (const t of tiers) {
          const colour = c && (c.name || c.color || c) || '';
          const size = t && (t.size || '') || '';
          out.push([
            d.sku ?? d.id ?? '', d.name ?? '', d.description ?? '',
            typeof colour === 'string' ? colour : '', size,
            price, 'USD',
            img(d.image ?? d.img ?? ''),
            img((c && (c.image ?? c.img)) || ''),
            d.supplier ?? d.brand ?? '',
          ].map(esc).join(','));
          variants++;
        }
      }
    }

    /**
     * Picked SUPPLIER STYLES, joined live rather than copied.
     *
     * A pick stores only (source, ref, price); the name, image, colourways and sizes are
     * read from ss_products here, at export time. So a re-sync updates the catalogue for
     * free and nothing can go stale — which is the entire reason a pick is three columns
     * instead of a duplicated product row.
     */
    const picks = (await q(
      `select cp.ref, cp.catalog_price,
              min(p.style_name) as name, min(p.brand) as brand,
              max(p.image) filter (where p.image is not null and p.image <> '') as image,
              array_agg(distinct p.color) filter (where p.color is not null and p.color <> '') as colors,
              array_agg(distinct p.size)  filter (where p.size  is not null and p.size  <> '') as sizes
         from catalog_picks cp
         join ss_products p on p.style_id = cp.ref
        where cp.source = 'ss'
        group by cp.ref, cp.catalog_price`
    ).catch(() => ({ rows: [] }))).rows;

    for (const p of picks) {
      const price = p.catalog_price == null ? '' : Number(p.catalog_price).toFixed(2);
      const colours = (p.colors && p.colors.length) ? p.colors : [''];
      const sizes = (p.sizes && p.sizes.length) ? p.sizes : [''];
      for (const c of colours) {
        for (const z of sizes) {
          out.push([p.ref, p.name || '', '', c || '', z || '', price, 'USD', img(p.image || ''), '', p.brand || 'S&S']
            .map(esc).join(','));
          variants++;
        }
      }
    }

    audit(req, 'catalog.export', { entityType: 'catalog', entityId: 'export', after: { products: rows.length, picks: picks.length, variants, all } });
    const name = `catalog-${new Date().toISOString().slice(0, 10)}.csv`;
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return out.join('\n');
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
    /**
     * Where a product's cost actually lives — the SAME order pricing.js resolves it in.
     *
     * It can sit per SIZE (sizePrices[].cost) or on the product (productCost). This only
     * read the product-level field, so every product priced per size — which is most of
     * S&S, where a 3XL costs more than an S — reported "no cost on record" and was
     * skipped. The markup looked broken and was in fact looking in one of two places.
     *
     * With several size costs, the HIGHEST wins. One catalogue price has to stand for
     * every size, and deriving it from the cheapest would put the largest sizes on sale
     * below their own cost. Rounding a little margin onto the small sizes is the
     * survivable direction of that error.
     */
    const costOf = (d) => {
      const tiers = Array.isArray(d.sizePrices) ? d.sizePrices : [];
      const tierCosts = tiers.map((t) => Number(t && t.cost)).filter((n) => isFinite(n) && n > 0);
      if (tierCosts.length) return Math.max(...tierCosts);
      const flat = Number(d.productCost ?? d.product_cost);
      return isFinite(flat) && flat > 0 ? flat : null;
    };

    for (const row of rows) {
      const d = row.data || {};
      const cost = costOf(d);
      // A product with no recorded cost anywhere cannot be marked up, and guessing one
      // would put a made-up number in front of a buyer. Reported back, not skipped in
      // silence.
      if (cost == null) { noCost.push(row.id); continue; }
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
