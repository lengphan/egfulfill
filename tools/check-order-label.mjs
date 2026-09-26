/**
 * check-order-label.mjs — A CUSTOM ORDER ID ("T01") IS ACCEPTED, AND CANNOT CAUSE TROUBLE.
 *
 * Typing T01 into the order number was refused ("a whole number above zero"), and the
 * number field it edited (`seq`) was never even shown on an order that had an EGF number.
 * The editor now writes `ref_label`, which numOf prints first. This drives the REAL PATCH
 * route against a throwaway Postgres (CLAUDE.md §7 — no mocks):
 *
 *   · staff can set T01 and read it back; a leading "#" is dropped
 *   · the same ID in another case on the same seller's other order → 409
 *   · the same ID on ANOTHER seller's order is fine (unique per seller, like seq)
 *   · an EGF-shaped ID is refused — it would pose as another order's platform number
 *   · a seller may set their own DRAFT's ID, never a submitted order's, never someone else's
 *   · clearing it puts the EGF number back, and the change is audited before AND after
 *
 *   node tools/check-order-label.mjs      # exits 1 on failure, skips without Postgres
 */
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'server/package.json'))
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' })
try { sh('pg_isready', []) } catch { console.log('SKIP  no local Postgres'); process.exit(0) }
let jwt
try { jwt = require('jsonwebtoken') } catch { console.log('SKIP  server/node_modules missing'); process.exit(0) }

const DB = 'egfulfill_order_label_gate'
const PORT = 4156   // unique across tools/check-*.mjs
const SECRET = 'order-label-gate'
try { sh('dropdb', ['--if-exists', '--force', DB]) } catch { /* none */ }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])
const psql = (sql) => sh('psql', ['-t', '-A', '-q', '-d', DB, '-c', sql]).trim()
const user = (email, role) => psql(`insert into users (email, password_hash, role, name) values ('${email}','x','${role}','${email}') returning id`).split('\n')[0]
const OP = user('op@gate.local', 'operator'), SA = user('a@gate.local', 'seller'), SB = user('b@gate.local', 'seller')

const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DATABASE_URL: `postgres://localhost:5432/${DB}`, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: 'ignore',
})
process.on('exit', () => { try { api.kill('SIGKILL') } catch { /* gone */ } try { sh('dropdb', ['--if-exists', '--force', DB]) } catch { /* later */ } })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch { /* up soon */ } await new Promise((r) => setTimeout(r, 250)) }
await new Promise((r) => setTimeout(r, 1500))   // route-load DDL (ref_label + its index)

const T = {
  op: jwt.sign({ sub: OP, role: 'operator', email: 'op@gate.local' }, SECRET),
  a: jwt.sign({ sub: SA, role: 'seller', email: 'a@gate.local' }, SECRET),
}
const patch = async (who, id, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/orders/${id}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + T[who], 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
let bad = 0
const check = (label, ok, detail = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `  — ${detail}`}`) }

psql(`insert into orders (id, seller_id, factory_status, ref_no) values
  ('O1','${SA}','new',2116), ('O2','${SA}','new',2117), ('O3','${SB}','new',2118), ('O4','${SA}','in_review',2119)`)
const label = (id) => psql(`select coalesce(ref_label,'') from orders where id='${id}'`)

let r = await patch('op', 'O1', { refLabel: '# T01' })
check('staff set T01 (a leading # dropped)', r.status === 200 && label('O1') === 'T01', `${r.status} ${JSON.stringify(r.body)} → ${label('O1')}`)
r = await patch('op', 'O2', { refLabel: 't01' })
check('the same ID in another case on the same seller → 409', r.status === 409 && label('O2') === '', `${r.status} ${JSON.stringify(r.body)}`)
r = await patch('op', 'O3', { refLabel: 'T01' })
check('another seller may use the same ID', r.status === 200 && label('O3') === 'T01', `${r.status} ${JSON.stringify(r.body)}`)
r = await patch('op', 'O2', { refLabel: 'EGF-000123' })
check('an EGF-shaped ID is refused', r.status === 400 && label('O2') === '', `${r.status} ${JSON.stringify(r.body)}`)
r = await patch('op', 'O2', { refLabel: 'bad<id>' })
check('odd characters are refused', r.status === 400, `${r.status}`)
r = await patch('a', 'O2', { refLabel: 'MY-2' })
check('a seller may name their own draft', r.status === 200 && label('O2') === 'MY-2', `${r.status} ${JSON.stringify(r.body)}`)
r = await patch('a', 'O4', { refLabel: 'MY-4' })
check('…not a submitted order', r.status === 403 && label('O4') === '', `${r.status} ${JSON.stringify(r.body)}`)
r = await patch('a', 'O3', { refLabel: 'MINE' })
check('…and not another seller’s', r.status === 403 && label('O3') === 'T01', `${r.status} ${JSON.stringify(r.body)}`)
r = await patch('op', 'O1', { refLabel: '' })
check('clearing puts the EGF number back', r.status === 200 && label('O1') === '', `${r.status} → ${label('O1')}`)
await new Promise((z) => setTimeout(z, 300))
const aud = psql(`select before->>'ref_label' || '→' || coalesce(after->>'ref_label','null') from audit_log where entity_id='O1' and action='order.updated' order by ts desc limit 1`)
check('the change is audited before AND after', aud === 'T01→null', aud)

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
