// spydeck.js — a seller can SAVE (favorite) research listings they find in SpyDeck.
// Server-authoritative so saves follow the seller across devices. The whole listing
// is stored as jsonb so the Saved view renders without re-hitting Etsy. Table is
// created idempotently at route-load (same pattern as order_designs / wallet_ledger).
import { q } from '../db.js';
import { searchListings, connectionFor, shopListings } from './etsy.js';
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
    .then(() => q(`create table if not exists settings (key text primary key, value text, updated_at timestamptz default now())`))
    .then(() => q(`create table if not exists spydeck_analysis (
      seller_id  text primary key,
      shop_id    text,
      data       jsonb,
      created_at timestamptz not null default now()
    )`))
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

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
];

// Build (and cache daily) the trending POOL. One pool is cached for everyone and
// then sliced per role at request time (see the route) — a seller and an admin want
// different cuts of the same day's data, and re-searching Etsy per role would burn
// the rate limit for no reason.
const POOL_SIZE = 120;      // was 30 — the feed ran dry after one screen
const NICHES_PER_DAY = 16;  // was 8 — a wider net across the rotating niche list
async function buildTrending() {
  const dayIndex = Math.floor(Date.now() / 86400000);
  const picks = [];
  for (let i = 0; i < NICHES_PER_DAY; i++) picks.push(TREND_NICHES[(dayIndex + i) % TREND_NICHES.length]);
  const batches = await Promise.all(picks.map((qy) => searchListings(qy, { limit: 48, sort: 'score' }).then((r) => r.results).catch(() => [])));
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
  return { date: new Date().toISOString().slice(0, 10), products, keywords };
}

// Slice the shared pool for who's asking. Same data, different priority — staff
// boards are the higher tier and get the winners handed to them; sellers browse.
//  - Staff (admin/warehouse): ALL trending first, then everything else. Nothing is
//    hidden, it's ordered — they still page on into the rest.
//  - Sellers: a MIX. The hot ones are interleaved 1-in-3 rather than front-loaded,
//    so a seller browses the feed instead of skimming the top and leaving.
function sliceFor(pool, staff) {
  const rows = Array.isArray(pool) ? pool : [];
  const isHot = (l) => l._trending || (l._sold24 || 0) > 5;
  const hot = rows.filter(isHot);
  const rest = rows.filter((l) => !isHot(l));

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
      const v = cached.rows[0] ? JSON.parse(cached.rows[0].value || '{}') : null;
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
    const serve = (feed) => ({
      date: feed.date, keywords: feed.keywords || [],
      products: sliceFor(feed.products, staff).map(gridRow),
    });

    try {
      const cached = await q("select value from settings where key='spydeck_trending'");
      if (cached.rows[0]) {
        const v = JSON.parse(cached.rows[0].value || '{}');
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
}
