// USPS Labels integration (new USPS APIs platform).
//
// Two tokens are required to buy/print a label:
//   1) OAuth token        — from your app's Consumer Key/Secret (client_credentials)
//   2) Payment auth token — from the Payments 3.0 API, which needs CRID + MID + EPS
//
// TEM (test) returns watermarked labels and doesn't charge — but still needs the
// payment token. Flip USPS_BASE to apis.usps.com for live postage.
//
// .env:
//   USPS_CONSUMER_KEY=...        USPS_CONSUMER_SECRET=...
//   USPS_BASE=https://apis-tem.usps.com      (default; prod = https://apis.usps.com)
//   USPS_CRID=...   USPS_MID=...   USPS_ACCOUNT_NUMBER=...   (EPS account)
//   USPS_ACCOUNT_TYPE=EPS
import { q } from '../db.js';
import { audit } from '../audit.js';
import { recordUsage } from '../usage.js';
import { recordCost } from '../costs.js';
import { shipFromForOrder } from './factory_settings.js';
import { shippingEnabled, aggregatorBuyCheapest, aggregatorBuyRate, aggregatorVerifyAddress } from './shipping.js';
import { missingArtwork } from './orders.js';

// Map a USPS mailClass to a service-name hint for the aggregator rate filter.
function _svcPref(mc) {
  mc = String(mc || '').toUpperCase();
  if (mc.includes('PRIORITY') && mc.includes('EXPRESS')) return 'Express';
  if (mc.includes('PRIORITY')) return 'Priority';
  if (mc.includes('GROUND')) return 'Ground Advantage';
  if (mc.includes('FIRST')) return 'First';
  return '';
}

const KEY    = process.env.USPS_CONSUMER_KEY || '';
const SECRET = process.env.USPS_CONSUMER_SECRET || '';
const BASE   = (process.env.USPS_BASE || 'https://apis-tem.usps.com').replace(/\/+$/, '');
const CRID   = process.env.USPS_CRID || '';
const MID    = process.env.USPS_MID || '';
const ACCT   = process.env.USPS_ACCOUNT_NUMBER || '';
const ACCT_TYPE = process.env.USPS_ACCOUNT_TYPE || 'EPS';

let _oauth = { token: '', exp: 0 };
let _pay   = { token: '', exp: 0 };

// 1) OAuth — client_credentials. Cached until ~1 min before expiry.
async function oauthToken() {
  if (_oauth.token && Date.now() < _oauth.exp - 60000) return _oauth.token;
  if (!KEY || !SECRET) throw new Error('Server missing USPS_CONSUMER_KEY / USPS_CONSUMER_SECRET');
  // By default the token carries whatever scopes the app is entitled to. If the
  // Payments scope isn't included (→ "Insufficient OAuth scope" on payment-auth),
  // set USPS_SCOPE in .env to request it explicitly once USPS grants it.
  var _body = { grant_type: 'client_credentials', client_id: KEY, client_secret: SECRET };
  if (process.env.USPS_SCOPE) _body.scope = process.env.USPS_SCOPE;
  const res = await fetch(`${BASE}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(_body).toString()
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new Error('USPS OAuth failed: ' + (d.error_description || d.error || ('HTTP ' + res.status)));
  _oauth = { token: d.access_token, exp: Date.now() + ((d.expires_in || 28800) * 1000), scope: d.scope || '' };
  return _oauth.token;
}

// USPS gates the Addresses API behind its OWN scope/entitlement, separate from the
// Labels approval ("not authorized for access to Addresses API"). The default token
// (all entitled scopes) often omits it, so we mint a token that EXPLICITLY requests
// the addresses scope. If the app isn't entitled to that scope yet, USPS rejects the
// token request → we fall back to the default token (same behaviour as before).
let _addrOauth = { token: '', exp: 0 };
async function addressToken() {
  if (_addrOauth.token && Date.now() < _addrOauth.exp - 60000) return _addrOauth.token;
  if (!KEY || !SECRET) throw new Error('Server missing USPS_CONSUMER_KEY / USPS_CONSUMER_SECRET');
  const scope = process.env.USPS_ADDRESSES_SCOPE || 'addresses';
  try {
    const res = await fetch(`${BASE}/oauth2/v3/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: KEY, client_secret: SECRET, scope }).toString()
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.access_token) return oauthToken();   // not entitled to this scope → default token
    _addrOauth = { token: d.access_token, exp: Date.now() + ((d.expires_in || 28800) * 1000), scope: d.scope || '' };
    return _addrOauth.token;
  } catch { return oauthToken(); }
}

