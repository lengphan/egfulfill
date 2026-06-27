// User management API — ADMIN ONLY. Backs the "Users" admin screen so you
// add/promote/reset/delete accounts from the app instead of editing the DB.
import { q } from '../db.js';
import { hashPassword, isStaff } from '../auth.js';

const ROLES = ['seller', 'operator', 'admin', 'warehouse', 'designer'];

export function usersRoutes(app, requireAdmin, requireAuth) {
  // Lighter, STAFF-readable seller directory (any non-seller role). Backs the
  // seller-adjust panel on the factory boards (warehouse/admin) so a balance
  // adjustment resolves to a real account. Minimal fields only — no password,
  // no cross-seller PII beyond what staff already see on orders.
  if (requireAuth) {
    app.get('/api/sellers', { preHandler: requireAuth }, async (req, reply) => {
      if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
      const r = await q(
        `select id, name, store_name, email, active from users
          where role='seller' order by coalesce(store_name, name, email) asc`);
      return r.rows;
    });
  }

  // Soft-disable flag. Deactivating keeps the user row (so seller_id stays on all
  // their orders — nothing is orphaned), but blocks login. schema.sql sets this on
  // fresh installs; this alter covers existing databases.
  q('alter table users add column if not exists active boolean not null default true').catch(() => {});

  app.get('/api/users', { preHandler: requireAdmin }, async () => {
    const r = await q('select id, email, name, role, store_name, active, created_at from users order by created_at desc');
    return r.rows;   // never returns password_hash
  });

  app.post('/api/users', { preHandler: requireAdmin }, async (req, reply) => {
    const { email, password, role = 'seller', name = '' } = req.body || {};
    if (!email || !password) { reply.code(400); return { error: 'Email and password are required' }; }
    if (password.length < 8) { reply.code(400); return { error: 'Password must be at least 8 characters' }; }
    if (!ROLES.includes(role)) { reply.code(400); return { error: 'Invalid role' }; }
    try {
      const hash = await hashPassword(password);
      const r = await q(
        'insert into users (email, password_hash, role, name) values ($1,$2,$3,$4) returning id, email, name, role, created_at',
        [email.toLowerCase(), hash, role, name]
      );
      return r.rows[0];
    } catch (e) {
      reply.code(400);
      return { error: e.code === '23505' ? 'That email already exists' : e.message };
    }
  });

  app.patch('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { role, password, name, active } = req.body || {};
    const sets = [], vals = []; let n = 1;
    if (role) { if (!ROLES.includes(role)) { reply.code(400); return { error: 'Invalid role' }; } sets.push(`role=$${n++}`); vals.push(role); }
    if (name != null) { sets.push(`name=$${n++}`); vals.push(name); }
    if (typeof active === 'boolean') {
      if (!active && req.params.id === req.user.sub) { reply.code(400); return { error: "You can't deactivate your own account" }; }
      sets.push(`active=$${n++}`); vals.push(active);
    }
    if (password) { if (password.length < 8) { reply.code(400); return { error: 'Password too short' }; } sets.push(`password_hash=$${n++}`); vals.push(await hashPassword(password)); }
    if (!sets.length) return { ok: true };
    vals.push(req.params.id);
    await q(`update users set ${sets.join(',')} where id=$${n}`, vals);
    return { ok: true };
  });

  app.delete('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (req.params.id === req.user.sub) { reply.code(400); return { error: "You can't delete your own account" }; }
    await q('delete from users where id=$1', [req.params.id]);
    return { ok: true };
  });
}
