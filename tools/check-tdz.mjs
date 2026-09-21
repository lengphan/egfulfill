#!/usr/bin/env node
/**
 * A VALUE READ BEFORE IT IS DECLARED — the crash that reads as the site being down.
 *
 * 2026-09-21. The order page rendered as "This page couldn't load" for every order carrying a
 * design fee. The cause was four words of ordering in orders/[id]/page.tsx:
 *
 *     const ownFees = (designFees?.items ?? [])
 *       .filter((f) => { const c = feeCovers(f); return c.length === 1 && c[0] === n })   // n
 *       .reduce(...)
 *     ...seventeen lines...
 *     const n = items.findIndex(...) + 1                                                  // n
 *
 * `n` is read inside the filter callback before `const n` runs, so the callback hits the
 * temporal dead zone and throws `Cannot access 'n' before initialization`. The whole page
 * became the error boundary, which is indistinguishable from an outage — and it was reported
 * as one.
 *
 * WHY NOTHING CAUGHT IT, which is the only reason this file exists:
 *
 *   tsc catches the DIRECT shape and raises TS2448 ("Block-scoped variable used before its
 *   declaration"). It deliberately does NOT catch the callback shape, because it cannot know
 *   when a callback runs — passing one to `.filter` is legal whatever it closes over.
 *   Measured, not assumed: `const bad = n + 1` before `const n` is TS2448; the same reference
 *   moved inside `items.filter(x => x === n)` compiles clean under --strict.
 *
 *   So `npx tsc --noEmit` was clean, `npx eslint` was clean, `next build` succeeded, and the
 *   page threw on first render. Every gate this repo has said yes.
 *
 * WHAT THIS CHECKS. ESLint's `no-use-before-define` DOES see the callback shape. Run with the
 * project config plus that one rule (web/eslint.tdz.mjs) and compare against a baseline.
 *
 *   FLOOR — the count may not RISE. A new one is a new crash of exactly this kind, and it
 *           fails the gate.
 *   WATCH — the 65 standing on 2026-09-21 are printed, never failed. Most are safe: a
 *           `setState` referenced inside a click handler runs long after the component body
 *           finished, and a module `const` read inside a function nobody calls at import time
 *           is initialised by the time it is. A gate cannot tell those from a render-time read,
 *           and pretending otherwise is how a gate becomes decorative.
 *
 * SO: THE DANGEROUS ONES ARE THE ONES EVALUATED DURING RENDER — inside a `.map`/`.filter`/
 * `.reduce` in a component body, or straight-line code in a module. If you are lowering the
 * baseline, start there; a deferred handler can wait.
 *
 * Run:  node tools/check-tdz.mjs            (report)
 *       node tools/check-tdz.mjs --strict   (exit 1 if the count has risen)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const WEB = join(dirname(dirname(fileURLToPath(import.meta.url))), 'web')

/**
 * The count on 2026-09-21, the day the gate was written, with the order-page crash already
 * fixed — so it is a baseline of things that have NOT been shown to be bugs, not a tolerance
 * for the bug itself. Lower it when you fix one; never raise it to make the gate pass.
 */
const BASELINE = 65

const DIRS = ['app', 'components', 'lib']
const OUT = join(WEB, 'tdz.json')   // eslint -f json -o needs a path inside the project

function run() {
  try {
    execFileSync('npx', ['eslint', '--config', 'eslint.tdz.mjs', ...DIRS, '-f', 'json', '-o', OUT],
      { cwd: WEB, stdio: 'pipe' })
  } catch {
    /* eslint exits non-zero when it reports errors — which is the normal case here. The
       report is still written, and an actual crash shows up as a missing file below. */
  }
  if (!existsSync(OUT)) {
    console.error('check-tdz: eslint produced no report — is web/node_modules installed?')
    process.exit(2)
  }
  const report = JSON.parse(readFileSync(OUT, 'utf8'))
  unlinkSync(OUT)
  return report.flatMap((f) =>
    f.messages
      .filter((m) => (m.ruleId || '').endsWith('no-use-before-define'))
      .map((m) => ({ file: f.filePath.split('/web/').pop(), line: m.line, msg: m.message })))
}

const hits = run()
const strict = process.argv.includes('--strict')

/* A setState referenced inside a handler is the overwhelmingly common safe case, and calling
   it out separately is what keeps the real number legible. It is a HINT in the printout, not
   a filter on the count — a setter read during render would still be a crash. */
const deferred = hits.filter((h) => /'set[A-Z]/.test(h.msg))
const rest = hits.filter((h) => !/'set[A-Z]/.test(h.msg))

console.log(`WATCH  ${hits.length} use-before-define (baseline ${BASELINE})`)
console.log(`       ${deferred.length} are a setState, which almost always runs after the body\n`)
for (const h of rest) console.log(`  ${h.file}:${h.line}  ${h.msg}`)

if (hits.length > BASELINE) {
  console.error(`\nFLOOR  FAILED — ${hits.length} > ${BASELINE}.`)
  console.error('       A value is read before its `const` runs. If that read happens during')
  console.error('       render, the page throws and shows the error boundary — which reads as')
  console.error('       the site being down. Move the declaration above the use.')
  process.exit(strict ? 1 : 0)
}
if (hits.length < BASELINE) {
  console.log(`\nFLOOR  ok — and it FELL to ${hits.length}. Lower BASELINE in this file to hold the gain.`)
} else {
  console.log('\nFLOOR  ok — nothing new.')
}
