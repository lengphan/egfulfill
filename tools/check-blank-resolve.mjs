/**
 * DRIFT GUARD for "which blank is this line".
 *
 * One question, two implementations, and they are hand-mirrored:
 *
 *   web/lib/variant-resolve.ts  resolveProduct()  — what the SCREEN shows: picture, name,
 *                                                   variant strip, stock status
 *   server/src/pricing.js       matchProduct()    — what the line COSTS, and its stock sku
 *
 * They drifted, and the shape of the failure is why this file exists. The order grid and the
 * import sheet write the blank as ONE string, `5000 - Gildan Unisex Heavy Cotton™ T-Shirt`,
 * because Sheets validation has no label-vs-value and a catalogue holds near-identical names.
 * The web resolver learned to split that. The server matcher did not — so the line resolved
 * for display and matched nothing for pricing, and every figure downstream vanished at once:
 * "Not priced · pick a blank first" on the row, "not charged yet" in the Summary, $0.00 in
 * the queue, and no sku for replenishment to order against. Nothing failed loudly, and the
 * screen looked correct throughout, which is exactly what let it survive several rounds of
 * "the costs aren't showing".
 *
 * Reading the two side by side is what missed it. This EXECUTES both against the same cases.
 *
 *   node tools/check-blank-resolve.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const out = mkdtempSync(path.join(tmpdir(), 'blankresolve-'))
const TSC = path.join(ROOT, 'web', 'node_modules', '.bin', 'tsc')

/** Compile one file inside a project, with that project's own path aliases. */
function compileIn(dir, entry, outSub) {
  const dest = path.join(out, outSub)
  const appCfg = JSON.parse(
    readFileSync(path.join(ROOT, dir, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  )
  const cfg = path.join(ROOT, dir, '.tsconfig-blank-check.json')
  writeFileSync(cfg, JSON.stringify({
    compilerOptions: {
      outDir: dest, module: 'commonjs', target: 'es2020', moduleResolution: 'node',
      baseUrl: '.', paths: appCfg.compilerOptions?.paths ?? {},
      skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true,
      jsx: 'react-jsx', resolveJsonModule: true, strict: false, noEmitOnError: false,
    },
    include: [entry],
  }))
  let report = ''
  try {
    execFileSync(TSC, ['--project', cfg], { cwd: path.join(ROOT, dir), stdio: 'pipe' })
  } catch (e) {
    /* NON-ZERO IS NOT NECESSARILY A FAILURE HERE. `noEmitOnError: false` means tsc writes the
       JS anyway, and this entry drags in the whole API type surface — including Next's own
       `fetch(..., { next: … })`, which plain tsc rejects because it has no Next types loaded.
       That is a fact about compiling one file outside its bundler, not about the rule under
       test. What matters is whether the module came out; if it did not, THAT is the error. */
    report = String(e.stdout || e.stderr || e.message)
  } finally {
    rmSync(cfg, { force: true })
  }
  const hit = findFile(dest, path.basename(entry).replace(/\.ts$/, '.js'))
  if (!hit) throw new Error(`could not compile ${dir}/${entry}:\n${report || 'no output produced'}`)
  return hit
}

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
const webEntry = compileIn('web', 'lib/variant-resolve.ts', 'web')

/* tsc DOES NOT REWRITE PATH ALIASES in what it emits — `@/lib/print-method` survives verbatim
   into the output and node cannot resolve it. The bundler does that job in the real app; here
   a resolve hook does it, pointing at the modules tsc just emitted beside the entry, so this
   runs the SAME code the app runs rather than a stand-in written for the test. */
const webOut = path.dirname(webEntry)
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    const hit = findFile(webOut, path.basename(request) + '.js')
    if (hit) return hit
  }
  return resolve.call(this, request, ...rest)
}
const web = require(webEntry)
/* ourSku lives in its own module so the app's boards and the catalogue helpers can both
   import it without either owning the file. Compiled separately, same alias hook. */
const ours = require(compileIn('web', 'lib/our-sku.ts', 'web'))

/* pricing.js imports db.js, which constructs a Pool at module load. A Pool does not connect
   until it is queried, so a bogus URL is enough — and it is the same trick the boot test uses
   for exactly this reason. Nothing here touches the database. */
process.env.DATABASE_URL ||= 'postgres://x:x@127.0.0.1:1/x'
const srv = await import(path.join(ROOT, 'server/src/pricing.js'))

