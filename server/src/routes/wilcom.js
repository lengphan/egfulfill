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
import { recordUsage } from '../usage.js';

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
  recordUsage('wilcom', { endpoint: String(method).replace(/^\/+/, ''), ok: r.ok });
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
// Per the spec: <file> has ONLY filename + filecontents, and the INPUT design is identified
// by being in <files> (the method's context makes it the input) — there is NO <design
// file="…"> reference. `<design>` is an OPTIONAL colorway parameter, not a file pointer, so
// including it as a file reference made EWA report "Call to EmbServer_GenerateDesign failed"
// (it had no design to render). We therefore pass just the .emb in <files> plus
// <trueview_options> and let designTrueview return the PNG in <files>.
function buildDesignTrueviewXml({ filename, base64 }) {
  return '<xml>'
    + `<trueview_options dpi="120"/>`
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
      const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '') || /\bmessage="([^"]{1,300})"/i.exec(res.body || '');
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
      const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '') || /\bmessage="([^"]{1,300})"/i.exec(res.body || '');
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

// ── Combined: bitmap art + lettering in ONE design ─────────────────────────────
// Per the Wilcom API guide the merge is a TWO-STEP: (1) auto-digitize the image to an .emb,
// (2) call newDesign with a recipe whose <decorations> hold the .emb as a <design> decoration
// ALONGSIDE the <lettering> decoration (both are valid decoration types; sequence = stitch
// order). buildCombinedXml is step 2 — it embeds the already-digitized .emb via <files>.
// Ref: apiguide.wilcom.com …/design-recipe-recipe-xml-data/decorations/ and …/design/.
// A decoration's transform. The EWA attribute names are EXACT (apiguide.wilcom.com …/transform/):
//   dx / dy   millimetres from the location's TOP-LEFT corner (+x right, +y DOWN)
//   rotation  degrees, positive = clockwise      scale  HARD-LIMITED to 0.8–1.2 (±20%)
//   mirror    none | horizontal | vertical | both
// (An earlier build emitted x/y/angle/scale — names EWA doesn't recognise — so every decoration
// silently landed at the origin. That was the "everything stacked in the centre" bug.)
// Always emitted for a multi-layer design: without dx/dy each decoration defaults to the same
// top-left and they pile up.
function tfXml(tf) {
  if (!tf) return '';
  const dx = Number(tf.dx) || 0, dy = Number(tf.dy) || 0, rotation = Number(tf.rotation) || 0;
  let scale = Number(tf.scale); scale = Number.isFinite(scale) && scale > 0 ? Math.min(1.2, Math.max(0.8, scale)) : 1;
  const mirror = ['horizontal', 'vertical', 'both'].includes(tf.mirror) ? tf.mirror : 'none';
  return `<transform scale="${scale}" mirror="${mirror}" rotation="${rotation}" dx="${dx.toFixed(2)}" dy="${dy.toFixed(2)}"/>`;
}
function buildCombinedXml({ embName, embBase64, text, alphabet, letterHeight, colorInt, designFile, designTf, letterTf }) {
  const lh = Math.min(50, Math.max(5, Number(letterHeight) || 20));
  const out = [designFile ? `design_file="${XML_ESC(designFile)}"` : '', 'trueview_file="preview.png"', 'dpi="120"'].filter(Boolean).join(' ');
  return '<xml><recipe>'
    + '<decorations>'
    + `<design file="${XML_ESC(embName)}" colorwaytype="current">${tfXml(designTf)}</design>`
    + '<lettering>'
    + tfXml(letterTf)
    + `<simple_lettering text="${XML_ESC(text)}" alphabet_name="${XML_ESC(alphabet)}" height="${lh.toFixed(1)}"/>`
    + `<thread color="${colorInt}"/>`
    + '</lettering>'
    + '</decorations>'
    + `<output ${out}/>`
    + '</recipe>'
    // <files> is a top-level child of <xml>, a SIBLING of <recipe> — NOT nested inside it
    // (EWA resolves <design file> against xml/files; nesting it caused error 101 "Couldn't
    // find the file … under files element"). Mirrors the bitmap recipe's placement.
    + `<files><file filename="${XML_ESC(embName)}" filecontents="${embBase64}"/></files>`
    + '</xml>';
}

