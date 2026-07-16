// factory_settings.js — platform-wide factory settings (design fee, default shipping,
// embroidery file price). Stored in the shared `settings` table (jsonb numbers), read by
// any staff, written by warehouse/admin only. Ported from the old admin Platform settings
// (dropped the dev-only bits: storage/clear-cache/reset-demo, production capacity).

import { q } from '../db.js';

const KEYS = ['design_fee', 'ship_first', 'ship_extra', 'emb_price'];

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists settings (key text primary key, value text, updated_at timestamptz default now())`).catch(() => {});
  return _ready;
}

async function readAll() {
  const out = {};
  try {
    const r = await q('select key, value from settings where key = any($1)', [KEYS]);
    for (const row of r.rows) { const n = Number(row.value); if (isFinite(n)) out[row.key] = n; }
  } catch { /* table not ready */ }
  return out;
}

export function factorySettingsRoutes(app, requireAuth, requireStaff) {
  app.get('/api/factory/settings', { preHandler: requireStaff }, async () => {
    await ensure();
    return readAll();
  });

  app.put('/api/factory/settings', { preHandler: requireStaff }, async (req, reply) => {
    const role = req.user && req.user.role;
    if (role !== 'admin' && role !== 'warehouse') { reply.code(403); return { error: 'Warehouse or admin only' }; }
    await ensure();
    const b = req.body || {};
    for (const k of KEYS) {
      if (b[k] == null || b[k] === '') continue;
      const n = Number(b[k]);
      if (!isFinite(n) || n < 0) continue;
      // settings.value is jsonb — store the number as a JSON number.
      await q('insert into settings (key,value,updated_at) values ($1, to_jsonb($2::numeric), now()) on conflict (key) do update set value=excluded.value, updated_at=now()', [k, n]).catch(() => {});
    }
    return { ok: true, ...(await readAll()) };
  });
}
