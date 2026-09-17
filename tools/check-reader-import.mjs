#!/usr/bin/env node
/**
 * THE READER IMPORT GATE — run against a REAL Postgres, on purpose.
 *
 * `server/src/routes/reader.js` CREATES orders. Everything else the extension has ever done
 * patched one field on a row somebody else made; this writes jobs the factory will make. So
 * the standard is the one CLAUDE.md §7 sets and not a lower one: a mock that returned rows
 * regardless of the query is exactly how a SELECT naming a column that does not exist ships.
 * This boots the actual Fastify app against a throwaway database, sends the actual JSON the
 * extension emits, and reads the rows back out with SQL.
 *
 * WHAT IT IS REALLY PROTECTING, in one line each:
 *
 *   • Pressing Sync twice must not duplicate an order or a line. The whole design rests on
 *     deterministic line ids plus a partial unique index; if either drifts, a seller doubles
 *     their own queue and pays twice for it.
 *   • It fills gaps and never overwrites (§2.6). A seller re-reads pages holding orders they
 *     have already worked on — a route that re-asserted the page's version would walk back a
 *     corrected address and a stage the floor had advanced.
 *   • A crafted receipt id must not write lines onto another seller's parcel.
 *   • An order with no readable items is refused, not created empty. An empty order shows up
 *     in every queue forever and can never be made.
 *
 * Run: node tools/check-reader-import.mjs
 * Needs a local Postgres (`pg_isready`). SKIPS with a clear message if there isn't one —
 * a gate that fails on a laptop without a database gets ignored, and an ignored gate is
 * worse than none.
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

const DB = 'egfulfill_reader_gate'
const PORT = 4137
const URL_ = `postgres://localhost:5432/${DB}`
const SECRET = 'reader-gate-secret'

let jwt, pg
try { jwt = require('jsonwebtoken'); pg = require('pg') } catch {
  console.log('SKIP  server/node_modules is not installed — run `npm i` in server/ first.')
  process.exit(0)
}

/* A FRESH DATABASE EVERY RUN. A gate that inherits the last run's rows passes on state it
   did not create, which is the same failure mode as a stale process making a broken build
   look healthy (§2.1). */
try { sh('dropdb', ['--if-exists', DB]) } catch { /* nothing to drop */ }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])
/* FIRST LINE ONLY. `psql -c "insert … returning id"` prints the id AND the command tag
   ("INSERT 0 1") on the next line, so `.trim()` alone hands the route a uuid with a newline
   glued to it — which Postgres rejects as invalid uuid syntax and Fastify reports as a 500
   from the route rather than from this file. Caught by this gate on its first run. */
const SELLER = sh('psql', ['-t', '-A', '-d', DB, '-c',
  `insert into users (email, password_hash, role, name) values ('gate-seller@test.local','x','seller','Gate Seller') returning id`])
  .trim().split('\n')[0].trim()

const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DATABASE_URL: URL_, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (process.env.GATE_DEBUG) { api.stdout.on('data', d => process.stderr.write(d)); api.stderr.on('data', d => process.stderr.write(d)) }
const API = `http://127.0.0.1:${PORT}`
const token = jwt.sign({ sub: SELLER, role: 'seller', email: 'gate-seller@test.local' }, SECRET, { expiresIn: '1h' })
const db = new pg.Client({ connectionString: URL_ })

let bad = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}
const post = async (path, body) => {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json() }
}

