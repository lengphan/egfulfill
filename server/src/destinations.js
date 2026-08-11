import { q } from './db.js';

/**
 * WHERE A PRODUCT CAN BE PUBLISHED — one shop, not one platform.
 *
 * Every publish route used to resolve its own destination the same way:
 *
 *   select * from platform_connections where platform=$1 and connected_by=$2
 *   order by created_at limit 1
 *
 * The oldest connection won, silently. `platform_connections` is unique on
 * (platform, shop_id) and carries `connected_by` per user, so TWO Etsy shops for one
 * seller has always been two perfectly good rows — there was simply no way to say which
 * one to write to, and no way to tell afterwards which one had been written to.
 *
 * So a destination is a CONNECTION, and the platform is just how that row is labelled.
 * The publish routes take a `connection_id`; this module resolves it and — the part that
 * matters — proves the caller may use it before any token is handed over.
 */

/** The extra fields a platform needs beyond the shared title/description/price/images.
 *  Etsy borrows its taxonomy and shipping profile from the shop's own listings, and
 *  Shopify needs nothing, so only TikTok appears here. */
export const PLATFORM_EXTRA_FIELDS = {
  tiktok: ['category_id', 'warehouse_id', 'package_weight'],
  etsy: [],
  shopify: [],
};

/** Publishing is implemented for these three; other rows (ads accounts, future channels)
 *  are connections but not destinations, and must not appear as somewhere to publish. */
export const PUBLISHABLE_PLATFORMS = ['etsy', 'tiktok', 'shopify'];

const isStaff = (user) => !!(user && user.role && user.role !== 'seller');

/**
 * Every shop this caller may publish to.
 *
 * A seller sees their OWN connections. Staff see the connections that are not owned by a
 * seller — the factory's own shops — never a seller's, which is the same exclusion
 * tiktok.js already made and etsy.js did not. Writing into a shop you don't own is what
 * §2.6 forbids, and "the oldest Etsy row in the table" was one seller connection away
 * from being someone else's shop.
 */
export async function destinationsFor(user) {
  const rows = (await q(
    isStaff(user)
      ? `select pc.* from platform_connections pc
           where pc.platform = any($1)
             and not exists (select 1 from users u where u.id = pc.connected_by and u.role = 'seller')
           order by pc.platform, pc.created_at`
      : `select * from platform_connections
           where platform = any($1) and connected_by = $2
           order by platform, created_at`,
    isStaff(user) ? [PUBLISHABLE_PLATFORMS] : [PUBLISHABLE_PLATFORMS, user.sub]
  )).rows;
  return rows;
}

/**
 * One connection by id, or null — and null covers "doesn't exist" and "not yours"
 * deliberately. Distinguishing them would let a caller probe for the existence of other
 * sellers' shops by id, which is the same reason the public catalogue 404s an unpublished
 * product rather than saying it's unpublished.
 */
export async function connectionById(platform, id, user) {
  if (!id) return null;
  // A malformed uuid must not reach Postgres as a cast error — that would 500 where the
  // honest answer is "no such destination".
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) return null;
  const r = await q(
    isStaff(user)
      ? `select pc.* from platform_connections pc
           where pc.id = $1 and pc.platform = $2
             and not exists (select 1 from users u where u.id = pc.connected_by and u.role = 'seller')`
      : `select * from platform_connections where id = $1 and platform = $2 and connected_by = $3`,
    isStaff(user) ? [id, platform] : [id, platform, user.sub]
  );
  return r.rows[0] || null;
}

/**
 * The connection a publish should use: the one asked for, else the caller's default.
 *
 * `fallback` is the route's own existing resolver, so omitting connection_id behaves
 * exactly as it did before this module existed — every caller in the wild keeps working
 * while the UI catches up.
 *
 * An UNRESOLVABLE connection_id is an error, never a silent fallback. Quietly publishing
 * to a different shop than the one that was named is the failure this whole module exists
 * to remove.
 */
export async function resolveDestination(platform, body, user, fallback) {
  const wanted = body && (body.connection_id || body.connectionId);
  if (wanted) {
    const conn = await connectionById(platform, wanted, user);
    if (!conn) {
      const e = new Error('That shop isn\'t connected to your account.');
      e.status = 400;
      throw e;
    }
    return conn;
  }
  return fallback ? await fallback(user) : null;
}
