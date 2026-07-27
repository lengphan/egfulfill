// wilcom.js — Wilcom Embroidery Web API (EWA) client + connectivity check.
//
// EWA is a REST API: POST form params `appId` + `appKey` (+ a `RequestXml` recipe for the
// design/trueview methods) and it returns an XML string, HTTP 200 on success. Base URL:
//   https://public.ewa.wilcomapps.com/    e.g. POST api/info, api/newDesignTrueview, …
// Design/trueview results come back as base64 inside <files><file><filecontents>…, which a
// later build will parse; for now this module only proves the credentials work.
//
// Credentials are READ AT CALL TIME (never at module load) — the same rule every other
// integration here follows, so a key saved in Settings › Integrations applies on the next
// request without a redeploy. They live server-side only; the appKey is a secret and must
// never be sent to the browser.
//
// No XML parser dependency yet — the connectivity check only needs the status + a raw
// sample, and a small regex pulls out an error message if EWA returned one. A proper XML
// parse (into design/trueview bytes) comes with the digitizing build, added as a real dep.

import crypto from 'node:crypto';
import { q } from '../db.js';
import { storageEnabled, putObject, getObject } from '../storage.js';

const EWA_BASE = 'https://public.ewa.wilcomapps.com/';
const appId = () => (process.env.WILCOM_APP_ID || '').trim();
const appKey = () => (process.env.WILCOM_APP_KEY || '').trim();
const configured = () => !!(appId() && appKey());

/**
 * POST a form-encoded EWA call. `method` is a path like 'api/info'; `xml` is the optional
 * RequestXml recipe. Returns the raw response — parsing the XML into design/trueview bytes
 * is the next build's job, once the Interface Spec's XML data-package shapes are wired.
 */
