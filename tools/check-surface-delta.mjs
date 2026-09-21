#!/usr/bin/env node
/**
 * THE SURFACE DELTA GATE — a real Postgres and the real Fastify app, on purpose.
 *
 * This is the only path on the platform that moves a seller's money as a side effect of them
 * SAVING ARTWORK. Everything else that bills waits for a press: submit, the Price adjustment
 * card, a design tier. So the standard is the one CLAUDE.md §7 sets — a mock that returns rows
 * regardless of the query is exactly how a SELECT naming a column that does not exist ships —
 * and this boots the actual app, posts the actual JSON the designer emits, and reads the money
 * back out with SQL.
 *
 * WHAT IT IS PROTECTING, one line each:
 *
 *   • A face added after the charge is billed ONCE, at the right figure. Twice is a seller
 *     paying for a placement they already own; never is the factory printing it for free,
 *     which is the bug this was written for (EGF-002155, $3 nothing could collect).
 *   • THE METHOD MOVES THE LINE. The method fee is per line at the DEAREST face, so an
 *     embroidered face added to a DTF line costs its placement AND the method jump, across
 *     every unit. A per-face charge cannot reach that and would under-bill by $8 on the very
 *     order this came from.
 *   • THE STAMP IS A FLOOR. Faces already billed keep the amount they were billed, so a rate
 *     changed in Settings afterwards can never reach backwards into a paid order.
 *   • A METHOD IS STATED, NOT INHERITED. `print_type` is allowed to drift from a line's faces
 *     — on the real order it says DTG while every face is embroidery — so inheriting it bills
 *     a technique the garment does not use.
 *   • REFUSE, DON'T OVERDRAW, AND WRITE NOTHING. A wallet that cannot cover the placement
 *     fails the save; artwork that was not paid for must not be sitting on the garment.
 *   • RE-UPLOADING IS FREE. The placement is charged, not the picture, or fixing a bad file
 *     would cost money every time.
 *
 * Run: node tools/check-surface-delta.mjs
 * Needs a local Postgres (`pg_isready`). SKIPS with a clear message if there isn't one — a
 * gate that fails on a laptop without a database gets ignored, and an ignored gate is worse
 * than none.
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
let jwt, pg
try { jwt = require('jsonwebtoken'); pg = require('pg') } catch {
  console.log('SKIP  server/node_modules is not installed — run `npm i` in server/ first.')
  process.exit(0)
}

const DB = 'egfulfill_surface_gate'
const PORT = 4139
const URL_ = `postgres://localhost:5432/${DB}`
const SECRET = 'surface-gate-secret'
const ORDER = 'FF-gate-surface-1'

try { sh('dropdb', ['--if-exists', DB]) } catch { /* nothing to drop */ }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])
const SELLER = sh('psql', ['-t', '-A', '-d', DB, '-c',
  `insert into users (email, password_hash, role, name) values ('surface-gate@test.local','x','seller','Gate') returning id`])
  .trim().split('\n')[0].trim()

const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DATABASE_URL: URL_, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (process.env.GATE_DEBUG) { api.stdout.on('data', d => process.stderr.write(d)); api.stderr.on('data', d => process.stderr.write(d)) }
const API = `http://127.0.0.1:${PORT}`
const token = jwt.sign({ sub: SELLER, role: 'seller', email: 'surface-gate@test.local' }, SECRET, { expiresIn: '1h' })
const db = new pg.Client({ connectionString: URL_ })

let bad = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}
const postDesign = async (body) => {
  const r = await fetch(`${API}/api/orders/${ORDER}/designs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
const teardown = () => {
  try { api.kill('SIGKILL') } catch { /* already gone */ }
  try { sh('dropdb', ['--if-exists', DB]) } catch { /* the next run drops it */ }
}
process.on('exit', teardown)

for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${API}/health`)).ok) break } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250))
  if (i === 39) { console.error('FAIL  the API never came up — §2.1: that is every route down, not just this one.'); process.exit(1) }
}
await db.connect()

