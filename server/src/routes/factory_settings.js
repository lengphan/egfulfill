// factory_settings.js — platform-wide factory settings (design fee, default shipping,
// embroidery file price). Stored in the shared `settings` table (jsonb numbers), read by
// any staff, written by warehouse/admin only. Ported from the old admin Platform settings
// (dropped the dev-only bits: storage/clear-cache/reset-demo, production capacity).

import { q } from '../db.js';

// Per-category flat shipping and per-method surcharges. Admin-editable so pricing policy
// is a settings change, not a deploy. `emb_price` is NOT the embroidery surcharge — it's
// the price of the embroidery FILE — hence the separate method_emb.
const KEYS = [
  // designer_payout is what a DESIGNER earns per approved design — money going OUT.
  // It was called design_fee, which read like something a seller pays, and a
  // seller-facing design charge is now being added: two "design fees" meaning opposite
  // directions is a mistake waiting to be made in a money path.
  'designer_payout', 'ship_first', 'ship_extra', 'emb_price',
  // SELLER-FACING design charges. Three mutually exclusive outcomes for one embroidered
  // line, and which one applies is decided by where the machine file comes from:
  //   we digitise it, ordinary          -> design_fee_standard
  //   we digitise it, intricate         -> design_fee_complex   (quoted and accepted first)
  //   the seller brought their own file -> check_fee            (we verify it, not cut it)
  // Then the file itself is bought separately: emb_price, or emb_price_complex when the
  // work was complex. Charging and downloading are different transactions — a seller can
  // pay to have a file made and never download it.
  'design_fee_standard', 'design_fee_complex', 'check_fee', 'emb_price_complex',
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
  // How many days an OPEN order may sit before the boards call it overdue. Not a promise
  // date — no marketplace ship-by is captured yet — so it is an age threshold the factory
  // sets for itself, and the UI must not call it a customer commitment.
  'overdue_days',
  // What a seller pays on a TIKTOK-SHIPPED order — one where TikTok produced the label and
  // we only fetch and print it. It is NOT a shipping charge: a seller-shipped TikTok order
  // buys a real label through the normal shipping path and must never be charged both.
  // Nothing books this yet; see the note in tiktok.js before wiring it to wallet_ledger.
  'tiktok_label_fee',
  'low_balance_warn',
  // Seller payout guardrails. payout_max = 0 means "no fixed ceiling — limited only by the
  // seller's own balance", which is always the hard cap regardless.
  'payout_min', 'payout_max',
  // Peak-season capacity: the DEFAULT per-seller daily order limit (0 = unlimited). A seller
  // can be given their own higher limit; this is the fallback. Crossing it never blocks a
  // submit — it only surfaces the editable delay notice below.
  'order_limit_default',
  // capacity_mode = the 0/1 MASTER SWITCH for the whole feature: off = no header counters,
  // no notice, limits ignored. factory_daily_limit = the whole-factory daily intake ceiling
  // shown in the STAFF header (0 = shown as a plain count, no ceiling).
  'capacity_mode', 'factory_daily_limit',
];

