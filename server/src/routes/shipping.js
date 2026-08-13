// Unified shipping: rate-shop + buy labels across EasyPost and Shippo with one API.
// Whichever provider has a key set is used; if both are set, rates from both are
// merged and sorted cheapest-first. This gives discounted USPS + UPS labels without
// the USPS direct-integration approval (EPS / Labels scope).
//
// .env:  EASYPOST_API_KEY=EZTK.../EZAK...   SHIPPO_API_TOKEN=shippo_test_.../shippo_live_...
//
// Endpoints (all requireStaff):
//   GET  /api/shipping/config           → which providers are enabled
//   GET  /api/shipping/test             → live key check per provider
//   POST /api/shipping/rates  {to,from,parcel}            → merged rate list
//   POST /api/shipping/label  {rateToken} | {to,from,parcel} → buy (specific or cheapest)
//   GET  /api/shipping/track?provider=&carrier=&tracking=  → status
import { q } from '../db.js';
import { recordUsage } from '../usage.js';
import { shipFromForOrder, readReturnAddress } from './factory_settings.js';

// Read at CALL time, not import time. Saving a credential in Settings › Integrations
// writes it to the DB and applies it to process.env immediately (see secrets.js), but a
// module-level `const KEY = process.env.X` snapshots the value at boot — so the running
// code kept using the old (usually empty) one and the UI appeared to do nothing until a
// redeploy. Functions close that gap: paste a key, use it on the next request.
const epKey = () => (process.env.EASYPOST_API_KEY || '').trim();
const shToken = () => (process.env.SHIPPO_API_TOKEN || '').trim();
const EP_BASE = 'https://api.easypost.com/v2';
const SH_BASE = 'https://api.goshippo.com';

let export_refreshTracking;
/** The tracking refresher, reachable from other routes. Assigned when shippingRoutes runs
 *  (it closes over the app's config), so callers must tolerate it being undefined before
 *  registration — hence the guard rather than a bare call. */
export function refreshTrackingFor(orderId) {
  return export_refreshTracking ? export_refreshTracking(orderId) : Promise.resolve({ ok: false, reason: 'not-ready' });
}
const epAuth = () => 'Basic ' + Buffer.from(epKey() + ':').toString('base64');
const shAuth = () => 'ShippoToken ' + shToken();

