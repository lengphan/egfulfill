// Catalog products API — the shared product catalog the factory publishes and
// sellers browse. GET is readable by any signed-in user; writes are staff-only.
// Products carry image data URLs, so we store the whole product object in a
// `data` jsonb column (lossless round-trip) plus a few typed columns for TablePlus.
import { createHash } from 'node:crypto';
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { quoteSpec } from '../pricing.js';
import { notify } from './notifications.js';
import { audit } from '../audit.js';
import { ssImgUrl, ssStyleDescriptions, ssSpecs, ssImgSize } from './ss.js';

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
  /**
   * TWO SKUS, AND ONLY ONE OF THEM EVER LEAVES THE BUILDING.
   *
   *   sku           OURS — "EG-1001". What inventory is keyed on, what an order line
   *                 resolves to, and what publish writes onto the seller's listing. The
   *                 seller reads it as their product's SKU, which is the point.
   *   supplier_sku  THEIRS — "103-713-031753A". Factory-only, stripped by sellerSafe.
   *
   * It used to be one field holding the SUPPLIER's style number, and publish sends the
   * blank's sku as sku_base — so Otto's own style number was being written onto sellers'
   * Etsy and Shopify listings (published_listings still records blank_sku=103-713-031753A
   * on four of them). Anyone who can read that number can find the supplier and buy the
   * same blank without us, which is §2.8 exactly.
   */
  q('alter table catalog_products add column if not exists supplier_sku text').catch(() => {});

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
    // supplierSku goes with the cost: both name who makes this and what they charge, and
    // both are stripped on the way OUT rather than at each call site, so a new consumer
    // can't reintroduce the leak.
    const { productCost, product_cost, supplierSku, supplier_sku, ...rest } = data;
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
   * PUBLISHING IS THE DECISION. in_catalog is the flag a human ticks, so it — and it alone —
   * decides visibility. This used to also require catalog_price, which meant a product could
   * be ticked "published" and still be invisible on the public site with nothing anywhere
   * saying why. That is not a stricter guardrail, it is a second hidden condition on an
   * explicit choice: every product in the catalogue was in exactly that state.
   *
   * catalog_price is now an OVERRIDE, not a gate. When it is set it wins; otherwise the
   * product's own price is used, which is the same number the seller-facing catalogue shows
   * — this page quotes what a seller would pay to order the item, so it is the right figure
   * rather than a fallback that leaks something internal.
   *
   * The ALLOW-LIST is untouched. Only in_catalog rows are read, and only these four fields
   * are ever emitted, so widening the price rule cannot widen what a row exposes.
   *
   * A product with no usable price at all is still dropped: an unpriced item on a pricing-led
   * page reads as "free" or as broken. The coalesce happens in JS rather than SQL because
   * data->>'price' is free text — an unparseable value would abort the whole query on a cast,
   * taking every other product down with it.
   */
  /**
   * The product's display image, resolved the way the app resolves it.
   *
   * MIRRORS imageOf() in web/components/app/products-catalog.tsx — keep the order in step.
   * Only http(s) and data URLs are returned: a bare filename or an internal storage key is
   * not something a public page can render, and emitting one would leak an internal detail
   * AND draw a broken image.
   */
  const publicImage = (d) => {
    const cands = [d.img, d.image, d.hero, Array.isArray(d.images) ? d.images[0] : null,
      d.colorImages && typeof d.colorImages === 'object' ? Object.values(d.colorImages)[0] : null];
    for (const c of cands) {
      if (renderable(c)) return c;
    }
    return null;
  };

  /**
   * Is there an image here we could actually serve?
   *
   * Three shapes reach this, and ALL THREE are real:
   *   https://… / data:image/…   a plain picture someone attached
   *   /api/ss/img?u=…            a SUPPLIER image. ss.js's ssImg() stores the proxy path,
   *                              not the origin URL, because S&S's CDN 403s a cross-origin
   *                              browser load. Its own comment says "returns a RELATIVE url".
   *
   * The third was rejected, and that is why the public catalogue had no photographs at all:
   * every supplier-published style — which is most of them — stores exactly that shape, so
   * `image` came out null for the product AND for all of its colourways. Live check on the
   * published catalogue: 1 product, 0 images, 4 colourways, 0 with an image.
   */
  /** Supplier names, so a `brand || 'SanMar'` style fallback can never be published. */
  const SUPPLIER_NAMES = new Set(['sanmar', 's&s', 'ss', 'ssactivewear', 's&s activewear', 'otto', 'ottocap', 'otto cap']);
  /** The same rule as a value filter: a supplier's name never survives into a file or page. */
  const notSupplier = (v) => {
    const t = String(v ?? '').trim();
    return SUPPLIER_NAMES.has(t.toLowerCase()) ? '' : t;
  };
  /**
   * A SUPPLIER'S NAME INSIDE A PRODUCT TITLE — the same breach as a field headed "Supplier".
   *
   * notSupplier() only catches a value that IS a supplier name, which is exactly right for
   * `brand` and useless for a title. "OTTO CAP® Digital Camouflage 6 Panel Low Profile
   * Baseball Cap" is a real row here: the name published verbatim, and slugify() then printed
   * it a SECOND time in the URL — and CLAUDE.md §2.9 covers URLs explicitly, not just fields.
   *
   * The token is stripped rather than the product dropped. The garment is perfectly sellable;
   * it is only its title that names who makes it, and refusing to publish would quietly hide
   * a product for a reason no one on the staff side could see.
   *
   * Bare "ss" is deliberately NOT stripped even though it is in SUPPLIER_NAMES: it is an
   * ordinary abbreviation in garment titles (short sleeve), and mangling honest names is a
   * poor trade for a hole that "s&s" and "ssactivewear" already close.
   */
  const NAME_SUPPLIER_RE = /\b(?:s\s*&\s*s(?:\s+activewear)?|ssactivewear|sanmar|otto\s*cap|otto)\b[®™\s]*/gi;
  const publicName = (v) => String(v ?? '').replace(NAME_SUPPLIER_RE, ' ').replace(/\s+/g, ' ').trim();
  /**
   * Supplier DOMAINS. CLAUDE.md §2.8 covers URLs and redirects, not just fields — an address
   * bar reading `cdn.ssactivewear.com` names them exactly as plainly as a column headed
   * "Supplier" does. Anything matching here is re-dispatched through /api/ss/img internally
   * rather than handed back in a Location header.
   */
  const SUPPLIER_HOST = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:ssactivewear|ottocap|sanmar)\.com(?:[/:?#]|$)/i;
  /** Plain text for a public page: tags stripped, whitespace collapsed, length capped.
   *  Returns null rather than an empty string so the client can test one thing. */
  const publicText = (v, max) => {
    const t = String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, max) : null;
  };

  const renderable = (v) =>
    typeof v === 'string' && (/^(https?:\/\/|data:image\/)/i.test(v)
      || v.startsWith('/api/ss/img')
      // Our own image address. fattenImages puts the bytes back on write, so this should
      // not reach storage — but a path that DID slip through still serves the picture, and
      // treating it as unrenderable would blank a product that is perfectly fine.
      || v.startsWith('/api/catalog/img/'));

  /** Rewrite a proxied S&S image to their LARGE variant. The size lives in the filename
   *  suffix, and the url we hold is url-encoded inside ?u=, so it is decoded, swapped and
   *  re-encoded rather than pattern-matched through the encoding. */
  const upsizeSupplierImg = (v) => {
    const m = /^\/api\/ss\/img\?u=(.+)$/.exec(String(v || ''));
    if (!m) return v;
    try { return '/api/ss/img?u=' + encodeURIComponent(ssImgSize(decodeURIComponent(m[1]), 'fl')); }
    catch { return v; }
  };

  /**
   * A URL-safe handle for one product.
   *
   * Derived from the NAME rather than exposing the row id, because the id is an internal
   * key and this is the open internet. Two products with the same name would collide, so
   * the caller disambiguates with an index suffix — see publicProducts below. A product
   * whose name yields nothing usable (punctuation only) gets no slug and is dropped from
   * the public list rather than published at an unroutable address.
   */
  const slugify = (name) => String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

  /**
   * THE PUBLIC SHAPE, in one place, used by both the list and the detail route.
   *
   * Still an allow-list built from named fields — never a redaction of the row — so a field
   * added to catalog_products upstream cannot start publishing itself. What is deliberately
   * ABSENT is as load-bearing as what is present:
   *
   *   blank / sku      maps to supplier stock. Publishing it tells the world who makes our
   *                    products and lets anyone price against our supplier.
   *   cost / margin    our buying price. `price` here is what a SELLER pays us, which is the
   *                    number this page is quoting, and is already public-facing.
   *   supplier, ids    internal routing detail with no meaning to a visitor.
   *
   * Colourways and sizes ARE safe: they describe the finished product a buyer chooses from,
   * which is exactly what a detail page is for. Colour images are filtered to renderable
   * URLs so a storage key can never ride out inside the colour map.
   */
  const publicShape = (row, slug) => {
    const d = row.data;
    const price = row.catalog_price == null ? Number(d.price) : Number(row.catalog_price);
    const colorImages = d.colorImages && typeof d.colorImages === 'object' ? d.colorImages : {};
    const colors = Object.keys(colorImages)
      .filter((name) => typeof name === 'string' && name.trim())
      // OUR url, not the supplier's — see publicImageUrl below.
      .map((name) => ({
        name,
        image: renderable(colorImages[name])
          ? `/api/public/products/${slug}/img?c=${encodeURIComponent(name)}`
          : null,
      }));
    // `method` is a single value on the product today; emitted as a list so the page can
    // render a technique picker without the shape changing when a product carries several.
    const methods = Array.isArray(d.methods)
      ? d.methods.filter((m) => typeof m === 'string' && m.trim())
      : (typeof d.method === 'string' && d.method.trim() ? [d.method] : []);
    return {
      slug,
      // Stripped, not raw — see publicName. The slug is built from the same stripped value,
      // so the title and the URL can never disagree about what this product is called.
      name: publicName(d.name),
      image: publicImage(d) ? `/api/public/products/${slug}/img` : null,
      category: typeof d.category === 'string' ? d.category : null,
      // Real prose from the supplier feed, already synced and never published. Capped and
      // tag-stripped: S&S descriptions arrive as messy HTML, and a public page should not
      // be rendering markup we did not author.
      description: publicText(d.description, 900),
      // BRAND, but only when it is genuinely the garment's brand.
      //
      // The SanMar import does `brand || 'SanMar'`, so publishing this blind prints OUR
      // SUPPLIER on a public page in exactly the case where the real brand is missing —
      // see CLAUDE.md 2.8. The supplier names are filtered out rather than trusted, so a
      // future import that adopts the same fallback cannot quietly start leaking.
      brand: SUPPLIER_NAMES.has(String(d.brand || '').trim().toLowerCase())
        ? null : publicText(d.brand, 60),
      price,
      methods,
      colors,
      sizes: Array.isArray(d.sizes) ? d.sizes.filter((s) => typeof s === 'string' && s.trim()) : [],
    };
  };

  /**
   * Every published product in public shape, slugs already disambiguated.
   *
   * Read once and shared by both routes so the list and the detail page can never disagree
   * about what a slug points at — the detail route resolving slugs by its own rule is how
   * a link from the grid ends up 404ing on a name that merely looks similar.
   */
  const publicProducts = async () => {
    const r = await q(
      `select data, catalog_price from catalog_products
        where in_catalog = true
        order by created_at desc limit 60`
    ).catch(() => ({ rows: [] }));
    const seen = new Map();
    return r.rows
      .filter((row) => row.data && row.data.name)
      .map((row) => {
        const base = slugify(publicName(row.data.name));
        if (!base) return null;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return publicShape(row, n === 1 ? base : `${base}-${n}`);
      })
      .filter(Boolean)
      .filter((p) => Number.isFinite(p.price) && p.price > 0);
  };


  /**
   * The stored row behind a public slug, un-shaped. Both the detail route (for the style id
   * a size chart is keyed by) and the image route (for the real image address) need what
   * the public shape deliberately drops, and re-deriving the slug in two places is how the
   * two would eventually disagree about which product a slug points at.
   */
  const rawRowFor = async (slug) => {
    const r = await q(
      `select data from catalog_products where in_catalog = true order by created_at desc limit 60`
    ).catch(() => ({ rows: [] }));
    const seen = new Map();
    for (const row of r.rows) {
      if (!row.data || !row.data.name) continue;
      const base = slugify(publicName(row.data.name));
      if (!base) continue;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      if ((n === 1 ? base : `${base}-${n}`) === slug) return row.data;
    }
    return null;
  };

  app.get('/api/public/products', async () => {
    const products = await publicProducts();
    return { products: products.sort((a, b) => a.price - b.price).slice(0, 24) };
  });

  /**
   * One published product, for the marketing detail page.
   *
   * Resolved from the SAME list the grid is built from, so a slug shown on a card always
   * resolves here — a detail route with its own slug rule is how a link from the grid 404s
   * on a name that merely looks similar.
   *
   * 404 for an unpublished or unknown product, deliberately without saying which. "Exists
   * but is not published" is a fact about our catalogue that an unauthenticated caller has
   * no business learning, and it would turn this route into a probe for unreleased products.
   */
  app.get('/api/public/products/:slug', async (req, reply) => {
    const slug = String((req.params && req.params.slug) || '').toLowerCase();
    const product = (await publicProducts()).find((p) => p.slug === slug);
    if (!product) { reply.code(404); return { error: 'Not found' }; }
    /**
     * THE SIZE CHART, straight from the supplier — on the DETAIL route only.
     *
     * ssSpecs() calls S&S's /specs?styleid=N and caches the answer in ss_style_specs, so a
     * settled catalogue costs nothing after the first read. The lookbook has printed these
     * for a while; the public page simply never asked for them.
     *
     * Deliberately NOT in publicProducts(), which the LIST also uses — putting it there
     * would mean one supplier call per product on a page that shows none of it.
     *
     * Best-effort: a garment we have no chart for (or a supplier hiccup) publishes without
     * one rather than failing the page. Generic {size, spec, value} rows, not named columns
     * — the measurements differ per garment ("Chest Width", "Bill/ Brim Length"), which is
     * why this is pivoted at render instead of read off fixed fields.
     *
     * The style id comes from the RAW row, not from `product` — the public shape withholds
     * sku precisely because it maps to supplier stock, so it is read here and used only to
     * look the chart up. It never goes out in the response.
     */
    const styleId = String((await rawRowFor(slug))?.sku || '').replace(/^(?:SS|OTTO)-/i, '').trim();
    const specs = styleId ? await ssSpecs(styleId).catch(() => []) : [];
    return {
      product: {
        ...product,
        specs: (specs || [])
          .filter((s) => s && s.sizeName && s.specName)
          .map((s) => ({ size: String(s.sizeName), spec: String(s.specName), value: String(s.value ?? '') })),
      },
    };
  });

  /**
   * The picture for one published product, or one of its colourways.
   *
   * WHY THIS EXISTS RATHER THAN PUBLISHING THE IMAGE URL.
   *
   * Supplier images are stored as `/api/ss/img?u=https://cdn.ssactivewear.com/…`. Putting
   * that in the public JSON would work — the proxy is already unauthenticated — but the
   * query string NAMES OUR SUPPLIER, on the open internet, which is the one thing the
   * public shape is built to withhold ("publishing it tells the world who makes our
   * products and lets anyone price against our supplier"). Whitelisting the proxy path
   * would have fixed the missing photos by leaking exactly what the allow-list protects.
   *
   * So the public URL is OURS and says nothing: /api/public/products/<slug>/img. For a
   * proxied supplier image the bytes are re-dispatched INTERNALLY through /api/ss/img —
   * a 302 would defeat the point, since the Location header would carry the supplier URL.
   * Reusing that route rather than re-implementing the fetch keeps the caching, the host
   * allow-list and the content-type handling in one place.
   *
   * WHERE THIS STOPS, stated because it would otherwise read as a stronger promise than it
   * is: a plain https value IS still 302'd to wherever it points, so a product whose image
   * was stored as a bare supplier CDN address (cdnm.sanmar.com, say) still reveals that
   * host in the redirect. Streaming those instead would mean fetching an arbitrary
   * attacker-influenceable URL from our own network, which is the request-forgery hole the
   * /api/ss/img allow-list exists to prevent — so the fix is to widen THAT allow-list and
   * route the host through it, not to make this endpoint fetch anything it is handed.
   */
  app.get('/api/public/products/:slug/img', async (req, reply) => {
    const slug = String((req.params && req.params.slug) || '').toLowerCase();
    const want = req.query && req.query.c ? String(req.query.c) : null;

    // Re-read the ROW, not the public shape — the shape has already replaced the address
    // with the opaque url we are currently answering.
    const d = await rawRowFor(slug);
    const ci = d && d.colorImages && typeof d.colorImages === 'object' ? d.colorImages : {};
    const raw = !d ? null : (want ? ci[want] : publicImage(d));
    if (!renderable(raw)) { reply.code(404); return { error: 'Not found' }; }

    // A plain picture — hand back the address, there is nothing to hide in it.
    if (/^https?:\/\//i.test(raw)) { reply.redirect(raw); return; }
    if (/^data:image\//i.test(raw)) {
      const m = /^data:([^;]+);base64,(.*)$/i.exec(raw);
      if (!m) { reply.code(404); return { error: 'Not found' }; }
      reply.header('Content-Type', m[1]);
      reply.header('Cache-Control', 'public, max-age=604800, immutable');
      return Buffer.from(m[2], 'base64');
    }
    // ASK FOR THE LARGE ONE. S&S serve three sizes behind a filename suffix — _fs small,
    // _fm medium, _fl large — and the sync stores whatever their feed returned, which is
    // _fm. A medium file drawn at 600px on a product page is exactly the softness that
    // reads as "low quality images". ssImgSize() has existed for this the whole time and
    // was called from nowhere. Nothing needs re-syncing: it is a suffix swap at request
    // time, and a style with no suffix is returned untouched.
    const res = await app.inject({ method: 'GET', url: upsizeSupplierImg(raw) });
    reply.code(res.statusCode);
    const ct = res.headers['content-type'];
    if (ct) reply.header('Content-Type', ct);
    reply.header('Cache-Control', 'public, max-age=604800, immutable');
    return res.rawPayload;
  });

  /**
   * OPAQUE ADDRESSES FOR IMAGES THAT LEAVE THE BUILDING.
   *
   * A partner sheet is a file we hand to an outside company, and its image column was
   * `…/api/ss/img?u=https%3A%2F%2Fcdn.ssactivewear.com%2F…` — our supplier's domain, in
   * plain text, on every row. CLAUDE.md §2.8 covers URLs, so that is the same breach as a
   * column headed "Supplier"; it was just less obvious because the field was called `image`.
   *
   * A hash rather than an encoding, DELIBERATELY. base64 of the real address hides the
   * domain from a reader and not at all from anyone who tries, and this file's whole risk is
   * that a recipient goes looking. sha256 is one-way, so the mapping only exists here.
   *
   * The row is written at export time and kept: the sheet outlives the session, and a buyer
   * opening last quarter's workbook should still see the garments. Same reasoning as
   * catalog_exports keeping a snapshot.
   */
  q(`create table if not exists catalog_img_refs (
       hash text primary key,
       url text not null,
       created_at timestamptz not null default now()
     )`).catch(() => {});

  const imgHash = (u) => createHash('sha256').update(String(u)).digest('hex').slice(0, 24);

  /**
   * Serve one. NO AUTH — the recipient of a catalogue is not a user of ours, and a sheet
   * whose pictures only load for staff is a sheet with no pictures.
   *
   * A hash is not a secret, but it is not enumerable either: to ask for one you have to have
   * been given it, which is exactly the property a link in a document needs.
   */
  app.get('/api/catalog/img/:hash', async (req, reply) => {
    const hash = String((req.params && req.params.hash) || '').toLowerCase();
    if (!/^[0-9a-f]{24}$/.test(hash)) { reply.code(404); return { error: 'Not found' }; }
    const r = await q('select url from catalog_img_refs where hash = $1', [hash])
      .catch(() => ({ rows: [] }));
    const raw = r.rows[0] && r.rows[0].url;
    if (!raw) { reply.code(404); return { error: 'Not found' }; }

    if (/^data:image\//i.test(raw)) {
      const m = /^data:([^;]+);base64,(.*)$/i.exec(raw);
      if (!m) { reply.code(404); return { error: 'Not found' }; }
      reply.header('Content-Type', m[1]);
      reply.header('Cache-Control', 'public, max-age=604800, immutable');
      return Buffer.from(m[2], 'base64');
    }

    // A supplier address is re-dispatched INTERNALLY. Redirecting would put their host in the
    // Location header, which defeats the entire point of the opaque path — the known hole
    // noted on /api/public/products/:slug/img, closed here because this one is handed out in
    // a document rather than rendered by our own page.
    const proxied = raw.startsWith('/api/ss/img') ? upsizeSupplierImg(raw)
      : SUPPLIER_HOST.test(raw) ? '/api/ss/img?u=' + encodeURIComponent(raw)
        : null;
    if (proxied) {
      const res = await app.inject({ method: 'GET', url: proxied });
      reply.code(res.statusCode);
      const ct = res.headers['content-type'];
      if (ct) reply.header('Content-Type', ct);
      reply.header('Cache-Control', 'public, max-age=604800, immutable');
      return res.rawPayload;
    }
    if (/^https?:\/\//i.test(raw)) { reply.redirect(raw); return; }
    reply.code(404);
    return { error: 'Not found' };
  });

  /**
   * ARTWORK BY ADDRESS, NOT BY VALUE.
   *
   * Product images are stored as base64 `data:` URLs INSIDE the row, so the list response
   * carried the pictures themselves: 5 products weighed 4.4 MB, one of them 1.4 MB on its
   * own, and every visit to the products page downloaded all of it again. That is the whole
   * of the slowness — it is not the number of rows, it is what one row contains.
   *
   * So a data: URL is swapped for `/api/catalog/img/<hash>` on the way out. That route
   * already existed for partner sheets and already decodes base64 and serves the bytes with
   * `immutable, max-age=604800` — so the browser fetches each picture ONCE and never asks
   * again, instead of re-reading it inside a JSON body it cannot cache.
   *
   * The stored row is untouched: this is a projection, so nothing is migrated, nothing can
   * be lost, and a product still round-trips through the editor unchanged.
   *
   * Only `data:` URLs move. A value that is already a path (`/api/ss/img?u=…`) is left
   * exactly as it is — rewriting those would change supplier-image behaviour, which is
   * governed by §2.9 and not what this is for.
   */
  const imgRefs = new Map();   // hash → url, so a repeat request re-hashes but never re-writes
  async function byAddress(v) {
    if (typeof v !== 'string' || !/^data:image\//i.test(v)) return v;
    const hash = imgHash(v);
    if (!imgRefs.has(hash)) {
      // Idempotent by hash — identical bytes resolve to the same row, so the table cannot
      // grow one entry per request.
      // Only remember it if the row is actually there. Marking a failed insert as done
      // meant that image 404'd for the life of the process, with nothing to retry it.
      const ok = await q('insert into catalog_img_refs (hash, url) values ($1,$2) on conflict (hash) do nothing', [hash, v])
        .then(() => true).catch(() => false);
      if (ok) imgRefs.set(hash, true);
      else return v;   // keep the data: URL this time rather than point at a row that isn't there
    }
    return `/api/catalog/img/${hash}`;
  }
  async function slimImages(p) {
    const out = { ...p };
    if (out.img) out.img = await byAddress(out.img);
    if (Array.isArray(out.images)) out.images = await Promise.all(out.images.map(byAddress));
    if (out.colorImages && typeof out.colorImages === 'object') {
      const e = await Promise.all(Object.entries(out.colorImages).map(async ([k, v]) => [k, await byAddress(v)]));
      out.colorImages = Object.fromEntries(e);
    }
    return out;
  }

  app.get('/api/catalog_products', { preHandler: requireAuth }, async (req) => {
    const r = await q('select data, in_catalog, catalog_price from catalog_products order by created_at desc');
    const rows = r.rows
      .filter((row) => row.data)
      // The catalogue fields ride on the product rather than in a parallel list, so a
      // consumer can't hold a product and miss whether it's published.
      .map((row) => ({ ...row.data, inCatalog: !!row.in_catalog, catalogPrice: row.catalog_price == null ? null : Number(row.catalog_price) }));
    const light = await Promise.all(rows.map(slimImages));
    return isStaff(req.user) ? light : light.map(sellerSafe);
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
  /**
   * The PUBLIC price rule, written as SQL — the same one publicShape applies: catalog_price
   * when it is set, otherwise the price carried on the row's own data.
   *
   * It lives beside the summary because a count computed by a DIFFERENT rule from the route
   * it claims to describe is worse than no count at all. `catalog_price is null` was that
   * count: it reported the one published product as "no price — prints blank" while the
   * public page was quoting $41.20 from data->>'price' perfectly well.
   *
   * The regex guard is not decoration. data->>'price' is free-form json, so a non-numeric
   * value makes the cast throw — and this query is the whole summary.
   */
  const PUBLIC_PRICE_SQL = `coalesce(catalog_price,
    case when data->>'price' ~ '^[0-9]+(\\.[0-9]+)?$' then (data->>'price')::numeric end)`;

  app.get('/api/catalog/summary', { preHandler: requireStaff }, async () => {
    const prod = await q(
      `select count(*)::int as n,
              count(*) filter (where ${PUBLIC_PRICE_SQL} is null or ${PUBLIC_PRICE_SQL} <= 0)::int as unpriced
         from catalog_products where in_catalog = true`
    ).then((r) => r.rows[0] || { n: 0, unpriced: 0 }).catch(() => ({ n: 0, unpriced: 0 }));
    const picks = await q(
      `select count(*)::int as n, count(*) filter (where catalog_price is null)::int as unpriced
         from catalog_picks`
    ).then((r) => r.rows[0] || { n: 0, unpriced: 0 }).catch(() => ({ n: 0, unpriced: 0 }));
    return {
      products: prod.n, styles: picks.n, total: prod.n + picks.n,
      unpriced: (prod.unpriced || 0) + (picks.unpriced || 0),
      /**
       * WHAT THE MARKETING SITE CAN ACTUALLY SHOW — which is not `total`, and saying so is
       * the entire point of this field.
       *
       * `total` counts the LOOKBOOK: products plus supplier styles, which is the right number
       * for a trade document you hand a buyer. The public catalogue is a different surface —
       * publicProducts() reads catalog_products alone and never touches catalog_picks — so a
       * bar reading "4 in the catalogue" beside a site showing 1 was not a bug in either one.
       * It was two true numbers for two different things, printed as if they were one.
       *
       * Both reasons a published product stays invisible are named, because "it is not there"
       * and "it is there but has no price" need different fixes from whoever is looking.
       */
      publicVisible: Math.max(0, (prod.n || 0) - (prod.unpriced || 0)),
      publicHidden: { unpriced: prod.unpriced || 0, styles: picks.n || 0 },
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
        description: d.description || '', brand: notSupplier(d.brand),
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
      // The lookbook PRINTS this next to the style name (catalog-print.tsx), so `|| 'S&S'`
      // put our supplier's name on every page of a catalogue handed to a buyer.
      description: descs.get(p.ref) || '', brand: notSupplier(p.brand),
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
  /**
   * ONE definition of "a row of the catalogue", flattened to one line per variant.
   *
   * The CSV download and the partner-sheet builder both need exactly this, and a second
   * copy is how the two files would come to disagree about a price. Everything downstream
   * — including a partner template whose column names we have never seen — maps against
   * these field names, so this list IS the vocabulary the mapping UI offers.
   */
  const buildExportRows = async ({ all = false } = {}) => {
    const rows = (await q(
      `select data, catalog_price from catalog_products
        ${all ? '' : 'where in_catalog = true'}
        order by created_at desc`
    ).catch(() => ({ rows: [] }))).rows;

    const base = String(process.env.APP_URL || 'https://app.egful.store').replace(/\/$/, '');

    /**
     * EVERY image becomes one of ours, not only the supplier's.
     *
     * Filtering by host was the previous shape and it is the wrong test twice over: a
     * supplier domain we have not listed yet passes straight through, and a `data:` image
     * goes into the cell as tens of thousands of base64 characters — past Excel's 32,767
     * limit, so the row silently truncates. One opaque address for all of them answers both.
     */
    const imgRefs = new Map();
    const img = (u) => {
      const v = String(u || '').trim();
      if (!v) return '';
      const h = imgHash(v);
      imgRefs.set(h, v);
      return `${base}/api/catalog/img/${h}`;
    };

    const out = [];
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
          out.push({
            sku: d.sku ?? d.id ?? '',
            product: d.name ?? '',
            description: d.description ?? '',
            colour: typeof colour === 'string' ? colour : '',
            size,
            price, currency: 'USD',
            image: img(d.image ?? d.img ?? ''),
            variant_image: img((c && (c.image ?? c.img)) || ''),
            // MODEL and BRAND as a partner means them: the style number a manufacturer
            // prints on the label ("64000") and who makes it — not our SKU, which is ours
            // and means nothing to them.
            //
            // NO `?? d.supplier` FALLBACK. It read as harmless — "use the supplier if we
            // don't know the brand" — and it is precisely the §2.8 case: it prints who
            // supplies us exactly when the garment's real brand is missing. Unknown brand
            // exports blank, and the mapping UI lists the column as unfilled.
            brand: notSupplier(d.brand),
            model: d.blank ?? d.styleId ?? d.style ?? d.sku ?? '',
          });
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
          out.push({
            sku: p.ref, product: p.name || '', description: '',
            colour: c || '', size: z || '', price, currency: 'USD',
            image: img(p.image || ''), variant_image: '',
            // `|| 'S&S'` was hardcoded here — a picked style with no brand on the feed
            // exported our supplier's name into a partner's own workbook.
            brand: notSupplier(p.brand),
            // A pick IS a style, so its ref is the model number — no guessing needed.
            model: p.ref,
          });
        }
      }
    }

    /**
     * Record the addresses the rows now point at.
     *
     * One statement for the whole export, and idempotent — the same picture keeps the same
     * hash, so re-exporting a settled catalogue writes nothing new and every sheet ever sent
     * keeps working. Best-effort: a failure here costs the pictures in one file, and must
     * not cost the file.
     */
    if (imgRefs.size) {
      const hashes = [...imgRefs.keys()];
      await q(
        `insert into catalog_img_refs (hash, url)
         select * from unnest($1::text[], $2::text[])
         on conflict (hash) do nothing`,
        [hashes, hashes.map((h) => imgRefs.get(h))]
      ).catch(() => {});
    }

    return { rows: out, products: rows.length, picks: picks.length };
  };

  /**
   * The field names buildExportRows emits, in the order a mapping UI should offer them.
   *
   * `supplier` USED TO BE HERE and is gone on purpose — see CLAUDE.md §2.8. It was offered
   * as a mappable column in a file that goes to an outside company, which made handing a
   * partner the name of the firm they could buy the same blank from a one-click mistake.
   * There is no redacted version of it worth keeping: who supplies us is not a catalogue
   * field.
   */
  const EXPORT_FIELDS = [
    'sku', 'model', 'brand', 'product', 'description', 'colour', 'size',
    'price', 'currency', 'image', 'variant_image',
  ];

  app.get('/api/catalog/export', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const qy = req.query || {};
    // Published only, unless staff explicitly ask for everything — an export that quietly
    // included unpublished drafts would put products in front of a buyer that nobody chose.
    const all = String(qy.all || '') === '1';
    const { rows, products, picks } = await buildExportRows({ all });

    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['sku', 'product', 'description', 'colour', 'size', 'price', 'currency', 'image', 'variant_image'];
    const out = [head.map(esc).join(',')];
    for (const r of rows) out.push(head.map((k) => esc(r[k])).join(','));

    audit(req, 'catalog.export', { entityType: 'catalog', entityId: 'export', after: { products, picks, variants: rows.length, all } });
    const name = `catalog-${new Date().toISOString().slice(0, 10)}.csv`;
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return out.join('\n');
  });

  /**
   * The same rows as JSON — what a partner sheet is filled FROM.
   *
   * Staff-only for the same reason the CSV is: these carry the catalogue price, which is a
   * trade price and not public. Returned as data rather than a file because the mapping
   * happens in the browser, against real values, before anything is written.
   */
  app.get('/api/catalog/rows', { preHandler: requireStaff }, async (req) => {
    const all = String((req.query || {}).all || '') === '1';
    const { rows, products, picks } = await buildExportRows({ all });
    return { rows, fields: EXPORT_FIELDS, products, picks };
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

  /**
   * A PROJECTION MUST NOT BECOME THE RECORD.
   *
   * The list route rewrites stored `data:` images to /api/catalog/img/<hash> so the response
   * stops carrying megabytes of base64. But the products UI holds whole product objects and
   * POSTs them straight back, so that rewrite was being SAVED — and once saved it is no
   * longer a projection: renderable() rejects the path, so every published colourway's image
   * went null, and the export sheet re-hashed a hash into a link that resolves to nothing.
   *
   * So a write puts the bytes back. The hash is a lookup into catalog_img_refs, which is
   * exactly where slimImages recorded them, and an unknown hash is left alone rather than
   * blanked — losing an image to a cache miss would be worse than storing a path.
   */
  async function fattenImages(p) {
    const back = async (v) => {
      const m = typeof v === 'string' && /^\/api\/catalog\/img\/([0-9a-f]{24})$/.exec(v);
      if (!m) return v;
      const r = await q('select url from catalog_img_refs where hash=$1', [m[1]]).catch(() => ({ rows: [] }));
      return (r.rows[0] && r.rows[0].url) || v;
    };
    const out = { ...p };
    if (out.img) out.img = await back(out.img);
    if (Array.isArray(out.images)) out.images = await Promise.all(out.images.map(back));
    if (out.colorImages && typeof out.colorImages === 'object') {
      const e = await Promise.all(Object.entries(out.colorImages).map(async ([k, v]) => [k, await back(v)]));
      out.colorImages = Object.fromEntries(e);
    }
    return out;
  }

  app.post('/api/catalog_products', { preHandler: requireStaff }, async (req, reply) => {
    const products = await Promise.all((Array.isArray(req.body) ? req.body : []).map(fattenImages));
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
        `insert into catalog_products (id, name, sku, supplier_sku, type, method, status, base_price, price, main_color, data, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         on conflict (id) do update set
           name=excluded.name, sku=excluded.sku, supplier_sku=excluded.supplier_sku,
           type=excluded.type, method=excluded.method,
           status=excluded.status, base_price=excluded.base_price, price=excluded.price,
           main_color=excluded.main_color, data=excluded.data, updated_at=now()`,
        [
          id, p.name || '', p.sku || null, p.supplierSku || p.supplier_sku || null,
          p.type || null, p.method || null,
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