async function waitForApi() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${API}/health`)).ok) return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

function teardown() {
  try { api.kill('SIGKILL') } catch { /* already gone */ }
  try { sh('dropdb', ['--if-exists', DB]) } catch { /* leave it; the next run drops it */ }
}
process.on('exit', teardown)

if (!(await waitForApi())) {
  console.error('FAIL  the API never came up — that is §2.1, and it means every route is down, not just this one.')
  process.exit(1)
}
await db.connect()

/**
 * EXACTLY WHAT extension/src/parse.js EMITS from an Etsy page carrying its own JSON.
 * If the parser's shape drifts from this, the two halves stop fitting and the failure shows
 * up here rather than as orders that silently arrive empty.
 */
const RECEIPT = {
  order_id: '4172259915',
  buyer: 'Nicole Barry',
  buyer_email: null,
  total: 42.5,
  ship_by: '2026-09-25T00:00:00.000Z',
  created_at: '2026-09-15T00:00:00.000Z',
  address: { name: 'Nicole Barry', street: '11522 Discovery Heights Cir', street2: '', city: 'Anchorage', state: 'AK', zip: '99515-2719', country: 'US' },
  items: [
    { line_id: 'et-3910022114', listing_id: '1699', sku: 'HOOD-BLK', name: 'Custom Embroidered Hoodie', qty: 2, variant: 'L', personalization: 'Dana', unit_price: 21.25, img: null, design_src: 'https://i.etsystatic.com/x/art.png' },
    { line_id: 'rd-4172259915-902-1', listing_id: '902', sku: null, name: 'Cap', qty: 1, variant: null, personalization: null, unit_price: 10, img: null, design_src: null },
  ],
}

console.log('\nWHICH RECEIPTS DO WE KNOW — before anything is imported')
{
  const r = await post('/api/reader/etsy/known', { receipts: ['4172259915'] })
  check('200', r.status, 200)
  check('we know none of them yet', r.body.known, [])
}

console.log('\nIMPORT — the order is created with its items')
{
  const r = await post('/api/reader/etsy/import', { rows: [RECEIPT], store: 'TestShop' })
  check('200', r.status, 200)
  check('one order created', r.body.created, 1)
  check('two lines added', r.body.itemsAdded, 2)
  check('address counted as filled', r.body.addressFilled, 1)

  const o = (await db.query('select * from orders where id=$1', ['etsy-4172259915'])).rows[0]
  check('order exists', !!o, true)
  check('owned by the seller', o.seller_id, SELLER)
  check('source is the platform', o.source, 'etsy')
  check('NOT a factory order', o.factory_order, false)
  check('store carried', o.store, 'TestShop')
  check('total carried', Number(o.total), 42.5)
  check('buyer name carried', o.customer.name, 'Nicole Barry')
  check('street carried', o.address.street, '11522 Discovery Heights Cir')
  check('address is stamped as extension-sourced', o.address.source, 'extension')
  check('ship_by carried', o.ship_by && o.ship_by.toISOString(), '2026-09-25T00:00:00.000Z')
  /* THE STAMP. Tracking cannot go back to Etsy for this order; every surface needs to be
     able to find that out from the row rather than from tribal knowledge. */
  check('meta says it came from the reader', o.meta.reader, 'extension')
  check('meta names the platform', o.meta.reader_platform, 'etsy')

  const items = (await db.query('select * from order_items where order_id=$1 order by line_id', ['etsy-4172259915'])).rows
  check('two lines', items.length, 2)
  check('PRODUCT NAME is filled in', items[0].name, 'Custom Embroidered Hoodie')
  check('quantity', items[0].qty, 2)
  check('variant', items[0].variant, 'L')
  check('personalization', items[0].personalization, 'Dana')
  check('artwork URL', items[0].design_src, 'https://i.etsystatic.com/x/art.png')
  check('unit price', Number(items[0].unit_price), 21.25)
  /* Embroidery detection must match the API sync, or a reader-made order reaches the boards
     defaulting to DTG and the thread matcher never runs. */
  check('embroidery detected from the title', items[0].print_type, 'EMB')
  check('the plain line stays method-less', items[1].print_type, null)
}

console.log('\nPRESSING SYNC TWICE — the claim that nothing duplicates')
{
  const r = await post('/api/reader/etsy/import', { rows: [RECEIPT], store: 'TestShop' })
  check('nothing created the second time', r.body.created, 0)
  check('recognised as already there', r.body.existed, 1)
  check('NO extra lines written', r.body.itemsAdded, 0)
  const n = (await db.query('select count(*)::int c from order_items where order_id=$1', ['etsy-4172259915'])).rows[0].c
  check('still exactly two lines in the database', n, 2)
}

console.log('\nIT FILLS GAPS, IT NEVER OVERWRITES (CLAUDE.md §2.6)')
{
  /* Someone corrected the address and the floor advanced the order. A re-read of the page
     must not walk either of those back. */
  await db.query(`update orders set address=$1, status='in_production', factory_status='printing', total=99 where id=$2`,
    [JSON.stringify({ name: 'Nicole Barry', street: 'CORRECTED BY A HUMAN', city: 'Anchorage', state: 'AK', zip: '99515' }), 'etsy-4172259915'])
  await db.query(`update order_items set qty=7 where order_id=$1 and line_id='et-3910022114'`, ['etsy-4172259915'])

  await post('/api/reader/etsy/import', { rows: [RECEIPT], store: 'TestShop' })
  const o = (await db.query('select * from orders where id=$1', ['etsy-4172259915'])).rows[0]
  check('hand-typed address survives', o.address.street, 'CORRECTED BY A HUMAN')
  check('order status untouched', o.status, 'in_production')
  check('factory stage untouched', o.factory_status, 'printing')
  check('an existing total is not re-asserted', Number(o.total), 99)
  const it = (await db.query(`select qty from order_items where order_id=$1 and line_id='et-3910022114'`, ['etsy-4172259915'])).rows[0]
  check('a corrected quantity survives', it.qty, 7)
}

console.log('\nREFUSALS')
{
  const r = await post('/api/reader/etsy/import', { rows: [{ order_id: '999888777', items: [] }] })
  check('an order with no readable items is refused', r.body.created, 0)
  check('and says why', r.body.rejected[0] && r.body.rejected[0].why, 'no readable items')
  const n = (await db.query(`select count(*)::int c from orders where id='etsy-999888777'`)).rows[0].c
  check('nothing was written', n, 0)

  const u = await post('/api/reader/walmart/import', { rows: [RECEIPT] })
  check('an unknown marketplace is a 400, never a default', u.status, 400)

  /* A line id that claims no provenance at all is refused — that is the field the unique
     index keys on, so an unprefixed one would sit outside every duplicate protection. */
  const p = await post('/api/reader/etsy/import', {
    rows: [{ order_id: '555444333', items: [{ line_id: 'whatever', name: 'Mug', qty: 1 }] }],
  })
  check('an unprefixed line id is refused', p.body.created, 0)
}

console.log('\nCROSS-SELLER — a crafted receipt id must not reach another shop')
{
  const other = (await db.query(`insert into users (email,password_hash,role,name) values ('other@test.local','x','seller','Other') returning id`)).rows[0].id
  await db.query(`insert into orders (id, seller_id, source, status, factory_status) values ('etsy-1111222233',$1,'etsy','new','new')`, [other])
  const r = await post('/api/reader/etsy/import', {
    rows: [{ ...RECEIPT, order_id: '1111222233' }],
  })
  check('refused as not yours', r.body.notYours, 1)
  const n = (await db.query(`select count(*)::int c from order_items where order_id='etsy-1111222233'`)).rows[0].c
  check('no lines written onto the other seller’s order', n, 0)
}

console.log('\nKNOWN — now reports what we hold')
{
  const r = await post('/api/reader/etsy/known', { receipts: ['4172259915', '1111222233', '4444444444'] })
  check('our own order is known', r.body.known.includes('4172259915'), true)
  check('the other seller’s is NOT disclosed', r.body.known.includes('1111222233'), false)
  check('one we have never seen is not known', r.body.known.includes('4444444444'), false)
}


await db.end()
console.log(bad ? `\n${bad} failure(s).` : '\nReader import holds against a real Postgres.')
process.exit(bad ? 1 : 0)
