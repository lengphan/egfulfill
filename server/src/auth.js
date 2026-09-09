// Auth: bcrypt password hashing + JWT tokens. Replaces Supabase Auth.
import crypto from 'node:crypto';
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
//
// THREE characters. This was raised to twelve to match passwordProblem(), on the reasoning
// that a username is half of a credential pair because sign-in accepts it in place of the
// email — and that is a category error. A username is an IDENTIFIER, not a secret. It is
// printed on the account, it is how people are addressed, and it is chosen to be recognised;
// an email is equally a way in and nobody has ever required a twelve-character local part.
// What protects the pair is the password's floor and complexity, which are untouched.
//
// It also cost the thing usernames are FOR. A seller signing up as their shop — "babygoods"
// — was refused and told to pad it, which produces babygoods1234: worse to read, no harder
// to guess, and no longer their name.
//
// The load-bearing rules are the other two and they stay: no "@", so a username can never be
// shaped like someone else's email and the two namespaces stay decidable from the string
// alone; and the charset, so it is typeable.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
// Kept as its own name because the CALLERS mean different things — this one is for an
// identifier that already exists and is being moved rather than chosen (the email repair in
// index.js, where an account whose "email" was really a username gets migrated into the
// username column). Identical to the above now that the floors agree; it stops being a
// no-op the moment either rule moves again.
const LEGACY_USERNAME_RE = USERNAME_RE;
export function normalizeUsername(raw, { grandfather = false } = {}) {
  const u = String(raw || '').trim().toLowerCase();
  if (!u) return null;
  if (u.includes('@')) throw new Error('Usernames cannot contain @ — that looks like an email address');
  if (!(grandfather ? LEGACY_USERNAME_RE : USERNAME_RE).test(u)) {
    throw new Error('Usernames are 3–30 characters: letters, numbers, dot, dash or underscore');
  }
  return u;
}
const looksLikeEmail = (s) => String(s || '').includes('@');

// Deliberately permissive — this rejects "linh", not exotic-but-valid addresses. The
// only job is to stop a NON-address being stored in the email column.
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

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

/**
 * EMAIL CONFIRMATION — the columns, the code, and the check.
 *
 * WHAT THIS IS FOR, because it is easy to build the wrong thing: confirmation proves the
 * ADDRESS is deliverable and belongs to the person who typed it. It is not a control on the
 * account — the password is that. It is a control on the address, and it matters here more
 * than on most products because a seller's wallet-low warning, payout confirmation and
 * password reset all go to it. An address with a typo in it fails silently, and the first
 * anyone hears of it is an order that stopped for want of funds nobody was told about.
 *
 * A CODE, NOT A LINK. People sign up on a laptop and read email on a phone; a link assumes
 * one device and a code crosses the gap.
 *
 * HASHED AT REST. A six-digit code is a credential for as long as it lives, and a database
 * that holds it in the clear hands anyone who reads a backup the ability to confirm any
 * pending address. bcrypt, the same as the password — the cost is paid once per attempt.
 *
 * ATTEMPTS ARE COUNTED. A million codes is nothing to guess against an endpoint that will
 * answer forever, so five wrong tries burn the code and a new one has to be sent. That is
 * what makes six digits enough.
 */
const VERIFY_TTL_MIN = 30;
const VERIFY_MAX_TRIES = 5;
let _verifyReady = null;
export function ensureEmailVerifyColumns() {
  if (_verifyReady) return _verifyReady;
  _verifyReady = q(`alter table users
      add column if not exists email_verified_at timestamptz,
      add column if not exists email_code_hash   text,
      add column if not exists email_code_at     timestamptz,
      add column if not exists email_code_tries  integer default 0`)
    .catch((e) => { _verifyReady = null; throw e; });
  return _verifyReady;
}

/** Six digits, from the CSPRNG. Math.random() is seeded and predictable, and this is the
 *  one number standing between an address and being confirmed. Padded, so 000123 is a
 *  legal code and the space is the full million rather than the 900,000 above 100000. */
export function newEmailCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * Mint a code for a user and store its hash. Returns the PLAINTEXT for the mail to carry —
 * the only moment it exists outside the person's inbox.
 *
 * Resending replaces the previous code and resets the attempt count: the old one stops
 * working the moment a new one is asked for, so a code read out of an older email cannot be
 * used to confirm after the address was corrected.
 */
export async function issueEmailCode(userId) {
  await ensureEmailVerifyColumns();
  const code = newEmailCode();
  const hash = await bcrypt.hash(code, 10);
  await q(`update users set email_code_hash=$2, email_code_at=now(), email_code_tries=0 where id=$1`,
    [userId, hash]);
  return { code, minutes: VERIFY_TTL_MIN };
}

/**
 * Check a code. Every refusal says WHICH problem it is, because they need different actions:
 * expired and burnt both mean "ask for a new one", wrong means "look again", and already
 * means "you are done, nothing to do".
 *
 * The attempt is counted BEFORE the comparison. Counting after a failed compare is the same
 * thing right up until the process is killed mid-request, and a counter that can be reset by
 * hanging up is not a counter.
 */
