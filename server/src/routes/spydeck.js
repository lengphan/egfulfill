// spydeck.js — a seller can SAVE (favorite) research listings they find in SpyDeck.
// Server-authoritative so saves follow the seller across devices. The whole listing
// is stored as jsonb so the Saved view renders without re-hitting Etsy. Table is
// created idempotently at route-load (same pattern as order_designs / wallet_ledger).
import { q } from '../db.js';
import { searchListings, connectionFor, shopListings, etsyPublicGet, mapListing } from './etsy.js';
import { aiComplete } from './support_ai.js';
import { requireSpydeck } from '../entitlements.js';

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists spydeck_saves (
    seller_id   text not null,
    listing_id  text not null,
    data        jsonb,
    created_at  timestamptz not null default now(),
    primary key (seller_id, listing_id)
  )`)
    // Researched listings already turned into a draft of our own — the Uploaded tab.
    // Same shape as saves plus the draft we created, so the tab can link straight to it.
    .then(() => q(`create table if not exists spydeck_uploads (
      seller_id       text not null,
      listing_id      text not null,
      our_listing_id  text,
      url             text,
      data            jsonb,
      created_at      timestamptz not null default now(),
      primary key (seller_id, listing_id)
    )`))
    // jsonb, matching schema.sql. Five route files declare this table and four of them
    // said `value text`; `create table if not exists` makes all of them no-ops on any
    // existing database, so the real column is jsonb and the `text` spellings were a lie
    // that readers here trusted. See readSetting() below.
    .then(() => q(`create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())`))
    .then(() => q(`create table if not exists spydeck_analysis (
      seller_id  text primary key,
      shop_id    text,
      data       jsonb,
      created_at timestamptz not null default now()
    )`))
    // Saved COMPETITOR shops (store research), keyed by seller like spydeck_saves.
    .then(() => q(`create table if not exists spydeck_saved_shops (
      seller_id  text not null,
      shop_id    text not null,
      data       jsonb,
      created_at timestamptz not null default now(),
      primary key (seller_id, shop_id)
    )`))
    // Per-seller "fresh scan" throttle (once / 2 days). Staff use the global 30-min lock
    // (read off the cached feed's built_at) instead, so they aren't tracked here.
    .then(() => q(`create table if not exists spydeck_seller_rebuild (
      seller_id  text primary key,
      at         timestamptz not null default now()
    )`))
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

/**
 * Read a `settings` value that may arrive as jsonb (already parsed by node-pg) or as a
 * text column on an older database.
 *
 * Both call sites here did a bare JSON.parse(row.value), which on the real jsonb column
 * receives an OBJECT, stringifies it to "[object Object]" and throws SyntaxError. In
 * /trending that throw was swallowed by a rebuild-on-miss catch, so the day-cache NEVER
 * hit: every single request ran the full 16-search Etsy fan-out the cache exists to
 * avoid. In /listing/:id/detail there is no fallback, so it 500'd every time.
 */
const readSetting = (row) => {
  if (!row || row.value == null) return null;
  return typeof row.value === 'string' ? JSON.parse(row.value || '{}') : row.value;
};

// Estimate model — ported VERBATIM from the client (eg-scout _est) so a listing
// scores identically on the server and on the card. NO AI involved: this is
// arithmetic over favorites + listing age, the only signals Etsy exposes.
//   favorites × 3.5 ≈ lifetime sales, ÷ age in days ≈ per-day rate.
function estOf(l) {
  const fav = l.num_favorers || 0;
  const created = l.created || 0;
  const nowS = Date.now() / 1000;
  const ageDays = created ? Math.max(1, (nowS - created) / 86400) : 45;
  const totalSold = Math.round(fav * 3.5) || fav;
  const vel = fav / ageDays;                       // favorites per day
  return {
    sold24: Math.max(0, Math.round(totalSold / ageDays)),
    // Identical rule to the TRENDING badge on the card: newly climbing, or hot
    // outright. Keep these two in step or the feed and the badge disagree.
    trending: (ageDays <= 30 && vel >= 1.2) || vel >= 6,
  };
}
function estSold24(l) { return estOf(l).sold24; }

// Rotating niche pool — several searched each day so the feed refreshes daily.
// Widened: the old feed searched 8 and kept 30, which ran out after a short scroll.
const TREND_NICHES = [
  'custom name necklace', 'comfort colors tee', 'mama sweatshirt', 'retro groovy tee',
  'birth flower necklace', 'pet portrait sweatshirt', 'personalized gift', 'bachelorette shirt',
  'teacher gift', 'vintage aesthetic sweatshirt', 'embroidered crewneck', 'coquette',
  'minimalist jewelry', 'boho wall art', 'funny shirt', 'monogram tumbler',
  'trendy sweatshirt', 'aesthetic wall art', 'custom pet', 'personalized jewelry',
  // Widened again so a manual "fresh scan" (which advances the niche window) pulls
  // genuinely NEW niches instead of near-duplicates of the day's set.
  'embroidered sweatshirt', 'custom dog mom', 'western boho tee', 'coquette bow',
  'gym pump cover', 'in my mom era', 'wildflower shirt', 'stanley tumbler',
  'graphic tee vintage', 'christian faith shirt', 'eras tour shirt', 'cat mom gift',
  'nurse gift', 'bridesmaid proposal', 'baby announcement', 'halloween sweatshirt',
  'christmas pajamas', 'golf dad shirt', 'skeleton hand', 'sports mom shirt',
];

// Build (and cache daily) the trending POOL. One pool is cached for everyone and
// then sliced per role at request time (see the route) — a seller and an admin want
// different cuts of the same day's data, and re-searching Etsy per role would burn
// the rate limit for no reason.
const POOL_SIZE = 200;      // was 120 — deeper pool so the free "More ideas" reshuffle
                            // has ~8 screens of variety before a card repeats
const NICHES_PER_DAY = 16;  // niches searched per pool build
const SEARCH_CONCURRENCY = 5; // Etsy allows ~10 req/sec; batch searches 5-at-a-time so a
                              // build (or fresh scan) never bursts past the per-second limit

// Run async work over `items` in fixed-size batches — the real rate-limit guard. Firing
// all 16 searches at once could brush Etsy's ~10/sec; 5-at-a-time stays comfortably under.
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

// Build a trending POOL. `offset` advances WHICH niches are searched: the daily build uses
// 0; a manual "fresh scan" advances it so genuinely new niches are pulled, not duplicates.
async function buildTrending(offset = 0) {
  const dayIndex = Math.floor(Date.now() / 86400000);
  const base = dayIndex + offset * NICHES_PER_DAY;
  const picks = [];
  for (let i = 0; i < NICHES_PER_DAY; i++) picks.push(TREND_NICHES[(base + i) % TREND_NICHES.length]);
  const batches = await inBatches(picks, SEARCH_CONCURRENCY, (qy) =>
    searchListings(qy, { limit: 48, sort: 'score' }).then((r) => r.results).catch(() => []));
  const byId = new Map();
  for (const list of batches) for (const l of list) if (l.listing_id && !byId.has(l.listing_id)) byId.set(l.listing_id, l);
  // Carry the computed estimate on each row so the per-role slice is a plain filter,
  // not a recompute on every request.
  const all = Array.from(byId.values()).map((l) => { const e = estOf(l); return { ...l, _sold24: e.sold24, _trending: e.trending }; });
  all.sort((a, b) => b._sold24 - a._sold24);
  const products = all.slice(0, POOL_SIZE);
  // Keywords from the hot end of the pool.
  const counts = {};
  for (const l of products.slice(0, 80)) for (const t of (l.tags || [])) {
    const k = String(t).trim().toLowerCase();
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  const keywords = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t);
  return { date: new Date().toISOString().slice(0, 10), products, keywords, offset, built_at: new Date().toISOString() };
}

// Slice the shared pool for who's asking. Same data, different priority — staff
// boards are the higher tier and get the winners handed to them; sellers browse.
//  - Staff (admin/warehouse): ALL trending first, then everything else. Nothing is
//    hidden, it's ordered — they still page on into the rest.
//  - Sellers: a MIX. The hot ones are interleaved 1-in-3 rather than front-loaded,
//    so a seller browses the feed instead of skimming the top and leaving.
// Seeded PRNG (mulberry32). A deterministic shuffle so "More ideas" gives a NEW order per
// click, yet the SAME seed reproduces exactly — so paging stays stable within one refresh.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted-random ordering: hotter listings TEND toward the top, but the exact order
// varies with the seed — prioritisation without a frozen ranking. (Efraimidis-Spirakis
// weighted sampling: key = rnd^(1/weight), sort desc.)
function weightedShuffle(items, seed) {
  const rnd = mulberry32((seed >>> 0) || 1);
  return items
    .map((l) => {
      const w = Math.max(0.05, (l._sold24 || 0) + (l._trending ? 8 : 0) + 1);
      return { l, k: Math.pow(rnd(), 1 / w) };
    })
    .sort((a, b) => b.k - a.k)
    .map((x) => x.l);
}

// `seed === 0` (or omitted) keeps the original deterministic order — backward-compatible
// with every existing caller. A non-zero seed (a "More ideas" click) reshuffles WITHIN the
// hot/rest tiers, so the priority split is preserved but the specific cards rotate.
function sliceFor(pool, staff, seed = 0) {
  const rows = Array.isArray(pool) ? pool : [];
  const isHot = (l) => l._trending || (l._sold24 || 0) > 5;
  const sh = (arr) => (seed ? weightedShuffle(arr, seed) : arr);
  const hot = sh(rows.filter(isHot));
  const rest = sh(rows.filter((l) => !isHot(l)));

  if (staff) return [...hot, ...rest];

  // Interleave 1 hot : 2 rest. Whichever list runs out first, the other simply
  // continues — so the feed is never truncated to the shorter one.
  const out = [];
  let i = 0, j = 0;
  while (i < hot.length || j < rest.length) {
    if (i < hot.length) out.push(hot[i++]);
    if (j < rest.length) out.push(rest[j++]);
    if (j < rest.length) out.push(rest[j++]);
  }
  return out;
}

// Shop analysis for the Account Analyzer. The NUMBERS are computed here and are
// deterministic (same favorites+age estimate model SpyDeck uses everywhere else);
// only the WRITE-UP is asked of the model. An LLM inventing metrics would be a
// recommendation engine you couldn't trust.
function analyzeShop(listings) {
  const nowS = Date.now() / 1000;
  const est = (l) => {
    const fav = l.num_favorers || 0;
    const created = l.created || 0;
    const ageDays = created ? Math.max(1, (nowS - created) / 86400) : 45;
    const totalSold = Math.round(fav * 3.5) || fav;
    return { totalSold, perDay: totalSold / ageDays, revenue: Math.round(totalSold * (Number(l.price) || 0)), ageDays, fav };
  };
  const rows = listings.map((l) => ({ l, e: est(l) }));
  const prices = listings.map((l) => Number(l.price) || 0).filter((p) => p > 0).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;

  // Tag frequency — thin tag usage is the most common fixable Etsy SEO miss.
  const tagCounts = {};
  let tagTotal = 0, noTag = 0, thinTags = 0, shortTitle = 0, oneImage = 0;
  for (const l of listings) {
    const tags = Array.isArray(l.tags) ? l.tags : [];
    tagTotal += tags.length;
    if (!tags.length) noTag++;
    if (tags.length < 13) thinTags++;               // Etsy allows 13; fewer = wasted slots
    if ((l.title || '').length < 40) shortTitle++;  // short titles rank on fewer queries
    if ((l.images || []).length < 2) oneImage++;
    for (const t of tags) { const k = String(t).toLowerCase().trim(); if (k) tagCounts[k] = (tagCounts[k] || 0) + 1; }
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, n]) => ({ tag, n }));
  const byPerf = [...rows].sort((a, b) => b.e.perDay - a.e.perDay);

  return {
    listingCount: listings.length,
    medianPrice: Math.round(median * 100) / 100,
    priceRange: prices.length ? { min: prices[0], max: prices[prices.length - 1] } : null,
    totalFavorites: listings.reduce((n, l) => n + (l.num_favorers || 0), 0),
    estRevenue: rows.reduce((n, r) => n + r.e.revenue, 0),
    avgTags: listings.length ? Math.round((tagTotal / listings.length) * 10) / 10 : 0,
    issues: { noTags: noTag, thinTags, shortTitles: shortTitle, singleImage: oneImage },
    topTags,
    best: byPerf.slice(0, 5).map((r) => ({ title: r.l.title, price: r.l.price, favorites: r.e.fav, estSoldPerDay: Math.round(r.e.perDay * 10) / 10, tags: (r.l.tags || []).length })),
    worst: byPerf.slice(-5).reverse().map((r) => ({ title: r.l.title, price: r.l.price, favorites: r.e.fav, ageDays: Math.round(r.e.ageDays), tags: (r.l.tags || []).length })),
  };
}

// REAL sales for the seller's own shop, from receipts we've already synced.
// Etsy's API exposes no shop stats (no views/visits/conversion) and no ads data, so
// everywhere else SpyDeck must ESTIMATE from favorites+age. But for your own shop the
// truth is already in our orders table — estimating it here would be daft.
async function realSales(sellerId) {
  try {
    const r = await q(
      `select count(*)::int as orders,
              coalesce(sum(total),0)::float as revenue,
              coalesce(avg(total),0)::float as aov
         from orders
        where seller_id=$1 and source='etsy' and created_at > now() - interval '90 days'`,
      [sellerId]
    );
    const top = await q(
      `select oi.name, sum(oi.qty)::int as units, coalesce(sum(oi.qty * oi.unit_price),0)::float as revenue
         from order_items oi join orders o on o.id = oi.order_id
        where o.seller_id=$1 and o.source='etsy' and o.created_at > now() - interval '90 days'
        group by oi.name order by units desc limit 8`,
      [sellerId]
    );
    const s = r.rows[0] || {};
    if (!s.orders) return null; // no synced Etsy orders — fall back to estimates only
    return {
      windowDays: 90,
      orders: s.orders,
      revenue: Math.round((s.revenue || 0) * 100) / 100,
      avgOrderValue: Math.round((s.aov || 0) * 100) / 100,
      topSellers: top.rows.map((t) => ({ name: t.name, units: t.units, revenue: Math.round((t.revenue || 0) * 100) / 100 })),
    };
  } catch {
    return null; // never block the analysis on this
  }
}

// Normalise an Etsy shop object → the card the Stores tab renders. listing_active_count is
// the "how many products" figure; the rest is public credibility (favourites, reviews, sales).
function shopCard(s) {
  if (!s || !s.shop_id) return null;
  return {
    shop_id: String(s.shop_id),
    shop_name: s.shop_name || null,
    title: s.title || null,
    url: s.url || (s.shop_name ? `https://www.etsy.com/shop/${encodeURIComponent(s.shop_name)}` : null),
    icon: s.icon_url_fullxfull || null,
    listings: s.listing_active_count ?? null,
    favorers: s.num_favorers ?? null,
    reviews: s.review_count ?? null,
    rating: s.review_average ?? null,
    sales: s.transaction_sold_count ?? null,
    digital: s.is_using_structured_policies === undefined ? null : !!s.is_using_structured_policies,
    since: s.create_date || s.created_timestamp || null,
  };
}

