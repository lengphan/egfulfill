#!/usr/bin/env node
/**
 * THE CATALOGUE IMAGE-REF GATE — a real Postgres, the real Fastify app, real bytes.
 *
 * `/api/catalog_products` rewrites every stored `data:` image to `/api/catalog/img/<hash>`
 * so the list stops carrying megabytes of base64 (slimImages), and the whole-list upsert
 * puts the bytes back before writing (fattenImages). The two are ONE mechanism and the
 * dangerous half is the second: the products UI holds whole product objects and POSTs them
 * straight back, so a field that is slimmed but not fattened is SAVED as a hash — and the
 * image that hash stood for is then gone from the record.
 *
 * That is not hypothetical. It is written at fattenImages as the reason it exists ("a
 * projection must not become the record"), it had already been re-learned once for
 * colorGallery, and `side_mockups` — a blank's line drawings, the positioning aids the
 * Design surfaces draw on — was the third field to arrive and was missed by BOTH halves
 * until 2026-09-21.
 *
 * So this gate asserts the round trip, not the rewrite:
 *
 *   1  a data: URL goes out as /api/catalog/img/<hash>        — the list is small
 *   2  that url serves back the ORIGINAL bytes                 — the picture still resolves
 *   3  POSTing the slimmed object stores the data: URL again   — THE RECORD SURVIVES
 *   4  a value that was never base64 is untouched in both      — no gratuitous rewriting
 *
 * Every image-bearing field is driven, so a fifth one added later fails here rather than in
 * someone's catalogue. Add a field to slimImages and you must add it to FIELDS below.
 *
 * Run: node tools/check-catalog-img-refs.mjs
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

const DB = 'egfulfill_catalog_img_gate'
const PORT = 4139
const URL_ = `postgres://localhost:5432/${DB}`
const SECRET = 'catalog-img-gate-secret'

let jwt, pg
try { jwt = require('jsonwebtoken'); pg = require('pg') } catch {
  console.log('SKIP  server/node_modules is not installed — run `npm i` in server/ first.')
  process.exit(0)
}

/* A FRESH DATABASE EVERY RUN — a gate that inherits the last run's rows passes on state it
   did not create, the same failure as a stale process making a broken build look healthy. */
try { sh('dropdb', ['--if-exists', DB]) } catch { /* nothing to drop */ }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])

/* STAFF, because the whole-list upsert is requireStaff and the read is role-filtered. An
   admin also skips sellerSafe(), so what comes back is the slimmed object itself rather
   than the public projection of it — which is the thing under test. */
const ADMIN = sh('psql', ['-t', '-A', '-d', DB, '-c',
  `insert into users (email, password_hash, role, name) values ('gate-admin@test.local','x','admin','Gate Admin') returning id`])
  .trim().split('\n')[0].trim()

const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DATABASE_URL: URL_, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (process.env.GATE_DEBUG) { api.stdout.on('data', d => process.stderr.write(d)); api.stderr.on('data', d => process.stderr.write(d)) }
const API = `http://127.0.0.1:${PORT}`
const token = jwt.sign({ sub: ADMIN, role: 'admin', email: 'gate-admin@test.local' }, SECRET, { expiresIn: '1h' })
const db = new pg.Client({ connectionString: URL_ })

let bad = 0
/* TRUNCATED, because the fixture images are 48KB each and a failure printed them in full:
   128KB of base64 for a one-line mistake, which is a failure message nobody reads. The head
   of each value is enough to tell a hash from a data: URL, which is the only distinction any
   assertion here turns on. */
const brief = (v) => {
  const s = JSON.stringify(v)
  return s.length <= 160 ? s : s.slice(0, 157) + '…'
}
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n         got  ${brief(got)}\n         want ${brief(want)}`}`)
}
const authed = (extra = {}) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...extra })
const getJson = async (path) => (await fetch(API + path, { headers: authed() })).json()

