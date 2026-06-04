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
  _oauth = { token: d.access_token, exp: Date.now() + ((d.expires_in || 28800) * 1000) };
  return _oauth.token;
}

// 2) Payment authorization token — needs CRID + MID + EPS account.
async function paymentToken() {
  if (_pay.token && Date.now() < _pay.exp - 60000) return _pay.token;
  if (!CRID || !MID || !ACCT) throw new Error('Server missing USPS_CRID / USPS_MID / USPS_ACCOUNT_NUMBER (needed for the payment token)');
  const tok = await oauthToken();
  const body = {
    roles: [
      { roleName: 'PAYER',       CRID, MID, accountType: ACCT_TYPE, accountNumber: ACCT },
      { roleName: 'LABEL_OWNER', CRID, MID, accountType: ACCT_TYPE, accountNumber: ACCT }
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

export function uspsRoutes(app, requireAuth, requireStaff) {
  // Connectivity/qualification check — surfaces exactly which step is wired.
  app.get('/api/usps/test', { preHandler: requireStaff }, async () => {
    const out = { base: BASE, env: BASE.includes('-tem') ? 'TEM (test)' : 'PRODUCTION',
      consumerKey: !!KEY, consumerSecret: !!SECRET, crid: !!CRID, mid: !!MID, account: !!ACCT };
    try { await oauthToken(); out.oauth = 'ok'; }
    catch (e) { out.oauth = 'FAILED: ' + e.message; return out; }
    try { await paymentToken(); out.payment = 'ok'; out.qualified = true; }
    catch (e) { out.payment = 'FAILED: ' + e.message; out.qualified = false; }
    return out;
  });

  // Address validation (USPS Addresses 3.0) — standardizes/verifies an address.
  // Only needs OAuth (no payment scope). Query: streetAddress, secondaryAddress,
  // city, state, ZIPCode. Returns the standardized address or an error.
  app.get('/api/usps/validate-address', { preHandler: requireStaff }, async (req, reply) => {
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
          destinationEntryFacilityType: 'NONE'
        }
      };
      const res = await fetch(`${BASE}/labels/v3/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                   Authorization: 'Bearer ' + oauth, 'X-Payment-Authorization-Token': pay },
        body: JSON.stringify(payload)
      });
      const ct = res.headers.get('content-type') || '';
      const raw = await res.text();
      if (!res.ok) { reply.code(400); return { error: 'USPS label failed: ' + raw.slice(0, 500) }; }
      // Labels 3.0 returns JSON with the label image base64 + tracking number.
      let data = {}; try { data = JSON.parse(raw); } catch (e) {}
      const tracking = data.trackingNumber || (data.labelMetadata && data.labelMetadata.trackingNumber) || '';
      const labelImage = data.labelImage || (data.labelMetadata && data.labelMetadata.labelImage) || '';
      // Persist tracking onto the order if one was passed.
      if (b.orderId && tracking) {
        try { await q(`update orders set tracking=$1, carrier='USPS', factory_status='shipped', status='shipped' where id=$2`, [tracking, b.orderId]); } catch (e) {}
      }
      return { ok: true, trackingNumber: tracking, imageType: payload.imageInfo.imageType, labelImage, contentType: ct };
    } catch (e) { reply.code(400); return { error: e.message }; }
  });
}
