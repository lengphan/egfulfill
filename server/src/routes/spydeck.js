// spydeck.js — a seller can SAVE (favorite) research listings they find in SpyDeck.
// Server-authoritative so saves follow the seller across devices. The whole listing
// is stored as jsonb so the Saved view renders without re-hitting Etsy. Table is
// created idempotently at route-load (same pattern as order_designs / wallet_ledger).
import { q } from '../db.js';

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists spydeck_saves (
    seller_id   text not null,
    listing_id  text not null,
    data        jsonb,
    created_at  timestamptz not null default now(),
    primary key (seller_id, listing_id)
  )`).catch((e) => { _ready = null; throw e; });
  return _ready;
}

export function spydeckRoutes(app, requireAuth) {
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
