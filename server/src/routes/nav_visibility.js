// Role → hidden nav surfaces. A PURELY COSMETIC preference layer: it can only HIDE pages
// and tabs a role would otherwise see — it can NEVER reveal one it can't. The real access
// gate stays the route's requireStaff/requireAdmin plus the client's capability check; this
// map only ever SUBTRACTS from what a role already sees. Stored in `settings` so packages /
// permissions change without a server deploy.
//
// Shape: { [role]: string[] }  — the array is the hidden surface keys for that role.
// A key is a nav href ("/spydeck") or a tab ("/spydeck#trending"). Absence = visible.
import { q } from '../db.js';

const KEY = 'nav_visibility';
const ROLES = ['seller', 'operator', 'warehouse', 'designer', 'admin'];

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q('create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())')
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

// settings.value is jsonb (already parsed by node-pg) on a current DB, but an older one may
// hand back text — handle both, exactly like the other settings readers in this codebase.
const readVal = (row) => {
  if (!row || row.value == null) return {};
  const v = typeof row.value === 'string' ? JSON.parse(row.value || '{}') : row.value;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};

async function readVisibility() {
  await ensure();
  try {
    const r = await q('select value from settings where key=$1', [KEY]);
    return readVal(r.rows[0]);
  } catch { return {}; }
}

// Keep only known roles, each mapped to a deduped, capped array of string keys. An empty
// array is KEPT (not dropped): "role present with []" means "explicitly nothing hidden",
// which is how an admin overrides a client-side default-hidden surface to SHOW it again.
// A role absent from the map falls back to the client default. Unknown keys are harmless —
// the client only ever reads keys it knows, and this map can only hide, never grant.
function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const role of ROLES) {
    const arr = input[role];
    if (!Array.isArray(arr)) continue;
    out[role] = [...new Set(arr.map((k) => String(k)).filter(Boolean))].slice(0, 300);
  }
  return out;
}

export function navVisibilityRoutes(app, requireAuth) {
  // Readable by ANY signed-in user — every client needs it to filter its own nav. Carries no
  // sensitive data (just which menu items to draw), same rationale as /api/thread_palette.
  app.get('/api/nav_visibility', { preHandler: requireAuth }, async () => {
    return { hidden: await readVisibility() };
  });

  // Admin only — this shapes what every tier sees.
  app.put('/api/nav_visibility', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only' }; }
    const norm = normalize((req.body || {}).hidden);
    if (norm == null) { reply.code(400); return { error: 'hidden must be an object of role -> string[]' }; }
    await ensure();
    await q('insert into settings (key,value,updated_at) values ($1,$2::jsonb,now()) on conflict (key) do update set value=excluded.value, updated_at=now()',
      [KEY, JSON.stringify(norm)]).catch(() => {});
    return { ok: true, hidden: norm };
  });
}