// 2) Payment authorization token — needs CRID + MID + EPS account.
async function paymentToken() {
  if (_pay.token && Date.now() < _pay.exp - 60000) return _pay.token;
  if (!CRID || !MID || !ACCT) throw new Error('Server missing USPS_CRID / USPS_MID / USPS_ACCOUNT_NUMBER (needed for the payment token)');
  const tok = await oauthToken();
  // Per Payments 3.0 spec: PAYER needs CRID + accountType + accountNumber (EPS).
  // LABEL_OWNER needs CRID + MID + manifestMID (NOT account fields). manifestMID
  // defaults to the MID (matches USPS's MinimumPaymentAuthorizationRequest example).
  const MANIFEST_MID = process.env.USPS_MANIFEST_MID || MID;
  const body = {
    roles: [
      { roleName: 'PAYER',       CRID, MID, manifestMID: MANIFEST_MID, accountType: ACCT_TYPE, accountNumber: ACCT },
      { roleName: 'LABEL_OWNER', CRID, MID, manifestMID: MANIFEST_MID }
    ]
  };
  const res = await fetch(`${BASE}/payments/v3/payment-authorization`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: JSON.stringify(body)
  });
  const d = await res.json().catch(() => ({}));
  const token = d.paymentAuthorizationToken || d.token;
  if (!res.ok || !token) throw new Error('USPS payment authorization failed: ' + (d.error?.message || d.message || JSON.stringify(d).slice(0, 300)));
  _pay = { token, exp: Date.now() + (50 * 60 * 1000) };   // ~1h tokens; refresh at 50m
  return _pay.token;
}

// Parse a multipart/form-data body into [{ head, body:Buffer }]. USPS Labels 3.0 returns the
// JSON "labelMetadata" part + the "labelImage" part (base64 text) this way. Byte-safe.
function _splitMultipart(buf, boundary) {
  const out = []; const delim = Buffer.from('--' + boundary);
  let start = buf.indexOf(delim); if (start === -1) return out; start += delim.length;
  while (true) {
    const next = buf.indexOf(delim, start); if (next === -1) break;
    let seg = buf.slice(start, next);
    if (seg[0] === 0x0d && seg[1] === 0x0a) seg = seg.slice(2);   // strip leading CRLF
    const sep = seg.indexOf(Buffer.from('\r\n\r\n'));
    if (sep !== -1) {
      let body = seg.slice(sep + 4);
      if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) body = body.slice(0, -2);
      out.push({ head: seg.slice(0, sep).toString('latin1'), body });
    }
    start = next + delim.length;
  }
  return out;
}

// Pull { tracking, labelImage(base64 text), imgType, cost } out of a Labels-3.0 response
// (multipart: JSON labelMetadata part + base64 labelImage part; JSON fallback for older shapes).
function _parseLabelMultipart(ct, ab, imgType0) {
  var tracking = '', labelImage = '', imgType = imgType0 || 'PDF', cost = null;
  var bMatch = String(ct || '').match(/boundary=("?)([^";\s]+)/i);
  if (/multipart\//i.test(ct) && bMatch) {
    for (const part of _splitMultipart(ab, bMatch[2])) {
      if (/name="?labelMetadata"?/i.test(part.head) || /application\/json/i.test(part.head)) {
        try { const md = JSON.parse(part.body.toString('utf8')); tracking = md.trackingNumber || (md.labelMetadata && md.labelMetadata.trackingNumber) || tracking; if (md.postage != null) cost = md.postage; } catch (e) {}
      } else if (/name="?labelImage"?/i.test(part.head)) {
        labelImage = part.body.toString('latin1').trim();   // already base64 text
        if (/image\/png/i.test(part.head)) imgType = 'PNG'; else if (/application\/pdf/i.test(part.head)) imgType = 'PDF';
      }
    }
  } else {
    try { const data = JSON.parse(ab.toString('utf8')); tracking = data.trackingNumber || (data.labelMetadata && data.labelMetadata.trackingNumber) || ''; labelImage = data.labelImage || (data.labelMetadata && data.labelMetadata.labelImage) || ''; } catch (e) {}
  }
  return { tracking: tracking, labelImage: labelImage, imgType: imgType, cost: cost };
}

