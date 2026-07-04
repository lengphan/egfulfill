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
import { shippingEnabled, aggregatorBuyCheapest } from './shipping.js';

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
    try {
      const oauth = await oauthToken();
      const qy = req.query || {};
      const p = new URLSearchParams();
      ['streetAddress', 'secondaryAddress', 'city', 'state', 'ZIPCode'].forEach((k) => { if (qy[k]) p.set(k, qy[k]); });
      const res = await fetch(`${BASE}/addresses/v3/address?` + p.toString(), { headers: { Authorization: 'Bearer ' + oauth } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { reply.code(400); return { error: (data.error && (data.error.message || data.error)) || data.message || ('HTTP ' + res.status) }; }
      const a = data.address || data;
      return { ok: true, address: { street: a.streetAddress || '', street2: a.secondaryAddress || '', city: a.city || '', state: a.state || '', zip: a.ZIPCode || '', zip4: a.ZIPPlus4 || '' }, raw: data };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });

  // Create a label. body: { to:{name,street,street2,city,state,zip}, from:{...},
  //   weightOz, length, width, height, mailClass, imageType('PDF'|'ZPL...'), orderId }
  app.post('/api/usps/label', { preHandler: requireStaff }, async (req, reply) => {
    try {
      const b = req.body || {};
      const to = b.to || {}, from = b.from || {};
      if (!to.zip || !to.street) { reply.code(400); return { error: 'Recipient street + ZIP are required' }; }
      if (!from.zip || !from.street) { reply.code(400); return { error: 'Sender (from) street + ZIP are required' }; }
      // PREFERRED PATH — when a shipping aggregator (Shippo/EasyPost) is configured,
      // buy a REAL label through it (test keys → real design, watermarked, no charge).
      // Restricted to USPS here so a UPS test-account gap can't fail the buy.
      if (shippingEnabled()) {
        try {
          const buy = await aggregatorBuyCheapest(to, from,
            { weightOz: b.weightOz, length: b.length, width: b.width, height: b.height },
            { carrierPref: 'usps', servicePref: _svcPref(b.mailClass) });
          if (buy && buy.tracking) {
            if (b.orderId) { try { await q(`update orders set tracking=$1, carrier=$2, factory_status='shipped', status='shipped' where id=$3`, [buy.tracking, buy.carrier || 'USPS', b.orderId]); } catch (e2) {} }
            return { ok: true, trackingNumber: buy.tracking, labelUrl: buy.labelUrl, imageType: 'PDF', carrier: buy.carrier, service: buy.service, cost: buy.cost, provider: buy.provider };
          }
        } catch (e2) { /* fall through to USPS-direct / mock */ }
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
        if (b.orderId) { try { await q(`update orders set tracking=$1, carrier='USPS', factory_status='shipped', status='shipped' where id=$2`, [t, b.orderId]); } catch (e2) {} }
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
      // Persist tracking onto the order if one was passed.
      if (b.orderId && tracking) {
        try { await q(`update orders set tracking=$1, carrier='USPS', factory_status='shipped', status='shipped' where id=$2`, [tracking, b.orderId]); } catch (e) {}
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
