// Otto Cap connector — headwear supplier (OTTO CAP's proprietary API).
// -----------------------------------------------------------------------------
// Auth: OAuth2 PASSWORD grant. Basic auth header = base64(CLIENT_ID:CLIENT_SECRET);
// POST {BASE}/authenticate/token/ with form body username+password+grant_type=password
// → a Bearer access_token, cached until just before it expires. Every other call sends
// Authorization: Bearer <token>. All routes STAFF-gated. Sandbox by default (OTTOCAP_API_BASE).
// Order placement is DRY-RUN unless OTTOCAP_ORDER_LIVE='1'. No route path collides with /api/otto.
//
// Env (see .env.example): OTTOCAP_USERNAME, OTTOCAP_PASSWORD, OTTOCAP_CLIENT_ID,
//   OTTOCAP_CLIENT_SECRET, OTTOCAP_API_BASE (sandbox default), OTTOCAP_ORDER_LIVE (gate).

import { q } from '../db.js';

const OC_USER = (process.env.OTTOCAP_USERNAME || '').trim();
const OC_PASS = (process.env.OTTOCAP_PASSWORD || '').trim();
const OC_CID  = (process.env.OTTOCAP_CLIENT_ID || '').trim();
const OC_SEC  = (process.env.OTTOCAP_CLIENT_SECRET || '').trim();
const OC_BASE = (process.env.OTTOCAP_API_BASE || 'https://sandbox-api.ottocap.com').trim().replace(/\/$/, '');
// Otto's inventory/order "supplier" field is a documented CONSTANT.
const OC_SUPPLIER = '00ceb24d-9b6f-4ba1-91c8-aa375ab96651';

function ocConfigured() { return !!(OC_USER && OC_PASS && OC_CID && OC_SEC); }
const isSandbox = () => /sandbox/i.test(OC_BASE);

// Cached bearer token (Otto's expires_in is ~10h; we refresh a minute early).
let _tok = { value: null, exp: 0 };
async function ocToken() {
  if (!ocConfigured()) throw new Error('Otto Cap not configured (OTTOCAP_USERNAME/PASSWORD/CLIENT_ID/CLIENT_SECRET).');
  if (_tok.value && Date.now() < _tok.exp) return _tok.value;
  const auth = Buffer.from(OC_CID + ':' + OC_SEC).toString('base64');
  const body = new URLSearchParams({ username: OC_USER, password: OC_PASS, grant_type: 'password' });
  const r = await fetch(OC_BASE + '/authenticate/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + auth },
    body
  });
  const text = await r.text(); let d; try { d = JSON.parse(text); } catch (e) { d = null; }
  if (!r.ok || !d || !d.access_token) throw new Error('Otto token failed: HTTP ' + r.status + ' ' + String(text).slice(0, 200));
  _tok = { value: d.access_token, exp: Date.now() + (Math.max(120, d.expires_in || 3600) - 60) * 1000 };
  return _tok.value;
}

async function ocFetch(path, opts) {
  const tok = await ocToken();
  const r = await fetch(OC_BASE + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + tok, Accept: 'application/json' }, (opts && opts.headers) || {})
  }));
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch (e) { data = text; }
  return { ok: r.ok, status: r.status, data };
}
const ocGet = (path) => ocFetch(path, { method: 'GET' });
// Exported so the purchase board can read Otto's per-account payment and shipping methods
// without duplicating the token dance. Read-only GETs only — placing stays in this file,
// behind its live gate.
export const ottoEnabled = () => ocConfigured();
export const ottoGet = (path) => ocGet(path);
const ocPost = (path, b) => ocFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

// Small helper to keep the routes terse + consistent.
function guard(reply) { if (!ocConfigured()) { reply.code(400); return { error: 'Otto Cap not configured.' }; } return null; }
async function passthru(reply, path) {
  try { const r = await ocGet(path); if (!r.ok) { reply.code(502); return { error: 'Otto request failed', status: r.status, detail: r.data }; } return r.data; }
  catch (e) { reply.code(502); return { error: String((e && e.message) || e) }; }
}

/**
 * Route an Otto image through our supplier proxy.
 *
 * Same problem S&S has: the sync stores the supplier's own URL, and a browser loading it
 * from our origin gets blocked or 403'd — it renders as a broken image and never reaches
 * a proxy, so nothing is logged and it looks like "no images" rather than a blocked fetch.
 * Normalising on READ fixes rows already synced, without anyone re-running an import.
 */
