#!/usr/bin/env node
/**
 * THE LISTING-TEMPLATE GATE — real Postgres, real Fastify, two real sellers.
 *
 * A template is one seller's saved publish form. The thing worth a gate is not that it saves;
 * it is the BOUNDARY. `/api/listing_templates` is requireAuth — any signed-in seller — and
 * every row is addressed by an id that travels to the client, so the only thing standing
 * between one seller's templates and another's is that the owner is in the WHERE clause of
 * every query. That is exactly the shape that a refactor quietly loosens, and §6's permission
 * boundaries are product decisions rather than incidental.
 *
 * So the assertions are:
 *
 *   1  a saved template comes back to its owner
 *   2  it does NOT appear in another seller's list
 *   3  another seller cannot UPDATE it by guessing its id — and does not create one either
 *   4  another seller cannot DELETE it
 *   5  a team member sees and edits their OWNER's templates (same resolution as the wallet)
 *   6  unknown fields are dropped — a template cannot become a second product record, and
 *      an image is kept only as an https URL, never as the bytes
 *   7  updating by an id that is not yours 404s rather than silently inserting a new row
 *
 * Run: node tools/check-listing-templates.mjs
 * Needs a local Postgres (`pg_isready`). SKIPS with a clear message if there isn't one.
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

const DB = 'egfulfill_listing_tmpl_gate'
const PORT = 4141
const URL_ = `postgres://localhost:5432/${DB}`
const SECRET = 'listing-tmpl-gate-secret'

let jwt, pg
try { jwt = require('jsonwebtoken'); pg = require('pg') } catch {
  console.log('SKIP  server/node_modules is not installed — run `npm i` in server/ first.')
  process.exit(0)
}

try { sh('dropdb', ['--if-exists', '--force', DB]) } catch { /* nothing to drop */ }
sh('createdb', [DB])
sh('psql', ['-q', '-d', DB, '-f', join(ROOT, 'server/db/schema.sql')])

const mkUser = (email, role = 'seller') => sh('psql', ['-t', '-A', '-d', DB, '-c',
  `insert into users (email, password_hash, role, name) values ('${email}','x','${role}','${email}') returning id`])
  .trim().split('\n')[0].trim()

const ALICE = mkUser('alice@test.local')
const BOB = mkUser('bob@test.local')
const MATE = mkUser('mate@test.local')          // on Alice's team

const api = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, DATABASE_URL: URL_, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (process.env.GATE_DEBUG) { api.stdout.on('data', d => process.stderr.write(d)); api.stderr.on('data', d => process.stderr.write(d)) }
const API = `http://127.0.0.1:${PORT}`
const tok = (id, email) => jwt.sign({ sub: id, role: 'seller', email }, SECRET, { expiresIn: '1h' })
const T = { alice: tok(ALICE, 'alice@test.local'), bob: tok(BOB, 'bob@test.local'), mate: tok(MATE, 'mate@test.local') }
const db = new pg.Client({ connectionString: URL_ })

let bad = 0
const brief = (v) => { const s = JSON.stringify(v); return s == null ? String(v) : s.length <= 200 ? s : s.slice(0, 197) + '…' }
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n         got  ${brief(got)}\n         want ${brief(want)}`}`)
}
const call = async (who, path, init = {}) => {
  const r = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T[who], ...(init.headers || {}) },
  })
  let body = null
  try { body = await r.json() } catch { /* empty */ }
  return { status: r.status, body }
}

