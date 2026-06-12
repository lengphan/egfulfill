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

const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_API_KEY || '';
const TEMPLATE_URL = process.env.SHEETS_TEMPLATE_URL || '';

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

export function sheetsRoutes(app, requireAuth) {
  // Public config: is import enabled, and the template link to copy (if any).
  app.get('/api/sheets/config', async () => ({ enabled: !!API_KEY, templateUrl: TEMPLATE_URL }));

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
