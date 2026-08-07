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
  { h: 'Product Title', g: 'product', duty: 'req', sample: 'Custom Embroidered Tee with Name' },
  { h: 'Listing SKU', g: 'product', duty: '', sample: 'TEE-EMB-NAME-01' },
  { h: 'Blank SKU', g: 'product', duty: '', sample: 'G5000' },
  { h: 'Template ID', g: 'product', duty: '', sample: '' },
  { h: 'Item Quantity', g: 'product', duty: '', sample: '1' },
  { h: 'Print Type', g: 'product', duty: '', sample: 'DTG', opts: 'methods' },
  { h: 'Item Color', g: 'product', duty: '', sample: 'White' },
  { h: 'Item Size', g: 'product', duty: '', sample: 'L', opts: 'sizes' },
  { h: 'Item Price', g: 'product', duty: '', sample: '24.00' },
  { h: 'Image Link/ID', g: 'product', duty: '', sample: '' },
  { h: 'Store Name', g: 'extras', duty: '', sample: 'Main Store' },
  { h: 'Shipping Service', g: 'extras', duty: '', sample: 'USPS Priority Mail', opts: 'services' },
  { h: 'Internal Notes', g: 'extras', duty: '', sample: 'Example row — safe to delete' },
];

// Dropdown value lists. Mirrors COLUMN_OPTIONS in web/lib/order-import.ts; `methods` mirrors
// PRODUCT_METHODS in web/lib/print-method.ts.
const T_OPTS = {
  methods: ['DTG', 'DTF', 'EMB', 'APL', 'LSR', 'SCR', 'SUB', 'VNL'],
  sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'One Size'],
  services: ['USPS Ground Advantage', 'USPS Priority Mail', 'USPS Priority Mail Express', 'UPS Ground', 'UPS 2nd Day Air', 'FedEx Ground', 'FedEx 2Day'],
  states: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'],
};

// Band colours. Deliberately PALE: this is a sheet people type into all day, and a saturated
// fill behind live text is the "tinted canvas under a 700-row queue" mistake. The banner row
// carries the strong tone; the header row a wash of it; the data cells nothing at all.
const BAND = {
  order:   { label: 'ORDER',    banner: { red: 0.88, green: 0.94, blue: 0.90 }, header: { red: 0.95, green: 0.98, blue: 0.96 } },
  ship:    { label: 'SHIP TO',  banner: { red: 0.86, green: 0.90, blue: 1.0 },  header: { red: 0.94, green: 0.96, blue: 1.0 } },
  product: { label: 'PRODUCT',  banner: { red: 0.91, green: 0.87, blue: 1.0 },  header: { red: 0.96, green: 0.94, blue: 1.0 } },
  extras:  { label: 'EXTRAS',   banner: { red: 0.94, green: 0.94, blue: 0.94 }, header: { red: 0.98, green: 0.98, blue: 0.98 } },
};

// Obligation is per COLUMN now, so it rides on the header text as a mark rather than being
// implied by which band the column sits in. Required cells also carry bold red lettering, so
// the mark is not the only signal.
const DUTY_MARK = { req: ' *', asg: ' ~', '': '' };

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
export function buildTemplate(title) {
  const NCOL = T_COLUMNS.length;
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
    backgroundColor: BAND[c.g].header,
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

  const createBody = {
    properties: { title },
    sheets: [{
      properties: { title: 'Orders', gridProperties: { frozenRowCount: 2, columnCount: Math.max(NCOL, 26), rowCount: 1000 } },
      data: [{ startRow: 0, startColumn: 0, rowData: [bannerRow, headerRow, sampleRow] }],
    }],
  };

  const requests = (gid) => {
    const out = [];
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
      if (c.opts && T_OPTS[c.opts]) {
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
    return out;
  };

  return { createBody, requests, columns: T_COLUMNS.map((c) => c.h), bands: BANDS };
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
      throw new Error(auth
        ? 'That sheet isn\'t shared with the service account — share it (Viewer) with the client_email from GOOGLE_SERVICE_ACCOUNT.'
        : 'That sheet isn\'t shared. Prefer sharing it with a service account; sharing "Anyone with the link" exposes buyer addresses to anyone with the URL.');
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



export function sheetsRoutes(app, requireAuth) {
  // Public config: is import enabled, the template link, and whether the server
  // can auto-create a filled sheet (service account present).
  // enabled = "can this server read a sheet AT ALL", which is EITHER credential. Reporting
  // only the API key hid the Sheet tab whenever someone had set up the service account (the
  // preferred, keeps-it-private path the read helper actually uses) but no API key — the
  // import option simply wasn't there, which read as "Google Sheet import is blank".
  app.get('/api/sheets/config', async () => ({ enabled: !!(API_KEY || loadSA()), templateUrl: TEMPLATE_URL, canCreate: !!loadSA() }));

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
    const tpl = buildTemplate('EGFULFILL Orders — preview');
    const reqs = tpl.requests(0);
    const kind = (r) => Object.keys(r)[0];
    return {
      ok: true,
      columns: tpl.columns,
      bands: tpl.bands.map((b) => ({ band: b.g, label: BAND[b.g].label, from: tpl.columns[b.start], span: b.count })),
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

  // Create a ready-to-fill Google Sheet (Orders + Options tabs) and share it
  // "anyone with the link → editor" so the seller can fill it. Returns its URL.
  app.post('/api/sheets/create', { preHandler: requireAuth }, async (req, reply) => {
    let token;
    try { token = await getServiceToken(); }
    catch (e) { reply.code(e.message === 'no_service_account' ? 503 : 502); return { error: e.message === 'no_service_account' ? 'Auto-create is not configured (no service account).' : ('Service account auth failed: ' + e.message) }; }
    const who = (req.user && (req.user.name || req.user.email)) || 'Seller';
    const tpl = buildTemplate('EGFULFILL Orders — ' + who);
    const cr = await fetch('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(tpl.createBody) });
    const cd = await cr.json().catch(() => ({}));
    if (!cr.ok || !cd.spreadsheetId) { reply.code(502); return { error: 'Could not create sheet: ' + ((cd.error && cd.error.message) || cr.status) }; }
    const id = cd.spreadsheetId;
    const gid = (cd.sheets && cd.sheets[0] && cd.sheets[0].properties && cd.sheets[0].properties.sheetId) || 0;

    // Merges, column widths and dropdowns can't be expressed on create — they need a
    // batchUpdate against the now-known sheetId.
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
        app.log.warn({ err: (bd.error && bd.error.message) || br.status }, 'sheet template formatting failed');
      }
    }

    // Share anyone-with-link → writer so the seller can fill it (needs Drive API).
    await fetch('https://www.googleapis.com/drive/v3/files/' + id + '/permissions', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'writer', type: 'anyone' }) }).catch(() => {});
    return { ok: true, id, url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' };
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
