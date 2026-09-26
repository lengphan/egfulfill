/**
 * check-order-refresh.mjs — A BOARD RE-FETCHES THE ORDER THAT CHANGED, AND ONLY STAFF LEARN WHICH.
 *
 * Every change used to ping every open browser with a bare "orders changed", and every board
 * re-downloaded all ~1,300 orders. Now staff sockets hear the order's id and pull that one row
 * through GET /api/orders?ids=. This drives the REAL app against a throwaway Postgres:
 *
 *   · ?ids= returns a row IDENTICAL to the same order in the full list (the table draws it)
 *   · ?ids= still obeys visibility: a seller cannot fetch another shop's order by naming it
 *   · a staff socket's ping names the order; a seller's ping does not (another shop's id)
 *   · the cursor still pages correctly beside it
 *
 *   node tools/check-order-refresh.mjs      # exits 1 on failure, skips without Postgres
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

const DB = 'egfulfill_order_refresh_gate'
const PORT = 4157   // unique across tools/check-*.mjs
const SECRET = 'order-refresh-gate'
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
const BASE = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch { /* soon */ } await new Promise((r) => setTimeout(r, 250)) }
await new Promise((r) => setTimeout(r, 1500))

const T = {
  op: jwt.sign({ sub: OP, role: 'operator', email: 'op@gate.local' }, SECRET),
  a: jwt.sign({ sub: SA, role: 'seller', email: 'a@gate.local' }, SECRET),
}
const get = async (who, path) => (await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + T[who] } })).json()
let bad = 0
const check = (label, ok, detail = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `  — ${detail}`}`) }

// Seller A's submitted orders (visible to staff) and seller B's (never visible to A).
for (let i = 0; i < 6; i++) {
  psql(`insert into orders (id, seller_id, factory_status, created_at) values ('A-${i}', '${SA}', 'in_review', now() - interval '${i} hours')`)
  psql(`insert into order_items (order_id, sku, line_id, name, qty) values ('A-${i}', 'S', 'L-A-${i}', 'Tee', 1)`)
}
psql(`insert into orders (id, seller_id, factory_status) values ('B-0', '${SB}', 'in_review')`)
psql(`insert into order_items (order_id, sku, line_id, name, qty) values ('B-0', 'S', 'L-B-0', 'Tee', 1)`)

console.log('?ids=')
{
  const full = await get('op', '/api/orders')
  const one = await get('op', '/api/orders?ids=A-2')
  const inFull = full.find((o) => o.id === 'A-2')
  check('returns exactly the named order', Array.isArray(one) && one.length === 1 && one[0].id === 'A-2', JSON.stringify(one).slice(0, 120))
  check('…identical to its row in the full list', JSON.stringify(one[0]) === JSON.stringify(inFull))
  const two = await get('op', '/api/orders?ids=A-1,A-4')
  check('several ids at once', Array.isArray(two) && two.map((o) => o.id).sort().join() === 'A-1,A-4', JSON.stringify(two.map((o) => o.id)))
  const theirs = await get('a', '/api/orders?ids=B-0,A-0')
  check('a seller naming another shop’s order gets only their own', Array.isArray(theirs) && theirs.every((o) => o.id !== 'B-0'), JSON.stringify(theirs.map((o) => o.id)))
  const page1 = await get('op', '/api/orders?limit=2')
  const last = page1[page1.length - 1]
  const page2 = await get('op', `/api/orders?limit=2&cursor=${encodeURIComponent(new Date(last.created_at).toISOString() + '|' + last.id)}`)
  check('the cursor still pages beside it', page2.length === 2 && !page2.some((o) => page1.find((p) => p.id === o.id)), JSON.stringify([page1.map((o) => o.id), page2.map((o) => o.id)]))
}

console.log('live pings')
{
  const listen = (who) => {
    const got = []
    const ctl = new AbortController()
    fetch(`${BASE}/api/events?token=${T[who]}`, { signal: ctl.signal }).then(async (r) => {
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true })
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
          const line = chunk.split('\n').find((l) => l.startsWith('data: ')); if (line) { try { got.push(JSON.parse(line.slice(6))) } catch { /* keepalive */ } } } }
    }).catch(() => { /* aborted */ })
    return { got, stop: () => ctl.abort() }
  }
  const staff = listen('op'), seller = listen('a')
  await new Promise((r) => setTimeout(r, 800))
  const r = await fetch(`${BASE}/api/orders/A-3`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + T.op, 'Content-Type': 'application/json' }, body: JSON.stringify({ tracking: 'TRK1' }) })
  check('the change is accepted', r.status === 200, String(r.status))
  await new Promise((r) => setTimeout(r, 800))
  const s = staff.got.find((e) => e.type === 'orders'), v = seller.got.find((e) => e.type === 'orders')
  check('a staff socket hears which order changed', s && s.orderId === 'A-3', JSON.stringify(staff.got))
  check('a seller socket hears only that something changed', v && !('orderId' in v), JSON.stringify(seller.got))
  staff.stop(); seller.stop()
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
