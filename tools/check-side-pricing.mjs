#!/usr/bin/env node
/**
 * PER-FACE PRICING, AND THE BREAKDOWN THAT EXPLAINS IT.
 *
 * `sideAddOn` in server/src/pricing.js carries a note stating figures "measured against a
 * real database": base $10 + embroidery $5, with side_back $3.50 and side_sleeve $1.50 →
 * front alone $15.00, front+back $18.50, front+sleeve $16.50, front+back+sleeve $20.00, and
 * a face with no override falling to the $2.00 flat at $17.00.
 *
 * Those were a claim with nothing executing them — the same shape as the mobile theme citing
 * a gate file that had never existed. This runs them.
 *
 * The second half is the one that matters going forward. The order Summary now names each
 * charged face and its amount, and the figures come from `sideBreakdown` — the SAME function
 * that produces the total a seller is charged. If those two ever diverge, a card explains a
 * price that was never charged, which is the one thing a breakdown must not do. So every
 * case asserts that the parts sum to the total.
 *
 * Run: node tools/check-side-pricing.mjs
 */
import { sideAddOn, sideBreakdown, sideRates } from "../server/src/pricing.js"

/** The rates from the engine's own note: two per-face overrides and a flat fallback. */
const FEES = { method_side: 2, side_back: 3.5, side_sleeve: 1.5 }

