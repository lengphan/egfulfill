// Auth: bcrypt password hashing + JWT tokens. Replaces Supabase Auth.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q } from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function sign(u) {
  return jwt.sign({ sub: u.id, role: u.role, email: u.email }, SECRET, { expiresIn: '7d' });
}
export function verify(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

export async function signup({ email, password, role = 'seller', name = '', store_name = '' }) {
  if (!email || !password) throw new Error('Email and password are required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  // Staff roles can't be self-assigned via public signup — public signup is ALWAYS
  // 'seller'. Factory staff (operator/warehouse/designer/admin) are provisioned in
  // the DB via src/scripts/set-role.js. login() reads the real role back from the DB.
  const safeRole = 'seller';
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await q(
      `insert into users (email, password_hash, role, name, store_name)
       values ($1,$2,$3,$4,$5) returning id, email, role, name, avatar_emoji, avatar_color`,
      [email.toLowerCase(), hash, safeRole, name, store_name]
    );
    const u = r.rows[0];
    return { user: u, token: sign(u) };
  } catch (e) {
    if (e.code === '23505') throw new Error('That email is already registered');
    throw e;
  }
}

export async function login({ email, password }) {
  const r = await q('select * from users where email=$1', [(email || '').toLowerCase()]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
    throw new Error('Invalid email or password');
  }
  if (u.active === false) throw new Error('This account has been deactivated. Contact an admin.');
  const safe = { id: u.id, email: u.email, role: u.role, name: u.name, avatar_emoji: u.avatar_emoji || null, avatar_color: u.avatar_color || null };
  return { user: safe, token: sign(safe) };
}

export const isStaff = (user) => !!user && ['operator', 'admin', 'warehouse', 'designer'].includes(user.role);

// Reusable bcrypt hasher for admin-created users / password resets.
export async function hashPassword(plain) { return bcrypt.hash(plain, 10); }

// Sign in with Google: the caller has already VERIFIED the Google ID token (see
// the /api/auth/google route). Here we just find-or-create the user by email and
// issue our own app JWT. New Google users are sellers (staff get promoted later).
export async function googleAuth({ email, name = '' }) {
  if (!email) throw new Error('Google account has no email');
  const lc = email.toLowerCase();
  let r = await q('select * from users where email=$1', [lc]);
  let u = r.rows[0];
  if (!u) {
    const hash = await bcrypt.hash(crypto.randomUUID(), 10);   // random; Google users sign in via Google
    const ins = await q(
      'insert into users (email, password_hash, role, name) values ($1,$2,$3,$4) returning id, email, role, name, active, avatar_emoji, avatar_color',
      [lc, hash, 'seller', name]
    );
    u = ins.rows[0];
  }
  if (u.active === false) throw new Error('This account has been deactivated. Contact an admin.');
  const safe = { id: u.id, email: u.email, role: u.role, name: u.name, avatar_emoji: u.avatar_emoji || null, avatar_color: u.avatar_color || null };
  return { user: safe, token: sign(safe) };
}
