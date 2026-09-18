#!/usr/bin/env node
/**
 * EVERY PRINTED FACE IS CHARGED — the gate for the rule that replaced "one face is included".
 *
 * This is a PRICING rule, so it is executed rather than read: sideDetail is three resolutions
 * deep (the product's per-face map, the platform's per-face setting, the flat rate) and the
 * thing that went wrong under the old rule was never the arithmetic — it was WHICH face the
 * exception applied to. An exception removed is easy to get wrong in the other direction, by
 * leaving a `slice(1)` or an early return that quietly keeps one face free.
 *
 * What it pins:
 *   · every face appears, including the only face of a one-face line
 *   · no face is named `included` on a live breakdown (a CHARGED line's stamp still carries
 *     one, and the summary reads that — history keeps the price it was billed at)
 *   · no faces at all is still nothing, not one face's rate
 *   · the order is PRICED_SIDES, never insertion order
 *   · per-face product rates and per-face methods still resolve
 *
 * Run: node tools/check-side-pricing.mjs
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { sideBreakdown, sideAddOn } = await import(join(ROOT, 'server/src/pricing.js'))
let bad = 0
const check = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}
const fees = { method_side: 3 }

console.log('\nEVERY FACE IS CHARGED')
{
  const r = sideBreakdown([{ side: 'front', method: 'Embroidery' }, { side: 'back', method: 'DTG' }], fees, null)
  check('both faces appear', r.parts.map((p) => [p.face, p.amount]), [['front', 3], ['back', 3]])
  check('no face is named as included', r.included, null)
  check('total is both', sideAddOn(['front', 'back'], fees, null), 6)
}

console.log('\nA ONE-FACE LINE NOW PAYS FOR ITS FACE')
{
  const r = sideBreakdown([{ side: 'front', method: 'DTG' }], fees, null)
  check('the single face is charged', r.parts.map((p) => [p.face, p.amount]), [['front', 3]])
  check('total', sideAddOn(['front'], fees, null), 3)
}

console.log('\nNO FACES AT ALL IS STILL NOTHING')
{
  check('no artwork, no surface charge', sideAddOn([], fees, null), 0)
  check('and an empty breakdown', sideBreakdown([], fees, null).parts, [])
}

console.log('\nORDER IS STILL PRICED_SIDES, NOT INSERTION ORDER')
{
  const r = sideBreakdown(['back', 'front'], fees, null)
  check('front first however it arrived', r.parts.map((p) => p.face), ['front', 'back'])
}

console.log('\nPER-FACE RATES STILL RESOLVE')
{
  const r = sideBreakdown(['front', 'hood'], fees, { sidePrice: { hood: 7 } })
  check('the product’s own hood rate wins', r.parts.map((p) => [p.face, p.amount]), [['front', 3], ['hood', 7]])
}

console.log('\nTHE FACE METHOD STILL RIDES ALONG')
{
  const r = sideBreakdown([{ side: 'front', method: 'Embroidery' }, { side: 'back', method: '' }], fees, null)
  check('front keeps its word', r.parts[0].method, 'Embroidery')
  check('an inherited face stays null', r.parts[1].method, null)
}

console.log(bad ? `\n${bad} failure(s).` : '\nEvery surface is charged, and nothing else moved.')
process.exit(bad ? 1 : 0)