/**
 * Our ship-from address → Otto's shape.
 *
 * Theirs is NOT ours: address_1/address_2 rather than street/street2, is_residential
 * required, and state_text only for non-US. Sending our own field names meant Otto
 * received an address with nothing it recognised, which is why every order came back
 * rejected.
 *
 * Returns null when it can't build a valid one, so the caller refuses rather than sending
 * an order with nowhere to be delivered.
 */
// US state name → USPS code. `slice(0,2)` on a full name happens to give "CA" for
// California and "MD" for Maryland, and the WRONG answer for most others — "Texas"
// becomes "TE". Otto reject an invalid code outright, which is the good outcome; a
// plausible-but-wrong one would ship to the wrong state.
const US_STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR',
};
function usStateCode(v) {
  const s2 = String(v || '').trim();
  if (/^[A-Za-z]{2}$/.test(s2)) return s2.toUpperCase();
  return US_STATES[s2.toLowerCase()] || null;
}

function toOttoAddress(a) {
  if (!a || typeof a !== 'object') return null;
  const country = String(a.country || 'US').toUpperCase().slice(0, 2);
  const isUS = country === 'US';
  const state = String(a.state || '').trim();
  const line1 = String(a.street || a.address_1 || '').trim();
  if (!line1 || !a.city || !state || !a.zip) return null;
  // A US address with an unmappable state is refused rather than guessed at.
  if (isUS && !usStateCode(state)) return null;
  return {
    name: String(a.name || a.company || '').slice(0, 100),
    company_name: String(a.company || a.name || '').slice(0, 100),
    email: String(a.email || ''),
    phone: String(a.phone || ''),
    country,
    city: String(a.city),
    // Two-letter code for the US; the full name goes in state_text for anywhere else.
    state: isUS ? (usStateCode(state) || '') : '',
    state_text: isUS ? '' : state,
    zip: String(a.zip).trim(),
    address_1: line1,
    address_2: String(a.street2 || a.address_2 || ''),
    // A warehouse is not a house — and residential delivery costs more.
    is_residential: false,
  };
}

/**
 * Flatten Otto's validation errors into a sentence.
 *
 * They answer in Django REST style: a map of FIELD → [messages], sometimes nested one
 * level for an address ({"shipping_address": {"state": ["..."]}}). Printing the raw JSON
 * technically shows the reason, but it shows it as JSON — and the field name is the most
 * useful part, so it belongs in front of the message rather than buried in braces.
 */
/**
 * A payload safe to hand back, log, or store.
 *
 * Otto have no saved-card concept — their API wants the full PAN, CVV and expiry on
 * EVERY credit-card order. That is fine in flight and unacceptable at rest, and both the
 * dry-run and error paths echo the payload straight back, where the client writes it into
 * purchase_orders.meta. One card number in Postgres would put the whole database in PCI
 * scope, so the card is replaced with a summary here, at the only point every response
 * passes through.
 *
 * The CVV is dropped entirely rather than masked: card networks prohibit storing it in
 * any form, so there is no version of it that belongs in a response.
 */
