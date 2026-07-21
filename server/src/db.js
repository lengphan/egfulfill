// One shared Postgres pool for the whole API.
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Tiny query helper: q('select * from orders where id=$1', [id])
export const q = (text, params) => pool.query(text, params);

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
