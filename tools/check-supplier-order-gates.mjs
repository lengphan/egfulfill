#!/usr/bin/env node
/**
 * THE SUPPLIER ORDER GATES — what can actually reach a supplier, proven rather than described.
 *
 * CLAUDE.md §8 has now been wrong about this TWICE, and confidently both times: it said the
 * UI sent only {sku, qty} after S&S had grown a full payload, and it said "NOTHING PLACES A
 * REAL ORDER TODAY / not set → dry run" while SS_ORDER_LIVE=1 was live on the VPS and Otto's
 * and SanMar's credentials had arrived. That is the expensive kind of stale — a reader
 * believes nothing can reach a supplier and stops checking — and prose cannot fail a build.
 *
 * So the claims are executed. Two halves, and the split is deliberate:
 *
 *   CODE   — booted for real against a throwaway Postgres with every gate unset, which is the
 *            documented default, and each order route is CALLED. A route that answers anything
 *            other than a dry run with its flag off is the bug this file exists for.
 *   CLIENT — the third argument of ssOrder() defaults to false, and no call site passes it.
 *            That default is the ONLY thing between the Place button and a real purchase
 *            order now that the server-side gate is open, so it is asserted by name.
 *
 * WHAT THIS FILE CANNOT SEE: which flags are set on the VPS. That is a property of a machine,
 * not of the repo. It prints the one command that answers it rather than pretending.
 *
 * Run: node tools/check-supplier-order-gates.mjs     (SKIPS cleanly with no local Postgres)
 */
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'server/package.json'))
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts })

let bad = 0
const check = (label, ok, detail = '') => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `  — ${detail}`}`)
}

/* ── CLIENT ─────────────────────────────────────────────────────────────────────────── */
console.log('THE CLIENT SIDE — one default argument is the last thing standing')
const apiSrc = readFileSync(join(ROOT, 'web/lib/api.ts'), 'utf8')
const purchase = readFileSync(join(ROOT, 'web/components/app/purchase-view.tsx'), 'utf8')

const ssDecl = apiSrc.slice(apiSrc.indexOf('export function ssOrder('), apiSrc.indexOf('export function ottoOrder('))
check('ssOrder() still defaults `live` to false', /live\s*=\s*false/.test(ssDecl),
  'the S&S server gate is OPEN on the VPS — this default is what keeps every order a Test order')
check('…and it is the THIRD parameter, so a two-argument call cannot reach it',
  ssDecl.indexOf('live = false') > ssDecl.indexOf('extra:'), 'parameter order changed; a call site may now be passing it by accident')

const callsWithLive = [...purchase.matchAll(/ssOrder\(/g)].length
check('both UI call sites exist', callsWithLive === 2, `found ${callsWithLive}`)
check('…and neither passes live:true', !/ssOrder\([^)]*\btrue\b/s.test(purchase) && !/live:\s*true/.test(purchase),
  'a call site is asking for a REAL S&S purchase order')

for (const [fn, why] of [['ottoOrder', 'NO_AUTO_ORDER holds Otto back on purpose'], ['sanmarOrder', 'SanMar has no UI path']]) {
  const uses = [...purchase.matchAll(new RegExp(fn + '\\(', 'g'))].length
  check(`${fn}() has no UI call site — ${why}`, uses === 0, `found ${uses}`)
}
check('NO_AUTO_ORDER still names otto', /NO_AUTO_ORDER[^=]*=\s*new Set\(\["otto"\]\)/.test(purchase))

/* ── CODE ───────────────────────────────────────────────────────────────────────────── */
try { sh('pg_isready', []) } catch {
  console.log('\nSKIP  no local Postgres — the server half of this gate did not run.')
  process.exit(bad === 0 ? 0 : 1)
}
let jwt
try { jwt = require('jsonwebtoken') } catch {
  console.log('\nSKIP  server/node_modules is not installed — the server half did not run.')
  process.exit(bad === 0 ? 0 : 1)
}

const DB = 'egfulfill_order_gates'
const PORT = 4151
const SECRET = 'order-gate-secret'
try { sh('dropdb', ['--if-exists', DB]) } catch { /* nothing to drop */ }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])
const psql = (sql) => sh('psql', ['-t', '-A', '-q', '-d', DB, '-c', sql]).trim()
const ADMIN_ID = psql(`insert into users (email, password_hash, role, name) values ('gate-admin@test.local','x','admin','Gate') returning id`).split('\n')[0].trim()

/**
 * EVERY GATE EXPLICITLY UNSET, and the credentials faked.
 *
 * Unset is the documented default and the state this asserts. The fake credentials matter
 * just as much: `creds()` is checked BEFORE the gate, so a route with no credentials answers
 * "not configured" and never reaches the branch under test — which would make this file pass
 * by never testing anything. They are obvious nonsense, and no request leaves the process
 * because every route returns its dry run first. That is the thing being proven.
 */
const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: {
    ...process.env,
    DATABASE_URL: `postgres://localhost:5432/${DB}`, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test',
    SS_ORDER_LIVE: '', OTTOCAP_ORDER_LIVE: '', SANMAR_ORDER_LIVE: '',
    SS_ACCOUNT_NUMBER: 'gate-not-a-real-account', SS_API_KEY: 'gate-not-a-real-key',
    OTTOCAP_USERNAME: 'gate', OTTOCAP_PASSWORD: 'gate', OTTOCAP_CLIENT_ID: 'gate', OTTOCAP_CLIENT_SECRET: 'gate',
    SANMAR_USERNAME: 'gate', SANMAR_PASSWORD: 'gate', SANMAR_CUSTOMER_NUMBER: 'gate',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (process.env.GATE_DEBUG) { api.stdout.on('data', (d) => process.stderr.write(d)); api.stderr.on('data', (d) => process.stderr.write(d)) }
