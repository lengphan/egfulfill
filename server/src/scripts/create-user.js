// Create OR reset a user with a known password + role. Recovery / seeding tool
// (there are no pre-seeded accounts — the "Use demo" button only fills the form).
//
// Run inside the api container (WORKDIR /app):
//   docker compose exec api node src/scripts/create-user.js founder@egfulfill.app 'Nsx7-Quiet-Ledger!' admin
//   docker compose exec api node src/scripts/create-user.js ops@egops.com 'Trk4-Bright-Rail!' operator
//
// The password must clear the same rule as every other door (12+, mixed case, a digit, a
// symbol, and nothing from the email) — see passwordProblem() in src/auth.js.
//
// If the email already exists, its password + role are RESET to what you pass
// (handy when you've forgotten a password). Roles: seller|operator|warehouse|designer|admin
import { q, pool } from '../db.js';
import { hashPassword, passwordProblem } from '../auth.js';

const ROLES = ['seller', 'operator', 'warehouse', 'designer', 'admin'];
const [, , email, password, role = 'admin'] = process.argv;

if (!email || !password || !ROLES.includes(role)) {
  console.error('Usage: node src/scripts/create-user.js <email> <password> <' + ROLES.join('|') + '>');
  process.exit(1);
}
// The SAME rule as every HTTP door — this script writes users.password_hash too, and it
// can RESET an existing account's password, so its own floor (8, no complexity) was the
// weakest way into the whole policy.
const weak = passwordProblem(password, { email, name: email.split('@')[0] });
if (weak) { console.error(weak); process.exit(1); }

try {
  const hash = await hashPassword(password);
  const r = await q(
    `insert into users (email, password_hash, role, name)
     values ($1,$2,$3,$4)
     on conflict (email) do update set password_hash=excluded.password_hash, role=excluded.role
     returning id, email, role`,
    [email.toLowerCase(), hash, role, email.split('@')[0]]
  );
  console.log('User ready →', r.rows[0]);
  console.log('Log in at /login.html (staff) or /seller-login.html (seller) with that email + password.');
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
