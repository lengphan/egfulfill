// Create OR reset a user with a known password + role. Recovery / seeding tool
// (there are no pre-seeded accounts — the "Use demo" button only fills the form).
//
// Run inside the api container (WORKDIR /app):
//   docker compose exec api node src/scripts/create-user.js founder@egfulfill.app testpass123 admin
//   docker compose exec api node src/scripts/create-user.js ops@egops.com demo1234 operator
//
// If the email already exists, its password + role are RESET to what you pass
// (handy when you've forgotten a password). Roles: seller|operator|warehouse|designer|admin
import { q, pool } from '../db.js';
import { hashPassword } from '../auth.js';

const ROLES = ['seller', 'operator', 'warehouse', 'designer', 'admin'];
const [, , email, password, role = 'admin'] = process.argv;

if (!email || !password || !ROLES.includes(role)) {
  console.error('Usage: node src/scripts/create-user.js <email> <password> <' + ROLES.join('|') + '>');
  process.exit(1);
}
if (password.length < 8) { console.error('Password must be at least 8 characters'); process.exit(1); }

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
