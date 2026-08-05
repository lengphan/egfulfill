// Auth: bcrypt password hashing + JWT tokens. Replaces Supabase Auth.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q, softQ } from './db.js';

// FAIL CLOSED. This used to fall back to a literal 'dev-secret-change-me', which is
// public in this repo — so a deployment that simply forgot JWT_SECRET would happily
// verify a token anyone could mint with {sub:<any id>, role:'admin'}, and nothing logged
// a warning. In production an unset secret must stop the process, not silently accept
// forged admins. Development keeps a working default so `node src/index.js` still runs,
// and says loudly which one it is.
const SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (s && s.trim()) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set. Refusing to start: every token would be forgeable with a secret published in this repository.');
  }
  console.warn('[auth] JWT_SECRET unset — using an INSECURE development default. Never run this in production.');
  return 'dev-secret-change-me';
})();

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

// Deliberately permissive — this rejects "linh", not exotic-but-valid addresses. The
// only job is to stop a NON-address being stored in the email column.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

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

/**
 * SLIDING SESSIONS. A token lives 7 days and nothing ever renewed it, so every signed-in
 * person was silently logged out a week after signing in — mid-task, with no warning, and
 * (until the client learned to handle 401) into an app full of "Not signed in" panels.
 * Expiry is meant to bound an ABANDONED session, not to evict someone who is still working.
 *
 * So a still-valid token that is over halfway through its life is reissued on the next
 * request. Someone using the product never reaches the wall; someone who stops using it
 * still ages out on the original schedule, because renewal only happens on a real request.
 *
 * Returns a fresh token, or null when the current one has plenty of life left — the caller
 * only sets a header when there is something to set.
 */
export function renewIfStale(claims) {
  if (!claims || !claims.exp || !claims.sub) return null;
  const secondsLeft = claims.exp - Math.floor(Date.now() / 1000);
  const HALF_LIFE = 3.5 * 24 * 3600;
  if (secondsLeft <= 0 || secondsLeft > HALF_LIFE) return null;
  return sign({ id: claims.sub, role: claims.role, email: claims.email });
}

export async function signup({ email, password, role = 'seller', name = '', store_name = '', username = '' }) {
  if (!email || !password) throw new Error('Email and password are required');
  // A real address, not just a non-empty string.
  //
  // Signup accepted anything, and the form said "Email/Username", so someone could
  // register as "linh" and have it stored in the email column. Two consequences, both
  // silent: password reset can never reach them, and — since login routes an
  // identifier with no '@' to the USERNAME column — they could never sign in again
  // either. The account was unreachable from the moment it was created.
  if (!EMAIL_RE.test(String(email).trim())) {
    throw new Error('Enter a real email address — it\'s how you reset your password.');
  }
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
  // An identifier CONTAINING '@' is an email and only ever matches the email column —
  // that's what stops a username being used to squat or probe a real address.
  //
  // An identifier without '@' tries username first, then falls back to email. The
  // fallback exists because staff accounts provisioned before usernames existed have a
  // bare NAME in the email column ('linh', 'uyen', 'abdul'), and routing strictly to
  // the username column locked every one of them out of their own account. A string
  // with no '@' cannot collide with a valid address, so the fallback costs nothing.
  let r = looksLikeEmail(id)
    ? await q('select * from users where lower(email)=$1', [id])
    : await softQ('login by username', 'select * from users where lower(username)=$1', [id]);
  if (!r.rows[0] && !looksLikeEmail(id)) {
    r = await softQ('login by email (username fallback)', 'select * from users where lower(email)=$1', [id]);
  }
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
    throw new Error('Invalid email or password');
  }
  if (u.active === false) throw new Error('This account has been deactivated. Contact an admin.');
  const safe = { id: u.id, email: u.email, username: u.username || null, role: u.role, name: u.name, avatar_emoji: u.avatar_emoji || null, avatar_color: u.avatar_color || null, notify_sound: u.notify_sound !== false, plan: u.plan || 'starter', spydeck_addon: u.spydeck_addon === true };
  // A team member inherits their leader's plan — they never bought one themselves.
  Object.assign(safe, await resolveEntitlements(safe));
  return { user: safe, token: sign(safe) };
}

export const isStaff = (user) => !!user && ['operator', 'admin', 'warehouse', 'designer'].includes(user.role);

/**
 * Who may act ON another user's account — set a password, deactivate, promote.
 *
 * Deliberately NARROWER than isStaff, which admits operator and designer. Anything that
 * writes users.password_hash is an account takeover in one call, so it has to be gated
 * on this rather than on "is staff": /api/auth/forgot is public and will happily open a
 * pending reset row for an admin, so a resolve route open to every staff role turned the
 * lowest one into admin. Warehouse is included because it shares the day-to-day chores
 * (someone forgot a password), but callers must still refuse an admin TARGET unless the
 * caller is admin — see requireNotAdminTarget in users.js/password-reset.js.
 */
export const canManageUsers = (user) => !!user && (user.role === 'admin' || user.role === 'warehouse');

/**
 * Who may move money — arbitrary ledger writes, transfers, refunds, pricing.
 *
 * Same membership as canManageUsers today but a SEPARATE policy, so one can be widened
 * without silently widening the other. Kept here because private copies of this exact
 * predicate had already appeared in order_refunds.js (canRefund) and design_files.js
 * (canPrice), while wallet.js gated on the much broader isStaff — which is how operator
 * and designer ended up able to credit any account.
 */
export const canMoveMoney = (user) => !!user && (user.role === 'admin' || user.role === 'warehouse');

/**
 * Entitlements a user actually has, INCLUDING ones inherited from their team leader.
 *
 * A team member's own row is always 'starter' with no add-ons — they never buy anything;
 * the leader does. Reading the member's own columns meant a teammate on a Pro account was
 * shown "SpyDeck is a research add-on, $9/mo" for something the leader had already paid
 * for, and would have been charged twice for one seat.
 *
 * The leader's plan is the ceiling: we take the better of the two rather than replacing,
 * so someone who happens to hold their own subscription is never downgraded by joining
 * a team. Only an ACTIVE membership counts — a pending invite grants nothing.
 *
 * Returns { plan, spydeck_addon, inherited_from } — inherited_from is the owner id when
 * the entitlement came from the team, else null, so the UI can say WHY it's unlocked.
 */
const PLAN_RANK = { starter: 0, pro: 1, enterprise: 2 };
export async function resolveEntitlements(user) {
  const own = { plan: user.plan || 'starter', spydeck_addon: user.spydeck_addon === true, inherited_from: null };
  if (!user || isStaff(user) || !user.email) return own;
  try {
    const r = await q(
      `select u.id as owner_id, u.plan, u.spydeck_addon
         from team_members t join users u on u.id::text = t.owner_id
        where lower(t.email)=lower($1) and t.status='active' limit 1`, [user.email]);
    const o = r.rows[0];
    if (!o) return own;
    const ownerPlan = o.plan || 'starter';
    const better = (PLAN_RANK[ownerPlan] ?? 0) > (PLAN_RANK[own.plan] ?? 0) ? ownerPlan : own.plan;
    const addon = own.spydeck_addon || o.spydeck_addon === true;
    // Only claim inheritance when the team actually added something.
    const gained = better !== own.plan || (addon && !own.spydeck_addon);
    return { plan: better, spydeck_addon: addon, inherited_from: gained ? String(o.owner_id) : null };
  } catch (e) {
    return own;   // never let a billing lookup block sign-in
  }
}

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
  Object.assign(safe, await resolveEntitlements(safe));
  return { user: safe, token: sign(safe) };
}
