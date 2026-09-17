/**
 * WHAT A MIXED LINE COSTS — executed against the real ladder.
 *
 * A garment can be embroidered on the front and printed on the back. The method surcharge
 * has always been charged ONCE per line, so one of the two is the one the base already pays
 * for, and which one has to be a rule or the same garment prices two ways. The rule is
 * CHEAPEST-INCLUDED: the line is billed at the dearest of its faces.
 *
 * The half that matters most here is not the new shape, it is the OLD one — every line in
 * the database carries a single method, and not one of them may move by a cent. That is what
 * most of these checks are: the same figures this ladder quoted before the rule existed.
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
// Every line in the database is single-method. These are the figures this ladder returned
// before the rule existed; a max over one distinct value is that value.
t('EMB, front only', unit({ print_type: 'Embroidery' }, ['front']), 24.00);
t('EMB, front + back', unit({ print_type: 'Embroidery' }, ['front', 'back']), 28.50);
t('DTG, front only', unit({ print_type: 'DTG printing' }, ['front']), 18.00);
t('DTG, front + back', unit({ print_type: 'DTG printing' }, ['front', 'back']), 22.50);
t('EMB, three faces', unit({ print_type: 'Embroidery' }, ['front', 'back', 'sleeve']), 30.50);
// A caller that hands back a COUNT, or nothing at all, still prices as it always did.
t('a bare count still prices', unit({ print_type: 'Embroidery' }, 2), 27.00);

/* ── 2. THE MIXED LINE ───────────────────────────────────────────────────────────────── */
const mixed = [{ side: 'front', method: 'Embroidery' }, { side: 'back', method: 'DTG printing' }];
const flipped = [{ side: 'front', method: 'DTG printing' }, { side: 'back', method: 'Embroidery' }];
t('front EMB / back DTG bills at the dearer', unit({ print_type: 'Embroidery' }, mixed), 28.50);
t('and the same the other way round', unit({ print_type: 'DTG printing' }, flipped), 28.50);
t('the line says which method the money was for', line({ print_type: 'DTG printing' }, flipped).billedMethod, 'Embroidery');
t('and what is actually on the garment', line({ print_type: 'DTG printing' }, flipped).methods, ['DTG printing', 'Embroidery']);
t('DTF front / DTG back', unit({ print_type: 'DTF printing' }, [{ side: 'front', method: 'DTF printing' }, { side: 'back', method: 'DTG printing' }]), 24.50);

/* ── 3. A FACE THAT SAYS NOTHING INHERITS THE LINE ───────────────────────────────────── */
// order_designs.method is null whenever a face agrees with its line, which is every row
// written before per-face methods existed. Absent must mean inherit, never "no method".
t('a silent face takes the line\'s method',
  unit({ print_type: 'Embroidery' }, [{ side: 'front', method: '' }, { side: 'back', method: '' }]), 28.50);
t('one silent, one speaking',
  unit({ print_type: 'Embroidery' }, [{ side: 'front', method: '' }, { side: 'back', method: 'DTG printing' }]), 28.50);

/* ── 4. THE TRAP: A BLANK IS A GARMENT NOBODY DECORATED ──────────────────────────────── */
// The bare-blank price REPLACES the base, and it used to be reached by reading the line's
// column alone. An import that puts every method in a placement block leaves that column
// empty — so this is an embroidered hoodie that would have been charged as an undecorated one.
const withBlank = { id: 2, sku: 'EG-2001', base_price: 18,
  data: { name: 'Hoodie', sku: 'EG-2001', basePrice: 18, sizePrices: [{ size: 'L', blank: 9 }] } };
const idx2 = { exact: new Map([['EG-2001', withBlank]]), rows: [withBlank] };
const unit2 = (item, faces) => priceLines([{ id: 2, sku: 'EG-2001', qty: 1, size: 'L', ...item }], idx2, fees, () => faces).lines[0].unitCost;
t('a real blank line still gets the blank price', unit2({ print_type: '' }, ['front']), 9.00);
t('a face with a method is NOT a blank line',
  unit2({ print_type: '' }, [{ side: 'front', method: 'Embroidery' }]), 24.00);

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
