/**
 * check-library-attach.mjs — THE DESIGN LAB LIBRARY ASKS BEFORE IT TOUCHES AN ORDER.
 *
 * Filing a stitch file against artwork puts it onto every order carrying that exact picture,
 * any seller's. This drives the whole path against the REAL Fastify app and a throwaway
 * Postgres — no mocks, because a mocked query is how a column that did not exist once
 * reached production (CLAUDE.md §7):
 *
 *   · the preview sorts faces into attach / needsMethod / notAttached the way the dialog
 *     draws them (a DTG face and a shipped order are listed, never written)
 *   · the confirm writes ONLY the faces that were ticked, and never sets a method on a
 *     seller's draft for a non-admin
 *   · artwork arriving later lands on ITS face only — a face someone unticked stays empty
 *   · switching a face to Embroidery picks up the library file (it used to wait forever)
 *   · a stitch file refused on a DTG face through the plain upload route
 *   · Replace swaps only unstitched orders under "unshipped", keeps the rest
 *   · every step lands on the artwork's own history
 *   · a staff file list says "from library"; a seller's never does (§6)
 *
 *   node tools/check-library-attach.mjs      # exits 1 on any failure, skips without Postgres
 */
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

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

const DB = 'egfulfill_library_attach_gate'
const PORT = 4155   // unique across tools/check-*.mjs
const URL_ = `postgres://localhost:5432/${DB}`
const SECRET = 'library-attach-gate-secret'

try { sh('dropdb', ['--if-exists', '--force', DB]) }
catch { try { sh('dropdb', ['--if-exists', DB]) } catch { /* nothing to drop */ } }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])
const psql = (sql) => sh('psql', ['-t', '-A', '-q', '-d', DB, '-c', sql]).trim()
const user = (email, role) => psql(`insert into users (email, password_hash, role, name) values ('${email}','x','${role}','${role} ${email.split('@')[0]}') returning id`).split('\n')[0]
const OP = user('op@gate.local', 'operator')
const ADMIN = user('admin@gate.local', 'admin')
const SA = user('a@gate.local', 'seller')
const SB = user('b@gate.local', 'seller')

const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DATABASE_URL: URL_, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test',
         SPACES_KEY: '', SPACES_SECRET: '', SPACES_BUCKET: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (process.env.GATE_DEBUG) { api.stdout.on('data', d => process.stderr.write(d)); api.stderr.on('data', d => process.stderr.write(d)) }
const API = `http://127.0.0.1:${PORT}`
const tok = (sub, role, email) => jwt.sign({ sub, role, email }, SECRET, { expiresIn: '1h' })
const T = { op: tok(OP, 'operator', 'op@gate.local'), admin: tok(ADMIN, 'admin', 'admin@gate.local'), a: tok(SA, 'seller', 'a@gate.local') }

let bad = 0
const check = (label, ok, detail = '') => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `  — ${detail}`}`)
}
function teardown() {
  try { api.kill('SIGKILL') } catch { /* gone */ }
  try { sh('dropdb', ['--if-exists', '--force', DB]) } catch { /* next run drops it */ }
}
process.on('exit', teardown)

for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${API}/health`)).ok) break } catch { /* not up */ }
  await new Promise((r) => setTimeout(r, 250))
}
/* Tables and columns created at route load (order_designs, design_file_data.art_hash …)
   are chained promises; give them a moment after /health answers. */
await new Promise((r) => setTimeout(r, 1500))

const call = async (who, method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + T[who], ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let json = null
  try { json = await r.json() } catch { /* not json */ }
  return { status: r.status, body: json ?? {} }
}

/* THE ARTWORK. Its hash is computed the way the design route computes it, so an artwork save
   through the real route lands on the same identity the seeded rows carry. */
const ART = 'data:image/png;base64,' + Buffer.from('library-attach-gate-artwork').toString('base64')
const H = crypto.createHash('sha256').update(Buffer.from(ART.split(',')[1], 'base64')).digest('hex')
const stitch = (text) => 'data:application/octet-stream;base64,' + Buffer.from(text).toString('base64')

