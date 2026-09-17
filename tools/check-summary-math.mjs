#!/usr/bin/env node
/**
 * THE SUMMARY MUST ADD UP TO ITS OWN TOTAL.
 *
 * Shipping and the volume discount moved out of order-level rows and onto the items that
 * caused them (owner, 2026-09-17), which means the summary now does arithmetic the server
 * does not: it splits one postage figure across lines and one discount across goods. Two
 * roundings enter there, and a breakdown that lands a cent away from the total it is
 * breaking down is worse than one that never broke the figure down — a seller checking a
 * charge finds a number that cannot be reconciled and has no way to tell which half is
 * wrong.
 *
 * Both halves are reproduced here: pricing.js's model (dearest line's postage + extra per
 * other unit; discount off the goods only) and page.tsx's split. If they ever disagree this
 * fails, which is the only way to notice — nothing on screen shows the two side by side.
 *
 * Run: node tools/check-summary-math.mjs
 */
const money = (n) => Math.round(n * 100) / 100
let bad = 0
const check = (l, got, want) => {
  const ok = Math.abs(got - want) < 0.005
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}  ${got.toFixed(2)}${ok ? '' : ` != ${want.toFixed(2)}`}`)
}

function run(name, lines, pct) {
  // ── the server (pricing.js) ──
  const subtotal = money(lines.reduce((n, l) => n + l.unitCost * l.qty, 0))
  const units = lines.reduce((n, l) => n + l.qty, 0)
  const first = lines.reduce((a, b) => (b.shipFee > a.shipFee ? b : a), lines[0])
  const extra = first.extraFee != null ? first.extraFee : 2
  const shipping = money(first.shipFee + extra * (units - 1))
  const volumeDiscount = money(subtotal * (pct / 100))
  const total = Math.max(0, money(subtotal + shipping - volumeDiscount))

  // ── the client (page.tsx) ──
  const dRatio = subtotal > 0 ? volumeDiscount / subtotal : 0
  let sumHeadings = 0, sumShip = 0, sumDisc = 0
  lines.forEach((l, i) => {
    const qty = l.qty
    const isShipLine = first === l
    const shipOwn = (isShipLine ? l.shipFee : 0) + extra * (isShipLine ? qty - 1 : qty)
    const goods = l.unitCost * qty
    const isLast = i === lines.length - 1
    const shareBefore = lines.slice(0, i).reduce((n, x) => n + Math.round(x.unitCost * x.qty * dRatio * 100) / 100, 0)
    const discOwn = isLast
      ? Math.max(0, Math.round((volumeDiscount - shareBefore) * 100) / 100)
      : Math.round(goods * dRatio * 100) / 100
    /* THE DISCOUNT IS NOW SPLIT AGAIN, across the goods ROWS within the item — blank plus one
       per surface — with the last row absorbing that item's remainder. A second rounding on
       top of the first, so it is checked on its own: the struck-through figures have to add
       back up to the item's share or the rows and the heading disagree on screen. */
    const rowAmounts = l.rows ?? [goods]
    const rowsSum = rowAmounts.reduce((n, a) => n + a, 0)
    let taken = 0
    const cuts = rowAmounts.map((a, j) => {
      if (discOwn <= 0.005 || rowsSum <= 0) return 0
      if (j === rowAmounts.length - 1) return Math.max(0, Math.round((discOwn - taken) * 100) / 100)
      const c = Math.round((a / rowsSum) * discOwn * 100) / 100
      taken += c
      return c
    })
    const cutSum = money(cuts.reduce((n, c) => n + c, 0))
    if (Math.abs(cutSum - discOwn) > 0.005) { bad++; console.log(`  FAIL row discounts on line ${i} sum ${cutSum} != item ${discOwn}`) }
    sumHeadings = money(sumHeadings + goods + shipOwn - discOwn)
    sumShip = money(sumShip + shipOwn); sumDisc = money(sumDisc + discOwn)
  })

  console.log(`\n${name}`)
  check('Σ per-item shipping = quote.shipping', sumShip, shipping)
  check('Σ per-item discount = quote.volumeDiscount', sumDisc, volumeDiscount)
  check('Σ item headings = quote.total', sumHeadings, total)
}

run('two items, one unit each, 10%',
  [{ unitCost: 25.46, qty: 1, shipFee: 6.99, extraFee: 2, rows: [17.46, 5, 3] },
   { unitCost: 5.99, qty: 1, shipFee: 3.50, extraFee: 2, rows: [5.99, 0] }], 10)
run('the DEARER line is second — postage must follow it',
  [{ unitCost: 5.99, qty: 1, shipFee: 3.50, extraFee: 2 }, { unitCost: 25.46, qty: 1, shipFee: 6.99, extraFee: 1.5 }], 0)
run('multi-unit line carries its own extras',
  [{ unitCost: 12.00, qty: 3, shipFee: 8.00, extraFee: 2 }, { unitCost: 4.00, qty: 2, shipFee: 3.00, extraFee: 2 }], 5)
run('a rate that does not divide cleanly — rounding must land somewhere',
  [{ unitCost: 10.01, qty: 1, shipFee: 5, extraFee: 2, rows: [3.33, 3.34, 3.34] },
   { unitCost: 10.01, qty: 1, shipFee: 5, extraFee: 2, rows: [3.33, 3.34, 3.34] },
   { unitCost: 10.01, qty: 1, shipFee: 5, extraFee: 2, rows: [3.33, 3.34, 3.34] }], 7)
run('no discount at all',
  [{ unitCost: 9.99, qty: 1, shipFee: 4, extraFee: 2 }], 0)
run('single item, many units',
  [{ unitCost: 7.50, qty: 4, shipFee: 6.00, extraFee: 1.25 }], 12.5)

console.log(bad ? `\n${bad} failure(s).` : '\nThe breakdown reconciles to its own total.')
process.exit(bad ? 1 : 0)
