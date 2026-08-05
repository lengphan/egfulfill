/**
 * Volume tiers, checked against a REAL database rather than a mock.
 *
 * Mocked tests have produced false confidence in this repo before (CLAUDE.md 7) — a mock
 * that returns rows regardless of the query hides a SELECT naming a column that does not
 * exist. So this seeds actual rows and runs the actual exported functions against them.
 *
 * Run it against a scratch database, never production:
 *
 *   createdb egvol
 *   psql -q -d egvol -f test-volume.sql
 *   DATABASE_URL=postgres://localhost/egvol node test-volume.mjs
 *
 * The seed deliberately includes the cases that would silently produce wrong money:
 * an order in the NEXT month, a cancelled order, and an order that never shipped.
 */
import { tierFor, normalizeTiers, periodKey, previousPeriod, unitsByPeriod, unitsForSeller } from './src/volume.js'

let pass = 0, fail = 0
const ok = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}\n        got  ${g}\n        want ${w}`) }
}

const TIERS = [{ minUnits: 100, pct: 3 }, { minUnits: 300, pct: 6 }, { minUnits: 750, pct: 10 }]

console.log('\n— pure tier resolution (no database) —')
ok('0 units earns nothing',            tierFor(0, TIERS).pct, 0)
ok('99 units still nothing',           tierFor(99, TIERS).pct, 0)
ok('exactly 100 earns tier 1',         tierFor(100, TIERS).pct, 3)
ok('299 stays on tier 1',              tierFor(299, TIERS).pct, 3)
ok('300 earns tier 2',                 tierFor(300, TIERS).pct, 6)
ok('10000 caps at the top tier',       tierFor(10000, TIERS).pct, 10)
ok('tier index is 1-based',            tierFor(300, TIERS).index, 2)
ok('distance to next rung',            tierFor(260, TIERS).unitsToNext, 40)
ok('top tier has no next',             tierFor(10000, TIERS).next, null)
ok('NO TIERS = feature off',           tierFor(99999, []).pct, 0)

console.log('\n— admin input is normalised, not trusted —')
ok('unsorted rows still ladder',       normalizeTiers([{minUnits:300,pct:6},{minUnits:100,pct:3}]).map(t=>t.minUnits), [100,300])
ok('duplicate minUnits dropped',       normalizeTiers([{minUnits:100,pct:3},{minUnits:100,pct:9}]).length, 1)
ok('negative pct rejected',            normalizeTiers([{minUnits:100,pct:-5}]).length, 0)
ok('over-100% rejected',               normalizeTiers([{minUnits:100,pct:150}]).length, 0)
ok('garbage rejected',                 normalizeTiers([{minUnits:'x',pct:'y'}]).length, 0)
ok('non-array rejected',               normalizeTiers(null).length, 0)

console.log('\n— period maths —')
ok('periodKey is UTC YYYY-MM',         periodKey('2025-11-29T23:59:00Z'), '2025-11')
ok('Dec 1 00:01Z is December',         periodKey('2025-12-01T00:01:00Z'), '2025-12')
ok('January earns from December',      previousPeriod('2026-01'), '2025-12')
ok('mid-year rolls back one',          previousPeriod('2025-11'), '2025-10')

console.log('\n— the rollup, against real seeded rows —')
const nov = await unitsByPeriod('2025-11')
ok('two sellers shipped in Nov',       nov.length, 2)
const A = nov.find(r => r.sellerId.startsWith('1111'))
const B = nov.find(r => r.sellerId.startsWith('2222'))
ok('A: 40+60+20, Dec order excluded',  A.units, 120)
ok('A: cancelled order excluded',      A.orders, 3)
ok('B: 9 units',                       B.units, 9)
ok('unshipped order excluded',         (await unitsForSeller('11111111-1111-1111-1111-111111111111','2025-11')), 120)
ok('December counted separately',      (await unitsForSeller('11111111-1111-1111-1111-111111111111','2025-12')), 500)
ok('empty month is 0, not an error',   (await unitsForSeller('11111111-1111-1111-1111-111111111111','2025-09')), 0)

console.log('\n— end to end: what would each seller be charged in December? —')
for (const [name, id] of [['Seller A','11111111-1111-1111-1111-111111111111'],['Seller B','22222222-2222-2222-2222-222222222222']]) {
  const units = await unitsForSeller(id, previousPeriod('2025-12'))
  const t = tierFor(units, TIERS)
  console.log(`  ${name}: shipped ${units} in Nov -> December rate ${t.pct}%` +
    (t.next ? `  (${t.unitsToNext} more units would have earned ${t.next.pct}%)` : '  (top tier)'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
