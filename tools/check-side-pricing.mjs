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

/**
 * A PLACEMENT IS PER FACE, NOT PER DESIGN (owner, 2026-09-21: "how to make sure there's no
 * face fees when more designs are added per face").
 *
 * The placement pays for decorating a SURFACE — one hooping, one pass — so a second picture
 * on the same front is the same surface and must cost nothing extra. The design fee is the
 * one that counts pictures, and it is a separate charge that does not scale with quantity.
 *
 * `sideDetail` dedupes on the face name, and order_designs' unique index already holds one
 * row per (line, kind, side) — but the index would not stop a raster and its stitch file, or
 * a caller handing the same face twice, and this is the half that bills. Written down as a
 * test because the answer "it dedupes" is only true while nobody removes the Set.
 */
console.log('\nMORE DESIGNS ON ONE FACE IS STILL ONE PLACEMENT')
{
  const one = [{ side: 'front', method: 'DTG' }]
  const two = [{ side: 'front', method: 'DTG' }, { side: 'front', method: 'DTG' }]
  const three = [...two, { side: 'front', method: 'DTG' }]
  check('one design on the front', sideAddOn(one, fees, null, 'DTG'), 3)
  check('two designs, same front, same charge', sideAddOn(two, fees, null, 'DTG'), 3)
  check('three, still one placement', sideAddOn(three, fees, null, 'DTG'), 3)
  check('and one row, not three', sideBreakdown(three, fees, null, 'DTG').parts.map((p) => p.face), ['front'])
  /* A raster and the stitch file cut FROM it share a surface. Two rows in order_designs —
     different `kind`, so the unique index permits both — and one thing to decorate. */
  const pair = [{ side: 'front', method: 'DTG' }, { side: 'front', method: 'Embroidery' }]
  check('artwork + its machine file is one placement', sideAddOn(pair, fees, null, 'DTG'), 3)
  /* The control: a SECOND surface does add one. If this ever matches the rows above, the
     dedupe has stopped distinguishing faces from designs and everything is free. */
  check('a second FACE does add one', sideAddOn([{ side: 'front', method: 'DTG' }, { side: 'back', method: 'DTG' }], fees, null, 'DTG'), 6)
}

console.log(bad ? `\n${bad} failure(s).` : '\nEvery surface is charged, and nothing else moved.')
process.exit(bad ? 1 : 0)
