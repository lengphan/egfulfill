#!/usr/bin/env node
/**
 * THE PARTNER-ACCESS AUDIT — run before any third party holds a key, and after any change
 * to a key-authed route.
 *
 * check-public-api.mjs asks "does the documented API answer". This asks the other question:
 * WHAT ELSE DOES IT ANSWER. All of it executed rather than read (§7) — a redaction you can
 * only see by reading is a redaction nobody has tested.
 *
 *   1. §2.9 — nothing naming who supplies us leaves through a key. The catalogue and shelf
 *      rows seeded here are POISONED ON PURPOSE: the id carries an import prefix, the data
 *      blob carries productCost and supplier, the images sit on a supplier CDN. Every
 *      response is then searched for every one of those tokens. A clean fixture would prove
 *      only that a clean row is clean.
 *   2. ONE SELLER'S KEY REACHES ONE SELLER'S DATA — two sellers, real orders, real webhook
 *      endpoints, every cross read attempted.
 *   3. THE CREDENTIAL BEHAVES — scopes refuse, revocation bites, an unknown key is 401, the
 *      limiter is armed on every key-authed route, and a webhook URL that resolves inward
 *      is refused (SSRF).
 *
 * Run: node tools/check-api-leaks.mjs     (SKIPS cleanly with no local Postgres)
 */
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'server/package.json'))
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts })

try { sh('pg_isready', []) } catch {
  console.log('SKIP  no local Postgres accepting connections — start one to run this gate.')
  process.exit(0)
}
let jwt
try { jwt = require('jsonwebtoken') } catch {
  console.log('SKIP  server/node_modules is not installed — run `npm i` in server/ first.')
  process.exit(0)
}

const DB = 'egfulfill_api_leak_gate'
const PORT = 4142
const URL_ = `postgres://localhost:5432/${DB}`
const SECRET = 'leak-gate-secret'

try { sh('dropdb', ['--if-exists', DB]) } catch { /* nothing to drop */ }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])
const psql = (sql) => sh('psql', ['-t', '-A', '-q', '-d', DB, '-c', sql]).trim()

const mkSeller = (email) => psql(
  `insert into users (email, password_hash, role, name) values ('${email}','x','seller','${email}') returning id`
).split('\n')[0].trim()
const A = mkSeller('seller-a@test.local')
const B = mkSeller('seller-b@test.local')

const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DATABASE_URL: URL_, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (process.env.GATE_DEBUG) { api.stdout.on('data', d => process.stderr.write(d)); api.stderr.on('data', d => process.stderr.write(d)) }
const API = `http://127.0.0.1:${PORT}`

let bad = 0
const check = (label, ok, detail = '') => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `  — ${detail}`}`)
}
function teardown() {
  try { api.kill('SIGKILL') } catch { /* already gone */ }
  try { sh('dropdb', ['--if-exists', DB]) } catch { /* the next run drops it */ }
}
process.on('exit', teardown)

const waitForApi = async () => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${API}/health`)).ok) return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
if (!(await waitForApi())) {
  console.error('FAIL  the API never came up — §2.1, and that is every route, not just these.')
  process.exit(1)
}

/* The route-load migrations are fire-and-forget promises, so /health answering 200 does not
   mean they have landed — poll for the columns themselves rather than sleeping and hoping.
   (This is the same trap as §2.1's stale process: a check that passes before the thing it
   checks has happened.) */
const hasColumn = (table, column) =>
  psql(`select count(*) from information_schema.columns where table_name='${table}' and column_name='${column}'`).split('\n')[0].trim() === '1'
for (let i = 0; i < 40 && !(hasColumn('catalog_products', 'data') && hasColumn('inventory', 'visibility')); i++) {
  await new Promise((r) => setTimeout(r, 250))
}
if (!(hasColumn('catalog_products', 'data') && hasColumn('inventory', 'visibility'))) {
  console.error('FAIL  the route-load migrations never ran — nothing below would mean anything.')
  process.exit(1)
}

/* SEEDED AFTER THE BOOT, and that ordering is itself part of the test. catalog_products.data
   and inventory.visibility are added at ROUTE LOAD, not in schema.sql (§6) — so a fixture
   written before the app starts fails on a column that does not exist yet, and one written
   after exercises the same two-step migration a real deployment runs. */
/**
 * THE POISONED ROW. Every field here is one that has leaked or could:
 *   id            the import prefix — measured on the live catalogue, 21 of 28 rows name a
 *                 supplier outright, and it is an IDENTIFIER, which is the shape §2.9 warns
 *                 about because nobody thinks of it as a field about suppliers
 *   productCost   what WE pay; read across products it is our margin
 *   supplier      the obvious one, which is never the one that leaks
 *   img           a supplier CDN address — the rule covers URLs, not just fields
 *   spec_sheet    a supplier-branded PDF on a supplier domain
 */
