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
const EP_KEY = process.env.EASYPOST_API_KEY || '';
const SH_TOKEN = process.env.SHIPPO_API_TOKEN || '';
const EP_BASE = 'https://api.easypost.com/v2';
const SH_BASE = 'https://api.goshippo.com';

const epAuth = () => 'Basic ' + Buffer.from(EP_KEY + ':').toString('base64');
const shAuth = () => 'ShippoToken ' + SH_TOKEN;

function enc(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64'); }
function dec(tok) { try { return JSON.parse(Buffer.from(String(tok || ''), 'base64').toString('utf8')); } catch (e) { return null; } }

// Normalize an address from the frontend → provider shape.
function addr(a) {
  a = a || {};
  return {
    name: a.name || '', street1: a.street1 || a.street || '', street2: a.street2 || '',
    city: a.city || '', state: a.state || '', zip: a.zip || '', country: a.country || 'US',
    phone: a.phone || '', email: a.email || ''
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
    labelUrl: (d.postage_label && (d.postage_label.label_url || d.postage_label.label_pdf_url)) || ''
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
    body: JSON.stringify({ rate: rateObjectId, label_file_type: 'PDF', async: false })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.status !== 'SUCCESS') {
    const msg = (d.messages && d.messages.map((m) => m.text).join('; ')) || d.detail || ('Shippo buy HTTP ' + r.status);
    throw new Error(msg);
  }
  return {
    provider: 'shippo', carrier: (d.rate && d.rate.provider) || '', service: (d.rate && d.rate.servicelevel && d.rate.servicelevel.name) || '',
    cost: (d.rate && Number(d.rate.amount)) || null, tracking: d.tracking_number || '',
    labelUrl: d.label_url || ''
  };
}

export function shippingRoutes(app, requireAuth, requireStaff) {
  const guard = { preHandler: requireStaff };

  app.get('/api/shipping/config', guard, async () => ({
    easypost: !!EP_KEY, shippo: !!SH_TOKEN, enabled: !!(EP_KEY || SH_TOKEN)
  }));

  app.get('/api/shipping/test', guard, async () => {
    const out = {};
    if (EP_KEY) { try { const r = await fetch(EP_BASE + '/api_keys', { headers: { Authorization: epAuth() } }); out.easypost = r.ok ? 'ok' : ('HTTP ' + r.status); } catch (e) { out.easypost = 'FAILED: ' + e.message; } }
    else out.easypost = 'no key';
    if (SH_TOKEN) { try { const r = await fetch(SH_BASE + '/addresses/?results=1', { headers: { Authorization: shAuth() } }); out.shippo = r.ok ? 'ok' : ('HTTP ' + r.status); } catch (e) { out.shippo = 'FAILED: ' + e.message; } }
    else out.shippo = 'no token';
    return out;
  });

  // Merged, cheapest-first rates from all enabled providers.
  app.post('/api/shipping/rates', guard, async (req, reply) => {
    if (!EP_KEY && !SH_TOKEN) { reply.code(400); return { error: 'No shipping provider configured (set EASYPOST_API_KEY or SHIPPO_API_TOKEN)' }; }
    const b = req.body || {};
    const to = addr(b.to), from = addr(b.from), pc = parcel(b.parcel || b);
    if (!to.zip || !to.street1) { reply.code(400); return { error: 'Recipient street + ZIP required' }; }
    if (!from.zip || !from.street1) { reply.code(400); return { error: 'Sender street + ZIP required' }; }
    const jobs = [];
    if (EP_KEY) jobs.push(epRates(to, from, pc).catch((e) => ({ _err: 'EasyPost: ' + e.message })));
    if (SH_TOKEN) jobs.push(shRates(to, from, pc).catch((e) => ({ _err: 'Shippo: ' + e.message })));
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
        if (!EP_KEY && !SH_TOKEN) { reply.code(400); return { error: 'No shipping provider configured' }; }
        const to = addr(b.to), from = addr(b.from), pc = parcel(b.parcel || b);
        if (!to.zip || !to.street1 || !from.zip || !from.street1) { reply.code(400); return { error: 'Sender + recipient street + ZIP required' }; }
        const jobs = [];
        if (EP_KEY) jobs.push(epRates(to, from, pc).catch(() => []));
        if (SH_TOKEN) jobs.push(shRates(to, from, pc).catch(() => []));
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
  app.get('/api/shipping/track', guard, async (req, reply) => {
    const q = req.query || {};
    const provider = q.provider, carrier = q.carrier, tracking = q.tracking;
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
