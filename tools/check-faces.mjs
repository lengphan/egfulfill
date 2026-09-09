#!/usr/bin/env node
/**
 * DRIFT GUARD for "which faces does this blank print on".
 *
 * One question. Four surfaces answered it four different ways, and every one of them was
 * behaving exactly as written:
 *
 *   product page      sidesOf()               → Front, Back
 *   import sheet      its own inline copy     → the same, re-derived
 *   mini designer     a padded [front, back, left, right], product ignored
 *   design maker      designFaces(), which DROPPED any face with no picture
 *
 * So one duffel offered two placements on its product page, four in the mini designer and,
 * because only three of Apparel's faces had a category outline, three in the design maker.
 * Artwork could be placed on a face the price never charged for, and a face the product
 * genuinely had could vanish for want of a photograph nobody had uploaded.
 *
 * TWO RULES CAME OUT OF IT, and this file exists to keep them:
 *
 *   1. WHICH FACES EXIST IS POLICY, and there is one function for it — `offeredSides`: the
 *      product's own ticks, else its configured type, else null for "we have not been told".
 *   2. WHETHER WE HAVE A PICTURE OF A FACE IS A SEPARATE QUESTION. A declared face with no
 *      photo borrows one; it is never dropped. Conflating the two is what produced three of
 *      the four wrong answers above.
 *
 * The gate has two halves, and the second is the one that prevents recurrence:
 *
 *   EXECUTE  compile variant-resolve and drive it against the products that actually broke.
 *   DRIFT    grep the app for a surface computing faces for itself instead of asking. Every
 *            one of the four disagreements began as a local re-derivation that looked
 *            reasonable in its own file.
 *
 *   node tools/check-faces.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const TSC = path.join(ROOT, 'web', 'node_modules', '.bin', 'tsc')
const out = mkdtempSync(path.join(tmpdir(), 'faces-'))

let failed = 0
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`)
}

// ── EXECUTE ────────────────────────────────────────────────────────────────────────────
const cfg = path.join(ROOT, 'web', '.tsconfig-faces-check.json')
/* The app's OWN `paths`, or tsc cannot resolve `@/lib/print-method` and therefore emits
   nothing for it — the entry compiles and then fails to load, which looks like a broken
   gate rather than a missing alias. Same reason check-blank-resolve reads them. */
const appCfg = JSON.parse(
  readFileSync(path.join(ROOT, 'web', 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
)
writeFileSync(cfg, JSON.stringify({
  compilerOptions: {
    outDir: out, module: 'commonjs', target: 'es2020', moduleResolution: 'node',
    baseUrl: '.', paths: appCfg.compilerOptions?.paths ?? {},
    skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true,
    strict: false, noEmitOnError: false,
  },
  include: ['lib/variant-resolve.ts'],
}))
try { execFileSync(TSC, ['--project', cfg], { cwd: path.join(ROOT, 'web'), stdio: 'pipe' }) }
catch { /* noEmitOnError:false — what matters is whether the module came out, checked next */ }
finally { rmSync(cfg, { force: true }) }

function findFile(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { const hit = findFile(full, name); if (hit) return hit }
    else if (e.name === name) return full
  }
  return null
}

/* tsc DOES NOT REWRITE PATH ALIASES in what it emits — `@/lib/print-method` survives verbatim
   into the output and node cannot resolve it. The bundler does that job in the real app; a
   resolve hook does it here, pointing at the modules tsc just emitted, so this drives the
   SAME code the app runs rather than a stand-in written for the test. Same approach as
   tools/check-blank-resolve.mjs. */
const { createRequire, default: Module } = await import('node:module')
const require = createRequire(import.meta.url)
const built = findFile(out, 'variant-resolve.js')
if (!built) { console.error('\ncould not build web/lib/variant-resolve.ts\n'); process.exit(1) }
const resolveFn = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    const hit = findFile(out, path.basename(request) + '.js')
    if (hit) return hit
  }
  return resolveFn.call(this, request, ...rest)
}
let VR
try { VR = require(built) } catch (e) {
  console.error(`\ncould not load the compiled variant-resolve — ${e.message}\n`)
  process.exit(1)
}
const { offeredSides, designFaces, setTypeMockups } = VR

/* The categories as a real install has them: Apparel is the broad six, and its outlines
   only exist for three of those — which is exactly how the crewneck lost half its faces. */
setTypeMockups([
  { name: 'Apparel', sides: ['front', 'back', 'left', 'right', 'sleeve', 'hood'],
    mockups: { front: '/t/front.png', back: '/t/back.png', left: '/t/left.png' } },
  { name: 'Bags', sides: ['front', 'back'], mockups: {} },
])

console.log('\nEXECUTE — the products that actually broke\n')

/* THE DUFFEL. Filed under Apparel once, so it still carries per-side photos for a sleeve
   and a hood; corrected to Bags and ticked Front + Back. */