process.on('exit', () => {
  try { api.kill('SIGKILL') } catch { /* already gone */ }
  try { sh('dropdb', ['--if-exists', DB]) } catch { /* the next run drops it */ }
})
const API = `http://127.0.0.1:${PORT}`
const up = async () => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${API}/health`)).ok) return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
console.log('\nTHE SERVER SIDE — every gate unset, every order route called for real')
if (!(await up())) {
  console.error('FAIL  the API never came up — §2.1, and that is every route, not just these.')
  process.exit(1)
}
const token = jwt.sign({ sub: ADMIN_ID, role: 'admin', email: 'gate-admin@test.local' }, SECRET, { expiresIn: '1h' })
const post = async (path, body) => {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await r.json() } catch { /* not json */ }
  return { status: r.status, body: json || {} }
}
/* `street`, NOT `street1` — toSsAddress() reads `street` + `street2` and returns null for
   anything else, which the route answers as a 400 before the gate is ever reached. A fixture
   that 400s would let this file pass while testing nothing. */
const SHIP = { name: 'Gate', company: 'Gate Co', street: '1 Test St', city: 'Fairhaven', state: 'MA', zip: '02719', country: 'US' }
for (const [label, path, body] of [
  ['S&S',    '/api/ss/order',      { lines: [{ sku: '16468', qty: 1 }], shippingAddress: SHIP, poNumber: 'GATE-1' }],
  /* Otto validate FOUR things before the gate — shipping method, payment method, customer
     and contact — and each 400 arrives ahead of the dry run. All four are supplied so the
     gate is actually reached; a fixture that 400s would let this file pass while testing
     nothing, which is the failure mode it exists to prevent elsewhere. */
  ['Otto',   '/api/otto/order'   , { items: [{ sku: 'LA6', qty: 1 }], shipping_address: SHIP, shipping_method: 'GROUND', payment_method: 'NET30', customer: 'gate-customer', contact: 'gate-contact' }],
  ['SanMar', '/api/sanmar/order',  { lines: [{ style: 'PC61', qty: 1 }], shipTo: SHIP }],
]) {
  const r = await post(path, body)
  check(`${label} dry-runs with its flag unset`, r.status === 200 && r.body.dryRun === true,
    `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`)
}
/* The S&S dry run must also show the Test-mode flag it WOULD send, because that is the
   second safety and the one the client controls. */
const ss = await post('/api/ss/order', { lines: [{ sku: '16468', qty: 1 }], shippingAddress: SHIP, poNumber: 'GATE-2' })
check('…and the S&S payload it would send is a TEST order unless live:true is passed',
  ss.body.payload && ss.body.payload.testOrder === true, JSON.stringify(ss.body.payload || {}).slice(0, 140))
const ssLive = await post('/api/ss/order', { lines: [{ sku: '16468', qty: 1 }], shippingAddress: SHIP, poNumber: 'GATE-3', live: true })
check('…and live:true flips exactly that flag, which is what makes it real money',
  ssLive.body.payload && ssLive.body.payload.testOrder === false, JSON.stringify(ssLive.body.payload || {}).slice(0, 140))

/* ── THE DOC ────────────────────────────────────────────────────────────────────────── */
console.log('\nTHE DOC — §8 must not describe a different system')
const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
const block = claude.slice(claude.indexOf('- **Supplier ordering'), claude.indexOf('- **Design library'))
check('§8 still has a supplier-ordering block', block.length > 200)
/* The HEADING only. The block below it quotes the old wording on purpose, so searching the
   whole thing would fail on the correction itself — a gate that punishes the fix. */
const heading = block.split('\n')[0]
check('…and its heading does not claim nothing can reach a supplier', !/NOTHING PLACES A REAL ORDER/.test(heading),
  `heading still reads: ${heading.slice(0, 90)}`)
check('…and it names the flag that is actually on', /SS_ORDER_LIVE=1/.test(block))
check('…and it says Otto and SanMar are dry runs', /Otto[\s\S]*not set → dry run/.test(block) && /SanMar[\s\S]*not set → dry run/.test(block))
check('…and it credits Otto/SanMar keys to app_secrets, where they actually are', (block.match(/app_secrets/g) || []).length >= 2)

console.log(`\nTHE HALF THIS FILE CANNOT SEE — which flags are set on the box:
  ssh root@187.52.126.233 'cd /root/egfulfill && grep -E "^(SS|OTTOCAP|SANMAR)_ORDER_LIVE=" .env'
  (2026-09-23: SS_ORDER_LIVE=1, the other two absent.)`)
console.log(bad === 0 ? '\nPASS  the gates are where §8 says they are.' : `\nFAIL  ${bad} problem${bad === 1 ? '' : 's'}.`)
process.exit(bad === 0 ? 0 : 1)