export async function confirmEmailCode(userId, raw) {
  await ensureEmailVerifyColumns();
  const code = String(raw || '').trim();
  if (!/^[0-9]{6}$/.test(code)) return { ok: false, reason: 'bad-code', error: 'Enter the six-digit code from the email.' };
  const u = await q(`select email_verified_at, email_code_hash, email_code_at, email_code_tries from users where id=$1`, [userId])
    .then((r) => r.rows[0]).catch(() => null);
  if (!u) return { ok: false, reason: 'no-user', error: 'No such account.' };
  if (u.email_verified_at) return { ok: true, already: true };
  if (!u.email_code_hash) return { ok: false, reason: 'none', error: 'There is no code waiting. Ask for a new one.' };
  const ageMin = (Date.now() - new Date(u.email_code_at).getTime()) / 60000;
  if (!(ageMin < VERIFY_TTL_MIN)) return { ok: false, reason: 'expired', error: 'That code has expired. Ask for a new one.' };
  if (Number(u.email_code_tries) >= VERIFY_MAX_TRIES) {
    return { ok: false, reason: 'burnt', error: 'Too many tries on this code. Ask for a new one.' };
  }
  await q(`update users set email_code_tries = coalesce(email_code_tries,0) + 1 where id=$1`, [userId]).catch(() => {});
  if (!(await bcrypt.compare(code, u.email_code_hash))) {
    const left = VERIFY_MAX_TRIES - (Number(u.email_code_tries) + 1);
    return { ok: false, reason: 'wrong',
      error: left > 0 ? `That code isn't right — ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code isn\'t right, and it has no tries left. Ask for a new one.' };
  }
  /* CLEARED, not kept. A confirmed address has no pending code, and leaving the hash behind
     leaves a credential in the row that nothing will ever check again. */
  await q(`update users set email_verified_at=now(), email_code_hash=null, email_code_at=null, email_code_tries=0 where id=$1`, [userId]);
  return { ok: true };
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
  const weak = passwordProblem(password, { email, name, username });
  if (weak) throw new Error(weak);
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
      /* SAY WHAT TO DO, not just what is wrong. "That email is already registered" is a
         dead end phrased as a fact — the person is at a signup form because they want in, and
         the answer to an address that already has an account is to sign in with it, or to
         reset the password if that is why they were making a second one. A refusal that names
         the way forward is the difference between a fixed problem and a support ticket. */
      throw new Error(String(e.detail || e.constraint || '').includes('username')
        ? 'That username is taken — pick another.'
        : 'This email already has an account. Log in instead, or reset your password.');
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
 * ADMIN ONLY. Deliberately narrower than isStaff (which admits operator and designer) and
 * now narrower than canMoveMoney too. Anything that writes users.password_hash is an
 * account takeover in one call: /api/auth/forgot is public and will happily open a pending
 * reset row for an admin, so any role that can RESOLVE a reset can promote itself by
 * resolving one it opened.
 *
 * Warehouse used to be included for the day-to-day chore of "someone forgot a password".
 * That convenience is not worth the shape of the hole it leaves, and it is a different
 * question from moving money — warehouse keeps canMoveMoney and loses this one. The
 * requireNotAdminTarget guards in users.js/password-reset.js stay as defence in depth.
 */
export const canManageUsers = (user) => !!user && user.role === 'admin';

/**
 * Who may move money — arbitrary ledger writes, transfers, refunds, pricing.
 *
 * Same membership as canManageUsers today but a SEPARATE policy, so one can be widened
 * without silently widening the other. Kept here because private copies of this exact
 * predicate had already appeared in order_refunds.js (canRefund) and design_files.js
 * (canPrice), while wallet.js gated on the much broader isStaff — which is how operator
 * and designer ended up able to credit any account.
 *
 * WAREHOUSE WAS REMOVED (2026-08-24). The floor's job is to PRODUCE — print it, pack it,
 * scan it out — and none of that requires knowing what an order earns, let alone being able
 * to send money back to a seller. It had refunds, fee adjustments and four wallet routes
 * (transfers, ledger writes, payouts) purely because the role predated the split between
 * "runs the factory" and "runs the business".
 *
 * This is the ONE place that decision is written down, which is the point: the refund route,
 * the fee route and wallet.js all read it, so none of them had to be found and edited, and
 * none of them can drift back. The client hides the same surfaces, but THIS is the boundary
 * that refuses — hiding a control that the API would still honour is decoration, not a
 * permission.
 */
export const canMoveMoney = (user) => !!user && user.role === 'admin';

/**
 * Who may CHARGE an order more than it was quoted — the price adjustment on its own.
 *
 * Wider than canMoveMoney by one role, operator, and for one direction only. An
 * adjustment is the floor's finding written into the price: the parcel weighed more than
 * the estimate, a colour was added at the machine, a line was re-printed. The operator is
 * the person who knows that, at the moment it is known, and routing it through an admin
 * meant it was recorded late or not at all (owner's call, 2026-09-07).
 *
 * It is money OUT of a seller's wallet into the house, against a named order, with a
 * reason the seller reads — the least dangerous shape money can take here. Sending money
 * BACK stays canMoveMoney: that is the direction a mistake or a favour costs the business,
 * and it keeps its single owner.
 */
export const canAdjustPrice = (user) => !!user && ['admin', 'operator'].includes(user.role);

/**
 * Who may SEE money at all — prices, costs, what an order earned, what it can refund.
 *
 * Separate from canMoveMoney because reading and moving are different questions for every
 * role except the one they agree on. An operator reads figures on the boards they work and
 * cannot move a cent; WAREHOUSE now reads none, which is the point of the role.
 *
 * The floor prints, packs and scans. What the order was worth does not inform any of those,
 * and it is the number most likely to be read over a shoulder on a factory floor — so it is
 * withheld at the API, not merely hidden on the page. Routes that answer with figures should
 * return the SAME gated shape a team member gets without the `order_fees` grant: empty
 * amounts plus `gated: true`, so the client can say "withheld" instead of printing zeros.
 * Blank and zero look identical and mean opposite things (§4).
 *
 * Sellers are not decided here — they see their OWN money, and ownership is resolved
 * per-route by resolveSeller.
 */
export const canSeeMoney = (user) => !!user && user.role !== 'warehouse';

/**
 * Which SELLER account a request acts under, and what that person may see of it.
 *
 * A team member acts under their leader: their own user id owns nothing, so every read
 * and write has to resolve to `owner_id` first. Returns
 * `{ id, perms, member }` — `perms` is null for a full owner (unrestricted) and an array
 * for a member, which is what makes `canSurface` below a hide-only rule.
 *
 * Lives here because this exact query had already been written twice — privately in
 * orders.js (resolveSeller) and again in wallet.js (ownerWalletFor) — and the same
 * comment above canMoveMoney records how that pattern ends: three copies, drifted, one
 * of them gating on the wrong thing. A third copy was about to be added for order fees.
 *
 * FAILS CLOSED on a read error: an unreadable membership is reported as "no membership",
 * never as an unrestricted owner.
 */
export async function resolveSeller(user, q) {
  if (!user) return { id: null, perms: null, member: false };
  if (isStaff(user)) return { id: user.sub, perms: null, member: false };
  try {
    const r = await q("select owner_id, permissions from team_members where lower(email)=lower($1) and status='active' limit 1", [user.email || '']);
    const row = r.rows[0];
    if (row && row.owner_id) return { id: row.owner_id, perms: Array.isArray(row.permissions) ? row.permissions : [], member: true };
  } catch (e) { /* fall through to "not a member" */ }
  return { id: user.sub, perms: null, member: false };
}

/**
 * HIDE-ONLY. A full owner (perms === null) always passes; a team member passes only for
 * the surfaces their leader granted. Never the other way round — this can hide something
 * from a member, and can never reveal something to someone who wasn't already entitled.
 */
export function canSurface(sel, surface) {
  return !(sel && sel.member && sel.perms && sel.perms.indexOf(surface) < 0);
}

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

/**
 * ONE password rule, for every door that writes users.password_hash.
 *
 * There were three different floors — 8 at signup, 8 for an admin-created user, and SIX on
 * the reset route — which meant the weakest one set the real policy: anyone could downgrade
 * their own password to six characters through "forgot password". That is the hole this
 * closes, and it is why the check lives here rather than being retyped at each call site.
 *
 * The specific numbers are Amazon's Selling Partner API credential-management control (12
 * characters, mixed case, a digit, a symbol, and no part of the user's own name), because
 * marketplace API access is assessed against it and the strictest connected platform sets
 * the bar for everyone. It is also just a sane 2026 floor.
 *
 * Returns null when the password is acceptable, or a message to show the person. It does not
 * throw — callers reply with different status codes and shapes.
 */
export function passwordProblem(plain, { email = '', name = '', username = '' } = {}) {
  const p = String(plain || '');
  if (p.length < 12) return 'Password must be at least 12 characters';
  if (!/[a-z]/.test(p)) return 'Password must include a lower-case letter';
  if (!/[A-Z]/.test(p)) return 'Password must include a capital letter';
  if (!/[0-9]/.test(p)) return 'Password must include a number';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Password must include a symbol';
  // "must not include any part of the user's name" — split the identity into words and
  // reject any run of 4+ characters that appears in the password. 4, not 3, because short
  // fragments ("ann", "lee") collide with ordinary English often enough to reject good
  // passwords; the local part of the address counts, since that is the usual near-miss.
  const lc = p.toLowerCase();
  const parts = `${String(email).split('@')[0]} ${name} ${username}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  if (parts.some((w) => lc.includes(w))) return 'Password must not contain your name or email';
  return null;
}

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
