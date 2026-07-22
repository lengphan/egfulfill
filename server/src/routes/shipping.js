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
import { readShipFrom } from './factory_settings.js';

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
  const body = { shipment: {
    to_address: { name: to.name, street1: to.street1, street2: to.street2, city: to.city, state: to.state, zip: to.zip, country: to.country, phone: to.phone },
    from_address: { name: from.name, street1: from.street1, street2: from.street2, city: from.city, state: from.state, zip: from.zip, country: from.country, phone: from.phone },
    parcel: { length: pc.length, width: pc.width, height: pc.height, weight: pc.weightOz }
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
async function shRates(to, from, pc) {
  const body = {
    address_from: { name: from.name, street1: from.street1, street2: from.street2, city: from.city, state: from.state, zip: from.zip, country: from.country, phone: from.phone, email: from.email },
    address_to: { name: to.name, street1: to.street1, street2: to.street2, city: to.city, state: to.state, zip: to.zip, country: to.country, phone: to.phone, email: to.email },
    parcels: [{ length: String(pc.length), width: String(pc.width), height: String(pc.height), distance_unit: 'in', weight: String(pc.weightOz), mass_unit: 'oz' }],
    async: false
  };
  const r = await fetch(SH_BASE + '/shipments/', { method: 'POST', headers: { Authorization: shAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.detail || JSON.stringify(d)).slice(0, 200));
  return (d.rates || []).map((rt) => ({
    token: enc({ p: 'sh', r: rt.object_id }),
    provider: 'shippo', carrier: rt.provider, service: (rt.servicelevel && rt.servicelevel.name) || rt.servicelevel_name || '',
    amount: Number(rt.amount), currency: rt.currency || 'USD',
    days: rt.estimated_days != null ? rt.estimated_days : null
  }));
}
async function shBuy(rateObjectId) {
  const r = await fetch(SH_BASE + '/transactions/', {
    method: 'POST', headers: { Authorization: shAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate: rateObjectId, label_file_type: 'PDF_4x6', async: false })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.status !== 'SUCCESS') {
    const msg = (d.messages && d.messages.map((m) => m.text).join('; ')) || d.detail || ('Shippo buy HTTP ' + r.status);
    throw new Error(msg);
  }
  return {
    provider: 'shippo', carrier: (d.rate && d.rate.provider) || '', service: (d.rate && d.rate.servicelevel && d.rate.servicelevel.name) || '',
    cost: (d.rate && Number(d.rate.amount)) || null, tracking: d.tracking_number || '',
    labelUrl: d.label_url || '',
    providerId: d.object_id || '',
    // The carrier account this rate was bought under. A manifest (USPS SCAN form) is
    // scoped to ONE carrier account, and there is no way to recover which one a
    // transaction used after the fact — so it is captured here or not at all.
    carrierAccount: (d.rate && d.rate.carrier_account) || ''
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
  if (shToken()) jobs.push(shRates(T, F, P).catch((e) => { problems.push('Shippo: ' + (e && e.message ? e.message : e)); return []; }));
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
  if (t && t.p === 'sh') return await shBuy(t.r);
  return null;
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

export function shippingRoutes(app, requireAuth, requireStaff) {
  const guard = { preHandler: requireStaff };

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
    const to = addr(b.to), from = addr((b.from && b.from.street) ? b.from : (await readShipFrom()) || {}, true), pc = parcel(b.parcel || b);
    if (!to.zip || !to.street1) { reply.code(400); return { error: 'Recipient street + ZIP required' }; }
    if (!from.zip || !from.street1) { reply.code(400); return { error: 'Sender street + ZIP required' }; }
    const jobs = [];
    if (epKey()) jobs.push(epRates(to, from, pc).catch((e) => ({ _err: 'EasyPost: ' + e.message })));
    if (shToken()) jobs.push(shRates(to, from, pc).catch((e) => ({ _err: 'Shippo: ' + e.message })));
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
      if (!t) {
        // No token → rate-shop and pick the cheapest.
        if (!epKey() && !shToken()) { reply.code(400); return { error: 'No shipping provider configured' }; }
        const to = addr(b.to), from = addr((b.from && b.from.street) ? b.from : (await readShipFrom()) || {}, true), pc = parcel(b.parcel || b);
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
        t = dec(pool[0].token);
      }
      let out;
      if (t.p === 'ep') out = await epBuy(t.s, t.r);
      else if (t.p === 'sh') out = await shBuy(t.r);
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
    await q('update orders set delivery_status=$1, delivery_detail=$2, delivery_checked_at=now() where id=$3',
      [m.status, detail || null, orderId]).catch(() => {});

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
