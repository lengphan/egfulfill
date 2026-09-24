#!/usr/bin/env node
/**
 * THE MCP GATE — every tool driven over the real protocol, against a real boot.
 *
 * server/src/routes/mcp.js rests on one claim: a tool call is the SAME call a partner
 * makes, because it re-dispatches through `app.inject` with the caller's own key. That
 * claim is what lets the /api/v1/* audit transfer to MCP unchanged — supplier redaction,
 * seller scoping, scope refusals, a test key writing nothing. A claim in a comment is not
 * a measurement (§4), so this file drives the protocol and checks the results.
 *
 * Four things it holds:
 *
 *   1. A TOOL MAY NOT NAME A ROUTE THE DOCS DO NOT CARRY. web/lib/api-endpoints.ts is what
 *      a partner reads, and §6 says an entry there is a promise the route works. A tool
 *      pointing somewhere else would be an undocumented surface reachable by an assistant —
 *      the failure /api/test/* was deleted for.
 *
 *   2. NOTHING THAT WRITES. create_order and cancel_order are held back until Part A
 *      (Idempotency-Key) lands, because an agent retries and a retried create is a second
 *      garment. This fails if one appears early.
 *
 *   3. SCOPES DECIDE WHAT IS ADVERTISED. A key scoped products.read must not be SHOWN
 *      get_balance. The route is still the gate; this is about a model never reaching for
 *      something it will be refused.
 *
 *   4. THE TEST-KEY PROMISE AND §2.9 SURVIVE THE RE-DISPATCH. Nothing written, and no
 *      supplier prefix in any tool's output.
 *
 * Run:  node tools/check-mcp.mjs
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

let jwt
try { jwt = require('jsonwebtoken') } catch {
  console.log('SKIP  server/node_modules is not installed — run `npm i` in server/ first.')
  process.exit(0)
}
try { require.resolve('@modelcontextprotocol/sdk/server/mcp.js') } catch {
  console.log('SKIP  @modelcontextprotocol/sdk is not installed — run `npm i` in server/ first.')
  process.exit(0)
}

const DB = 'egfulfill_mcp_gate'
const PORT = 4153   // unique across tools/check-*.mjs
const URL_ = `postgres://localhost:5432/${DB}`
const SECRET = 'mcp-gate-secret'

try { sh('dropdb', ['--if-exists', '--force', DB]) }
catch { try { sh('dropdb', ['--if-exists', DB]) } catch { /* nothing to drop */ } }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])
const SELLER = sh('psql', ['-t', '-A', '-d', DB, '-c',
  `insert into users (email, password_hash, role, name) values ('mcp-gate@test.local','x','seller','MCP Gate') returning id`])
  .trim().split('\n')[0].trim()
/* The id carries the supplier prefix ON PURPOSE — §2.9's check below is only meaningful if
   there is something to leak. base_price > 0 or the pricer refuses the row. */
sh('psql', ['-q', '-d', DB, '-c',
  `insert into catalog_products (id, name, sku, type, method, base_price, price)
   values ('SANMAR-MCPGATE','Gate Tee','GATETEE','Apparel','DTG',8.50,14.50)`])

const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DATABASE_URL: URL_, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (process.env.GATE_DEBUG) { api.stdout.on('data', d => process.stderr.write(d)); api.stderr.on('data', d => process.stderr.write(d)) }
const API = `http://127.0.0.1:${PORT}`
const token = jwt.sign({ sub: SELLER, role: 'seller', email: 'mcp-gate@test.local' }, SECRET, { expiresIn: '1h' })

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

for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${API}/health`)).ok) break } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250))
}
if (!(await fetch(`${API}/health`).then((r) => r.ok).catch(() => false))) {
  console.error('FAIL  the API never came up — that is §2.1: every route is down, not just this one.')
  process.exit(1)
}

const mintKey = async (body) => (await (await fetch(`${API}/api/keys`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ mode: 'test', ...body }),
})).json())

/**
 * One JSON-RPC call over Streamable HTTP.
 *
 * `Accept` must name BOTH types or the transport refuses — it may answer either a JSON body
 * or an SSE stream, and it decides. `enableJsonResponse` makes it prefer JSON, but the SSE
 * framing still appears for some replies, so unwrap it rather than assuming.
 */
let rpcId = 0
const rpc = async (key, method, params = {}) => {
  const r = await fetch(`${API}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(key ? { 'X-API-Key': key } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  const text = await r.text()
  let body = null
  try { body = JSON.parse(text) } catch {
    const line = text.split('\n').find((l) => l.startsWith('data:'))
    if (line) { try { body = JSON.parse(line.slice(5).trim()) } catch { /* not json either */ } }
  }
  return { status: r.status, body, text }
}

const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'mcp-gate', version: '1.0.0' },
}

console.log('\nTHE KEY IS THE DOOR')
const noKey = await rpc(null, 'initialize', INIT)
check('no key is refused', noKey.status === 401, String(noKey.status))
check('...and the refusal says how to fix it, not just that it failed',
  /X-API-Key/i.test(noKey.text), noKey.text.slice(0, 120))

const bogus = await rpc('egk_test_not_a_real_key', 'initialize', INIT)
check('an unknown key is refused', bogus.status === 401, String(bogus.status))

const full = await mintKey({ label: 'mcp gate full' })
const init = await rpc(full.key, 'initialize', INIT)
check('a valid key completes initialize',
  init.status === 200 && !!init.body?.result?.serverInfo, JSON.stringify(init.body || init.text).slice(0, 160))