/* THE REAL PRODUCT'S SHAPE, from EG-18000 on production: a true blank price (so faces stack
   on a bare garment rather than on one that already contains a print), a flat placement rate,
   and a per-product embroidery override BELOW the platform figure — which is what catches a
   delta that reads the platform rate instead of the product's. */
await db.query(
  `insert into catalog_products (id, name, sku, type, status, base_price, data)
   values ('p-gate','Gate Crewneck','EG-GATE','Sweatshirt','Active', 0, $1::jsonb)`,
  [JSON.stringify({
    name: 'Gate Crewneck', sku: 'EG-GATE',
    sizePrices: [{ size: 'M', blank: 15, price: 18.5, shipping: 9.95 }],
    sidePrice: 3,
    methodPrices: { EMB: 4 },
  })])
await db.query(`insert into app_settings (key, value) values ('method_emb','5'),('method_dtf','0'),('method_dtg','0'),('method_side','3')
                on conflict (key) do update set value=excluded.value`).catch(() => {})

await db.query(`insert into orders (id, seller_id, status, factory_status, source, paid)
                values ($1,$2,'in_review','in_review','manual',false)`, [ORDER, SELLER])

/* A CHARGED LINE, stamped exactly as freezeQuote leaves one. Seeded rather than driven
   through submit because what is under test is the DELTA, not the submit ladder — the shapes
   below are copied from the real row on EGF-002155. */
const stamp = (sides, method, billed, methods) => JSON.stringify({
  base: 15, method, sides, methods, included: null, billedMethod: billed, includedMethod: null,
})
await db.query(
  `insert into order_items (order_id, line_id, sku, name, qty, size, blank, print_type, unit_cost, ship_fee, cost_parts)
   values ($1,'L-emb','EG-GATE','Gate Crewneck',1,'M','EG-GATE - Gate Crewneck','DTG',28,9.95,$2::jsonb),
          ($1,'L-dtf','EG-GATE','Gate Crewneck',2,'M','EG-GATE - Gate Crewneck','DTG',21,9.95,$3::jsonb)`,
  [ORDER,
   stamp([{ face: 'front', amount: 3, method: 'Embroidery' }, { face: 'back', amount: 3, method: 'Embroidery' }, { face: 'left', amount: 3, method: 'Embroidery' }], 4, 'Embroidery', ['Embroidery']),
   stamp([{ face: 'front', amount: 3, method: 'DTF' }, { face: 'left', amount: 3, method: 'DTG' }], 0, 'DTF', ['DTF', 'DTG'])])

for (const [line, side, m] of [['L-emb', 'front', 'Embroidery'], ['L-emb', 'back', 'Embroidery'], ['L-emb', 'left', 'Embroidery'],
                               ['L-dtf', 'front', 'DTF'], ['L-dtf', 'left', 'DTG']]) {
  await db.query(`insert into order_designs (order_id, sku, line_id, kind, side, data, method)
                  values ($1,'EG-GATE',$2,'raster',$3,'https://x/art.png',$4)`, [ORDER, line, side, m])
}

/* THE LEDGER IS WHAT SAYS SOMEBODY PAID — `chargedAmount` reads it rather than a flag, and
   the route gates on the same thing. Balance funded well above the placements under test. */
await db.query(`insert into wallet_ledger (account, delta, type, ref) values ($1, 500, 'topup-in','gate-topup')`, [SELLER])
await db.query(`insert into wallet_ledger (account, delta, type, ref, order_id) values ($1,-70,'order-charge-out',$2,$2),('factory',70,'order-charge-in',$2,$2)`, [SELLER, ORDER])

const feeRows = () => db.query(
  `select note, delta from wallet_ledger where type='order-fee-out' and ref like $1 order by id`, [`fee-${ORDER}-%`]
).then((r) => r.rows)
const itemOf = (line) => db.query('select unit_cost, cost_parts from order_items where order_id=$1 and line_id=$2', [ORDER, line])
  .then((r) => r.rows[0])
const faceCount = (line) => db.query(
  `select count(*)::int as n from order_designs where order_id=$1 and line_id=$2 and (data is not null or storage_key is not null)`,
  [ORDER, line]).then((r) => r.rows[0].n)

