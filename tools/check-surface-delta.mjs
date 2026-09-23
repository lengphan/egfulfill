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

/**
 * WAIT FOR THE APP'S OWN MIGRATIONS, don't race them.
 *
 * /health answers as soon as Fastify listens, but several tables this gate seeds are created
 * at ROUTE LOAD rather than in schema.sql (§6: "grep the route, not just schema.sql") —
 * wallet_ledger among them. Seeding the instant the server binds therefore passed or failed
 * on boot timing, which reads as a broken gate rather than a fast one.
 */
for (let i = 0; i < 60; i++) {
  const ok = await db.query(
    `select to_regclass('wallet_ledger') is not null as a, to_regclass('order_designs') is not null as b`)
    .then((r) => r.rows[0].a && r.rows[0].b).catch(() => false)
  if (ok) break
  await new Promise((r) => setTimeout(r, 250))
  if (i === 59) { console.error('FAIL  the app never created its own tables — nothing below could be trusted.'); process.exit(1) }
}

/* THE REAL PRODUCT'S SHAPE, from EG-18000 on production: a true blank price (so faces stack
   on a bare garment rather than on one that already contains a print), a flat placement rate,
   and a per-product embroidery override BELOW the platform figure — which is what catches a
   delta that reads the platform rate instead of the product's. */
/* MANY COLUMNS THIS GATE SEEDS ARE CREATED AT ROUTE LOAD, NOT BY schema.sql (§6: "grep the
   route, not just schema.sql"). Seeding them therefore races the app's own startup, and which
   side wins changes with boot timing — a flake that reads as a broken gate. Declared here so
   the harness depends on nothing but itself. */