// Supplier-ordering defaults. Kept OUT of KEYS because those are all numbers coerced with
// Number() — these are identifiers ('net30', a method id) and an email, which that
// coercion would turn into NaN.
// Per-SUPPLIER emails. The accounts were registered under different addresses, and S&S
// look payment profiles up BY EMAIL — so one shared field would fetch the wrong person's
// cards, or none. `order_email` stays as the fallback for anything not set per supplier.
const TEXT_KEYS = ['ss_shipping_method', 'otto_payment_method', 'otto_shipping_method',
                   'order_email', 'ss_order_email', 'otto_order_email', 'ss_payment_profile',
                   // Otto require BOTH on every order, and they come from their Customer
                   // API rather than anything we hold.
                   'otto_customer', 'otto_contact',
                   // Which carriers the multi-carrier rate picker offers (comma-separated
                   // substrings matched against the rate's carrier name), e.g. "usps,ups".
                   // Empty = show every carrier the Shippo account returns.
                   'enabled_carriers',
                   // Services this warehouse does NOT want offered, comma-separated
                   // substrings matched against the rate's service name — e.g.
                   // "ground saver,parcel select". Carrier-level filtering was too blunt:
                   // USPS is wanted, USPS Ground Saver is not, and an operator scanning a
                   // rate table under time pressure should not have to remember which of
                   // eight lines the floor actually ships. Empty = offer everything.
                   'hidden_services',
                   // Editable delay notice shown to a seller ONLY once they've crossed their
                   // order limit — e.g. "orders submitted now may ship later than usual".
                   'capacity_notice',
                   // LOOKBOOK BRANDING. The printed catalogue goes to buyers, so the name on
                   // its cover, the accent it prints in, and the line under the wordmark all
                   // have to be editable without a deploy — a catalogue is exactly the thing
                   // someone wants to re-skin for a trade show or a private-label buyer.
                   // Blank means "use the house default", so an untouched install still
                   // prints something finished rather than something empty.
                   'lookbook_title', 'lookbook_tagline', 'lookbook_accent', 'lookbook_contact',
                   // Default Pink Design product type: most shops send one type, so it's set
                   // once here and applied to every push — the picker needn't appear per card.
                   'pink_product_type'];

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
  designer_payout: 2.5, // paid TO a designer per approved design (legacy eg_designer_fee_rate)
  overdue_days: 10,    // an open order older than this is flagged on the boards
  emb_price: 0,        // what a SELLER pays to download an embroidery file; per-file overrides
  // Placeholders, not policy. Every one of these is a real charge to a real seller, so
  // they start at values that are obviously provisional rather than plausible — a wrong
  // number that looks deliberate is harder to spot than one that looks unset.
  design_fee_standard: 2,   // we digitise an ordinary design
  design_fee_complex: 15,   // we digitise an intricate one — quoted, and accepted, first
  check_fee: 1,             // the seller brought their own file and we verify it
  emb_price_complex: 30,    // download price when the work was complex
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
  // TikTok-shipped orders: the label is TikTok's, so there's no carrier purchase — this is
  // the handling charge for fetching and printing it. Defaults to 0 so enabling the feature
  // never silently starts charging sellers; an admin sets the number deliberately.
  tiktok_label_fee: 0,
  // When to start warning a seller their wallet is running out. A seller wallet must stay
  // POSITIVE — an order can't be submitted without funds — so the warning has to arrive
  // while there's still time to top up, not at the moment a submit is refused.
  // House accounts (factory/designer) are exempt: they're allowed to run negative on
  // purpose, because that's how a loss becomes visible instead of blocking the floor.
  low_balance_warn: 50,
  // Seller payout guardrails (admin-editable). A request must be at least payout_min, and
  // at most payout_max UNLESS payout_max is 0, which means "no fixed ceiling — the seller's
  // own balance is the cap". The balance cap always applies regardless, so a payout can
  // never exceed what's in the wallet.
  payout_min: 10,
  payout_max: 0,
  // 0 = no default cap; a seller submits freely and never sees the delay notice unless a
  // per-seller limit is set. Set a number to make it apply to every seller by default.
  order_limit_default: 0,
  capacity_mode: 0,        // 0 = peak-season mode OFF (no counters/notices)
  factory_daily_limit: 0,  // whole-factory daily intake ceiling for the staff header
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
// Where returns go. Separate row so it can be set, cleared and read independently of the
// sender address — they are two different buildings under two different names.
export const RETURN_ADDRESS_KEY = 'return_address';

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

/**
 * BLIND SHIPPING — the parcel goes out under the SELLER's shop name, at OUR address.
 *
 * Only the name line changes. Carriers route on the ADDRESS, so an undeliverable parcel
 * still comes back to the same dock it always did; what changes is that receiving sees the
 * seller's shop name on it rather than one uniform name.
 *
 * Why it matters: every label previously carried one shared sender name for every seller,
 * so a buyer could see their seller doesn't make the item, and anyone comparing two
 * parcels from two shops could tell the shops share a factory.
 *
 * Falls back to the configured name whenever there is nothing better — a manual order with
 * no store, an unknown order id, or `blind: false` in settings. A label must never fail to
 * buy because of this.
 */
/**
 * The RETURN address — where an undeliverable parcel goes back to.
 *
 * Separate from ship-from on purpose. The sender block carries the SELLER's shop name at
 * the address we tender from (blind shipping); returns go to our own depot under our own
 * name. One address could not do both jobs once the sender name stopped being ours.
 *
 * Optional. Unset, both providers fall back to the from address — the behaviour before
 * this existed — so a half-filled setting can never break a label.
 */
export async function readReturnAddress() {
  try {
    const r = await q('select value from settings where key=$1', [RETURN_ADDRESS_KEY]);
    const v = r.rows[0] && r.rows[0].value;
    return v && typeof v === 'object' && v.street ? v : null;
  } catch { return null; }
}

