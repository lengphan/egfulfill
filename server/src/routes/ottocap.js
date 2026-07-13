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
const ocPost = (path, b) => ocFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

// Small helper to keep the routes terse + consistent.
function guard(reply) { if (!ocConfigured()) { reply.code(400); return { error: 'Otto Cap not configured.' }; } return null; }
async function passthru(reply, path) {
  try { const r = await ocGet(path); if (!r.ok) { reply.code(502); return { error: 'Otto request failed', status: r.status, detail: r.data }; } return r.data; }
  catch (e) { reply.code(502); return { error: String((e && e.message) || e) }; }
}

export function ottoCapRoutes(app, requireAuth, requireStaff, requireAdmin) {
  // Config + live-token check (never leaks the secrets).
  app.get('/api/otto/status', { preHandler: requireStaff }, async () => {
    const out = { configured: ocConfigured(), base: OC_BASE, sandbox: isSandbox(), supplier: OC_SUPPLIER };
    if (ocConfigured()) { try { await ocToken(); out.auth = 'ok'; } catch (e) { out.auth = 'failed'; out.error = String((e && e.message) || e); } }
    return out;
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
  app.post('/api/otto/order', { preHandler: requireStaff }, async (req, reply) => {
    const g = guard(reply); if (g) return g;
    const b = req.body || {};
    const items = (Array.isArray(b.items) ? b.items : [])
      .map((it) => ({ sku: String(it.sku || '').trim(), qty: String(parseInt(it.qty, 10) || 0), supplier: OC_SUPPLIER }))
      .filter((it) => it.sku && parseInt(it.qty, 10) > 0);
    if (!items.length) { reply.code(400); return { error: 'No items — each needs a sku + qty.' }; }
    const payload = {
      payment_method: b.payment_method || 'net30',
      customer: b.customer || undefined,
      contact: b.contact || undefined,
      shipping_method: b.shipping_method || undefined,
      third_party_shipping_account_number: b.third_party_shipping_account_number || undefined,
      order_comment: b.order_comment || undefined,
      customer_po: b.customer_po || ('EG-' + Date.now()),
      billing_address: b.billing_address || undefined,
      shipping_address: b.shipping_address || undefined,
      items,
      card_details: b.card_details || undefined
    };
    if (String(process.env.OTTOCAP_ORDER_LIVE || '') !== '1') {
      return { dryRun: true, sandbox: isSandbox(), note: 'OTTOCAP_ORDER_LIVE!=1 → NOT sent to Otto. Review the payload; set OTTOCAP_ORDER_LIVE=1 (with the sandbox base) to place a real SANDBOX test order.', payload };
    }
    try { const r = await ocPost('/orders/', payload); if (!r.ok) { reply.code(502); return { error: 'Otto rejected the order', status: r.status, detail: r.data }; } return { ok: true, sandbox: isSandbox(), ottoResponse: r.data }; }
    catch (e) { reply.code(502); return { error: String((e && e.message) || e) }; }
  });

  // Order tracking.
  app.get('/api/otto/order/:num/status', { preHandler: requireStaff }, async (req, reply) => { const g = guard(reply); if (g) return g; return passthru(reply, '/orders/' + encodeURIComponent(req.params.num) + '/status'); });
  app.get('/api/otto/order/:num/shipments', { preHandler: requireStaff }, async (req, reply) => { const g = guard(reply); if (g) return g; return passthru(reply, '/orders/' + encodeURIComponent(req.params.num) + '/shipments'); });
}