// Multi-layer generalisation of the recipe above: an ORDERED list of decorations (each an
// already-digitized .emb `design` or a `lettering`) plus the <files> they reference. Decoration
// order == stitch order (later stitches on top), so the caller emits them in layer order.
function decoXml(d) {
  if (d.type === 'design') return `<design file="${XML_ESC(d.embName)}" colorwaytype="current">${tfXml(d.transform)}</design>`;
  const lh = Math.min(50, Math.max(5, Number(d.height) || 20));
  return '<lettering>' + tfXml(d.transform)
    + `<simple_lettering text="${XML_ESC(d.text)}" alphabet_name="${XML_ESC(d.alphabet)}" height="${lh.toFixed(1)}"/>`
    + `<thread color="${d.colorInt}"/></lettering>`;
}
function buildMultiXml({ decorations, files, designFile }) {
  const out = [designFile ? `design_file="${XML_ESC(designFile)}"` : '', 'trueview_file="preview.png"', 'dpi="120"'].filter(Boolean).join(' ');
  return '<xml><recipe><decorations>'
    + decorations.map(decoXml).join('')
    + '</decorations>'
    + `<output ${out}/>`
    + '</recipe>'
    // <files> is a SIBLING of <recipe> (nesting caused error 101) — one <file> per distinct emb.
    + `<files>${files.map((f) => `<file filename="${XML_ESC(f.filename)}" filecontents="${f.base64}"/>`).join('')}</files>`
    + '</xml>';
}

// The auto-digitized .emb for an image doesn't change while the image is fixed, so cache it by
// content hash: a live combined preview then re-runs only the FAST lettering step as you type,
// not the heavy (up to 90s) auto-digitize on every keystroke. Small LRU-ish cap.
const _embCache = new Map();
function embCacheGet(hash) { const v = _embCache.get(hash); if (v) { _embCache.delete(hash); _embCache.set(hash, v); } return v; }
function embCacheSet(hash, v) { _embCache.set(hash, v); if (_embCache.size > 24) _embCache.delete(_embCache.keys().next().value); }

// Auto-digitize one image → { filename, base64 } .emb, cached by content hash. Returns a
// { error, status, sample } object instead on failure so the caller can bubble it up verbatim.
async function digitizeToEmb(image, nameHint, i) {
  const img = fromDataUrl(image);
  if (!img) return { error: 'Send image data URLs (PNG / JPG / WEBP).', status: 400 };
  if (tooBig(img.base64)) return { error: `Image "${nameHint || i + 1}" is over 2 MB — downscale it first.`, status: 413 };
  const hash = crypto.createHash('sha256').update(img.base64).digest('hex').slice(0, 32);
  const cached = embCacheGet(hash);
  if (cached) return { emb: cached };
  const artStem = safeName(nameHint || `art${i}`, `art${i}`);
  const artXml = buildBitmapXml({ filename: `${artStem}.${img.ext}`, base64: img.base64, designFile: `${artStem}.emb` });
  const artRes = await ewaCall('api/bitmapArtDesign', artXml);
  if (!artRes.ok) {
    const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(artRes.body || '') || /\bmessage="([^"]{1,300})"/i.exec(artRes.body || '');
    return { error: m ? m[1].trim() : 'EWA could not auto-digitize the image', status: 502, sample: (artRes.body || '').replace(/filecontents="[^"]*"/gi, 'filecontents="[base64]"').slice(0, 2000) };
  }
  const artEmb = parseFiles(artRes.body).find((f) => /\.emb$/i.test(f.filename));
  if (!artEmb) return { error: 'Auto-digitize returned no .emb to combine with the text.', status: 502, sample: (artRes.body || '').slice(0, 400) };
  const emb = { filename: artEmb.filename, base64: artEmb.base64 };
  embCacheSet(hash, emb);
  return { emb };
}

