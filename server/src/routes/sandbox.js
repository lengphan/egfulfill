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
     .catch((e) => { _ready = null; throw e; });
  return _ready;
}

// Resolve the presented API key → the api_keys row (or null). Accepts the key in either
// the X-API-Key header or `Authorization: Bearer egk_…` (the global hook already tried to
// verify() that Bearer as a JWT and got null — harmless; we re-read the raw header here).
async function authKey(req) {
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

export function sandboxRoutes(app, requireAuth) {
  // ─────────────────────────  KEY MANAGEMENT  (session-authed)  ─────────────────────────
  app.get('/api/keys', { preHandler: requireAuth }, async (req) => {
    await ensure();
    const r = await q(
      `select id, label, prefix, mode, created_at, last_used_at, revoked_at
         from api_keys where seller_id=$1 order by created_at desc`, [String(req.user.sub)]);
    return { keys: r.rows };
  });

  app.post('/api/keys', { preHandler: requireAuth }, async (req) => {
    await ensure();
    const mode   = (req.body && req.body.mode === 'live') ? 'live' : 'test';
    const label  = ((req.body && req.body.label) || (mode === 'live' ? 'Live key' : 'Test key')).toString().slice(0, 60);
    const full   = genKey(mode);
    const prefix = full.slice(0, (mode === 'live' ? LIVE_PREFIX : PREFIX).length + 4) + '…';
    const r = await q(
      `insert into api_keys(seller_id, label, prefix, key_hash, mode)
       values($1,$2,$3,$4,$5) returning id, created_at`,
      [String(req.user.sub), label, prefix, hashKey(full), mode]);
    // The full key is returned ONCE here and never again — the UI must tell the user to copy it.
    return { id: r.rows[0].id, key: full, prefix, label, mode, created_at: r.rows[0].created_at };
  });

  app.delete('/api/keys/:id', { preHandler: requireAuth }, async (req) => {
    await ensure();
    await q('update api_keys set revoked_at=now() where id=$1 and seller_id=$2 and revoked_at is null',
      [req.params.id, String(req.user.sub)]);
    return { ok: true };
  });

  // ─────────────────────────  SANDBOX  (/api/test/*, API-KEY-authed)  ────────────────────
  // Every response carries mode:'test' and simulates — nothing here creates real records.
  const requireKey = async (req, reply) => {
    const k = await authKey(req);
    if (!k) {
      reply.code(401);
      return { error: 'Invalid or missing API key', mode: 'test',
        hint: 'Send your test key in the X-API-Key header (or Authorization: Bearer egk_test_…). Generate one in the API Playground.' };
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
    const k = await requireKey(req, reply); if (k.error) return k;
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

  // Insert a REAL order (live keys) for the key's seller, straight into the fulfillment queue.
  async function createRealOrder(sellerId, b) {
    const priced = priceLines(b.items);
    const total = +priced.reduce((s, l) => s + l.line_total, 0).toFixed(2);
    const id = 'API-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const customer = b.customer || (b.shipping_address ? { name: b.shipping_address.name || null } : {});
    await q(`insert into orders (id, seller_id, source, customer, address, status, factory_status, total, created_at, meta)
             values ($1,$2,'api',$3,$4,'new','',$5, now(), $6)`,
      [id, String(sellerId), JSON.stringify(customer), JSON.stringify(b.shipping_address || {}), total,
       JSON.stringify({ external_id: b.external_id || null, via: 'api' })]);
    for (const l of priced) {
      await q(`insert into order_items (order_id, sku, name, qty, color, size, unit_price, print_type)
               values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, l.sku, l.product, l.quantity, l.color, l.size, l.unit_price, l.method]).catch(() => {});
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

  app.get('/api/v1/products', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    if (k.mode === 'live') {
      try { const r = await q('select id, name, type, method, price, base_price from catalog_products order by name limit 200');
        return { object: 'list', mode: 'live', data: r.rows, count: r.rowCount }; }
      catch { return { object: 'list', mode: 'live', data: [], count: 0 }; }
    }
    return { object: 'list', mode: 'test', data: SANDBOX_PRODUCTS, count: SANDBOX_PRODUCTS.length };
  });

  app.post('/api/v1/orders', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : null;
    if (!items || !items.length) return bad(reply, 'An order needs a non-empty "items" array.', ['items']);
    if (!b.shipping_address) return bad(reply, 'An order needs a "shipping_address" object.', ['shipping_address']);
    if (k.mode === 'live') {
      const o = await createRealOrder(k.seller_id, b);
      return { object: 'order', mode: 'live', id: o.id, status: 'received', items: o.items,
        shipping_address: b.shipping_address, totals: { items: o.total, currency: 'USD' }, created: nowISO() };
    }
    const priced = priceLines(items);
    const itemsTotal = +priced.reduce((s, l) => s + l.line_total, 0).toFixed(2);
    return { object: 'order', mode: 'test', id: rid('ord'), status: 'received', items: priced,
      shipping_address: b.shipping_address, totals: { items: itemsTotal, shipping: 4.63, total: +(itemsTotal + 4.63).toFixed(2), currency: 'USD' },
      created: nowISO(), _note: 'Simulated — send a live key (egk_live_…) to create a real order.' };
  });

  app.get('/api/v1/orders/:id', async (req, reply) => {
    const k = await requireKey(req, reply); if (k.error) return k;
    if (k.mode === 'live') {
      try {
        const r = await q('select id, seq, status, factory_status, total, tracking, carrier, created_at from orders where id=$1 and seller_id=$2',
          [req.params.id, String(k.seller_id)]);
        if (!r.rows.length) { reply.code(404); return { error: 'Order not found', mode: 'live' }; }
        const o = r.rows[0];
        return { object: 'order', mode: 'live', id: o.id, status: o.factory_status || o.status || 'received',
          tracking: { carrier: o.carrier || null, code: o.tracking || null }, total: o.total, created: o.created_at };
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
