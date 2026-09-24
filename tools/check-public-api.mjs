#!/usr/bin/env node
/**
 * THE PUBLIC API GATE — the documented surface, exercised with a real key on a real boot.
 *
 * This exists because of what was found on 2026-09-23: the public docs still described
 * `GET /api/v1/statement`, deleted two weeks earlier, and the playground still told sellers
 * their test key hit `/api/test/*`, which it had stopped doing. Both were prose describing
 * an API that no longer existed, and prose cannot fail a build. So the list the docs render
 * from is now EXECUTED: every path in web/lib/api-endpoints.ts is called with a real test
 * key, and an entry the server answers 404 or 501 fails this file.
 *
 * It also holds the line the /api/test/* removal rests on: A TEST KEY STILL SIMULATES
 * EVERYTHING. The twins are gone, so if `/api/v1/*` on a test key ever starts refusing,
 * demanding a live key, or writing real rows, a seller has no sandbox at all — which is a
 * far worse regression than the one that prompted the deletion.
 *
 * Real Postgres, real Fastify, real key minted through the real route: a mock that answers
 * regardless of the query is how a SELECT naming a missing column ships (§7).
 *
 * Run: node tools/check-public-api.mjs
 * SKIPS cleanly with no local Postgres — a gate that fails on a laptop gets ignored.
 */
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'server/package.json'))
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts })

try { sh('pg_isready', []) } catch {
  console.log('SKIP  no local Postgres accepting connections — start one to run this gate.')
  process.exit(0)
}

const DB = 'egfulfill_public_api_gate'
const PORT = 4146   // unique across tools/check-*.mjs — run-gates.sh refuses a duplicate
const URL_ = `postgres://localhost:5432/${DB}`
const SECRET = 'public-api-gate-secret'

let jwt
try { jwt = require('jsonwebtoken') } catch {
  console.log('SKIP  server/node_modules is not installed — run `npm i` in server/ first.')
  process.exit(0)
}

/* --force, because the previous gate's server may still hold a connection when these run
   back to back: plain dropdb then fails with "database is being accessed by other users",
   createdb fails after it, and the gate dies for a reason that has nothing to do with what
   it tests. A flaky gate is one people learn to ignore. Fallback for a Postgres older than
   13, where --force does not exist. */
try { sh('dropdb', ['--if-exists', '--force', DB]) }
catch { try { sh('dropdb', ['--if-exists', DB]) } catch { /* nothing to drop */ } }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])
const SELLER = sh('psql', ['-t', '-A', '-d', DB, '-c',
  `insert into users (email, password_hash, role, name) values ('api-gate@test.local','x','seller','API Gate') returning id`])
  .trim().split('\n')[0].trim()
/* One priceable blank, so Create order and Quote exercise the REAL pricer rather than the
   unpriceable-lines branch. base_price must be > 0 or pricing.js refuses it. */
sh('psql', ['-q', '-d', DB, '-c',
  `insert into catalog_products (id, name, sku, type, method, base_price, price)
   values ('SS-GATE','Gate Tee','GATETEE','Apparel','DTG',8.50,14.50)`])

const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DATABASE_URL: URL_, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (process.env.GATE_DEBUG) { api.stdout.on('data', d => process.stderr.write(d)); api.stderr.on('data', d => process.stderr.write(d)) }
const API = `http://127.0.0.1:${PORT}`
const token = jwt.sign({ sub: SELLER, role: 'seller', email: 'api-gate@test.local' }, SECRET, { expiresIn: '1h' })