export function uspsRoutes(app, requireAuth, requireStaff) {
  // Connectivity/qualification check — surfaces exactly which step is wired.
  app.get('/api/usps/test', { preHandler: requireStaff }, async () => {
    const out = { base: BASE, env: BASE.includes('-tem') ? 'TEM (test)' : 'PRODUCTION',
      consumerKey: !!KEY, consumerSecret: !!SECRET, crid: !!CRID, mid: !!MID, account: !!ACCT };
    try { await oauthToken(); out.oauth = 'ok'; out.scopes = _oauth.scope || '(none returned)'; out.requestedScope = process.env.USPS_SCOPE || '(default — none requested)'; }
    catch (e) { out.oauth = 'FAILED: ' + e.message; return out; }
    // Does the granted token include the scopes the label flow needs? Note the
    // word boundary — "usps:payment_methods" is NOT the "payments" scope that
    // Payments 3.0 payment-authorization requires.
    var sc = ' ' + (_oauth.scope || '').toLowerCase() + ' ';
    out.hasPaymentsScope = /[\s:]payments[\s]/.test(sc);
    out.hasLabelsScope = /[\s:]labels[\s]/.test(sc);
    out.hasAddressesScope = /[\s:]addresses[\s]/.test(sc);
    // Addresses API — mint the addresses-scoped token and run a known-good lookup so
    // we can see whether validation actually works (vs. the entitlement error).
    try {
      const at = await addressToken();
      out.addressTokenScope = _addrOauth.scope || '(fell back to default token)';
      const p = new URLSearchParams({ streetAddress: '1600 Pennsylvania Ave NW', city: 'Washington', state: 'DC', ZIPCode: '20500' });
      const ar = await fetch(`${BASE}/addresses/v3/address?` + p.toString(), { headers: { Authorization: 'Bearer ' + at } });
      const ad = await ar.json().catch(() => ({}));
      out.addresses = ar.ok ? 'ok' : ('FAILED: ' + ((ad.error && (ad.error.message || ad.error)) || ad.message || ('HTTP ' + ar.status)));
    } catch (e) { out.addresses = 'FAILED: ' + e.message; }
    try { await paymentToken(); out.payment = 'ok'; out.qualified = true; }
    catch (e) { out.payment = 'FAILED: ' + e.message; out.qualified = false; }
    // EPS account / funds inquiry (Payments 3.0 GET /payment-account). Also needs
    // the `payments` scope, so it 403s until USPS grants it — but once it works it
    // reports whether the EPS account exists and is funded.
    if (ACCT) {
      try {
        const oauth = await oauthToken();
        const r = await fetch(`${BASE}/payments/v3/payment-account/${encodeURIComponent(ACCT)}?accountType=${ACCT_TYPE}`, { headers: { Authorization: 'Bearer ' + oauth } });
        const d = await r.json().catch(() => ({}));
        out.epsAccount = r.ok ? { ok: true, accountType: d.accountType, nonProfit: d.nonProfitStatus } : ('FAILED: ' + ((d.error && (d.error.message || d.error)) || ('HTTP ' + r.status)));
      } catch (e) { out.epsAccount = 'FAILED: ' + e.message; }
    }
    return out;
  });

  // Address validation (USPS Addresses 3.0) — standardizes/verifies an address.
  // Only needs OAuth (no payment scope). Query: streetAddress, secondaryAddress,
  // city, state, ZIPCode. Returns the standardized address or an error.
  // requireAuth (not requireStaff): sellers validate recipient addresses in the
  // manual-order modal. Read-only USPS lookup, no payment scope.
  app.get('/api/usps/validate-address', { preHandler: requireAuth }, async (req, reply) => {
    const qy = req.query || {};
    // Falls back to EasyPost/Shippo when USPS can't answer. USPS gates its Addresses API
    // behind a separate approval from Labels, so while that application is pending this
    // is what keeps validation working — and the moment USPS approves, the primary path
    // below succeeds and takes over with no code or client change. The response shape is
    // identical either way, so callers never learn which provider replied.
    const viaAggregator = async (uspsError) => {
      if (!shippingEnabled()) return null;
      try {
        const r = await aggregatorVerifyAddress({
          street: qy.streetAddress, street2: qy.secondaryAddress,
          city: qy.city, state: qy.state, zip: qy.ZIPCode,
        });
        if (!r) return null;
        return { ok: true, address: r.address, provider: r.provider, raw: r.raw };
      } catch (e) {
        // A provider saying "this address isn't deliverable" is a REAL answer about the
        // address — surface it rather than the USPS entitlement noise behind it.
        reply.code(400);
        return { error: e.message || uspsError };
      }
    };

    try {
      const oauth = await addressToken();
      const p = new URLSearchParams();
      ['streetAddress', 'secondaryAddress', 'city', 'state', 'ZIPCode'].forEach((k) => { if (qy[k]) p.set(k, qy[k]); });
      const res = await fetch(`${BASE}/addresses/v3/address?` + p.toString(), { headers: { Authorization: 'Bearer ' + oauth } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = (data.error && (data.error.message || data.error)) || data.message || ('HTTP ' + res.status);
        if (/not authorized|access control|addresses api/i.test(String(msg))) {
          const alt = await viaAggregator(msg);
          if (alt) return alt;
          msg = 'USPS hasn\'t granted this app access to the Addresses API. In the USPS Developer Portal, add the "Addresses" API to your app (separate from Labels), then retry — the server already requests the addresses OAuth scope.';
        }
        reply.code(400); return { error: msg };
      }
      const a = data.address || data;
      return { ok: true, address: { street: a.streetAddress || '', street2: a.secondaryAddress || '', city: a.city || '', state: a.state || '', zip: a.ZIPCode || '', zip4: a.ZIPPlus4 || '' }, provider: 'usps', raw: data };
    } catch (e) {
      // No USPS credentials / OAuth failure — try the aggregator before giving up.
      const alt = await viaAggregator(e.message);
      if (alt) return alt;
      reply.code(400); return { error: e.message };
    }
  });


/**
 * Record a bought label on the order.
 *
 * Buying a label is a fact, so tracking is always written. Flipping the order to SHIPPED
 * is a CLAIM, and answers to the same rule as every other route to that status: every
 * decorated item must have artwork. Without this the label routes wrote 'shipped'
 * straight to SQL and quietly shipped work that was never designed.
 */
/**
 * Record a bought label.
 *
 * Buying a label does NOT ship an order. The warehouse flow is:
 *   label bought (tracking exists) → AWAITING SCAN → scanned (by us or a scan service,
 *   and combined with the design) → WORKING → shipped
 *
 * This used to flip straight to 'shipped' the moment a label was bought, which skipped
 * the scan and the entire make step — so a parcel was marked gone before anyone had made
 * it, and it never appeared in the scan queue. Now it moves the order INTO awaiting_scan,
 * which is exactly what "waiting to be scanned" means.
 *
 * Only ever moves an order FORWARD to awaiting_scan — an order already at working or
 * shipped isn't dragged backwards by reprinting a label.
 *
 * The label URL is persisted alongside the tracking number so a label can be reprinted or
 * batched later; without it a label could only be printed at the moment of purchase.
 */
const PRE_SCAN = ['', 'new', 'draft', 'in_review', 'approved', 'ready_print', 'in_queue', 'queued', 'prescan'];

/**
 * `to` is the address the parcel was ACTUALLY sent to, and it is written back onto the
 * order — which nothing did before.
 *
 * Buying a label was the one moment we provably knew where an order was going, and we
 * threw it away: the recipient went to the carrier and the order's own `address` column
 * stayed exactly as empty as it started. So an order could carry a tracking number, a
 * label URL and a postage charge while the row still read "No address" — and it did, on
 * every Etsy order held behind the PII gate, which is most of them. Nobody could answer
 * "where did this one go?" from our own data.
 *
 * ONLY WHEN EMPTY. If the order already has a street we leave it alone: a marketplace
 * address is richer than the flattened one the ship panel sends, and silently replacing
 * what the sync authored is the thing that must never happen. This fills a hole; it does
 * not overwrite a fact.
 *
 * Tagged `source: 'label'` so the row can say where it came from, the same way an Etsy or
 * CSV address does, rather than appearing as though someone typed it by hand.
 */
// Recorded on the order at purchase so the Shipments page shows what each label cost and by
// which service — the carrier states both exactly once, in the buy response.
q('alter table orders add column if not exists label_cost numeric').catch(() => {});
q('alter table orders add column if not exists ship_service text').catch(() => {});

async function recordLabel(orderId, tracking, carrier, labelUrl, cost, ref, to, req) {
  if (!orderId) return { shipped: false };
  // WHO bought postage against WHICH order, and what it cost. The one chokepoint every
  // buy path goes through, so auditing here covers the aggregator, the direct-USPS and
  // the rate-token routes without three near-identical calls. Fire-and-forget.
  audit(req, 'shipping.label_bought', {
    entityType: 'order', entityId: orderId,
    after: { tracking, carrier: carrier || 'USPS', cost: cost ?? null, to_zip: (to && (to.zip || to.postal_code)) || null },
    note: `Label bought · ${carrier || 'USPS'} · ${tracking || 'no tracking'}`,
  });
  // Book the postage as it's bought. The carrier tells us the price exactly once, in the
  // buy response — if we don't write it down here it's gone, and no report can recover
  // what a label cost. Idempotent on the order, so a re-buy doesn't double-count.
  recordCost('label', cost, `label-${orderId}`, `Postage · ${carrier || 'USPS'} · order ${orderId}`, { orderId })
    .catch(() => {});
  const cur = await q('select factory_status from orders where id=$1', [orderId])
    .then((r) => String((r.rows[0] || {}).factory_status || '').toLowerCase()).catch(() => '');
  const advance = PRE_SCAN.includes(cur);
  await q(
    `update orders set tracking=$1, carrier=$2, tracking_label_url=coalesce($3, tracking_label_url),
       label_cost=coalesce($4, label_cost), ship_service=coalesce(nullif($5,''), ship_service)
       ${advance ? ", factory_status='awaiting_scan'" : ''}
     where id=$6`,
    [tracking, carrier || 'USPS', labelUrl || null,
     (cost != null && isFinite(Number(cost))) ? Number(cost) : null,
     (ref && ref.service) ? String(ref.service) : null,
     orderId]).catch(() => {});

  // Backfill the destination, only into an order that hasn't got one. Separate statement
  // and best-effort for the same reason as the label reference below: the label is already
  // bought and paid for, and failing to record where it went must not turn a successful
  // purchase into a failed one.
  //
  // The guard is in SQL rather than a read-then-write so two labels bought at once can't
  // both see "empty" and race. jsonb_strip_nulls keeps absent fields out of the object
  // instead of storing nulls that every reader would then have to filter.
  if (to && (to.street || to.street1) && (to.zip || to.postal_code)) {
    await q(
      `update orders
          set address = jsonb_strip_nulls($1::jsonb)
        where id = $2
          and coalesce(address->>'street', address->>'street1', address->>'line1',
                       address->>'first_line', address->>'address1', '') = ''`,
      [JSON.stringify({
        name: to.name || null,
        street: to.street || to.street1 || null,
        street2: to.street2 || null,
        city: to.city || null,
        state: to.state || null,
        zip: to.zip || to.postal_code || null,
        country: to.country || null,
        source: 'label',
      }), orderId]
    ).catch(() => {});
  }

  // The provider's own reference for this label. Like the cost above, it is told to us
  // exactly once — in the buy response — and cannot be recovered afterwards from the
  // tracking number. Without it a label can be neither voided nor put on a SCAN form,
  // which is why both of those were unbuildable.
  //
  // Separate statement, best-effort: the label is already bought and recorded, and losing
  // its reference must not turn a successful purchase into a failed one.
  if (ref && ref.providerId) {
    await q(
      `update orders set label_provider=$1, label_ref=$2, label_carrier_account=$3 where id=$4`,
      [ref.provider || null, ref.providerId, ref.carrierAccount || null, orderId]).catch(() => {});
  }
  return { shipped: false, stage: advance ? 'awaiting_scan' : cur };
}

  // Create a label. body: { to:{name,street,street2,city,state,zip}, from:{...},
  //   weightOz, length, width, height, mailClass, imageType('PDF'|'ZPL...'), orderId }
  app.post('/api/usps/label', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const b = req.body || {};
      const to = b.to || {};
      // The floor sets its ship-from once in settings; the client no longer has to carry
      // it on every buy. An explicit body.from still wins (multi-site / drop-ship).
      // Blind shipping: the seller's shop name at our address, resolved from the order.
      // An explicit body.from still wins, and a missing/unknown order falls back to the
      // configured address unchanged — a label must never fail to buy over the name line.
      const saved = await shipFromForOrder(b.orderId);
      const from = (b.from && b.from.street) ? b.from : (saved || {});
      if (!to.zip || !to.street) { reply.code(400); return { error: 'Recipient street + ZIP are required' }; }
      if (!from.zip || !from.street) { reply.code(400); return { error: 'No warehouse ship-from address set — add it in Settings → Shipping' }; }
      // A SPECIFIC rate the operator picked in the multi-carrier rate table (UPS, USPS, …).
      // Bought and recorded through the SAME path as a USPS label, so cost/PDF/void-ref land
      // on the order identically — the only difference is which carrier's rate it is.
      if (b.rateToken) {
        try {
          const buy = await aggregatorBuyRate(b.rateToken, b.rate || {});
          if (buy && buy.tracking) {
            const rec = await recordLabel(b.orderId, buy.tracking, buy.carrier, buy.labelUrl, buy.cost, buy, b.to, req);
            return { ok: true, trackingNumber: buy.tracking, labelUrl: buy.labelUrl, imageType: 'PDF', carrier: buy.carrier, service: buy.service, cost: buy.cost, provider: buy.provider, ...rec };
          }
          reply.code(502); return { error: 'The shipping provider returned no label for that rate. Nothing was charged.' };
        } catch (e0) {
          reply.code(502); return { error: 'Label purchase failed: ' + (e0 && e0.message ? e0.message : String(e0)) };
        }
      }
      // PREFERRED PATH — when a shipping aggregator (Shippo/EasyPost) is configured,
      // buy a REAL label through it (test keys → real design, watermarked, no charge).
      // Restricted to USPS here so a UPS test-account gap can't fail the buy.
      // Pass directUsps:true to SKIP the aggregator and buy USPS-direct (Labels 3.0).
      if (shippingEnabled() && !b.directUsps) {
        try {
          const buy = await aggregatorBuyCheapest(to, from,
            { weightOz: b.weightOz, length: b.length, width: b.width, height: b.height },
            { carrierPref: 'usps', servicePref: _svcPref(b.mailClass),
              extra: { signature: !!b.signature, insurance: Number(b.insurance) || 0 } });
          if (buy && buy.tracking) {
            const rec = await recordLabel(b.orderId, buy.tracking, buy.carrier, buy.labelUrl, buy.cost, buy, b.to, req);
            return { ok: true, trackingNumber: buy.tracking, labelUrl: buy.labelUrl, imageType: 'PDF', carrier: buy.carrier, service: buy.service, cost: buy.cost, provider: buy.provider, ...rec };
          }
          reply.code(502);
          return { error: 'The shipping provider returned no label. Nothing was charged.' };
        } catch (e2) {
          // Do NOT fall through to USPS-direct. That path bills a USPS EPS account, so a
          // Shippo/EasyPost failure used to surface as "we are having trouble validating
          // your credit card" — an EPS error for an account the aggregator path never
          // needed, which sends you debugging the wrong system entirely.
          reply.code(502);
          return { error: 'Label purchase failed: ' + (e2 && e2.message ? e2.message : String(e2)) };
        }
      }
      // No aggregator configured, and USPS-direct wasn't explicitly asked for. Say so
      // plainly rather than attempting a path that needs USPS EPS billing approval.
      if (!shippingEnabled() && !b.directUsps && !process.env.USPS_MOCK) {
        reply.code(400);
        return { error: 'No shipping provider is configured. Set SHIPPO_API_TOKEN (or EASYPOST_API_KEY) on the server, or pass directUsps to buy through USPS EPS.' };
      }
      // TEST MODE — when USPS_MOCK is set, skip OAuth/payment and return a SAMPLE
      // label so the whole flow (modal → label → tracking → seller sync) can be
      // tested before USPS enables the Payments scope. Set USPS_MOCK= (empty) for real.
      if (process.env.USPS_MOCK) {
        const t = '9400TEST' + String(Date.now()).slice(-10);
        const e = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        const html =
          '<div style="font-family:Arial,sans-serif;width:384px;border:2px solid #111;padding:16px;box-sizing:border-box">'
          + '<div style="text-align:center;font-weight:800;font-size:13px;letter-spacing:1px;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:10px">USPS &mdash; SAMPLE (TEM TEST)</div>'
          + '<div style="font-size:11px;color:#555">FROM</div><div style="font-size:13px;font-weight:600;margin-bottom:10px">' + e(from.name) + '<br>' + e(from.street) + (from.street2 ? ' ' + e(from.street2) : '') + '<br>' + e(from.city) + ', ' + e(from.state) + ' ' + e(from.zip) + '</div>'
          + '<div style="font-size:11px;color:#555">SHIP TO</div><div style="font-size:17px;font-weight:700;margin-bottom:12px">' + e(to.name) + '<br>' + e(to.street) + (to.street2 ? ' ' + e(to.street2) : '') + '<br>' + e(to.city) + ', ' + e(to.state) + ' ' + e(to.zip) + '</div>'
          + ((b.signature || b.insurance) ? '<div style="font-size:10px;color:#111;font-weight:700;margin-bottom:8px">' + [b.signature ? 'SIGNATURE CONFIRMATION' : '', b.insurance ? 'INSURED' : ''].filter(Boolean).join(' · ') + '</div>' : '')
          + '<div style="font-family:monospace;letter-spacing:3px;font-size:38px;text-align:center;line-height:1;margin:4px 0">█║█║║██║█║║║█║██</div>'
          + '<div style="text-align:center;font-family:monospace;font-weight:700;font-size:15px;margin-top:4px">' + t + '</div>'
          + ((b.refNo || b.refNo2 || b.contents) ? '<div style="border-top:1px dashed #bbb;margin-top:10px;padding-top:6px;font-size:10px;color:#555;line-height:1.5">' + [b.refNo ? 'Ref 1: ' + e(b.refNo) : '', b.refNo2 ? 'Ref 2: ' + e(b.refNo2) : '', b.contents ? e(b.contents) : ''].filter(Boolean).join('<br>') + '</div>' : '')
          + '<div style="text-align:center;font-size:10px;color:#999;margin-top:10px">NOT VALID FOR POSTAGE · TEST LABEL</div></div>';
        const rec = await recordLabel(b.orderId, t, 'USPS', null, null, null, b.to, req);
        return { ok: true, mock: true, trackingNumber: t, imageType: 'HTML', labelHtml: html };
      }
      const oauth = await oauthToken();
      const pay = await paymentToken();
      const splitName = (n) => { const p = String(n || '').trim().split(/\s+/); return { first: p.shift() || 'Customer', last: p.join(' ') || '-' }; };
      const tn = splitName(to.name), fn = splitName(from.name);
      const payload = {
        imageInfo: { imageType: (b.imageType || 'PDF'), labelType: '4X6LABEL' },
        toAddress: { firstName: tn.first, lastName: tn.last, streetAddress: to.street, secondaryAddress: to.street2 || undefined, city: to.city, state: to.state, ZIPCode: String(to.zip).slice(0, 5) },
        fromAddress: { firstName: fn.first, lastName: fn.last, streetAddress: from.street, secondaryAddress: from.street2 || undefined, city: from.city, state: from.state, ZIPCode: String(from.zip).slice(0, 5) },
        packageDescription: {
          mailClass: b.mailClass || 'USPS_GROUND_ADVANTAGE',
          rateIndicator: b.rateIndicator || 'SP',
          weight: Math.max(0.0625, (Number(b.weightOz) || 8) / 16),   // oz → lb, min 1oz
          length: Number(b.length) || 9, width: Number(b.width) || 6, height: Number(b.height) || 2,
          processingCategory: 'MACHINABLE',
          destinationEntryFacilityType: 'NONE',
          mailingDate: b.mailingDate || new Date().toISOString().slice(0, 10)   // required by Labels 3.0
        }
      };
      const res = await fetch(`${BASE}/labels/v3/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'multipart/form-data',
                   Authorization: 'Bearer ' + oauth, 'X-Payment-Authorization-Token': pay },
        body: JSON.stringify(payload)
      });
      const ct = res.headers.get('content-type') || '';
      const ab = Buffer.from(await res.arrayBuffer());
      recordUsage('usps', { endpoint: 'label', ok: res.ok }); // $ tracked in wallet_ledger (label-cost); count volume only
      if (!res.ok) { reply.code(400); return { error: 'USPS label failed: ' + ab.toString('utf8').slice(0, 500) }; }
      // Labels 3.0 returns multipart/form-data: a JSON "labelMetadata" part (trackingNumber, postage)
      // + a "labelImage" part whose body is ALREADY base64 text (its header says application/pdf).
      // Parse both; fall back to plain JSON for older/simple responses.
      let tracking = '', labelImage = '', imgType = payload.imageInfo.imageType, cost = null;
      const bMatch = ct.match(/boundary=("?)([^";]+)\1/i);
      if (/multipart\//i.test(ct) && bMatch) {
        for (const part of _splitMultipart(ab, bMatch[2])) {
          if (/name="?labelMetadata"?/i.test(part.head) || /application\/json/i.test(part.head)) {
            try { const md = JSON.parse(part.body.toString('utf8')); tracking = md.trackingNumber || (md.labelMetadata && md.labelMetadata.trackingNumber) || tracking; if (md.postage != null) cost = md.postage; } catch (e) {}
          } else if (/name="?labelImage"?/i.test(part.head)) {
            labelImage = part.body.toString('latin1').trim();   // body is already base64 text — use as-is
            if (/image\/png/i.test(part.head)) imgType = 'PNG'; else if (/application\/pdf/i.test(part.head)) imgType = 'PDF';
          }
        }
      } else {
        try { const data = JSON.parse(ab.toString('utf8')); tracking = data.trackingNumber || (data.labelMetadata && data.labelMetadata.trackingNumber) || ''; labelImage = data.labelImage || (data.labelMetadata && data.labelMetadata.labelImage) || ''; } catch (e) {}
      }
      // Persist tracking onto the order if one was passed. Pass the parsed postage so the
      // cost is recorded (Price column + ledger) instead of being parsed then thrown away —
      // this path had it in `cost` but was storing null.
      if (b.orderId && tracking) {
        await recordLabel(b.orderId, tracking, 'USPS', null, cost, null, b.to, req);
      }
      return { ok: true, trackingNumber: tracking, imageType: imgType, labelImage, cost, contentType: ct };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // ── Live rates (Prices API) — powers the Shipping "Label" tab rate table + rate-shopping.
  // body: { toZip, fromZip?, weightOz?, length?, width?, height? } → cheapest rate per mail class.
  app.post('/api/usps/rates', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const b = req.body || {};
      const toZip = String(b.toZip || b.destinationZIPCode || '').replace(/\D/g, '').slice(0, 5);
      const fromZip = String(b.fromZip || b.originZIPCode || process.env.USPS_ORIGIN_ZIP || '').replace(/\D/g, '').slice(0, 5);
      if (!toZip || !fromZip) { reply.code(400); return { error: 'origin (fromZip) + destination (toZip) ZIP are required' }; }
      if (process.env.USPS_MOCK) {
        return { ok: true, mock: true, origin: fromZip, destination: toZip, weightOz: Number(b.weightOz) || 8, asOf: new Date().toISOString().slice(0, 10),
          rates: [{ mailClass: 'USPS_GROUND_ADVANTAGE', service: 'USPS Ground Advantage', price: 6.74, zone: '—', days: '2-5 days' }, { mailClass: 'PRIORITY_MAIL', service: 'Priority Mail', price: 9.85, zone: '—', days: '1-3 days' }] };
      }
      const oauth = await oauthToken();
      const payload = {
        originZIPCode: fromZip, destinationZIPCode: toZip,
        weight: Math.max(0.0625, (Number(b.weightOz) || 8) / 16),
        length: Number(b.length) || 9, width: Number(b.width) || 6, height: Number(b.height) || 3,
        mailingDate: b.mailingDate || new Date().toISOString().slice(0, 10),
        accountType: ACCT_TYPE, accountNumber: ACCT, priceType: 'COMMERCIAL'
      };
      const res = await fetch(`${BASE}/prices/v3/total-rates/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + oauth },
        body: JSON.stringify(payload)
      });
      const raw = await res.text();
      if (!res.ok) { reply.code(400); return { error: 'USPS rates failed: ' + raw.slice(0, 300) }; }
      let data = {}; try { data = JSON.parse(raw); } catch (e) {}
      const byClass = {};
      (data.rateOptions || []).forEach(function (opt) {
        (opt.rates || []).forEach(function (rt) {
          const mc = rt.mailClass || rt.productName || ''; const price = Number(rt.price);
          if (!mc || !isFinite(price)) return;
          if (!byClass[mc] || price < byClass[mc].price) {
            byClass[mc] = { mailClass: mc, service: rt.productName || rt.description || mc, price: price, zone: rt.zone || '', days: rt.productDefinition || (rt.commitment && rt.commitment.name) || '', startDate: rt.startDate || '', endDate: rt.endDate || '' };
          }
        });
      });
      const rates = Object.keys(byClass).map(function (k) { return byClass[k]; }).sort(function (a, c) { return a.price - c.price; });
      return { ok: true, origin: fromZip, destination: toZip, weightOz: Number(b.weightOz) || 8, asOf: new Date().toISOString().slice(0, 10), rates: rates };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // ── Return label (merchant-funded, Scan-Based Payment: charged only when the customer ships it).
  // Label goes FROM the customer TO our return address. body: { customer:{...}, to:{...return...},
  // weightOz, service:'ground'|'priority' }.
  app.post('/api/usps/return-label', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const b = req.body || {};
      const cust = b.customer || b.from || {}, ret = b.to || b.returnTo || {};
      if (!cust.zip || !cust.street) { reply.code(400); return { error: 'Customer street + ZIP are required' }; }
      if (!ret.zip || !ret.street) { reply.code(400); return { error: 'Return-to street + ZIP are required' }; }
      const svc = String(b.service || 'ground').toLowerCase();
      const mailClass = svc === 'priority' ? 'PRIORITY_MAIL_RETURN_SERVICE' : 'USPS_GROUND_ADVANTAGE_RETURN_SERVICE';
      if (process.env.USPS_MOCK) {
        const t = '9202' + String(Date.now()).slice(-14) + '02';
        return { ok: true, mock: true, trackingNumber: t, imageType: 'HTML', labelHtml: '<div style="border:2px solid #111;padding:14px;font-family:monospace">USPS RETURN — SAMPLE<br>' + mailClass + '<br>' + t + '</div>', service: mailClass, scanBasedPayment: true };
      }
      const oauth = await oauthToken(); const pay = await paymentToken();
      const splitName = (n) => { const p = String(n || '').trim().split(/\s+/); return { first: p.shift() || 'Customer', last: p.join(' ') || '-' }; };
      const cn = splitName(cust.name), rn = splitName(ret.name);
      const payload = {
        imageInfo: { imageType: (b.imageType || 'PDF'), labelType: '4X6LABEL' },
        fromAddress: { firstName: cn.first, lastName: cn.last, streetAddress: cust.street, secondaryAddress: cust.street2 || undefined, city: cust.city, state: cust.state, ZIPCode: String(cust.zip).slice(0, 5) },
        toAddress: { firstName: rn.first, lastName: rn.last, streetAddress: ret.street, secondaryAddress: ret.street2 || undefined, city: ret.city, state: ret.state, ZIPCode: String(ret.zip).slice(0, 5) },
        packageDescription: {
          mailClass: mailClass, rateIndicator: b.rateIndicator || 'SP',
          weight: Math.max(0.0625, (Number(b.weightOz) || 8) / 16),
          length: Number(b.length) || 9, width: Number(b.width) || 6, height: Number(b.height) || 2,
          processingCategory: 'MACHINABLE', destinationEntryFacilityType: 'NONE',
          mailingDate: b.mailingDate || new Date().toISOString().slice(0, 10)
        }
      };
      const res = await fetch(`${BASE}/labels/v3/return-label`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'multipart/form-data', Authorization: 'Bearer ' + oauth, 'X-Payment-Authorization-Token': pay },
        body: JSON.stringify(payload)
      });
      const ct = res.headers.get('content-type') || '';
      const ab = Buffer.from(await res.arrayBuffer());
      if (!res.ok) { reply.code(400); return { error: 'USPS return label failed: ' + ab.toString('utf8').slice(0, 400) }; }
      const parsed = _parseLabelMultipart(ct, ab, payload.imageInfo.imageType);
      return { ok: true, trackingNumber: parsed.tracking, imageType: parsed.imgType, labelImage: parsed.labelImage, cost: parsed.cost, service: mailClass, scanBasedPayment: true, contentType: ct };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // ── Refund/cancel an UNUSED label (before it enters the mailstream). Postage credits back to EPS.
  // body: { tracking } → USPS returns { status:'CANCELED' } on success. (Frontend: Refund pending → Refunded.)
  app.post('/api/usps/refund', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const tracking = String((req.body && (req.body.tracking || req.body.trackingNumber)) || '').replace(/\s/g, '');
      if (!tracking) { reply.code(400); return { error: 'tracking number required' }; }
      if (process.env.USPS_MOCK) return { ok: true, mock: true, trackingNumber: tracking, status: 'CANCELED' };
      const oauth = await oauthToken(); const pay = await paymentToken();
      const res = await fetch(`${BASE}/labels/v3/label/${encodeURIComponent(tracking)}`, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + oauth, 'X-Payment-Authorization-Token': pay }
      });
      const raw = await res.text();
      if (!res.ok) { reply.code(400); return { error: 'USPS refund failed: ' + raw.slice(0, 300) }; }
      let data = {}; try { data = JSON.parse(raw); } catch (e) {}
      return { ok: true, trackingNumber: data.trackingNumber || tracking, status: data.status || 'CANCELED' };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
