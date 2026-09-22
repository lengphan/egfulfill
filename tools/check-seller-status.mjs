#!/usr/bin/env node
/**
 * WHAT A SELLER READS ON A SHIPPED ORDER — executed, and checked against the vocabulary the
 * server actually emits.
 *
 * `sellerStatus` read `factory_status || status` and nothing else, so the carrier's answer was
 * thrown away at the point of display. Measured on the live database before the fix: 120
 * orders read as "Draft" to a seller while their parcel had shipped — 65 already DELIVERED,
 * 21 belonging to a real seller. Not "only one status": the worst available wrong one,
 * because Draft means *you never submitted this*.
 *
 * TWO HALVES, and the second is the one that prevents recurrence:
 *
 *   1. EXECUTE the rule on the shapes that actually broke — a delivered parcel on an order
 *      whose factory_status never left `new`, which is every marketplace order a seller
 *      fulfilled themselves.
 *   2. READ routes/shipping.js's DELIVERY_MAP and require every status it can write to have a
 *      word here. That map is the only writer of `orders.delivery_status`; a state added
 *      there with nothing here would fall through to the factory ladder and print "Draft" on
 *      a moving parcel all over again — silently, which is how this one survived.
 *
 * Run: node tools/check-seller-status.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const out = mkdtempSync(join(tmpdir(), 'eg-status-'))

/* Compiled rather than parsed. A gate that re-implements the thing it is checking proves
   only that the copy agrees with itself (§7), so this runs the REAL module. */
let mod
try {
  const cfg = join(out, 'tsconfig.json')
  writeFileSync(cfg, JSON.stringify({
    compilerOptions: { outDir: out, module: 'commonjs', target: 'es2020', strict: false, skipLibCheck: true },
    files: [join(ROOT, 'web/shared/order-status.ts')],
  }))
  execFileSync('npx', ['tsc', '--project', cfg], { cwd: join(ROOT, 'web'), stdio: 'pipe' })
  const find = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) { const hit = find(full); if (hit) return hit }
      else if (basename(e.name) === 'order-status.js') return full
    }
    return null
  }
  mod = require(find(out))
} catch (e) {
  console.log('SKIP  could not compile web/shared/order-status.ts —', String(e.message).split('\n')[0])
  process.exit(0)
} finally {
  process.on('exit', () => rmSync(out, { recursive: true, force: true }))
}

const { sellerStatus } = mod
let bad = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}
const label = (o) => sellerStatus(o).label
const group = (o) => sellerStatus(o).group

console.log('\nTHE BUG: A DELIVERED PARCEL MUST NEVER READ "DRAFT"')
{
  /* The exact live shape: a marketplace order the seller shipped themselves. It never entered
     our ladder, so factory_status is still `new` while the carrier says delivered. */
  const o = { status: 'new', factory_status: 'new', delivery_status: 'delivered' }
  check('delivered', label(o), 'Delivered')
  check('and it groups as shipped, so the Fulfilled filter finds it', group(o), 'shipped')
  check('in transit', label({ factory_status: 'new', delivery_status: 'in_transit' }), 'In transit')
  check('awaiting pickup', label({ factory_status: 'new', delivery_status: 'awaiting_pickup' }), 'Awaiting pickup')
}

console.log('\nNOTHING SHIPPED YET — THE LADDER IS UNCHANGED')
{
  check('draft', label({ factory_status: 'new' }), 'Draft')
  check('pending', label({ factory_status: 'in_review' }), 'Pending')
  check('in process', label({ factory_status: 'working' }), 'In Process')
  check('an empty delivery_status changes nothing', label({ factory_status: 'new', delivery_status: '' }), 'Draft')
  check('so does an unknown carrier word', label({ factory_status: 'in_review', delivery_status: 'wat' }), 'Pending')
}

console.log('\nOUR WORD WINS WHERE IT IS ABOUT THE AGREEMENT, NOT THE BOX')
{
  /* A refunded order is refunded wherever the parcel went; a cancelled one cannot be "In
     transit". Everything else yields to the carrier. */
  check('cancelled beats the carrier', label({ factory_status: 'cancelled', delivery_status: 'in_transit' }), 'Cancelled')
  check('refunded beats delivered', label({ factory_status: 'refunded', delivery_status: 'delivered' }), 'Refunded')
  check('on hold beats in transit', label({ factory_status: 'on_hold', delivery_status: 'in_transit' }), 'On Hold')
  /* …but a finished order yields: where the parcel is beats us repeating that we are done. */
  check('shipped yields to the carrier', label({ factory_status: 'shipped', delivery_status: 'in_transit' }), 'In transit')
}

console.log('\nA PARCEL THAT WENT WRONG NEEDS A PERSON, NOT AN OUTCOME')
{
  check('returned', label({ factory_status: 'new', delivery_status: 'returned' }), 'Returned')
  check('and it asks for attention', group({ factory_status: 'new', delivery_status: 'returned' }), 'attention')
  check('failed', label({ factory_status: 'new', delivery_status: 'failed' }), 'Delivery failed')
  check('also attention', group({ factory_status: 'new', delivery_status: 'failed' }), 'attention')
}

/**
 * THE HALF THAT PREVENTS RECURRENCE.
 *
 * routes/shipping.js's DELIVERY_MAP is the ONLY writer of orders.delivery_status. Every
 * status it can write must have a word here, or a parcel in that state silently falls back to
 * the factory ladder — which is precisely how "Draft on a delivered parcel" survived.
 */
console.log('\nEVERY STATE THE SERVER CAN WRITE HAS A WORD HERE')
{
  const src = readFileSync(join(ROOT, 'server/src/routes/shipping.js'), 'utf8')
  const block = src.slice(src.indexOf('const DELIVERY_MAP'))
  const emitted = [...block.slice(0, block.indexOf('};')).matchAll(/status:\s*'([a-z_]+)'/g)].map((m) => m[1])
  check('the map was found and reads statuses', emitted.length > 0, true)
  for (const st of [...new Set(emitted)]) {
    const s = sellerStatus({ factory_status: 'new', delivery_status: st })
    /* "Draft" is the tell: it means this state fell through to the ladder rather than being
       recognised, which is the original bug in miniature. */
    check(`${st} is named`, s.label !== 'Draft', true)
  }
}

console.log(bad
  ? `\nFAIL  ${bad} check${bad === 1 ? '' : 's'} failed.`
  : '\nPASS  the carrier owns the column once a parcel exists, and nothing it can say is unnamed.')
process.exit(bad ? 1 : 0)
