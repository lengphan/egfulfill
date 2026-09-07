// Google Sheets order import. Reads a LINK-SHARED Google Sheet via the Sheets API
// (a single Cloud-Console API key — same project as Google Sign-In) and returns
// its cells as a 2D array. The front-end feeds that straight into the SAME import
// pipeline used for CSV/XLSX uploads (parseImportRows), so the preview, dedup and
// order-creation logic are shared — this route only fetches the rows.
//
// Why an API key (not OAuth): the seller shares their sheet "Anyone with the link
// → Viewer", so no per-user consent/token storage is needed. Reads only.
//
// Enable: in Google Cloud Console enable the "Google Sheets API", create an API
// key (optionally restrict it to the Sheets API), and set GOOGLE_SHEETS_API_KEY.
// Optionally set SHEETS_TEMPLATE_URL to a master template sheet sellers copy.

import crypto from 'crypto';
import { ourSku } from '../pricing.js';
import { q } from '../db.js';
import { productSizes, productColors } from '../variant-sku.js';
import { methodCode, methodLabel } from '../print-route.js';

const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_API_KEY || '';
const TEMPLATE_URL = process.env.SHEETS_TEMPLATE_URL || '';

// ── Service account (optional) — lets the server CREATE a ready-filled sheet ──
// A plain API key can only read; writing/creating a sheet needs a service account.
// Put the downloaded JSON key (verbatim, or base64) in GOOGLE_SERVICE_ACCOUNT.
function loadSA() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (e) { try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (e2) { return null; } }
}
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
let _saTok = null, _saExp = 0;
async function getServiceToken() {
  if (_saTok && Date.now() < _saExp - 60000) return _saTok;
  const sa = loadSA();
  if (!sa || !sa.client_email || !sa.private_key) throw new Error('no_service_account');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const sig = b64url(crypto.createSign('RSA-SHA256').update(header + '.' + claim).sign(sa.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(header + '.' + claim + '.' + sig)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('token: ' + (d.error_description || d.error || r.status));
  _saTok = d.access_token; _saExp = Date.now() + (d.expires_in || 3600) * 1000;
  return _saTok;
}

// ── Template definition ────────────────────────────────────────────────────
//
// MIRRORS web/lib/order-import.ts CSV_COLUMNS — same columns, same ORDER, same bands.
// Change one, change both. (The old list here had drifted badly: 15 columns against the
// front-end's 21, so a sheet created by this route was missing Blank, Template ID, Item
// Color/Size/Price and Image Link — columns the importer reads. The seller filled in what
// they were given and the lines still arrived "not set up for production".)
//
// The server can't import the .ts, so this is a hand-kept copy. There is no automated guard
// against it drifting again — if you add or reorder a column in CSV_COLUMNS, edit this list
// in the same commit.
const T_COLUMNS = [
  // g = SECTION, not obligation. Sorting by required-vs-optional pushed 'Ship Address 2'
  // four columns from the street it continues; obligation now rides on `duty` instead.
  // duty: 'req' (blocks the row) | 'asg' (fill it or we mint one) | '' (optional)
  { h: 'Order Number', g: 'order', duty: 'asg', sample: 'SAMPLE-1001' },
  { h: 'Ship Name', g: 'ship', duty: 'req', sample: 'Jane Sample — delete this row' },
  { h: 'Ship Address 1', g: 'ship', duty: 'req', sample: '42 Maple Street' },
  { h: 'Ship Address 2', g: 'ship', duty: '', sample: 'Apt 3B' },
  { h: 'Ship City', g: 'ship', duty: 'req', sample: 'Portland' },
  { h: 'Ship State', g: 'ship', duty: 'req', sample: 'OR', opts: 'states' },
  { h: 'Ship Zip', g: 'ship', duty: 'req', sample: '97201' },
  { h: 'Ship Email', g: 'ship', duty: '', sample: 'jane@example.com' },
  // OPTIONAL, and the Blank Product below is what took its asterisk. A title is what the
  // buyer's listing was called; the blank is what we actually cut and print. Mirrors
  // CSV_COLUMNS in web/lib/order-import.ts — a row with no title is named after its blank.
  { h: 'Product Title', g: 'product', duty: '', sample: 'Custom Embroidered Tee with Name' },
  { h: 'Listing SKU', g: 'product', duty: '', sample: 'TEE-EMB-NAME-01' },
  /**
   * THE BLANK, BY NAME — and the three columns after it narrow to whatever it offers.
   *
   * This was 'Blank SKU', a code typed from memory against a frozen example ('G5000'), and
   * it is gone: once a product, a colour and a size are chosen the sku is DERIVED, which is
   * what the app itself does (variantSku). Asking a person to hand-type the one field the
   * system can compute is how a row ends up pointing at a blank we do not stock.
   *
   * Old sheets keep working — the importer still reads a 'Blank SKU' column when one is
   * there, see COL_ALIASES in web/lib/order-import.ts.
   */
  { h: 'Blank Product', g: 'product', duty: 'req', sample: 'EG-1001 - Gildan 5000 Heavy Cotton Tee', opts: 'products' },
  /**
   * THE SHORTCUT, THEN THE RAW MATERIAL — and they sit together because they answer the
   * same question two ways.
   *
   * A Template ID already carries the blank, the placement and the artwork, so a row with
   * one needs nothing else. An Image ID is the artwork on its own, placed at the product's
   * default print area — which is all a spreadsheet row can express, since there is no way
   * to type a position into a cell.
   *
   * Image ID was four columns further right, past the variant fields, so the two ways of
   * saying "here is the design" were separated by everything that is not the design. Both
   * were also longer than they needed to be: "Template/Design ID" and "Image Link/ID" each
   * spent a column's width on a slash. The importer aliases every old spelling, so a sheet
   * downloaded before today still reads — see COL_ALIASES in web/lib/order-import.ts.
   */
  { h: 'Template ID', g: 'product', duty: '', sample: 'TPL-12' },
  { h: 'Image ID', g: 'product', duty: '', sample: '' },
  /**
   * THE STITCH FILE, BY REFERENCE — the third way of saying "here is the design", and the
   * only one that is not artwork.
   *
   * Template ID and Image ID hand us a PICTURE we cut a machine file from. This hands us the
   * machine file, which is what actually arrives: sellers send .EMB. It rides beside the
   * other two because it answers the same question, and this list is a HAND-KEPT MIRROR of
   * web/lib/order-import.ts's CSV_COLUMNS — change one and change the other, or the sheet we
   * hand out stops importing itself.
   */
  { h: 'Machine File ID', g: 'product', duty: '', sample: '' },
  { h: 'Quantity', g: 'product', duty: '', sample: '1' },
  // `dep` = this column's dropdown is whatever the chosen Blank Product offers, not a
  // fixed list. See LISTS below for how that is wired.
  { h: 'Print Type', g: 'product', duty: '', sample: 'DTG printing', opts: 'methods', dep: 'methods' },
  { h: 'Color', g: 'product', duty: '', sample: 'White', opts: 'colors', dep: 'colors' },
  { h: 'Size', g: 'product', duty: '', sample: 'L', opts: 'sizes', dep: 'sizes' },
  { h: 'Store Name', g: 'extras', duty: '', sample: 'Main Store' },
  { h: 'Internal Notes', g: 'extras', duty: '', sample: 'Example row — safe to delete' },
];

// Dropdown value lists. Mirrors COLUMN_OPTIONS in web/lib/order-import.ts; `methods` mirrors
// PRODUCT_METHODS in web/lib/print-method.ts.
const T_OPTS = {
  // THE WORDS, NOT OUR SHORTHAND. This was the eight codes, because the importer normalises
  // against codes — but "APL" in a seller's dropdown is a guess rather than a choice.
  // methodCode() matches these back by regex (/APPLIQ/, /EMB/, /DIRECT/ …), so a sheet
  // already in someone's Drive that still says "APL" imports exactly as it did.
  // Mirrors METHOD_LABELS in server/src/print-route.js — change both.
  methods: ['DTG printing', 'DTF printing', 'Embroidery', 'Appliqué', 'Laser', 'Screen print', 'Sublimation', 'Vinyl'],
  sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'One Size'],
  // `services` was here and went with the Shipping Service column (2026-08-21). The label
  // screen picks the class at buy time against the live Shippo account, so a value typed
  // into a spreadsheet days earlier was never consulted — SHIPPING_SERVICES in
  // web/lib/order-import.ts survives for the sheets already in sellers' Drives.
  states: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'],
};

// Band colours. Deliberately PALE: this is a sheet people type into all day, and a saturated
// fill behind live text is the "tinted canvas under a 700-row queue" mistake. Both header
// rows wear the band's colour; the data cells nothing at all.
const BAND = {
  order:   { label: 'ORDER',    banner: { red: 0.88, green: 0.94, blue: 0.90 } },
  ship:    { label: 'SHIP TO',  banner: { red: 0.86, green: 0.90, blue: 1.0 } },
  product: { label: 'PRODUCT',  banner: { red: 0.91, green: 0.87, blue: 1.0 } },
  extras:  { label: 'EXTRAS',   banner: { red: 0.94, green: 0.94, blue: 0.94 } },
};

// ONE COLOUR PER SECTION, and the header row wears its band's colour too — see BAND above.
// The header used to be tinted by OBLIGATION instead, so four bands produced seven fills
// across two rows and neither reading came through. Obligation is already written on the
// header: `*` means required, nothing means optional. Mirrors SECTION_FILL in
// web/lib/order-import.ts.

// Mirrors DUTY_MARK in web/lib/order-import.ts. `asg` carries NOTHING — a tilde beside
// "Order Number" read as part of the column name, and the header fill already separates it
// from the required columns. Required keeps its asterisk; that one is a warning.
const DUTY_MARK = { req: ' *', asg: '', '': '' };

// Contiguous runs of one band, in column order — what the banner row merges across.
// Walks the list rather than filtering per band, so the banner can only ever span columns
// that really are adjacent and really are in that band.
function bands() {
  const out = [];
  T_COLUMNS.forEach((c, i) => {
    const last = out[out.length - 1];
    if (last && last.g === c.g) last.count++;
    else out.push({ g: c.g, start: i, count: 1 });
  });
  return out;
}


/**
 * THE LISTS COME FROM THE CATALOGUE, NOT FROM THIS FILE.
 *
 * Every dropdown in this template used to be a literal typed here and hand-mirrored into
 * web/lib/order-import.ts — so the sheet offered 4XL on a product that stops at 2XL, listed
 * print methods nothing in the catalogue does, and never showed a blank added since the
 * arrays were last edited. A template whose options don't match the system is worse than no
 * template: it produces rows that look filled in correctly and import as nonsense.
 *
 * So it is read at build time. `data` is where a catalogue product keeps its variants —
 * same shape web/lib/variant-sku.ts reads.
 *
 * Capped at 500 products: each one costs three columns and three named ranges on the hidden
 * tab, and a sheet with thousands of named ranges is slow to open on the machines this is
 * filled in on. If the catalogue outgrows that, the cap is the thing to revisit — not the
 * silent truncation, which is why the count comes back.
 */
const LIST_CAP = 500;
const VALUES_CAP = 200;
const clean = (xs) => [...new Set((Array.isArray(xs) ? xs : [])
  .map((v) => String(v == null ? '' : (typeof v === 'object' ? (v.name || v.value || v.size || v.color || '') : v)).trim())
  .filter(Boolean))].slice(0, VALUES_CAP);

export async function catalogLists() {
  let rows = [];
  try {
    rows = (await q(`select sku, data from catalog_products order by lower(coalesce(data->>'name','')) limit ${LIST_CAP + 1}`)).rows;
  } catch (e) { return null; }               // no catalogue table → the caller keeps the static lists
  const products = [];
  for (const r of rows) {
    const d = r.data && typeof r.data === 'object' ? r.data : {};
    const name = String(d.name || r.sku || '').trim();
    if (!name) continue;
    /**
     * THE PRINT METHOD IS A SENTENCE IN THE DATABASE, AND A CODE IN AN ORDER.
     *
     * Production stores it as prose — "DTG printing / Embroidery" is what 27 real products
     * carry — while an order line, the pricing surcharge and the sku suffix all speak in
     * codes (DTG, EMB, DTF, APL, LSR, SCR, SUB, VNL). Splitting the sentence and offering
     * the fragments put "DTG printing" and "Embroidery" in the dropdown: words that read
     * right to a person and are not what the importer normalises against.
     *
     * So each fragment goes through methodCode() — the same normaliser pricing.js and the
     * design router use, because three places disagreeing about what "DTF" means is how a
     * job gets priced one way and routed another. Then filtered to the methods we actually
     * sell, so the sheet can never offer a technique the factory does not do.
     */
    const methods = clean([
      ...(Array.isArray(d.methods) ? d.methods : []),
      ...String(d.method || '').split(/[,/|+&]|\band\b/i),
    ]).map((m) => methodLabel(methodCode(m))).filter((m) => T_OPTS.methods.includes(m));
    /**
     * COLOURS ARE THE KEYS OF `colorImages`, NOT A `colors` FIELD.
     *
     * There is no `colors` column in a catalogue product and never was — checked against
     * production: 27 products, every one carrying `colorImages`, `sizes` and `method`, not
     * one carrying `colors`. Reading a field that does not exist gave every product an
     * empty colour list, which is why the sheet showed no colours and fell back to the old
     * fixed Print Type list.
     *
     * So it goes through the SAME helpers the app uses — productColors falls back to
     * `mainColor` when there are no keys, and deliberately does not union in sizePrices or
     * anything else, because a leftover price tier would offer a variant the product does
     * not sell. CLAUDE.md §5: import, don't re-implement.
     */
    products.push({
      name,
      sku: String(r.sku || '').trim(),
      // Carried so the label can prefer OURS and fall back to theirs — it is used to name a
      // row in a dropdown, never written into the sheet's own columns.
      supplierSku: String(d.supplierSku || '').trim(),
      colors: clean(productColors(d)),
      sizes: clean(productSizes(d)),
      methods,
    });
    if (products.length >= LIST_CAP) break;
  }
  if (!products.length) return null;
  return { products, truncated: rows.length > LIST_CAP };
}

/** 0-based column index → A1 letter. */
function colLetter(i) {
  let n = i + 1, out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

function cell(v, fmt) {
  return { userEnteredValue: { stringValue: String(v) }, ...(fmt ? { userEnteredFormat: fmt } : {}) };
}

/**
 * Build the two Google payloads for the template, with NO network call.
 *
 * Split out from the route so the exact bytes we would send can be inspected — see
 * GET /api/sheets/template-preview. A structural mistake here (a merge that runs off the
 * grid, validation landing on the header row) otherwise only ever shows up as a 400 from
 * Google with the whole sheet already created.
 *
 * `gid` is only known after the spreadsheet exists, so requests() takes it.
 */
export function buildTemplate(title, lists = null) {
  const NCOL = T_COLUMNS.length;
  /**
   * THE HIDDEN TAB THAT MAKES THE DROPDOWNS TRUE.
   *
   * Column A is every product. Then three columns per product — its colours, its sizes, its
   * print methods — each one a named range. A dependent dropdown is then just:
   *
   *     =INDIRECT("PC_" & MATCH($<blank product cell>, Lists!$A$2:$A, 0))
   *
   * MATCH gives the product's ROW, and the ranges are named by that number, so nothing has
   * to slugify a product name into a valid range name and stay matched to it — the one part
   * of this pattern that rots. An empty product cell makes MATCH #N/A, INDIRECT empty, and
   * the dropdown simply offers nothing, which is the correct answer to "which colours does
   * no product come in".
   */
  const prodIdx = T_COLUMNS.findIndex((c) => c.opts === 'products');
  const P = lists && Array.isArray(lists.products) ? lists.products : [];
  const hasLists = P.length > 0;
  const AXES = [['colors', 'PC'], ['sizes', 'PS'], ['methods', 'PM']];
  // How many rows get a per-row dependent rule — see the note where they are emitted.
  const DEP_ROWS = 200;
  const BANDS = bands();
  // Row 0 = merged band banner, row 1 = column headers, row 2 = the deletable sample.
  const bannerRow = { values: T_COLUMNS.map((c, i) => {
    const b = BANDS.find((x) => x.start === i);
    return cell(b ? BAND[c.g].label : '', {
      backgroundColor: BAND[c.g].banner,
      horizontalAlignment: 'CENTER',
      textFormat: { bold: true, fontSize: 10 },
    });
  }) };
  const headerRow = { values: T_COLUMNS.map((c) => cell(c.h + DUTY_MARK[c.duty], {
    backgroundColor: BAND[c.g].banner,
    textFormat: {
      bold: true,
      // Required reads in red as well as carrying the asterisk — colour alone fails for a
      // colour-blind filler, an asterisk alone is easy to miss in a wide header row.
      ...(c.duty === 'req' ? { foregroundColor: { red: 0.62, green: 0.09, blue: 0.13 } } : {}),
    },
    wrapStrategy: 'CLIP',
  })) };
  // Sample row in grey italic so it reads as an example, not as data to keep. isSampleRow()
  // on the client keys off "delete this row" in Ship Name, so it is dropped on import even
  // if the seller leaves it in.
  const sampleRow = { values: T_COLUMNS.map((c) => cell(c.sample || '', {
    textFormat: { italic: true, foregroundColor: { red: 0.55, green: 0.55, blue: 0.55 } },
  })) };

  // The Lists grid, built column-first then transposed into rowData.
  /**
   * A UNION COLUMN PER AXIS, and it is not decoration.
   *
   * Three products in the live catalogue carry no colours at all, and one carries no print
   * method — so no named range was created for that axis, INDIRECT resolved to nothing, and
   * the cell showed an empty dropdown with a pencil on it. Which is indistinguishable from
   * the tool being broken, on a product where the honest answer is "we never recorded this".
   *
   * So a product missing an axis points at the union of every value on that axis instead:
   * the dropdown offers everything rather than nothing, and someone filling the sheet can
   * still get on with it. Better data upstream narrows it later without touching this.
   */
  const union = (axis) => [...new Set(P.flatMap((p) => p[axis] || []))];
  const UNIONS = AXES.map(([axis]) => union(axis));

  /**
   * THE OPTION TEXT IS "SKU - NAME", AND IT IS ONE STRING ON PURPOSE.
   *
   * A catalogue has near-identical names in it — three cuts of the same Adidas shirt read
   * the same in a dropdown — and OUR sku is the half that tells them apart at the moment of
   * picking. Sheets data validation has no label-vs-value: whatever is picked IS the cell,
   * so this text is what reaches the importer. resolveProduct (web/lib/variant-resolve.ts)
   * matches the whole string first and either half after, so both spellings resolve and a
   * sheet filled in before today still imports.
   *
   * OUR sku, never `supplierSku` — that names who makes our blanks, and it is withheld from
   * every surface (CLAUDE.md §2.9). catalogLists() selects `sku` from catalog_products,
   * which is ours; the supplier's code is not read here at all.
   *
   * The same label is the MATCH key in column A, so the dependent colour/size/method ranges
   * keep resolving — they look the picked cell up in this column by MATCH.
   */
  /* OURS first, the supplier's only when there is nothing of ours — one rule, imported (see
     ourSku in pricing.js and displaySku on the web side). This dropdown is the one a seller
     reads, and it was offering a vendor part number even for products that HAVE our code. */
  const label = (p) => { const c = ourSku(p.sku) || String(p.supplierSku || p.sku || '').trim(); return c ? `${c} - ${p.name}` : p.name; };
  const listCols = [];
  listCols.push(['Product', ...P.map(label)]);
  AXES.forEach(([axis], a) => listCols.push([`All ${axis}`, ...UNIONS[a]]));
  for (let i = 0; i < P.length; i++) {
    for (const [axis] of AXES) listCols.push([label(P[i]), ...(P[i][axis] || [])]);
  }
  const listRowCount = Math.max(2, ...listCols.map((c) => c.length));
  const listRows = [];
  for (let r = 0; r < listRowCount; r++) {
    listRows.push({ values: listCols.map((c) => cell(c[r] == null ? '' : c[r])) });
  }

  const sheetsSpec = [{
    properties: { sheetId: 0, title: 'Orders', gridProperties: { frozenRowCount: 2, columnCount: Math.max(NCOL, 26), rowCount: 1000 } },
    data: [{ startRow: 0, startColumn: 0, rowData: [bannerRow, headerRow, sampleRow] }],
  }];
  if (hasLists) {
    sheetsSpec.push({
      properties: {
        sheetId: 1, title: 'Lists', hidden: true,
        gridProperties: { columnCount: Math.max(listCols.length, 4), rowCount: Math.max(listRowCount, 100) },
      },
      data: [{ startRow: 0, startColumn: 0, rowData: listRows }],
    });
  }

  const createBody = { properties: { title }, sheets: sheetsSpec };

  /**
   * `opts` exists for the FORMAT route, which rewrites a master that already exists.
   *
   *   listsGid   — the Lists tab's real sheetId. On create it is 1, because createBody
   *                asks for that id; on an existing file it is whatever is there.
   *   createLists — the master predates this and has no Lists tab, so add it here.
   *   dropNamedRanges — a named range cannot be added twice, so the old PC_/PS_/PM_ ones
   *                have to go first or the second format 400s with "already exists".
   */
  const requests = (gid, opts = {}) => {
    const listsGid = opts.listsGid == null ? 1 : opts.listsGid;
    const out = [];
    if (hasLists && opts.createLists) {
      out.push({ addSheet: { properties: {
        sheetId: listsGid, title: 'Lists', hidden: true,
        gridProperties: { columnCount: Math.max(listCols.length, 4), rowCount: Math.max(listRowCount, 100) },
      } } });
    }
    // The lists themselves, rewritten every time — this is the whole point of formatting an
    // existing master: yesterday's catalogue is replaced by today's in place.
    if (hasLists) {
      /**
       * GROW THE GRID FIRST. updateCells cannot extend a sheet — it answers "attempting to
       * write column 82, beyond the last requested column" and the whole batch fails.
       *
       * The Lists tab was sized when it was CREATED, to exactly the catalogue of that day.
       * Adding a product, or adding the three union columns, needs more room than it has,
       * so the refresh has to widen it before writing into it. Never narrows: a smaller
       * catalogue leaves empty columns, which cost nothing on a hidden tab and are cheaper
       * than a delete that could take a named range with it.
       */
      out.push({ updateSheetProperties: {
        properties: { sheetId: listsGid, gridProperties: {
          columnCount: Math.max(listCols.length, 4),
          rowCount: Math.max(listRowCount, 100),
        } },
        fields: 'gridProperties.columnCount,gridProperties.rowCount',
      } });
      out.push({ updateCells: {
        rows: listRows, fields: 'userEnteredValue',
        start: { sheetId: listsGid, rowIndex: 0, columnIndex: 0 },
      } });
    }
    for (const id of opts.dropNamedRanges || []) out.push({ deleteNamedRange: { namedRangeId: id } });
    /**
     * WIPE THE OLD RULES BEFORE WRITING THE NEW ONES.
     *
     * Formatting only ever SET validation, so a rule outlived the column it was written for.
     * Inserting Image ID pushed Print Type one column right, and the dependent rule that used
     * to live there stayed behind on Item Quantity — a quantity cell offering a broken list of
     * print methods, which is worse than no dropdown because it looks deliberate.
     *
     * A setDataValidation with no `rule` clears the range. It runs first, so everything below
     * writes onto a clean grid and a column that no longer has a list ends up with none.
     */
    out.push({ setDataValidation: {
      range: { sheetId: gid, startRowIndex: 2, startColumnIndex: 0, endColumnIndex: NCOL },
    } });
    for (const b of BANDS) {
      if (b.count > 1) out.push({ mergeCells: { mergeType: 'MERGE_ALL', range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: b.start, endColumnIndex: b.start + b.count } } });
    }
    T_COLUMNS.forEach((c, i) => {
      out.push({ updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: Math.min(260, Math.max(110, c.h.length * 9 + 40)) },
        fields: 'pixelSize',
      } });
      // Dropdown over the data rows only (row 3 down) — never over the header rows, which
      // would flag our own header text as an invalid value.
      // A dependent column points at the chosen product's own list; everything else keeps
      // its fixed one. Both are skipped when there is no catalogue to build lists from,
      // rather than offering a dropdown that would resolve to nothing.
      /**
       * FLAT LISTS, BECAUSE SHEETS WILL NOT EVALUATE A DEPENDENT ONE.
       *
       * This was three per-row rules of the form
       *
       *     =INDIRECT("PM_" & MATCH(K3, Lists!$A$2:$A, 0))
       *
       * which is the documented workaround for a dependent dropdown, and it is a dead end
       * through the API. Verified against the live master, in this order: the named ranges
       * exist and point at the right cells; MATCH resolves the product to its row; and the
       * whole expression, typed into a CELL, returns the product's real colours. The same
       * expression inside a validation rule is stored verbatim, reported back verbatim, and
       * evaluates to an empty list — the pencil icon with nothing under it. Sheets does not
       * run INDIRECT in ONE_OF_RANGE; the UI's version of this trick uses a helper column
       * per row, which a template that has to survive being copied cannot rely on.
       *
       * So each column offers everything the catalogue has on that axis. It is a real list
       * that really opens, and it is honest about what a spreadsheet can check: nothing here
       * knows which row's product it belongs to. The narrowing moves to the IMPORTER, which
       * is where it belonged anyway — a dropdown cannot stop a paste, and a sheet filled in
       * three weeks ago cannot know what the catalogue holds today.
       */
      const axis = c.dep && hasLists ? AXES.findIndex(([a]) => a === c.dep) : -1;
      if (axis >= 0 && UNIONS[axis].length) {
        const col = colLetter(1 + axis);              // Lists: A products, then one per axis
        out.push({ setDataValidation: {
          range: { sheetId: gid, startRowIndex: 2, startColumnIndex: i, endColumnIndex: i + 1 },
          rule: {
            condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `=Lists!$${col}$2:$${col}$${UNIONS[axis].length + 1}` }] },
            showCustomUi: true,
            strict: false,
          },
        } });
      } else if (c.opts === 'products' && hasLists) {
        out.push({ setDataValidation: {
          range: { sheetId: gid, startRowIndex: 2, startColumnIndex: i, endColumnIndex: i + 1 },
          rule: {
            condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `=Lists!$A$2:$A${P.length + 1}` }] },
            showCustomUi: true, strict: false,
          },
        } });
      } else if (c.opts && T_OPTS[c.opts]) {
        out.push({ setDataValidation: {
          range: { sheetId: gid, startRowIndex: 2, startColumnIndex: i, endColumnIndex: i + 1 },
          rule: {
            condition: { type: 'ONE_OF_LIST', values: T_OPTS[c.opts].map((v) => ({ userEnteredValue: v })) },
            showCustomUi: true,
            // NOT strict: a rejected paste is worse than an odd value. The importer
            // normalises these anyway (print type upper-cases, quantity defaults), and a
            // seller shipping to a non-US state must not be blocked by a US-state list.
            strict: false,
          },
        } });
      }
    });
    // One named range per axis per product, addressed by the product's ROW — see the note
    // on the Lists tab above. Column 0 is the product list, so product i starts at 1 + i*3.
    if (hasLists) {
      // Columns: 0 = the product list, 1..3 = the union per axis, then three per product.
      const PRODUCT_COL0 = 1 + AXES.length;
      for (let i = 0; i < P.length; i++) {
        AXES.forEach(([axis, prefix], a) => {
          const own = (P[i][axis] || []).length;
          // Its own values when it has any; the union when it has none — see the note on
          // UNIONS. A range still has to point somewhere, or INDIRECT resolves to nothing.
          const col = own ? PRODUCT_COL0 + i * 3 + a : 1 + a;
          const n = own || UNIONS[a].length;
          if (!n) return;                      // the whole catalogue has none of this axis
          out.push({ addNamedRange: { namedRange: {
            name: `${prefix}_${i + 1}`,
            range: { sheetId: listsGid, startRowIndex: 1, endRowIndex: 1 + n, startColumnIndex: col, endColumnIndex: col + 1 },
          } } });
        });
      }
    }
    return out;
  };

  return {
    createBody, requests,
    columns: T_COLUMNS.map((c) => c.h), duties: T_COLUMNS.map((c) => c.duty), bands: BANDS,
    // Surfaced so "how many products did this sheet actually get" is answerable without
    // opening the hidden tab — and so a truncated catalogue is never silent.
    products: P.length, truncated: !!(lists && lists.truncated),
  };
}