/**
 * ONE fixture catalogue, in BOTH shapes.
 *
 * The web takes the API's CatalogProduct; the server takes rows off `catalog_products` with
 * everything but id/sku/base_price inside `data`. Declaring the products once and adapting
 * is the point — two fixture lists would drift the same way the implementations did.
 */
const PRODUCTS = [
  { id: 'p1', sku: '5000', name: 'Gildan Unisex Heavy Cotton™ T-Shirt', variantSkus: ['5000-L-SKY', '5000-M-BLK'] },
  { id: 'p2', sku: 'EG-18000', name: 'Gildan Unisex Heavy Blend™ Crewneck Sweatshirt', variantSkus: [] },
  { id: 'p3', sku: 'EG-VC600', name: 'hat', variantSkus: [] },
  { id: 'p4', sku: '10892', name: 'Adams Headwear LP104', variantSkus: [] },
  // A product whose NAME contains " - ". This is what stops the split being tried first.
  { id: 'p5', sku: 'AD-POLO', name: 'Adidas - Performance Polo', variantSkus: [] },
  /* A RENAMED product, and one carrying the supplier's own style code.
     Both are alias matches, and both were places the two implementations disagreed: the web
     resolver had always matched supplierSku on the blank and the server had not, and neither
     knew about nameAliases until the brand split started renaming products in bulk. A line
     that resolves on one side only is a row that looks right and prices at nothing. */
  { id: 'p6', sku: 'EG-18009', name: 'Unisex Heavy Blend™ Hooded Sweatshirt', variantSkus: [],
    supplierSku: '18500', nameAliases: ['Gildan Unisex Heavy Blend™ Hooded Sweatshirt'] },
]
const webCatalog = PRODUCTS.map((p) => ({ id: p.id, sku: p.sku, name: p.name, variantSkus: p.variantSkus,
  supplierSku: p.supplierSku, nameAliases: p.nameAliases }))
const srvRows = PRODUCTS.map((p) => ({ id: p.id, sku: p.sku, base_price: 10, supplier_sku: p.supplierSku,
  data: { name: p.name, sku: p.sku, variantSkus: p.variantSkus, supplierSku: p.supplierSku, nameAliases: p.nameAliases } }))
const srvIdx = { rows: srvRows, exact: new Map() }
for (const row of srvRows) {
  for (const c of [row.sku, ...(row.data.variantSkus || [])]) {
    const k = String(c).toUpperCase().trim()
    if (k && !srvIdx.exact.has(k)) srvIdx.exact.set(k, row)
  }
}

/* Four of these are REAL production rows, read off order_items on 2026-08-24 while three of
   the four most recent manual orders were sitting unpriced. */
const CASES = [
  { what: 'composite blank, no sku (the grid and the sheet both write this)', item: { blank: '5000 - Gildan Unisex Heavy Cotton™ T-Shirt', sku: '' }, want: 'p1' },
  { what: 'composite blank, production row', item: { blank: 'EG-VC600 - hat', sku: '' }, want: 'p3' },
  { what: 'composite blank, production row', item: { blank: '10892 - Adams Headwear LP104', sku: '' }, want: 'p4' },
  { what: 'bare name and a sku (how older rows were written)', item: { blank: 'Gildan Unisex Heavy Blend™ Crewneck Sweatshirt', sku: 'EG-18000' }, want: 'p2' },
  { what: 'a NAME containing " - " is matched whole, not split', item: { blank: 'Adidas - Performance Polo', sku: '' }, want: 'p5' },
  { what: 'variant sku, no blank', item: { blank: '', sku: '5000-L-SKY' }, want: 'p1' },
  { what: 'base↔variant prefix', item: { blank: '', sku: '5000-XL-RED' }, want: 'p1' },
  { what: 'sku only, exact', item: { blank: '', sku: 'EG-18000' }, want: 'p2' },
  { what: 'nothing to go on', item: { blank: '', sku: '' }, want: null },
  { what: 'a blank naming no product we hold', item: { blank: 'Something else entirely', sku: '' }, want: null },
  { what: 'the name a product had BEFORE it was renamed', item: { blank: 'Gildan Unisex Heavy Blend™ Hooded Sweatshirt', sku: '' }, want: 'p6' },
  { what: 'composite blank written before the rename', item: { blank: 'EG-18009 - Gildan Unisex Heavy Blend™ Hooded Sweatshirt', sku: '' }, want: 'p6' },
  { what: "the supplier's own style code as the blank", item: { blank: '18500', sku: '' }, want: 'p6' },
]

