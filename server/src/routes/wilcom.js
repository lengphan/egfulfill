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
import { storageEnabled, putObject } from '../storage.js';

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
    .catch((e) => { _genReady = null; throw e; });
  return _genReady;
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
        const tvUrl = tv ? await putObject(`wilcom/${gid}-tv.png`, Buffer.from(tv.base64, 'base64'), 'image/png') : null;
        const fileUrl = machine ? await putObject(`wilcom/${gid}-${stem}.${ext}`, Buffer.from(machine.base64, 'base64'), 'application/octet-stream') : null;
        await q(
          `insert into wilcom_generations (id, by_user, name, order_ref, source, type, stitches, colours, width, height, formats, trueview_url, file_url)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [gid, req.user?.sub || null, b.name || stem, b.orderRef || null, b.source || 'order', 'auto',
           out.stitches, out.colours, out.width, out.height, ext ? [ext.toUpperCase()] : [], tvUrl, fileUrl]);
        out.id = gid; out.trueviewUrl = tvUrl; out.fileUrl = fileUrl;
      } catch (e) { req.log?.warn?.({ err: String(e) }, 'wilcom generation persist failed'); }
    }
    return out;
  } catch (e) {
    reply.code(502);
    return { ok: false, error: (e && e.message) || 'Could not reach the Wilcom EWA service' };
  }
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
}