async function waitForApi() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${API}/health`)).ok) return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
async function waitForTable(name) {
  for (let i = 0; i < 60; i++) {
    const r = await db.query('select to_regclass($1) as t', [name]).catch(() => ({ rows: [{ t: null }] }))
    if (r.rows[0]?.t) return true
    await new Promise((res) => setTimeout(res, 100))
  }
  return false
}

function teardown() {
  try { api.kill('SIGKILL') } catch { /* already gone */ }
  try { sh('dropdb', ['--if-exists', '--force', DB]) } catch { /* the next run drops it */ }
}
process.on('exit', teardown)

if (!(await waitForApi())) {
  console.error('FAIL  the API never came up — that is §2.1, and it means every route is down, not just this one.')
  process.exit(1)
}
await db.connect()
/* §6: the table is created at ROUTE LOAD and not awaited, so /health answers before it
   exists. Waiting on the port alone made this flaky on a fresh database. */
if (!(await waitForTable('listing_templates'))) {
  console.error('FAIL  listing_templates never appeared — the route-load migration did not run.')
  process.exit(1)
}

/* Alice's team, so the member resolves to her as owner — the same shape the wallet uses.
 *
 * THE TABLE IS THE APP'S, AND WAITED FOR RATHER THAN DECLARED HERE. This used to create its
 * own `team_members` and then insert with `.catch(() => {})`, racing team.js's own route-load
 * CREATE — and when the insert lost that race the error was swallowed, the membership never
 * existed, and the two team assertions failed. Intermittently: measured at 1 run in 3 on
 * 2026-09-23, which is the worst possible frequency because it reads as a flaky suite rather
 * than a bug. A second definition of a table the app already owns is the same mistake as a
 * second copy of a rule; waitForTable is right there and was already used for the other one.
 *
 * The insert no longer swallows either. If the team fixture cannot be written, the two checks
 * that depend on it are meaningless and this should say so rather than report a failure whose
 * cause is three steps away. */
if (!(await waitForTable('team_members'))) {
  console.error('FAIL  team_members never appeared — team.js creates it at route load; nothing below about teams would mean anything.')
  process.exit(1)
}
await db.query(
  `insert into team_members (owner_id, user_id, email, status) values ($1,$2,$3,'active')`,
  [ALICE, MATE, 'mate@test.local'],
)

console.log('LISTING TEMPLATES')

// ── 1 · save and read back ──────────────────────────────────────────────────────────────
const DATA = {
  title: 'Embroidered Dad Hat',
  description: 'Stitched to order.',
  tags: ['hat', 'embroidered'],
  blank_sku: 'EG-600', blank_name: 'Chino Cap', method: 'EMB',
  colors: ['Black', 'Navy'], sizes: ['Adjustable'],
  price: 24.99, quantity: 999,
  size_prices: { Adjustable: 24.99, Bogus: 'not-a-number' },
  /* IMAGES ARE ALLOWED NOW (2026-09-23) — but only as https URLs. A `data:` URL is still
     refused: one photo's bytes exceed the row's entire 64KB budget. This one is dropped for
     its SCHEME, not for its field name, which is what the check below now asserts. */
  images: ['data:image/png;base64,AAAA'],
  supplier: 'SanMar',
}
const made = await call('alice', '/api/listing_templates', {
  method: 'POST', body: JSON.stringify({ name: 'Hat — embroidered', data: DATA }),
})
check('alice saves a template', made.status, 200)
const ID = made.body?.id
check('…and it has an id', typeof ID === 'string' && ID.startsWith('lt-'), true)

const mine = await call('alice', '/api/listing_templates')
check('alice sees it in her list', (mine.body ?? []).map((t) => t.id), [ID])
check('…with its name', mine.body?.[0]?.name, 'Hat — embroidered')

// ── 6 · the allow-list holds ────────────────────────────────────────────────────────────
const saved = mine.body?.[0]?.data ?? {}
check('a data: photo is dropped even though images are allowed', 'images' in saved, false)
check('an unknown field was dropped', 'supplier' in saved, false)
check('the words survived', [saved.title, saved.description], ['Embroidered Dad Hat', 'Stitched to order.'])
check('the variants survived', [saved.colors, saved.sizes], [['Black', 'Navy'], ['Adjustable']])
check('pricing survived', [saved.price, saved.size_prices], [24.99, { Adjustable: 24.99 }])

// ── 2 · another seller cannot SEE it ────────────────────────────────────────────────────
const bobList = await call('bob', '/api/listing_templates')
check("bob's list does not contain alice's template", (bobList.body ?? []).length, 0)

// ── 3/7 · another seller cannot UPDATE it, and does not create one by trying ────────────
const bobUpdate = await call('bob', '/api/listing_templates', {
  method: 'POST', body: JSON.stringify({ id: ID, name: 'stolen', data: { title: 'stolen' } }),
})
check('bob updating alice’s template is refused', bobUpdate.status, 404)
const bobAfter = await call('bob', '/api/listing_templates')
check('…and no row was created for bob instead', (bobAfter.body ?? []).length, 0)
const aliceAfter = await call('alice', '/api/listing_templates')
check('…and alice’s is untouched', aliceAfter.body?.[0]?.name, 'Hat — embroidered')

// ── 4 · another seller cannot DELETE it ─────────────────────────────────────────────────
const bobDel = await call('bob', `/api/listing_templates/${ID}`, { method: 'DELETE' })
check('bob deleting alice’s template is refused', bobDel.status, 404)
const stillThere = await db.query('select count(*)::int n from listing_templates where id=$1', [ID])
check('…and the row is still there', stillThere.rows[0].n, 1)

// ── 5 · a team member shares the owner's templates ──────────────────────────────────────
const mateList = await call('mate', '/api/listing_templates')
check("alice’s teammate sees her template", (mateList.body ?? []).map((t) => t.id), [ID])
const mateEdit = await call('mate', '/api/listing_templates', {
  method: 'POST', body: JSON.stringify({ id: ID, name: 'Hat — embroidered v2', data: DATA }),
})
check('…and can edit it', [mateEdit.status, mateEdit.body?.name], [200, 'Hat — embroidered v2'])
const oneRow = await db.query('select count(*)::int n from listing_templates')
check('…without creating a second row', oneRow.rows[0].n, 1)

// ── a name is required ──────────────────────────────────────────────────────────────────
const noName = await call('alice', '/api/listing_templates', {
  method: 'POST', body: JSON.stringify({ name: '   ', data: DATA }),
})
check('a template with no name is refused', noName.status, 400)

// ── boilerplate images: a URL round-trips, the bytes never do ───────────────────────────
/**
 * A template may now carry the photos a seller puts on EVERY listing — a size chart, a care
 * card. Two things have to hold, and the second is the one with teeth:
 *
 *   an https URL survives the round trip, because that is the whole feature;
 *   a `data:` or `blob:` URL does NOT, because one photo's bytes exceed the row's entire
 *   64KB budget and a blob: is dead the moment the tab that made it closes. The allow-list's
 *   own note names "the next one that turns out to be a data: URL" as the thing it exists to
 *   stop, so this is that note, executed.
 */
const IMGS = await call('alice', '/api/listing_templates', {
  method: 'POST',
  body: JSON.stringify({
    name: 'With boilerplate',
    data: {
      ...DATA,
      images: [
        'https://cdn.example.com/size-chart.png',
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
        'blob:https://app.egful.store/9f2c-dead-beef',
        'https://cdn.example.com/care-card.jpg',
      ],
    },
  }),
})
check('a template with images is saved', IMGS.status, 200)
check('https URLs round-trip', IMGS.body?.data?.images,
  ['https://cdn.example.com/size-chart.png', 'https://cdn.example.com/care-card.jpg'])
check('a data: URL is dropped, not stored',
  (IMGS.body?.data?.images ?? []).some((u) => String(u).startsWith('data:')), false)
check('a blob: URL is dropped too',
  (IMGS.body?.data?.images ?? []).some((u) => String(u).startsWith('blob:')), false)
/* AND IT IS STILL SOMEBODY'S. The images are the newest thing on this row, so they are the
   newest thing that could leak across the boundary this whole gate is about. */
const bobSees = await call('bob', '/api/listing_templates')
check("bob cannot see alice's image template", (bobSees.body ?? []).length, 0)
await call('alice', `/api/listing_templates/${IMGS.body?.id}`, { method: 'DELETE' })

// ── delete, by the owner ────────────────────────────────────────────────────────────────
const del = await call('alice', `/api/listing_templates/${ID}`, { method: 'DELETE' })
check('alice can delete her own', del.status, 200)
const gone = await call('alice', '/api/listing_templates')
check('…and it is gone', (gone.body ?? []).length, 0)

console.log(bad === 0
  ? '\nFLOOR  ok — a template is saved, shared with the team, and reachable by nobody else.'
  : `\nFLOOR  ${bad} failing — one seller can reach another seller’s templates.`)
process.exit(bad === 0 ? 0 : 1)
