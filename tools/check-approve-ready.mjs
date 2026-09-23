#!/usr/bin/env node
/**
 * WHEN IS A LINE READY TO APPROVE — asked of the real function, not of a description.
 *
 * Three surfaces answer "what method is this line printed in", and on 2026-09-23 they
 * disagreed on a live order (etsy-4182753270, four faces all saying Embroidery, the line's
 * own print_type empty):
 *
 *   the PRICER  sideDetail resolved each FACE's own method and charged $11.00
 *   the SERVER  approvalBlockersFor checks blank/colour/size/artwork — never the method
 *   the CLIENT  itemNeedsSetup blocked on !isSet(item.print_type) alone
 *
 * So the Approve button was dead on an order the invoice priced in full and the server would
 * have accepted, and the reason lived in a tooltip on a disabled control. §4's faces rule is
 * what settles it: a silent face inherits the line, a SPEAKING face overrides it — a line
 * whose faces all speak needs no method of its own.
 *
 * This runs the real itemNeedsSetup over the states that actually occur. It is deliberately
 * about the READY direction too: a gate that only ever proves things are blocked will happily
 * block everything.
 *
 * Run: node tools/check-approve-ready.mjs     (no database, no network)
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'web')
const { createJiti } = createRequire(join(WEB, 'package.json'))('jiti')
const jiti = createJiti(join(WEB, 'noop.js'), { alias: { '@': WEB }, interopDefault: true })
const { itemNeedsSetup } = await jiti.import(join(WEB, 'lib/variant-resolve.ts'))

/* The product from the live order: it offers two techniques, so a method IS a question here. */
/* THE SHAPE THE RESOLVER ACTUALLY READS, not the one a `data` blob suggests: colorsOf()
   takes mainColor + the keys of colorImages, and sizesOf() takes sizes + sizePrices. Written
   from those functions rather than from memory — the first draft of this fixture put colours
   under `data.colors`, colorsOf saw none, and two cases passed for the wrong reason. */
const CATALOG = [{
  id: 'SS-12450', sku: 'EG-18712', name: 'Unisex Hammer Maxweight Crewneck Sweatshirt',
  type: 'Apparel', method: 'DTG / Embroidery',
  mainColor: 'Cherry Red', colorImages: { 'Cherry Red': '', Black: '' },
  sizes: ['S', 'M', 'L'],
}]
const LINE = { sku: 'EG-18712', blank: 'EG-18712', color: 'Cherry Red', size: 'S' }

let bad = 0
const check = (label, got, want) => {
  const ok = got === want
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  — needsSetup=${got}, expected ${want}`}`)
}

console.log('THE LINE ANSWERS')
check('a line with its own method is ready', itemNeedsSetup({ ...LINE, print_type: 'EMB' }, CATALOG), false)
check('a line with no method and no faces is NOT', itemNeedsSetup({ ...LINE, print_type: '' }, CATALOG), true)

console.log('\nTHE FACES ANSWER — the case that shipped a dead Approve button')
check('four faces that all declare a method make the line ready',
  itemNeedsSetup({ ...LINE, print_type: '', face_count: 4, faces_without_method: 0 }, CATALOG), false)
check('…one silent face is still a question',
  itemNeedsSetup({ ...LINE, print_type: '', face_count: 4, faces_without_method: 1 }, CATALOG), true)
check('…and every face silent is the original state',
  itemNeedsSetup({ ...LINE, print_type: '', face_count: 4, faces_without_method: 4 }, CATALOG), true)
check('a line with faces counted at zero is not ready by accident',
  itemNeedsSetup({ ...LINE, print_type: '', face_count: 0, faces_without_method: 0 }, CATALOG), true)

console.log('\nAN OLDER SERVER SENDS NEITHER FIELD')
/* undefined must land on the OLD behaviour, never on a permissive one: Vercel deploys on push
   and the VPS is a manual pull, so the app is always ahead of the API for a while. */
check('absent counts are read as "every face is silent"',
  itemNeedsSetup({ ...LINE, print_type: '' }, CATALOG), true)

console.log('\nTHE OTHER AXES STILL BLOCK — a face method is not a colour')
check('no colour still blocks', itemNeedsSetup({ ...LINE, color: '', print_type: '', face_count: 4, faces_without_method: 0 }, CATALOG), true)
check('no size still blocks', itemNeedsSetup({ ...LINE, size: '', print_type: '', face_count: 4, faces_without_method: 0 }, CATALOG), true)
check('no blank still blocks', itemNeedsSetup({ ...LINE, blank: '', sku: '', print_type: '', face_count: 4, faces_without_method: 0 }, CATALOG), true)

console.log(bad === 0
  ? '\nPASS  a line is ready when the line says the method, or when every face does.'
  : `\nFAIL  ${bad} case${bad === 1 ? '' : 's'} — the Approve button and the invoice disagree again.`)
process.exit(bad === 0 ? 0 : 1)
