/**
 * MONEY GUARD: nothing may be priced at zero, and "unknown" must never become "free".
 *
 * The cost ladder in server/src/pricing.js has five rungs — the size's blank price, the size's
 * price, the size's cost + markup, the product's base price, the product's supplier cost +
 * markup — and every one of them requires a POSITIVE number except, until 2026-08-24, the
 * product's base price. A supplier sync writes `productCost` and leaves `base_price` at 0
 * until a human prices it, so 0 arrived as a real base of zero, the rung underneath never ran,
 * and the line quoted $0.00 for a garment we pay $6.08 for. Six of thirty catalogue products
 * were in that state.
 *
 * That is the failure this file exists to make loud. A quote is what the wallet is charged, so
 * a zero here is not a display bug — it is an order fulfilled for nothing.
 *
 * THE TWO RULES, and they are different on purpose:
 *   · a product with ANY positive cost anywhere must price above zero
 *   · a product with NOTHING must price to null — unpriceable, so the submit gate refuses it
 *     — and never to 0, because "we don't know" and "it's free" are opposite answers.
 *
 * Runs the REAL sellerBaseCostOf, which walks the same costPartsOf ladder unitCostOf charges
 * on. Reading the ladder is what missed this; this executes it.
 *
 *   node tools/check-price-floor.mjs
 */
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
/* pricing.js imports db.js, which builds a Pool at module load — a Pool does not connect until
   it is queried, so a bogus URL is enough. Nothing here touches the database. */
process.env.DATABASE_URL ||= 'postgres://x:x@127.0.0.1:1/x'
const { sellerBaseCostOf } = await import(path.join(ROOT, 'server/src/pricing.js'))

/** The fee settings a quote runs on. `base_markup` is a flat amount over supplier cost. */
const FEES = { base_markup: 5, method_emb: 5, method_dtg: 0, ship_extra: 2 }

const CASES = [
  {
    what: 'supplier sync: base_price 0, real productCost (6 live products are exactly this)',
    row: { id: 'SS-10892', sku: '10892', base_price: 0, data: { name: 'Adams Headwear LP104', productCost: 6.08 } },
    want: 11.08,
  },
  {
    what: 'base_price 0 and no cost either — unpriceable, NOT free',
    row: { id: 'x', sku: 'X', base_price: 0, data: { name: 'Nothing priced' } },
    want: null,
  },
  {
    what: 'a hand-priced product uses its own base',
    row: { id: 'y', sku: 'Y', base_price: 12.5, data: { name: 'Priced by hand' } },
    want: 12.5,
  },
  {
    what: 'a size tier beats the product base, and the DEAREST size wins',
    row: { id: 'z', sku: 'Z', base_price: 7, data: { name: 'Tiered', sizePrices: [{ size: 'M', price: 9 }, { size: '3XL', price: 14 }] } },
    want: 14,
  },
  {
    what: 'a zero tier is an empty field too — fall through to the product base',
    row: { id: 'w', sku: 'W', base_price: 8, data: { name: 'Zero tier', sizePrices: [{ size: 'M', price: 0 }] } },
    want: 8,
  },
  {
    what: 'a size COST + markup, when only the supplier price is known per size',
    row: { id: 'v', sku: 'V', base_price: 0, data: { name: 'Cost tiers', sizePrices: [{ size: 'M', cost: 4 }] } },
    want: 9,
  },
]

const fail = []
for (const c of CASES) {
  const got = sellerBaseCostOf(c.row, FEES)
  const ok = c.want == null ? got == null : got != null && Math.abs(got - c.want) < 0.005
  if (!ok) fail.push(`${c.what}\n      got ${got === null ? 'null' : got}, expected ${c.want === null ? 'null (unpriceable)' : c.want}`)
  // The rule above the fixtures: a positive cost anywhere may never come out as zero.
  if (got === 0) fail.push(`${c.what}\n      priced at ZERO — a line quoted at 0 is an order fulfilled for nothing`)
}

if (fail.length) {
  console.error('The cost ladder is wrong:\n')
  for (const f of fail) console.error('  ✗ ' + f)
  console.error('\nThis is the money path. A quote is what the wallet is charged.')
  process.exit(1)
}
console.log(`server/src/pricing.js prices ${CASES.length} cases correctly:`)
console.log('zero is treated as an empty field at every rung, and nothing unpriceable comes out as free.')