/* One order per case. (id, seller, order stage, line method, face side, face method) */
const seed = [
  ['G-EMB', SA, 'in_review', 'Embroidery', 'front', null],     // attach
  ['G-DRAFT', SB, 'new', '', 'front', null],                   // needsMethod, seller's draft
  ['G-DTG', SA, 'in_review', 'DTG', 'back', null],             // notAttached: method
  ['G-SHIP', SA, 'shipped', 'Embroidery', 'front', null],      // notAttached: finished
  ['G-WORK', SA, 'working', 'Embroidery', 'front', null],      // attach (being made, needs its file)
  ['G-SKIP', SA, 'approved', 'Embroidery', 'front', null],     // attach, but UNTICKED
  ['G-FLIP', SA, 'in_review', 'DTG', 'front', 'DTG'],          // later switched to Embroidery
]
for (const [id, seller, stage, method, side, faceMethod] of seed) {
  psql(`insert into orders (id, seller_id, factory_status) values ('${id}', '${seller}', '${stage}')`)
  psql(`insert into order_items (order_id, sku, line_id, print_type, name) values ('${id}', 'SKU-${id}', 'L-${id}', '${method}', 'Tee')`)
  psql(`insert into order_designs (order_id, sku, line_id, kind, side, data, art_hash, method)
        values ('${id}', 'SKU-${id}', 'L-${id}', 'raster', '${side}', 'x', '${H}', ${faceMethod ? `'${faceMethod}'` : 'null'})`)
}
const key = (id, side) => `${id}|L:L-${id}|${side}`
const filesOn = (id) => psql(`select coalesce(string_agg(file_name || '@' || coalesce(side,''), ','), '') from design_file_data where order_id='${id}' and kind in ('pes','emb')`)

console.log('preview')
{
  const s = await call('a', 'GET', `/api/design_files/library/${H}/preview`)
  check('a seller cannot read the preview (it names other shops)', s.status === 403, String(s.status))
  const p = (await call('op', 'GET', `/api/design_files/library/${H}/preview`)).body
  const ids = (list) => (list || []).map((f) => f.order_id).sort().join(',')
  check('attach = the embroidered, unfinished faces', ids(p.attach) === 'G-EMB,G-SKIP,G-WORK', ids(p.attach))
  check('needsMethod = the face nobody has described', ids(p.needsMethod) === 'G-DRAFT', ids(p.needsMethod))
  check('notAttached = the DTG faces and the shipped order', ids(p.notAttached) === 'G-DTG,G-FLIP,G-SHIP', ids(p.notAttached))
  check('the draft is marked as the seller’s', p.needsMethod?.[0]?.seller_draft === true)
  const why = Object.fromEntries((p.notAttached || []).map((f) => [f.order_id, f.reason]))
  check('each refusal says why', why['G-DTG'] === 'method' && why['G-SHIP'] === 'finished', JSON.stringify(why))
}

console.log('attach')
{
  const s = await call('a', 'POST', '/api/design_files', { designId: 'ART-seller', name: 'x.emb', data: stitch('x'), artHash: H })
  check('a seller cannot file against artwork (it would reach other shops’ orders)', s.status === 403, String(s.status))
  const r = await call('op', 'POST', '/api/design_files', {
    designId: `ART-${H.slice(0, 16)}`, name: 'logo.emb', data: stitch('v1'), artHash: H,
    targets: [{ key: key('G-EMB', 'front') }, { key: key('G-WORK', 'front') },
              { key: key('G-DRAFT', 'front'), setMethod: true },
              { key: key('G-DTG', 'back') }, { key: key('G-SHIP', 'front') }],   // the last two must be refused
  })
  check('the confirm attaches exactly the ticked, allowed faces', r.body.attached === 3, JSON.stringify(r.body))
  check('ticked faces have the file', ['G-EMB', 'G-WORK', 'G-DRAFT'].every((id) => filesOn(id).includes('logo.emb@front')))
  check('the unticked face stays empty', filesOn('G-SKIP') === '', filesOn('G-SKIP'))
  check('a DTG face is never written, even when sent', filesOn('G-DTG') === '', filesOn('G-DTG'))
  check('a shipped order is never written, even when sent', filesOn('G-SHIP') === '', filesOn('G-SHIP'))
  const m = psql(`select coalesce(method,'') from order_designs where order_id='G-DRAFT'`)
  check('a non-admin does not set the method on a seller’s draft', m === '', m)
}

