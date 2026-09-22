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

console.log('\nONE PLACEMENT PER LINE — THE FIRST FACE CARRIES IT')
{
  const r = sideBreakdown([{ side: 'front', method: 'Embroidery' }, { side: 'back', method: 'DTG' }], fees, null)
  /* Both faces are still LISTED — dropping the free one would hide that the garment prints
     on two surfaces — but only the first carries money (owner, 2026-09-21). */
  check('both faces appear, only the first charged', r.parts.map((p) => [p.face, p.amount]), [['front', 3], ['back', 0]])
  check('no face is named as included', r.included, null)
  check('total is one placement, not two', sideAddOn(['front', 'back'], fees, null), 3)
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
  /* The rate that applies is the FIRST face's, so a hood override shows only when the hood
     is the face being charged. Both cases, because the precedence and the one-placement rule
     are separate rules and a test that only proves one of them hides the other. */
  const r = sideBreakdown(['front', 'hood'], fees, { sidePrice: { hood: 7 } })
  check('front leads, so the hood override is not the one billed', r.parts.map((p) => [p.face, p.amount]), [['front', 3], ['hood', 0]])
  const h = sideBreakdown(['hood'], fees, { sidePrice: { hood: 7 } })
  check('hood alone bills the product’s own rate', h.parts.map((p) => [p.face, p.amount]), [['hood', 7]])
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
  /* THE CONTROL, restated for the one-placement rule. Money can no longer tell a second face
     from a second design — both leave the total alone — so the fact that still separates them
     is the ROW: a second FACE is another surface and gets listed (at zero); a second design on
     the SAME face is the same surface and must not. If these ever agree, the dedupe has
     stopped distinguishing them and the summary would name a face the garment does not have. */
  const twoFaces = sideBreakdown([{ side: 'front', method: 'DTG' }, { side: 'back', method: 'DTG' }], fees, null, 'DTG')
  check('a second FACE is listed', twoFaces.parts.map((p) => [p.face, p.amount]), [['front', 3], ['back', 0]])
  check('a second DESIGN on one face is not', sideBreakdown(two, fees, null, 'DTG').parts.length, 1)
}

/**
 * THE SECOND FACE COSTS A DESIGN FEE, NOT A PLACEMENT.
 *
 * THE PLACEMENT is paid once — adding a surface must not bill the setup again. THE METHOD
 * is not: a second embroidered face is a second pass through the machine (owner, today,
 * amending 2026-09-21). The design fee is billed per picture by computeDesignFees and is
 * still not this function's business.
 *
 * THIS BLOCK USED TO ASSERT "four faces, same placement money" AND IT STILL PASSED after the
 * rule changed, because its fixture has no method surcharge at all — every extra face added
 * zero either way. A gate that cannot fail on the thing it names is not guarding it, so the
 * surcharge is in the fixture now and both halves are checked.
 */
console.log('\nTHE PLACEMENT IS PAID ONCE, THE MACHINE RUN IS NOT')
{
  const priced = { methodPrices: { EMB: 4 } }
  const faces = (n) => ['front', 'back', 'left', 'right'].slice(0, n).map((side) => ({ side, method: 'Embroidery' }))
  check('one face — placement only', sideAddOn(faces(1), fees, priced, 'Embroidery'), 3)
  check('two faces — one placement, two runs', sideAddOn(faces(2), fees, priced, 'Embroidery'), 7)
  check('four faces', sideAddOn(faces(4), fees, priced, 'Embroidery'), 15)
  const r = sideBreakdown(faces(3), fees, priced, 'Embroidery')
  check('the front carries the placement', r.parts[0].amount, 3)
  check('and every face after carries its run', r.parts.slice(1).map((p) => p.amount), [4, 4])

  /* A METHOD WITH NO SURCHARGE STILL ADDS NOTHING, which is the half the old fixture was
     accidentally testing: plain print is free, so a second DTG face is still free. */
  check('a second DTG face is free',
    sideAddOn([{ side: 'front', method: 'DTG' }, { side: 'back', method: 'DTG' }], fees, priced, 'DTG'), 3)

  /* A PRODUCT WE KNOW NOTHING ABOUT does not crash. sideDetail is handed
     `(row && row.data) || null` while every other caller of methodAddOn passes an object,
     so the extra face asking for its method was the first to meet a null. */
  check('no product data — platform default, not a throw',
    sideAddOn(faces(2), fees, null, 'Embroidery'), 3)
}

console.log(bad ? `\n${bad} failure(s).` : '\nOne placement per line, one machine run per face, and nothing else moved.')
process.exit(bad ? 1 : 0)
