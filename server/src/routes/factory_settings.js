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
  // Offered in the product editor but previously unpriced: methodAddOn fell through to
  // a key that didn't exist ('method_screen print') and returned 0, so screen-print,
  // sublimation and vinyl work carried NO surcharge at all.
  'method_scr', 'method_sub', 'method_vnl',
  // Markup added to a supplier's PRODUCT COST to get the base cost we charge sellers.
  // Supplier syncs (S&S, Otto) fill in product cost; this turns it into a sell price
  // without anyone retyping a number per size.
  'base_markup',
  // Expedited dispatch: what the seller pays vs what the partner costs us.
  'expedite_fee', 'expedite_cost', 'design_partner_cost',
];

// Defaults applied when a key has never been set. Exported so the pricing path and the
// product editor agree on the starting numbers instead of each hardcoding its own.
export const SETTING_DEFAULTS = {
  // Default shipping. These were in KEYS but had NO default here, so the Settings screen
  // rendered them as $0.00 while pricing.js used a private fallback of 5/2 — two numbers
  // for one fee, and the screen showing the wrong one. Worse, saving that screen wrote
  // the 0 back and shipping really did become free. Values match the legacy seeds
  // (eg_default_shipping_fee / eg_default_addl_item_fee in schema.sql).
  ship_first: 5,       // first unit — one order is one parcel
  ship_extra: 2,       // every additional UNIT in that same parcel
  design_fee: 2.5,     // design service, per order (legacy eg_designer_fee_rate)
  emb_price: 0,        // default price of an embroidery FILE; per-file price overrides
  ship_cap: 5.99,      // caps / hats
  ship_heavy: 9.99,    // sweatshirts / hoodies / jackets
  ship_garment: 6.99,  // everything else
  method_dtg: 0,       // plain printing carries no surcharge
  method_dtf: 0,
  method_emb: 5,       // stitches cost more than ink
  method_apl: 2,
  method_lsr: 2,
  method_scr: 2,      // screen print — setup per colour
  method_sub: 1,      // sublimation
  method_vnl: 2,      // heat-transfer vinyl, cut + weed
  base_markup: 0,     // 0 = base cost equals product cost until someone sets a margin
  // Expedited dispatch (label pre-scan). The seller pays expedite_fee; the partner
  // invoices us expedite_cost per label. Both are recorded so the margin between them is
  // visible rather than inferred — a fixed sell price against a supplier cost that can
  // move is exactly where margin erodes unnoticed.
  expedite_fee: 2,    // charged to the seller, per order
  expedite_cost: 0.5, // what the dispatch partner charges us, per label
  design_partner_cost: 0, // what the outsourced design partner costs us, per task
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

// The warehouse's own ship-from address. Kept out of KEYS because every other setting is
// a number — this one is a JSON object, so it reads and writes on its own path. Labels
// were previously bought with whatever `from` the client happened to send, which meant no
// address at all; this is the single place the floor sets it once.
export const SHIP_FROM_KEY = 'ship_from';

/**
 * Product types, managed rather than hardcoded — they were a literal array in the product
 * dialog, so there was no way to add one, and no way to attach anything to one.
 *
 * Each type carries a DEFAULT MOCKUP. That's the point: a 2D outline that represents the
 * whole category means adding three hats needs one hat graphic, set once, instead of an
 * upload per product. A product's own mockup still wins when it has one.
 */
export const PRODUCT_TYPES_KEY = 'product_types';

/** Sides a product CAN have. Which ones a type actually uses is chosen per type. */
export const ALL_SIDES = ['front', 'back', 'left', 'right', 'sleeve', 'hood', 'inside', 'wrap'];

// Sensible starting sides per category, so a fresh install isn't a blank grid.
const DEFAULT_TYPES = [
  { name: 'Apparel', sides: ['front', 'back'] },
  { name: 'Headwear', sides: ['front', 'back', 'left', 'right'] },
  { name: 'Bags', sides: ['front', 'back'] },
  { name: 'Drinkware', sides: ['front', 'wrap'] },
  { name: 'Accessories', sides: ['front'] },
  { name: 'Other', sides: ['front'] },
];

export async function readProductTypes() {
  try {
    const r = await q('select value from settings where key=$1', [PRODUCT_TYPES_KEY]);
    const v = r.rows[0] && r.rows[0].value;
    if (Array.isArray(v)) {
      return v.filter((t) => t && t.name).map((t) => ({
        name: t.name,
        sides: Array.isArray(t.sides) && t.sides.length ? t.sides.filter((x) => ALL_SIDES.includes(x)) : ['front'],
        // Per-side outline. `mockup` (singular) is the legacy front-only field — kept in
        // sync below so anything still reading it keeps working.
        mockups: (t.mockups && typeof t.mockups === 'object') ? t.mockups : (t.mockup ? { front: t.mockup } : {}),
        mockup: (t.mockups && t.mockups.front) || t.mockup || null,
      }));
    }
  } catch { /* table not ready */ }
  return DEFAULT_TYPES.map((t) => ({ name: t.name, sides: t.sides, mockups: {}, mockup: null }));
}
/**
 * The factory's embroidery thread stock — code, name, colour.
 *
 * Was a hardcoded 16-colour array in the client. Matching is only ever as good as the
 * cones on the shelf: with 16 colours a light blue resolves to Grey and a dusty pink
 * had nowhere sensible to go. A real Madeira/Isacord chart is hundreds of cones, and
 * which of them the factory actually stocks is a floor decision, not a code constant.
 *
 * Empty/unset = the client falls back to its built-in starter palette, so an install
 * that never touches this keeps working exactly as before.
 */
export const THREAD_PALETTE_KEY = 'thread_palette';

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Stored palette, or [] when unset. Rows are validated on read as well as on write —
 *  a hand-edited settings row must not be able to inject junk into every board. */
export async function readThreadPalette() {
  try {
    const r = await q('select value from settings where key=$1', [THREAD_PALETTE_KEY]);
    const v = r.rows[0] && r.rows[0].value;
    if (Array.isArray(v)) {
      return v
        .filter((t) => t && t.code && t.name && HEX_RE.test(String(t.hex || '')))
        .map((t) => ({ code: String(t.code), name: String(t.name), hex: String(t.hex).toUpperCase() }));
    }
  } catch { /* table not ready */ }
  return [];
}

/** Validate + de-dupe an incoming palette. Returns null if the body isn't a palette. */
export function normalizeThreadPalette(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const out = [];
  for (const t of input) {
    const code = String((t && t.code) || '').trim().slice(0, 24);
    const name = String((t && t.name) || '').trim().slice(0, 60);
    const hex = String((t && t.hex) || '').trim();
    // A cone with no code can't be pulled off a shelf and a bad hex would silently
    // match everything to black — drop rather than coerce.
    if (!code || !name || !HEX_RE.test(hex)) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) continue;            // code is the identity; last write wins is worse
    seen.add(key);
    out.push({ code, name, hex: hex.toUpperCase() });
  }
  return out;
}