async function ewaCall(method, xml) {
  const body = new URLSearchParams();
  body.set('appId', appId());
  body.set('appKey', appKey());
  if (xml) body.set('RequestXml', xml);
  const r = await fetch(EWA_BASE + String(method).replace(/^\/+/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await r.text().catch(() => '');
  return { status: r.status, ok: r.ok, body: text };
}

// ── Bitmap auto-digitize ───────────────────────────────────────────────────────
// Preview = api/bitmapArtTrueview (proof + stitch count, no machine file); Digitize =
// api/bitmapArtDesign (+ the machine file). Same request shape; `design` toggles the
// design_file output. Contract: docs/WILCOM-EWA-PHASE1.md.
const XML_ESC = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// EWA filenames accept only 0-9 a-z A-Z - _ space; sanitize anything else.
const safeName = (s, fallback) => (String(s || '').replace(/[^0-9A-Za-z _-]/g, '_').trim() || fallback);

function fromDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp' })[mime] || 'png';
  return { mime, ext, base64: m[2].replace(/\s+/g, '') };
}

function buildBitmapXml({ filename, base64, width, height, designFile }) {
  const dims = [width ? `width="${Number(width)}"` : '', height ? `height="${Number(height)}"` : ''].filter(Boolean).join(' ');
  const out = [designFile ? `design_file="${XML_ESC(designFile)}"` : '', 'trueview_file="trueview.png"', 'dpi="120"'].filter(Boolean).join(' ');
  // NB: the <bitmap> file-reference attribute name is UNCONFIRMED in the spec — `file` is the
  // best read of "specifies which file element will be processed". If the first live call
  // rejects it, the EWA error says so; fix the attribute here.
  return '<xml>'
    + `<bitmap file="${XML_ESC(filename)}"/>`
    + `<autodigitize_options ${dims}/>`
    + `<output ${out}/>`
    + `<files><file filename="${XML_ESC(filename)}" filecontents="${base64}"/></files>`
    + '</xml>';
}

// ── designTrueview: photoreal PNG from an EXISTING machine file (.emb) ─────────
// Recipe skeleton from the spec (api-designtrueview): <design/> + <trueview_options/> +
// <files><file/></files>. The exact attribute NAMES aren't published, so these mirror the
// bitmap recipe above and are a BEST-EFFORT — a wrong attribute just makes EWA return an
// error we surface, and the board falls back to its placeholder (nothing breaks). Fix the
// two attributes here once validated against a live account. EMB is Wilcom-native, so
// designTrueview reads it directly; other formats aren't guaranteed and are skipped.
function buildDesignTrueviewXml({ filename, base64 }) {
  return '<xml>'
    + `<design file="${XML_ESC(filename)}"/>`
    + `<trueview_options trueview_file="trueview.png" dpi="120"/>`
    + `<files><file filename="${XML_ESC(filename)}" filecontents="${base64}"/></files>`
    + '</xml>';
}

// Dependency-free parse: base64 contains no `"` or `>`, so attribute regex is safe here.
function parseFiles(xml) {
  const files = [];
  const tagRe = /<file\b([^>]*?)\/?>/gi;
  let t;
  while ((t = tagRe.exec(xml))) {
    const fn = /filename="([^"]*)"/i.exec(t[1]);
    const fc = /filecontents="([^"]*)"/i.exec(t[1]);
    if (fn && fc) files.push({ filename: fn[1], base64: fc[1] });
  }
  return files;
}
function parseDesignInfo(xml) {
  const seg = /<design_info\b([^>]*?)\/?>/i.exec(xml);
  if (!seg) return null;
  const g = (k) => { const m = new RegExp(k + '="([^"]*)"', 'i').exec(seg[1]); return m ? m[1] : null; };
  const n = (v) => (v == null || v === '' ? null : Number(v));
  return { stitches: n(g('num_stitches')), colours: n(g('num_colours')), width: n(g('width')), height: n(g('height')), machine: g('machine_name') };
}
// Threads used in the result. EWA encodes colour as an int R+(G<<8)+(B<<16); decode to RGB
// so the UI can match each against the admin thread library.
function parseThreads(xml) {
  const out = [], seen = new Set();
  const re = /<thread\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const g = (k) => { const mm = new RegExp(k + '="([^"]*)"', 'i').exec(m[1]); return mm ? mm[1] : null; };
    const ci = g('color');
    if (ci == null) continue;
    const c = Number(ci);
    if (!Number.isFinite(c)) continue;
    const r = c & 255, gg = (c >> 8) & 255, b = (c >> 16) & 255;
    const key = `${r},${gg},${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ r, g: gg, b, code: g('code'), brand: g('brand'), name: g('description') });
  }
  return out;
}
const isPng = (f) => /\.png$/i.test(f);
const isMachine = (f) => /\.(emb|dst|pes|exp|jef|vp3|xxx|hus)$/i.test(f);
const MAX_INPUT_BYTES = 2 * 1024 * 1024; // EWA auto-digitize cap
const tooBig = (base64) => Math.floor(base64.length * 3 / 4) > MAX_INPUT_BYTES;

// History store — created idempotently at first use, like the other late tables. Holds one
// row per GENERATED design (previews aren't persisted); the TrueView + machine file live in
// object storage, not base64 in Postgres.
let _genReady = null;
function ensureGen() {
  if (_genReady) return _genReady;
  _genReady = q(`create table if not exists wilcom_generations (
      id text primary key, by_user uuid, name text, order_ref text, source text, type text,
      stitches int, colours int, width numeric, height numeric, formats text[],
      trueview_url text, file_url text, created_at timestamptz default now())`)
    .then(() => q(`create index if not exists wilcom_gen_created on wilcom_generations (created_at desc)`))
    // Storage KEYS (not just the public URL) so assets serve same-origin — a raw R2/S3 host
    // URL isn't publicly loadable in an <img> unless a CDN is configured.
    .then(() => q(`alter table wilcom_generations add column if not exists tv_key text`))
    .then(() => q(`alter table wilcom_generations add column if not exists file_key text`))
    .catch((e) => { _genReady = null; throw e; });
  return _genReady;
}

// Cache for rendered EMB TrueViews — keyed by the file's design_id, invalidated by a
// content hash so an edited file re-renders. Its OWN table, owned by this module, so
// removing Wilcom (drop the route + this table) leaves nothing dangling elsewhere.
let _pvReady = null;
function ensurePreviews() {
  if (_pvReady) return _pvReady;
  _pvReady = q(`create table if not exists wilcom_previews (
      design_id text primary key, hash text, png text, stitches int, colours int,
      created_at timestamptz default now())`)
    .catch((e) => { _pvReady = null; throw e; });
  return _pvReady;
}

// Shared handler for preview (trueview only) and digitize (+ machine file).
async function runBitmap(req, reply, { design }) {
  if (!configured()) { reply.code(400); return { ok: false, error: 'Wilcom EWA is not configured — add the key in Settings › Integrations.' }; }
  const b = req.body || {};
  const img = fromDataUrl(b.image);
  if (!img) { reply.code(400); return { ok: false, error: 'Send an image data URL (PNG / JPG / WEBP).' }; }
  if (tooBig(img.base64)) { reply.code(413); return { ok: false, error: 'Image is over 2 MB — auto-digitize needs a smaller file. Downscale it first.' }; }
  const stem = safeName(b.filename, 'art');
  const filename = `${stem}.${img.ext}`;
  const xml = buildBitmapXml({ filename, base64: img.base64, width: b.width, height: b.height, designFile: design ? `${stem}.emb` : null });
  try {
    const res = await ewaCall(design ? 'api/bitmapArtDesign' : 'api/bitmapArtTrueview', xml);
    if (!res.ok) {
      const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '');
      reply.code(502);
      return { ok: false, status: res.status, error: m ? m[1].trim() : 'EWA rejected the request', sample: (res.body || '').slice(0, 400) };
    }
    const files = parseFiles(res.body);
    const info = parseDesignInfo(res.body) || {};
    const tv = files.find((f) => isPng(f.filename));
    const machine = design ? files.find((f) => isMachine(f.filename)) : null;
    const out = {
      ok: true,
      trueview: tv ? tv.base64 : null,                                   // base64 PNG (no data: prefix)
      machineFile: machine ? { filename: machine.filename, base64: machine.base64 } : null,
      stitches: info.stitches ?? null, colours: info.colours ?? null,
      width: info.width ?? null, height: info.height ?? null,
      threads: parseThreads(res.body),
    };
    // Persist a GENERATION (not a preview) so it shows in History. Best-effort: a storage
    // hiccup must not fail the response the operator is waiting on.
    if (design && storageEnabled()) {
      try {
        await ensureGen();
        const gid = 'WG-' + crypto.randomBytes(8).toString('hex');
        const ext = machine ? (machine.filename.split('.').pop() || 'emb').toLowerCase() : null;
        const tvKey = tv ? `wilcom/${gid}-tv.png` : null;
        const fileKey = machine ? `wilcom/${gid}-${stem}.${ext}` : null;
        const tvUrl = tvKey ? await putObject(tvKey, Buffer.from(tv.base64, 'base64'), 'image/png') : null;
        const fileUrl = fileKey ? await putObject(fileKey, Buffer.from(machine.base64, 'base64'), 'application/octet-stream') : null;
        await q(
          `insert into wilcom_generations (id, by_user, name, order_ref, source, type, stitches, colours, width, height, formats, trueview_url, file_url, tv_key, file_key)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [gid, req.user?.sub || null, b.name || stem, b.orderRef || null, b.source || 'order', 'auto',
           out.stitches, out.colours, out.width, out.height, ext ? [ext.toUpperCase()] : [], tvUrl, fileUrl, tvKey, fileKey]);
        out.id = gid; out.trueviewUrl = tvUrl; out.fileUrl = fileUrl;
      } catch (e) { req.log?.warn?.({ err: String(e) }, 'wilcom generation persist failed'); }
    }
    return out;
  } catch (e) {
    reply.code(502);
    return { ok: false, error: (e && e.message) || 'Could not reach the Wilcom EWA service' };
  }
}