// Shared tail for the combine paths: read the newDesign response, shape the output, persist
// (design mode + storage on). `res` is the raw ewaCall result.
async function finalizeDesign(req, reply, { design, res, stem, nameLabel, orderRef }) {
  if (!res.ok) {
    const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '') || /\bmessage="([^"]{1,300})"/i.exec(res.body || '');
    reply.code(502);
    return { ok: false, status: res.status, error: m ? m[1].trim() : 'EWA rejected the combined design', sample: (res.body || '').replace(/filecontents="[^"]*"/gi, 'filecontents="[base64]"').slice(0, 2000) };
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
        [gid, req.user?.sub || null, nameLabel, orderRef || null, 'maker', 'combined', out.stitches, out.colours, out.width, out.height, ext ? [ext.toUpperCase()] : [], tvUrl, fileUrl, tvKey, fileKey]);
      out.id = gid; out.trueviewUrl = tvUrl; out.fileUrl = fileUrl;
    } catch (e) { req.log?.warn?.({ err: String(e) }, 'wilcom combine persist failed'); }
  }
  return out;
}

// Multi-layer combine — N image layers (each auto-digitized) plus an optional text layer, in
// the caller's order. Degenerate cases fall back to the proven single-mode handlers.
async function runCombineLayers(req, reply, { design }) {
  const b = req.body || {};
  const inLayers = (b.layers || []).filter((l) => l && (l.kind === 'image' || l.kind === 'text'));
  const imgs = inLayers.filter((l) => l.kind === 'image' && l.image);
  const text = String(b.text || '').trim();
  const hasText = inLayers.some((l) => l.kind === 'text') && !!text;
  if (imgs.length === 0 && hasText) { req.body = { ...b, alphabet: b.alphabet }; return runLettering(req, reply, { design }); }
  if (imgs.length === 1 && !hasText) { req.body = { ...b, image: imgs[0].image, filename: imgs[0].name }; return runBitmap(req, reply, { design }); }
  if (imgs.length === 0 && !hasText) { reply.code(400); return { ok: false, error: 'Add an image, some text, or both.' }; }
  const alphabet = String(b.alphabet || '').trim();
  if (hasText && !alphabet) { reply.code(400); return { ok: false, error: 'Pick an alphabet for the text.' }; }
  try {
    // Auto-digitize every image; give each a UNIQUE <files> name so a repeated image can't collide.
    const files = [];
    const embName = new Map();
    let i = 0;
    for (const l of imgs) {
      const r = await digitizeToEmb(l.image, l.name, i);
      if (r.error) { reply.code(r.status || 502); return { ok: false, status: r.status, error: r.error, sample: r.sample }; }
      const name = `layer-${i}.emb`;
      files.push({ filename: name, base64: r.emb.base64 });
      embName.set(l, name);
      i++;
    }
    const colorInt = hexToColorInt(b.color);
    const decorations = inLayers.map((l) => embName.has(l)
      ? { type: 'design', embName: embName.get(l), transform: l.transform }
      : (l.kind === 'text' && hasText ? { type: 'lettering', text, alphabet, height: b.height, colorInt, transform: l.transform } : null)
    ).filter(Boolean);
    const stem = safeName(b.name || text || 'design', 'design');
    const xml = buildMultiXml({ decorations, files, designFile: design ? `${stem}.emb` : null });
    const res = await ewaCall(design ? 'api/newDesign' : 'api/newDesignTrueview', xml);
    const label = [text, ...imgs.map((l) => l.name).filter(Boolean)].filter(Boolean).join(' + ') || stem;
    return finalizeDesign(req, reply, { design, res, stem, nameLabel: label, orderRef: b.orderRef });
  } catch (e) { reply.code(502); return { ok: false, error: (e && e.message) || 'Could not reach the Wilcom EWA service' }; }
}

