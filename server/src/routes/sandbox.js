// sandbox.js — Seller-facing API keys + a safe /api/test/* SANDBOX.
//
// Two concerns, one isolated module (so the global JWT auth hook stays untouched):
//   1) Key management  — /api/keys  (SESSION-authed: a seller manages THEIR OWN test keys)
//   2) The sandbox     — /api/test/* (API-KEY-authed: simulates responses, NO side effects —
//                        no real orders, labels, charges, or DB writes beyond last_used_at)
//
// Keys look like  egk_test_xxxxxxxx…  — we store only a SHA-256 hash + a short prefix, and
// return the full key exactly ONCE (on create). Auth is done here, by hashing the presented
// key, so nothing about the global `onRequest`/verify() path changes. api_keys is created
// idempotently at route-load (same pattern as order_designs / wallet_ledger / factory_lists).

import crypto from 'node:crypto';
import { q } from '../db.js';
import { quoteSpec } from '../pricing.js';
import { limited, LIMITS } from '../ratelimit.js';
import { stripMethod } from '../replenish.js';
import { emitWebhook } from '../webhooks.js';

const PREFIX = 'egk_test_';
const LIVE_PREFIX = 'egk_live_';
const genKey  = (mode) => (mode === 'live' ? LIVE_PREFIX : PREFIX) + crypto.randomBytes(24).toString('base64url'); // ~32 url-safe chars
const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');
const rid     = (p) => p + '_' + crypto.randomBytes(8).toString('hex');            // fake object id
const nowISO  = () => new Date().toISOString();

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists api_keys(
    id           bigserial primary key,
    seller_id    text not null,
    label        text,
    prefix       text not null,          -- shown to the user, e.g. egk_test_ab12…
    key_hash     text not null unique,   -- sha256(full key); the full key is never stored
    mode         text not null default 'test',
    created_at   timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at   timestamptz
  )`).then(() => q(`create index if not exists api_keys_seller_idx on api_keys(seller_id)`))
     // What this key is allowed to do. Added after keys already existed, so it is
     // idempotent and EXISTING KEYS KEEP FULL ACCESS: an empty array means "everything",
     // because silently narrowing a key a partner is already using would break their
     // integration at deploy time with no warning. New keys are granted explicitly.
     .then(() => q(`alter table api_keys add column if not exists scopes text[] not null default '{}'`))
     .catch((e) => { _ready = null; throw e; });
  return _ready;
}

// Resolve the presented API key → the api_keys row (or null). Accepts the key in either
// the X-API-Key header or `Authorization: Bearer egk_…` (the global hook already tried to
// verify() that Bearer as a JWT and got null — harmless; we re-read the raw header here).
export async function authKey(req) {
  const hdr  = (req.headers['x-api-key'] || '').toString().trim();
  const bear = (req.headers.authorization || '').match(/^Bearer\s+(egk_[A-Za-z0-9_-]+)\s*$/);
  const key  = hdr.startsWith('egk_') ? hdr : (bear ? bear[1] : '');
  if (!key) return null;
  await ensure();
  const r = await q('select * from api_keys where key_hash=$1 and revoked_at is null', [hashKey(key)]);
  if (!r.rows.length) return null;
  q('update api_keys set last_used_at=now() where id=$1', [r.rows[0].id]).catch(() => {});
  return r.rows[0];
}

// Simulated catalog the sandbox references (kept tiny + stable so examples are reproducible).
const SANDBOX_PRODUCTS = [
  { id: 'gild-64000', name: 'Softstyle T-Shirt',   brand: 'Gildan',           base_price: 8.50,  colors: ['Black','White','Navy','Sport Grey'], sizes: ['S','M','L','XL','2XL'] },
  { id: 'bc-3001',    name: 'Unisex Jersey Tee',   brand: 'Bella+Canvas',     base_price: 10.25, colors: ['Black','White','Heather'],           sizes: ['S','M','L','XL'] },
  { id: 'gild-18500', name: 'Heavy Blend Hoodie',  brand: 'Gildan',           base_price: 18.00, colors: ['Black','Navy','Maroon'],             sizes: ['S','M','L','XL','2XL','3XL'] },
  { id: 'otto-cap-1', name: 'Classic Dad Hat',     brand: 'Otto Cap',         base_price: 6.75,  colors: ['Black','Khaki','Navy'],              sizes: ['OS'] }
];

// Simulated carrier rates for a label/rate request.
function sandboxRates() {
  return [
    { rate_id: rid('rate'), carrier: 'USPS', service: 'Ground Advantage',   amount: 4.63,  currency: 'USD', est_delivery_days: 3 },
    { rate_id: rid('rate'), carrier: 'USPS', service: 'Priority Mail',       amount: 8.10,  currency: 'USD', est_delivery_days: 2 },
    { rate_id: rid('rate'), carrier: 'UPS',  service: 'Ground',              amount: 9.42,  currency: 'USD', est_delivery_days: 3 },
    { rate_id: rid('rate'), carrier: 'FedEx',service: 'Home Delivery',       amount: 10.15, currency: 'USD', est_delivery_days: 3 }
  ];
}

const bad = (reply, msg, fields) => { reply.code(400); return { error: msg, mode: 'test', ...(fields ? { missing: fields } : {}) }; };

// ── Scopes ────────────────────────────────────────────────────────────────────
// A key used to be all-or-nothing: a partner who only needed to push orders held one
// that could also read the whole catalogue and manage webhooks. Least privilege matters
// most for the credential you hand to someone else.
export const API_SCOPES = ['orders.read', 'orders.write', 'products.read', 'webhooks.read', 'webhooks.write', 'billing.read'];

/**
 * Does this key carry `scope`?
 *
 * An EMPTY scopes array means full access. That is deliberate: the column was added to a
 * table that already had keys in it, and defaulting those to "nothing" would have revoked
 * every live integration the moment this deployed. Keys created from now on name their
 * scopes, so the permissive case shrinks to zero on its own.
 */
export const keyAllows = (k, scope) => !k || !Array.isArray(k.scopes) || k.scopes.length === 0 || k.scopes.includes(scope);

export function sandboxRoutes(app, requireAuth) {
  // ─────────────────────────  KEY MANAGEMENT  (session-authed)  ─────────────────────────
  app.get('/api/keys', { preHandler: requireAuth }, async (req) => {
    await ensure();
    const r = await q(
      `select id, label, prefix, mode, scopes, created_at, last_used_at, revoked_at
         from api_keys where seller_id=$1 order by created_at desc`, [String(req.user.sub)]);
    return { keys: r.rows, all_scopes: API_SCOPES };
  });

  app.post('/api/keys', { preHandler: requireAuth }, async (req, reply) => {
    await ensure();
    const mode   = (req.body && req.body.mode === 'live') ? 'live' : 'test';
    const label  = ((req.body && req.body.label) || (mode === 'live' ? 'Live key' : 'Test key')).toString().slice(0, 60);
    const full   = genKey(mode);
    const prefix = full.slice(0, (mode === 'live' ? LIVE_PREFIX : PREFIX).length + 4) + '…';
    // Scopes are opt-in per key. Sending none keeps today's behaviour (full access), so
    // the existing "Generate test key" button doesn't silently start issuing keys that
    // can't do anything — but a caller that names scopes gets exactly those.
    const asked = Array.isArray(req.body && req.body.scopes) ? req.body.scopes.map(String) : [];
    const scopes = asked.filter((s) => API_SCOPES.includes(s));
    if (asked.length && !scopes.length) {
      reply.code(400);
      return { error: 'No recognised scopes.', supported: API_SCOPES };
    }
    const r = await q(
      `insert into api_keys(seller_id, label, prefix, key_hash, mode, scopes)
       values($1,$2,$3,$4,$5,$6) returning id, created_at`,
      [String(req.user.sub), label, prefix, hashKey(full), mode, scopes]);
    // The full key is returned ONCE here and never again — the UI must tell the user to copy it.
    return { id: r.rows[0].id, key: full, prefix, label, mode, scopes, created_at: r.rows[0].created_at };
  });

  app.delete('/api/keys/:id', { preHandler: requireAuth }, async (req) => {
    await ensure();
    await q('update api_keys set revoked_at=now() where id=$1 and seller_id=$2 and revoked_at is null',
      [req.params.id, String(req.user.sub)]);
    return { ok: true };
  });

  // ─────────────────────────  SANDBOX  (/api/test/*, API-KEY-authed)  ────────────────────
  // Every response carries mode:'test' and simulates — nothing here creates real records.
  /**
   * Resolve the key, then charge the request against that key's rate limit.
   *
   * Limiting by KEY, not by IP: a partner behind one NAT would otherwise share a budget
   * with everyone else there, and an attacker rotating IPs would dodge it entirely. The
   * key is the thing we actually bill and revoke, so it is the thing to meter.
   *
   * `orderLimit` gives the expensive paths a tighter ceiling — creating an order writes
   * rows and fires webhooks, so it shouldn't share a budget with cheap catalogue reads.
   */
  const requireKey = async (req, reply, opts = {}) => {
    const { orderLimit = false, scope = null } = typeof opts === 'boolean' ? { orderLimit: opts } : opts;
    const k = await authKey(req);
    if (!k) {
      reply.code(401);
      return { error: 'Invalid or missing API key', mode: 'test',
        hint: 'Send your test key in the X-API-Key header (or Authorization: Bearer egk_test_…). Generate one in the API Playground.' };
    }
    // Scope before rate limit: a call the key may never make shouldn't consume the
    // budget of one it may.
    if (scope && !keyAllows(k, scope)) {
      reply.code(403);
      return { error: `This API key is not allowed to ${scope}.`, code: 'insufficient_scope',
        required: scope, granted: k.scopes || [],
        hint: 'Create a key with this scope in Settings → API keys.' };
    }
    const over = limited(reply, `k:${k.id}`, LIMITS.global);
    if (over) return over;
    if (orderLimit) {
      const overOrders = limited(reply, `ko:${k.id}`, LIMITS.orders);
      if (overOrders) return overOrders;
    }
    return k;
  };

  // Validate the key + reach the sandbox.
  app.get('/api/test/ping', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    return { ok: true, mode: 'test', message: 'Sandbox reachable — your key is valid.', seller_id: k.seller_id, time: nowISO() };
  });

  // List catalog blanks available to print on.
  app.get('/api/test/products', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    return { object: 'list', mode: 'test', data: SANDBOX_PRODUCTS, count: SANDBOX_PRODUCTS.length };
  });

  // Create an order (simulated).
  app.post('/api/test/orders', async (req, reply) => {
    const k = await requireKey(req, reply, true); if (k.error) return k;
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : null;
    if (!items || !items.length) return bad(reply, 'An order needs a non-empty "items" array.', ['items']);
    if (!b.shipping_address) return bad(reply, 'An order needs a "shipping_address" object.', ['shipping_address']);
    const priced = items.map((it, i) => {
      const prod = SANDBOX_PRODUCTS.find((p) => p.id === it.product_id);
      const qty  = Math.max(1, parseInt(it.quantity, 10) || 1);
      const unit = prod ? prod.base_price : (parseFloat(it.unit_price) || 12.0);
      return { line: i + 1, product_id: it.product_id || null, product: prod ? prod.name : (it.name || 'Custom item'),
        color: it.color || null, size: it.size || null, method: it.method || 'DTG', quantity: qty,
        unit_price: +unit.toFixed(2), line_total: +(unit * qty).toFixed(2) };
    });
    const itemsTotal = +priced.reduce((s, l) => s + l.line_total, 0).toFixed(2);
    const shipping   = 4.63;
    return {
      object: 'order', mode: 'test', id: rid('ord'),
      external_id: b.external_id || null,
      status: 'received',
      items: priced,
      shipping_address: b.shipping_address,
      totals: { items: itemsTotal, shipping, total: +(itemsTotal + shipping).toFixed(2), currency: 'USD' },
      created: nowISO(),
      _note: 'Simulated — no real order was created. In production this would enter the fulfillment queue.'
    };
  });

  // Retrieve an order (simulated — echoes the id with a plausible status).
  app.get('/api/test/orders/:id', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    return {
      object: 'order', mode: 'test', id: req.params.id,
      status: 'in_production',
      tracking: { carrier: 'USPS', code: null, url: null },
      timeline: [
        { status: 'received',      at: nowISO() },
        { status: 'in_production', at: nowISO() }
      ],
      _note: 'Simulated lookup — any well-formed id resolves in the sandbox.'
    };
  });

  // Rate-shop a shipment (simulated).
  app.post('/api/test/shipping-rates', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    const b = req.body || {};
    if (!b.to_address) return bad(reply, 'A rate request needs a "to_address" object.', ['to_address']);
    return { object: 'rate_list', mode: 'test', rates: sandboxRates(),
      _note: 'Simulated rates. Buy one with POST /api/test/shipping-labels/domestics.' };
  });

  // Buy a DOMESTIC label (simulated).
  app.post('/api/test/shipping-labels/domestics', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    const b = req.body || {};
    const miss = ['to_address', 'from_address', 'parcel'].filter((f) => !b[f]);
    if (miss.length) return bad(reply, 'A domestic label needs to_address, from_address and parcel.', miss);
    const chosen = sandboxRates()[0];
    const id = rid('lbl');
    return {
      object: 'label', mode: 'test', id,
      carrier: chosen.carrier, service: b.service || chosen.service,
      tracking_code: 'EGTEST' + crypto.randomBytes(5).toString('hex').toUpperCase(),
      rate: { amount: chosen.amount, currency: 'USD' },
      label_url: `https://sandbox.egfulfill.com/labels/${id}.pdf`,
      tracking_url: `https://sandbox.egfulfill.com/track/${id}`,
      created: nowISO(),
      _note: 'Simulated — no label was purchased and no wallet charge was made.'
    };
  });

  // Buy an INTERNATIONAL label (simulated — adds customs).
  app.post('/api/test/shipping-labels/internationals', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    const b = req.body || {};
    const miss = ['to_address', 'from_address', 'parcel', 'customs_items'].filter((f) => !b[f]);
    if (miss.length) return bad(reply, 'An international label needs to_address, from_address, parcel and customs_items.', miss);
    const id = rid('lbl');
    return {
      object: 'label', mode: 'test', id,
      carrier: 'USPS', service: b.service || 'Priority Mail International',
      tracking_code: 'LZ' + crypto.randomBytes(5).toString('hex').toUpperCase() + 'US',
      rate: { amount: 28.40, currency: 'USD' },
      customs: { contents_type: 'merchandise', items: b.customs_items },
      label_url: `https://sandbox.egfulfill.com/labels/${id}.pdf`,
      tracking_url: `https://sandbox.egfulfill.com/track/${id}`,
      created: nowISO(),
      _note: 'Simulated — no label was purchased and no wallet charge was made.'
    };
  });

  // ─────────────────────────  /api/v1/*  (mode-aware: TEST simulates, LIVE is real)  ────────
  // A LIVE key (egk_live_…) makes these do the real thing; a TEST key simulates. Same paths,
  // so a partner flips one key to go from sandbox → production (PayPal-style).
  const priceLines = (items) => (items || []).map((it, i) => {
    const prod = SANDBOX_PRODUCTS.find((p) => p.id === it.product_id);
    const qty  = Math.max(1, parseInt(it.quantity, 10) || 1);
    const unit = (it.unit_price != null && it.unit_price !== '') ? parseFloat(it.unit_price) : (prod ? prod.base_price : 12.0);
    return { line: i + 1, sku: it.product_id || it.sku || null, product: prod ? prod.name : (it.name || 'Custom item'),
      color: it.color || null, size: it.size || null, method: it.method || 'DTG', quantity: qty,
      unit_price: +unit.toFixed(2), line_total: +(unit * qty).toFixed(2) };
  });

  /**
   * Price a LIVE order line from the real catalogue — the same path that bills every
   * other order in the system.
   *
   * priceLines() above is for the SANDBOX: it looks SKUs up in SANDBOX_PRODUCTS (four demo
   * items) and falls back to a flat 12.00. That is fine for a simulation and was very much
   * not fine here — a partner pushing any real SKU created a genuine order in the factory
   * queue at an invented price, and the floor made it.
   *
   * A partner-supplied unit_price is IGNORED. What they pay is ours to compute; letting the
   * caller name our cost means a line arrives at 0.01 and gets produced.
   *
   * No catalogue match means no cost, and no cost means we cannot accept the line —
   * charging 0 fulfils it for free, silently, forever. Same rule quoteOrder() applies to
   * every other order (see `unpriced` in pricing.js).
   */
  async function priceLiveLines(items) {
    const out = [];
    const unpriced = [];
    for (const [i, it] of (items || []).entries()) {
      const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
      const sku = it.product_id || it.sku || null;
      const quote = await quoteSpec({ blank: it.blank || it.product || null, sku, size: it.size, printType: it.method })
        .catch(() => null);
      const unit = quote && quote.unitCost != null ? Number(quote.unitCost) : null;
      if (unit == null) { unpriced.push({ line: i + 1, sku, size: it.size || null, method: it.method || null }); continue; }
      out.push({ line: i + 1, sku, product: (quote.matched && quote.matched.name) || it.name || 'Item',
        color: it.color || null, size: it.size || null, method: it.method || null, quantity: qty,
        unit_price: +unit.toFixed(2), line_total: +(unit * qty).toFixed(2) });
    }
    return { priced: out, unpriced };
  }

  /**
   * Has this seller already sent us this external_id?
   *
   * Without this, a partner whose request times out — and every HTTP client retries a
   * timeout — creates a SECOND order. A second garment is printed, a second charge is
   * taken, and a second parcel goes out. The partner never sees the first response, so
   * they cannot know; the duplicate is entirely our failure to de-duplicate.
   *
   * Keyed on (seller, external_id) so two partners can use overlapping numbering, which
   * they will: "1001" is everybody's first order.
   *
   * A supporting index is created idempotently. It is NOT unique: a unique index would be
   * the stronger guarantee, but creating one fails outright if duplicates already exist
   * in the table, which would take route registration down with it. The check below is
   * therefore last-write-wins under a genuine race — two identical requests arriving in
   * the same millisecond can still both miss. That window is milliseconds against the
   * seconds-to-minutes of a real client retry, which is the case that actually happens.
   */
  q(`create index if not exists orders_external_id_idx on orders (seller_id, (meta->>'external_id'))`).catch(() => {});

  async function findByExternalId(sellerId, externalId) {
    if (!externalId) return null;
    try {
      const r = await q(
        `select id, total, created_at from orders
          where seller_id=$1 and meta->>'external_id' = $2
          order by created_at limit 1`,
        [String(sellerId), String(externalId)]
      );
      return r.rows[0] || null;
    } catch (e) { return null; }
  }

  // Insert a REAL order (live keys) for the key's seller, straight into the fulfillment queue.
  async function createRealOrder(sellerId, b) {
    const { priced, unpriced } = await priceLiveLines(b.items);
    if (unpriced.length) {
      const e = new Error('Some lines have no catalogue match, so they cannot be priced or produced.');
      e.unpriced = unpriced;
      throw e;
    }
    const total = +priced.reduce((s, l) => s + l.line_total, 0).toFixed(2);
    const id = 'API-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const customer = b.customer || (b.shipping_address ? { name: b.shipping_address.name || null } : {});
    await q(`insert into orders (id, seller_id, source, customer, address, status, factory_status, total, created_at, meta)
             values ($1,$2,'api',$3,$4,'new','',$5, now(), $6)`,
      [id, String(sellerId), JSON.stringify(customer), JSON.stringify(b.shipping_address || {}), total,
       JSON.stringify({ external_id: b.external_id || null, via: 'api' })]);
    let li = 0;
    for (const l of priced) {
      // Mint a stable line_id so every API-sourced line is addressable (blank/variant picking,
      // per-line status/design) and identical-SKU siblings never collide — same guarantee the
      // Etsy/Shopify/TikTok importers give their lines.
      const lineId = `API${(li++).toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      await q(`insert into order_items (order_id, sku, name, qty, color, size, unit_price, print_type, line_id)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, l.sku, l.product, l.quantity, l.color, l.size, l.unit_price, l.method, lineId]).catch(() => {});
    }
    // Confirm intake to the pusher's own endpoints. Sounds redundant — they just made
    // this call — but a partner fanning orders across several fulfillers uses it as the
    // acknowledgement that it landed HERE, and it's the delivery that proves their
    // webhook wiring works before a real shipment depends on it.
    emitWebhook(sellerId, 'order.received', { id, total, items: priced, shipping_address: b.shipping_address ?? null });
    return { id, total, items: priced };
  }

  app.get('/api/v1/ping', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    return { ok: true, mode: k.mode, live: k.mode === 'live', seller_id: k.seller_id, time: nowISO(),
      message: k.mode === 'live' ? 'Live API reachable — calls create real records.' : 'Sandbox reachable — your test key is valid.' };
  });

  // The REAL catalogue in both modes. A test key used to get four demo products while
  // orders are priced from the real one — so a partner would read this list, order
  // gild-64000 from it, and be told it doesn't exist. A catalogue you can't order from
  // is worse than no catalogue. Nothing here is sensitive: it's the same blank list a
  // signed-in seller browses, and supplier cost is not among these columns.
  app.get('/api/v1/products', async (req, reply) => {
    const k = await requireKey(req, reply, { scope: 'products.read' }); if (k.error) return k;
    try {
      const r = await q('select id, sku, name, type, method, price, base_price from catalog_products order by name limit 200');
      return { object: 'list', mode: k.mode, data: r.rows, count: r.rowCount };
    } catch { return { object: 'list', mode: k.mode, data: [], count: 0 }; }
  });

  app.post('/api/v1/orders', async (req, reply) => {
    const k = await requireKey(req, reply, { orderLimit: true, scope: 'orders.write' }); if (k.error) return k;
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : null;
    if (!items || !items.length) return bad(reply, 'An order needs a non-empty "items" array.', ['items']);
    if (!b.shipping_address) return bad(reply, 'An order needs a "shipping_address" object.', ['shipping_address']);
    if (k.mode === 'live') {
      // Retry-safe. Returning the ORIGINAL order (200, not 409) is what makes this
      // usable: a client that retried a timeout gets the same answer it would have had,
      // and needs no special case for "already exists". `idempotent: true` is there so a
      // partner CAN tell the difference when debugging.
      const existing = await findByExternalId(k.seller_id, b.external_id);
      if (existing) {
        return { object: 'order', mode: 'live', id: existing.id, status: 'received',
          idempotent: true, totals: { items: Number(existing.total) || 0, currency: 'USD' },
          created: existing.created_at,
          _note: 'An order with this external_id already exists — returning it rather than creating a duplicate.' };
      }
      // An unpriceable line is a 400 the partner can act on, not a 500. Naming the exact
      // lines matters: "order failed" sends them hunting, and the usual cause is a SKU
      // that exists in their catalogue and not in ours.
      let o;
      try { o = await createRealOrder(k.seller_id, b); }
      catch (e) {
        if (e && e.unpriced) {
          reply.code(400);
          return { error: e.message, code: 'unpriceable_lines', unpriced: e.unpriced,
            detail: 'Every line must match a catalogue product. Check the sku, size and print method against GET /api/v1/products.' };
        }
        throw e;
      }
      return { object: 'order', mode: 'live', id: o.id, status: 'received', items: o.items,
        shipping_address: b.shipping_address, totals: { items: o.total, currency: 'USD' }, created: nowISO() };
    }
    // SANDBOX — simulated, but it must REACH THE SAME VERDICT as live.
    //
    // The whole promise of this sandbox is that a partner builds against it and then
    // flips one key (see the note above priceLines). Pricing live from the catalogue
    // while the sandbox still honoured a caller-supplied unit_price and accepted any SKU
    // broke exactly that: you would integrate cleanly in test and collect 400s in
    // production, which is the one failure a sandbox exists to prevent.
    //
    // So the same rules run here — catalogue pricing, caller price ignored, unknown SKU
    // refused. The ONLY difference is that nothing is written and no webhook fires.
    const { priced, unpriced } = await priceLiveLines(items);
    if (unpriced.length) {
      reply.code(400);
      return { error: 'Some lines have no catalogue match, so they cannot be priced or produced.',
        code: 'unpriceable_lines', mode: 'test', unpriced,
        detail: 'Every line must match a catalogue product. Check the sku, size and print method against GET /api/v1/products. Live keys are refused the same way.' };
    }
    const itemsTotal = +priced.reduce((s, l) => s + l.line_total, 0).toFixed(2);
    const testId = rid('ord');
    // Test-mode orders DO fire order.received, marked test:true.
    //
    // They used to fire nothing, which meant the sandbox could not exercise the one
    // thing partners most need to get right before going live — and the only way to see
    // a real order.received was to put an actual order through the factory. Stripe's
    // test mode delivers webhooks for exactly this reason; the flag is what keeps it
    // honest, not silence.
    emitWebhook(k.seller_id, 'order.received', {
      test: true, id: testId, status: 'received', items: priced,
      shipping_address: b.shipping_address ?? null,
      total: +(itemsTotal + 4.63).toFixed(2),
      _note: 'Simulated order — nothing was created in the factory.',
    });
    return { object: 'order', mode: 'test', id: testId, status: 'received', items: priced,
      shipping_address: b.shipping_address, totals: { items: itemsTotal, shipping: 4.63, total: +(itemsTotal + 4.63).toFixed(2), currency: 'USD' },
      created: nowISO(), _note: 'Simulated — nothing was created in the factory, but order.received WAS delivered to your webhooks (test:true). Prices and validation match live exactly; send a live key (egk_live_…) to create a real order.' };
  });

  // ── Stock ──────────────────────────────────────────────────────────────────
  // What we can actually make right now. A network routes work by capacity, so without
  // this a partner either sends orders we cannot fill or does not send them at all.
  //
  // We publish AVAILABLE only — not in_stock and reserved separately. Available is what
  // a partner needs to decide whether to route; the split between held and committed
  // would also tell them how much work we are carrying, which is our business volume and
  // none of theirs.
  //
  // Keyed by BLANK sku with the print-method suffix stripped, using the same helper
  // replenishment uses: the shelf holds LA6, an order line is LA6-EMB. Two copies of that
  // rule drifting is how a partner gets told a full shelf is empty.
  app.get('/api/v1/stock', async (req, reply) => {
    const k = await requireKey(req, reply, { scope: 'products.read' }); if (k.error) return k;
    const want = String((req.query || {}).sku || '').trim();
    try {
      const params = [];
      let where = '';
      if (want) { params.push(stripMethod(want).toUpperCase()); where = 'where upper(sku) = $1'; }
      const r = await q(
        `select sku, name, variant, in_stock, reserved, reorder_at, category
           from inventory ${where} order by sku limit 1000`, params);
      const data = r.rows.map((row) => {
        const available = Math.max(0, (Number(row.in_stock) || 0) - (Number(row.reserved) || 0));
        const reorderAt = Number(row.reorder_at) || 0;
        return {
          sku: row.sku, name: row.name || null, variant: row.variant || null,
          category: row.category || null,
          available,
          // Banded as well as numeric: "12 left" means nothing without knowing where the
          // reorder point sits, and the band is what a routing decision actually keys on.
          status: available <= 0 ? 'out_of_stock' : (reorderAt > 0 && available <= reorderAt ? 'low' : 'in_stock'),
        };
      });
      return { object: 'list', mode: k.mode, data, count: data.length,
        _note: 'available = on hand minus already committed. Stock is held per BLANK sku; a print-method suffix (-EMB, -DTG, …) is stripped before matching.' };
    } catch (e) { reply.code(500); return { error: 'Could not read stock.' }; }
  });

  // ── Billing ────────────────────────────────────────────────────────────────
  // How a partner answers "what do I owe you, and for what".
  //
  // Read-only, straight off wallet_ledger, which is append-only — so a statement for a
  // past period cannot change after the fact. No invoice OBJECT is invented: an invoice
  // that lives in its own table can disagree with the ledger, and then two systems both
  // claim to know what is owed. The ledger is the single source; this presents it.
  //
  // Money is numeric(12,2) and node-pg hands numerics back as STRINGS, so every value is
  // parsed before arithmetic — concatenating two charges instead of adding them is the
  // classic way this goes wrong silently.
  const money = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;

  app.get('/api/v1/balance', async (req, reply) => {
    const k = await requireKey(req, reply, { scope: 'billing.read' }); if (k.error) return k;
    try {
      const r = await q('select coalesce(sum(delta),0) as bal from wallet_ledger where account=$1', [String(k.seller_id)]);
      const balance = money(r.rows[0] && r.rows[0].bal);
      return { object: 'balance', mode: k.mode, account: String(k.seller_id), balance, currency: 'USD',
        note: balance < 0 ? 'Negative balance means charges exceed funds on account.' : undefined };
    } catch (e) { reply.code(500); return { error: 'Could not read balance.' }; }
  });

  app.get('/api/v1/statement', async (req, reply) => {
    const k = await requireKey(req, reply, { scope: 'billing.read' }); if (k.error) return k;
    const qy = req.query || {};
    // Default to the current calendar month — the period anyone reconciling actually wants.
    const now = new Date();
    const from = String(qy.from || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10));
    const to = String(qy.to || now.toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return bad(reply, 'from and to must be YYYY-MM-DD dates.', ['from', 'to']);
    }
    try {
      const acct = String(k.seller_id);
      // Opening balance is everything BEFORE the window — without it the closing figure
      // can't be checked against anything and the statement is just a list.
      const open = await q('select coalesce(sum(delta),0) as bal from wallet_ledger where account=$1 and created_at < $2::date',
        [acct, from]).then((r) => money(r.rows[0] && r.rows[0].bal));
      // `to` is inclusive: a partner asking for 01→31 means the whole 31st, so compare
      // against the following midnight rather than dropping the last day's charges.
      const r = await q(
        `select id, created_at, type, ref, note, delta, order_id
           from wallet_ledger
          where account=$1 and created_at >= $2::date and created_at < ($3::date + interval '1 day')
          order by created_at, id`,
        [acct, from, to]
      );
      let running = open;
      const lines = r.rows.map((row) => {
        const amount = money(row.delta);
        running = money(running + amount);
        return { id: String(row.id), date: row.created_at, type: row.type,
          order_id: row.order_id || null, reference: row.ref || null,
          description: row.note || row.type, amount, balance: running };
      });
      const sum = (f) => money(lines.filter(f).reduce((s, l) => s + l.amount, 0));
      return {
        object: 'statement', mode: k.mode, account: acct, currency: 'USD',
        period: { from, to },
        opening_balance: open,
        closing_balance: running,
        totals: {
          charges: sum((l) => l.amount < 0),
          credits: sum((l) => l.amount > 0),
          net: money(running - open),
        },
        lines,
        _note: 'Charges are negative, credits positive. The ledger is append-only, so a closed period never changes.',
      };
    } catch (e) { reply.code(500); return { error: 'Could not build statement.' }; }
  });

  app.get('/api/v1/orders/:id', async (req, reply) => {
    const k = await requireKey(req, reply, { scope: 'orders.read' }); if (k.error) return k;
    if (k.mode === 'live') {
      try {
        const r = await q('select id, seq, status, factory_status, total, tracking, carrier, created_at, meta from orders where id=$1 and seller_id=$2',
          [req.params.id, String(k.seller_id)]);
        if (!r.rows.length) { reply.code(404); return { error: 'Order not found', mode: 'live' }; }
        const o = r.rows[0];
        // A cancelled order without a reason makes the partner phone someone. Polling is
        // also how they'd learn about a refusal if their webhook was down, so it has to
        // be readable here and not only in the event.
        const rej = (o.meta && o.meta.rejection) || null;
        return { object: 'order', mode: 'live', id: o.id, status: o.factory_status || o.status || 'received',
          tracking: { carrier: o.carrier || null, code: o.tracking || null }, total: o.total, created: o.created_at,
          ...(rej ? { reason: rej.reason || null, rejected_by: rej.by || 'factory', rejected_at: rej.at || null } : {}) };
      } catch (e) { reply.code(500); return { error: String((e && e.message) || e), mode: 'live' }; }
    }
    return { object: 'order', mode: 'test', id: req.params.id, status: 'in_production',
      tracking: { carrier: 'USPS', code: null, url: null }, _note: 'Simulated lookup.' };
  });

  // ── Shipping (v1) ──────────────────────────────────────────────────────────
  // NOT IMPLEMENTED, and it must say so.
  //
  // These returned a 200 with invented data in BOTH modes: a fabricated tracking code
  // (EGTEST…), a hardcoded rate, and a label_url under sandbox.egfulfill.com. A partner
  // integrating against the LIVE namespace had no way to tell that apart from a real
  // purchase — and a fake tracking code is not a harmless placeholder. It reaches a
  // buyer, who watches a number that will never move.
  //
  // A 501 costs an integrator ten minutes. A fake tracking number costs them a customer.
  // The /api/test/* twins keep returning samples: simulated is what a test key is FOR,
  // and they are named so nobody mistakes them for a purchase.
  const notImplemented = (reply, what) => {
    reply.code(501);
    return {
      error: `${what} is not available through the API yet.`,
      code: 'not_implemented',
      detail: 'EGFULFILL buys carrier labels internally when it ships your order; it does not resell label purchasing. Fulfilment orders placed via POST /api/v1/orders are shipped and tracked for you — read tracking back from GET /api/v1/orders/{id}.',
      sandbox: 'The /api/test/ equivalents return sample payloads if you are building against the shape.',
    };
  };
  app.post('/api/v1/shipping-rates', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    return notImplemented(reply, 'Shipping rate shopping');
  });
  app.post('/api/v1/shipping-labels/domestics', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    return notImplemented(reply, 'Domestic label purchasing');
  });
  app.post('/api/v1/shipping-labels/internationals', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    return notImplemented(reply, 'International label purchasing');
  });
}
