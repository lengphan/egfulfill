// One shared Postgres pool for the whole API.
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Tiny query helper: q('select * from orders where id=$1', [id])
export const q = (text, params) => pool.query(text, params);

/**
 * Run `fn` with an exclusive lock on `key`, serialising callers that name the same key.
 *
 * Exists for read-then-write money decisions. "Refund at most what's left" reads the
 * refunded total, decides, then writes — and two clicks landing together both read the
 * same "nothing refunded yet" and both pay out. The overdraft guard doesn't catch it:
 * the payer is the house account, which is allowed to go negative on purpose.
 *
 * The lock is a plain mutex, not a transaction boundary — `fn`'s own writes go through
 * the pool and commit as they happen. That's fine and deliberate: by the time this
 * releases, those writes are committed and the next caller in line reads the new total.
 */
export async function withLock(key, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    // hashtext maps the key onto the bigint the advisory-lock API wants. Collisions
    // only over-serialise (two unrelated orders waiting on each other), never under-.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [String(key)]);
    return await fn();
  } finally {
    await client.query('commit').catch(() => {});
    client.release();
  }
}

/**
 * A query whose failure must NOT break the caller — but must not be invisible either.
 *
 * The codebase was full of `q(...).catch(() => ({ rows: [] }))`. That turns a broken
 * query into "there is no data", which is indistinguishable from an empty table. A
 * uuid = text join in the team queries hid behind exactly that for months: invites never
 * listed, and the permission system reported "not a member" every single time, so team
 * sharing limits never applied to anyone.
 *
 * Same fallback, same control flow — but the failure is logged with the label and the
 * real Postgres message, so `docker compose logs api` says what broke.
 *
 * Use this ONLY where an empty result is genuinely survivable. Where an empty result
 * would be a lie (a list the user is about to act on), let the error propagate instead.
 */
export async function softQ(label, text, params, fallback = { rows: [] }) {
  try {
    return await pool.query(text, params);
  } catch (e) {
    console.error(`[softQ] ${label} failed: ${e.message}`);
    return fallback;
  }
}
