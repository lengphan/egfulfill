// factory_settings.js — platform-wide factory settings (design fee, default shipping,
// embroidery file price). Stored in the shared `settings` table (jsonb numbers), read by
// any staff, written by warehouse/admin only. Ported from the old admin Platform settings
// (dropped the dev-only bits: storage/clear-cache/reset-demo, production capacity).

import { q } from '../db.js';

// Per-category flat shipping and per-method surcharges. Admin-editable so pricing policy
// is a settings change, not a deploy. `emb_price` is NOT the embroidery surcharge — it's
// the price of the embroidery FILE — hence the separate method_emb.
const KEYS = [
  'design_fee', 'ship_first', 'ship_extra', 'emb_price',
  // Flat shipping by garment class.
  'ship_cap', 'ship_heavy', 'ship_garment',
  // Print-method surcharge, keyed by the same codes pricing.js normalises to.
  'method_dtg', 'method_dtf', 'method_emb', 'method_apl', 'method_lsr',
];

// Defaults applied when a key has never been set. Exported so the pricing path and the
// product editor agree on the starting numbers instead of each hardcoding its own.
export const SETTING_DEFAULTS = {
  ship_cap: 5.99,      // caps / hats
  ship_heavy: 9.99,    // sweatshirts / hoodies / jackets
  ship_garment: 6.99,  // everything else
  method_dtg: 0,       // plain printing carries no surcharge
  method_dtf: 0,
  method_emb: 5,       // stitches cost more than ink
  method_apl: 2,
  method_lsr: 2,
};

/**
 * Which flat shipping band a product falls in. Substring matching because supplier
 * type/name strings are loose ("Apparel", "Headwear", "Pullover Hoodie").
 */
export function shippingBandOf(typeOrName) {
  const s = String(typeOrName || '').toLowerCase();
  if (/cap|hat|beanie|visor|headwear|trucker/.test(s)) return 'ship_cap';
  if (/hoodie|hooded|sweatshirt|sweater|crewneck|jacket|coat|pullover|fleece/.test(s)) return 'ship_heavy';
  return 'ship_garment';
}

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists settings (key text primary key, value text, updated_at timestamptz default now())`).catch(() => {});
  return _ready;
}

async function readAll() {
  const out = { ...SETTING_DEFAULTS };
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