function enc(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64'); }
function dec(tok) { try { return JSON.parse(Buffer.from(String(tok || ''), 'base64').toString('utf8')); } catch (e) { return null; } }

// USPS requires the SENDER to have a phone or email. The label modal doesn't collect
// them, so default the sender's contact (override via env).
const SHIP_FROM_PHONE = process.env.SHIP_FROM_PHONE || '5555555555';
const SHIP_FROM_EMAIL = process.env.SHIP_FROM_EMAIL || 'fulfillment@egful.store';

// Normalize an address from the frontend → provider shape. isSender → fill the
// contact defaults USPS demands on the from address.
function addr(a, isSender) {
  a = a || {};
  return {
    name: a.name || '', street1: a.street1 || a.street || '', street2: a.street2 || '',
    city: a.city || '', state: a.state || '', zip: a.zip || '', country: a.country || 'US',
    phone: a.phone || (isSender ? SHIP_FROM_PHONE : ''), email: a.email || (isSender ? SHIP_FROM_EMAIL : '')
  };
}
function parcel(p) {
  p = p || {};
  return {
    length: Number(p.length) || 9, width: Number(p.width) || 6, height: Number(p.height) || 2,
    weightOz: Math.max(1, Number(p.weightOz) || Number(p.weight) || 8)
  };
}

// ── EasyPost ──────────────────────────────────────────────────────────────────
async function epRates(to, from, pc) {
  // Where an undeliverable parcel goes back to. Read here rather than threaded through
  // every caller: this function is the single place EasyPost shipments are created, so a
  // caller can't forget it. Unset → omitted → EasyPost falls back to from_address, which
  // is exactly the behaviour before a separate return address existed.
  const ret = await readReturnAddress();
  const body = { shipment: {
    to_address: { name: to.name, street1: to.street1, street2: to.street2, city: to.city, state: to.state, zip: to.zip, country: to.country, phone: to.phone },
    from_address: { name: from.name, street1: from.street1, street2: from.street2, city: from.city, state: from.state, zip: from.zip, country: from.country, phone: from.phone },
    parcel: { length: pc.length, width: pc.width, height: pc.height, weight: pc.weightOz },
    ...(ret ? { return_address: { name: ret.name, company: ret.company, street1: ret.street, street2: ret.street2, city: ret.city, state: ret.state, zip: ret.zip, country: ret.country || 'US', phone: ret.phone } } : {})
  } };
  const r = await fetch(EP_BASE + '/shipments', { method: 'POST', headers: { Authorization: epAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && (d.error.message || JSON.stringify(d.error))) || ('EasyPost HTTP ' + r.status));
  return (d.rates || []).map((rt) => ({
    token: enc({ p: 'ep', s: d.id, r: rt.id }),
    provider: 'easypost', carrier: rt.carrier, service: rt.service,
    amount: Number(rt.rate), currency: rt.currency || 'USD',
    days: rt.delivery_days != null ? rt.delivery_days : null
  }));
}
async function epBuy(shipmentId, rateId) {
  const r = await fetch(EP_BASE + '/shipments/' + encodeURIComponent(shipmentId) + '/buy', {
    method: 'POST', headers: { Authorization: epAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate: { id: rateId } })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.tracking_code) throw new Error((d.error && (d.error.message || JSON.stringify(d.error))) || ('EasyPost buy HTTP ' + r.status));
  const sr = d.selected_rate || {};
  recordUsage('easypost', { endpoint: 'buy', ok: true }); // $ tracked in wallet_ledger (label-cost); count volume only
  return {
    provider: 'easypost', carrier: sr.carrier || '', service: sr.service || '',
    cost: Number(sr.rate) || null, tracking: d.tracking_code,
    labelUrl: (d.postage_label && (d.postage_label.label_url || d.postage_label.label_pdf_url)) || '',
    // The provider's own id, needed to void the label later. Tracking alone can't
    // address a refund with either provider.
    providerId: d.id || shipmentId,
    // EasyPost has no manifest concept in this integration; recorded as empty so the
    // manifest route can tell "wrong provider" from "we forgot to store it".
    carrierAccount: ''
  };
}

// ── Shippo ────────────────────────────────────────────────────────────────────
async function shRates(to, from, pc, extra) {
  // Same as EasyPost: resolved at the one place Shippo shipments are built. Shippo falls
  // back to address_from when address_return is absent.
  const ret = await readReturnAddress();
  const body = {
    address_from: { name: from.name, street1: from.street1, street2: from.street2, city: from.city, state: from.state, zip: from.zip, country: from.country, phone: from.phone, email: from.email },
    address_to: { name: to.name, street1: to.street1, street2: to.street2, city: to.city, state: to.state, zip: to.zip, country: to.country, phone: to.phone, email: to.email },
    parcels: [{ length: String(pc.length), width: String(pc.width), height: String(pc.height), distance_unit: 'in', weight: String(pc.weightOz), mass_unit: 'oz' }],
    ...(ret ? { address_return: { name: ret.name, company: ret.company, street1: ret.street, street2: ret.street2, city: ret.city, state: ret.state, zip: ret.zip, country: ret.country || 'US', phone: ret.phone, email: ret.email } } : {}),
    async: false
  };
  // Optional add-ons. Shippo carries `extra` on the SHIPMENT through to the bought
  // transaction, and both add to the quoted amount — so setting them here means the
  // rate we buy already includes them. Only sent when asked, so a plain label is
  // unchanged and a provider that rejects the field can't break the common path.
  if (extra && (extra.signature || (Number(extra.insurance) > 0))) {
    body.extra = {};
    if (extra.signature) body.extra.signature_confirmation = extra.signature === true ? 'STANDARD' : String(extra.signature);
    if (Number(extra.insurance) > 0) body.extra.insurance = { amount: Number(extra.insurance).toFixed(2), currency: 'USD' };
  }
  const r = await fetch(SH_BASE + '/shipments/', { method: 'POST', headers: { Authorization: shAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.detail || JSON.stringify(d)).slice(0, 200));
  return (d.rates || []).map((rt) => ({
    token: enc({ p: 'sh', r: rt.object_id }),
    provider: 'shippo', carrier: rt.provider, service: (rt.servicelevel && rt.servicelevel.name) || rt.servicelevel_name || '',
    amount: Number(rt.amount), currency: rt.currency || 'USD',
    days: rt.estimated_days != null ? rt.estimated_days : null,
    // THE RATE IS THE ONLY PLACE THIS EXISTS. Shippo puts carrier_account on the rate and
    // then returns `rate` as a bare id STRING on the bought transaction, so shBuy cannot
    // read it back afterwards — it has to be carried from here to the buy or it is lost.
    // Dropping it is why every label ever bought recorded an empty account and every one
    // of them is refused by the SCAN form (manifests.js:119).
    carrierAccount: rt.carrier_account || ''
  }));
}
// `sel` is the rate we picked at rate-shop time ({amount, carrier, service}). Shippo
// returns the transaction's `rate` as a bare object-id STRING, not an expanded object, so
// d.rate.amount / d.rate.provider are undefined — which is why cost came back null and the
// Price column stayed empty. Read the amount/carrier from the rate we already have; only
// fall back to d.rate.* on the rare occasion Shippo expands it.
/**
 * OUR ORDER → THE ONE SHIPPO IMPORTED FROM THE CONNECTED SHOP.
 *
 * This is what makes tracking reach Etsy. Our own Etsy app is on a restricted tier, so
 * POST /receipts/:id/tracking answers 403 and we cannot tell Etsy anything ourselves. Shippo
 * can — but ONLY for an order it imported from a shop connected to it, and only when the
 * label is linked to that order. Shippo support was explicit: a standalone transaction, or
 * an order we create through their API with shop_app "Etsy", does NOT establish the
 * relationship. So the link has to be to THEIR imported order, found by number.
 *
 * Matching is exact, not fuzzy: Shippo's `order_number` for an Etsy order is the bare
 * receipt id and ours is that id behind an `etsy-` prefix (etsy-4143352005 → 4143352005).
 *
 * Their list endpoint cannot filter by order_number — only order_status and shop_app — so
 * this reads a page and matches here, newest first, which is where a label being bought
 * today will be. Cached per order id because a label is usually bought once and the answer
 * cannot change.
 *
 * NEVER THROWS. A label that is already paid for must not fail because we couldn't find its
 * counterpart; an unlinked label is a working label with no write-back, which is exactly
 * where we are today.
 */
const shOrderCache = new Map();
async function shFindOrder(orderId) {
  const m = /^etsy-(.+)$/i.exec(String(orderId || ''));
  if (!m) return null;                       // only marketplace orders Shippo can have imported
  const number = m[1];
  if (shOrderCache.has(number)) return shOrderCache.get(number);
  // The column the address sync writes — one read, and it keeps working at any order count.
  try {
    const row = (await q('select shippo_order_id from orders where id = $1', [orderId])).rows[0];
    if (row && row.shippo_order_id) { shOrderCache.set(number, row.shippo_order_id); return row.shippo_order_id; }
  } catch { /* column may not exist yet on a database that has never synced */ }
  // Fallback for an order synced into Shippo since our last address pass: ask directly.
  try {
    const r = await fetch(SH_BASE + '/orders?results=100', { headers: { Authorization: shAuth() } });
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    const hit = (d.results || []).find((o) => String(o.order_number || '').trim() === number);
    const id = hit ? hit.object_id : null;
    shOrderCache.set(number, id);
    return id;
  } catch { return null; }
}

/**
 * THE ADDRESSES OUR OWN API IS NOT ALLOWED TO SEE.
 *
 * Etsy withholds buyer addresses from an app on the restricted tier, so every one of our
 * Etsy orders reads "Not available yet" and a label cannot be bought without someone
 * copying the address across by hand. Shippo's Etsy app is not restricted: an order it
 * imported from a connected shop arrives complete, address and all.
 *
 * So this reads them back. Marked `source: 'shippo'` rather than passed off as a sync,
 * because how we came to know an address is real operational information — see
 * addressSource in lib/order-format.ts.
 *
 * ONLY EVER FILLS A BLANK. The guard is repeated inside the UPDATE, not just in the SELECT,
 * so an address typed by hand between the two statements cannot be overwritten by this.
 * CLAUDE.md §2.6: a sync may fill a gap, never blank or replace a fact.
 */
export async function fillBlankAddressesFromShippo(limit = 100) {
  if (!shToken()) return { filled: 0, reason: 'no-shippo-token' };
  const blank = `coalesce(address->>'street', address->>'line1', address->>'first_line', address->>'address1', '') = ''`;
  try {
    const r = await fetch(SH_BASE + `/orders?results=${Math.min(250, Math.max(1, limit))}`, { headers: { Authorization: shAuth() } });
    if (!r.ok) return { filled: 0, reason: 'shippo HTTP ' + r.status };
    const d = await r.json().catch(() => ({}));
    const byNumber = new Map();
    const shippoIds = new Map();
    for (const o of (d.results || [])) {
      const n = String(o.order_number || '').trim();
      if (!n) continue;
      if (o.object_id) shippoIds.set(n, o.object_id);
      if (o.to_address && o.to_address.street1) byNumber.set(n, o.to_address);
    }
    if (!byNumber.size) return { filled: 0, seen: 0 };
    const ids = [...byNumber.keys()].map((n) => 'etsy-' + n);

    /**
     * REMEMBER WHICH SHIPPO ORDER IS WHICH, while we are holding the answer.
     *
     * The label buy needs this id to link a transaction, and Shippo's list endpoint cannot
     * be filtered by order_number — so looking it up at buy time means listing orders and
     * scanning, which works at 34 orders and silently stops working past the page size.
     * Recorded here instead, for every order matched rather than only the ones missing an
     * address, so the buy is a column read.
     */
    await q('alter table orders add column if not exists shippo_order_id text').catch(() => {});
    let linked = 0;
    for (const [num, addr] of byNumber) {
      const shippoId = shippoIds.get(num);
      if (!shippoId) continue;
      const r2 = await q(
        `update orders set shippo_order_id = $2 where id = $1 and shippo_order_id is distinct from $2`,
        ['etsy-' + num, shippoId]).catch(() => null);
      if (r2 && r2.rowCount) linked++;
      void addr;
    }

    const rows = (await q(`select id from orders where id = any($1::text[]) and ${blank}`, [ids])).rows;
    let filled = 0;
    for (const row of rows) {
      const a = byNumber.get(String(row.id).replace(/^etsy-/i, ''));
      if (!a) continue;
      const upd = await q(
        `update orders set address = jsonb_strip_nulls($2::jsonb) where id = $1 and ${blank}`,
        [row.id, JSON.stringify({
          name: a.name || null, street: a.street1 || null, street2: a.street2 || null,
          city: a.city || null, state: a.state || null, zip: a.zip || null,
          country: a.country || 'US', source: 'shippo',
        })]).catch(() => null);
      if (upd && upd.rowCount) filled++;
    }
    return { filled, linked, seen: shippoIds.size, blank: rows.length };
  } catch (e) {
    return { filled: 0, reason: (e && e.message) || 'failed' };
  }
}

async function shBuy(rateObjectId, sel, orderId) {
  // Linked when we can find it, plain when we can't — see shFindOrder.
  const shippoOrder = orderId ? await shFindOrder(orderId) : null;
  const r = await fetch(SH_BASE + '/transactions/', {
    method: 'POST', headers: { Authorization: shAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate: rateObjectId, label_file_type: 'PDF_4x6', async: false,
                           ...(shippoOrder ? { order: shippoOrder } : {}) })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.status !== 'SUCCESS') {
    const msg = (d.messages && d.messages.map((m) => m.text).join('; ')) || d.detail || ('Shippo buy HTTP ' + r.status);
    throw new Error(msg);
  }
  const rate = (d.rate && typeof d.rate === 'object') ? d.rate : null;   // usually a string id
  sel = sel || {};
  recordUsage('shippo', { endpoint: 'buy', ok: true }); // $ tracked in wallet_ledger (label-cost); count volume only
  return {
    provider: 'shippo',
    // A TEST-MODE LABEL COSTS NOTHING, and the buy response is the only place that says so.
    // Shippo's test environment quotes real-looking prices against a shippo_test_ token and
    // charges none of them — which is how $65.90 of postage that was never paid ended up
    // booked to wallet_ledger as factory spend. Carried out so recordLabel can decline to
    // book money that does not exist.
    test: !!d.test,
    // Whether this label was tied to Shippo's imported order — i.e. whether Etsy will be
    // told. Surfaced rather than inferred so "did it push?" is answerable from the buy
    // response instead of by waiting to see if a buyer complains.
    shippoOrder: shippoOrder || null,
    carrier: (rate && rate.provider) || sel.carrier || '',
    service: (rate && rate.servicelevel && rate.servicelevel.name) || sel.service || '',
    cost: (rate && Number(rate.amount)) || Number(sel.amount) || null,
    tracking: d.tracking_number || '',
    labelUrl: d.label_url || '',
    providerId: d.object_id || '',
    // The carrier account this rate was bought under. A manifest (USPS SCAN form) is
    // scoped to ONE carrier account, and there is no way to recover which one a
    // transaction used after the fact — so it is captured here or not at all.
    //
    // `rate` is a bare id string on the transaction, so the first term is almost never
    // the one that fires; the value actually arrives on `sel`, the rate we chose at
    // rate-shop time. Without that fallback this was ALWAYS '', which is exactly what
    // the 35 labels in the database show: 11 with a Shippo ref, 0 with an account.
    carrierAccount: (rate && rate.carrier_account) || sel.carrierAccount || ''
  };
}

// Is any aggregator configured?
export function shippingEnabled() { return !!(epKey() || shToken()); }

/**
 * Verify + standardize a US address through whichever aggregator is configured.
 * Returns the SAME shape as the USPS Addresses API path in usps.js so the caller (and
 * the client) can't tell which provider answered — USPS gates its Addresses API behind
 * a separate approval, so this is what keeps validation working while that's pending.
 * Returns null when no provider is configured; throws on a provider error.
 */
export async function aggregatorVerifyAddress(a) {
  const s = addr(a, false);
  // EasyPost was removed as a provider — Shippo is the aggregator. The EasyPost branch
  // stays reachable only if someone deliberately sets EASYPOST_API_KEY again; nothing in
  // the product offers it.
  if (epKey()) {
    // verify[]=delivery asks EasyPost to confirm it's actually deliverable, not just
    // parseable — a well-formed address that doesn't exist is the case worth catching.
    const r = await fetch(EP_BASE + '/addresses', {
      method: 'POST', headers: { Authorization: epAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: { street1: s.street1, street2: s.street2, city: s.city, state: s.state, zip: s.zip, country: s.country, verify: ['delivery'] } })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d.error && (d.error.message || JSON.stringify(d.error))) || ('EasyPost HTTP ' + r.status));
    const v = (d.verifications && d.verifications.delivery) || {};
    if (v.success === false) {
      const msg = (v.errors || []).map((e) => e.message || e.code).filter(Boolean).join('; ');
      throw new Error(msg || 'That address could not be verified as deliverable.');
    }
    return {
      provider: 'easypost',
      address: { street: d.street1 || '', street2: d.street2 || '', city: d.city || '', state: d.state || '', zip: (d.zip || '').split('-')[0], zip4: (d.zip || '').includes('-') ? d.zip.split('-')[1] : '' },
      raw: d,
    };
  }
  if (shToken()) {
    const r = await fetch(SH_BASE + '/addresses/', {
      method: 'POST', headers: { Authorization: shAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: s.name || 'Recipient', street1: s.street1, street2: s.street2, city: s.city, state: s.state, zip: s.zip, country: s.country, validate: true })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || ('Shippo HTTP ' + r.status));
    const vr = d.validation_results || {};
    if (vr.is_valid === false) {
      const msg = (vr.messages || []).map((m) => m.text).filter(Boolean).join('; ');
      throw new Error(msg || 'That address could not be verified as deliverable.');
    }
    return {
      provider: 'shippo',
      address: { street: d.street1 || '', street2: d.street2 || '', city: d.city || '', state: d.state || '', zip: (d.zip || '').split('-')[0], zip4: (d.zip || '').includes('-') ? d.zip.split('-')[1] : '' },
      raw: d,
    };
  }
  return null;
}

// Rate-shop and buy the cheapest label — reused by /api/usps/label so EVERY label
// path produces a real label. opts: { carrierPref, servicePref } (substring filters).
export async function aggregatorBuyCheapest(to, from, pc, opts) {
  if (!epKey() && !shToken()) return null;
  opts = opts || {};
  const T = addr(to), F = addr(from, true), P = parcel(pc);
  // Keep each provider's failure. Swallowing them made an auth error, a rejected
  // address and a genuinely empty rate list all look identical — "no rates" — which is
  // the least useful thing to tell someone whose label just failed.
  const problems = [];
  const jobs = [];
  if (epKey()) jobs.push(epRates(T, F, P).catch((e) => { problems.push('EasyPost: ' + (e && e.message ? e.message : e)); return []; }));
  if (shToken()) jobs.push(shRates(T, F, P, opts.extra).catch((e) => { problems.push('Shippo: ' + (e && e.message ? e.message : e)); return []; }));
  let all = (await Promise.all(jobs)).flat();
  if (!all.length) {
    if (problems.length) throw new Error(problems.join(' · '));
    // No error, just nothing offered. In Shippo TEST mode this usually means the account
    // has no test carrier account enabled — rates come back empty rather than erroring.
    throw new Error('No rates were returned for this parcel. In Shippo test mode, check that a USPS carrier account is enabled under test credentials.');
  }
  if (opts.carrierPref) { const w = String(opts.carrierPref).toLowerCase(); const f = all.filter((r) => (r.carrier || '').toLowerCase().includes(w)); if (f.length) all = f; }
  if (opts.servicePref) { const w = String(opts.servicePref).toLowerCase(); const f = all.filter((r) => (r.service || '').toLowerCase().includes(w)); if (f.length) all = f; }
  all.sort((a, c) => a.amount - c.amount);
  const t = dec(all[0].token);
  if (t && t.p === 'ep') return await epBuy(t.s, t.r);
  // opts.orderId rides along so the Shippo transaction can be linked to the order Shippo
  // imported from the connected shop — that link is what makes tracking reach Etsy.
  if (t && t.p === 'sh') return await shBuy(t.r, all[0], opts.orderId);   // pass the chosen rate for cost/carrier
  return null;
}

// Buy a SPECIFIC rate the operator picked in the rate table (its `token` from
// /api/shipping/rates). `sel` carries that rate's amount/carrier/service so the cost is
// captured even though Shippo's transaction response doesn't expand the rate. Reused by
// /api/usps/label so a UPS/USPS/any label records exactly like a USPS one (cost, PDF,
// provider ref for voiding).
export async function aggregatorBuyRate(rateToken, sel, orderId) {
  const t = dec(rateToken);
  if (!t) throw new Error('That rate is unreadable or expired — fetch fresh rates and try again.');
  if (t.p === 'ep') return await epBuy(t.s, t.r);
  if (t.p === 'sh') return await shBuy(t.r, sel || {}, orderId);
  throw new Error('Unknown rate provider on that rate.');
}


/**
 * Void a bought label and reclaim the postage.
 *
 * Both providers refund ASYNCHRONOUSLY — the call is accepted and settles later (EasyPost
 * returns a refund_status, Shippo a QUEUED/PENDING refund). So this reports what the
 * provider SAID rather than claiming the money is back; the caller records it as pending
 * and the provider settles it.
 *
 * Refunds are only possible on an UNUSED label, and providers enforce their own windows
 * (USPS commonly ~30 days). A refusal is returned as a message, not thrown, so the caller
 * can record the reason.
 */
export async function aggregatorRefundLabel(provider, providerId) {
  if (!providerId) return { ok: false, message: 'No provider reference stored for this label.' };
  if (provider === 'easypost') {
    if (!epKey()) return { ok: false, message: 'EasyPost is not configured.' };
    const r = await fetch(EP_BASE + '/shipments/' + encodeURIComponent(providerId) + '/refund', {
      method: 'POST', headers: { Authorization: epAuth(), 'Content-Type': 'application/json' }
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, message: (d.error && (d.error.message || JSON.stringify(d.error))) || ('EasyPost refund HTTP ' + r.status) };
    return { ok: true, status: d.refund_status || 'submitted', raw: d };
  }
  if (provider === 'shippo') {
    if (!shToken()) return { ok: false, message: 'Shippo is not configured.' };
    const r = await fetch(SH_BASE + '/refunds/', {
      method: 'POST', headers: { Authorization: shAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: providerId, async: false })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, message: d.detail || ('Shippo refund HTTP ' + r.status) };
    return { ok: true, status: (d.status || 'QUEUED').toLowerCase(), raw: d };
  }
  return { ok: false, message: `Labels bought via ${provider || 'this provider'} can't be voided automatically — refund it in the carrier's dashboard.` };
}

/**
 * RE-READ A REFUND, because accepting one is not the same as getting the money.
 *
 * Shippo answers a refund request with QUEUED or PENDING and settles later — up to 14 days,
 * because they wait on carrier tracking data to prove the label was never used. It can end
 * in SUCCESS, or in ERROR, which means "the shipment was found to be used": the parcel
 * actually shipped and the postage is NOT coming back.
 *
 * We book the credit on acceptance, which is right — the request was made and the money is
 * expected. But nothing re-checked it, so an ERROR left the ledger claiming a refund that
 * never arrived and the row claiming a shipment that had, in fact, gone out. This is what
 * closes that loop.
 *
 * Returns a normalized status: 'success' | 'pending' | 'error' | 'unknown'.
 */
export async function aggregatorRefundStatus(provider, refundId) {
  if (!refundId) return { ok: false, status: 'unknown' };
  if (provider === 'shippo') {
    if (!shToken()) return { ok: false, status: 'unknown' };
    const r = await fetch(SH_BASE + '/refunds/' + encodeURIComponent(refundId), { headers: { Authorization: shAuth() } });
    if (!r.ok) return { ok: false, status: 'unknown' };
    const d = await r.json().catch(() => ({}));
    const s = String(d.status || '').toUpperCase();
    // QUEUED and PENDING are both "still waiting" — the difference is theirs, not ours.
    const status = s === 'SUCCESS' ? 'success' : s === 'ERROR' ? 'error' : (s === 'QUEUED' || s === 'PENDING') ? 'pending' : 'unknown';
    return { ok: true, status, raw: d };
  }
  // EasyPost reports refund_status on the shipment; it is inert here and not worth a
  // speculative implementation — an unknown status simply leaves the row alone.
  return { ok: false, status: 'unknown' };
}

/**
 * Fetch what a label ACTUALLY cost, after the fact, from the provider's transaction — the
 * number on their dashboard. Labels bought before the buy-time cost capture landed (Shippo
 * returns the rate as a bare id, so `cost` came back null) show an empty Price; this reads
 * the billed amount straight from the source so those rows can be backfilled.
 *
 * Returns { cost, carrier, service } or null when it can't be recovered (no key, unknown
 * provider, provider error). Never throws — a backfill over many labels must skip, not abort.
 */
export async function aggregatorFetchCost(provider, providerId) {
  if (!providerId) return null;
  try {
    if (provider === 'shippo') {
      if (!shToken()) return null;
      const r = await fetch(SH_BASE + '/transactions/' + encodeURIComponent(providerId), { headers: { Authorization: shAuth() } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      let rate = (d.rate && typeof d.rate === 'object') ? d.rate : null;
      // Shippo hands back `rate` as a bare object-id string on the transaction — resolve it
      // to the rate object to read the amount/carrier/service.
      if (!rate && typeof d.rate === 'string' && d.rate) {
        const rr = await fetch(SH_BASE + '/rates/' + encodeURIComponent(d.rate), { headers: { Authorization: shAuth() } });
        rate = await rr.json().catch(() => null);
        if (!rr.ok) rate = null;
      }
      const cost = rate && isFinite(Number(rate.amount)) ? Number(rate.amount) : null;
      if (cost == null) return null;
      return { cost, carrier: (rate.provider || ''), service: (rate.servicelevel && rate.servicelevel.name) || '' };
    }
    if (provider === 'easypost') {
      if (!epKey()) return null;
      const r = await fetch(EP_BASE + '/shipments/' + encodeURIComponent(providerId), { headers: { Authorization: epAuth() } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      const sr = d.selected_rate || null;
      const cost = sr && isFinite(Number(sr.rate)) ? Number(sr.rate) : null;
      if (cost == null) return null;
      return { cost, carrier: (sr.carrier || ''), service: (sr.service || '') };
    }
  } catch { /* fall through */ }
  return null;
}

export function shippingRoutes(app, requireAuth, requireStaff) {
  const guard = { preHandler: requireStaff };

  /**
   * Pull buyer addresses back from Shippo for orders that have none.
   *
   * On demand as well as on every Etsy sync, because the sync only reaches orders in its
   * window and someone staring at "Not available yet" on an older order wants it now.
   */
  app.post('/api/shipping/backfill-addresses', guard, async (req) => {
    return await fillBlankAddressesFromShippo(Number((req.body || {}).limit) || 100);
  });

  app.get('/api/shipping/config', guard, async () => ({
    easypost: !!epKey(), shippo: !!shToken(), enabled: !!(epKey() || shToken())
  }));

  // Whether a key is TEST or LIVE is the single most useful thing to know while setting
  // this up — a test key buys sample labels for free, a live one spends real money — and
  // it's readable from the key prefix without an API round-trip.
  const keyMode = (k, testPrefixes) => (testPrefixes.some((p) => String(k).startsWith(p)) ? 'test' : 'live');

  app.get('/api/shipping/test', guard, async () => {
    const out = {};
    if (epKey()) {
      const mode = keyMode(epKey(), ['EZTK']);   // EZTK = test, EZAK = production
      try { const r = await fetch(EP_BASE + '/api_keys', { headers: { Authorization: epAuth() } }); out.easypost = r.ok ? ('ok (' + mode + ')') : ('HTTP ' + r.status); }
      catch (e) { out.easypost = 'FAILED: ' + e.message; }
    } else out.easypost = 'no key';
    if (shToken()) {
      const mode = keyMode(shToken(), ['shippo_test_']);
      try { const r = await fetch(SH_BASE + '/addresses/?results=1', { headers: { Authorization: shAuth() } }); out.shippo = r.ok ? ('ok (' + mode + ')') : ('HTTP ' + r.status); }
      catch (e) { out.shippo = 'FAILED: ' + e.message; }
    } else out.shippo = 'no token';
    return out;
  });

  // Merged, cheapest-first rates from all enabled providers.
  app.post('/api/shipping/rates', guard, async (req, reply) => {
    if (!epKey() && !shToken()) { reply.code(400); return { error: 'No shipping provider configured (set EASYPOST_API_KEY or SHIPPO_API_TOKEN)' }; }
    const b = req.body || {};
    const to = addr(b.to), from = addr((b.from && b.from.street) ? b.from : (await shipFromForOrder(b.orderId)) || {}, true), pc = parcel(b.parcel || b);
    if (!to.zip || !to.street1) { reply.code(400); return { error: 'Recipient street + ZIP required' }; }
    if (!from.zip || !from.street1) { reply.code(400); return { error: 'Sender street + ZIP required' }; }
    const jobs = [];
    if (epKey()) jobs.push(epRates(to, from, pc).catch((e) => ({ _err: 'EasyPost: ' + e.message })));
    if (shToken()) jobs.push(shRates(to, from, pc, b.extra).catch((e) => ({ _err: 'Shippo: ' + e.message })));
    const results = await Promise.all(jobs);
    const rates = [], errors = [];
    results.forEach((r) => { if (Array.isArray(r)) rates.push(...r); else if (r && r._err) errors.push(r._err); });
    rates.sort((a, c) => a.amount - c.amount);
    return { rates, errors };
  });

  // Buy a label. Either a specific {rateToken}, or {to,from,parcel} → cheapest.
  app.post('/api/shipping/label', guard, async (req, reply) => {
    const b = req.body || {};
    try {
      let t = b.rateToken ? dec(b.rateToken) : null;
      // The rate we picked, kept so the buy can be told what it bought. Shippo's
      // transaction answers with `rate` as an id string, so cost, carrier, service and
      // carrier account all have to come from here — a smoke-test buy through this route
      // came back with cost null and carrier blank precisely because it didn't.
      let sel = null;
      if (!t) {
        // No token → rate-shop and pick the cheapest.
        if (!epKey() && !shToken()) { reply.code(400); return { error: 'No shipping provider configured' }; }
        const to = addr(b.to), from = addr((b.from && b.from.street) ? b.from : (await shipFromForOrder(b.orderId)) || {}, true), pc = parcel(b.parcel || b);
        if (!to.zip || !to.street1 || !from.zip || !from.street1) { reply.code(400); return { error: 'Sender + recipient street + ZIP required' }; }
        const jobs = [];
        if (epKey()) jobs.push(epRates(to, from, pc).catch(() => []));
        if (shToken()) jobs.push(shRates(to, from, pc).catch(() => []));
        const all = (await Promise.all(jobs)).flat();
        // Optional service preference filter (substring match on service name).
        let pool = all;
        if (b.service) { const want = String(b.service).toLowerCase(); const f = all.filter((r) => (r.service || '').toLowerCase().includes(want)); if (f.length) pool = f; }
        pool.sort((a, c) => a.amount - c.amount);
        if (!pool.length) { reply.code(400); return { error: 'No rates returned for this shipment' }; }
        sel = pool[0];
        t = dec(sel.token);
      }
      let out;
      if (t.p === 'ep') out = await epBuy(t.s, t.r);
      // `b.rate` lets a caller that already rate-shopped hand back what it chose, the same
      // way aggregatorBuyRate does. Absent both, this degrades to the old empty fields
      // rather than failing — a label that buys is worth more than a tidy cost column.
      else if (t.p === 'sh') out = await shBuy(t.r, sel || b.rate || {}, b.orderId);
      else { reply.code(400); return { error: 'Bad rate token' }; }
      return Object.assign({ ok: true }, out);
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Tracking status.
  /**
   * Shippo's tracking vocabulary, mapped to ours.
   *
   * PRE_TRANSIT is the one worth naming: the label exists but the carrier has never
   * scanned it. That's the parcel still sitting behind a bench — invisible today, and
   * the failure this whole path is actually for. RETURNED and FAILURE are flagged rather
   * than treated as outcomes: both need a human, and neither is "delivered".
   */
  const DELIVERY_MAP = {
    PRE_TRANSIT: { status: 'awaiting_pickup', detail: 'Label created — the carrier has not scanned it yet' },
    TRANSIT: { status: 'in_transit', detail: 'On its way' },
    DELIVERED: { status: 'delivered', detail: 'Delivered' },
    RETURNED: { status: 'returned', detail: 'Coming back to us — needs a look' },
    FAILURE: { status: 'failed', detail: 'The carrier could not deliver it — needs a look' },
    UNKNOWN: { status: null, detail: null },
  };

  /** Read the carrier's status for one order and record it. Safe to call repeatedly. */
  export_refreshTracking = async function refreshTracking(orderId) {
    const row = await q('select id, tracking, carrier from orders where id=$1', [orderId]).then((r) => r.rows[0]);
    if (!row || !row.tracking) return { ok: false, reason: 'no-tracking' };
    if (!shToken()) return { ok: false, reason: 'no-provider' };
    const r = await fetch(SH_BASE + '/tracks/' + encodeURIComponent((row.carrier || 'usps').toLowerCase()) + '/' + encodeURIComponent(row.tracking),
      { headers: { Authorization: shAuth() } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: d.detail || ('HTTP ' + r.status) };
    const raw = (d.tracking_status && d.tracking_status.status) || 'UNKNOWN';
    const m = DELIVERY_MAP[raw] || DELIVERY_MAP.UNKNOWN;
    const detail = (d.tracking_status && d.tracking_status.status_details) || m.detail;
    // Shippo returns the carrier's estimated delivery date on the track response. Freeze the
    // FIRST one we see (coalesce), not the latest: the ETA slips as a parcel moves, and an
    // on-time metric wants the promise made near ship time, not a moving target.
    const eta = d.eta || (d.tracking_status && d.tracking_status.eta) || null;
    await q('update orders set delivery_status=$1, delivery_detail=$2, delivery_checked_at=now(), est_delivery=coalesce(est_delivery, $4::timestamptz) where id=$3',
      [m.status, detail || null, orderId, eta]).catch(() => {});

    // THE ACCEPTANCE SCAN. PRE_TRANSIT means the label exists and the carrier has never
    // touched the parcel; anything past it means they have it. That transition IS the
    // scan — and unlike the other two routes, this one is the carrier saying so rather
    // than us or a partner asserting it on their behalf.
    //
    // This is what closes the SCAN-form loop: creating a manifest deliberately records
    // only manifested_at, because the form being printed says nothing about whether the
    // pile went out. The parcel moving is what says that.
    //
    // Only fills a NULL, so it can never overwrite an in-house or partner scan with a
    // later timestamp — the first person to scan is the one who did it. Best-effort:
    // failing to record the scan must not lose the delivery status written above.
    if (raw === 'TRANSIT' || raw === 'DELIVERED') {
      // Prefer the carrier's own acceptance time over now(). Polling on a timer can see a
      // move hours after it happened, and "scanned at 09:04" is the fact that settles a
      // dispute about whether we handed it over on time.
      const hist = Array.isArray(d.tracking_history) ? d.tracking_history : [];
      const accepted = hist.find((h) => h && h.status === 'TRANSIT' && h.status_date);
      await q(
        `update orders set label_scanned_at = coalesce($1::timestamptz, now()), scanned_via = coalesce(scanned_via, 'carrier')
          where id = $2 and label_scanned_at is null`,
        [accepted ? accepted.status_date : null, orderId]).catch(() => {});
      // The delivery event's own timestamp, frozen once — the basis for transit + on-time.
      // Same reasoning as the acceptance scan: the carrier's stated time beats our poll time.
      if (raw === 'DELIVERED') {
        const delivered = hist.find((h) => h && h.status === 'DELIVERED' && h.status_date);
        await q(
          `update orders set delivered_at = coalesce(delivered_at, $1::timestamptz, now()) where id = $2 and delivered_at is null`,
          [delivered ? delivered.status_date : null, orderId]).catch(() => {});
      }
    }
    return { ok: true, carrier_status: raw, status: m.status, detail };
  };

  // On-demand refresh for one order — the button behind "check with the carrier".
  // `guard` IS the options object ({preHandler: requireStaff}) — wrapping it again as
  // {preHandler: guard} made Fastify throw at registration, which takes down the whole
  // server, not just this route. Every /api/* 502s.
  app.post('/api/orders/:id/refresh-tracking', guard, async (req, reply) => {
    const out = await export_refreshTracking(String(req.params.id)).catch((e) => ({ ok: false, reason: e.message }));
    if (!out.ok) { reply.code(400); return { error: out.reason || 'Could not read the carrier status' }; }
    return out;
  });

  /**
   * Shippo webhook — the carrier telling US, instead of us asking on a timer.
   *
   * Polling a few hundred open parcels learns nothing most of the time; a webhook fires
   * exactly when something moves. Unauthenticated by necessity (Shippo calls it), so it
   * does nothing but look up an order by a tracking number WE issued and re-read the
   * status from Shippo directly — a forged POST can't inject a status, only trigger a
   * lookup we'd have done anyway.
   */
  app.post('/api/shipping/webhook', async (req) => {
    const b = req.body || {};
    const tracking = (b.data && (b.data.tracking_number || b.data.tracking_code)) || b.tracking_number;
    if (!tracking) return { ok: true, ignored: 'no tracking number' };
    const row = await q('select id from orders where tracking=$1 limit 1', [String(tracking)])
      .then((r) => r.rows[0]).catch(() => null);
    if (!row) return { ok: true, ignored: 'unknown tracking number' };
    await export_refreshTracking(row.id).catch(() => {});
    return { ok: true };
  });

  app.get('/api/shipping/track', guard, async (req, reply) => {
    // Named qs, not q — `q` is the db helper imported at the top of this file, and
    // shadowing it here is how three handlers below ended up calling an undefined q().
    const qs = req.query || {};
    const provider = qs.provider, carrier = qs.carrier, tracking = qs.tracking;
    if (!tracking) { reply.code(400); return { error: 'tracking required' }; }
    try {
      if (provider === 'shippo') {
        const r = await fetch(SH_BASE + '/tracks/' + encodeURIComponent(carrier || 'usps') + '/' + encodeURIComponent(tracking), { headers: { Authorization: shAuth() } });
        const d = await r.json().catch(() => ({}));
        return { status: (d.tracking_status && d.tracking_status.status) || 'UNKNOWN', raw: d.tracking_status || null };
      }
      // EasyPost: look up the tracker by tracking code.
      const r = await fetch(EP_BASE + '/trackers?tracking_code=' + encodeURIComponent(tracking), { headers: { Authorization: epAuth() } });
      const d = await r.json().catch(() => ({}));
      const tr = (d.trackers && d.trackers[0]) || null;
      return { status: (tr && tr.status) || 'UNKNOWN', raw: tr };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