// Pull a spreadsheet ID out of a full URL or accept a bare ID.
function extractId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;   // looks like a bare ID
  return '';
}
// The specific tab (gid) the user was looking at, if the URL carries one.
function extractGid(input) {
  const m = String(input || '').match(/[#&?]gid=([0-9]+)/);
  return m ? m[1] : null;
}

/**
 * Read a link-shared sheet's rows. Extracted from the /api/sheets route so scheduled jobs
 * can reuse the exact tab-picking and formatting rules rather than re-implementing them.
 *
 * Read-only and key-based: it never holds a seller credential, so it cannot put a
 * connected account at risk. Throws with a human-readable message on failure.
 */
export async function fetchSheetRows(raw, tabWanted) {
  const id = extractId(raw);
  if (!id) throw new Error('Could not read a spreadsheet ID from that link.');
  const gid = extractGid(raw);

  // PREFER the service account. An API key can only read a sheet shared "Anyone with the
  // link" — which, for a sheet of buyer names and home addresses, means publishing your
  // customers' PII to anyone who ever sees the URL. With a service account the sheet is
  // shared with ONE address and stays private.
  let auth = null;
  try { auth = { Authorization: 'Bearer ' + (await getServiceToken()) }; } catch { auth = null; }
  if (!auth && !API_KEY) {
    throw new Error('Google Sheets is not configured — set GOOGLE_SERVICE_ACCOUNT (preferred, keeps the sheet private) or GOOGLE_SHEETS_API_KEY.');
  }
  const withAuth = (url) => (auth ? url : url + (url.includes('?') ? '&' : '?') + 'key=' + API_KEY);
  const opts = auth ? { headers: auth } : undefined;

  const metaR = await fetch(withAuth(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties(title,sheetId)`), opts);
  const meta = await metaR.json().catch(() => ({}));
  if (!metaR.ok) {
    const msg = (meta.error && meta.error.message) || metaR.status;
    if (metaR.status === 403) {
      // NAME THE ACCOUNT, AND KEEP GOOGLE'S OWN SENTENCE.
      //
      // A 403 here has two unrelated causes that need opposite fixes: the sheet isn't
      // shared with us (PERMISSION_DENIED), or the Sheets API is switched off for the
      // credential's Cloud project (SERVICE_DISABLED). This used to throw our sharing
      // guess for both and DISCARD `msg`, so a disabled API sent you to Google Drive to
      // re-share a sheet that was already shared. Google's text distinguishes them in
      // one line; it belongs in front of the reader.
      //
      // The address is the other half. "Share it with the client_email from
      // GOOGLE_SERVICE_ACCOUNT" asks someone to open a server .env to finish a task in
      // a browser — so the email is printed here, which is safe: a service-account
      // address is the thing you are meant to hand out.
      const sa = loadSA();
      const who = auth && sa && sa.client_email ? sa.client_email : null;
      throw new Error(auth
        ? `Google says: ${msg}${who ? ` — if that's a sharing error, share the sheet with ${who} (Viewer to import, Editor to write back).` : ''}`
        : `Google says: ${msg} — that sheet isn't link-shared. Prefer sharing it with a service account; "Anyone with the link" exposes buyer addresses to anyone with the URL.`);
    }
    throw new Error('Google Sheets error: ' + msg);
  }
  const sheets = (meta.sheets || []).map((x) => x.properties).filter(Boolean);
  let pick = null;
  const wantTab = String(tabWanted || '').trim();
  if (wantTab) pick = sheets.find((x) => x.title === wantTab);
  if (!pick && gid != null) pick = sheets.find((x) => String(x.sheetId) === String(gid));
  if (!pick) pick = sheets.find((x) => /^orders$/i.test(x.title));
  if (!pick) pick = sheets[0];
  if (!pick) throw new Error('The spreadsheet has no readable tabs.');
  const range = encodeURIComponent(pick.title);
  const valR = await fetch(withAuth(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?majorDimension=ROWS`), opts);
  const val = await valR.json().catch(() => ({}));
  if (!valR.ok) throw new Error('Could not read tab "' + pick.title + '": ' + ((val.error && val.error.message) || valR.status));
  const rows = (val.values || [])
    .map((r) => r.map((c) => (c == null ? '' : String(c))))
    .filter((r) => r.some((c) => String(c).trim() !== ''));
  return { title: meta.properties && meta.properties.title, tab: pick.title, rows };
}



/**
 * The master template a seller copies. Stored in the shared `settings` table so an admin
 * can set it from the app, falling back to SHEETS_TEMPLATE_URL for an existing deployment.
 *
 * IT HAS TO BE A SETTING, NOT AN ENV VAR. The service account cannot create the master
 * itself — see the note on the create route — so a human makes it once, and asking that
 * human to SSH into a VPS and edit .env to finish a task they started in a dialog is how
 * this stayed unconfigured across several attempts.
 */
const TEMPLATE_KEY = 'sheets_template_url';
let _tplReady = null;
function ensureSettings() {
  if (_tplReady) return _tplReady;
  _tplReady = q('create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())').catch(() => {});
  return _tplReady;
}
async function readTemplateUrl() {
  await ensureSettings();
  try {
    const r = await q('select value from settings where key = $1', [TEMPLATE_KEY]);
    const v = r.rows[0] && r.rows[0].value;
    const s = typeof v === 'string' ? v : (v && typeof v.url === 'string' ? v.url : '');
    if (s) return s;
  } catch { /* table not ready */ }
  return TEMPLATE_URL;
}

/**
 * Google's own "force a copy" URL. Opening it shows the seller Google's Make-a-copy
 * dialog; the copy lands in THEIR Drive, owned by them.
 *
 * This is the whole reason the flow no longer needs a service account, a share step or
 * any permission on our side: we never touch their sheet. They copy, fill, download, and
 * drop the file on the same drop zone that already takes .csv/.xlsx.
 */
function toCopyUrl(url) {
  const id = extractId(url);
  return id ? `https://docs.google.com/spreadsheets/d/${id}/copy` : '';
}

/**
 * THE ONE THING DATA VALIDATION CANNOT DO — a dropdown that depends on another cell.
 *
 * Sheets will not evaluate INDIRECT inside a validation rule (verified against the live
 * master: the rule is stored verbatim, read back verbatim, and resolves to an empty list),
 * so a per-row list cannot be expressed as a rule at all. An onEdit trigger can: it rewrites
 * that ROW's validation the moment a product is chosen, which is how every working dependent
 * dropdown in Sheets is actually built.
 *
 * It reads the hidden Lists tab by NAME rather than by position — each product's three
 * columns carry the product's own name in row 1 — so adding products, reordering columns or
 * renaming a header on the Orders tab cannot break it. The catalogue itself is refreshed by
 * the server on every template format, and this simply reads whatever is there.
 *
 * WHY IT IS PASTED RATHER THAN INSTALLED: creating a bound script needs Drive, and this
 * deployment's service account has none — the same 403 that stops it creating a spreadsheet
 * at all. A bound script IS carried into every copy someone makes, so it is a one-time paste
 * on the master and then it travels.
 */
/**
 * THE MANIFEST, which is the half that decides how frightening this looks.
 *
 * Left to itself Apps Script infers a BROAD scope (all of your spreadsheets), which is a
 * sensitive scope — so an unpublished project triggers the unverified-app interstitial, and
 * the seller's first contact with our template is "Advanced -> Go to (unsafe)". People
 * abandon there, and they are right to.
 *
 * The script only ever reaches the sheet it is bound to: it uses SpreadsheetApp alone and
 * never openById/openByUrl/DriveApp, so `spreadsheets.currentonly` is not a compromise, it
 * is what the code actually does. That scope is NON-sensitive, so the interstitial goes and
 * consent reads "only the specific spreadsheet you use this with".
 *
 * It does NOT remove the copy-dialog banner ("the attached Apps Script file ... will also be
 * copied"). That fires because a bound script exists at all, and no scope changes it.
 *
 * timeZone/runtime/exceptionLogging mirror the project defaults so pasting this cannot
 * silently undo a setting someone chose in Project Settings.
 */
const APPS_MANIFEST = JSON.stringify({
  timeZone: 'Asia/Ho_Chi_Minh',
  dependencies: {},
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  oauthScopes: ['https://www.googleapis.com/auth/spreadsheets.currentonly'],
}, null, 2);

const APPS_SCRIPT = `/**
 * EGFULFILL order-import helper.
 *
 * Pick a Blank Product and this narrows that row's Print Type, Color and Size to what the
 * product actually comes in. Clear the product and they go back to offering everything.
 *
 * Reads the hidden "Lists" tab, which the EGFULFILL server rewrites from the live catalogue
 * every time the master template is formatted. Nothing here needs editing when products
 * change.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== 'Orders') return;
    var row = e.range.getRow();
    if (row < 3) return;                      // rows 1-2 are the banner and the headers

    var head = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
    var col = function (name) { return head.indexOf(name) + 1; };  // 0 when absent
    var productCol = col('Blank Product');
    if (!productCol || e.range.getColumn() !== productCol) return;

    var lists = e.source.getSheetByName('Lists');
    if (!lists) return;
    var listHead = lists.getRange(1, 1, 1, lists.getLastColumn()).getValues()[0];
    var product = String(e.value == null ? '' : e.value).trim();

    // A product's three columns are headed with its own name, in colour/size/method order.
    // Falling back to the union columns is what makes clearing the cell put everything back.
    var at = product ? listHead.indexOf(product) : -1;
    var cols = at >= 0
      ? { Color: at + 1, Size: at + 2, 'Print Type': at + 3 }
      : { Color: listHead.indexOf('All colors') + 1, Size: listHead.indexOf('All sizes') + 1, 'Print Type': listHead.indexOf('All methods') + 1 };

    Object.keys(cols).forEach(function (header) {
      var target = col(header);
      var source = cols[header];
      if (!target || !source) return;
      var values = lists.getRange(2, source, Math.max(1, lists.getLastRow() - 1), 1)
        .getValues().map(function (r) { return String(r[0] || '').trim(); })
        .filter(function (v) { return v; });
      var cell = sh.getRange(row, target);
      if (!values.length) { cell.clearDataValidations(); return; }
      // setAllowInvalid(true) on purpose: a rejected paste is worse than an odd value, and
      // the importer normalises and checks the combination server-side anyway.
      cell.setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build()
      );
      // A value that the new product does not offer is not silently kept.
      var current = String(cell.getValue() || '').trim();
      if (current && values.indexOf(current) === -1) cell.clearContent();
    });
  } catch (err) {
    // A helper must never block someone typing. Swallowed on purpose.
  }
}
`;

export function sheetsRoutes(app, requireAuth, requireAdmin) {
  // Public config: is import enabled, the template link, and whether the server
  // can auto-create a filled sheet (service account present).
  // enabled = "can this server read a sheet AT ALL", which is EITHER credential. Reporting
  // only the API key hid the Sheet tab whenever someone had set up the service account (the
  // preferred, keeps-it-private path the read helper actually uses) but no API key — the
  // import option simply wasn't there, which read as "Google Sheet import is blank".
  //
  // `shareWith` is the service-account address, emitted only to a SIGNED-IN caller — the
  // address is meant to be handed out, but our Cloud project id needn't be broadcast. The
  // onRequest hook in index.js has already attached req.user, so no preHandler is needed
  // and the public shape is unchanged for anyone without a token.
  /**
   * The helper script, served rather than stored in the bundle, so it can never drift from
   * the column names this file writes. Admin-only: it is a setup step, not a seller's.
   */
  app.get('/api/sheets/apps-script', { preHandler: requireAdmin }, async () => ({
    script: APPS_SCRIPT,
    // Named here so the instructions and the template can't disagree about which tab.
    tab: 'Orders', listsTab: 'Lists',
    manifest: APPS_MANIFEST,
  }));

  app.get('/api/sheets/config', async (req) => {
    const sa = loadSA();
    const templateUrl = await readTemplateUrl();
    // Keep the master current, without anyone pressing anything — see autoFormat. Not
    // awaited: handing someone a copy link must not wait on Google, and a refresh that
    // fails leaves the old fingerprint so the next read tries again.
    autoFormat().catch(() => {});
    return {
      enabled: !!(API_KEY || sa),
      templateUrl,
      copyUrl: toCopyUrl(templateUrl),
      canCreate: !!sa,
      shareWith: req.user && sa && sa.client_email ? sa.client_email : undefined,
      // `isTemplateAdmin` used to mean "show the Apply button" and now means only "may set
      // the master link" — the formatting looks after itself, so there is nothing left to
      // press. The endpoint stays for diagnosis; the affordance is gone.
      isTemplateAdmin: req.user && req.user.role === 'admin' ? true : undefined,
      needsTemplate: req.user && req.user.role === 'admin' ? !toCopyUrl(templateUrl) : undefined,
    };
  });

  /**
   * Write our formatting INTO the master sheet — bands, widths, header rows and, the point
   * of it, the dropdowns.
   *
   * Google's .xlsx importer does not carry ExcelJS's inline-list data validation across the
   * conversion, so a master built by uploading the .xlsx and saving as a Sheet arrives with
   * correct columns and no dropdowns at all. Rebuilding them by hand is 4 columns × 21
   * options, and it silently drifts from T_OPTS the first time a print method is added.
   *
   * This is a batchUpdate on an EXISTING file, which is why it works where create doesn't:
   * the 403 that blocks POST /v4/spreadsheets is Drive refusing to store a new file for a
   * service account with no Drive. Editing a file someone else owns needs only that the
   * sheet is shared with us as Editor — hence the 403 message names the address.
   */
  /**
   * THE MASTER KEEPS ITSELF UP TO DATE.
   *
   * This was a button an admin had to know existed and remember to press — on a sheet whose
   * contents go stale on their own, every time a product is added or a colourway changes.
   * A template that is only correct when somebody remembers to make it correct is the same
   * failure as the frozen arrays it replaced, one step further from where you would look.
   *
   * FINGERPRINTED, not scheduled. The lists are hashed with the column headers; the hash of
   * what was last written to Google is kept in settings. Reading the sheets config compares
   * the two, which is a string compare against a query we already run — and calls Google
   * only when the catalogue has ACTUALLY moved. So: no timer, no polling, no button, and
   * one batchUpdate per real change rather than one per dialog open.
   *
   * Fire-and-forget, guarded against re-entry. Nothing about handing someone a copy link
   * should wait on Google, and a failed refresh must leave the old fingerprint in place so
   * the next read tries again rather than recording a write that never happened.
   */
  const FP_KEY = 'sheets_template_fingerprint';
  let _fmtRunning = false;

  async function formatMaster() {
    const url = await readTemplateUrl();
    const id = extractId(url);
    if (!id) return { error: 'no-master' };
    const token = await getServiceToken();
    return applyTemplateTo(id, token);
  }

  /**
   * THE FINGERPRINT IS THE PAYLOAD ITSELF, not a summary of it.
   *
   * First written as "the columns plus the product lists", which misses the thing that
   * actually went wrong: a fix to the VALIDATION FORMULA changed nothing about the
   * catalogue, so the hash matched, so the automatic refresh decided the sheet was already
   * current and left a broken formula in it. A template whose refresh cannot see its own
   * code changes needs a human to remember to force it — which is the button this replaced.
   *
   * Hashing the requests covers everything that gets written: formulas, merges, widths,
   * headers, named ranges, and the lists inside them. Any change to this file that changes
   * what Google receives changes the hash, and the next config read repairs the master.
   */
  function fingerprint(tpl) {
    return crypto.createHash('sha1').update(JSON.stringify([
      tpl.columns,
      tpl.createBody.sheets.map((sh) => sh.data),
      tpl.requests(0, { listsGid: 1 }),
    ])).digest('hex');
  }

  async function autoFormat() {
    if (_fmtRunning) return;
    _fmtRunning = true;
    try {
      const lists = await catalogLists();
      const tpl = buildTemplate('', lists);
      const fp = fingerprint(tpl);
      const seen = await q('select value from settings where key=$1', [FP_KEY])
        .then((r) => (r.rows[0] ? String(r.rows[0].value).replace(/^"|"$/g, '') : '')).catch(() => '');
      if (seen === fp) return;
      if (!loadSA()) return;                    // nothing to write with — stay quiet
      const out = await formatMaster().catch((e) => ({ error: String(e && e.message) }));
      if (out && out.ok) {
        await q(`insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
                 on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [FP_KEY, JSON.stringify(fp)]).catch(() => {});
      }
    } catch (e) { /* a stale template must never break the dialog */ }
    finally { _fmtRunning = false; }
  }

  /** Write our template into an EXISTING spreadsheet. Shared by the admin route and the
   *  automatic refresh, so the two can never format a sheet differently. */
  async function applyTemplateTo(id, token) {
    const A = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const metaR = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(title,sheetId),namedRanges(namedRangeId,name)`, { headers: A });
    const meta = await metaR.json().catch(() => ({}));
    if (!metaR.ok) return { error: (meta.error && meta.error.message) || ('HTTP ' + metaR.status), status: metaR.status };

    const sheets = meta.sheets || [];
    const first = (sheets[0] || {}).properties || {};
    const gid = first.sheetId || 0;
    const existing = sheets.find((x) => (x.properties || {}).title === 'Lists');
    const used = new Set(sheets.map((x) => (x.properties || {}).sheetId).filter((n) => n != null));
    let listsGid = existing ? existing.properties.sheetId : 1;
    while (!existing && used.has(listsGid)) listsGid++;
    const dropNamedRanges = (meta.namedRanges || [])
      .filter((r) => /^(PC|PS|PM)_\d+$/.test(String(r.name || '')))
      .map((r) => r.namedRangeId).filter(Boolean);

    const tpl = buildTemplate('', await catalogLists());
    const rowData = tpl.createBody.sheets[0].data[0].rowData;
    const body = { requests: [
      { updateCells: { rows: rowData.slice(0, 2), fields: 'userEnteredValue,userEnteredFormat', start: { sheetId: gid, rowIndex: 0, columnIndex: 0 } } },
      { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 2 } }, fields: 'gridProperties.frozenRowCount' } },
      ...tpl.requests(gid, { listsGid, createLists: !existing, dropNamedRanges }),
    ] };
    const upR = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { method: 'POST', headers: A, body: JSON.stringify(body) });
    if (!upR.ok) {
      const d = await upR.json().catch(() => ({}));
      return { error: (d.error && d.error.message) || ('HTTP ' + upR.status), status: upR.status };
    }
    return {
      ok: true, tab: first.title || 'Sheet1',
      dropdowns: T_COLUMNS.filter((c) => c.opts).map((c) => c.h),
      products: tpl.products, listsTab: existing ? 'refreshed' : 'created', truncated: tpl.truncated,
    };
  }

  app.post('/api/sheets/template/format', { preHandler: requireAdmin }, async (req, reply) => {
    const url = await readTemplateUrl();
    const id = extractId(url);
    if (!id) { reply.code(400); return { error: 'No master template is set yet — save its link first.' }; }
    let token;
    try { token = await getServiceToken(); }
    catch (e) { reply.code(502); return { error: 'Service account auth failed: ' + String(e.message || e) }; }
    const sa = loadSA();
    const shareHint = sa && sa.client_email
      ? ` Share the sheet with ${sa.client_email} as Editor — we can only format a sheet we can write to.`
      : '';
    const out = await applyTemplateTo(id, token);
    if (out.error) {
      reply.code(out.status === 403 ? 403 : 502);
      return { error: `Google says: ${out.error}.${out.status === 403 ? shareHint : ''}` };
    }
    return out;
  });

  // Admin sets the master template link, from the same dialog a seller uses. Accepts any
  // Google Sheets URL and stores it; the copy form is derived on read, so pasting the
  // /edit link (what the address bar actually contains) is correct rather than a mistake.
  app.put('/api/sheets/template', { preHandler: requireAdmin }, async (req, reply) => {
    const url = String((req.body && req.body.url) || '').trim();
    if (url && !extractId(url)) { reply.code(400); return { error: 'That is not a Google Sheets link — it has no spreadsheet ID in it.' }; }
    await ensureSettings();
    if (!url) await q('delete from settings where key = $1', [TEMPLATE_KEY]);
    else await q(
      'insert into settings (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()',
      [TEMPLATE_KEY, JSON.stringify(url)]
    );
    return { ok: true, templateUrl: url, copyUrl: toCopyUrl(url) };
  });

  // Diagnostic: does the service account actually authenticate? (auth-gated so it
  // isn't a public probe). Returns the SA email + token-mint result.
  app.get('/api/sheets/diag', { preHandler: requireAuth }, async (req, reply) => {
    const sa = loadSA();
    if (!sa) { reply.code(503); return { ok: false, stage: 'load', error: 'GOOGLE_SERVICE_ACCOUNT not set or not valid JSON.' }; }
    if (!sa.client_email || !sa.private_key) { reply.code(400); return { ok: false, stage: 'parse', error: 'JSON is missing client_email or private_key.' }; }
    try {
      await getServiceToken();
      return { ok: true, client_email: sa.client_email, project_id: sa.project_id || null, message: 'Service account authenticated — auto-create is ready.' };
    } catch (e) {
      reply.code(502);
      return { ok: false, stage: 'token', client_email: sa.client_email, error: String(e.message || e),
        hint: 'Check that the Google Sheets API + Google Drive API are enabled for this project, and the key is the full JSON.' };
    }
  });

  // Dry run: the EXACT payloads /api/sheets/create would send, without creating anything
  // and without needing a service account. Lets the template be checked in one pass —
  // column order, band merges, dropdown ranges — instead of discovering a bad range as a
  // 400 from Google with a half-built sheet already in someone's Drive.
  app.get('/api/sheets/template-preview', { preHandler: requireAuth }, async () => {
    const tpl = buildTemplate('EGFUL Orders — preview', await catalogLists());
    const reqs = tpl.requests(0);
    const kind = (r) => Object.keys(r)[0];
    return {
      ok: true,
      columns: tpl.columns,
      bands: tpl.bands.map((b) => ({ band: b.g, label: BAND[b.g].label, from: tpl.columns[b.start], span: b.count })),
      headerFills: tpl.duties.map((d, i) => ({ column: tpl.columns[i], duty: d || 'optional' })),
      frozenRows: tpl.createBody.sheets[0].properties.gridProperties.frozenRowCount,
      rowsSeeded: tpl.createBody.sheets[0].data[0].rowData.length,
      merges: reqs.filter((r) => kind(r) === 'mergeCells').map((r) => r.mergeCells.range),
      dropdowns: reqs.filter((r) => kind(r) === 'setDataValidation').map((r) => ({
        column: tpl.columns[r.setDataValidation.range.startColumnIndex],
        startRowIndex: r.setDataValidation.range.startRowIndex,
        values: r.setDataValidation.rule.condition.values.length,
        strict: r.setDataValidation.rule.strict,
      })),
      requestCount: reqs.length,
    };
  });

  /**
   * Create a ready-to-fill Google Sheet and share it anyone-with-link → editor.
   *
   * DOES NOT WORK WITH A BARE SERVICE ACCOUNT, and the failure is not a misconfiguration
   * you can fix in the Cloud Console. Verified against the live credential on 2026-08-10:
   * the token mints fine, then
   *
   *     POST https://sheets.googleapis.com/v4/spreadsheets
   *     → 403 "The caller does not have permission" (PERMISSION_DENIED)
   *
   * because creating a spreadsheet writes a file to Drive and a standalone service account
   * has no Drive storage of its own. Enabling APIs, adding IAM roles and re-sharing all
   * leave it 403 — it needs domain-wide delegation to impersonate a real Workspace user,
   * which this deployment does not have.
   *
   * The seller-facing flow therefore does NOT use this route: it opens Google's own
   * /copy URL for the master template instead, and the copy is created by the seller's
   * own Google account, in their Drive. This route is left in place because it works the
   * moment a delegated account exists, and its template builder is what produced the
   * master sheet in the first place.
   */
  app.post('/api/sheets/create', { preHandler: requireAuth }, async (req, reply) => {
    let token;
    try { token = await getServiceToken(); }
    catch (e) { reply.code(e.message === 'no_service_account' ? 503 : 502); return { error: e.message === 'no_service_account' ? 'Auto-create is not configured (no service account).' : ('Service account auth failed: ' + e.message) }; }
    const who = (req.user && (req.user.name || req.user.email)) || 'Seller';
    const tpl = buildTemplate('EGFUL Orders — ' + who, await catalogLists());
    const cr = await fetch('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(tpl.createBody) });
    const cd = await cr.json().catch(() => ({}));
    if (!cr.ok || !cd.spreadsheetId) {
      // Google's `message` alone is often too terse to act on — "The caller does not have
      // permission" says nothing about WHICH permission. `status` and `details` carry the
      // reason (a disabled API arrives as SERVICE_DISABLED with an activation URL), and the
      // service account's own project is what you'd check first, so all three ride along.
      const g = cd.error || {};
      const detail = Array.isArray(g.details)
        ? g.details.map((d) => d.reason || d.metadata?.service || d['@type']).filter(Boolean).join(', ')
        : '';
      const sa = loadSA() || {};
      reply.code(502);
      return {
        error: 'Could not create sheet: ' + (g.message || cr.status)
          + (g.status ? ` [${g.status}]` : '')
          + (detail ? ` (${detail})` : '')
          + (sa.project_id ? ` — service account project: ${sa.project_id}` : ''),
      };
    }
    const id = cd.spreadsheetId;
    const gid = (cd.sheets && cd.sheets[0] && cd.sheets[0].properties && cd.sheets[0].properties.sheetId) || 0;

    // Merges, column widths and dropdowns can't be expressed on create — they need a
    // batchUpdate against the now-known sheetId.
    let formattingError = null;
    const requests = tpl.requests(gid);
    if (requests.length) {
      const br = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + ':batchUpdate', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
      // A formatting failure must not lose the sheet — it exists and is usable, just plainer.
      // Surfaced so "my dropdowns are missing" is answerable rather than a mystery.
      if (!br.ok) {
        const bd = await br.json().catch(() => ({}));
        // RETURN it, don't just log it. The sheet is created and usable either way, so this
        // must not fail the request — but a caller who gets {ok:true} and a plain sheet with
        // no dropdowns has no way to learn why, and the log is on a box they aren't reading.
        formattingError = (bd.error && bd.error.message) || ('HTTP ' + br.status);
        app.log.warn({ err: formattingError }, 'sheet template formatting failed');
      }
    }

    // Share anyone-with-link → writer so the seller can fill it (needs Drive API).
    await fetch('https://www.googleapis.com/drive/v3/files/' + id + '/permissions', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'writer', type: 'anyone' }) }).catch(() => {});
    return { ok: true, id, url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit', formattingError };
  });

  // Read a sheet → { rows, title, tab }. Any seller may import into their own orders.
  // Delegates to fetchSheetRows so the tab-picking, PII-safe service-account preference and
  // blank-row filtering are shared with scheduled jobs rather than re-implemented here (the
  // old inline copy was API-key-only, so a service-account-only setup got a 503 even though
  // the server could read the sheet perfectly well).
  app.get('/api/sheets', { preHandler: requireAuth }, async (req, reply) => {
    if (!API_KEY && !loadSA()) { reply.code(503); return { error: 'Google Sheets import is not configured on the server.' }; }
    const raw = req.query.url || req.query.id || '';
    try {
      const { title, tab, rows } = await fetchSheetRows(raw, req.query.tab);
      return { ok: true, title, tab, rows };
    } catch (e) {
      // fetchSheetRows throws already-human-readable messages (bad link, not shared,
      // not found). A caller-fixable problem is a 400; anything else is upstream (502).
      const msg = String((e && e.message) || e);
      reply.code(/spreadsheet ID|isn.t shared|not found|no readable tabs/i.test(msg) ? 400 : 502);
      return { error: msg };
    }
  });
}
