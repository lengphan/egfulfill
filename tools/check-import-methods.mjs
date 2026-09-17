/**
 * ONE METHOD PER POSITION — executed against the real parser.
 *
 * The import sheet's column list is a CONTRACT and it is hand-mirrored in two places:
 * CSV_COLUMNS (web/lib/order-import.ts) and T_COLUMNS (server/src/routes/sheets.js), with
 * the file's own comment admitting "there is no automated guard against it drifting again"
 * — which it had, badly, once: 15 columns against the front-end's 21, so a sheet this route
 * handed out was missing columns the importer reads and the lines arrived unmakeable.
 *
 * This is that guard, plus the rule the guard exists for. It RUNS parseCSV over both shapes
 * of sheet — one with a Type on each placement, one written before Type existed — and
 * asserts what came out, rather than reading the parser and believing it.
 *
 *   node tools/check-import-methods.mjs
 *
 * No network, no database, no build step: it loads the TypeScript through the jiti that
 * already ships inside web/.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const { createJiti } = createRequire(join(WEB, 'package.json'))('jiti');
const jiti = createJiti(join(WEB, 'noop.js'), { alias: { '@': WEB }, interopDefault: true });
const { TEMPLATE_HEADERS, parseCSV, rowsToRecords, groupToOrders } = await jiti.import(join(WEB, 'lib/order-import.ts'));
/* parseCSV gives back the grid; rowsToRecords is what turns it into lines, and
   groupToOrders is what a line finally becomes. Drive the same pair the dialog does. */
const parse = (text) => {
  const { records } = rowsToRecords(parseCSV(text));
  /* The ITEM is where a position lives — `sides` is built as a row becomes a line, which
     is the shape the import dialog then writes design rows from. */
  const item = groupToOrders(records)[0]?.items?.[0];
  return { records, item };
};

const pass = [], fail = [];
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? pass : fail).push({ label, got, want });
};

/* ── 1. THE TWO COLUMN LISTS ARE THE SAME LIST ───────────────────────────────────────── */
const T = readFileSync(join(ROOT, 'server/src/routes/sheets.js'), 'utf8')
  .match(/const T_COLUMNS = \[[\s\S]*?\n\];/)[0];
const serverCols = [...T.matchAll(/h: '([^']+)'/g)].map((m) => m[1]);
t('server T_COLUMNS mirrors CSV_COLUMNS exactly', serverCols, TEMPLATE_HEADERS);

/* ── 2. A SHEET THAT NAMES A METHOD PER POSITION ─────────────────────────────────────── */
const row = (cells) => TEMPLATE_HEADERS.map((h) => cells[h] ?? '').join(',');
const csv = (cells) => TEMPLATE_HEADERS.join(',') + '\n' + row(cells);

const shipTo = {
  'Ship Name': 'Jane Buyer', 'Ship Address 1': '42 Maple Street', 'Ship City': 'Portland',
  'Ship State': 'OR', 'Ship Zip': '97201', 'Blank Product': 'EG-1001 - Gildan 18500 Hoodie',
  'Order Number': 'FF-1043',
};
const mixed = parse(csv({
  ...shipTo,
  'Placement 1': 'Front', 'Type 1': 'Embroidery', 'Artwork/Template 1': 'IMG-30', 'Machine File 1': 'MF-12',
  'Placement 2': 'Back', 'Type 2': 'DTG printing', 'Artwork/Template 2': 'IMG-31',
}));
t('the mixed row is valid', mixed.records?.[0]?._valid, true);
const sides = mixed.item?.sides;
t('both positions come through', sides?.map((s) => s.side), ['front', 'back']);
t('each position keeps its own method', sides?.map((s) => s.method), ['Embroidery', 'DTG printing']);
t('a stitch file on the embroidered face raises nothing', mixed.records[0]._warnings, '');

/* ── 3. THE CHECK THAT COULD NOT BE ASKED BEFORE ─────────────────────────────────────── */
// Same garment, stitch file on the DTG back. One row-level method could never refuse this
// one without also refusing the legitimate file on the front.
const wrongFile = parse(csv({
  ...shipTo,
  'Placement 1': 'Front', 'Type 1': 'Embroidery', 'Artwork/Template 1': 'IMG-30', 'Machine File 1': 'MF-12',
  'Placement 2': 'Back', 'Type 2': 'DTG printing', 'Artwork/Template 2': 'IMG-31', 'Machine File 2': 'MF-19',
}));
const w = wrongFile.records[0]._warnings;
t('the DTG back\'s stitch file is named', /Machine File 2/.test(w), true);
t('the embroidered front\'s is not', /Machine File 1/.test(w), false);

/* ── 4. A SHEET WRITTEN BEFORE TYPE EXISTED ──────────────────────────────────────────── */
// The row-level column is gone from the template and still read, so this must import to
// exactly what it imported to before: one method, on every position.
const legacyHeaders = [...TEMPLATE_HEADERS.filter((h) => !/^Type \d$/.test(h))];
legacyHeaders.splice(legacyHeaders.indexOf('Color'), 0, 'Print Type');
const legacyCells = {
  ...shipTo, 'Print Type': 'Embroidery',
  'Placement 1': 'Front', 'Artwork/Template 1': 'IMG-30',
  'Placement 2': 'Back', 'Artwork/Template 2': 'IMG-31',
};
const legacy = parse(legacyHeaders.join(',') + '\n' + legacyHeaders.map((h) => legacyCells[h] ?? '').join(','));
t('an old sheet still imports', legacy.records?.[0]?._valid, true);
t('its one method reaches every position',
  legacy.item?.sides?.map((s) => s.method), ['Embroidery', 'Embroidery']);

/* ── 5. NOTHING SAID ANYWHERE ────────────────────────────────────────────────────────── */
// The column help has always promised this, and it must stay true now that the promise is
// made per position rather than per row.
const silent = parse(csv({
  ...shipTo, 'Placement 1': 'Front', 'Artwork/Template 1': 'IMG-30',
}));
t('no method anywhere still means DTG', silent.item?.printType, 'DTG printing');

/* ── 6. A TYPE ALONE IS NOT A FACE ───────────────────────────────────────────────────── */
// Five Type cells ride on every row; a filled one in an unused block must not invent a
// position, or the migration that copies an old method into all five would create four.
const strays = parse(csv({
  ...shipTo,
  'Placement 1': 'Front', 'Type 1': 'Embroidery', 'Artwork/Template 1': 'IMG-30',
  'Type 2': 'Embroidery', 'Type 3': 'Embroidery', 'Type 4': 'Embroidery', 'Type 5': 'Embroidery',
}));
t('a Type with no placement creates no face', strays.item?.sides, undefined);

for (const r of pass) console.log(`  PASS  ${r.label}`);
for (const r of fail) console.log(`  FAIL  ${r.label}\n        want ${JSON.stringify(r.want)}\n        got  ${JSON.stringify(r.got)}`);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
