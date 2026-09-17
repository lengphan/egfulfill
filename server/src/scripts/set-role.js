// Promote/seed a STAFF account's role directly in the DB. Public signup always
// creates 'seller' accounts (auth.js); factory staff are provisioned with this.
//
// Run inside the api container (WORKDIR /app):
//   docker compose exec api node src/scripts/set-role.js someone@egops.com admin
//   docker compose exec api node src/scripts/set-role.js ops@egops.com operator
//
// Roles: seller | operator | warehouse | designer | admin
//   - operator/warehouse/designer/admin are STAFF (see all orders incl. factory).
//   - seller can only see/act on their own non-factory orders.
import { q, pool } from '../db.js';
import { reclassifyFactoryOrders } from '../factory-orders.js';

const ROLES = ['seller', 'operator', 'warehouse', 'designer', 'admin'];
const [, , email, role] = process.argv;

if (!email || !ROLES.includes(role)) {
  console.error('Usage: node src/scripts/set-role.js <email> <' + ROLES.join('|') + '>');
  process.exit(1);
}

try {
  const r = await q(
    'update users set role=$1 where lower(email)=lower($2) returning id, email, role, name',
    [role, email]
  );
  if (!r.rows[0]) {
    console.error('No user found with email: ' + email + ' (they must sign up first)');
    process.exit(1);
  }
  console.log('Role updated →', r.rows[0]);
  /**
   * THE ORDERS THIS ACCOUNT ALREADY OWNS MOVE WITH IT.
   *
   * `orders.factory_order` is derived from the owner's role, so changing a role misfiles
   * every order that account already has: a promoted seller's orders stay flagged as a
   * seller's, and the factory queue — which admits an order only when it is factory-owned,
   * already pushed, or owned by staff — will not show them. That is not hypothetical; it is
   * what happened to 581 orders on a shop connected by an account public signup had made a
   * seller, promoted four days later. Nobody was told, because the only thing that fixes it
   * ran at API start under a silent catch.
   *
   * A role change is the ONE event that can invalidate the flag, so it is corrected here,
   * at the moment it goes stale, and the count is printed with the new role.
   */
  const n = await reclassifyFactoryOrders(`role change for ${r.rows[0].email}`);
  if (n === null) console.error('WARNING: could not reclassify this account\'s existing orders — run it again or restart the API.');
  else console.log(`Existing orders reclassified: ${n}`);
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
