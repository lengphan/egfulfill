// Standalone check of the order pricing formula — no DB needed:
//   cd server && node check-pricing.mjs
//
// Guards the money math in src/pricing.js. The formula is "first unit pays its
// variant's shipping, every OTHER UNIT pays ship_extra" — the subtle part is units vs
// lines: 3× of one tee is three units in one parcel, so it must cost the same as three
// separate single-tee lines. If those two ever diverge, this catches it.
import { computeTotals } from './src/pricing.js';

const fees = { ship_first: 5, ship_extra: 2 };
let failed = 0;

function check(name, lines, want) {
  const r = computeTotals(lines, fees);
  const ok = Math.abs(r.total - want) < 0.005;
  if (!ok) failed++;
  console.log(
    (ok ? 'PASS' : 'FAIL').padEnd(5),
    name.padEnd(42),
    `sub $${r.subtotal.toFixed(2).padStart(6)}`,
    `ship $${r.shipping.toFixed(2).padStart(6)}`,
    `= $${r.total.toFixed(2).padStart(6)}`,
    ok ? '' : `  WANTED $${want.toFixed(2)}`
  );
}

check('3x tee (one line, qty 3)', [{ unitCost: 8, qty: 3, shipFee: 5 }], 33);
check('3x tee (three lines, qty 1)', [
  { unitCost: 8, qty: 1, shipFee: 5 }, { unitCost: 8, qty: 1, shipFee: 5 }, { unitCost: 8, qty: 1, shipFee: 5 },
], 33);
check('single item', [{ unitCost: 8, qty: 1, shipFee: 5 }], 13);
check('hoodie $9 ship + 2 caps $4', [{ unitCost: 18, qty: 1, shipFee: 9 }, { unitCost: 6, qty: 2, shipFee: 4 }], 43);
check('size-priced 2XL (cost 12.50)', [{ unitCost: 12.5, qty: 2, shipFee: 5 }], 32);
check('empty order', [], 0);
check('rounding: 3x $8.33', [{ unitCost: 8.33, qty: 3, shipFee: 5 }], 33.99);
check('free blank still pays shipping', [{ unitCost: 0, qty: 1, shipFee: 5 }], 5);

console.log(failed ? `\n${failed} FAILED` : '\nAll pricing checks passed.');
process.exit(failed ? 1 : 0);