const duffel = {
  id: '108084', type: 'Bags', sides: ['front', 'back'], img: '/p/front.jpg',
  side_mockups: { back: '/p/back.jpg', sleeve: '/p/sleeve.jpg', hood: '/p/hood.jpg' },
}
is('the duffel offers what it ticked', designFaces(duffel).map((f) => f.side), ['front', 'back'])
is('a leftover sleeve photo is not a surface', designFaces(duffel).some((f) => f.side === 'sleeve'), false)
is('re-ticking sleeve brings it back',
  designFaces({ ...duffel, sides: ['front', 'back', 'sleeve'] }).map((f) => f.side),
  ['front', 'back', 'sleeve'])

/* THE SAME DUFFEL WITH ONE PHOTOGRAPH. The design maker hides its strip below two faces,
   so dropping the unphotographed back showed NO positions at all for a two-face product. */
const bare = { id: '108085', type: 'Bags', sides: ['front', 'back'], img: '/p/front.jpg' }
is('a declared face survives having no photo', designFaces(bare).map((f) => f.side), ['front', 'back'])
is('...and borrows the front', designFaces(bare).map((f) => f.url), ['/p/front.jpg', '/p/front.jpg'])

/* THE CREWNECK. Apparel's six, but only three category outlines — it showed three. */
const crew = { id: '18000', type: 'Apparel', img: '/p/crew.jpg' }
is('every configured face is offered, photographed or not',
  designFaces(crew).map((f) => f.side), ['front', 'back', 'left', 'right', 'sleeve', 'hood'])
is('a face with an outline uses it, not the borrowed front',
  designFaces(crew).find((f) => f.side === 'back').url, '/t/back.png')
is('a face with neither borrows the front',
  designFaces(crew).find((f) => f.side === 'hood').url, '/p/crew.jpg')

/* POLICY, on its own. */
is('ticks beat the category', offeredSides(duffel), ['front', 'back'])
is('no ticks follows the category', offeredSides(crew), ['front', 'back', 'left', 'right', 'sleeve', 'hood'])
is('an unconfigured category says nothing', offeredSides({ id: 'x', type: 'Luggage' }), null)
is('...but a ticked product under it still wins',
  offeredSides({ id: 'x', type: 'Luggage', sides: ['front'] }), ['front'])
is('an unknown face is refused', offeredSides({ id: 'x', type: 'Bags', sides: ['front', 'roof'] }), ['front'])

// ── DRIFT ──────────────────────────────────────────────────────────────────────────────
/**
 * Who is allowed to touch the raw material. Everyone else must ASK.
 *
 *   variant-resolve      owns both rules
 *   product-editor       edits the per-side photo map and the ticks — it is the source
 *   catalog/api types    declare the fields
 */
const OWNERS = [
  'web/lib/variant-resolve.ts',
  'web/components/app/product-editor-dialog.tsx',
  'web/lib/api.ts',
]
/**
 * ALLOWED, each for a stated reason — and the reason always has the same shape: this code
 * is not deciding WHICH FACES A PRODUCT HAS. A blanket skip would make the gate decorative,
 * so anything added here has to say why it is not the bug.
 */
const ALLOWED = new Map([
  ['web/app/(app)/products/[id]/page.tsx',
   'galleryOf excludes print outlines from the photo gallery — it is filtering pictures, not offering placements'],
  ['web/app/(marketing)/preview/placement/page.tsx',
   'a fixture product declaring its own sides; that is data under test, not a rule'],
  ['web/components/app/design-files-panel.tsx',
   'SIDE_ORDER sorts the files already attached to a line — it never decides what may be attached'],
  ['web/components/app/line-downloads.tsx',
   'same: an ordering for downloads that exist, not a list of surfaces on offer'],
])
/** A surface deciding for itself which faces a product has. */
const SMELLS = [
  { re: /\bside_mockups\b|\bsideMockups\b/, why: 'reads the per-side photo map directly — ask designFaces()' },
  { re: /\[\s*["']front["']\s*,\s*["']back["']\s*,\s*["']left["']/, why: 'hardcodes a standard face list — ask offeredSides()' },
]
const SKIP = /(\.next|node_modules|\.test\.|__)/

const files = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    if (SKIP.test(p)) continue
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(p)) files.push(p)
  }
})(path.join(ROOT, 'web'))

console.log('\nDRIFT — surfaces deciding faces for themselves\n')
const drift = []
for (const f of files) {
  const rel = path.relative(ROOT, f)
  if (OWNERS.includes(rel) || ALLOWED.has(rel)) continue
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return          // a comment describing the rule is not a copy of it
    for (const s of SMELLS) if (s.re.test(line)) drift.push({ rel, line: i + 1, why: s.why, text: line.trim().slice(0, 90) })
  })
}
if (!drift.length) console.log('  ok    nothing re-derives the face list')
for (const [f, why] of ALLOWED) console.log(`  --    ${f}\n          allowed: ${why}`)
for (const d of drift) { failed++; console.log(`  FAIL  ${d.rel}:${d.line} — ${d.why}\n          ${d.text}`) }

rmSync(out, { recursive: true, force: true })
console.log(failed ? `\n${failed} failed\n` : '\nall passed\n')
process.exit(failed ? 1 : 0)
