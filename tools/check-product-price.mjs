#!/usr/bin/env node
/**
 * THE PRODUCT PAGES QUOTE WHAT THE INVOICE CHARGES — executed, both sides, no mocks.
 *
 * Almost every surface that states a per-face price reads the SERVER's answer and so cannot
 * drift. Two cannot: the product detail page and the public product page price a product
 * BEFORE anyone orders it, so there is no quote to read and they must compute.
 *
 * Both did, separately, and both went stale. Measured on 2026-09-23 by running pricing.js
 * against each of them: one embroidered hoodie printed front, back and sleeve was quoted
 * $30.00 publicly and $33.00 in the app against an invoice of $39.00. The drift ran both
 * ways — a second DTG face was OVER-quoted, because the older rules charged a placement for
 * a machine run the invoice gives away free.
 *
 * web/lib/product-price.ts is now the single client-side definition. This gate is the thing
 * that makes it safe: it EXECUTES that module and the real `priceLines` over the same matrix
 * and fails on any disagreement. A second implementation that is gated is a different animal
 * from one that is not — this rule moved three times in a week.
 *
 *   node tools/check-product-price.mjs
 *
 * No database: priceLines takes its catalogue and fee table as arguments.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
/* The repo root has no typescript — `npx tsc` there prints "This is not the tsc command you
   are looking for" and exits 0, which would make this gate pass by doing nothing. */
const TSC = path.join(ROOT, 'web', 'node_modules', '.bin', 'tsc')
const SRC = path.join(ROOT, 'web', 'lib', 'product-price.ts')

const out = mkdtempSync(path.join(tmpdir(), 'egf-price-'))
let client
try {
  /* product-price.ts has NO imports on purpose, so it compiles where it stands.

     A TSCONFIG, NOT FLAGS. `"types": []` is what keeps @types/node out, and it has no CLI
     spelling — `--types` demands an argument. Left in, @types/node is picked up ambiently
     from web/node_modules and its own internal `undici-types` import fails to resolve, so
     the compile dies and the gate reports a drift it never measured. A price gate that
     cannot compile is a price gate that never runs. */
  const cfg = path.join(out, 'tsconfig.json')
  writeFileSync(cfg, JSON.stringify({
    compilerOptions: {
      outDir: out, module: 'es2022', target: 'es2022', moduleResolution: 'bundler',
      skipLibCheck: true, types: [], strict: true,
    },
    files: [SRC],
  }))
  execFileSync(TSC, ['-p', cfg], { stdio: 'pipe' })
  client = await import(pathToFileURL(path.join(out, 'product-price.js')).href)
} catch (e) {
  console.error('FAIL  could not compile web/lib/product-price.ts\n' + (e.stdout?.toString() || e.message))
  rmSync(out, { recursive: true, force: true })
  process.exit(1)
}
const { priceLines } = await import(pathToFileURL(path.join(ROOT, 'server/src/pricing.js')).href)

let pass = 0
const fails = []
const usd = (n) => '$' + Number(n).toFixed(2)
const money = (n) => Math.round(Number(n) * 100) / 100

/**
 * ONE CASE, PRICED TWICE. The server is driven through priceLines exactly as quoteOrder
 * drives it; the client through productUnitPrice exactly as a product page would.
 */
function compare(label, { data, fees, size, method, faces }) {
  const row = { id: 1, sku: 'EG-T', base_price: data.basePrice, data: { sku: 'EG-T', ...data } }
  const idx = { exact: new Map([['EG-T', row]]), rows: [row] }
  const withMethods = faces.map((f) => ({ side: f, method }))
  const line = priceLines([{ id: 1, sku: 'EG-T', qty: 1, size, print_type: method }], idx, fees, () => withMethods).lines[0]
  const server = Number(line.unitCost)

  /* The blank the page starts from is the size's own price, else the base — the same ladder
     costPartsOf walks. Read it back off the quote so this gate is not a third opinion about
     which number the garment costs. */
  const parts = line.sideParts?.parts ?? []
  const sideTotal = parts.reduce((a, p) => a + (Number(p.amount) || 0), 0)
  const blank = server - (Number(line.methodFee) || 0) - sideTotal

  const got = client.productUnitPrice({
    blank,
    printType: method,
    faces,
    product: { sidePrice: data.sidePrice, methodPrices: data.methodPrices },
    fees: {
      sideFee: fees.method_side,
      sideFees: Object.fromEntries(Object.entries(fees).filter(([k]) => k.startsWith('side_')).map(([k, v]) => [k.slice(5), v])),
      sideMethodFees: Object.fromEntries(Object.entries(fees).filter(([k]) => k.startsWith('side_')).map(([k, v]) => [k.slice(5), v])),
      methods: Object.fromEntries(Object.entries(fees).filter(([k]) => k.startsWith('method_') && k !== 'method_side').map(([k, v]) => [k.slice(7), v])),
    },
  })

  const show = parts.map((p) => `${p.face} ${p.kind} ${usd(p.amount)}`).join(' · ')
  if (Math.abs(got - server) >= 0.005) {
    fails.push({ label, server, got, parts: show }); return
  }
  /**
   * AND THE PARTS, NOT ONLY THE TOTAL. Two wrong figures can sum to the right one — a
   * placement quoted on the back and a run dropped from the front cancel exactly — and the
   * summary prints the parts, so a total-only check would pass a card that reads wrong line
   * by line. This also pins `kind`, which is what tells a placement from a run.
   */
  const mine = client.facePartsFor(faces, method, { sidePrice: data.sidePrice, methodPrices: data.methodPrices }, {
    sideFee: fees.method_side,
    sideFees: Object.fromEntries(Object.entries(fees).filter(([k]) => k.startsWith('side_')).map(([k, v]) => [k.slice(5), v])),
    sideMethodFees: Object.fromEntries(Object.entries(fees).filter(([k]) => k.startsWith('side_')).map(([k, v]) => [k.slice(5), v])),
    methods: Object.fromEntries(Object.entries(fees).filter(([k]) => k.startsWith('method_') && k !== 'method_side').map(([k, v]) => [k.slice(7), v])),
  })
  const theirs = parts.map((p) => `${p.face}/${p.kind}/${money(p.amount)}`).join('|')
  const ours = mine.map((p) => `${p.face}/${p.kind}/${money(p.amount)}`).join('|')
  if (theirs !== ours) {
    fails.push({ label: label + '  [parts]', server, got, parts: `server ${theirs}   page ${ours}` }); return
  }
  pass++
}

