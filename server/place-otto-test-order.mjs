// Place a SANDBOX test order with Otto Cap — satisfies the "place 3+ test orders" onboarding step.
// The SANDBOX environment IS the test environment (no real charge/ship), so this is safe.
//
//   Run on the VPS:  cd server && node place-otto-test-order.mjs <SKU> [QTY]
//   e.g.             node place-otto-test-order.mjs 103-1243-NP0303 12
//
// You need a VALID sandbox SKU from Otto (the API has no product-list endpoint — see the guide's
// Inventory examples, e.g. 92-1097-001-M / 103-1243-NP0303, or ask api@ottocap.com for test SKUs).
// It loads .env itself (older Node has no --env-file): CLI path → ../.env → ./.env.
import { readFileSync } from 'node:fs';

(function loadEnv() {
  for (const p of [process.argv[4], '../.env', './.env', './server/.env'].filter(Boolean)) {
    let txt; try { txt = readFileSync(p, 'utf8'); } catch (e) { continue; }
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m || /^\s*#/.test(line)) continue;
      let v = m[2].trim(); if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
    console.log('Loaded env from ' + p); break;
  }
})();

const SKU = process.argv[2];
const QTY = String(parseInt(process.argv[3], 10) || 12);
if (!SKU) { console.error('Usage: node place-otto-test-order.mjs <SKU> [QTY]  — needs a valid Otto sandbox SKU'); process.exit(1); }

const USER = (process.env.OTTOCAP_USERNAME || '').trim();
const PASS = (process.env.OTTOCAP_PASSWORD || '').trim();
const CID  = (process.env.OTTOCAP_CLIENT_ID || '').trim();
const SEC  = (process.env.OTTOCAP_CLIENT_SECRET || '').trim();
const BASE = (process.env.OTTOCAP_API_BASE || 'https://sandbox-api.ottocap.com').trim().replace(/\/$/, '');
const SUPPLIER = '00ceb24d-9b6f-4ba1-91c8-aa375ab96651';
if (!/sandbox/i.test(BASE)) { console.error('✗ REFUSING — OTTOCAP_API_BASE is not the sandbox (' + BASE + '). Point it at https://sandbox-api.ottocap.com for test orders.'); process.exit(1); }
if (!USER || !PASS || !CID || !SEC) { console.error('✗ Missing OTTOCAP_* creds in .env'); process.exit(1); }

async function getToken() {
  const auth = Buffer.from(CID + ':' + SEC).toString('base64');
  const r = await fetch(BASE + '/authenticate/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + auth },
    body: new URLSearchParams({ username: USER, password: PASS, grant_type: 'password' })
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.access_token) throw new Error('auth failed HTTP ' + r.status);
  return d.access_token;
}
let TOK;
async function api(path, opts) {
  const r = await fetch(BASE + path, Object.assign({ headers: {} }, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + TOK, Accept: 'application/json' }, (opts && opts.headers) || {})
  }));
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch (e) { d = t; }
  return { ok: r.ok, status: r.status, data: d };
}

try {
  console.log('Base:', BASE, '(sandbox — test order)');
  TOK = await getToken();
  console.log('✓ auth ok\n');

  // 1) customer + contact
  const cr = await api('/customers');
  if (!cr.ok || !Array.isArray(cr.data) || !cr.data.length) { console.error('✗ /customers returned nothing usable:', cr.status, JSON.stringify(cr.data).slice(0, 300)); process.exit(1); }
  const cust = cr.data[0]; const contact = (cust.contacts && cust.contacts[0]) || null;
  console.log('customer:', cust.company_name || cust.id, '· contact:', contact ? (contact.first_name + ' ' + contact.last_name) : '(none)');

  // 2) shipping method (prefer a "normal" one)
  const sr = await api('/shipping_methods');
  const ship = (Array.isArray(sr.data) ? (sr.data.find(s => s.type === 'normal') || sr.data[0]) : null);
  if (!ship) { console.error('✗ /shipping_methods returned nothing:', sr.status); process.exit(1); }
  console.log('shipping:', ship.code, '\n');

  // 3) build + submit (billing = shipping = Otto's QA test address from the guide)
  const addr = { name: 'OTTO QA', company_name: 'Otto International', email: 'testing@ottocap.com', phone: '(333) 333-3333', country: 'US', city: 'Hanover', state: 'MD', state_text: '', zip: '21076', address_1: '7000 Arundel Mills Circle', address_2: '', is_residential: false };
  const order = {
    payment_method: 'net30', customer: cust.id, contact: contact ? contact.id : undefined,
    shipping_method: ship.id, order_comment: 'EGFULFILL sandbox test order',
    customer_po: 'EG-TEST-' + Date.now(), billing_address: addr, shipping_address: addr,
    items: [{ sku: SKU, qty: QTY, supplier: SUPPLIER }]
  };
  console.log('POST /orders/  ·  sku', SKU, '× ' + QTY);
  const or = await api('/orders/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
  if (!or.ok) { console.error('\n✗ order rejected — HTTP', or.status); console.error(JSON.stringify(or.data, null, 2).slice(0, 800)); process.exit(1); }
  const num = Array.isArray(or.data) ? (or.data[0] && or.data[0].order_number) : (or.data && or.data.order_number);
  console.log('\n✓ SANDBOX TEST ORDER PLACED — order_number:', num || '(see response)');
  console.log(JSON.stringify(or.data, null, 2).slice(0, 600));
  console.log('\nRun this 3+ times (different SKUs is fine), then email api@ottocap.com with your order numbers.');
} catch (e) {
  console.error('✗', e.message); process.exit(1);
}
