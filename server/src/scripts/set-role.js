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
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