export async function shipFromForOrder(orderId) {
  const base = await readShipFrom();
  if (!base || base.blind === false || !orderId) return base;
  try {
    const r = await q('select store from orders where id=$1', [String(orderId)]);
    const store = String((r.rows[0] && r.rows[0].store) || '').trim();
    return store ? { ...base, name: store } : base;
  } catch { return base; }
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
  // CARRY THE OLD KEY FORWARD. Settings live in a table, so renaming the key in code
  // orphans whatever was configured under the old name and silently reverts to the
  // default — here, resetting every designer's payout rate to 2.50 with nothing said.
  // Read design_fee only when designer_payout has never been written.
  try {
    const has = await q("select 1 from settings where key='designer_payout'");
    if (!has.rowCount) {
      const legacy = await q("select value from settings where key='design_fee'");
      const n = legacy.rows[0] ? Number(legacy.rows[0].value) : NaN;
      if (isFinite(n)) out.designer_payout = n;
    }
  } catch { /* table not ready */ }
  // Text settings read separately — Number() would make NaN of every one of them.
  try {
    const t = await q('select key, value from settings where key = any($1)', [TEXT_KEYS]);
    for (const row of t.rows) {
      const v = typeof row.value === 'string' ? row.value : JSON.stringify(row.value ?? '');
      out[row.key] = String(v).replace(/^"|"$/g, '');
    }
  } catch { /* table not ready */ }
  return out;
}

// The factory READS the design fee, default shipping and embroidery file price to quote a
// job, so the GET stays open to staff. The PUT is a pricing lever — it changes what every
// order costs — so it's admin. Split deliberately: locking the read would break the floor.
export function factorySettingsRoutes(app, requireAuth, requireStaff, requireAdmin) {
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

  // Just the DESIGN fees a seller is actually charged (standard / complex / check) — no
  // cost or margin policy, so it's safe for any signed-in user, like the two reads above.
  // The seller-side design canvas shows a fee estimate from these; the full settings read
  // below stays staff-only.
  app.get('/api/design_fees', { preHandler: requireAuth }, async () => {
    await ensure();
    const nums = await readAll();
    return {
      standard: Number(nums.design_fee_standard) || 0,
      complex: Number(nums.design_fee_complex) || 0,
      check: Number(nums.check_fee) || 0,
    };
  });

  app.get('/api/factory/settings', { preHandler: requireStaff }, async () => {
    await ensure();
    const [nums, shipFrom, retAddr, types, threads] = await Promise.all([readAll(), readShipFrom(), readReturnAddress(), readProductTypes(), readThreadPalette()]);
    return { ...nums, ship_from: shipFrom, ship_from_complete: shipFromComplete(shipFrom), return_address: retAddr, product_types: types, thread_palette: threads };
  });

  app.put('/api/factory/settings', { preHandler: requireAdmin }, async (req, reply) => {
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
    // Supplier-ordering defaults — stored as JSON strings, not coerced to numbers.
    for (const k of TEXT_KEYS) {
      if (b[k] === undefined) continue;
      const v = String(b[k] ?? '').trim();
      await q('insert into settings (key,value,updated_at) values ($1, to_jsonb($2::text), now()) on conflict (key) do update set value=excluded.value, updated_at=now()', [k, v]).catch(() => {});
    }
    if (b.ship_from && typeof b.ship_from === 'object') {
      const addr = {};
      for (const f of SHIP_FROM_FIELDS) addr[f] = String(b.ship_from[f] ?? '').trim();
      addr.country = addr.country || 'US';
      // Blind shipping is a BOOLEAN and must not go through the String() loop above —
      // String(false) is "false", which is truthy, so the off switch would never turn off.
      // Defaults ON: the name above is then a fallback, not what every buyer sees.
      addr.blind = b.ship_from.blind !== false;
      await q('insert into settings (key,value,updated_at) values ($1,$2::jsonb,now()) on conflict (key) do update set value=excluded.value, updated_at=now()', [SHIP_FROM_KEY, JSON.stringify(addr)]);
    }
    if (b.return_address && typeof b.return_address === 'object') {
      const ret = {};
      for (const f of SHIP_FROM_FIELDS) ret[f] = String(b.return_address[f] ?? '').trim();
      ret.country = ret.country || 'US';
      // A blank street means "no separate return address" — store it anyway so clearing the
      // form actually clears it; readReturnAddress() treats a streetless row as unset and
      // the providers then fall back to the sender, which is the pre-existing behaviour.
      await q('insert into settings (key,value,updated_at) values ($1,$2::jsonb,now()) on conflict (key) do update set value=excluded.value, updated_at=now()', [RETURN_ADDRESS_KEY, JSON.stringify(ret)]);
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
