// Catalog products API — the shared product catalog the factory publishes and
// sellers browse. GET is readable by any signed-in user; writes are staff-only.
// Products carry image data URLs, so we store the whole product object in a
// `data` jsonb column (lossless round-trip) plus a few typed columns for TablePlus.
import { createHash } from 'node:crypto';
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { quoteSpec, shipFeeOf, extraFeeOf, feeSettings, sellerBaseCostOf, priceByMethodOf } from '../pricing.js';
import { notify } from './notifications.js';
import { audit } from '../audit.js';
import { variantSku, variantLabel, variantPairs, productSizes, productColors } from '../variant-sku.js';
import { ssImgUrl, ssStyleDescriptions, ssSpecs, ssImgSize } from './ss.js';
import { readAll as readSettings } from './factory_settings.js';

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
   * STATUS IS THE DECISION — see the visibility vocabulary below. Setting a product Active
   * puts it on the marketing site, and nothing else is consulted.
   *
   * It was in_catalog, and that was the wrong flag on the wrong screen: in_catalog belongs to
   * the LOOKBOOK, the trade document sent to partners and wholesale buyers. One flag served
   * both, so five Active products showed one on the website, and the fix was two pages away
   * from where the question was being asked.
   *
   * catalog_price is likewise the lookbook's price and is NOT read here. A trade rate quoted
   * to a partner is not the number a visitor should see; the public price is what a seller
   * pays us to make one, which is exactly what this page exists to quote.
   *
   * The ALLOW-LIST is untouched. Only Active rows are read, and only these four fields are
   * ever emitted, so changing the gate cannot widen what a row exposes.
   *
   * A product with no usable price at all is still dropped: an unpriced item on a pricing-led
   * page reads as "free" or as broken. The coalesce happens in JS rather than SQL because
   * data->>'price' is free text — an unparseable value would abort the whole query on a cast,
   * taking every other product down with it. The staff side now REPORTS that drop instead of
   * performing it in silence (publicHidden on /api/catalog/summary, and the badge on the
   * Products page), because an invisible product with no stated reason is the whole bug this
   * model replaced.
   */
  /**
   * The product's display image, resolved the way the app resolves it.
   *
   * MIRRORS imageOf() in web/components/app/products-catalog.tsx — keep the order in step.
   * Only http(s) and data URLs are returned: a bare filename or an internal storage key is
   * not something a public page can render, and emitting one would leak an internal detail
   * AND draw a broken image.
   */
  /** A stored number, or null when it is absent or outside what the editor can produce.
   *  Null means "unframed" to the client, which is a different thing from a clamped 0 —
   *  and `Number(null)` is `0`, so absence has to be caught BEFORE the cast or a stored
   *  null arrives at the browser as a real, far-end framing value. */
  const clampNum = (v, lo, hi) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
  };

  const publicImage = (d) => {
    /**
     * A PRINT OUTLINE IS NOT A PRODUCT PHOTO.
     *
     * `side_mockups` holds line drawings of a blank — positioning aids for the Design
     * Maker. One product's main image IS its outline, so the public catalogue was showing
     * a wireframe cap between two photographs, which reads as a broken image rather than
     * as a product. The app's own gallery has excluded them since it was written
     * (galleryOf in app/(app)/products/[id]); the public page never learned the rule.
     *
     * Excluded by VALUE, not by field: the same url can sit in `img` and in `side_mockups`,
     * and it is the second membership that says what it is.
     */
    const outlines = new Set(Object.values({ ...(d.side_mockups || {}), ...(d.sideMockups || {}) }).filter(Boolean));
    const cands = [d.img, d.image, d.hero, ...(Array.isArray(d.images) ? d.images : []),
      ...(d.colorImages && typeof d.colorImages === 'object' ? Object.values(d.colorImages) : [])];
    for (const c of cands) {
      if (renderable(c) && !outlines.has(c)) return c;
    }
    // Everything we hold for this product is an outline. Better the drawing than an empty
    // tile — but only after every real photograph has been ruled out.
    for (const c of cands) if (renderable(c)) return c;
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
   * WHO CAN SEE A PRODUCT — one vocabulary, three audiences, decided by `status` alone.
   *
   * Status IS the visibility switch. Setting a product Active puts it on the marketing site;
   * there is no second flag to remember and therefore no way for the two to disagree.
   *
   *   Active        marketing site + sellers + staff
   *   Sellers only  sellers + staff — orderable in the app, absent from the public site
   *   Staff only    factory-internal; a seller never sees it
   *   Draft         staff, unfinished
   *   Archived      staff, retired
   *
   * This REPLACED `in_catalog` as the public gate. in_catalog and catalog_price still exist
   * and still mean something — they are the LOOKBOOK: the trade document sent to partners and
   * wholesale customers, which is priced separately because those buyers are not our sellers.
   * Publishing to the web and assembling a trade brochure were one flag, and the result was
   * five Active products with one on the website and no screen able to explain the gap.
   *
   * Anything not listed is staff-only by omission — an unrecognised status must never fall
   * through to "public".
   */
  const PUBLIC_STATUS = 'active';
  const SELLER_STATUSES = new Set(['active', 'sellers only']);
  const sellerVisible = (status) => SELLER_STATUSES.has(String(status || '').trim().toLowerCase());
  /**
   * The public gate as SQL, and it MATCHES sellerVisible's normalisation on purpose.
   *
   * An exact `status = 'Active'` looked fine — the editor is a <select>, so the casing is
   * controlled. But an import or an API caller can write "active", and then the product was
   * visible to sellers and absent from the website with nothing saying why: precisely the
   * silent invisibility this whole model replaced, reintroduced by a comparison operator.
   */
  const PUBLIC_STATUS_SQL = `lower(trim(coalesce(status, ''))) = $1`;
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

  /**
   * EVERY SUPPLIER PROXY PREFIX WE MINT, not just S&S.
   *
   * This list is the third supplier's turn at the same bug. `/api/sanmar/img-proxy` is what
   * sanmar.js stores — SanMar's image columns are bare filenames, so the importer builds a
   * proxy path exactly the way ss.js does — and it was never added here, so every SanMar
   * style published to the marketing site came out with `image: null` and drew the "Photo
   * coming" plate. The picture was fine and the route serving it has existed the whole time;
   * only this predicate disagreed.
   *
   * Adding a supplier means adding its prefix HERE. That is the actual coupling, and it is
   * easy to miss because the importer works, the staff grid works, and only the public page
   * — which nobody re-checks after an import — goes blank.
   *
   * `/api/etsy/img-proxy` is deliberately absent. That one carries BUYER artwork from an
   * order, not a product photograph; it has no business being a catalogue image, and
   * whitelisting it would widen what the public shape can emit for no reason anyone wants.
   */
  const SUPPLIER_IMG_PREFIXES = ['/api/ss/img', '/api/sanmar/img-proxy'];
  const renderable = (v) =>
    typeof v === 'string' && (/^(https?:\/\/|data:image\/)/i.test(v)
      || SUPPLIER_IMG_PREFIXES.some((p) => v.startsWith(p))
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
  const publicShape = (row, slug, fees) => {
    const d = row.data;
    /**
     * THE PRICE A VISITOR SEES IS THE SELLER PRICE — never catalog_price.
     *
     * catalog_price belongs to the lookbook, which is quoted to partners and wholesale
     * buyers on different terms; putting it on the open web publishes a trade rate to
     * everyone. `price`/`basePrice` is what a seller pays us to make one (pricing.js — it
     * is the base the order charge is built from), which is exactly the figure this page
     * exists to quote.
     *
     * basePrice is included as a fallback because a hand-built product carries only that:
     * reading `price` alone made the hat and the hoodie priceless, and a priceless product
     * is dropped below — so two perfectly good products were invisible with nothing said.
     */
    const price = Number(d.price ?? d.basePrice ?? d.base_price ?? row.base_price);
    /**
     * THE LOWEST PRICE ANYONE CAN ACTUALLY PAY, and whether it is the only one.
     *
     * One figure was published for a product whose price moves by size — a 5XL costs more
     * to buy and to ship than an S — so the page quoted the base against a tee you cannot
     * order in every size at that number. Every catalogue in this trade says "from" for
     * exactly this reason.
     *
     * `priceFrom` is the cheapest priced SIZE when the product has per-size tiers, else the
     * base. `priceVaries` is what lets the page say "from" ONLY when it is true: a product
     * with one price must not be dressed up as a range, which is the other half of being
     * honest about it.
     *
     * Tier prices only — a tier with no price of its own inherits the base and cannot make
     * the range wider than it is.
     */
    const tierPrices = (Array.isArray(d.sizePrices) ? d.sizePrices : [])
      .map((t) => Number(t && t.price))
      .filter((n) => Number.isFinite(n) && n > 0);
    const withBase = Number.isFinite(price) && price > 0 ? [...tierPrices, price] : tierPrices;
    const priceFrom = withBase.length ? Math.min(...withBase) : price;
    const priceVaries = withBase.length > 1 && Math.max(...withBase) > Math.min(...withBase);
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
      /**
       * THE CATEGORY IS `type` — the field that is actually filled in.
       *
       * This read `d.category`, which NOTHING writes: the product editor sets `type`
       * (Apparel · Headwear · Bags · Drinkware · Accessories · Other) and there has never
       * been a category input anywhere. So every one of the 19 published products came out
       * with `category: null`, the catalogue page grouped them all under "More", and its
       * grouping threshold (two groups of more than one) was never met — which is why the
       * public catalogue has no sections, no headings and no way to browse by kind.
       *
       * `category` is still read FIRST so a future explicit field wins over the type, and
       * neither is invented: null stays null and the page keeps its ungrouped layout.
       */
      category: typeof d.category === 'string' && d.category.trim()
        ? d.category.trim()
        : (typeof d.type === 'string' && d.type.trim() ? d.type.trim() : null),
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
      /** The cheapest orderable size, and whether there is more than one price. The page
       *  says "from" only when priceVaries — see the note where these are computed. */
      priceFrom,
      priceVaries,
      /**
       * HAND-PICKED FOR THE FRONT OF THE CATALOGUE.
       *
       * A boolean set in the product editor, published by NAME like everything else here.
       * The marketing page had no way to lead with anything: 13 products in one grid, in
       * whatever order the catalogue happened to hold, with nothing to say where to start.
       * A shelf someone chose is the whole difference between a catalogue and a list.
       */
      featured: d.featured === true,
      /**
       * WHAT THIS ONE SHIPS FOR — not a platform average.
       *
       * Straight out of pricing.js's shipFeeOf, which is the function that actually bills:
       * the product's own fee when it has one, otherwise its garment band. The page used to
       * print a single flat "first item" figure for every product on the site, so a cap and
       * a hoodie quoted the same postage and neither matched the invoice.
       *
       * Not a leak: this is OUR price to a seller. It says nothing about what the blank
       * cost us or who made it.
       */
      ship: fees ? money(shipFeeOf(row, null, fees)) : null,
      methods,
      colors,
      sizes: Array.isArray(d.sizes) ? d.sizes.filter((s) => typeof s === 'string' && s.trim()) : [],
      /**
       * HOW THE PHOTO IS FRAMED — two numbers, and nothing else about it.
       *
       * Added to the allow-list deliberately, not by widening it: a supplier's studio shot
       * is a small garment in a large white field, and the crop someone sets in the product
       * editor is the difference between a card that looks composed and one that looks like
       * a stock photo. Without these the public site was the one surface that ignored it.
       *
       * Safe to publish by the test this list exists for (CLAUDE.md 2.8): a scale factor and
       * a vertical offset say nothing about who makes the blank or what it costs us. Clamped
       * to the editor's own bounds rather than passed through, so a hand-edited row can't
       * put an arbitrary transform on a public page.
       */
      imgZoom: clampNum(d.imgZoom, 100, 300),
      imgFocusY: clampNum(d.imgFocusY, 0, 100),
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
    const fees = await feeSettings().catch(() => null);
    const r = await q(
      `select data, catalog_price, base_price from catalog_products
        where ${PUBLIC_STATUS_SQL}
        order by created_at desc limit 60`,
      [PUBLIC_STATUS]
    ).catch(() => ({ rows: [] }));
    const seen = new Map();
    return r.rows
      .filter((row) => row.data && row.data.name)
      .map((row) => {
        const base = slugify(publicName(row.data.name));
        if (!base) return null;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return publicShape(row, n === 1 ? base : `${base}-${n}`, fees);
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
      `select data from catalog_products where ${PUBLIC_STATUS_SQL} order by created_at desc limit 60`,
      [PUBLIC_STATUS]
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
    // The extra-item fee rides along. A price with no shipping beside it is the half of the
    // answer that flatters us, and this is our own price to a seller — not a supplier cost,
    // not a margin. Still an ALLOW-LIST: four named numbers, nothing else.
    //
    // The FIRST item's fee is per-product now (`ship` on each card above), because it always
    // was — it comes from the garment's band. Publishing one flat figure for the whole
    // catalogue quoted a cap and a hoodie the same postage. The bands ride along too, for
    // the grid, where no single product is on screen and only the three classes are true.
    const nums = await readSettings().catch(() => ({}));
    return {
      products: products.sort((a, b) => a.price - b.price).slice(0, 24),
      shipping: {
        bands: {
          cap: Number(nums.ship_cap) || 0,
          heavy: Number(nums.ship_heavy) || 0,
          garment: Number(nums.ship_garment) || 0,
        },
        extra: Number(nums.ship_extra) || 0,
      },
    };
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
    // Same omission as `renderable` had: a SanMar path fell through to null, then failed the
    // https test, and the row's image 404'd in a document we hand to an outside company.
    // upsizeSupplierImg returns anything that isn't an S&S path untouched, so one branch
    // covers both — the S&S size-swap still happens, SanMar dispatches as stored.
    const proxied = SUPPLIER_IMG_PREFIXES.some((p) => raw.startsWith(p)) ? upsizeSupplierImg(raw)
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
    // colorGallery holds the SAME kind of value as colorImages — a colourway's extra angles —
    // so it has to be slimmed by the same rule. Left out, an uploaded back-view stays a raw
    // data: URL in every list response, which is the megabytes-per-row problem this exists to
    // stop, just through a newer field.
    if (out.colorGallery && typeof out.colorGallery === 'object') {
      const e = await Promise.all(Object.entries(out.colorGallery).map(async ([k, v]) =>
        [k, Array.isArray(v) ? await Promise.all(v.map(byAddress)) : v]));
      out.colorGallery = Object.fromEntries(e);
    }
    return out;
  }

  app.get('/api/catalog_products', { preHandler: requireAuth }, async (req) => {
    const r = await q('select data, status, in_catalog, catalog_price from catalog_products order by created_at desc');
    const staff = isStaff(req.user);
    const rows = r.rows
      .filter((row) => row.data)
      // STAFF-ONLY MEANS STAFF. A seller's list is filtered by status here, at the read —
      // not in the client, where "don't render it" still ships the row over the wire and a
      // devtools tab is all it takes. Draft and Archived fall out for the same reason:
      // sellerVisible() is an allow-list, so a status nobody has invented yet is withheld
      // rather than published by default.
      .filter((row) => staff || sellerVisible(row.status ?? row.data.status))
      // The catalogue fields ride on the product rather than in a parallel list, so a
      // consumer can't hold a product and miss whether it's published.
      .map((row) => ({ ...row.data, inCatalog: !!row.in_catalog, catalogPrice: row.catalog_price == null ? null : Number(row.catalog_price) }));
    const light = await Promise.all(rows.map(slimImages));
    return staff ? light : light.map(sellerSafe);
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
    /**
     * BASE_MARKUP FIRST, THEN YOURS — the invoice is never one division away.
     *
     * ss_products.price is what we PAY S&S (customerPrice/piecePrice). This multiplied it by
     * the markup and wrote the result as the catalogue price, so a lookbook handed to a
     * partner carried our supplier cost × 1.05 — divide by 1.05 and you have our invoice.
     * That is §2.9 broken by arithmetic, and it is the path a style PICKED DIRECTLY FROM A
     * SUPPLIER takes, which is exactly the case that matters here.
     *
     * base_markup is the same number pricing.js adds to a supplier cost to get the base a
     * SELLER is charged (costPartsOf, step 4), so this is one ladder rather than two: the
     * partner price is our base plus whatever margin is being applied today, and the supplier
     * figure sits two markups back instead of one.
     *
     * A zero base_markup collapses the two and is worth knowing about — see the note the
     * caller gets back.
     */
    const fees0 = await feeSettings().catch(() => ({}));
    const baseMarkup = Number(fees0.base_markup) || 0;
    const r = await q(
      `insert into catalog_picks (source, ref, catalog_price)
       select $1, c.style_id, round(((c.cost + $4::numeric) * (1 + $3::numeric / 100))::numeric, 2)
         from (select style_id, max(price) as cost from ss_products
                where style_id = any($2::text[]) and price is not null
                group by style_id) c
        where c.cost > 0
       on conflict (source, ref) do update set catalog_price = excluded.catalog_price`,
      [source, refs, pct, baseMarkup]).catch(() => ({ rowCount: 0 }));
    audit(req, 'catalog.pick.markup', { entityType: 'catalog', entityId: 'picks', after: { markupPct: pct, baseMarkup, priced: r.rowCount } });
    return {
      ok: true, priced: r.rowCount, skippedNoCost: refs.length - r.rowCount,
      /**
       * SAID OUT LOUD when the guardrail is thin. With base_markup at 0 the catalogue price
       * IS the supplier cost plus only the percent typed here, so a small percent leaves the
       * invoice one division away on a sheet that goes to partners. The caller is told rather
       * than blocked: publishing a lookbook is not the moment to argue about settings, and a
       * seller-facing lookbook at base + 0% is a legitimate thing to want.
       */
      baseMarkup,
      thinMargin: baseMarkup === 0,
    };
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
   * The SELLER price, written as SQL — the same rule publicShape applies, in the same order:
   * `price`, then `basePrice`, then the base_price column.
   *
   * catalog_price is deliberately absent. That is the lookbook's number, quoted to partners
   * on trade terms, and the marketing site does not show it.
   *
   * A count computed by a DIFFERENT rule from the route it describes is worse than no count,
   * which is what `catalog_price is null` was: it called the one live product "no price —
   * prints blank" while the page quoted $41.20 from data->>'price' perfectly well.
   *
   * The regex guards are not decoration. These are free-form json values, so a non-numeric
   * one makes the cast throw — and this query is the whole summary.
   */
  const NUMERIC_JSON = (path) =>
    `case when data->>'${path}' ~ '^[0-9]+(\\.[0-9]+)?$' then (data->>'${path}')::numeric end`;
  const PUBLIC_PRICE_SQL = `coalesce(${NUMERIC_JSON('price')}, ${NUMERIC_JSON('basePrice')}, base_price)`;

  app.get('/api/catalog/summary', { preHandler: requireStaff }, async () => {
    // The LOOKBOOK — in_catalog plus picks. Its own thing, and no longer anything to do with
    // what the website shows.
    const prod = await q(
      `select count(*)::int as n, count(*) filter (where catalog_price is null)::int as unpriced
         from catalog_products where in_catalog = true`
    ).then((r) => r.rows[0] || { n: 0, unpriced: 0 }).catch(() => ({ n: 0, unpriced: 0 }));
    // THE WEBSITE — status alone decides it.
    const live = await q(
      `select count(*)::int as n,
              count(*) filter (where ${PUBLIC_PRICE_SQL} is null or ${PUBLIC_PRICE_SQL} <= 0)::int as unpriced
         from catalog_products where ${PUBLIC_STATUS_SQL}`,
      [PUBLIC_STATUS]
    ).then((r) => r.rows[0] || { n: 0, unpriced: 0 }).catch(() => ({ n: 0, unpriced: 0 }));
    const picks = await q(
      `select count(*)::int as n, count(*) filter (where catalog_price is null)::int as unpriced
         from catalog_picks`
    ).then((r) => r.rows[0] || { n: 0, unpriced: 0 }).catch(() => ({ n: 0, unpriced: 0 }));
    return {
      products: prod.n, styles: picks.n, total: prod.n + picks.n,
      unpriced: (prod.unpriced || 0) + (picks.unpriced || 0),
      /**
       * WHAT THE MARKETING SITE SHOWS — counted off `status`, the flag that now decides it,
       * and deliberately NOT off this bar's own totals.
       *
       * `total` above is the LOOKBOOK: in_catalog products plus supplier styles, the right
       * number for a trade document. The website is a different surface with a different
       * rule, and the two are printed apart so a bar reading "4 in the catalogue" can never
       * again be read as a promise about the site.
       */
      publicVisible: Math.max(0, (live.n || 0) - (live.unpriced || 0)),
      publicHidden: { unpriced: live.unpriced || 0 },
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
  /**
   * WHAT THE SHEET SAYS, when it should not say what the record says.
   *
   * A lookbook is a document, and preparing one is mostly rewriting: a supplier's style name
   * is a part number, their description is three lines of fabric weight, and the photo on our
   * own product is whatever someone attached while setting it up. Until now the only way to
   * fix any of that was to leave the preview, edit the product, and come back — so nobody did,
   * and the catalogue went out reading like a stock feed.
   *
   * A SEPARATE TABLE, NOT THE RECORD ITSELF. Two reasons, and both have teeth:
   *
   *   - A PICKED SUPPLIER STYLE HAS NO RECORD OF OURS. Its name and description live in
   *     ss_products, which is the supplier's data on their schedule — the next sync would
   *     overwrite an edit written there, and writing to it at all makes our copy of their
   *     catalogue untrue.
   *   - OUR OWN PRODUCTS FEED ORDERS AND THE PUBLIC SITE. `data.name` is on invoices and
   *     `data.description` is on the marketing catalogue; retitling a page of a brochure must
   *     not rename the thing a seller is buying.
   *
   * So this is a presentation layer, keyed by the same (source, ref) the sheet already uses,
   * and it is READ ONLY BY THE LOOKBOOK. Price is deliberately NOT here — see the PATCH.
   */
  q(`create table if not exists lookbook_overrides (
       source text not null,
       ref text not null,
       name text,
       description text,
       image text,
       updated_at timestamptz not null default now(),
       updated_by text,
       primary key (source, ref)
     )`).catch(() => {});

  /** Every override, as source:ref → row. One read per lookbook rather than one per style. */
  const lookbookOverrides = async () => {
    const r = await q('select source, ref, name, description, image from lookbook_overrides')
      .catch(() => ({ rows: [] }));
    const m = new Map();
    for (const row of r.rows) m.set(`${row.source}:${row.ref}`, row);
    return m;
  };

  /**
   * Apply one. A null column means "nothing was overridden here" and leaves the source value
   * alone — which is what makes clearing a single field a revert rather than a blanking.
   */
  const withOverride = (style, ov) => {
    if (!ov) return style;
    return {
      ...style,
      name: ov.name != null && ov.name !== '' ? ov.name : style.name,
      description: ov.description != null ? ov.description : style.description,
      image: ov.image != null && ov.image !== '' ? ov.image : style.image,
      // Said out loud so the sheet can mark an edited page and offer to put it back. A
      // document you cannot tell you have altered is one you cannot check.
      edited: !!(ov.name || ov.description != null || ov.image),
    };
  };

  app.get('/api/catalog/lookbook', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }

    const overrides = await lookbookOverrides();

    // base_price is selected because the seller price below coalesces onto it LAST, exactly
    // as publicShape does. Reading `data` alone left that final term undefined, so a product
    // whose price lives only in the column — the import writes both, but the column is what
    // sellerBaseCostOf bills from — still printed a dash on the sheet.
    const mineRows = (await q(
      /*
       * `id` IS THE ROW'S IDENTITY and has to be selected.
       *
       * The ref handed to the client was String(data.id ?? data.sku), read out of the JSON
       * blob — while the price edit does `update catalog_products set catalog_price where
       * id = $ref`. On any product whose data carries no `id` (an import, an older row) the
       * ref fell back to the SKU, matched no row, and the edit answered 404 — while the name
       * and image edits beside it saved fine, because those key on source:ref in their own
       * table and do not care what the ref is. Hence "the price doesn't save" on some styles
       * and not others, with everything else on the page working.
       */
      `select id, data, catalog_price, base_price from catalog_products where in_catalog = true order by created_at desc`
    ).catch(() => ({ rows: [] }))).rows;

    /**
     * THE PARCEL, quoted from the function that bills it.
     *
     * The lookbook's price table states a first-item and an additional-item fee per style,
     * and both come from pricing.js — shipFeeOf resolves the product's own fee or its
     * garment band, extraFeeOf its own override or the platform default. A second fee rule
     * written here would be a document quoting a wholesale buyer numbers we do not charge,
     * which is worse than quoting none.
     *
     * A failed settings read leaves them NULL rather than 0: "we could not price the
     * postage" and "the postage is free" are different sentences, and the table prints the
     * first as a dash instead of inventing the second.
     */
    const fees = await feeSettings().catch(() => null);

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
      // The COLUMN first: it is what every write keys on.
      const ref = String(row.id ?? d.id ?? d.sku ?? '');
      /*
       * An override saved under the OLD ref still applies. Edits made before this fix are
       * keyed by whatever the ref was then, and dropping somebody's renamed page or replaced
       * photo while fixing a different bug is not a fix.
       */
      const legacyRef = String(d.id ?? d.sku ?? '');
      return withOverride({
        ref, source: 'mine', name: d.name || '', sku: d.sku || '',
        description: d.description || '', brand: notSupplier(d.brand),
        image: supplierArt.get(sid) || d.image || d.img || '',
        price: row.catalog_price == null ? null : Number(row.catalog_price),
        /**
         * WHAT A SELLER PAYS, so a style with no trade price is still quoted.
         *
         * `price` is catalog_price — the rate quoted to partners — and a product nobody has
         * priced for the trade printed a dash on a page whose whole job is to be ordered
         * from. This is the OTHER number, the one pricing.js charges a seller, sent so the
         * sheet can fall back to it rather than to nothing.
         *
         * Kept as its OWN field rather than coalesced into `price`, because the two mean
         * different things to different readers and a document that silently swaps them is
         * how a partner ends up quoted a seller rate. The template decides which to show.
         *
         * Same coalesce publicShape uses, so the lookbook and the public site cannot
         * disagree about what a seller pays.
         */
        sellerPrice: (() => {
          const n = Number(d.price ?? d.basePrice ?? d.base_price ?? row.base_price);
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        /**
         * ONE PRICE PER TECHNIQUE, because a blank that takes both has two.
         *
         * The sheet quoted a single "unit" figure — the base plus whatever surcharge the
         * product's first listed method happens to carry — so a garment offered in DTG and
         * embroidery was quoted at one of them and the other half of the sheet was wrong.
         * Stitches cost more than ink; that is the whole reason method_emb exists.
         *
         * NULL for a technique the product does not offer, which the table prints as N/A. A
         * price for a method we cannot run is worse than a gap: it is a number a partner can
         * place an order against.
         */
        priceByMethod: priceByMethodOf({ data: d, base_price: row.base_price }, fees,
          Array.isArray(d.methods) ? d.methods : (d.method ? [d.method] : [])),
        sizes: Array.isArray(d.sizes) ? d.sizes
          : (Array.isArray(d.sizePrices) ? d.sizePrices.map((t) => t && t.size).filter(Boolean) : []),
        // Supplier colourways when we can match the style — they carry a real photo AND an
        // orderable sku per colour, which our colorImages map has no room for.
        colors: (supplierColours && supplierColours.length)
          ? supplierColours
          : Object.keys(ci).map((name) => ({ name, sku: '', image: ci[name] || '' })),
        // What it costs to send one, and each extra in the same box. Same numbers the
        // order quote uses — see the note on `fees` above.
        ship: fees ? shipFeeOf(row, null, fees) : null,
        shipExtra: fees ? extraFeeOf(row, fees) : null,
        // Our own products carry no supplier spec chart unless their sku resolves to a
        // style; filled below for the ones that do.
        specs: [],
      }, overrides.get('mine:' + ref) || (legacyRef && legacyRef !== ref ? overrides.get('mine:' + legacyRef) : undefined));
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

    const supplier = picked.map((p) => withOverride({
      ref: p.ref, source: 'ss', name: p.name || p.ref, sku: p.ref,
      // The lookbook PRINTS this next to the style name (catalog-print.tsx), so `|| 'S&S'`
      // put our supplier's name on every page of a catalogue handed to a buyer.
      description: descs.get(p.ref) || '', brand: notSupplier(p.brand),
      image: ssImgUrl(p.image),
      price: p.catalog_price == null ? null : Number(p.catalog_price),
      // A picked supplier style has no catalog_products row, so there is no seller price for
      // it — null, not 0, because "we have not priced this" is not "it is free".
      sellerPrice: null,
      sizes: p.sizes || [],
      colors: coloursByStyle.get(p.ref) || [],
      specs: specsByStyle.get(p.ref) || [],
      /**
       * A picked supplier style has no catalog_products row, so it has no per-product
       * shipping override to read — it lands on its garment BAND, which is what shipFeeOf
       * resolves from the type/name text. Handing it a row-shaped object keeps that one
       * function the only thing deciding a parcel's price; band selection here and in
       * pricing.js would be two rules for the same question.
       */
      ship: fees ? shipFeeOf({ data: { name: p.name || '', type: '' } }, null, fees) : null,
      shipExtra: fees ? extraFeeOf({ data: {} }, fees) : null,
    }, overrides.get('ss:' + p.ref)));

    return { styles: [...mine, ...supplier] };
  });

  /**
   * EDIT ONE PAGE OF THE SHEET.
   *
   * `name`, `description` and `image` land in lookbook_overrides — a presentation layer over
   * whichever source the style came from (see the table's note). `price` does NOT: it is
   * written straight to the number that already holds it, catalog_products.catalog_price for
   * our own products and catalog_picks.catalog_price for a picked style, which are the exact
   * columns the Catalogue page edits and the markup button writes.
   *
   * That split is the whole design. A price kept here as well would be a SECOND catalogue
   * price, and the first thing that happens is someone runs the markup, sees the page still
   * showing the old figure, and runs it again. One number, one home; the other three have no
   * home outside this document and get one here.
   *
   * A FIELD SET TO null CLEARS IT — the page goes back to what the source says, which is what
   * makes an edit reversible rather than a one-way overwrite. `reset: true` clears all three.
   */
  app.patch('/api/catalog/lookbook/:source/:ref', { preHandler: requireStaff }, async (req, reply) => {
    const source = String((req.params && req.params.source) || '');
    const ref = String((req.params && req.params.ref) || '');
    if (!ref) { reply.code(400); return { error: 'No style.' }; }
    if (source !== 'mine' && source !== 'ss') { reply.code(400); return { error: 'Unknown source.' }; }
    const b = req.body || {};

    if (b.reset === true) {
      await q('delete from lookbook_overrides where source=$1 and ref=$2', [source, ref]).catch(() => {});
      audit(req, 'catalog.lookbook.reset', { entityType: 'catalog', entityId: `${source}:${ref}` });
      return { ok: true, reset: true };
    }

    /**
     * AN IMAGE ARRIVES AS BYTES AND IS STORED AS AN ADDRESS.
     *
     * byAddress puts an uploaded data: URL in catalog_img_refs and hands back
     * /api/catalog/img/<hash>, so this table holds ~35 characters instead of a megabyte of
     * base64 — the same treatment product artwork already gets on the way out, and the reason
     * the lookbook response doesn't grow by the size of every photo somebody attaches.
     *
     * ONLY AN UPLOAD OR ONE OF OUR OWN PATHS. An arbitrary https address is refused rather
     * than stored: the obvious thing to paste here is the picture you just found on a supplier
     * site, and that address would then be printed into a document we hand to a buyer — §2.9,
     * through the `image` field rather than a field called `supplier`.
     */
    let image;
    if (b.image !== undefined) {
      if (b.image === null || b.image === '') image = null;
      else {
        const v = String(b.image);
        if (/^data:image\//i.test(v)) image = await byAddress(v);
        else if (v.startsWith('/api/')) image = v;
        else { reply.code(400); return { error: 'Attach a file — a link to someone else\'s image can\'t go in a catalogue.' }; }
      }
    }

    const name = b.name === undefined ? undefined : (b.name === null ? null : String(b.name).trim().slice(0, 200));
    const description = b.description === undefined ? undefined : (b.description === null ? null : String(b.description).slice(0, 4000));

    if (name !== undefined || description !== undefined || image !== undefined) {
      // COALESCE ON THE EXISTING ROW so a one-field edit doesn't blank the other two, and an
      // explicit null still clears — that is why the "was it sent" test is done in JS above
      // and only the resolved values reach SQL.
      await q(
        `insert into lookbook_overrides (source, ref, name, description, image, updated_by)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (source, ref) do update set
           name        = case when $7 then excluded.name        else lookbook_overrides.name end,
           description = case when $8 then excluded.description else lookbook_overrides.description end,
           image       = case when $9 then excluded.image       else lookbook_overrides.image end,
           updated_at  = now(), updated_by = excluded.updated_by`,
        [source, ref, name ?? null, description ?? null, image ?? null,
          String((req.user && req.user.sub) || ''),
          name !== undefined, description !== undefined, image !== undefined]
      );
    }

    // The price goes to its own column, by source. Not found is a 404 rather than a silent
    // success: "we saved it" about a row that doesn't exist is the worst answer available.
    let catalogPrice;
    if (b.price !== undefined) {
      const price = b.price === null || b.price === '' ? null : Math.max(0, Number(b.price));
      if (price !== null && !isFinite(price)) { reply.code(400); return { error: 'Price must be a number.' }; }
      if (source === 'mine') {
        const r = await q('update catalog_products set catalog_price=$2 where id=$1', [ref, price]);
        if (!r.rowCount) { reply.code(404); return { error: 'No such product.' }; }
      } else {
        await q(
          `insert into catalog_picks (source, ref, catalog_price) values ('ss',$1,$2)
           on conflict (source, ref) do update set catalog_price = excluded.catalog_price`,
          [ref, price]);
      }
      catalogPrice = price;
    }

    audit(req, 'catalog.lookbook.edit', {
      entityType: 'catalog', entityId: `${source}:${ref}`,
      after: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description: description == null ? null : description.slice(0, 80) } : {}),
        // The address, never the bytes — an audit row is not a place to put a photograph.
        ...(image !== undefined ? { image } : {}),
        ...(catalogPrice !== undefined ? { catalogPrice } : {}),
      },
    });
    return { ok: true, source, ref, ...(catalogPrice !== undefined ? { catalogPrice } : {}) };
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

    const rows = await q('select id, data, base_price from catalog_products where id = any($1::text[])', [ids])
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
    /**
     * OVER OUR BASE COST, NOT OVER THE SUPPLIER'S INVOICE.
     *
     * This read sizePrices[].cost and productCost — the price we PAY S&S — and multiplied it
     * by the markup. So "cost + 5%" printed $2.27 in a partner-facing lookbook beside a blank
     * we buy at $2.16, and anyone holding the sheet could divide by 1.05 and read our supplier
     * cost. §2.9 broken by arithmetic rather than by a field name. It also meant 5% was not a
     * 5% margin on anything a seller pays — two very different numbers wearing one label.
     *
     * sellerBaseCostOf is the SAME ladder pricing.js charges a seller on, imported rather than
     * copied (§5). Supplier cost still reaches it, but only through base_markup — which puts
     * the invoice two markups away from the printed page instead of one, and covers products
     * synced from a supplier automatically: they arrive with productCost alone, and the ladder
     * turns that into a base before anything can be derived from it.
     */
    const fees = await feeSettings().catch(() => ({}));
    const costOf = (d, row) => sellerBaseCostOf({ data: d, base_price: row && row.base_price }, fees);

    for (const row of rows) {
      const d = row.data || {};
      const cost = costOf(d, row);
      // A product with no recorded cost anywhere cannot be marked up, and guessing one
      // would put a made-up number in front of a buyer. Reported back, not skipped in
      // silence.
      // No base cost anywhere means nothing to mark up — and falling back to what we PAY
      // would put our supplier price on a partner's sheet, which is the whole bug above.
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
    // The other half of the same rule — a projection must not become the record here either.
    // Without this, a colourway's extra angles would be SAVED as /api/catalog/img/<hash>,
    // which is exactly the fault this function was written to undo for colorImages.
    if (out.colorGallery && typeof out.colorGallery === 'object') {
      const e = await Promise.all(Object.entries(out.colorGallery).map(async ([k, v]) =>
        [k, Array.isArray(v) ? await Promise.all(v.map(back)) : v]));
      out.colorGallery = Object.fromEntries(e);
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
    /**
     * WHICH PRODUCTS ARE NEW — read before the upsert, because after it everything exists.
     *
     * Only new ones get inventory rows (see below). A re-save of the whole list, which is
     * what every edit posts, must not re-file anything.
     */
    const existingIds = new Set(
      (await q('select id from catalog_products').catch(() => ({ rows: [] }))).rows.map((r) => String(r.id))
    );
    const freshlyAdded = [];
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
      if (!existingIds.has(id)) freshlyAdded.push(p);
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
    /**
     * A NEW PRODUCT ARRIVES ON THE SHELF AS "NONE OF EACH", not as silence.
     *
     * A product syncs in with seven colourways and inventory held nothing for it, so every
     * order line for it read "Not tracked" — which is not "we have none", it is "nobody has
     * an opinion", and the two are opposite instructions: one says reorder, the other says
     * go and look. A row at 0 is an answer; a missing row is a question.
     *
     * ONLY ON CREATION, and only for products with a sku of ours to key on. Re-saving the
     * catalogue re-posts every product, so anything that ran per save would re-file the
     * whole list on every edit.
     *
     * ON CONFLICT DO NOTHING — never an update. This must not be able to zero a count
     * somebody typed or a scanner wrote; the worst it can do is nothing.
     *
     * FACTORY ONLY, like every other way stock comes into existence: holding a blank is not
     * a decision to publish it.
     *
     * This is the PRODUCTS list, not the catalogue. Being in the lookbook is a statement
     * about what we will sell to partners; being a product is what an order line resolves
     * to, and that is the thing a shelf answers for.
     */
    let tracked = 0;
    for (const p of freshlyAdded) {
      const sku = String(p.sku || '').trim();
      if (!sku) continue;
      // THE PRODUCT'S OWN VARIANTS, as the editor saved them — never the supplier's full
      // run. We keep seven of a style's sixty colourways; the other fifty-three are not
      // ours to hold, and a row for one would read as "we have none of that" about a
      // garment nobody chose to sell.
      const pairs = variantPairs(productSizes(p), productColors(p));
      for (const v of pairs) {
        const key = variantSku(sku, v.size, v.color);
        if (!key) continue;
        const r = await q(
          // Base-schema columns only. `visibility` and `supplier` are added later, in
          // inventory.js's own ensure(), and this route can run before it has — a missing
          // column would throw into the catch and file nothing at all, silently. A null
          // visibility already READS as factory-only (visOf), which is the safe default and
          // the one every other creation path lands on.
          /**
           * THE SUPPLIER COMES WITH IT, and it is the field that decides whether a shortage
           * can be BOUGHT. replenish.js groups a shortfall by `inventory.supplier`, so a row
           * created without one lands in the cart as "Unassigned · order by hand" — a line
           * nobody can place, for a blank whose supplier the catalogue knew all along.
           *
           * Safe to store: `supplier` is never selected by the partner stock feed (see
           * VISIBLE_TO_PARTNERS in sandbox.js — an allow-list of sku/name/variant/counts),
           * and GET /api/inventory is requireStaff. It reaches the factory and the purchase
           * resolver, and nothing else. §2.9 is about what we PUBLISH.
           */
          `insert into inventory (sku, name, variant, in_stock, reserved, reorder_at, category)
           values ($1,$2,$3,0,0,25,$4)
           on conflict (sku) do nothing`,
          [key, p.name || null, variantLabel(v.size, v.color) || null, p.type || null]
        ).catch(() => ({ rowCount: 0 }));
        tracked += r.rowCount || 0;
        /**
         * THE SUPPLIER, WRITTEN SEPARATELY — and it is the field that decides whether a
         * shortage can be BOUGHT. replenish.js groups a shortfall by `inventory.supplier`,
         * so a row created without one lands in the cart as "Unassigned · order by hand":
         * a line nobody can place, for a blank whose supplier the catalogue knew all along.
         *
         * Its own statement because `supplier` is NOT in schema.sql — inventory.js adds it
         * at its own route load, and naming a column that may not exist yet would throw the
         * whole insert into the catch and file no row at all. This one is allowed to fail.
         *
         * `where supplier is null` so it never overwrites what somebody typed.
         *
         * Safe to store: the partner stock feed selects sku/name/variant/counts and never
         * this (VISIBLE_TO_PARTNERS in sandbox.js is an allow-list), and GET /api/inventory
         * is requireStaff. §2.9 is about what we publish, and this is published nowhere.
         */
        if (r.rowCount && p.supplier && String(p.supplier).trim()) {
          await q('update inventory set supplier=$2 where sku=$1 and supplier is null',
            [key, String(p.supplier).trim()]).catch(() => {});
        }
      }
    }
    if (tracked) {
      audit(req, 'inventory.auto_tracked', { entityType: 'inventory', entityId: 'auto',
        after: { rows: tracked, products: freshlyAdded.length } });
    }
    return { ok: true, count: keep.length, priceChanges: priceChanges.length, tracked };
  });
}