async function runCombine(req, reply, { design }) {
  if (!configured()) { reply.code(400); return { ok: false, error: 'Wilcom EWA is not configured — add the key in Settings › Integrations.' }; }
  const b = req.body || {};
  // New ordered multi-layer payload takes precedence over the legacy single-image fields.
  if (Array.isArray(b.layers) && b.layers.length) return runCombineLayers(req, reply, { design });
  const text = String(b.text || '').trim();
  const hasImg = !!b.image;
  // Only one input → use the PROVEN single-mode path, not the prototype recipe.
  if (hasImg && !text) return runBitmap(req, reply, { design });
  if (text && !hasImg) return runLettering(req, reply, { design });
  if (!hasImg && !text) { reply.code(400); return { ok: false, error: 'Add an image, some text, or both.' }; }

  const img = fromDataUrl(b.image);
  if (!img) { reply.code(400); return { ok: false, error: 'Send an image data URL (PNG / JPG / WEBP).' }; }
  if (tooBig(img.base64)) { reply.code(413); return { ok: false, error: 'Image is over 2 MB — downscale it first.' }; }
  const alphabet = String(b.alphabet || '').trim();
  if (!alphabet) { reply.code(400); return { ok: false, error: 'Pick an alphabet for the text.' }; }
  const stem = safeName(b.filename || text, 'design');
  try {
    // STEP 1 — auto-digitize the image to an .emb (cached by image content hash, so live typing
    // re-runs only the lettering step, not this heavy call).
    const hash = crypto.createHash('sha256').update(img.base64).digest('hex').slice(0, 32);
    let emb = embCacheGet(hash);
    if (!emb) {
      const artStem = safeName(b.filename || 'art', 'art');
      const artXml = buildBitmapXml({ filename: `${artStem}.${img.ext}`, base64: img.base64, width: b.width, height: b.height, designFile: `${artStem}.emb` });
      const artRes = await ewaCall('api/bitmapArtDesign', artXml);
      if (!artRes.ok) {
        const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(artRes.body || '') || /\bmessage="([^"]{1,300})"/i.exec(artRes.body || '');
        reply.code(502);
        return { ok: false, status: artRes.status, error: m ? m[1].trim() : 'EWA could not auto-digitize the image', sample: (artRes.body || '').replace(/filecontents="[^"]*"/gi, 'filecontents="[base64]"').slice(0, 2000) };
      }
      const artEmb = parseFiles(artRes.body).find((f) => /\.emb$/i.test(f.filename));
      if (!artEmb) { reply.code(502); return { ok: false, error: 'Auto-digitize returned no .emb to combine with the text.', sample: (artRes.body || '').slice(0, 400) }; }
      emb = { filename: artEmb.filename, base64: artEmb.base64 };
      embCacheSet(hash, emb);
    }
    // STEP 2 — one design: the .emb as a <design> decoration + the <lettering> decoration.
    const xml = buildCombinedXml({ embName: emb.filename, embBase64: emb.base64, text, alphabet, letterHeight: b.height, colorInt: hexToColorInt(b.color), designFile: design ? `${stem}.emb` : null, designTf: b.designTransform, letterTf: b.letterTransform });
    const res = await ewaCall(design ? 'api/newDesign' : 'api/newDesignTrueview', xml);
    return finalizeDesign(req, reply, { design, res, stem, nameLabel: `${text} + ${stem}`, orderRef: b.orderRef });
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
      const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '') || /\bmessage="([^"]{1,300})"/i.exec(res.body || '');
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
  // Create — combined image + lettering in one design (prototype). Delegates to the proven
  // bitmap/lettering handlers when only one input is present; both → the combined recipe.
  app.post('/api/wilcom/combine-preview', { preHandler: requireStaff }, (req, reply) => runCombine(req, reply, { design: false }));
  app.post('/api/wilcom/combine', { preHandler: requireStaff }, (req, reply) => runCombine(req, reply, { design: true }));

  // TrueView preview of an already-uploaded machine file (.emb), for the board card that
  // otherwise shows a blank placeholder. Resolve the file by its own id or by order+sku,
  // render once, cache by content hash. ISOLATED + graceful: returns { unavailable:true }
  // (not an error) when Wilcom isn't configured or the file isn't a native .emb, so the
  // caller quietly keeps its placeholder. Removing the WILCOM keys can't break the board.
  app.post('/api/wilcom/design-preview', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    let row = null;
    const cols = `design_id, file_name, mime, data, url, content_hash`;
    if (b.designId) {
      row = (await q(`select ${cols} from design_file_data where design_id=$1`, [String(b.designId)])).rows[0];
    } else if (b.orderId) {
      // Prefer the sku's own .emb; but a "Seller file" card may carry a different (or null)
      // sku than the file was stored under, so fall back to ANY .emb on the order rather
      // than showing nothing. A preview of the order's stitch file still beats a blank tile.
      const embWhere = `(kind='emb' or lower(file_name) like '%.emb')`;
      if (b.sku != null && b.sku !== '') {
        row = (await q(`select ${cols} from design_file_data
                          where order_id=$1 and sku=$2 and ${embWhere} order by created_at desc limit 1`,
          [String(b.orderId), String(b.sku)])).rows[0];
      }
      if (!row) {
        row = (await q(`select ${cols} from design_file_data
                          where order_id=$1 and ${embWhere} order by created_at desc limit 1`,
          [String(b.orderId)])).rows[0];
      }
    }
    if (!row) { reply.code(404); return { ok: false, error: 'No machine file for that design.' }; }
    // designTrueview reads Wilcom-native .emb; skip anything else rather than guessing.
    if (!/\.emb$/i.test(row.file_name || '') && !/emb/i.test(row.mime || '')) {
      return { ok: false, unavailable: true, reason: 'not-emb' };
    }
    await ensurePreviews();
    // Cache key from the file's stored content hash (no bytes needed to check the cache).
    const hash = String(row.content_hash || ('id-' + row.design_id)).slice(0, 32);
    const cached = (await q(`select png, stitches, colours from wilcom_previews where design_id=$1 and hash=$2`, [row.design_id, hash])).rows[0];
    if (cached && cached.png) return { ok: true, png: cached.png, stitches: cached.stitches, colours: cached.colours, cached: true };
    if (!configured()) return { ok: false, unavailable: true, reason: 'not-configured' };
    // The bytes are EITHER inline (data) OR in object storage (url, public-read) — the big
    // base64 is kept out of Postgres when storage is on, which is why data can be null.
    let base64 = null;
    if (row.data) {
      const m = /base64,([\s\S]+)$/.exec(String(row.data));
      base64 = (m ? m[1] : String(row.data)).replace(/\s+/g, '');
    } else if (row.url) {
      // Objects are PRIVATE in TTL mode and the raw host URL isn't publicly fetchable, so a
      // plain GET 403s. Read via the SIGNED getObject using the key design_files.js stored it
      // under ('design-files/<designId><ext>'); fall back to a public fetch for CDN urls.
      const ext = (String(row.file_name || '').match(/\.[a-z0-9]+$/i) || [''])[0] || '';
      const key = 'design-files/' + encodeURIComponent(String(row.design_id)) + ext;
      try {
        const obj = await getObject(key);
        if (obj && obj.body) base64 = Buffer.from(obj.body).toString('base64');
      } catch (e) { /* try the url next */ }
      if (!base64) {
        try {
          const rr = await fetch(String(row.url));
          if (rr.ok) base64 = Buffer.from(await rr.arrayBuffer()).toString('base64');
        } catch (e) { /* fall through to the no-bytes error */ }
      }
    }
    if (!base64) { reply.code(404); return { ok: false, error: 'Machine file row found but its bytes are unreadable.', hasUrl: !!row.url }; }
    const filename = safeName(String(row.file_name || 'design').replace(/\.[^.]+$/, ''), 'design') + '.emb';
    try {
      const res = await ewaCall('api/designTrueview', buildDesignTrueviewXml({ filename, base64 }));
      if (!res.ok) {
        const em = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '');
        reply.code(502);
        return { ok: false, error: em ? em[1].trim() : 'EWA rejected the request', sample: (res.body || '').slice(0, 1200) };
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