let bad = 0
const money = (n) => `$${n.toFixed(2)}`
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(46)} ${JSON.stringify(got)}${ok ? "" : `   want ${JSON.stringify(want)}`}`)
}

console.log("ONE FACE IS INCLUDED — the rest are charged")
check("front alone adds nothing", sideAddOn(["front"], FEES, null), 0)
check("back ALONE adds nothing", sideAddOn(["back"], FEES, null), 0)
check("front+back → side_back", sideAddOn(["front", "back"], FEES, null), 3.5)
check("front+sleeve → side_sleeve", sideAddOn(["front", "sleeve"], FEES, null), 1.5)
check("front+back+sleeve → both", sideAddOn(["front", "back", "sleeve"], FEES, null), 5)
check("a face with no override → flat", sideAddOn(["front", "pocket"], FEES, null), 2)

console.log("\nWHICH FACE IS FREE is deterministic — not upload order")
{
  /* PRICED_SIDES decides, so the front is the free one wherever a line has one. "The first
     recorded" would be order_designs insertion order — when somebody happened to upload,
     which is not a fact about the garment. */
  const a = sideBreakdown(["back", "front"], FEES, null)
  const b = sideBreakdown(["front", "back"], FEES, null)
  check("front is free whichever order they arrive", [a.included, b.included], ["front", "front"])
  check("…and the charge is the same either way",
    [sideAddOn(["back", "front"], FEES, null), sideAddOn(["front", "back"], FEES, null)], [3.5, 3.5])
}

console.log("\nTHREE TIERS, IN THE ORDER THE ENGINE DOCUMENTS")
/* The note above sideAddOn is explicit, and the middle row is the one that surprises:
 *   d.sidePrice as a MAP                        per product, per face   — highest
 *   fees.side_<face>                            per platform, per face
 *   d.sidePrice as a NUMBER / fees.method_side  the flat "each additional side"
 * So a product's FLAT number does NOT outrank a platform's per-face rate — both are
 * answering "what does a face cost", and the more specific one wins. This assertion
 * originally had it the other way round and the gate corrected the test, not the code. */
check("a product's per-face MAP beats everything",
  sideAddOn(["front", "back"], FEES, { sidePrice: { back: 9 } }), 9)
check("a platform per-face rate beats a product FLAT",
  sideAddOn(["front", "back"], FEES, { sidePrice: 7 }), 3.5)
check("…and that flat applies where no per-face rate exists",
  sideAddOn(["front", "pocket"], FEES, { sidePrice: 7 }), 7)
check("with no product rate at all, method_side is the floor",
  sideAddOn(["front", "pocket"], FEES, null), 2)

console.log("\nTHE BREAKDOWN NAMES EVERY CHARGE")
{
  const b = sideBreakdown(["front", "back", "sleeve"], FEES, null)
  check("included face is named", b.included, "front")
  check("one part per charged face", b.parts.map((p) => p.face), ["back", "sleeve"])
  check("each part carries its own amount", b.parts.map((p) => p.amount), [3.5, 1.5])
}

console.log("\nTHE PICKER QUOTES WHAT THE CHARGE WILL USE")
{
  /* The designer's face rail prints a price on a tile BEFORE anyone prints there, so it has
     to resolve rates the same way. It used to read the platform keys only, so a product with
     its own map showed the flat rate on every face and the summary then charged something
     else -- the one thing the rail's own note forbids. */
  const prod = { sidePrice: { back: 4, left: 5, front: 3 } }
  const rates = sideRates(FEES, prod)
  check("a product's map reaches the rail", [rates.back, rates.left], [4, 5])
  check("a platform per-face rate still shows", rates.sleeve, 1.5)
  check("everything else falls to the flat", rates.hood, 2)
  /* And the tile agrees with the invoice: charging back+front+left must equal the rail's
     own numbers for the two that are not included. */
  check("rail figures sum to the charge",
    sideAddOn(["back", "front", "left"], FEES, prod), rates.back + rates.left)
}

/* ---- the invariant: an explanation may never disagree with the charge ----------------- */
console.log("\nPARTS SUM TO THE CHARGE, on every combination")
const FACES = ["front", "back", "sleeve", "pocket", "hood"]
let combos = 0
for (let mask = 1; mask < 1 << FACES.length; mask++) {
  const faces = FACES.filter((_, i) => mask & (1 << i))
  for (const d of [null, { sidePrice: 4 }, { sidePrice: { back: 9, hood: 6 } }]) {
    const total = sideAddOn(faces, FEES, d)
    const sum = sideBreakdown(faces, FEES, d).parts.reduce((n, p) => n + p.amount, 0)
    combos++
    if (Math.abs(total - sum) > 0.005) {
      bad++
      console.log(`  FAIL ${faces.join("+")} — charge ${money(total)} vs breakdown ${money(sum)}`)
    }
  }
}
console.log(`  ${bad ? "" : "ok  "}${combos} face combinations × rate sets, charge === sum(parts)`)

/* ---- every tier has somewhere to be SET ------------------------------------------------
 * The engine's own note used to claim the per-face rates "can only be set by writing fee
 * keys directly". That was true once and quietly stopped being true, and it was quoted back
 * as fact twice — an owner set a rate in SQL that the UI had a field for. A comment about
 * what is MISSING rots silently, because nothing fails when the gap is filled. This asserts
 * the editors exist, so the claim in pricing.js is checkable rather than remembered.
 */
console.log("\nEVERY TIER HAS AN EDITOR")
{
  const { readFileSync } = await import("node:fs")
  const { join, dirname } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const root = join(dirname(fileURLToPath(import.meta.url)), "..")
  const settings = readFileSync(join(root, "web/components/app/settings-view.tsx"), "utf8")

  check("Settings writes the flat rate", /setBand\("method_side"/.test(settings), true)
  check("Settings writes a rate per face", /setBand\(`side_\$\{face\}`/.test(settings), true)

  /* The product's own map is the highest tier, so it needs an editor too — the Placement
     grid on the blank itself. */
  const anySidePrice = ["web/components/app/product-editor-dialog.tsx", "web/components/app/products-catalog.tsx"]
    .map((f) => { try { return readFileSync(join(root, f), "utf8") } catch { return "" } })
    .some((src) => /sidePrice/.test(src))
  check("the product editor writes sidePrice", anySidePrice, true)
}

console.log(bad ? `\n${bad} failure(s).` : "\nSide pricing holds, and every breakdown sums to its charge.")
process.exit(bad ? 1 : 0)