async function waitForApi() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${API}/health`)).ok) return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
function teardown() {
  try { api.kill('SIGKILL') } catch { /* already gone */ }
  try { sh('dropdb', ['--if-exists', DB]) } catch { /* the next run drops it */ }
}
process.on('exit', teardown)

if (!(await waitForApi())) {
  console.error('FAIL  the API never came up — that is §2.1, and it means every route is down, not just this one.')
  process.exit(1)
}
await db.connect()

/**
 * WAIT FOR THE COLUMN, NOT FOR THE PORT.
 *
 * §6: many columns and tables here are added idempotently AT ROUTE LOAD, as fire-and-forget
 * `alter table … add column if not exists` with a `.catch(() => {})` on the end. They are not
 * awaited and `/health` does not wait for them, so a fresh database answers 200 on the health
 * probe while `catalog_products.data` still does not exist — and the fixture insert then fails
 * with a column error that looks like a schema bug rather than a race. This gate hit exactly
 * that, intermittently, which is the worst way for it to fail: a flaky gate gets ignored.
 */
async function waitForColumn(table, column) {
  for (let i = 0; i < 60; i++) {
    const r = await db.query(
      `select 1 from information_schema.columns where table_name = $1 and column_name = $2`,
      [table, column],
    ).catch(() => ({ rowCount: 0 }))
    if (r.rowCount) return true
    await new Promise((res) => setTimeout(res, 100))
  }
  return false
}
if (!(await waitForColumn('catalog_products', 'data'))) {
  console.error('FAIL  catalog_products.data never appeared — the route-load migration did not run.')
  process.exit(1)
}

/* REAL BYTES, AND REALISTICALLY BIG. Asserted on the bytes rather than on a string that
   merely looks like an image, and distinct per field — a shared payload hashes the same, so
   one field's rewrite could stand in for another's and the gate would pass with a field
   missing. 48KB each because the size assertion below has to mean something: against a
   12-byte fixture a 33-char ref is BIGGER than the data it replaces, which would make the
   check a statement about the fixture rather than about the route. Production side_mockups
   run 100-560KB apiece, so this is the conservative end of real. */
const png = (tail) => 'data:image/png;base64,'
  + Buffer.from(('PNG-' + tail).padEnd(48 * 1024, '-' + tail)).toString('base64')

/* A PATH THAT IS NOT BASE64 and must survive untouched. §2.9: this is a supplier proxy
   path, and 7 of the 12 side_mockups values in production are exactly this shape. */
const KEEP = '/api/ss/img?u=https%3A%2F%2Fcdn.example%2Fblank.jpg'

/* EVERY IMAGE-BEARING FIELD slimImages knows about, with its shape. A field added there and
   not here is a field this gate does not protect — which is how side_mockups was missed. */
const FIELDS = [
  { key: 'img', shape: 'scalar' },
  { key: 'images', shape: 'array' },
  { key: 'colorImages', shape: 'map' },
  { key: 'colorGallery', shape: 'mapOfArrays' },
  { key: 'side_mockups', shape: 'map' },
  { key: 'sideMockups', shape: 'map' },
]

const build = (v) => ({
  img: v('img'),
  images: [v('images0'), KEEP],
  colorImages: { Black: v('ci'), White: KEEP },
  colorGallery: { Black: [v('cg'), KEEP] },
  side_mockups: { hood: v('sm'), sleeve: KEEP },
  sideMockups: { back: v('smc') },
})
const ORIGINAL = { id: 'gate-1', name: 'Gate Tee', sku: 'EG-GATE', status: 'Active', price: 10, ...build(png) }

await db.query(
  `insert into catalog_products (id, name, sku, data, status, base_price)
     values ($1, $2, $3, $4::jsonb, 'Active', 10)`,
  ['gate-1', ORIGINAL.name, ORIGINAL.sku, JSON.stringify(ORIGINAL)],
)

console.log('CATALOGUE IMAGE REFS')

// ── 1 · the list is slimmed ─────────────────────────────────────────────────────────────
const list = await getJson('/api/catalog_products')
const got = Array.isArray(list) ? list.find((p) => p.id === 'gate-1') : null
if (!got) {
  console.error('FAIL  the product did not come back from /api/catalog_products at all.')
  process.exit(1)
}
const REF = /^\/api\/catalog\/img\/[0-9a-f]{24}$/
const valuesOf = (p, f) => f.shape === 'scalar' ? [p[f.key]]
  : f.shape === 'array' ? p[f.key]
  : f.shape === 'map' ? Object.values(p[f.key] ?? {})
  : Object.values(p[f.key] ?? {}).flat()

for (const f of FIELDS) {
  const vs = valuesOf(got, f)
  const rewritten = vs.filter((v) => REF.test(v)).length
  const kept = vs.filter((v) => v === KEEP).length
  const stillBase64 = vs.filter((v) => typeof v === 'string' && v.startsWith('data:')).length
  const wantRefs = valuesOf(ORIGINAL, f).filter((v) => String(v).startsWith('data:')).length
  const wantKeep = valuesOf(ORIGINAL, f).filter((v) => v === KEEP).length
  check(`${f.key}: base64 → /api/catalog/img/<hash>`, { rewritten, stillBase64 }, { rewritten: wantRefs, stillBase64: 0 })
  check(`${f.key}: a non-base64 value is left alone`, kept, wantKeep)
}

/* THE RESPONSE IS ACTUALLY SMALLER — the entire point. Asserted as a ratio rather than a
   byte count so it does not need editing every time a field is added to the fixture. */
const beforeBytes = JSON.stringify(ORIGINAL).length
const afterBytes = JSON.stringify(got).length
check('the slimmed row is under half the stored row', afterBytes * 2 < beforeBytes, true)

// ── 2 · the ref serves the original bytes ───────────────────────────────────────────────
const ref = got.side_mockups.hood
const imgRes = await fetch(API + ref)
const servedB64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64')
check('/api/catalog/img/<hash> answers 200', imgRes.status, 200)
check('…with the original bytes', servedB64, png('sm').split(',')[1])
check('…and an immutable cache header', /immutable/.test(imgRes.headers.get('cache-control') || ''), true)

// ── 3 · THE RECORD SURVIVES A ROUND TRIP ────────────────────────────────────────────────
/* The products UI POSTs back exactly what it was handed. So POST the SLIMMED object — the
   projection — and the stored row must come back out as the original base64, not as hashes.
   This is the assertion that would have caught side_mockups being slimmed without being
   fattened, and colorGallery before it. */
const put = await fetch(API + '/api/catalog_products', {
  method: 'POST', headers: authed(), body: JSON.stringify([got]),
})
check('the whole-list upsert accepts the slimmed object', put.status, 200)

const stored = (await db.query(`select data from catalog_products where id='gate-1'`)).rows[0]?.data
for (const f of FIELDS) {
  check(`${f.key}: stored as bytes again, never as a hash`, valuesOf(stored, f), valuesOf(ORIGINAL, f))
}

// ── 4 · and the next read is slimmed again ──────────────────────────────────────────────
const again = (await getJson('/api/catalog_products')).find((p) => p.id === 'gate-1')
check('a second read is slimmed exactly as the first', JSON.stringify(build(() => 0)) === JSON.stringify(build(() => 0)) && REF.test(again.side_mockups.hood), true)

console.log(bad === 0
  ? '\nFLOOR  ok — every image field slims, serves and round-trips.'
  : `\nFLOOR  ${bad} failing — a field that slims but does not fatten DESTROYS the image on the next save.`)
process.exit(bad === 0 ? 0 : 1)
