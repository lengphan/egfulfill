/**
 * BACKFILL `order_items.cost_parts` FOR LINES CHARGED BEFORE IT EXISTED — but only where the
 * arithmetic proves what the answer is.
 *
 * freezeQuote stamps the split (blank, print method, one row per extra printed face) beside
 * the price from now on, so a charged summary can name the face a surcharge paid for. Every
 * line charged before that has `unit_cost` and nothing else, and the summary falls back to a
 * single row that cannot say which face — which is the vague answer the stamp exists to stop.
 *
 * WHAT MAKES A BACKFILL SAFE HERE. This writes no price and changes no history: it records a
 * fact that is already derivable, and only when it is derivable WITHOUT AMBIGUITY. For each
 * unstamped line we recompute today's blank + method + faces and ask one question:
 *
 *     unit_cost − base − method  ==  the sum of today's face charges?
 *
 * If it balances, today's faces at today's rates are exactly what was billed, and stamping
 * them records what happened. If it does not — a face was added after the charge, or a rate
 * moved since — then what was billed is genuinely not recoverable and the line is LEFT ALONE.
 * Guessing there would be worse than the vague row: it would name a face that never paid.
 *
 *   docker compose exec -T api node scripts/backfill-cost-parts.mjs          # report only
 *   docker compose exec -T api node scripts/backfill-cost-parts.mjs --apply  # write
 *
 * Re-runnable: `where cost_parts is null` means an applied line is never revisited.
 */
import { q } from '../src/db.js'
import { catalogIndex, feeSettings, priceLines } from '../src/pricing.js'

const APPLY = process.argv.includes('--apply')
const near = (a, b) => Math.abs(a - b) < 0.005

const [fees, idx] = await Promise.all([feeSettings(), catalogIndex({ withImages: false })])

/* Charged lines only: unit_cost is what freezeQuote wrote, so a null one was never charged
   and has nothing to stamp. */
const rows = (await q(`
  select i.id, i.order_id, i.line_id, i.sku, i.name, i.qty, i.size, i.blank, i.print_type,
         i.unit_cost, i.ship_fee
    from order_items i
   where i.cost_parts is null and i.unit_cost is not null
   order by i.order_id`)).rows

/* The faces each line prints, exactly as quoteOrder reads them. */
const faceRows = (await q(`
  select order_id, coalesce('L:' || line_id, 'S:' || sku) as key,
         array_agg(distinct lower(coalesce(side,'front'))) as faces
    from order_designs group by 1, 2`)).rows
const byKey = new Map(faceRows.map((r) => [`${r.order_id}|${r.key}`, r.faces]))

let stamped = 0, skipped = 0, unpriced = 0
const cannot = []

for (const it of rows) {
  const faces = byKey.get(`${it.order_id}|${it.line_id ? `L:${it.line_id}` : `S:${it.sku}`}`) || ['front']
  const { lines } = priceLines([it], idx, fees, () => faces)
  const l = lines[0]
  if (!l) { unpriced++; continue }

  const parts = l.sideParts?.parts ?? []
  const sideTotal = parts.reduce((n, p) => n + p.amount, 0)
  const base = Number(l.baseCost)
  const method = Number(l.methodFee) || 0
  /* No catalogue base means there is nothing to subtract, so nothing can be proved. */
  if (!Number.isFinite(base)) { skipped++; cannot.push([it.order_id, it.line_id || it.sku, 'no base cost']); continue }

  const billedSides = Number(it.unit_cost) - base - method
  if (!near(billedSides, sideTotal)) {
    skipped++
    cannot.push([it.order_id, it.line_id || it.sku,
                 `billed ${billedSides.toFixed(2)} vs today ${sideTotal.toFixed(2)} (${parts.map((p) => p.face).join('+') || 'none'})`])
    continue
  }

  stamped++
  if (APPLY) {
    await q('update order_items set cost_parts=$1 where id=$2 and cost_parts is null', [
      JSON.stringify({ base, method, included: l.sideParts?.included ?? null, sides: parts }),
      it.id,
    ])
  }
}

console.log(`${APPLY ? 'STAMPED' : 'would stamp'}: ${stamped}`)
console.log(`left alone (not provable): ${skipped}`)
console.log(`unpriced (no catalogue row): ${unpriced}`)
console.log(`total charged lines with no stamp: ${rows.length}`)
if (cannot.length) {
  console.log('\n-- left alone --')
  for (const [o, l, why] of cannot.slice(0, 40)) console.log(`  ${o}  ${l}  ${why}`)
  if (cannot.length > 40) console.log(`  … and ${cannot.length - 40} more`)
}
process.exit(0)
