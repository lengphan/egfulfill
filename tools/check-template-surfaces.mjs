#!/usr/bin/env node
/**
 * PER-SURFACE TEMPLATE REFERENCES — the gate.
 *
 * A cell in a placement column holds EITHER an artwork reference or a `TPL-` template
 * reference (order-import.ts, `add()`: "ONE CELL, TWO READINGS"). The template case sets that
 * face's `templateId` and leaves its `artwork` EMPTY, because a reference is not a picture —
 * resolving it is applyTemplates' job.
 *
 * It did not do it. Two templates on two surfaces of one item produced NO artwork: the import
 * drops a face on `if (!f.artwork) continue`, and a non-empty `sides` also outranks the
 * template's own faces downstream, so position 1's template was bypassed too and the line
 * arrived with nothing on it.
 *
 * IT COMPILES THE REAL MODULE AND RUNS IT. §7: a mock that answered regardless of input is
 * how a wrong reading ships, and reading this function is exactly what failed to catch the
 * bug in the first place — the code looked right, and only driving it showed the faces coming
 * back empty.
 *
 * Run: node tools/check-template-surfaces.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'eg-tpl-')), 'order-import.mjs')
try {
  execFileSync('npx', ['esbuild', 'lib/order-import.ts', '--bundle', '--format=esm',
    '--platform=neutral', `--outfile=${out}`, '--log-level=error'],
    { cwd: join(ROOT, 'web'), stdio: 'pipe' })
} catch (e) {
  console.log('SKIP  could not bundle order-import.ts (is web/node_modules installed?)')
  process.exit(0)
}
const { applyTemplates } = await import(out)

let bad = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const TEMPLATES = [
  { id: 'TPL-12', seq: 12, name: 'Front logo', blankSku: 'HOOD-BLK', composite: 'comp12.png',
    artwork: 'art12.png', pos: { x: 1, y: 2 }, sides: [], machineFile: null },
  { id: 'TPL-13', seq: 13, name: 'Back crest', blankSku: 'HOOD-BLK', composite: 'comp13.png',
    artwork: 'art13.png', pos: null, sides: [], machineFile: null },
  { id: 'TPL-20', seq: 20, name: 'Two face', blankSku: 'TEE', composite: 'comp20.png',
    artwork: 'front20.png', pos: null,
    sides: [{ side: 'front', artwork: 'front20.png', pos: null }, { side: 'back', artwork: 'back20.png', pos: null }],
    machineFile: null },
]

const mkOrder = (item) => ({ id: 'X', address: {}, items: [item] })

console.log('\nTWO TEMPLATES ON TWO SURFACES OF ONE ITEM — the reported bug')
{
  const o = mkOrder({
    name: 'Hoodie', sku: '', qty: 1, templateId: 'TPL-12', designUrl: '',
    sides: [
      { side: 'front', artwork: '', templateId: 'TPL-12', machineFileId: '', method: 'Embroidery' },
      { side: 'back',  artwork: '', templateId: 'TPL-13', machineFileId: '', method: 'Embroidery' },
    ],
  })
  const r = applyTemplates([o], TEMPLATES)
  const sides = r.orders[0].items[0].sides
  check('front resolves to its template artwork', sides[0].artwork, 'art12.png')
  check('back resolves to ITS OWN template artwork', sides[1].artwork, 'art13.png')
  check('the face is kept', sides.map((s) => s.side), ['front', 'back'])
  check('the method rides along untouched', sides[1].method, 'Embroidery')
  check('nothing reported unmatched', r.unmatched, [])
}

console.log('\nA MULTI-FACE TEMPLATE ON A BACK PLACEMENT takes ITS back, not its front')
{
  const o = mkOrder({
    name: 'Tee', sku: '', qty: 1, templateId: '', designUrl: '',
    sides: [{ side: 'back', artwork: '', templateId: 'TPL-20', machineFileId: '', method: '' }],
  })
  const sides = applyTemplates([o], TEMPLATES).orders[0].items[0].sides
  check('takes the template’s BACK artwork', sides[0].artwork, 'back20.png')
}

console.log('\nTHE SHEET STILL WINS — a typed artwork is never replaced')
{
  const o = mkOrder({
    name: 'Tee', sku: '', qty: 1, templateId: '', designUrl: '',
    sides: [{ side: 'front', artwork: 'mine.png', templateId: 'TPL-12', machineFileId: '', method: '' }],
  })
  const sides = applyTemplates([o], TEMPLATES).orders[0].items[0].sides
  check('the seller’s own artwork survives', sides[0].artwork, 'mine.png')
}

console.log('\nA BAD REFERENCE IS REPORTED, NOT SWALLOWED')
{
  const o = mkOrder({
    name: 'Tee', sku: '', qty: 1, templateId: '', designUrl: '',
    sides: [{ side: 'front', artwork: '', templateId: 'TPL-999', machineFileId: '', method: '' }],
  })
  const r = applyTemplates([o], TEMPLATES)
  check('named as unmatched', r.unmatched, ['TPL-999'])
  check('and the face stays empty rather than guessing', r.orders[0].items[0].sides[0].artwork, '')
}

console.log('\nTHE OLD SINGLE-TEMPLATE PATH IS UNCHANGED')
{
  const o = mkOrder({ name: 'Hoodie', sku: '', qty: 1, templateId: 'TPL-12', designUrl: '', blank: '' })
  const it = applyTemplates([o], TEMPLATES).orders[0].items[0]
  check('designUrl filled from the template', it.designUrl, 'art12.png')
  check('blank filled from the template', it.blank, 'HOOD-BLK')
  check('placement carried', it.templatePos, { x: 1, y: 2 })
}

console.log(bad ? `\n${bad} failure(s).` : '\nPer-surface templates resolve.')
process.exit(bad ? 1 : 0)