let bad = 0
const check = (label, ok, detail = '') => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `  — ${detail}`}`)
}

function teardown() {
  try { api.kill('SIGKILL') } catch { /* already gone */ }
  try { sh('dropdb', ['--if-exists', '--force', DB]) } catch { /* the next run drops it */ }
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
  console.error('FAIL  the API never came up — that is §2.1, and it means every route is down, not just these.')
  process.exit(1)
}

/* The key is minted through POST /api/keys, not inserted: the hash, the prefix and the
   scope default are the route's business, and a hand-written row would test a key format
   nothing issues. */
const minted = await (await fetch(`${API}/api/keys`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ mode: 'test', label: 'gate' }),
})).json()
const KEY = minted.key || ''
check('a seller can mint a test key', KEY.startsWith('egk_test_'), JSON.stringify(minted).slice(0, 120))
if (!KEY) process.exit(1)

const call = async (method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'X-API-Key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let json = null
  try { json = await r.json() } catch { /* not json */ }
  return { status: r.status, body: json || {} }
}

const ORDER_ITEMS = [{ product_id: 'GATETEE', quantity: 2, color: 'Black', method: 'DTG' }]

console.log('\nA TEST KEY STILL SIMULATES EVERYTHING (this is what /api/test/* used to be for)')
const ping = await call('GET', '/api/v1/ping')
check('ping answers, and says which world you are in', ping.status === 200 && ping.body.mode === 'test' && ping.body.live === false, JSON.stringify(ping.body).slice(0, 120))

const products = await call('GET', '/api/v1/products')
check('products is the REAL catalogue, not a demo list',
  products.status === 200 && Array.isArray(products.body.data) && products.body.data.some((p) => p.sku === 'GATETEE'),
  JSON.stringify(products.body).slice(0, 160))
/* §2.9 — the import prefix on catalog_products.id names our supplier. It must not travel. */
check('no catalogue field carries the supplier prefix (§2.9)',
  !JSON.stringify(products.body).includes('SS-GATE'), 'the row id reached a partner')

const order = await call('POST', '/api/v1/orders', { items: ORDER_ITEMS, shipping_address: { name: 'A', street1: '1 St', city: 'X', state: 'MA', zip: '02719', country: 'US' } })
check('create order is accepted and priced from the catalogue',
  order.status === 200 && order.body.mode === 'test' && order.body.totals && order.body.totals.items > 0,
  JSON.stringify(order.body).slice(0, 200))
/* THE WHOLE POINT OF A SANDBOX: the same verdict live reaches, and nothing written. */
const rows = sh('psql', ['-t', '-A', '-d', DB, '-c', 'select count(*) from orders']).trim().split('\n')[0]
check('…and wrote NO order — a test key never reaches the factory queue', rows === '0', `orders table holds ${rows}`)

const unknown = await call('POST', '/api/v1/orders', { items: [{ product_id: 'NOT-A-SKU', quantity: 1 }], shipping_address: { name: 'A', street1: '1 St', city: 'X', state: 'MA', zip: '02719', country: 'US' } })
check('an unknown sku is refused in test exactly as in live',
  unknown.status === 400 && unknown.body.code === 'unpriceable_lines',
  `${unknown.status} ${JSON.stringify(unknown.body).slice(0, 120)}`)

const quote = await call('POST', '/api/v1/orders/quote', { items: ORDER_ITEMS })
check('quote prices a basket', quote.status === 200 && quote.body.totals && quote.body.totals.total > 0, JSON.stringify(quote.body).slice(0, 160))

const got = await call('GET', '/api/v1/orders/ord_test123')
check('retrieve resolves a simulated id, and admits total is null',
  got.status === 200 && got.body.mode === 'test' && got.body.total === null, JSON.stringify(got.body).slice(0, 140))

const cancelled = await call('POST', '/api/v1/orders/ord_test123/cancel')
check('cancel answers in the shape live returns', cancelled.status === 200 && cancelled.body.status === 'cancelled', JSON.stringify(cancelled.body).slice(0, 140))

const stock = await call('GET', '/api/v1/stock')
check('stock answers', stock.status === 200 && Array.isArray(stock.body.data), JSON.stringify(stock.body).slice(0, 140))

const balance = await call('GET', '/api/v1/balance')
check('balance answers a number, not a string', balance.status === 200 && typeof balance.body.balance === 'number', JSON.stringify(balance.body).slice(0, 140))

const hooks = await call('POST', '/api/webhooks', { url: 'https://example.com/hooks/eg', events: ['order.shipped'] })
check('a webhook can be registered with an API key, and the secret is returned once',
  hooks.status === 200 && typeof hooks.body.secret === 'string', JSON.stringify(hooks.body).slice(0, 140))
const listed = await call('GET', '/api/webhooks')
check('listing them never returns the secret',
  listed.status === 200 && Array.isArray(listed.body) && !JSON.stringify(listed.body).includes('secret'),
  JSON.stringify(listed.body).slice(0, 140))
const deliveries = await call('GET', `/api/webhooks/${hooks.body.id}/deliveries`)
check('delivery history answers', deliveries.status === 200 && Array.isArray(deliveries.body), JSON.stringify(deliveries.body).slice(0, 140))

console.log('\nTHE DOCS DESCRIBE ROUTES THAT ANSWER (web/lib/api-endpoints.ts drives the public page)')
const catalogSrc = readFileSync(join(ROOT, 'web/lib/api-endpoints.ts'), 'utf8')
/* Method and path are read as a PAIR, in source order. Keying by path alone silently
   collapsed the two /api/webhooks entries onto the first one, so the POST was never sent
   and the gate reported a GET twice — a gate that quietly tests less than it prints. */
const documented = [...catalogSrc.matchAll(/method:\s*"(GET|POST)",\s*\n\s*path:\s*"([^"]+)"/g)]
  .map((m) => ({ method: m[1], path: m[2] }))
check('the docs list is not empty', documented.length > 0)
for (const { method, path } of documented) {
  const concrete = path.replace('/:id', '/1')
  const r = await call(method, concrete, method === 'POST' ? { items: ORDER_ITEMS, url: 'https://example.com/h', shipping_address: { name: 'A', street1: '1 St', city: 'X', state: 'MA', zip: '02719', country: 'US' } } : null)
  /* A documented route may legitimately 400 (a sample body this gate does not tailor) or
     404 a made-up id. It may never be MISSING or unimplemented — that is the failure the
     statement endpoint shipped as. */
  const missing = r.status === 501 || (r.status === 404 && (r.body.message || '').includes('not found'))
  check(`${method} ${path}`, !missing, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`)
}

