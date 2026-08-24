// role_grants.js — the OTHER half of Settings › Permissions, and deliberately a separate
// file from nav_visibility.js.
//
// nav_visibility can only ever SUBTRACT: it hides pages a role already reaches, and its own
// header says it must never reveal one. That invariant is worth keeping intact, so a switch
// that GRANTS a role something it does not normally have cannot live in that map — it would
// turn a "worst case: something is hidden" structure into one where a wrong click widens
// access. This file is the grant side, and it carries the opposite burden of proof:
//
//   * A grant is a CLOSED REGISTRY. Only keys declared in GRANTS exist; anything else in the
//     stored blob is dropped on write and ignored on read. A permission system whose keys are
//     whatever was last POSTed is one typo away from meaning nothing.
//   * A grant FAILS CLOSED. Every read is wrapped: if the settings row is missing, malformed
//     or the query throws, the answer is false and the platform behaves exactly as it does
//     with the feature switched off.
//   * A grant is NEVER the only gate. The route still checks the role itself; the grant only
//     widens a stage window, and every other guard on the path is untouched.
//
// Stored in `settings` under one key, like nav_visibility and site_content, so permissions
// change without a server deploy.
import { q } from '../db.js';
import { audit } from '../audit.js';

const KEY = 'role_grants';

/**
 * THE CLOSED REGISTRY.
 *
 * `role` is who the grant is about — it is not a check (the route does that), it is what
 * lets the admin UI draw the switch on the right row.
 */
export const GRANTS = [
  {
    key: 'operator.editAfterApproval',
    role: 'operator',
    label: 'Edit an order after approval',
    // Shown in the admin UI. It says what the grant DOES and where it still stops, because
    // an admin turning this on is accepting the consequence and needs to see the edge.
    note: 'Lets an operator correct a line after Approved, the same reach an admin has — until the blanks are ordered, after which it is locked for everyone.',
  },
];
const GRANT_KEYS = new Set(GRANTS.map((g) => g.key));

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q('create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())')
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

// settings.value is jsonb (already parsed) on a current DB; an older one hands back text.
// Same reader as nav_visibility.js, for the same reason.
const readVal = (row) => {
  if (!row || row.value == null) return {};
  const v = typeof row.value === 'string' ? JSON.parse(row.value || '{}') : row.value;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};

/** Every declared grant, as booleans. Unknown stored keys never appear. */
export async function readGrants() {
  try {
    /* ensure() IS INSIDE THE TRY, and that is the whole point. It runs a CREATE TABLE, so on
       an unreachable database it rejects — and with the await outside, this function threw
       instead of answering, which made the enforcing route 500 on an ordinary edit rather
       than falling back to the shipped rule. The header promised fail-closed and the code
       did not; caught by driving it against a closed port, never by reading it. */
    await ensure();
    const r = await q('select value from settings where key=$1', [KEY]);
    const stored = readVal(r.rows[0]);
    const out = {};
    for (const g of GRANTS) out[g.key] = stored[g.key] === true;
    return out;
  } catch {
    // FAIL CLOSED — see the header. A database that cannot answer grants nothing.
    const out = {};
    for (const g of GRANTS) out[g.key] = false;
    return out;
  }
}

/**
 * Is ONE grant on. The predicate every enforcing route should call.
 *
 * Not cached: a permission that keeps applying for a minute after it is revoked is the one
 * kind of staleness this must not have, and the read is a primary-key lookup on a table the
 * same request already touches several times.
 */
export async function isGrantEnabled(key) {
  if (!GRANT_KEYS.has(key)) return false;
  /* Belt and braces: readGrants is already total, but this is the function the ROUTES call,
     and a permission check is the last place to rely on someone else's error handling. */
  const all = await readGrants().catch(() => null);
  return !!all && all[key] === true;
}

/** Keep only declared keys, and only real booleans. */
function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const g of GRANTS) out[g.key] = input[g.key] === true;
  return out;
}

export function roleGrantsRoutes(app, requireAuth) {
  // Readable by any signed-in user: a client has to know whether to draw the control at all,
  // and drawing one the API then refuses is the worst of the available behaviours. It leaks
  // nothing — which switches an admin has set, not who may do what to any given order.
  app.get('/api/role_grants', { preHandler: requireAuth }, async () => {
    return { grants: await readGrants(), registry: GRANTS };
  });

  app.put('/api/role_grants', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only' }; }
    const norm = normalize((req.body || {}).grants);
    if (norm == null) { reply.code(400); return { error: 'grants must be an object of key -> boolean' }; }
    const before = await readGrants();
    await ensure();  // throws here is correct: a write that cannot create its table must fail loudly
    await q(
      `insert into settings (key,value,updated_at) values ($1,$2::jsonb,now())
         on conflict (key) do update set value=excluded.value, updated_at=now()`,
      [KEY, JSON.stringify(norm)]);
    // WIDENING ACCESS IS RECORDED, with both sides. CLAUDE.md's rule that history never
    // changes silently is about orders, but a permission is the thing that let a change
    // happen — "who could do this, and since when" has to be answerable later.
    audit(req, 'permissions.grants', { entityType: 'settings', entityId: KEY, before, after: norm });
    return { ok: true, grants: norm };
  });
}