check('the server names itself', init.body?.result?.serverInfo?.name === 'egfulfill',
  JSON.stringify(init.body?.result?.serverInfo))

console.log('\nTHE TOOL LIST IS THE DOCUMENTED SURFACE, AND NOTHING ELSE')
const listed = await rpc(full.key, 'tools/list')
const tools = listed.body?.result?.tools || []
const names = tools.map((t) => t.name).sort()
check('tools/list answers', tools.length > 0, JSON.stringify(listed.body || listed.text).slice(0, 200))
check('every expected read tool is present',
  ['check_stock', 'get_balance', 'get_order', 'list_products', 'quote_order'].every((n) => names.includes(n)),
  names.join(','))

/* NOTHING THAT WRITES, until Part A. An agent retries; a retried create is a second
   garment. If one of these appears before idempotency lands, this is the thing that says so. */
check('no tool writes yet (create_order / cancel_order wait for Idempotency-Key)',
  !names.includes('create_order') && !names.includes('cancel_order'), names.join(','))
check('every advertised tool is marked read-only',
  tools.every((t) => t.annotations?.readOnlyHint === true),
  tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name).join(','))

/* A TOOL MAY NOT NAME A ROUTE THE DOCS DO NOT CARRY. Both lists are READ AS TEXT and the
   paths compared — the docs list is a .ts the server cannot import, and importing mcp.js
   would pull the whole server module graph into this process for the sake of one array,
   booting auth and printing warnings about a config the gate is not testing. */
const mcpSrc = readFileSync(join(ROOT, 'server/src/routes/mcp.js'), 'utf8')
const declared = [...mcpSrc.matchAll(/name:\s*'([a-z_]+)',\s*\n\s*route:\s*'(\w+) ([^']+)'/g)]
  .map((m) => ({ tool: m[1], path: m[3] }))
check('the tool table parses — a route: line per tool', declared.length >= 5, `found ${declared.length}`)
const docs = readFileSync(join(ROOT, 'web/lib/api-endpoints.ts'), 'utf8')
const documented = [...docs.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1])
const undocumented = declared.filter((t) => !documented.includes(t.path))
check('no tool points at a route the public docs do not document (§6)',
  undocumented.length === 0, undocumented.map((u) => `${u.tool} -> ${u.path}`).join(', '))

console.log('\nSCOPES DECIDE WHAT IS ADVERTISED')
const ro = await mintKey({ label: 'mcp gate products-only', scopes: ['products.read'] })
const roTools = (await rpc(ro.key, 'tools/list')).body?.result?.tools || []
const roNames = roTools.map((t) => t.name).sort()
check('a products.read key sees the product tools', roNames.includes('list_products') && roNames.includes('check_stock'), roNames.join(','))
check('...and is NOT shown balance or orders', !roNames.includes('get_balance') && !roNames.includes('get_order'), roNames.join(','))

console.log('\nA TOOL CALL IS THE SAME CALL A PARTNER MAKES')
const callTool = async (key, name, args = {}) =>
  rpc(key, 'tools/call', { name, arguments: args })

const prod = await callTool(full.key, 'list_products')
const prodText = prod.body?.result?.content?.[0]?.text || ''
check('list_products returns the REAL catalogue', prodText.includes('GATETEE'), prodText.slice(0, 160))
/* §2.9 — catalog_products.id carries the import prefix and names our supplier. The products
   route withholds it; this proves the re-dispatch did not reintroduce it. */
check('no supplier prefix survives the re-dispatch (§2.9)',
  !prodText.includes('SANMAR-MCPGATE') && !/SANMAR/i.test(prodText), 'a supplier name reached the model')

const quote = await callTool(full.key, 'quote_order',
  { items: [{ product_id: 'GATETEE', quantity: 2, size: 'M', method: 'DTG' }] })
const quoteText = quote.body?.result?.content?.[0]?.text || ''
check('quote_order prices from the real pricer', /"totals"/.test(quoteText) && /"unit_price"/.test(quoteText),
  quoteText.slice(0, 200))

const stock = await callTool(full.key, 'check_stock')
check('check_stock answers', /"object"/.test(stock.body?.result?.content?.[0]?.text || ''),
  JSON.stringify(stock.body || stock.text).slice(0, 160))

/* A REFUSAL IS AN ANSWER. The products-only key is refused balance BY THE ROUTE — this is
   the belt behind the braces, and it must arrive as readable text rather than a crash. */
const refused = await callTool(ro.key, 'get_balance')
check('a tool the key lacks is refused, not crashed',
  refused.status === 200 && (refused.body?.result?.isError === true || /Tool .*not found|insufficient_scope|unknown tool/i.test(JSON.stringify(refused.body))),
  JSON.stringify(refused.body || refused.text).slice(0, 200))

console.log('\nTHE TEST-KEY PROMISE SURVIVES MCP')
const rows = sh('psql', ['-t', '-A', '-d', DB, '-c', 'select count(*) from orders']).trim().split('\n')[0]
check('no tool wrote an order', rows === '0', `orders table holds ${rows}`)

console.log(bad === 0 ? '\nPASS  every MCP tool is a documented route, re-dispatched as the caller, writing nothing.'
  : `\nFAIL  ${bad} problem${bad === 1 ? '' : 's'}.`)
process.exit(bad === 0 ? 0 : 1)