console.log('\nTHE RETIRED SURFACES STAY RETIRED')
for (const gone of ['/api/test/ping', '/api/test/products', '/api/test/orders/1', '/api/v1/statement']) {
  const r = await call('GET', gone)
  check(`${gone} is gone`, r.status === 404, `answered ${r.status}`)
}
for (const stub of ['/api/v1/shipping-rates', '/api/v1/shipping-labels/domestics', '/api/v1/shipping-labels/internationals']) {
  const r = await call('POST', stub, {})
  /* 501 with a reason, not a 200 with an invented tracking code. */
  check(`${stub} refuses rather than inventing`, r.status === 501 && r.body.code === 'not_implemented', `answered ${r.status}`)
}
const anyFake = JSON.stringify(await Promise.all(
  ['/api/v1/shipping-rates', '/api/v1/shipping-labels/domestics'].map((p) => call('POST', p, {}).then((r) => r.body))))
check('no route hands back a fabricated tracking code or sandbox label url',
  !/EGTEST|sandbox\.egfulfill\.com/.test(anyFake))

/**
 * A SCOPED KEY IS REFUSED THE SCOPE IT LACKS — and an unscoped one is not.
 *
 * The server has gated every /api/v1/* route on scopes since they were added, and nothing
 * exercised it, because `createApiKey` in web/lib/api.ts never sent a `scopes` array: every
 * key the product could mint landed with an empty one, which `keyAllows` reads as FULL
 * ACCESS. So the enforcement was live, dead and unmeasured at the same time — and the
 * marketing page said keys carry only the scopes you grant.
 *
 * Both halves are asserted here, because they pull against each other. Scopes must bite, and
 * an EMPTY array must keep meaning everything: that rule exists so adding the column did not
 * revoke every integration already in the field, and quietly "fixing" it to mean nothing
 * would break live partners on deploy.
 */
console.log('\nSCOPES BITE, AND A PRE-SCOPES KEY STILL WORKS')

const mintKey = async (body) => (await (await fetch(`${API}/api/keys`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ mode: 'test', ...body }),
})).json())

const keyList = await (await fetch(`${API}/api/keys`, { headers: { Authorization: 'Bearer ' + token } })).json()
const ALL = keyList.all_scopes || []
check('GET /api/keys publishes all_scopes, which is what the picker reads',
  ALL.length > 0 && ALL.includes('orders.write'), JSON.stringify(keyList.all_scopes))

/* The picker derives Read only as the `.read`-suffixed half of that list rather than naming
   scopes itself, so a scope added upstream joins the right preset with no second list to
   forget. Derive it the same way here — if the suffix convention ever breaks, this fails
   rather than the seller discovering it. */
const READ = ALL.filter((s) => s.endsWith('.read'))
check('the .read half is a real preset, not an empty set', READ.length >= 3, READ.join(','))

const ro = await mintKey({ label: 'gate read-only', scopes: READ })
const roCall = async (method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'X-API-Key': ro.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
check('a read-only key stores exactly what was asked for',
  JSON.stringify((ro.scopes || []).slice().sort()) === JSON.stringify(READ.slice().sort()),
  JSON.stringify(ro.scopes))

const roProducts = await roCall('GET', '/api/v1/products')
check('read-only CAN list products', roProducts.status === 200, String(roProducts.status))

/* billing.read ends in .read, so Read only includes it — reading your own balance is a read.
   Asserted because it is the one preset member somebody would be tempted to drop. */
const roBalance = await roCall('GET', '/api/v1/balance')
check('read-only CAN read the balance', roBalance.status === 200, String(roBalance.status))

const ORDER = { items: [{ product_id: 'GATETEE', quantity: 1, size: 'M', method: 'DTG' }],
  shipping_address: { name: 'A', street1: '1 St', city: 'X', state: 'MA', zip: '02719', country: 'US' } }
const roCreate = await roCall('POST', '/api/v1/orders', ORDER)
check('read-only CANNOT create an order', roCreate.status === 403, String(roCreate.status))
check('...and the refusal names the scope required, so it is actionable',
  roCreate.body.code === 'insufficient_scope' && roCreate.body.required === 'orders.write',
  JSON.stringify(roCreate.body).slice(0, 140))

/* THE LEGACY RULE. A key minted with no scopes is a key from before the column existed, and
   it must keep full access — see keyAllows. This is the assertion that stops a later tidy-up
   from revoking every integration in the field. */
const open = await mintKey({ label: 'gate unscoped' })
const openCreate = await (await fetch(`${API}/api/v1/orders`, {
  method: 'POST',
  headers: { 'X-API-Key': open.key, 'Content-Type': 'application/json' },
  body: JSON.stringify(ORDER),
})).json().catch(() => ({}))
check('a key with NO scopes still has full access (pre-scopes keys must not be revoked)',
  openCreate.object === 'order', JSON.stringify(openCreate).slice(0, 140))

console.log(bad === 0 ? '\nPASS  the documented API answers, and a test key still simulates all of it.'
  : `\nFAIL  ${bad} problem${bad === 1 ? '' : 's'}.`)
process.exit(bad === 0 ? 0 : 1)
