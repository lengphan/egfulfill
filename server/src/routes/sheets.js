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

// Template content (mirrors the front-end CSV template; sample row is auto-skipped on import).
const T_HEADERS = ['Order Number', 'Ship Name', 'Ship Email', 'Ship Address 1', 'Ship Address 2', 'Ship City', 'Ship State', 'Ship Zip', 'Store Name', 'Product Title', 'Item SKU', 'Item Quantity', 'Print Type', 'Shipping Service', 'Internal Notes'];
const T_SAMPLE = ['SAMPLE-1001', 'Jane Sample — delete this row', 'jane@example.com', '42 Maple Street', 'Apt 3B', 'Portland', 'OR', '97201', 'Main Store', 'Custom Embroidered Tee with Name', 'G5000-WHT-L', '1', 'DTG', 'USPS Priority Mail', 'Example row — safe to delete'];
const T_OPTIONS = [['Print Type', 'Shipping Service', 'US State'], ['DTG', 'USPS Priority Mail', 'CA'], ['DTF', 'USPS Ground Advantage', 'NY'], ['EMB', 'USPS First Class', 'TX'], ['APL', 'UPS Ground', 'FL'], ['LSR', 'FedEx Ground', 'WA']];
function rowData(arr, bold) {
  return { values: arr.map((v) => ({ userEnteredValue: { stringValue: String(v) }, ...(bold ? { userEnteredFormat: { textFormat: { bold: true } } } : {}) })) };
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
  if (!API_KEY) throw new Error('Google Sheets import is not configured on the server.');
  const id = extractId(raw);
  if (!id) throw new Error('Could not read a spreadsheet ID from that link.');
  const gid = extractGid(raw);
  const metaR = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?key=${API_KEY}&fields=properties.title,sheets.properties(title,sheetId)`);
  const meta = await metaR.json().catch(() => ({}));
  if (!metaR.ok) {
    const msg = (meta.error && meta.error.message) || metaR.status;
    if (metaR.status === 403) throw new Error('That sheet isn\'t shared — set General access to "Anyone with the link" (Viewer).');
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
  const valR = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?key=${API_KEY}&majorDimension=ROWS`);
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
  app.get('/api/sheets/config', async () => ({ enabled: !!API_KEY, templateUrl: TEMPLATE_URL, canCreate: !!loadSA() }));

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

  // Create a ready-to-fill Google Sheet (Orders + Options tabs) and share it
  // "anyone with the link → editor" so the seller can fill it. Returns its URL.
  app.post('/api/sheets/create', { preHandler: requireAuth }, async (req, reply) => {
    let token;
    try { token = await getServiceToken(); }
    catch (e) { reply.code(e.message === 'no_service_account' ? 503 : 502); return { error: e.message === 'no_service_account' ? 'Auto-create is not configured (no service account).' : ('Service account auth failed: ' + e.message) }; }
    const who = (req.user && (req.user.name || req.user.email)) || 'Seller';
    const body = {
      properties: { title: 'EGFULFILL Orders — ' + who },
      sheets: [
        { properties: { title: 'Orders', gridProperties: { frozenRowCount: 1 } }, data: [{ startRow: 0, startColumn: 0, rowData: [rowData(T_HEADERS, true), rowData(T_SAMPLE, false)] }] },
        { properties: { title: 'Options' }, data: [{ startRow: 0, startColumn: 0, rowData: T_OPTIONS.map((r, i) => rowData(r, i === 0)) }] }
      ]
    };
    const cr = await fetch('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const cd = await cr.json().catch(() => ({}));
    if (!cr.ok || !cd.spreadsheetId) { reply.code(502); return { error: 'Could not create sheet: ' + ((cd.error && cd.error.message) || cr.status) }; }
    const id = cd.spreadsheetId;
    // Share anyone-with-link → writer so the seller can fill it (needs Drive API).
    await fetch('https://www.googleapis.com/drive/v3/files/' + id + '/permissions', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'writer', type: 'anyone' }) }).catch(() => {});
    return { ok: true, id, url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' };
  });

  // Read a sheet → { rows, title, tab }. Any seller may import into their own orders.
  app.get('/api/sheets', { preHandler: requireAuth }, async (req, reply) => {
    if (!API_KEY) { reply.code(503); return { error: 'Google Sheets import is not configured on the server.' }; }
    const raw = req.query.url || req.query.id || '';
    const id = extractId(raw);
    if (!id) { reply.code(400); return { error: 'Could not read a spreadsheet ID from that link.' }; }
    const gid = extractGid(raw);
    try {
      // 1) Find which tab to read. Prefer ?tab=, else the gid in the URL, else a
      //    tab literally named "Orders", else the first tab.
      const metaR = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?key=${API_KEY}&fields=properties.title,sheets.properties(title,sheetId)`);
      const meta = await metaR.json().catch(() => ({}));
      if (!metaR.ok) {
        const msg = (meta.error && meta.error.message) || '';
        if (metaR.status === 403) { reply.code(403); return { error: 'This sheet isn’t shared. In Google Sheets: Share → General access → “Anyone with the link” → Viewer.', detail: msg }; }
        if (metaR.status === 404) { reply.code(404); return { error: 'Spreadsheet not found — double-check the link.', detail: msg }; }
        reply.code(502); return { error: 'Google Sheets error: ' + (msg || metaR.status) };
      }
      const sheets = (meta.sheets || []).map((s) => s.properties).filter(Boolean);
      const wantTab = String(req.query.tab || '').trim();
      let pick = null;
      if (wantTab) pick = sheets.find((s) => s.title === wantTab);
      if (!pick && gid != null) pick = sheets.find((s) => String(s.sheetId) === String(gid));
      if (!pick) pick = sheets.find((s) => /^orders$/i.test(s.title));
      if (!pick) pick = sheets[0];
      if (!pick) { reply.code(404); return { error: 'The spreadsheet has no readable tabs.' }; }

      // 2) Read that tab's values. FORMATTED_VALUE (the default) keeps cells exactly
      //    as displayed — important so a zip like 07030 isn't coerced to 7030.
      const range = encodeURIComponent(pick.title);
      const valR = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?key=${API_KEY}&majorDimension=ROWS`);
      const val = await valR.json().catch(() => ({}));
      if (!valR.ok) { reply.code(502); return { error: 'Could not read tab “' + pick.title + '”: ' + ((val.error && val.error.message) || valR.status) }; }
      const rows = (val.values || [])
        .map((r) => r.map((c) => (c == null ? '' : String(c))))
        .filter((r) => r.some((c) => String(c).trim() !== ''));   // drop blank rows
      return { ok: true, title: meta.properties && meta.properties.title, tab: pick.title, rows };
    } catch (e) {
      reply.code(502); return { error: 'Failed to reach Google Sheets: ' + e.message };
    }
  });
}
