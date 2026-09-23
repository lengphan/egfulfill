/**
 * WHAT A MIXED LINE COSTS — executed against the real ladder.
 *
 * A garment can be embroidered on the front and printed on the back. The method surcharge
 * has always been charged ONCE per line, so one of the two is the one the base already pays
 * for, and which one has to be a rule or the same garment prices two ways. The rule is
 * CHEAPEST-INCLUDED: the line is billed at the dearest of its faces.
 *
 * THE FIGURES MOVED ON PURPOSE, TWICE, AND THIS GATE DID NOT (triaged 2026-09-23).
 *
 * It was written to hold the pre-mixed-method numbers still — "not one of them may move by a
 * cent". Two owner decisions then moved every one of them, and because the gate was not run
 * after either, it had been red for days and said nothing:
 *
 *   2026-09-18  every face is charged, the first one included. A one-face line gained a
 *               placement it never carried, so EMB front went 24.00 -> 27.00.
 *   2026-09-21  ONE placement per line; every face after the first pays its own METHOD's
 *               run, not a placement. So EMB front+back went 28.50 -> 33.00: the back's
 *               4.50 placement became a 6.00 embroidery run.
 *
 * Both are documented at sideDetail() in server/src/pricing.js. Every `want` below is now
 * written as its arithmetic rather than as a bare figure, so the next person to move the rule
 * can see WHICH term changed instead of diffing two constants.
 *
 * A CONSEQUENCE WORTH KNOWING: `side_back` / `side_sleeve` now only ever reach the FIRST
 * printed face. A per-face placement rate on a face that is never first is dead configuration.
 *
 *   node tools/check-mixed-method-price.mjs
 *
 * No database: priceLines takes its catalogue and its fee table as arguments, which is
 * exactly what makes it testable without one.
 */
import { priceLines, billingMethodOf } from '../server/src/pricing.js';

const row = { id: 1, sku: 'EG-1001', base_price: 18, data: { name: 'Hoodie', sku: 'EG-1001', basePrice: 18 } };
const idx = { exact: new Map([['EG-1001', row]]), rows: [row] };
const fees = { method_emb: 6, method_dtf: 2, method_dtg: 0, method_side: 3, side_back: 4.5, side_sleeve: 2, ship_garment: 0, ship_extra: 0 };

const pass = [], fail = [];
const t = (label, got, want) => {
  const ok = typeof want === 'number' ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  (ok ? pass : fail).push({ label, got, want });
};
const line = (item, faces) => priceLines([{ id: 1, sku: 'EG-1001', qty: 1, ...item }], idx, fees, () => faces).lines[0];
const unit = (item, faces) => line(item, faces).unitCost;

/* ── 1. NOTHING ALREADY BILLED MOVES ─────────────────────────────────────────────────── */
// Single-method lines, which is every line in the database. A max over one distinct value is
// that value, so the mixed-method rule leaves all of these exactly where sideDetail puts them.
//                                                        garment + method + faces
t('EMB, front only', unit({ print_type: 'Embroidery' }, ['front']), 18 + 6 + 3);
t('EMB, front + back', unit({ print_type: 'Embroidery' }, ['front', 'back']), 18 + 6 + 3 + 6);
t('DTG, front only', unit({ print_type: 'DTG printing' }, ['front']), 18 + 0 + 3);
// A second DTG face is FREE: its run is method_dtg, which is 0. The back's 4.50 placement
// does not apply — only the first face carries a placement at all.
t('DTG, front + back', unit({ print_type: 'DTG printing' }, ['front', 'back']), 18 + 0 + 3 + 0);
t('EMB, three faces', unit({ print_type: 'Embroidery' }, ['front', 'back', 'sleeve']), 18 + 6 + 3 + 6 + 6);
// A caller that hands back a COUNT gets face-1 as 'front' and the rest as face-N, which are
// not in PRICED_SIDES — they still pay their run, because the run follows the method.
t('a bare count still prices', unit({ print_type: 'Embroidery' }, 2), 18 + 6 + 3 + 6);

