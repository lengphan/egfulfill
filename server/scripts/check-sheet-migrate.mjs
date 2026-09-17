/**
 * A SAVED DRAFT, READ FORWARD — executed, not read.
 *
 * `order_sheets.rows` is positional: the grid verbatim, no header. So the meaning of cell 14
 * depends entirely on which column list was live when it was written, and every column added
 * to the sheet shifts every cell after it on every draft already stored. Three such moves
 * have happened; two of them were found only because somebody reopened a sheet and saw the
 * store name under a heading that wasn't its own.
 *
 * Reading migrate() cannot tell you whether the indexes are right — that is precisely the
 * kind of code that looks correct and is off by one. So this builds a row whose every cell
 * NAMES ITS OWN OLD COLUMN, runs the real migrate(), and asserts each value landed under the
 * header of the same name in today's list.
 *
 *   node server/scripts/check-sheet-migrate.mjs
 *
 * No database and no network: migrate() is pure, which is why it was lifted to module scope.
 */
import { migrate } from '../src/routes/order_sheets.js';

// The 32-column list exactly as it stood before Type moved onto the placements. Hard-coded
// on purpose: it is a historical fact about rows already in the database, and deriving it
// from today's CSV_COLUMNS would make the test agree with whatever the code does.
const PRE_TYPE = [
  'Order Number', 'Ship Name', 'Ship Address 1', 'Ship Address 2', 'Ship City', 'Ship State',
  'Ship Zip', 'Ship Email', 'Product Title', 'Listing SKU', 'Blank Product', 'Quantity',
  'Print Type', 'Color', 'Size',
  'Placement 1', 'Artwork/Template 1', 'Machine File 1',
  'Placement 2', 'Artwork/Template 2', 'Machine File 2',
  'Placement 3', 'Artwork/Template 3', 'Machine File 3',
  'Placement 4', 'Artwork/Template 4', 'Machine File 4',
  'Placement 5', 'Artwork/Template 5', 'Machine File 5',
  'Store Name', 'Internal Notes',
];

// Today's list, read from the client contract so the two can never drift apart silently.
const src = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../../web/lib/order-import.ts', import.meta.url), 'utf8'));
const TODAY = [...src.match(/export const CSV_COLUMNS[\s\S]*?\n\]/)[0]
  .matchAll(/header: "([^"]+)"/g)].map((m) => m[1]);

const pass = [], fail = [];
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? pass : fail).push({ label, got, want });
};

// A row whose every cell is the name of the column it sits in, plus a real method.
const row = PRE_TYPE.map((h) => (h === 'Print Type' ? 'Embroidery' : h));
const [out] = migrate([row], 32);

t('the row comes back at today\'s width', out.length, TODAY.length);

// EVERY value that existed before must sit under its own header now.
for (const h of PRE_TYPE) {
  if (h === 'Print Type') continue;                    // it is the one column that leaves
  t(`"${h}" lands under "${h}"`, out[TODAY.indexOf(h)], h);
}

// ...and the method it carried is on every position rather than lost.
for (const n of [1, 2, 3, 4, 5]) {
  t(`Type ${n} carries the row's old method`, out[TODAY.indexOf(`Type ${n}`)], 'Embroidery');
}

// A sheet already in today's shape is returned untouched — the guard, not the steps.
const current = TODAY.map((h) => h);
t('a current-width row is left alone', migrate([current], TODAY.length)[0], current);

// An empty method does not scatter blanks that mean something else.
const noMethod = PRE_TYPE.map((h) => (h === 'Print Type' ? '' : h));
t('no method stays no method', migrate([noMethod], 32)[0][TODAY.indexOf('Type 1')], '');

for (const r of pass) console.log(`  PASS  ${r.label}`);
for (const r of fail) console.log(`  FAIL  ${r.label}\n        want ${JSON.stringify(r.want)}\n        got  ${JSON.stringify(r.got)}`);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