console.log('\nA METHOD IS STATED, NOT INHERITED — the face is about to be billed')
{
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-emb', side: 'right', data: 'https://x/new.png', name: 'new' })
  check('refused with 400', r.status, 400)
  check('and says what is missing', r.body.needsMethod, true)
  check('nothing was written', await faceCount('L-emb'), 3)
  check('no money moved', (await feeRows()).length, 0)
}

console.log('\nA NEW FACE ON AN EMBROIDERED LINE — placement only, the method has not moved')
{
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-emb', side: 'right', data: 'https://x/new.png', name: 'new', method: 'Embroidery' })
  check('saved', r.status, 200)
  check('charged the placement', r.body.surcharge && r.body.surcharge.amount, 3)
  const it = await itemOf('L-emb')
  check('unit_cost restamped 28 -> 31', Number(it.unit_cost), 31)
  check('the stamp grew to four faces', it.cost_parts.sides.length, 4)
  check('and the billed faces keep their amounts', it.cost_parts.sides.map((p) => p.amount), [3, 3, 3, 3])
  check('method unchanged — it was already the dearest', it.cost_parts.method, 4)
  const fees = await feeRows()
  check('one fee row', fees.length, 1)
  check('for the placement', Number(fees[0].delta), -3)
  /* THE POSITION THE SCREEN SHOWS, not the order these were inserted. `order_items.id` is a
     random uuid, so "Item N" is the row's place under the aggregate's own `created_at, id`
     ordering — asserting a hard-coded 1 tested my guess about uuids, not the label. What
     matters is that the note and the summary cannot disagree, so it is computed the same way. */
  const pos = (await db.query(
    `select n from (select line_id as k, row_number() over (order by created_at, id) as n
                      from order_items where order_id=$1) t where k='L-emb'`, [ORDER])).rows[0].n
  check('named for the face and the item', fees[0].note, `Right placement · Item ${pos}`)
}

console.log('\nRE-UPLOADING THE SAME FACE IS FREE — the placement is charged, not the picture')
{
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-emb', side: 'right', data: 'https://x/fixed.png', name: 'fixed', method: 'Embroidery' })
  check('saved', r.status, 200)
  check('no surcharge', r.body.surcharge, undefined)
  check('still one fee row', (await feeRows()).length, 1)
  check('unit_cost unchanged', Number((await itemOf('L-emb')).unit_cost), 31)
}

console.log('\nTHE METHOD MOVES THE LINE — an embroidered face on a DTF line, across both units')
{
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-dtf', side: 'right', data: 'https://x/emb.png', name: 'emb', method: 'Embroidery' })
  check('saved', r.status, 200)
  /* 15 blank + 4 embroidery (the product's own rate, not the platform's 5) + 3 faces x 3 = 28
     against a stamp of 21, x2 units. A per-face charge would have billed 6 and missed 8. */
  check('placement AND the method jump, x2 units', r.body.surcharge && r.body.surcharge.amount, 14)
  const it = await itemOf('L-dtf')
  check('unit_cost restamped 21 -> 28', Number(it.unit_cost), 28)
  check('method rose 0 -> 4', it.cost_parts.method, 4)
  check('billed method follows the dearest face', it.cost_parts.billedMethod, 'Embroidery')
}

console.log('\nAN EMPTY WALLET REFUSES THE PLACEMENT AND WRITES NOTHING')
{
  await db.query(`insert into wallet_ledger (account, delta, type, ref) values ($1, -483, 'adjust-out','gate-drain')`, [SELLER])
  const before = await faceCount('L-emb')
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-emb', side: 'sleeve', data: 'https://x/s.png', name: 's', method: 'Embroidery' })
  check('402 Payment Required', r.status, 402)
  check('and names the shortfall', typeof r.body.shortfall === 'number', true)
  check('the artwork did NOT land', await faceCount('L-emb'), before)
  check('unit_cost untouched', Number((await itemOf('L-emb')).unit_cost), 31)
}

console.log(bad ? `\nFAIL  ${bad} check${bad === 1 ? '' : 's'} failed.` : '\nPASS  the surface delta bills once, at the right figure, and refuses rather than overdraws.')
await db.end()
process.exit(bad ? 1 : 0)