// ── Lettering (text → embroidery) ──────────────────────────────────────────────
// EWA colour is an int R+(G<<8)+(B<<16); the Maker picks a hex from the admin thread palette.
const hexToColorInt = (hex) => {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return 0;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r || 0) + ((g || 0) << 8) + ((b || 0) << 16);
};
function buildLetteringXml({ text, alphabet, height, colorInt, designFile }) {
  const out = [designFile ? `design_file="${XML_ESC(designFile)}"` : '', 'trueview_file="preview.png"', 'dpi="120"'].filter(Boolean).join(' ');
  const h = Math.min(50, Math.max(5, Number(height) || 20));
  return '<xml><recipe>'
    + '<decorations><lettering>'
    + `<simple_lettering text="${XML_ESC(text)}" alphabet_name="${XML_ESC(alphabet)}" height="${h.toFixed(1)}"/>`
    + `<thread color="${colorInt}"/>`
    + '</lettering></decorations>'
    + `<output ${out}/>`
    + '</recipe></xml>';
}
async function runLettering(req, reply, { design }) {
  if (!configured()) { reply.code(400); return { ok: false, error: 'Wilcom EWA is not configured — add the key in Settings › Integrations.' }; }
  const b = req.body || {};
  const text = String(b.text || '').trim();
  const alphabet = String(b.alphabet || '').trim();
  if (!text) { reply.code(400); return { ok: false, error: 'Enter some text to stitch.' }; }
  if (!alphabet) { reply.code(400); return { ok: false, error: 'Pick an alphabet.' }; }
  const stem = safeName(text, 'lettering');
  const xml = buildLetteringXml({ text, alphabet, height: b.height, colorInt: hexToColorInt(b.color), designFile: design ? `${stem}.emb` : null });
  try {
    // Preview uses newDesignTrueview for the REAL stitched embroidery look (newLetteringPreview
    // returns a flat, non-TrueView bitmap); generate uses newDesign to emit the machine file.
    const res = await ewaCall(design ? 'api/newDesign' : 'api/newDesignTrueview', xml);
    if (!res.ok) {
      const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '');
      reply.code(502);
      return { ok: false, status: res.status, error: m ? m[1].trim() : 'EWA rejected the request', sample: (res.body || '').slice(0, 400) };
    }
    const files = parseFiles(res.body);
    const info = parseDesignInfo(res.body) || {};
    const tv = files.find((f) => isPng(f.filename));
    const machine = design ? files.find((f) => isMachine(f.filename)) : null;
    const out = {
      ok: true,
      trueview: tv ? tv.base64 : null,
      machineFile: machine ? { filename: machine.filename, base64: machine.base64 } : null,
      stitches: info.stitches ?? null, colours: info.colours ?? null,
      width: info.width ?? null, height: info.height ?? null,
      threads: parseThreads(res.body),
    };
    if (design && storageEnabled()) {
      try {
        await ensureGen();
        const gid = 'WG-' + crypto.randomBytes(8).toString('hex');
        const ext = machine ? (machine.filename.split('.').pop() || 'emb').toLowerCase() : null;
        const tvKey = tv ? `wilcom/${gid}-tv.png` : null;
        const fileKey = machine ? `wilcom/${gid}-${stem}.${ext}` : null;
        const tvUrl = tvKey ? await putObject(tvKey, Buffer.from(tv.base64, 'base64'), 'image/png') : null;
        const fileUrl = fileKey ? await putObject(fileKey, Buffer.from(machine.base64, 'base64'), 'application/octet-stream') : null;
        await q(`insert into wilcom_generations (id, by_user, name, order_ref, source, type, stitches, colours, width, height, formats, trueview_url, file_url, tv_key, file_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [gid, req.user?.sub || null, text, null, 'maker', 'lettering', out.stitches, out.colours, out.width, out.height, ext ? [ext.toUpperCase()] : [], tvUrl, fileUrl, tvKey, fileKey]);
        out.id = gid; out.trueviewUrl = tvUrl; out.fileUrl = fileUrl;
      } catch (e) { req.log?.warn?.({ err: String(e) }, 'wilcom lettering persist failed'); }
    }
    return out;
  } catch (e) { reply.code(502); return { ok: false, error: (e && e.message) || 'Could not reach the Wilcom EWA service' }; }
}

// Alphabet list for the Maker dropdown — parsed from api/info's <alphabet name="…"> entries.
async function ewaAlphabets() {
  const res = await ewaCall('api/info', '');
  const out = [];
  const re = /<alphabet\b[^>]*\bname="([^"]*)"[^>]*\/?>/gi;
  let m;
  while ((m = re.exec(res.body || '')) && out.length < 500) out.push(m[1]);
  return out;
}

export function wilcomRoutes(app, requireStaff) {
  // Is the integration configured? Masked — never returns the key itself.
  app.get('/api/wilcom/config', { preHandler: requireStaff }, async () => ({
    configured: configured(),
    base: EWA_BASE,
  }));

  // Live connectivity + auth check: calls api/info with the stored credentials and reports
  // what EWA said. A REAL round-trip, no mock — so "the key works" is provable before any
  // digitizing flow is built on top. Never echoes the credentials back.
  app.post('/api/wilcom/test', { preHandler: requireStaff }, async (req, reply) => {
    if (!configured()) {
      reply.code(400);
      return { ok: false, error: 'Wilcom EWA is not configured — add WILCOM_APP_ID and WILCOM_APP_KEY in Settings › Integrations.' };
    }
    try {
      const res = await ewaCall('api/info', '');
      // EWA answers 200 on success; a non-200 (or an error XML) usually means a bad
      // appId/appKey. Try to pull a human-readable message out of the XML either way, but
      // always surface the status + a trimmed body so a wrong contract is diagnosable.
      const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '');
      return { ok: res.ok, status: res.status, message: m ? m[1].trim() : null, sample: (res.body || '').slice(0, 800) };
    } catch (e) {
      reply.code(502);
      return { ok: false, error: (e && e.message) || 'Could not reach the Wilcom EWA service' };
    }
  });

  // Preview — auto-digitize to a TrueView proof + stitch count, no machine file.
  app.post('/api/wilcom/preview', { preHandler: requireStaff }, (req, reply) => runBitmap(req, reply, { design: false }));
  // Digitize — auto-digitize to a machine file (+ TrueView + stitch count).
  app.post('/api/wilcom/digitize', { preHandler: requireStaff }, (req, reply) => runBitmap(req, reply, { design: true }));

  // History — every generated design, newest first (searched client-side).
  app.get('/api/wilcom/generations', { preHandler: requireStaff }, async () => {
    await ensureGen();
    const r = await q(`select id, name, order_ref, source, type, stitches, colours, width, height, formats, trueview_url, file_url, created_at
                         from wilcom_generations order by created_at desc limit 200`);
    return { generations: r.rows };
  });

  // Maker — lettering: alphabet list for the dropdown, fast preview, and generate-to-file.
  app.get('/api/wilcom/alphabets', { preHandler: requireStaff }, async (req, reply) => {
    if (!configured()) { reply.code(400); return { alphabets: [] }; }
    try { return { alphabets: await ewaAlphabets() }; }
    catch { reply.code(502); return { alphabets: [] }; }
  });
  app.post('/api/wilcom/lettering-preview', { preHandler: requireStaff }, (req, reply) => runLettering(req, reply, { design: false }));
  app.post('/api/wilcom/lettering', { preHandler: requireStaff }, (req, reply) => runLettering(req, reply, { design: true }));

  // TrueView preview of an already-uploaded machine file (.emb), for the board card that
  // otherwise shows a blank placeholder. Resolve the file by its own id or by order+sku,
  // render once, cache by content hash. ISOLATED + graceful: returns { unavailable:true }
  // (not an error) when Wilcom isn't configured or the file isn't a native .emb, so the
  // caller quietly keeps its placeholder. Removing the WILCOM keys can't break the board.
  app.post('/api/wilcom/design-preview', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    let row = null;
    if (b.designId) {
      row = (await q(`select design_id, file_name, mime, data from design_file_data where design_id=$1`, [String(b.designId)])).rows[0];
    } else if (b.orderId) {
      row = (await q(`select design_id, file_name, mime, data from design_file_data
                        where order_id=$1 and sku is not distinct from $2
                          and (kind='emb' or lower(file_name) like '%.emb')
                        order by created_at desc limit 1`,
        [String(b.orderId), b.sku == null ? null : String(b.sku)])).rows[0];
    }
    if (!row || !row.data) { reply.code(404); return { ok: false, error: 'No machine file for that design.' }; }
    // designTrueview reads Wilcom-native .emb; skip anything else rather than guessing.
    if (!/\.emb$/i.test(row.file_name || '') && !/emb/i.test(row.mime || '')) {
      return { ok: false, unavailable: true, reason: 'not-emb' };
    }
    await ensurePreviews();
    const dataStr = String(row.data);
    const hash = crypto.createHash('sha1').update(dataStr).digest('hex').slice(0, 16);
    const cached = (await q(`select png, stitches, colours from wilcom_previews where design_id=$1 and hash=$2`, [row.design_id, hash])).rows[0];
    if (cached && cached.png) return { ok: true, png: cached.png, stitches: cached.stitches, colours: cached.colours, cached: true };
    if (!configured()) return { ok: false, unavailable: true, reason: 'not-configured' };
    const m = /base64,([\s\S]+)$/.exec(dataStr);
    const base64 = (m ? m[1] : dataStr).replace(/\s+/g, '');
    const filename = safeName(String(row.file_name || 'design').replace(/\.[^.]+$/, ''), 'design') + '.emb';
    try {
      const res = await ewaCall('api/designTrueview', buildDesignTrueviewXml({ filename, base64 }));
      if (!res.ok) {
        const em = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '');
        reply.code(502);
        return { ok: false, error: em ? em[1].trim() : 'EWA rejected the request', sample: (res.body || '').slice(0, 300) };
      }
      const files = parseFiles(res.body);
      const info = parseDesignInfo(res.body) || {};
      const tv = files.find((f) => isPng(f.filename));
      if (!tv) { reply.code(502); return { ok: false, error: 'EWA returned no preview image.' }; }
      await q(`insert into wilcom_previews (design_id, hash, png, stitches, colours) values ($1,$2,$3,$4,$5)
               on conflict (design_id) do update set hash=excluded.hash, png=excluded.png,
                 stitches=excluded.stitches, colours=excluded.colours, created_at=now()`,
        [row.design_id, hash, tv.base64, info.stitches ?? null, info.colours ?? null]).catch(() => {});
      return { ok: true, png: tv.base64, stitches: info.stitches ?? null, colours: info.colours ?? null };
    } catch (e) {
      reply.code(502); return { ok: false, error: (e && e.message) || 'Could not reach the Wilcom EWA service' };
    }
  });

  // Same-origin serve for a generation's TrueView (kind=tv) or machine file (kind=file).
  // Unauthenticated on purpose — like the image proxy, it only re-serves bytes addressed by
  // an unguessable random id (WG-…), so an <img>/download works without an auth header, and
  // it doesn't depend on a public storage URL being configured.
  app.get('/api/wilcom/asset/:id/:kind', async (req, reply) => {
    await ensureGen();
    const kind = req.params.kind === 'file' ? 'file' : 'tv';
    const col = kind === 'file' ? 'file_key' : 'tv_key';
    const r = await q(`select ${col} as key, name, formats from wilcom_generations where id=$1`, [String(req.params.id)]);
    const row = r.rows[0];
    if (!row || !row.key) { reply.code(404); return { error: 'not found' }; }
    const obj = await getObject(row.key).catch(() => null);
    if (!obj) { reply.code(404); return { error: 'not found' }; }
    reply.header('Content-Type', obj.contentType || (kind === 'file' ? 'application/octet-stream' : 'image/png'));
    reply.header('Cache-Control', 'public, max-age=86400');
    if (kind === 'file') {
      const fmt = String((row.formats && row.formats[0]) || 'emb').toLowerCase();
      const base = String(row.name || 'design').replace(/[^0-9A-Za-z._-]/g, '_');
      reply.header('Content-Disposition', `attachment; filename="${base}.${fmt}"`);
    }
    return reply.send(obj.body);
  });
}
