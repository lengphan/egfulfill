// spydeck.js — a seller can SAVE (favorite) research listings they find in SpyDeck.
// Server-authoritative so saves follow the seller across devices. The whole listing
// is stored as jsonb so the Saved view renders without re-hitting Etsy. Table is
// created idempotently at route-load (same pattern as order_designs / wallet_ledger).
import { q } from '../db.js';
import { searchListings } from './etsy.js';

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
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

// Estimated units sold in the last 24h — same heuristic as the client (eg-scout _est):
// favorites × 3.5 = lifetime sales, ÷ listing age in days.
function estSold24(l) {
  const fav = l.num_favorers || 0;
  const created = l.created || 0;
  const nowS = Date.now() / 1000;
  const ageDays = created ? Math.max(1, (nowS - created) / 86400) : 45;
  const totalSold = Math.round(fav * 3.5) || fav;
  return Math.max(0, Math.round(totalSold / ageDays));
}

// Rotating niche pool — several searched each day so the feed refreshes daily.
const TREND_NICHES = [
  'custom name necklace', 'comfort colors tee', 'mama sweatshirt', 'retro groovy tee',
  'birth flower necklace', 'pet portrait sweatshirt', 'personalized gift', 'bachelorette shirt',
  'teacher gift', 'vintage aesthetic sweatshirt', 'embroidered crewneck', 'coquette',
  'minimalist jewelry', 'boho wall art', 'funny shirt', 'monogram tumbler',
  'trendy sweatshirt', 'aesthetic wall art', 'custom pet', 'personalized jewelry',
];

// Build (and cache daily) the trending feed: 30 products est. high 24h sales + 30 keywords.
async function buildTrending() {
  const dayIndex = Math.floor(Date.now() / 86400000);
  // Pick 8 niches for today, rotating by day, so we have enough hot listings for 30.
  const picks = [];
  for (let i = 0; i < 8; i++) picks.push(TREND_NICHES[(dayIndex + i) % TREND_NICHES.length]);
  const batches = await Promise.all(picks.map((qy) => searchListings(qy, { limit: 48, sort: 'score' }).then((r) => r.results).catch(() => [])));
  const byId = new Map();
  for (const list of batches) for (const l of list) if (l.listing_id && !byId.has(l.listing_id)) byId.set(l.listing_id, l);
  const all = Array.from(byId.values()).map((l) => ({ ...l, _sold24: estSold24(l) }));
  all.sort((a, b) => b._sold24 - a._sold24);
  const hot = all.filter((l) => l._sold24 > 10);
  const products = (hot.length >= 30 ? hot : all).slice(0, 30).map(({ _sold24, ...l }) => l);
  // Top 30 keywords from the hot set's tags.
  const counts = {};
  for (const l of (hot.length ? hot : all).slice(0, 80)) for (const t of (l.tags || [])) {
    const k = String(t).trim().toLowerCase();
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  const keywords = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t);
  return { date: new Date().toISOString().slice(0, 10), products, keywords };
}

export function spydeckRoutes(app, requireAuth) {
  // Daily trending feed — 10 products (est. >10 sold/24h) + 10 keywords. Cached in
  // `settings` for the day so we hit Etsy a few times per DAY, not per visitor. Shared
  // by every SpyDeck (seller + factory). Signed-in users only.
  app.get('/api/spydeck/trending', { preHandler: requireAuth }, async (req, reply) => {
    await ensure();
    const today = new Date().toISOString().slice(0, 10);
    try {
      const cached = await q("select value from settings where key='spydeck_trending'");
      if (cached.rows[0]) {
        const v = JSON.parse(cached.rows[0].value || '{}');
        if (v && v.date === today && Array.isArray(v.products) && v.products.length) return v;
      }
    } catch { /* rebuild below */ }
    try {
      const feed = await buildTrending();
      await q("insert into settings (key,value,updated_at) values ('spydeck_trending',$1,now()) on conflict (key) do update set value=excluded.value, updated_at=now()", [JSON.stringify(feed)]).catch(() => {});
      return feed;
    } catch (e) {
      reply.code(502); return { error: e.message || 'Could not build the trending feed', products: [], keywords: [] };
    }
  });

  // List the seller's saved listings (newest first).
  app.get('/api/spydeck/saves', { preHandler: requireAuth }, async (req) => {
    await ensure();
    const r = await q(
      'select listing_id, data, created_at from spydeck_saves where seller_id=$1 order by created_at desc limit 500',
      [String(req.user.sub)]
    );
    return r.rows.map((row) => ({ ...(row.data || {}), listing_id: row.listing_id, saved_at: row.created_at }));
  });

  // Save/favorite a listing (idempotent by seller+listing).
  app.post('/api/spydeck/saves', { preHandler: requireAuth }, async (req, reply) => {
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
  app.delete('/api/spydeck/saves/:listingId', { preHandler: requireAuth }, async (req) => {
    await ensure();
    await q('delete from spydeck_saves where seller_id=$1 and listing_id=$2', [String(req.user.sub), String(req.params.listingId)]);
    return { ok: true };
  });
}