psql(`insert into catalog_products (id, name, sku, type, method, base_price, price, data)
      values ('SANMAR-108085','Gate Tee','GATETEE','Apparel','DTG',8.50,14.50,
        '{"productCost": 3.11, "supplier": "SanMar", "supplierSku": "103-713-031753A",
          "img": "https://cdn.ssactivewear.com/Images/Style/29M_f.jpg",
          "spec_sheet": "https://www.sanmar.com/specs/108085.pdf",
          "sizes": ["S","M","L"]}'::jsonb)`)
psql(`insert into inventory (sku, name, variant, in_stock, reserved, category, visibility)
      values ('GATETEE','Gate Tee','Black / L',40,5,'Apparel','seller')`)


const tokenFor = (id, email) => jwt.sign({ sub: id, role: 'seller', email }, SECRET, { expiresIn: '1h' })
const mintKey = async (id, email, mode, scopes) => {
  const r = await fetch(`${API}/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(id, email) },
    body: JSON.stringify({ mode, label: 'gate', ...(scopes ? { scopes } : {}) }),
  })
  return r.json()
}
const call = async (key, method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { ...(key ? { 'X-API-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let json = null
  try { json = await r.json() } catch { /* not json */ }
  return { status: r.status, body: json ?? {}, headers: r.headers, text: JSON.stringify(json ?? {}) }
}

const keyA = (await mintKey(A, 'seller-a@test.local', 'live')).key
const keyB = (await mintKey(B, 'seller-b@test.local', 'live')).key
const keyTest = (await mintKey(A, 'seller-a@test.local', 'test')).key
check('two sellers hold live keys', !!keyA && !!keyB && keyA !== keyB)

const ADDRESS = { name: 'Ava Brodeur', street1: '43 Calumet Rd', city: 'Fairhaven', state: 'MA', zip: '02719', country: 'US' }
const ITEMS = [{ product_id: 'GATETEE', quantity: 2, color: 'Black', size: 'L', method: 'DTG' }]

/* ─── 1 · §2.9 ─────────────────────────────────────────────────────────────────────── */
console.log('\n1 · NOTHING NAMES OUR SUPPLIER, THROUGH ANY KEY-AUTHED ROUTE (§2.9)')
const FORBIDDEN = [
  ['SANMAR-108085', 'the catalogue row id, which carries the import prefix'],
  ['SanMar', 'the supplier by name'],
  ['sanmar.com', 'a supplier domain'],
  ['ssactivewear', 'a supplier CDN host'],
  ['103-713-031753A', 'the supplier sku'],
  ['productCost', 'what we pay'],
  ['3.11', 'the cost figure itself'],
  ['supplierSku', 'the field name'],
  ['/api/ss/img', 'the internal image proxy path, which prints the supplier domain in a query string'],
]
const orderA = await call(keyA, 'POST', '/api/v1/orders', { external_id: 'gate-1', items: ITEMS, shipping_address: ADDRESS })
const sweep = [
  ['products',  await call(keyA, 'GET', '/api/v1/products')],
  ['stock',     await call(keyA, 'GET', '/api/v1/stock')],
  ['stock?sku', await call(keyA, 'GET', '/api/v1/stock?sku=GATETEE')],
  ['quote',     await call(keyA, 'POST', '/api/v1/orders/quote', { items: ITEMS })],
  ['create',    orderA],
  ['retrieve',  await call(keyA, 'GET', `/api/v1/orders/${orderA.body.id}`)],
  ['balance',   await call(keyA, 'GET', '/api/v1/balance')],
  ['bad sku',   await call(keyA, 'POST', '/api/v1/orders/quote', { items: [{ product_id: 'NOPE', quantity: 1 }] })],
  ['bad size',  await call(keyA, 'POST', '/api/v1/orders/quote', { items: [{ product_id: 'GATETEE', quantity: 1, size: 'XXXXL' }] })],
]
for (const [name, res] of sweep) {
  const hit = FORBIDDEN.find(([tok]) => res.text.includes(tok))
  check(`${name} says nothing it should not`, !hit, hit ? `leaked ${hit[0]} — ${hit[1]}` : '')
}
/* The order was created from the poisoned row: the line stored must carry OUR sku, not
   theirs, because an order_item's sku is read back by half the app. */
const storedSku = psql(`select sku from order_items where order_id='${orderA.body.id}'`).split('\n')[0].trim()
check('a stored order line carries our sku, not the supplier one', storedSku === 'GATETEE', `stored ${storedSku}`)

/* A row that has not been cleared for partners must not appear. The default is set in two
   steps at route load (add 'seller' to backfill, then alter default to 'factory') — easy to
   break by reordering, and the only way to know is to insert one and look. */
psql(`insert into inventory (sku, name, variant, in_stock, category) values ('ARRIVED-TODAY','Just Received','Black',77,'Apparel')`)
const stockNow = await call(keyA, 'GET', '/api/v1/stock')
check('stock arriving on the shelf is NOT published by default', !stockNow.text.includes('ARRIVED-TODAY'),
  'a received sku reached a partner without anyone deciding to sell it')
check('…and a factory-only row stays factory-only', !stockNow.text.includes('Never Published'))

/* ─── 2 · isolation ────────────────────────────────────────────────────────────────── */
console.log('\n2 · ONE KEY REACHES ONE SELLER')
const orderB = await call(keyB, 'POST', '/api/v1/orders', { external_id: 'gate-b', items: ITEMS, shipping_address: { ...ADDRESS, name: 'Bea Owner', street1: '9 Private Way' } })
check("seller B's order was created", orderB.status === 200 && !!orderB.body.id, JSON.stringify(orderB.body).slice(0, 120))

const peek = await call(keyA, 'GET', `/api/v1/orders/${orderB.body.id}`)
check("A cannot retrieve B's order", peek.status === 404, `${peek.status} ${peek.text.slice(0, 120)}`)
check("…and no fragment of B's address came back", !peek.text.includes('Private Way') && !peek.text.includes('Bea Owner'))

const steal = await call(keyA, 'POST', `/api/v1/orders/${orderB.body.id}/cancel`)
const bStillLive = psql(`select coalesce(factory_status,'') from orders where id='${orderB.body.id}'`).split('\n')[0].trim()
check("A cannot cancel B's order", steal.status === 404, `${steal.status}`)
check('…and it was not touched', bStillLive !== 'cancelled', `stage is now ${bStillLive || '(new)'}`)

/* external_id is scoped per seller: two partners both number their first order 1001. */
const collide = await call(keyB, 'POST', '/api/v1/orders', { external_id: 'gate-1', items: ITEMS, shipping_address: ADDRESS })
check('the same external_id under two sellers makes two orders', collide.status === 200 && collide.body.id !== orderA.body.id)
const replay = await call(keyA, 'POST', '/api/v1/orders', { external_id: 'gate-1', items: ITEMS, shipping_address: ADDRESS })
check('…while a replay under the SAME seller is idempotent', replay.body.idempotent === true && replay.body.id === orderA.body.id,
  JSON.stringify(replay.body).slice(0, 140))

const hookB = await call(keyB, 'POST', '/api/webhooks', { url: 'https://b-only.example.com/hooks' })
const hooksSeenByA = await call(keyA, 'GET', '/api/webhooks')
check("A cannot see B's webhook endpoints", !hooksSeenByA.text.includes('b-only.example.com'), hooksSeenByA.text.slice(0, 140))
const delivB = await call(keyA, 'GET', `/api/webhooks/${hookB.body.id}/deliveries`)
check("A cannot read B's delivery history", delivB.status === 404, `${delivB.status}`)
const delB = await call(keyA, 'DELETE', `/api/webhooks/${hookB.body.id}`)
const stillThere = psql(`select count(*) from webhook_endpoints where id=${Number(hookB.body.id) || 0}`).split('\n')[0].trim()
check("A cannot delete B's webhook", stillThere === '1', `delete answered ${delB.status}, row count now ${stillThere}`)

/* A TEST KEY MUST NOT BE A BACK DOOR. It resolves any id to a simulation — that simulation
   must be canned, never a real row belonging to anyone. */
const testPeek = await call(keyTest, 'GET', `/api/v1/orders/${orderB.body.id}`)
check('a test key reading a real id gets a simulation, not the row',
  testPeek.body.mode === 'test' && testPeek.body.total === null, testPeek.text.slice(0, 140))
const testCancel = await call(keyTest, 'POST', `/api/v1/orders/${orderB.body.id}/cancel`)
const bAfterTest = psql(`select coalesce(factory_status,'') from orders where id='${orderB.body.id}'`).split('\n')[0].trim()
check('…and a test key cancels nothing real', bAfterTest !== 'cancelled', `stage ${bAfterTest || '(new)'}`)

/* ─── 3 · the credential ───────────────────────────────────────────────────────────── */
console.log('\n3 · THE CREDENTIAL BEHAVES')
const narrow = (await mintKey(A, 'seller-a@test.local', 'live', ['products.read'])).key
check('a products.read key may read products', (await call(narrow, 'GET', '/api/v1/products')).status === 200)
for (const [label, res] of [
  ['create an order', await call(narrow, 'POST', '/api/v1/orders', { items: ITEMS, shipping_address: ADDRESS })],
  ['read the balance', await call(narrow, 'GET', '/api/v1/balance')],
  ['quote a basket', await call(narrow, 'POST', '/api/v1/orders/quote', { items: ITEMS })],
  ['register a webhook', await call(narrow, 'POST', '/api/webhooks', { url: 'https://scoped.example.com/h' })],
]) check(`…and may not ${label}`, res.status === 403 && res.body.code === 'insufficient_scope', `${res.status} ${res.text.slice(0, 90)}`)

check('an unknown key is refused', (await call('egk_live_not_a_real_key', 'GET', '/api/v1/ping')).status === 401)
check('no key at all is refused', (await call(null, 'GET', '/api/v1/ping')).status === 401)
const noMode = await call('egk_live_not_a_real_key', 'GET', '/api/v1/ping')
check('…and the refusal does not guess which world you are in', noMode.body.mode === undefined, noMode.text.slice(0, 120))

const doomed = await mintKey(A, 'seller-a@test.local', 'live')
psql(`update api_keys set revoked_at=now() where last4='${doomed.last4}'`)
check('a revoked key stops working immediately', (await call(doomed.key, 'GET', '/api/v1/ping')).status === 401)

const metered = await call(keyA, 'GET', '/api/v1/ping')
check('every key-authed response is metered', metered.headers.get('x-ratelimit-limit') === '600',
  `X-RateLimit-Limit: ${metered.headers.get('x-ratelimit-limit')}`)
const meteredHook = await call(keyA, 'GET', '/api/webhooks')
check('…the webhook routes included', meteredHook.headers.get('x-ratelimit-limit') === '600',
  `X-RateLimit-Limit: ${meteredHook.headers.get('x-ratelimit-limit')}`)

/* SSRF. A webhook is a request WE make from inside the network. */
console.log('\n   a webhook URL is somewhere we are willing to send a request')
for (const url of [
  'http://example.com/h',                 // plaintext carries order contents
  'https://127.0.0.1/h',
  'https://localhost/h',
  'https://169.254.169.254/latest/meta-data/',   // cloud metadata
  'https://10.0.0.5/h',
  'https://192.168.1.1/h',
  'https://172.16.0.9/h',
  'https://[::1]/h',
  'https://api.internal/h',
]) {
  const r = await call(keyA, 'POST', '/api/webhooks', { url })
  check(`refuses ${url}`, r.status === 400, `answered ${r.status}`)
}
/* The one that mattered and was documented as open: a PUBLIC name that resolves inward.
   localtest.me is a public DNS name answering 127.0.0.1 — no control of a zone needed. */
const rebind = await call(keyA, 'POST', '/api/webhooks', { url: 'https://webhook.localtest.me/h' })
check('refuses a public hostname that RESOLVES to a private address (SSRF)', rebind.status === 400,
  `answered ${rebind.status} ${rebind.text.slice(0, 120)}`)

/* Fan-out has a ceiling: one order event must not become an unbounded pile of outbound
   requests from our egress. */
let accepted = 0
for (let i = 0; i < 14; i++) {
  const r = await call(keyA, 'POST', '/api/webhooks', { url: `https://fanout-${i}.example.com/h` })
  if (r.status === 200) accepted++
}
check('the number of endpoints per seller is capped', accepted <= 10, `${accepted} accepted`)
const dupe = await call(keyA, 'POST', '/api/webhooks', { url: 'https://fanout-0.example.com/h' })
check('…and the same URL is not registered twice', dupe.status === 409, `answered ${dupe.status}`)

/* A 500 must not hand back the driver's own words. */
const boom = await call(keyA, 'GET', '/api/v1/orders/' + 'x'.repeat(300))
check('an internal failure never returns a database message',
  boom.status !== 500 || (boom.body.code === 'internal_error' && !!boom.body.ref), boom.text.slice(0, 140))

console.log(bad === 0
  ? '\nPASS  nothing named a supplier, no key crossed a seller boundary, and the credential held.'
  : `\nFAIL  ${bad} problem${bad === 1 ? '' : 's'} — do not hand out a key until these are zero.`)
process.exit(bad === 0 ? 0 : 1)