export function spydeckRoutes(app, requireAuth) {
  /**
   * What a GRID CARD needs — and nothing else.
   *
   * The pool carries the full Etsy listing, including `description` (1-3KB each) and the
   * whole `images` array. The grid renders neither: both are read in exactly one place,
   * the "Make product" dialog, for the ONE listing you click. Shipping them for all 120
   * meant most of the response was data no card could display.
   *
   * They stay in the cached pool, so /listing/:id/detail below answers from memory with
   * no extra Etsy call — nothing is lost, it just isn't sent 120 times.
   */
  function gridRow(l) {
    return {
      listing_id: l.listing_id, title: l.title, price: l.price, currency: l.currency,
      price_usd: l.price_usd, price_converted: l.price_converted,
      price_min: l.price_min, price_max: l.price_max,
      url: l.url, image: l.image, thumb: l.thumb || l.image, tags: l.tags, created: l.created,
      views: l.views, shop_name: l.shop_name, num_favorers: l.num_favorers,
      _sold24: l._sold24, _trending: l._trending,
    };
  }

  /**
   * The heavy half of one listing, for the Make-product dialog. Served from the day's
   * cached pool — no Etsy call, no rate-limit cost.
   */
  app.get('/api/spydeck/listing/:id/detail', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    await ensure();
    try {
      const cached = await q("select value from settings where key='spydeck_trending'");
      const v = readSetting(cached.rows[0]);
      const hit = Array.isArray(v && v.products)
        ? v.products.find((l) => String(l.listing_id) === String(req.params.id))
        : null;
      if (!hit) { reply.code(404); return { error: 'Not in today\'s feed' }; }
      return { listing_id: hit.listing_id, description: hit.description || '', images: hit.images || [] };
    } catch (e) {
      reply.code(500); return { error: e.message };
    }
  });

  // Daily trending feed — 10 products (est. >10 sold/24h) + 10 keywords. Cached in
  // `settings` for the day so we hit Etsy a few times per DAY, not per visitor. Shared
  // by every SpyDeck (seller + factory). Signed-in users only.
  app.get('/api/spydeck/trending', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    await ensure();
    const today = new Date().toISOString().slice(0, 10);
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    // `seed` from a "More ideas" click reshuffles the cached pool for free — no Etsy call.
    const seed = Math.abs(parseInt(req.query.seed, 10) || 0);
    const serve = (feed) => ({
      date: feed.date, keywords: feed.keywords || [],
      built_at: feed.built_at || null, offset: feed.offset || 0,
      products: sliceFor(feed.products, staff, seed).map(gridRow),
    });

    try {
      const cached = await q("select value from settings where key='spydeck_trending'");
      if (cached.rows[0]) {
        const v = readSetting(cached.rows[0]) || {};
        // `_sold24` guards against a cache written by the OLD builder, which stripped
        // the computed fields — without them every row would look un-trending and
        // staff would get an empty feed until tomorrow.
        const usable = v && v.date === today && Array.isArray(v.products) && v.products.length && v.products[0]._sold24 !== undefined;
        if (usable) return serve(v);
      }
    } catch { /* rebuild below */ }
    try {
      const feed = await buildTrending();
      await q("insert into settings (key,value,updated_at) values ('spydeck_trending',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [JSON.stringify(feed)]).catch(() => {});
      return serve(feed);
    } catch (e) {
      reply.code(502); return { error: e.message || 'Could not build the trending feed', products: [], keywords: [] };
    }
  });

  // Fresh scan — rebuild the SHARED pool from new niches. This is the only path that
  // re-hits Etsy on demand, so it's rate-limited on three independent axes:
  //   • global 30-min lock (read off the cached feed's built_at) — the pool is shared,
  //   • per-seller once / 2 days (spydeck_seller_rebuild) — staff skip this,
  //   • global daily cap (20) — an absolute ceiling regardless of who clicks.
  // Batched searches (SEARCH_CONCURRENCY) keep it under Etsy's per-second limit, and any
  // Etsy failure falls back to the current cached pool rather than emptying the feed.
  const REBUILD_GLOBAL_MS = 30 * 60 * 1000;          // 30 min between ANY rebuilds
  const REBUILD_SELLER_MS = 2 * 24 * 60 * 60 * 1000; // a seller: once / 2 days
  const REBUILD_DAILY_CAP = 20;                       // hard ceiling on Etsy scans / day
  app.post('/api/spydeck/trending/rebuild', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    await ensure();
    const staff = !!(req.user && req.user.role && req.user.role !== 'seller');
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const seed = Math.abs(parseInt(req.query.seed, 10) || 0);

    // The cached feed's built_at drives the global 30-min lock.
    let cur = {};
    try { const c = await q("select value from settings where key='spydeck_trending'"); cur = readSetting(c.rows[0]) || {}; } catch { cur = {}; }
    const builtAt = cur.built_at ? Date.parse(cur.built_at) : 0;
    const sinceGlobal = now - builtAt;
    if (builtAt && sinceGlobal < REBUILD_GLOBAL_MS) {
      reply.code(429);
      return { error: `A fresh scan ran recently. Try again in ${Math.ceil((REBUILD_GLOBAL_MS - sinceGlobal) / 60000)} min.`, retryInMs: REBUILD_GLOBAL_MS - sinceGlobal };
    }

    // Global daily cap.
    let dayRec = {};
    try { const d = await q("select value from settings where key='spydeck_rebuild_day'"); dayRec = readSetting(d.rows[0]) || {}; } catch { dayRec = {}; }
    const dayCount = dayRec.date === today ? (dayRec.count || 0) : 0;
    if (dayCount >= REBUILD_DAILY_CAP) {
      reply.code(429);
      return { error: 'The daily fresh-scan limit is reached — it resets tomorrow. The feed still auto-refreshes each day, and "More ideas" reshuffles unlimited.', dailyCapped: true };
    }

    // Per-seller once / 2 days.
    if (!staff) {
      let last = 0;
      try { const r = await q('select at from spydeck_seller_rebuild where seller_id=$1', [String(req.user.sub)]); last = r.rows[0] && r.rows[0].at ? Date.parse(r.rows[0].at) : 0; } catch { last = 0; }
      if (last && now - last < REBUILD_SELLER_MS) {
        reply.code(429);
        return { error: 'You can request a fresh scan once every 2 days — use "More ideas" for unlimited reshuffles meanwhile.', nextAt: new Date(last + REBUILD_SELLER_MS).toISOString() };
      }
    }

    // Rebuild from the NEXT niche window.
    let feed;
    try { feed = await buildTrending((cur.offset || 0) + 1); }
    catch (e) { reply.code(502); return { error: e.message || 'Fresh scan failed — showing the current feed.' }; }
    if (!feed.products || !feed.products.length) { reply.code(502); return { error: 'Fresh scan returned nothing — showing the current feed.' }; }

    await q("insert into settings (key,value,updated_at) values ('spydeck_trending',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [JSON.stringify(feed)]).catch(() => {});
    await q("insert into settings (key,value,updated_at) values ('spydeck_rebuild_day',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [JSON.stringify({ date: today, count: dayCount + 1 })]).catch(() => {});
    if (!staff) await q('insert into spydeck_seller_rebuild (seller_id, at) values ($1, now()) on conflict (seller_id) do update set at=now()', [String(req.user.sub)]).catch(() => {});

    return {
      date: feed.date, keywords: feed.keywords || [], built_at: feed.built_at, offset: feed.offset,
      products: sliceFor(feed.products, staff, seed).map(gridRow), rebuilt: true,
    };
  });

  // List the seller's saved listings (newest first).
  // Account Analyzer — score the caller's own connected Etsy shop and write it up.
  //
  // COST CONTROL (we pay for every call on our own key):
  //  1. The model is sent COMPUTED stats (~500 tokens), never the raw listings
  //     (~50-100k tokens for 100 of them). Two orders of magnitude cheaper, and the
  //     numbers stay deterministic.
  //  2. The result is CACHED per seller for 24h — a shop doesn't change hour to hour,
  //     so re-opening the tab costs nothing. `refresh: true` forces a re-run.
  //  3. POST + explicit button: it never fires just because a tab was opened.
  //  4. Output capped (max_tokens) and the model defaults to Haiku.
  app.get('/api/spydeck/analysis', { preHandler: [requireAuth, requireSpydeck] }, async (req) => {
    await ensure();
    const r = await q('select data, created_at from spydeck_analysis where seller_id=$1', [String(req.user.sub)]);
    if (!r.rows[0]) return { cached: false };
    return { cached: true, at: r.rows[0].created_at, ...r.rows[0].data };
  });

  app.post('/api/spydeck/analyze', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    await ensure();
    const sellerId = String(req.user.sub);
    const refresh = !!(req.body && req.body.refresh);

    // Serve a fresh-enough cached run rather than paying for an identical one.
    if (!refresh) {
      const c = await q("select data, created_at from spydeck_analysis where seller_id=$1 and created_at > now() - interval '24 hours'", [sellerId]);
      if (c.rows[0]) return { cached: true, at: c.rows[0].created_at, ...c.rows[0].data };
    }

    const conn = await connectionFor(req.user);
    if (!conn) { reply.code(400); return { error: 'No Etsy shop connected', needsConnect: true }; }

    let shop, listings;
    try {
      const r = await shopListings(conn);
      shop = r.shop; listings = r.listings;
    } catch (e) {
      reply.code(e.status || 502);
      return { error: e.message || 'Could not read your Etsy shop' };
    }
    if (!listings.length) return { shop, stats: analyzeShop([]), advice: null, empty: true };

    const stats = analyzeShop(listings);
    const sales = await realSales(sellerId);   // real receipts beat estimates for your OWN shop

    // The model gets the COMPUTED stats, never raw listings — it writes the advice,
    // it doesn't invent the numbers.
    let advice = null, aiError = null;
    try {
      advice = await aiComplete({
        maxTokens: 900,
        system: [
          'You are an Etsy shop consultant for print-on-demand sellers.',
          'You are given COMPUTED statistics about one shop. Never invent numbers — cite only what you are given.',
          'SALES (if present) are REAL synced order data — state them as fact.',
          'STATS figures like estRevenue are ESTIMATES from favorites and listing age; call those estimates.',
          'Etsy publishes no views/visits/conversion data, so never refer to traffic, impressions or conversion rate.',
          'Reply in GitHub-flavored markdown. Be specific and concrete, no filler, no preamble.',
          'Use exactly these sections: "## What is working", "## What to fix", "## Do this next".',
          '"Do this next" must be 3-5 numbered actions the seller can do this week, most valuable first.',
        ].join(' '),
        messages: [{ role: 'user', content: `Analyze this Etsy shop and advise.\n\nSHOP: ${JSON.stringify({ name: shop.shop_name, favorites: shop.num_favorers, activeListings: shop.listing_active_count, reviews: shop.review_count, rating: shop.review_average })}\n\nSTATS: ${JSON.stringify(stats)}\n\nSALES (real, last 90d): ${sales ? JSON.stringify(sales) : 'none synced yet — rely on the estimates above'}` }],
      });
    } catch (e) {
      aiError = e.disabled ? e.message : (e.message || 'The assistant could not analyze the shop.');
    }
    const payload = { shop, stats, sales, advice, aiError, listings };
    // Only cache a run that actually produced advice — caching an AI failure for 24h
    // would lock the seller out of the feature until tomorrow.
    if (advice) {
      await q(`insert into spydeck_analysis (seller_id, shop_id, data, created_at)
               values ($1,$2,$3,now())
               on conflict (seller_id) do update set shop_id=excluded.shop_id, data=excluded.data, created_at=now()`,
        [sellerId, String(shop.shop_id || ''), JSON.stringify({ shop, stats, sales, advice })]).catch(() => {});
    }
    return { cached: false, ...payload };
  });

  app.get('/api/spydeck/saves', { preHandler: [requireAuth, requireSpydeck] }, async (req) => {
    await ensure();
    const r = await q(
      'select listing_id, data, created_at from spydeck_saves where seller_id=$1 order by created_at desc limit 500',
      [String(req.user.sub)]
    );
    return r.rows.map((row) => ({ ...(row.data || {}), listing_id: row.listing_id, saved_at: row.created_at }));
  });

  // Save/favorite a listing (idempotent by seller+listing).
  app.post('/api/spydeck/saves', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    await ensure();
    const b = req.body || {};
    const listingId = String(b.listing_id ?? b.listingId ?? '').trim();
    if (!listingId) { reply.code(400); return { error: 'listing_id required' }; }
    await q(
      `insert into spydeck_saves (seller_id, listing_id, data) values ($1,$2,$3)
       on conflict (seller_id, listing_id) do update set data=excluded.data`,
      [String(req.user.sub), listingId, b.data ? JSON.stringify(b.data) : JSON.stringify(b)]
    );
    return { ok: true };
  });

  // Remove a saved listing.
  app.delete('/api/spydeck/saves/:listingId', { preHandler: [requireAuth, requireSpydeck] }, async (req) => {
    await ensure();
    await q('delete from spydeck_saves where seller_id=$1 and listing_id=$2', [String(req.user.sub), String(req.params.listingId)]);
    return { ok: true };
  });

  // ── Uploaded ───────────────────────────────────────────────────────────────
  // Which researched listings you've already turned into a draft of your own.
  //
  // This lived in React state, so it survived exactly as long as the tab did: a
  // refresh and the Uploaded tab was empty again, with every card back to offering
  // "Make product" for something already published — the fastest way to end up with
  // duplicate drafts in a shop. Server-side and keyed by seller, like saves.
  //
  // `our_listing_id` is the draft WE created; published_listings records the reverse
  // direction (our listing → what it was built from) but nothing linked the source
  // research listing to it, so there was no way to answer "did I already make this?".
  app.get('/api/spydeck/uploads', { preHandler: [requireAuth, requireSpydeck] }, async (req) => {
    await ensure();
    const r = await q(
      'select listing_id, our_listing_id, url, data, created_at from spydeck_uploads where seller_id=$1 order by created_at desc limit 500',
      [String(req.user.sub)]
    );
    return r.rows.map((row) => ({
      ...(row.data || {}), listing_id: row.listing_id,
      our_listing_id: row.our_listing_id, our_url: row.url, uploaded_at: row.created_at,
    }));
  });

  app.post('/api/spydeck/uploads', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    await ensure();
    const b = req.body || {};
    const listingId = String(b.listing_id ?? b.listingId ?? '').trim();
    if (!listingId) { reply.code(400); return { error: 'listing_id required' }; }
    await q(
      `insert into spydeck_uploads (seller_id, listing_id, our_listing_id, url, data)
       values ($1,$2,$3,$4,$5)
       on conflict (seller_id, listing_id) do update set
         our_listing_id=excluded.our_listing_id, url=excluded.url, data=excluded.data`,
      [String(req.user.sub), listingId,
       b.our_listing_id != null ? String(b.our_listing_id) : null,
       b.url ? String(b.url) : null,
       b.data ? JSON.stringify(b.data) : JSON.stringify(b)]
    );
    return { ok: true };
  });

  app.delete('/api/spydeck/uploads/:listingId', { preHandler: [requireAuth, requireSpydeck] }, async (req) => {
    await ensure();
    await q('delete from spydeck_uploads where seller_id=$1 and listing_id=$2', [String(req.user.sub), String(req.params.listingId)]);
    return { ok: true };
  });

  // ── Competitor STORE research ────────────────────────────────────────────────
  // Public shop data via the app key — no seller OAuth, same access class as categories.
  // Search shops by name → shop cards (with product COUNT); open one → its full catalogue.

  // Search shops by name.
  app.get('/api/spydeck/shops', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    const qy = String((req.query || {}).q || '').trim();
    if (!qy) { reply.code(400); return { error: 'Enter a shop name to search.' }; }
    const r = await etsyPublicGet(`/shops?shop_name=${encodeURIComponent(qy)}&limit=25`);
    // 404 = no shop by that name: an empty result, not an error.
    if (!r.ok) {
      if (r.status === 404) return { shops: [] };
      reply.code(502); return { shops: [], error: (r.data && (r.data.error || r.data.message)) || `Etsy error (${r.status})` };
    }
    const rows = (r.data && Array.isArray(r.data.results)) ? r.data.results : [];
    return { shops: rows.map(shopCard).filter(Boolean) };
  });

  // SUGGEST shops by CATEGORY — Etsy has no "shops in category" call, so derive it: search
  // the category's top listings, aggregate the shops that appear (hit count = relevance),
  // then enrich the top ones with real stats (batched, to protect the rate limit).
  app.get('/api/spydeck/shops/by-category', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    const taxonomyId = String((req.query || {}).taxonomyId || '').trim();
    const term = String((req.query || {}).q || '').trim();
    if (!taxonomyId && !term) { reply.code(400); return { error: 'Pick a category to discover shops.' }; }
    let listings = [];
    try {
      const r = await searchListings(term, { taxonomyId: taxonomyId || undefined, limit: 48, sort: 'score' });
      listings = r.results || [];
    } catch (e) { reply.code(502); return { shops: [], error: e.message || 'Etsy search failed' }; }
    const byShop = new Map();
    for (const l of listings) {
      const sid = l.shop_id ? String(l.shop_id) : null;
      if (!sid) continue;
      const e = byShop.get(sid) || { shop_id: sid, shop_name: l.shop_name || null, hits: 0, image: l.thumb || l.image || null };
      e.hits += 1;
      if (!e.image) e.image = l.thumb || l.image || null;
      byShop.set(sid, e);
    }
    const top = Array.from(byShop.values()).sort((a, b) => b.hits - a.hits).slice(0, 15);
    const enriched = await inBatches(top, 5, async (s) => {
      const r = await etsyPublicGet(`/shops/${encodeURIComponent(s.shop_id)}`);
      const card = r.ok ? shopCard(r.data) : null;
      // Fall back to what the listing search already gave us if the shop lookup fails.
      return card || {
        shop_id: s.shop_id, shop_name: s.shop_name, title: null, icon: s.image,
        url: s.shop_name ? `https://www.etsy.com/shop/${encodeURIComponent(s.shop_name)}` : null,
        listings: null, favorers: null, reviews: null, rating: null, sales: null,
      };
    });
    return { shops: enriched.filter(Boolean) };
  });

  // Saved competitor shops — declared BEFORE /shops/:id so "saved" isn't captured as an id
  // (Fastify prefers static over parametric, but registering first makes it unambiguous).
  app.get('/api/spydeck/shops/saved', { preHandler: [requireAuth, requireSpydeck] }, async (req) => {
    await ensure();
    const r = await q('select shop_id, data, created_at from spydeck_saved_shops where seller_id=$1 order by created_at desc limit 500', [String(req.user.sub)]);
    return { shops: r.rows.map((row) => ({ ...(row.data || {}), shop_id: row.shop_id, saved_at: row.created_at })) };
  });
  app.post('/api/spydeck/shops/saved', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    await ensure();
    const b = req.body || {};
    const shopId = String(b.shop_id ?? '').trim();
    if (!shopId) { reply.code(400); return { error: 'shop_id required' }; }
    await q(`insert into spydeck_saved_shops (seller_id, shop_id, data) values ($1,$2,$3)
             on conflict (seller_id, shop_id) do update set data=excluded.data`,
      [String(req.user.sub), shopId, b.data ? JSON.stringify(b.data) : JSON.stringify(b)]);
    return { ok: true };
  });
  app.delete('/api/spydeck/shops/saved/:shopId', { preHandler: [requireAuth, requireSpydeck] }, async (req) => {
    await ensure();
    await q('delete from spydeck_saved_shops where seller_id=$1 and shop_id=$2', [String(req.user.sub), String(req.params.shopId)]);
    return { ok: true };
  });

  // One shop's public profile (product count + credibility).
  app.get('/api/spydeck/shops/:id', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    const r = await etsyPublicGet(`/shops/${encodeURIComponent(String(req.params.id))}`);
    if (!r.ok) { reply.code(r.status === 404 ? 404 : 502); return { error: r.status === 404 ? 'Shop not found' : ((r.data && (r.data.error || r.data.message)) || `Etsy error (${r.status})`) }; }
    const card = shopCard(r.data);
    if (!card) { reply.code(404); return { error: 'Shop not found' }; }
    return { shop: card };
  });

  // A shop's active listings, paginated — same card shape as search/trending (reuses gridRow).
  app.get('/api/spydeck/shops/:id/listings', { preHandler: [requireAuth, requireSpydeck] }, async (req, reply) => {
    const id = encodeURIComponent(String(req.params.id));
    const limit = Math.min(100, Math.max(1, parseInt((req.query || {}).limit, 10) || 48));
    const offset = Math.max(0, parseInt((req.query || {}).offset, 10) || 0);
    const r = await etsyPublicGet(`/shops/${id}/listings/active?includes=Images&limit=${limit}&offset=${offset}`);
    if (!r.ok) { reply.code(r.status === 404 ? 404 : 502); return { listings: [], count: 0, error: (r.data && (r.data.error || r.data.message)) || `Etsy error (${r.status})` }; }
    const raw = (r.data && Array.isArray(r.data.results)) ? r.data.results : [];
    // Inline images on listings/active are unreliable — this endpoint returned blank tiles.
    // Both the search grid and the own-shop path work around it with ONE batch call, so do
    // the same here: fetch the images for these listing ids and hand them to mapListing.
    // One extra GET (app key, read-only, ≤100 ids) — same safe pattern as everywhere else.
    const imgsById = {};
    const ids = raw.map((l) => l.listing_id).filter(Boolean);
    if (ids.length) {
      const b = await etsyPublicGet(`/listings/batch?listing_ids=${ids.slice(0, 100).join(',')}&includes=Images`);
      if (b.ok && b.data && Array.isArray(b.data.results)) {
        for (const l of b.data.results) {
          const arr = (l.images || []).map((im) => im && (im.url_570xN || im.url_fullxfull || im.url_300x300)).filter(Boolean);
          if (arr.length) imgsById[l.listing_id] = arr;
        }
      }
    }
    return { listings: raw.map((l) => gridRow(mapListing(l, imgsById))), count: r.data.count || raw.length };
  });

  // ── Pre-warm ─────────────────────────────────────────────────────────────────
  // Build the day's pool in the background so the FIRST visitor each day never eats the
  // cold 16-search build. Only actually rebuilds when the cache is missing/stale (so the
  // hourly tick is a cheap one-row read the other 23 hours). Any failure is swallowed —
  // the /trending route still rebuilds on miss, so this is an optimisation, never a
  // dependency. Timers are unref'd so they never hold the process open (or a boot-test).
  async function warmTrending() {
    try {
      await ensure();
      const today = new Date().toISOString().slice(0, 10);
      const c = await q("select value from settings where key='spydeck_trending'");
      const v = readSetting(c.rows[0]) || {};
      if (v.date === today && Array.isArray(v.products) && v.products.length && v.products[0] && v.products[0]._sold24 !== undefined) return;
      const feed = await buildTrending(0);
      if (feed.products && feed.products.length) {
        await q("insert into settings (key,value,updated_at) values ('spydeck_trending',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [JSON.stringify(feed)]).catch(() => {});
      }
    } catch { /* on-demand build still covers a miss */ }
  }
  const warmSoon = setTimeout(warmTrending, 25000);            // ~25s after boot
  const warmHourly = setInterval(warmTrending, 60 * 60 * 1000); // hourly → catches the date rollover well before peak
  warmSoon.unref?.(); warmHourly.unref?.();
}