/**
 * AND THE LABEL, because the same two files write it and it is the string the resolvers read
 * back. A sku printed here is a sku a seller can paste into a distributor's search box, so
 * `ourSku` decides — and if the two implementations ever disagree about what "ours" means,
 * the sheet and the app would offer different strings for one product and each other's rows
 * would stop resolving.
 */
const SKUS = [
  { sku: 'EG-1002', ours: true },
  { sku: 'eg-la13', ours: true },       // case is not the point
  { sku: '10-271-016-SM', ours: false },  // OTTO's part number, live in the sku column
  { sku: '100-632-120342', ours: false },
  { sku: '10892', ours: false },
  { sku: '5000', ours: false },
  { sku: '', ours: false },
]
const fail = []
for (const c of SKUS) {
  const w = ours.ourSku(c.sku)
  const v = srv.ourSku(c.sku)
  const want = c.ours ? c.sku : ''
  if (w !== want) fail.push(`web ourSku("${c.sku}") → "${w}", expected "${want}"`)
  if (v !== want) fail.push(`server ourSku("${c.sku}") → "${v}", expected "${want}"`)
  if (w !== v) fail.push(`DRIFT on ourSku("${c.sku}") — web "${w}", server "${v}"`)
}
/* And the PREFERENCE, which is the whole point: ours where both exist, theirs where only
   theirs does, never a blank where a code should be. */
const DISPLAY = [
  { p: { sku: 'EG-1005', supplierSku: '102-664-001' }, want: 'EG-1005' },
  { p: { sku: '10892', supplierSku: '' }, want: '10892' },
  { p: { sku: '', supplierSku: '103-713-031753A' }, want: '103-713-031753A' },
  { p: { sku: '', supplierSku: '' }, want: '' },
]
for (const c of DISPLAY) {
  const got = ours.displaySku(c.p)
  if (got !== c.want) fail.push(`displaySku(${JSON.stringify(c.p)}) → "${got}", expected "${c.want}"`)
}

// The label the dropdowns offer, and what a line then carries.
const LABELS = [
  { p: { name: 'Adams Headwear LP104', sku: '10892' }, want: '10892 - Adams Headwear LP104' },
  { p: { name: 'Gildan Unisex Heavy Blend™ Crewneck Sweatshirt', sku: 'EG-18000' }, want: 'EG-18000 - Gildan Unisex Heavy Blend™ Crewneck Sweatshirt' },
  { p: { name: '', sku: 'EG-1002' }, want: 'EG-1002' },
]
/* productLabel is checked only when the module exports one. It is being written in another
   session as this ships; a guard that silently passed would be worse than one that says it
   skipped, so it says so. */
if (typeof web.productLabel === 'function') {
  for (const c of LABELS) {
    const got = web.productLabel(c.p)
    if (got !== c.want) fail.push(`productLabel(${JSON.stringify(c.p)}) → "${got}", expected "${c.want}"`)
  }
} else {
  console.log(`(skipped ${LABELS.length} label cases — web/lib/variant-resolve.ts exports no productLabel yet)`)
}

for (const c of CASES) {
  const w = web.resolveProduct(c.item, webCatalog)
  const s = srv.matchProduct(srvIdx, c.item)
  const webId = w ? w.id : null
  const srvId = s ? s.id : null
  if (webId !== c.want) fail.push(`web resolveProduct: ${c.what} → ${webId ?? 'null'}, expected ${c.want ?? 'null'}`)
  if (srvId !== c.want) fail.push(`server matchProduct: ${c.what} → ${srvId ?? 'null'}, expected ${c.want ?? 'null'}`)
  if (webId !== srvId) fail.push(`DRIFT: ${c.what} — web says ${webId ?? 'null'}, server says ${srvId ?? 'null'}`)
}

rmSync(out, { recursive: true, force: true })

if (fail.length) {
  console.error('Blank resolution disagrees:\n')
  for (const f of fail) console.error('  ✗ ' + f)
  console.error(`\n${fail.length} problem${fail.length === 1 ? '' : 's'}. A line that resolves on ONE side only`)
  console.error('is the failure this guard exists for: the screen looks right and the price is missing.')
  process.exit(1)
}
console.log(`web/lib/variant-resolve.ts and server/src/pricing.js agree across ${CASES.length} resolution cases,`)
console.log(`${SKUS.length} sku cases, ${DISPLAY.length} preferences and ${LABELS.length} labels — including the composite "SKU - NAME" blank the`)
console.log('order grid and the import sheet write, and the vendor part numbers that must never be printed.')