for (const ddl of [
  `alter table catalog_products add column if not exists data jsonb default '{}'::jsonb`,
  `alter table orders add column if not exists paid boolean not null default false`,
  `alter table order_items add column if not exists line_id text`,
  `alter table order_items add column if not exists unit_cost numeric`,
  `alter table order_items add column if not exists ship_fee numeric`,
  `alter table order_items add column if not exists cost_parts jsonb`,
  /* schema.sql still declares the ORIGINAL primary key (order_id, sku), which predates
     per-line and per-side artwork; the app replaces it at route load with the line+side
     unique index. Seeding four faces of two lines under one sku collides with the old one,
     so the gate drops it exactly as the running database has. */
  `alter table order_designs drop constraint if exists order_designs_pkey`,
  `alter table order_designs add column if not exists line_id text`,
  `alter table order_designs add column if not exists side text`,
  `alter table order_designs add column if not exists method text`,
  `alter table order_designs add column if not exists storage_key text`,
  `alter table order_designs add column if not exists art_hash text`,
]) await db.query(ddl).catch(() => {})
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
          ($1,'L-dtf','EG-GATE','Gate Crewneck',2,'M','EG-GATE - Gate Crewneck','Embroidery',21,9.95,$3::jsonb)`,
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
/* MATCHED ON `ref`, which is how order_refunds' CHARGE_KINDS finds a production charge —
   `order_id` is a later convenience column created at route load, and depending on it here
   made the seed race the app's own startup. */
await db.query(`insert into wallet_ledger (account, delta, type, ref) values ($1,-70,'order-charge-out',$2),('factory',70,'order-charge-in',$2)`, [SELLER, ORDER])

const feeRows = () => db.query(
  `select note, delta from wallet_ledger where type='order-fee-out' and ref like $1 order by id`, [`fee-${ORDER}-%`]
).then((r) => r.rows)
const itemOf = (line) => db.query('select unit_cost, cost_parts from order_items where order_id=$1 and line_id=$2', [ORDER, line])
  .then((r) => r.rows[0])
const faceCount = (line) => db.query(
  `select count(*)::int as n from order_designs where order_id=$1 and line_id=$2 and (data is not null or storage_key is not null)`,
  [ORDER, line]).then((r) => r.rows[0].n)

console.log('\nA FREE FACE WITH NO METHOD JUST SAVES — nothing to ask about')
{
  /* The refusal used to fire on EVERY method-less face. Right when a placement was charged
     per face; a placement is one per LINE now, so the common case costs nothing and stopping
     to settle a question with no money behind it is friction (owner, 2026-09-22). */
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-emb', side: 'right', data: 'https://x/new.png', name: 'new' })
  check('saved', r.status, 200)
  check('no surcharge', r.body.surcharge, undefined)
  check('the artwork landed', await faceCount('L-emb'), 4)
  check('no money moved', (await feeRows()).length, 0)
}

console.log('\nBUT A FACE THAT WILL BILL STOPS TO ASK')
{
  /* L-dtf's print_type says Embroidery while its stamp was billed at DTF, method 0 — the
     drift EGF-002155 showed. A face with no method INHERITS that, which moves the line's
     dearest technique. There the technique IS what is being charged for, so a guess would be
     a wrong charge rather than a wrong label.

     THE QUOTED FIGURE IS THE WHOLE JUMP, NOT THE METHOD HALF (triaged 2026-09-23). It read
     8 — the $4/unit method move across two units — which was the entire delta under the
     21 Sep rule. The amendment gives the new face its own run as well, so the refusal now
     quotes $8/unit: the method jump plus the run. It must match what accepting would
     actually cost, and the assertion further down pins that same 16. */
  const before = await faceCount('L-dtf')
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-dtf', side: 'right', data: 'https://x/emb.png', name: 'emb' })
  check('refused with 400', r.status, 400)
  check('and says what is missing', r.body.needsMethod, true)
  check('and names the figure it would charge', r.body.amount, 16)
  check('nothing was written', await faceCount('L-dtf'), before)
  check('no money moved', (await feeRows()).length, 0)
}

console.log('\nSTATING THE METHOD ON A FREE FACE CHANGES NOTHING')
{
  /* One placement per LINE now, not one per face. This line's front already carries it, so a
     fourth surface adds no money — what a second picture costs is a design fee, billed per
     picture elsewhere. The artwork must still LAND: free is not a refusal. */
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-emb', side: 'right', data: 'https://x/new.png', name: 'new', method: 'Embroidery' })
  check('saved', r.status, 200)
  check('no surcharge', r.body.surcharge, undefined)
  check('still four faces', await faceCount('L-emb'), 4)
  const it = await itemOf('L-emb')
  check('unit_cost untouched', Number(it.unit_cost), 28)
  check('the stamp is unchanged', it.cost_parts.sides.length, 3)
  check('no fee row', (await feeRows()).length, 0)
}

console.log('\nRE-UPLOADING THE SAME FACE IS FREE TOO')
{
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-emb', side: 'right', data: 'https://x/fixed.png', name: 'fixed', method: 'Embroidery' })
  check('saved', r.status, 200)
  check('no surcharge', r.body.surcharge, undefined)
  check('still no fee row', (await feeRows()).length, 0)
}

console.log('\nAN EMPTY WALLET REFUSES A CHARGEABLE FACE AND WRITES NOTHING')
{
  /* The method jump below IS chargeable, so it is the honest thing to refuse. Drained first,
     then restored — which also proves the retry bills once rather than twice. */
  await db.query(`insert into wallet_ledger (account, delta, type, ref) values ($1, -498, 'adjust-out','gate-drain')`, [SELLER])
  const before = await faceCount('L-dtf')
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-dtf', side: 'right', data: 'https://x/emb.png', name: 'emb', method: 'Embroidery' })
  check('402 Payment Required', r.status, 402)
  check('and names the shortfall', typeof r.body.shortfall === 'number', true)
  check('the artwork did NOT land', await faceCount('L-dtf'), before)
  check('unit_cost untouched', Number((await itemOf('L-dtf')).unit_cost), 21)
}

console.log('\nTHE METHOD STILL MOVES THE LINE, ACROSS BOTH UNITS')
{
  await db.query(`insert into wallet_ledger (account, delta, type, ref) values ($1, 200, 'topup-in','gate-refill')`, [SELLER])
  const r = await postDesign({ sku: 'EG-GATE', line_id: 'L-dtf', side: 'right', data: 'https://x/emb.png', name: 'emb', method: 'Embroidery' })
  check('saved', r.status, 200)
  /* A NEW FACE CARRIES ITS OWN RUN (amended after 2026-09-21; triaged 2026-09-23).
     This block wanted the new face stamped at ZERO — right under the 21 Sep rule, where a
     face after the first paid only its design fee. sideDetail was then amended: the PLACEMENT
     is still paid once, but every face after the first buys its technique's run, because a
     second embroidered face is a second pass through the machine.
     So:  15 blank + 4 embroidery (the product's own rate, not the platform's 5)
          + front 3 (the one placement) + the DTF face's own run 3 + the new EMB run 4  = 29,
     against a stamp of 21 — a jump of 8 per unit, x2 units. */
  check('the method jump alone, x2 units', r.body.surcharge && r.body.surcharge.amount, 16)
  const it = await itemOf('L-dtf')
  check('unit_cost restamped 21 -> 29', Number(it.unit_cost), 29)
  check('method rose 0 -> 4', it.cost_parts.method, 4)
  check('billed method follows the dearest face', it.cost_parts.billedMethod, 'Embroidery')
  check('the new face is stamped at its own run', it.cost_parts.sides.map((p) => p.amount), [3, 3, 4])
  check('exactly one fee row', (await feeRows()).length, 1)
}

console.log(bad ? `\nFAIL  ${bad} check${bad === 1 ? '' : 's'} failed.` : '\nPASS  a face adds no placement, the technique still bills, and an empty wallet refuses.')
await db.end()
process.exit(bad ? 1 : 0)