const SHIP_FROM_FIELDS = ['name', 'company', 'street', 'street2', 'city', 'state', 'zip', 'country', 'phone', 'email'];

export async function readShipFrom() {
  try {
    const r = await q('select value from settings where key=$1', [SHIP_FROM_KEY]);
    const v = r.rows[0] && r.rows[0].value;
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

/** A label needs a real street, city, state and ZIP — anything less and the carrier rejects it. */
export function shipFromComplete(a) {
  return !!(a && a.street && a.city && a.state && a.zip);
}

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())`).catch(() => {});
  return _ready;
}

// Exported so other routes (dispatch billing) read the SAME numbers the admin screen
// writes, instead of each hardcoding its own idea of a fee.
export async function readAll() {
  const out = { ...SETTING_DEFAULTS };
  try {
    const r = await q('select key, value from settings where key = any($1)', [KEYS]);
    for (const row of r.rows) { const n = Number(row.value); if (isFinite(n)) out[row.key] = n; }
  } catch { /* table not ready */ }
  return out;
}

export function factorySettingsRoutes(app, requireAuth, requireStaff) {
  // Types + their category mockups are needed by the SELLER-side Design Maker to resolve a
  // blank, but /api/factory/settings is staff-only (it carries cost and margin policy).
  // So the types get their own read, open to any signed-in user — names and mockup images
  // only, nothing commercial.
  app.get('/api/product_types', { preHandler: requireAuth }, async () => {
    await ensure();
    return readProductTypes();
  });

  // Cone codes/names/colours carry no cost or margin information, and the seller-side
  // Design Maker needs them to thread-match — so this reads for any signed-in user,
  // exactly like /api/product_types. Writing stays warehouse/admin.
  app.get('/api/thread_palette', { preHandler: requireAuth }, async () => {
    await ensure();
    return readThreadPalette();
  });

  app.get('/api/factory/settings', { preHandler: requireStaff }, async () => {
    await ensure();
    const [nums, shipFrom, types, threads] = await Promise.all([readAll(), readShipFrom(), readProductTypes(), readThreadPalette()]);
    return { ...nums, ship_from: shipFrom, ship_from_complete: shipFromComplete(shipFrom), product_types: types, thread_palette: threads };
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
    if (b.ship_from && typeof b.ship_from === 'object') {
      const addr = {};
      for (const f of SHIP_FROM_FIELDS) addr[f] = String(b.ship_from[f] ?? '').trim();
      addr.country = addr.country || 'US';
      await q('insert into settings (key,value,updated_at) values ($1,$2::jsonb,now()) on conflict (key) do update set value=excluded.value, updated_at=now()', [SHIP_FROM_KEY, JSON.stringify(addr)]);
    }
    if (Array.isArray(b.product_types)) {
      // Normalised on the way in: a blank name would create an unselectable type, and
      // duplicates would make the product dropdown ambiguous.
      const seen = new Set();
      const types = [];
      for (const t of b.product_types) {
        const name = String((t && t.name) || '').trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        // A type always has at least a front — a product with no sides can't be designed on.
        const sides = Array.isArray(t.sides) ? t.sides.filter((x) => ALL_SIDES.includes(x)) : [];
        if (!sides.length) sides.push('front');
        // Only keep outlines for sides that are actually ON. Turning a side off should
        // drop its image, not leave an orphan that reappears if it's re-enabled later.
        const mockups = {};
        for (const side of sides) {
          const v = t.mockups && typeof t.mockups[side] === 'string' ? t.mockups[side] : '';
          if (v) mockups[side] = v;
        }
        types.push({ name, sides, mockups, mockup: mockups.front || null });
      }
      await q('insert into settings (key,value,updated_at) values ($1,$2::jsonb,now()) on conflict (key) do update set value=excluded.value, updated_at=now()',
        [PRODUCT_TYPES_KEY, JSON.stringify(types)]);
    }
    if (b.thread_palette !== undefined) {
      const palette = normalizeThreadPalette(b.thread_palette);
      if (palette) {
        await q('insert into settings (key,value,updated_at) values ($1,$2::jsonb,now()) on conflict (key) do update set value=excluded.value, updated_at=now()',
          [THREAD_PALETTE_KEY, JSON.stringify(palette)]);
      }
    }
    const shipFrom = await readShipFrom();
    return { ok: true, ...(await readAll()), ship_from: shipFrom, ship_from_complete: shipFromComplete(shipFrom), product_types: await readProductTypes(), thread_palette: await readThreadPalette() };
  });
}
