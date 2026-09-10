// Shared rules about platform_connections, so the three exchange routes agree.
import { q } from './db.js';

/**
 * IS THIS SHOP ALREADY SOMEBODY ELSE'S?
 *
 * platform_connections is `unique (platform, shop_id)` and every exchange upserts with
 * `connected_by = excluded.connected_by`, so connecting a shop that is already connected
 * SILENTLY MOVES IT to whoever just authorised. Measured on a scratch database with the
 * real upsert: an admin's live Shopify store, connected once from a new seller account,
 * flipped `connected` to false for admin, operator AND warehouse in the same instant —
 * they read the staff view, which asks for connections not owned by a seller, so the row
 * left every staff screen at once. It also reset last_sync_at, forcing a backfill that
 * would land any not-yet-imported order on the new owner.
 *
 * Nothing anywhere said so. The seller pressed Connect on their own shop, which is the
 * most ordinary thing on that screen, and the factory's sync stopped.
 *
 * So a takeover is REFUSED rather than warned about. The legitimate move — a shop really
 * is changing hands — is Disconnect on the old account and then Connect, which is two
 * deliberate acts by someone who can see both. There is deliberately no override flag:
 * the exchange is called from oauth-callback.html, a frozen legacy file that cannot grow
 * a confirmation step, so an override would have to be a query parameter nobody sees.
 *
 * WHO OWNS IT is named for STAFF only. A seller learning which other account holds a shop
 * is a seller learning about another seller, which is the one thing the boards are careful
 * about everywhere else — they get the fact, not the identity.
 *
 * Returns null when the shop is free or already this caller's (a reconnect to refresh an
 * expired token is the same account and must keep working).
 */
export async function takenByAnother(platform, shopId, user) {
  if (!shopId) return null;
  const r = await q(
    `select pc.connected_by, u.email, u.role, coalesce(nullif(u.store_name,''), nullif(u.name,''), u.email) as label
       from platform_connections pc
       left join users u on u.id = pc.connected_by
      where pc.platform=$1 and pc.shop_id=$2`,
    [platform, String(shopId)]);
  const row = r.rows[0];
  if (!row) return null;
  // Nobody owns it (the account was deleted — connected_by is `on delete set null`), so
  // there is no one to take it from and no one to ask.
  if (!row.connected_by) return null;
  if (String(row.connected_by) === String(user.sub)) return null;

  const staff = !!(user.role && user.role !== 'seller');
  const who = staff ? `${row.label} (${row.email})` : 'another account';
  return {
    ownerId: row.connected_by,
    error: `That shop is already connected to ${who}. Disconnect it there first, then connect it here — otherwise connecting would move the shop off that account and stop its order sync.`,
  };
}
