/**
 * DRIFT GUARD for the order rules.
 *
 * The stage vocabulary, the open/closed test and the lateness rule exist in three places:
 * server/src/routes/orders.js, web/lib/*, and mobile/lib/orders.ts. In one day that
 * produced three silent divergences — `awaiting_scan` folded to a retired stage, shipped
 * orders counted as late forever, on-hold orders counted as open. None failed loudly.
 *
 * web/shared/order-rules.ts is the spec. This runs the REAL web and mobile implementations —
 * compiled, then called — against it. Reading the files and comparing them by eye is what
 * let the drift in; this executes them.
 *
 *   node tools/check-order-rules.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const out = mkdtempSync(path.join(tmpdir(), 'orderrules-'))
const fail = []

/* The REPO ROOT has no typescript — `npx tsc` there prints "This is not the tsc command you
   are looking for" and exits 1, which is why this guard could never actually run. Use the
   compiler web/ already depends on, by path. */
const TSC = path.join(ROOT, 'web', 'node_modules', '.bin', 'tsc')

const run = (args, cwd, what) => {
  try {
    execFileSync(TSC, args, { cwd, stdio: 'pipe' })
  } catch (e) {
    // tsc reports on STDOUT. Surfacing it beats a 500-byte Buffer dump in a stack trace.
    throw new Error(`could not compile ${what}:\n${String(e.stdout || e.stderr || e.message)}`)
  }
}

/** A file with no imports — compile it where it stands. */
function compile(file) {
  run([file, '--outDir', out, '--module', 'commonjs', '--target', 'es2020',
       '--skipLibCheck', '--esModuleInterop'], ROOT, file)
  return path.join(out, path.basename(file).replace(/\.ts$/, '.js'))
}

/**
 * A file inside a PROJECT, compiled with that project's real path aliases.
 *
 * mobile/lib/orders.ts resolves `@shared/*` and `@/*` through paths in mobile/tsconfig.json,
 * and the tsc CLI has no --paths flag — compiling the bare file just reports TS2307 for both.
 *
 * The aliases are READ OUT of the app's own tsconfig rather than restated here, so a moved
 * shared file cannot make this guard quietly stop checking the thing it is for. The rest of
 * that config is NOT inherited: expo/tsconfig.base sets `moduleResolution: bundler` and
 * `customConditions`, and tsc refuses both alongside the commonjs output require() needs.
 * Nothing about this throwaway build changes how the app itself is compiled.
 */
function compileIn(dir, entry, outSub) {
  const dest = path.join(out, outSub)
  const appCfg = JSON.parse(
    readFileSync(path.join(ROOT, dir, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  )
  const cfg = path.join(ROOT, dir, '.tsconfig-drift-check.json')
  writeFileSync(cfg, JSON.stringify({
    compilerOptions: {
      outDir: dest, module: 'commonjs', target: 'es2020', moduleResolution: 'node',
      baseUrl: '.', paths: appCfg.compilerOptions?.paths ?? {},
      skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true,
      jsx: 'react-jsx', resolveJsonModule: true, strict: false, noEmitOnError: false,
    },
    include: [entry],
  }))
  try {
    run(['--project', cfg], path.join(ROOT, dir), `${dir}/${entry}`)
  } finally {
    rmSync(cfg, { force: true })
  }
  /* tsc puts output under the COMMON ROOT of everything it compiled, and orders.ts imports
     web/shared/order-rules.ts — one level above mobile/ — so that root is the repo, not the
     app. Rather than predict the layout, find the emitted file. */
  const hit = findFile(dest, path.basename(entry).replace(/\.ts$/, '.js'))
  if (!hit) throw new Error(`compiled ${dir}/${entry} but found no output under ${dest}`)
  return hit
}

/** Depth-first search for an emitted file by name. */
function findFile(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { const hit = findFile(full, name); if (hit) return hit }
    else if (e.name === name) return full
  }
  return null
}

const { createRequire, default: Module } = await import('node:module')
const require = createRequire(import.meta.url)

const specPath = compile('web/shared/order-rules.ts')
const spec = require(specPath)

/*
 * tsc DOES NOT REWRITE PATH ALIASES in the JS it emits — `@shared/order-rules` survives
 * verbatim into the output and node cannot resolve it. A bundler does this rewriting in the
 * real app; here we do the same job with a resolve hook, so the compiled mobile module loads
 * the SAME shared file the app would load rather than a stand-in written for the test.
 */
const ALIAS = { '@shared/order-rules': specPath }
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  return ALIAS[request] ?? resolve.call(this, request, ...rest)
}
const mob = require(compileIn('mobile', 'lib/orders.ts', 'mobile'))

