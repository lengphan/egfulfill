// Auth: bcrypt password hashing + JWT tokens. Replaces Supabase Auth.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q } from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ── Usernames ────────────────────────────────────────────────────────────────
// Sign-in accepts an email OR a username. The charset deliberately EXCLUDES '@',
// which is what keeps the two namespaces from ever overlapping: a username can
// never be shaped like someone else's email, so "is this an email or a username?"
// is decidable from the string alone and nobody can squat an address they don't own.
// Stored lower-case; matched lower-case.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
export function normalizeUsername(raw) {
  const u = String(raw || '').trim().toLowerCase();
  if (!u) return null;
  if (u.includes('@')) throw new Error('Usernames cannot contain @ — that looks like an email address');
  if (!USERNAME_RE.test(u)) throw new Error('Username must be 3–30 characters: letters, numbers, dot, dash or underscore');
  return u;
}
const looksLikeEmail = (s) => String(s || '').includes('@');

// Added idempotently at boot — an existing deployment's users table predates this.
// The unique index is case-insensitive so "Linh" and "linh" can't both be taken.
let _usernameReady = null;
export function ensureUsernameColumn() {
  if (_usernameReady) return _usernameReady;
  _usernameReady = q('alter table users add column if not exists username text')
    .then(() => q('create unique index if not exists users_username_lower_idx on users (lower(username)) where username is not null'))
    .catch((e) => { _usernameReady = null; throw e; });
  return _usernameReady;
}

function sign(u) {
  return jwt.sign({ sub: u.id, role: u.role, email: u.email }, SECRET, { expiresIn: '7d' });
}
export function verify(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

export async function signup({ email, password, role = 'seller', name = '', store_name = '', username = '' }) {
  if (!email || !password) throw new Error('Email and password are required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  // Optional at signup — throws with a readable message if the shape is wrong.
  const uname = username ? normalizeUsername(username) : null;
  await ensureUsernameColumn().catch(() => {});
  // Staff roles can't be self-assigned via public signup — public signup is ALWAYS
  // 'seller'. Factory staff (operator/warehouse/designer/admin) are provisioned in
  // the DB via src/scripts/set-role.js. login() reads the real role back from the DB.
  const safeRole = 'seller';
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await q(
      `insert into users (email, password_hash, role, name, store_name, username)
       values ($1,$2,$3,$4,$5,$6) returning id, email, username, role, name, avatar_emoji, avatar_color`,
      [email.toLowerCase(), hash, safeRole, name, store_name, uname]
    );
    const u = r.rows[0];
    return { user: u, token: sign(u) };
  } catch (e) {
    // Two unique constraints now — say which one actually collided rather than
    // blaming the email for a username clash.
    if (e.code === '23505') {
      throw new Error(String(e.detail || e.constraint || '').includes('username')
        ? 'That username is already taken'
        : 'That email is already registered');
    }
    throw e;
  }
}

export async function login({ email, username, password }) {
  // One field on the form carries either. `email` is the historical param name and
  // stays the wire format, so old clients keep working; `username` is accepted too.
  const id = String(username || email || '').trim().toLowerCase();
  if (!id) throw new Error('Email or username is required');
  await ensureUsernameColumn().catch(() => {});
  // Matched against exactly ONE column depending on the shape — never "email or
  // username" across both, so a username can't be used to probe for an email.
  const r = looksLikeEmail(id)
    ? await q('select * from users where email=$1', [id])
    : await q('select * from users where lower(username)=$1', [id]).catch(() => ({ rows: [] }));
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
    throw new Error('Invalid email or password');
  }
  if (u.active === false) throw new Error('This account has been deactivated. Contact an admin.');
  const safe = { id: u.id, email: u.email, username: u.username || null, role: u.role, name: u.name, avatar_emoji: u.avatar_emoji || null, avatar_color: u.avatar_color || null, notify_sound: u.notify_sound !== false, plan: u.plan || 'starter', spydeck_addon: u.spydeck_addon === true };
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
  const safe = { id: u.id, email: u.email, username: u.username || null, role: u.role, name: u.name, avatar_emoji: u.avatar_emoji || null, avatar_color: u.avatar_color || null, notify_sound: u.notify_sound !== false, plan: u.plan || 'starter', spydeck_addon: u.spydeck_addon === true };
  return { user: safe, token: sign(safe) };
}