console.log('artwork arriving later')
{
  psql(`insert into orders (id, seller_id, factory_status) values ('G-NEW', '${SA}', 'in_review')`)
  psql(`insert into order_items (order_id, sku, line_id, print_type, name) values ('G-NEW', 'SKU-G-NEW', 'L-G-NEW', 'Embroidery', 'Cap')`)
  const r = await call('op', 'POST', '/api/orders/G-NEW/designs', { line_id: 'L-G-NEW', sku: 'SKU-G-NEW', side: 'front', data: ART })
  check('the artwork saves', r.status === 200 && !r.body.error, JSON.stringify(r.body).slice(0, 160))
  let got = ''
  for (let i = 0; i < 20 && !got; i++) { await new Promise((z) => setTimeout(z, 150)); got = filesOn('G-NEW') }
  check('the new face takes the library file by itself', got.includes('logo.emb'), got)
  check('…and ONLY that face — the unticked one is still empty', filesOn('G-SKIP') === '', filesOn('G-SKIP'))
}

console.log('switching a face to embroidery')
{
  const r = await call('op', 'POST', '/api/orders/G-FLIP/designs', { line_id: 'L-G-FLIP', sku: 'SKU-G-FLIP', side: 'front', method: 'Embroidery' })
  check('the method-only save succeeds', r.status === 200 && !r.body.error, JSON.stringify(r.body).slice(0, 160))
  let got = ''
  for (let i = 0; i < 20 && !got; i++) { await new Promise((z) => setTimeout(z, 150)); got = filesOn('G-FLIP') }
  check('the face picks up the library file', got.includes('logo.emb'), got)
}

console.log('a stitch file on a DTG face')
{
  const r = await call('op', 'POST', '/api/design_files', { designId: 'DTG-try', orderId: 'G-DTG', lineId: 'L-G-DTG', side: 'back', name: 'wrong.emb', data: stitch('w') })
  check('the plain upload route refuses it', r.status === 409, `${r.status} ${JSON.stringify(r.body)}`)
  check('nothing was stored', filesOn('G-DTG') === '', filesOn('G-DTG'))
}

console.log('replace')
{
  const lib = `ART-${H.slice(0, 16)}`
  const c = (await call('op', 'GET', `/api/design_files/library/file/${lib}/copies`)).body.copies || []
  const u = Object.fromEntries(c.map((x) => [x.order_id, x.unshipped]))
  check('copies know which orders are unstitched', u['G-EMB'] === true && u['G-DRAFT'] === true && u['G-WORK'] === false, JSON.stringify(u))
  const r = await call('op', 'POST', `/api/design_files/library/file/${lib}/replace`, { name: 'logo-v2.emb', data: stitch('v2'), scope: 'unshipped' })
  check('replace succeeds', r.status === 200 && r.body.ok, JSON.stringify(r.body))
  check('unstitched orders now carry the new file', ['G-EMB', 'G-DRAFT', 'G-NEW', 'G-FLIP'].every((id) => filesOn(id).includes('logo-v2.emb')),
    ['G-EMB', 'G-DRAFT', 'G-NEW', 'G-FLIP'].map(filesOn).join(' | '))
  check('an order being made keeps the file it was made with', filesOn('G-WORK').includes('logo.emb@') && !filesOn('G-WORK').includes('v2'), filesOn('G-WORK'))
  const libs = psql(`select string_agg(file_name, ',') from design_file_data where order_id is null and art_hash='${H}'`)
  check('the library holds the new file only', libs === 'logo-v2.emb', libs)
  const b = psql(`select data from design_file_data where order_id='G-EMB' and kind in ('pes','emb')`)
  check('the swapped copy carries the new BYTES, not just the name', b === stitch('v2'), b.slice(0, 60))
}