// Every value the server's normalizeStage can be handed, including the retired vocabulary.
const STAGES = ['', 'new', 'draft', 'pending', 'in_review', 'approved', 'working', 'shipped',
  'on_hold', 'cancelled', 'refunded', 'awaiting_scan', 'packed', 'printed', 'qc', 'queued',
  'delivered', 'fulfilled', 'in_transit', 'flagged', 'escalated', 'backorder', 'nonsense']

/** `other` names which implementation the second value came from — the report said "mobile"
 *  for every check, including the server ones, which is a confusing thing for a drift report
 *  to be wrong about. */
const check = (name, a, b, ctx, other = 'mobile') => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    fail.push(`${name}(${ctx}) — shared=${JSON.stringify(a)} ${other}=${JSON.stringify(b)}`)
}

for (const s of STAGES) {
  check('normalizeStage', spec.normalizeStage(s), mob.normalizeStage(s), JSON.stringify(s))
  check('nextStage', spec.nextStage(s), mob.nextStage({ id: 'x', factory_status: s }), JSON.stringify(s))
  check('isOpen', spec.isOpenStage(spec.normalizeStage(s)), mob.isOpen({ id: 'x', factory_status: s }), JSON.stringify(s))
  check('stageLabel', spec.STAGE_LABEL[spec.normalizeStage(s)] ?? '',
        mob.stageLabel({ id: 'x', factory_status: s }), JSON.stringify(s))
}

// Lateness: a promise date, an age, and a closed order that must never be late.
const DAY = 86_400_000
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
for (const s of ['', 'working', 'shipped', 'on_hold', 'cancelled']) {
  for (const o of [
    { factory_status: s, ship_by: iso(now - DAY) },
    { factory_status: s, ship_by: iso(now + DAY) },
    { factory_status: s, created_at: iso(now - 30 * DAY) },
    { factory_status: s, created_at: iso(now - DAY) },
    { factory_status: s },
  ]) {
    check('isOverdue', spec.isOverdueBy(o, 10, now), mob.isOverdue({ id: 'x', ...o }, 10), `${s} ${JSON.stringify(o)}`)
  }
}

// Naming, and pieces.
for (const [seq, id] of [[null, 'etsy-4148231554'], [1234, 'FF-1234'], [null, 'FF-9'], [null, 'tiktok-abc']]) {
  check('numOf', spec.numOfIds(seq, id), mob.numOf({ id, seq }), `${seq} ${id}`)
  check('platformOf', spec.platformFromId(id), mob.platformOf({ id }), id)
}
for (const items of [[], [{ qty: 2 }], [{ qty: null }, { qty: 3 }], [{}, {}]]) {
  check('units', spec.unitsOfItems(items), mob.units({ id: 'x', items }), JSON.stringify(items))
}

/*
 * THE SERVER'S OWN GATE, EXECUTED.
 *
 * This is the pair that matters. stageDenial() in server/src/routes/orders.js is the only
 * implementation that can actually REFUSE a move; the shared one exists so a control can be
 * greyed with its reason instead of being pressed and failing. Two implementations, on
 * purpose — so they have to be checked by running them, which is what CLAUDE.md means by
 * "diff by EXECUTING all three".
 *
 * Importing the route module is enough to reach it: registration is lazy and nothing here
 * touches the pool, so no database is involved.
 */
const srv = await import('../server/src/routes/orders.js')

const ROLES = ['admin', 'warehouse', 'operator', 'designer', 'seller', '']
const TARGETS = ['', 'in_review', 'approved', 'working', 'shipped', 'on_hold', 'cancelled', 'refunded']
let gateCases = 0

for (const s of STAGES) {
  check('normalizeStage', spec.normalizeStage(s), srv.normalizeStage(s), JSON.stringify(s), 'server')
}

for (const role of ROLES) {
  for (const at of STAGES) {
    for (const to of TARGETS) {
      for (const isFactory of [false, true]) {
        gateCases++
        // The server returns a string or null; so does the shared one. Compare the SENTENCE,
        // not just allowed-vs-refused: a gate that refuses for the wrong stated reason sends
        // someone to the wrong colleague, which is its own kind of wrong.
        check('stageDenial', spec.stageDenialReason(role, at, to, isFactory),
              srv.stageDenial(role, at, to, isFactory) ?? null,
              `role=${role || '(none)'} ${JSON.stringify(at)}->${JSON.stringify(to)}${isFactory ? ' factory' : ''}`,
              'server')
      }
    }
  }
}

rmSync(out, { recursive: true, force: true })
if (fail.length) {
  console.error(`ORDER RULES HAVE DRIFTED — ${fail.length} disagreement(s):\n` + fail.map((f) => '  ' + f).join('\n'))
  process.exit(1)
}
console.log('order rules agree —',
  `mobile matches web/shared/order-rules.ts across ${STAGES.length} stages, 25 lateness cases,`,
  `naming and piece counts; the server's own stageDenial() matches it across ${gateCases}`,
  'role x stage x target cases.')