/* ── the fee table, and a blank that overrides parts of it ──────────────────────────── */
const FEES = {
  method_emb: 6, method_dtg: 0, method_dtf: 2, method_scr: 1.5,
  method_side: 3, side_sleeve: 2, side_back: 4.5, side_dtg: 1,
  ship_garment: 0, ship_extra: 0,
}
const PLAIN = { name: 'Hoodie', basePrice: 18 }
const OWN_FACE = { name: 'Duffel', basePrice: 20, sidePrice: { front: 1, back: 4, left: 5 } }
const OWN_FLAT = { name: 'Cap', basePrice: 12, sidePrice: 2 }
const OWN_METHOD = { name: 'Tee', basePrice: 9, methodPrices: { EMB: 4, DTG: 3 } }
/* THE TRAP `kind` EXISTS FOR: a first face priced at zero. `charged` never flips, so the
   SECOND face carries the placement — and a closed form (placement + method × N) is wrong. */
const FREE_FRONT = { name: 'Tote', basePrice: 7, sidePrice: { front: 0 } }

const FACE_SETS = [
  ['front'], ['front', 'back'], ['front', 'back', 'left'],
  ['front', 'back', 'left', 'right', 'sleeve'],
  ['back'], ['sleeve'], ['back', 'sleeve'],
  /* Out of order on purpose: PRICED_SIDES decides which face is first, not the caller. */
  ['sleeve', 'front', 'back'],
]
const METHODS = ['Embroidery', 'DTG printing', 'DTF printing', 'Screen printing']
const SIZES = [undefined, 'L']

for (const [name, data] of Object.entries({ PLAIN, OWN_FACE, OWN_FLAT, OWN_METHOD, FREE_FRONT })) {
  for (const method of METHODS) {
    for (const faces of FACE_SETS) {
      for (const size of SIZES) {
        compare(`${name} · ${method} · ${faces.join('+')}${size ? ' · ' + size : ''}`,
          { data, fees: FEES, size, method, faces })
      }
    }
  }
}

/* A BARE GARMENT: no technique, no faces, no placement. */
{
  const row = { id: 1, sku: 'EG-T', base_price: 18, data: { sku: 'EG-T', name: 'Hoodie', basePrice: 18 } }
  const idx = { exact: new Map([['EG-T', row]]), rows: [row] }
  const line = priceLines([{ id: 1, sku: 'EG-T', qty: 1, print_type: 'BLANK' }], idx, FEES, () => []).lines[0]
  const got = client.productUnitPrice({ blank: Number(line.unitCost), printType: '', faces: [], product: {}, fees: {} })
  if (Math.abs(got - Number(line.unitCost)) < 0.005) pass++
  else fails.push({ label: 'BLANK · nothing printed', server: Number(line.unitCost), got, parts: '—' })
}

rmSync(out, { recursive: true, force: true })

for (const f of fails) {
  console.log(`  FAIL  ${f.label}`)
  console.log(`        invoice ${usd(f.server)}   page ${usd(f.got)}   drift ${usd(f.got - f.server)}`)
  console.log(`        server parts: ${f.parts}`)
}
console.log(`\n${pass} agreed, ${fails.length} drifted`)
if (!fails.length) console.log('The product pages quote what the invoice charges.')
process.exit(fails.length ? 1 : 0)