console.log('history')
{
  await new Promise((z) => setTimeout(z, 300))   // audit writes are fire-and-forget
  const h = (await call('op', 'GET', `/api/audit/entity?entityId=${H}`)).body
  const acts = new Set((Array.isArray(h) ? h : []).map((x) => x.action))
  for (const a of ['design_file.library_added', 'design_file.auto_attached', 'design_file.library_replaced']) {
    check(`the artwork's history records ${a}`, acts.has(a), [...acts].join(','))
  }
  /* THE CARD'S OWN ROUTE — file events plus the orders the picture was put on, which is
     what gives a card with no library file a history at all. */
  const s = await call('a', 'GET', `/api/design_files/library/${H}/history`)
  check('a seller cannot read an artwork’s history', s.status === 403, String(s.status))
  await call('op', 'POST', '/api/orders/G-NEW/designs', { line_id: 'L-G-NEW', sku: 'SKU-G-NEW', side: 'front', data: ART, pos: { x: 1 } })
  await new Promise((z) => setTimeout(z, 300))
  const card = (await call('op', 'GET', `/api/design_files/library/${H}/history`)).body
  const saves = (Array.isArray(card) ? card : []).filter((x) => x.action === 'design.saved')
  check('the card history carries when the artwork was put on an order', saves.some((x) => x.order?.id === 'G-NEW'), JSON.stringify(card).slice(0, 200))
  check('…once per order, not once per re-save', saves.filter((x) => x.entity_id === 'G-NEW').length === 1, String(saves.length))
  check('…alongside the file events', (Array.isArray(card) ? card : []).some((x) => x.action === 'design_file.library_replaced'))
  const o = (await call('op', 'GET', `/api/audit/entity?entityId=G-EMB`)).body
  const rep = (Array.isArray(o) ? o : []).find((x) => x.action === 'design_file.replaced')
  check('the order’s own history carries before AND after', rep?.before?.name === 'logo.emb' && rep?.after?.name === 'logo-v2.emb', JSON.stringify(rep))
}

console.log('who may see where a file came from (§6)')
{
  const staff = (await call('op', 'GET', '/api/design_files?orderId=G-EMB')).body
  check('staff see the library mark', Array.isArray(staff) && staff.some((f) => f.library), JSON.stringify(staff).slice(0, 200))
  psql(`update design_file_data set kind='pes' where order_id='G-EMB'`)   // make it a file the seller can see at all
  const seller = (await call('a', 'GET', '/api/design_files?orderId=G-EMB')).body
  check('the seller sees the file…', Array.isArray(seller) && seller.length > 0, JSON.stringify(seller).slice(0, 200))
  check('…and never where it came from', Array.isArray(seller) && seller.every((f) => !('library' in f)), JSON.stringify(seller).slice(0, 200))
}

console.log('remove')
{
  const libId = psql(`select design_id from design_file_data where order_id is null and art_hash='${H}'`)
  const r = await call('op', 'DELETE', `/api/design_files/${encodeURIComponent(libId)}`)
  check('the library file can be removed', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`)
  check('orders keep their copies', filesOn('G-EMB') !== '', filesOn('G-EMB'))
  await new Promise((z) => setTimeout(z, 300))
  const h = (await call('op', 'GET', `/api/audit/entity?entityId=${H}`)).body
  check('the removal is on the artwork’s history', (Array.isArray(h) ? h : []).some((x) => x.action === 'design_file.library_removed'))
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