/* ── 2. THE MIXED LINE ───────────────────────────────────────────────────────────────── */
const mixed = [{ side: 'front', method: 'Embroidery' }, { side: 'back', method: 'DTG printing' }];
const flipped = [{ side: 'front', method: 'DTG printing' }, { side: 'back', method: 'Embroidery' }];
// Billed at EMB either way — but the UNIT differs, and that is not a contradiction: the
// method surcharge is order-independent, the per-face runs are not. Front-EMB/back-DTG buys
// one embroidery run and one free DTG run; the other way round buys two runs, one of each.
t('front EMB / back DTG bills at the dearer', unit({ print_type: 'Embroidery' }, mixed), 18 + 6 + 3 + 0);
t('and the same the other way round', unit({ print_type: 'DTG printing' }, flipped), 18 + 6 + 3 + 6);
t('the line says which method the money was for', line({ print_type: 'DTG printing' }, flipped).billedMethod, 'Embroidery');
t('and what is actually on the garment', line({ print_type: 'DTG printing' }, flipped).methods, ['DTG printing', 'Embroidery']);
t('DTF front / DTG back', unit({ print_type: 'DTF printing' }, [{ side: 'front', method: 'DTF printing' }, { side: 'back', method: 'DTG printing' }]), 18 + 2 + 3 + 0);

/* ── 3. A FACE THAT SAYS NOTHING INHERITS THE LINE ───────────────────────────────────── */
// order_designs.method is null whenever a face agrees with its line, which is every row
// written before per-face methods existed. Absent must mean inherit, never "no method".
t('a silent face takes the line\'s method',
  unit({ print_type: 'Embroidery' }, [{ side: 'front', method: '' }, { side: 'back', method: '' }]), 18 + 6 + 3 + 6);
// The back SPEAKS, and says DTG — so it buys a DTG run (free), not an embroidery one. This is
// the check that would catch a silent face being read as "no method" instead of "inherit".
t('one silent, one speaking',
  unit({ print_type: 'Embroidery' }, [{ side: 'front', method: '' }, { side: 'back', method: 'DTG printing' }]), 18 + 6 + 3 + 0);

/* ── 4. THE BLANK PRICE IS THE GARMENT, NOT AN EXCEPTION ─────────────────────────────── */
// This section used to guard a trap that no longer exists. The bare-blank price once REPLACED
// the base, so an import leaving print_type empty could charge an embroidered hoodie as an
// undecorated one — hence "a face with a method is NOT a blank line", which wanted the full
// 18.00 base back.
//
// Since 2026-09-18 `blank` IS the base for every line: price = blank + method + Σ faces. So
// 9.00 is the garment on all four of these and nothing needs rescuing — what separates a
// blank from a print is now the absence of a method and a face, not a different base.
// The checks are kept, re-aimed at the rule that replaced the trap.
const withBlank = { id: 2, sku: 'EG-2001', base_price: 18,
  data: { name: 'Hoodie', sku: 'EG-2001', basePrice: 18, sizePrices: [{ size: 'L', blank: 9 }] } };
const idx2 = { exact: new Map([['EG-2001', withBlank]]), rows: [withBlank] };
const unit2 = (item, faces) => priceLines([{ id: 2, sku: 'EG-2001', qty: 1, size: 'L', ...item }], idx2, fees, () => faces).lines[0].unitCost;
// An EMPTY method is "nobody has decided yet", never "bare garment" (A BLANK IS SAID, NOT
// INFERRED). So this line is still going to be printed: it pays the garment and one placement,
// and picks up a method surcharge the moment a face names one.
t('an undecided line is not a blank', unit2({ print_type: '' }, ['front']), 9 + 0 + 3);
t('a face with a method is charged for it',
  unit2({ print_type: '' }, [{ side: 'front', method: 'Embroidery' }]), 9 + 6 + 3);
// BLANK is said. Saying it empties the face list, so no placement is charged either — the one
// path on which the garment price stands completely alone.
t('BLANK is the garment and nothing else', unit2({ print_type: 'BLANK' }, ['front']), 9.00);
t('and so is Blank Only, the word the UI stores', unit2({ print_type: 'Blank Only' }, ['front']), 9.00);

/* ── 5. THE RESOLVER, NOT A TABLE OF TECHNIQUES ──────────────────────────────────────── */
// A product may override what its own methods cost. "EMB beats DTG" written as a ranking
// would bill the cheaper one on this blank.
const odd = { id: 3, sku: 'EG-3001', base_price: 18,
  data: { name: 'Cap', sku: 'EG-3001', basePrice: 18, methodPrices: { DTG: 9, EMB: 1 } } };
t('dearest is read from the product, not assumed',
  billingMethodOf(['Embroidery', 'DTG printing'], odd.data, fees), 'DTG printing');
t('ties keep the first, so the answer is stable',
  billingMethodOf(['DTF printing', 'Appliqué'], { methodPrices: { DTF: 5, APL: 5 } }, fees), 'DTF printing');
t('nothing named answers nothing', billingMethodOf(['', '  '], {}, fees), null);

for (const r of pass) console.log(`  PASS  ${r.label}`);
for (const r of fail) console.log(`  FAIL  ${r.label}\n        want ${JSON.stringify(r.want)}\n        got  ${JSON.stringify(r.got)}`);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