/** Luhn check — catches a mistyped digit before it becomes a supplier rejection. */
function luhnOk(n) {
  let sum = 0, alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = parseInt(n[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return n.length > 0 && sum % 10 === 0;
}

function safePayload(p) {
  if (!p || typeof p !== 'object') return p;
  const { card_details, ...rest } = p;
  if (!card_details) return rest;
  const n = String(card_details.card_number || '').replace(/\D/g, '');
  return {
    ...rest,
    card_details: {
      name: card_details.name || null,
      card_number: n ? '•••• ' + n.slice(-4) : null,
      exp_date: card_details.exp_date || null,
      // cvv deliberately absent.
    },
  };
}

/**
 * Render one item from an Otto error array.
 *
 * `[].join()` stringifies an object as "[object Object]", which is exactly what a
 * rejected order looked like: "options: [object Object] [object Object] …". Otto were
 * listing the shipping services that WOULD have worked, and we threw that away — the one
 * piece of information that makes the failure fixable. Their option objects are shaped
 * like { code/id, name/label/description }, so name the pair when we can and fall back to
 * compact JSON rather than to nothing.
 */
function describeOttoValue(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  const code = v.code ?? v.id ?? v.value ?? v.service ?? v.shipping_method ?? null;
  const name = v.name ?? v.label ?? v.description ?? v.title ?? null;
  if (code != null && name) return `${name} (${code})`;
  if (name) return String(name);
  if (code != null) return String(code);
  return JSON.stringify(v).slice(0, 120);
}

function describeOttoError(d, prefix = '') {
  if (d == null) return 'no detail returned';
  if (typeof d === 'string') return d.slice(0, 400);
  if (Array.isArray(d)) return d.map((x) => describeOttoError(x, prefix)).filter(Boolean).join('; ');
  if (typeof d !== 'object') return String(d);
  // Their own error envelopes, when present, win over field-by-field.
  if (typeof d.message === 'string') return d.message;
  if (typeof d.detail === 'string') return d.detail;
  const parts = [];
  for (const [field, val] of Object.entries(d)) {
    const label = prefix ? `${prefix}.${field}` : field;
    if (Array.isArray(val)) parts.push(`${label}: ${val.map(describeOttoValue).join(', ')}`);
    else if (val && typeof val === 'object') parts.push(describeOttoError(val, label));
    else if (val != null) parts.push(`${label}: ${val}`);
  }
  return parts.join(' · ').slice(0, 700) || JSON.stringify(d).slice(0, 400);
}

function ottoImg(u) {
  if (!u) return null;
  const s = String(u);
  if (s.startsWith('/api/')) return s;              // already proxied
  if (!/^https?:/i.test(s)) return s;               // relative/unknown — leave it alone
  return '/api/ss/img?u=' + encodeURIComponent(s);  // shared supplier proxy
}

export function ottoCapRoutes(app, requireAuth, requireStaff, requireAdmin, requireWarehouse) {
  // Config + live-token check (never leaks the secrets).
  app.get('/api/otto/status', { preHandler: requireStaff }, async () => {
    const out = { configured: ocConfigured(), base: OC_BASE, sandbox: isSandbox(), supplier: OC_SUPPLIER };
    if (ocConfigured()) { try { await ocToken(); out.auth = 'ok'; } catch (e) { out.auth = 'failed'; out.error = String((e && e.message) || e); } }
    return out;
  });

  // ── Catalog (import-based) ───────────────────────────────────────────────────
  // Otto has NO master product API (confirmed by Otto support): customers download the
  // Product Data export from the dashboard and import it. We store it here and browse
  // from it; live price/stock still comes from the Inventory API per SKU.
  q(`create table if not exists otto_products (
       sku text primary key,
       style text, name text, description text,
       color text, size text, price numeric(12,2),
       image text, category text, data jsonb,
       synced_at timestamptz default now()
     )`).catch(() => {});
  q(`alter table otto_products add column if not exists brand text`).catch(() => {});

  // Import a parsed catalog (array of normalized rows). Admin-only, whole-batch upsert by sku.
  // Populates otto_products — supplier REFERENCE data, the same class of thing
  // /api/ss/sync does, which is requireStaff. It spends nothing, touches no inventory
  // and adds nothing sellable; the catalogue it fills is what someone then builds a
  // product FROM. Admin-only here was inconsistent and blocked operators from the
  // supplier work they do most. Placing an actual supplier ORDER stays warehouse/admin.
  app.post('/api/otto/import', { preHandler: requireStaff }, async (req, reply) => {
    const rows = Array.isArray(req.body?.products) ? req.body.products : [];
    if (!rows.length) { reply.code(400); return { error: 'No products in the payload.' }; }
    let n = 0;
    for (const r of rows) {
      const sku = String(r.sku || '').trim();
      if (!sku) continue;
      await q(
        `insert into otto_products (sku, style, name, description, color, size, price, image, category, brand, data, synced_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         on conflict (sku) do update set style=excluded.style, name=excluded.name, description=excluded.description,
           color=excluded.color, size=excluded.size, price=excluded.price, image=excluded.image,
           category=excluded.category, brand=excluded.brand, data=excluded.data, synced_at=now()`,
        [sku, r.style || null, r.name || null, r.description || null, r.color || null, r.size || null,
         (r.price != null && r.price !== '' && isFinite(Number(r.price))) ? Number(r.price) : null,
         r.image || null, r.category || null, r.brand || null, JSON.stringify(r.data || {})]
      ).catch(() => {});
      n++;
    }
    const c = await q('select count(*)::int as n from otto_products').catch(() => ({ rows: [{ n: 0 }] }));
    return { ok: true, imported: n, total: c.rows[0]?.n || 0 };
  });

  // Catalog status — count + last import time (drives the "import needed" empty state).
  app.get('/api/otto/products/status', { preHandler: requireStaff }, async () => {
    try { const r = await q('select count(*)::int as n, max(synced_at) as last from otto_products'); return { count: r.rows[0]?.n || 0, last: r.rows[0]?.last || null }; }
    catch { return { count: 0, last: null }; }
  });

  // Favorites (shared shortlist across staff), mirroring the S&S favorites endpoints.
  q(`create table if not exists otto_favorites (
       style text primary key, name text, image text, price numeric(12,2),
       created_by text, created_at timestamptz default now()
     )`).catch(() => {});
  app.get('/api/otto/favorites', { preHandler: requireStaff }, async () => {
    try { const r = await q('select style, name, image, price from otto_favorites order by created_at desc'); return { favorites: r.rows.map((x) => ({ ...x, image: ottoImg(x.image) })) }; }
    catch { return { favorites: [] }; }
  });
  app.post('/api/otto/favorites', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const style = String(b.style || '').trim();
    if (!style) { reply.code(400); return { error: 'style required' }; }
    if (b.on === false) { await q('delete from otto_favorites where style=$1', [style]).catch(() => {}); return { ok: true, favorited: false }; }
    await q(
      `insert into otto_favorites (style, name, image, price, created_by) values ($1,$2,$3,$4,$5)
       on conflict (style) do update set name=excluded.name, image=excluded.image, price=excluded.price`,
      [style, b.name || null, b.image || null, (b.price != null && b.price !== '' && isFinite(Number(b.price))) ? Number(b.price) : null, (req.user && req.user.sub) || null]
    ).catch(() => {});
    return { ok: true, favorited: true };
  });

  // Browse the imported catalog, grouped one card per style (fast — images included).
  app.get('/api/otto/products', { preHandler: requireStaff }, async (req, reply) => {
    const search = String(req.query?.search || '').trim().toLowerCase();
    const limit = Math.min(120, Math.max(1, parseInt(req.query?.limit, 10) || 60));
    const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
    const where = search ? `where lower(coalesce(style,'') || ' ' || coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || sku) like $1` : '';
    const params = search ? ['%' + search + '%'] : [];
    try {
      const total = await q(`select count(*)::int as n from (select coalesce(style, sku) g from otto_products ${where} group by coalesce(style, sku)) t`, params);
      const r = await q(
        `select coalesce(style, sku) as style, min(brand) as brand,
                min(name) as name, min(description) as description, min(price) as price, max(price) as price_max,
                (array_agg(image) filter (where image is not null))[1] as image,
                array_agg(distinct color) filter (where color is not null) as colors,
                array_agg(distinct size) filter (where size is not null) as sizes,
                array_agg(distinct sku) as skus,
                min(category) as category
           from otto_products ${where}
          group by coalesce(style, sku)
          order by style
          limit ${limit} offset ${offset}`, params);
      let favs = new Set();
      try { const fr = await q('select style from otto_favorites'); favs = new Set(fr.rows.map((x) => String(x.style))); } catch { /* no favorites table yet */ }
      return { total: total.rows[0]?.n || 0, items: r.rows.map((row) => ({ ...row, favorited: favs.has(String(row.style)) })) };
    } catch (e) { reply.code(500); return { error: String((e && e.message) || e), total: 0, items: [] }; }
  });

  // One product's full detail — all colors (with the photo matching each), sizes, price,
  // every variant SKU. Powers the product view + add-to-catalog (mirrors /api/ss/style/:id).
  app.get('/api/otto/style/:style', { preHandler: requireStaff }, async (req, reply) => {
    const style = String(req.params.style || '').trim();
    if (!style) { reply.code(400); return { error: 'style required' }; }
    try {
      const rows = (await q(
        `select sku, color, size, price, image, name, description, category
           from otto_products where coalesce(style, sku)=$1 order by color, size`, [style])).rows;
      if (!rows.length) { reply.code(404); return { error: 'not found' }; }
      const colorImages = {};
      const colors = [], sizes = [];
      let price = null, name = null, description = null, category = null;
      for (const r of rows) {
        if (r.color && !(r.color in colorImages)) colorImages[r.color] = ottoImg(r.image) || '';
        if (r.color && !colors.includes(r.color)) colors.push(r.color);
        if (r.size && !sizes.includes(r.size)) sizes.push(r.size);
        if (price == null && r.price != null) price = Number(r.price);
        name = name || r.name; description = description || r.description; category = category || r.category;
      }
      return {
        style, name: name || style, description, price, category,
        colors, sizes, colorImages,
        image: ottoImg(rows.find((r) => r.image)?.image || null),
        // Full variant rows. `skus` used to be a bare list of strings, which threw away
        // the colour, size, price and picture the row already had — so the picker showed
        // a column of identical black caps with codes under them and no way to tell which
        // colourway you were ordering. A sku without its colour and size is not orderable
        // information, it's an identifier.
        variants: rows.map((r) => ({
          sku: r.sku,
          color: r.color || null,
          size: r.size || null,
          price: r.price == null ? null : Number(r.price),
          // Per-COLOUR image, falling back to the style's. Ordering a colourway from a
          // photo of a different colour is the mistake this prevents.
          image: ottoImg(r.image) || ottoImg(rows.find((x) => x.color === r.color && x.image)?.image || null),
        })),
        skus: rows.map((r) => r.sku),
      };
    } catch (e) { reply.code(500); return { error: String((e && e.message) || e) }; }
  });

  // Inventory for one sku (Otto's supplier constant injected).
  app.get('/api/otto/inventory', { preHandler: requireStaff }, async (req, reply) => {
    const g = guard(reply); if (g) return g;
    const sku = String(req.query?.sku || '').trim();
    if (!sku) { reply.code(400); return { error: 'sku required' }; }
    return passthru(reply, '/inventory?sku=' + encodeURIComponent(sku) + '&supplier=' + OC_SUPPLIER);
  });

  // Lookups needed to build an order.
  app.get('/api/otto/payment_methods', { preHandler: requireStaff }, async (req, reply) => { const g = guard(reply); if (g) return g; return passthru(reply, '/payment_methods'); });
  app.get('/api/otto/shipping_methods', { preHandler: requireStaff }, async (req, reply) => { const g = guard(reply); if (g) return g; return passthru(reply, '/shipping_methods'); });
  app.get('/api/otto/customers', { preHandler: requireStaff }, async (req, reply) => { const g = guard(reply); if (g) return g; return passthru(reply, '/customers'); });

  // Place an order (PO). SAFETY: dry-run unless OTTOCAP_ORDER_LIVE='1'. With the sandbox base
  // (default) a "live" call is still just a SANDBOX test order — real orders need OTTOCAP_API_BASE
  // pointed at connectivity.ottocap.com AND live credentials from Otto.
  // Placing a supplier order SPENDS REAL MONEY the moment the LIVE flag is set.
  // requireStaff included operator, which contradicts every other spend boundary.
  app.post('/api/otto/order', { preHandler: requireWarehouse }, async (req, reply) => {
    const g = guard(reply); if (g) return g;
    const b = req.body || {};
    const items = (Array.isArray(b.items) ? b.items : [])
      .map((it) => ({ sku: String(it.sku || '').trim(), qty: String(parseInt(it.qty, 10) || 0), supplier: OC_SUPPLIER }))
      .filter((it) => it.sku && parseInt(it.qty, 10) > 0);
    if (!items.length) { reply.code(400); return { error: 'No items — each needs a sku + qty.' }; }
    // Their address shape, not ours. Refuse rather than send a malformed one.
    const ship = toOttoAddress(b.shipping_address);
    if (b.shipping_address && !ship) {
      reply.code(400);
      return { error: 'The warehouse address is incomplete for Otto — it needs a street, city, state and ZIP.' };
    }
    // customer and contact are REQUIRED by their doc and come from GET /customers. Without
    // them Otto rejects the order, so say which is missing rather than letting it fail
    // there with no explanation.
    let shipMethod = b.shipping_method || '';
    if (!shipMethod) {
      // Required. Fall back to Otto's own first listed method so a missing setting
      // doesn't fail the order — and say which was chosen in the response.
      const sm = await ocGet('/shipping_methods').catch(() => null);
      const first = sm && sm.ok && Array.isArray(sm.data) ? sm.data.find((x) => x && x.id) : null;
      if (first) shipMethod = String(first.id);
    }
    if (!shipMethod) {
      reply.code(400);
      return { error: 'Otto require a shipping method and none is set — choose one in Order settings › Delivery.' };
    }
    // Otto restrict payment methods PER CUSTOMER — "This payment method is not allowed
    // for this Customer." Defaulting to net30 guessed on their behalf and failed at their
    // end; making it explicit fails here, where the message can name the setting.
    // Card orders carry the card on the REQUEST. Validate here so an obvious typo fails
    // in a form the person is looking at, rather than as a rejection from Otto.
    let card;
    if (String(b.payment_method || '').toLowerCase().replace(/[^a-z]/g, '') === 'creditcard') {
      const c = b.card_details || {};
      const number = String(c.card_number || '').replace(/\D/g, '');
      const cvv = String(c.cvv || '').replace(/\D/g, '');
      const exp = String(c.exp_date || '').trim();
      const problems = [];
      if (!c.name) problems.push('the name on the card');
      if (number.length < 13 || number.length > 19 || !luhnOk(number)) problems.push('a valid card number');
      if (cvv.length < 3 || cvv.length > 4) problems.push('a 3 or 4 digit CVV');
      if (!/^\d{2}\/\d{2,4}$/.test(exp)) problems.push('an expiry as MM/YY or MM/YYYY');
      if (problems.length) {
        reply.code(400);
        return { error: `Otto need ${problems.join(', ')} for a credit-card order.` };
      }
      card = { name: String(c.name), card_number: number, cvv, exp_date: exp };
    }

    if (!b.payment_method) {
      reply.code(400);
      return { error: 'Otto need a payment method, and which ones are allowed depends on the customer. Choose one in Order settings › Payment.' };
    }
    if (!b.customer || !b.contact) {
      reply.code(400);
      return { error: 'Otto needs a customer and contact id on every order. Pick them in Order settings — they come from your Otto account, not from us.',
               needs: { customer: !b.customer, contact: !b.contact } };
    }

    const payload = {
      payment_method: b.payment_method,
      customer: b.customer,
      contact: b.contact,
      shipping_method: shipMethod,
      third_party_shipping_account_number: b.third_party_shipping_account_number || undefined,
      order_comment: b.order_comment || undefined,
      customer_po: b.customer_po || ('EG-' + Date.now()),
      // Billing defaults to the same address — one warehouse, one account.
      billing_address: toOttoAddress(b.billing_address) || ship || undefined,
      shipping_address: ship || undefined,
      items,
      card_details: card || undefined
    };
    if (String(process.env.OTTOCAP_ORDER_LIVE || '') !== '1') {
      return { dryRun: true, sandbox: isSandbox(), note: 'OTTOCAP_ORDER_LIVE!=1 → NOT sent to Otto. Review the payload; set OTTOCAP_ORDER_LIVE=1 (with the sandbox base) to place a real SANDBOX test order.', payload: safePayload(payload) };
    }
    try {
      const r = await ocPost('/orders/', payload);
      if (!r.ok) {
        reply.code(502);
        // Their words, not ours. "Otto rejected the order" is a sentence we wrote and it
        // tells nobody which field was wrong.
        const d = r.data;
        const why = describeOttoError(d);
        return { error: `Otto rejected the order (${r.status}): ${why}`, status: r.status, detail: d, payload: safePayload(payload) };
      }
      return { ok: true, sandbox: isSandbox(), ottoResponse: r.data };
    }
    catch (e) { reply.code(502); return { error: String((e && e.message) || e) }; }
  });

  /**
   * Shipping details — tracking numbers PER PACKAGE.  GET /orders/{n}/shipments
   *
   * A split shipment has a number per box, and their response nests the items inside each
   * package, so which box holds what is answerable rather than inferred.
   */
  app.get('/api/otto/order/:num/shipments', { preHandler: requireStaff }, async (req, reply) => {
    const g = guard(reply); if (g) return g;
    return passthru(reply, '/orders/' + encodeURIComponent(req.params.num) + '/shipments');
  });

  // Order tracking.
  app.get('/api/otto/order/:num/status', { preHandler: requireStaff }, async (req, reply) => { const g = guard(reply); if (g) return g; return passthru(reply, '/orders/' + encodeURIComponent(req.params.num) + '/status'); });
}
