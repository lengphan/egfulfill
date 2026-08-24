// branding.js — the marks and names an admin can change without a deploy.
//
// Scope is deliberate: FAVICON, LOGO, APP NAME and THE ACCENT. Still not the palette.
// --primary inks ~247 pieces of TEXT as well as filling buttons (see CLAUDE.md §4), the
// status colours carry meaning on the floor, and contrast here is measured rather than
// eyeballed — so a free colour picker in an admin panel is a way to make a quarter of the
// app unreadable in four seconds, with nobody noticing until a seller cannot read their own
// order status.
//
// THE ACCENT IS THE VETTED-PRESET VERSION THIS FILE PROMISED. What is stored is a KEY, never
// a colour: the values live in web/app/globals.css and every one of them has been through
// tools/check-pop-presets.mjs, which measures ink contrast on the fill and OKLab distance to
// every reserved status colour, in BOTH themes. A stored hex would put the next preset in a
// text field, which is the free picker by another name. ACCENTS below is the whole surface —
// anything else is rejected, so the worst an admin can do is pick the other one.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { q } from '../db.js';
import { putObject, getObject, storageEnabled } from '../storage.js';

const KEY = 'branding';

/**
 * The accents that have passed the gate. Deliberately short, and short for a REASON rather
 * than for lack of effort: an accent must be a light enough FILL to carry dark text, and
 * that is exactly the lightness band dark mode packs every status colour into. A full sweep
 * of the hue circle leaves two homes — rose and lime. Coral, which this started as, is the
 * single worst hue on the circle: boxed in by `alert` (25) and `backorder` (50), with no
 * lightness or chroma that clears the floor in dark mode.
 *
 * Adding one means adding it to globals.css AND here, then running the gate. The key is the
 * contract; the colour is not this file's business.
 */
const ACCENTS = ['rose', 'lime'];
const DEFAULT_ACCENT = 'rose';

/**
 * The SKINS — the site's palette, on exactly the terms the accent already runs on.
 *
 * A KEY, never a colour. The values live in web/app/globals.css under [data-skin="…"]; this
 * file's job is only to say which keys exist, so that what can be selected is what has been
 * measured. A stored hex would mean the next palette is typed into a text field with nothing
 * checking it, which is the free colour picker this route has always refused.
 *
 *   studio  ink on white, lime and lilac as GROUNDS — the only skin
 *
 * `press` (electric violet over warm beige) was REMOVED 2026-08-24 with its CSS, at the
 * owner's instruction. It stays out of this list deliberately: a key here whose
 * [data-skin] block no longer exists is selectable in Settings and then silently renders the
 * default, which is a picker that lies about what it did.
 *
 * A skin CANNOT reach --primary (it inks ~247 pieces of text as well as filling buttons),
 * the floor's status vocabulary, or --pop. Adding one means adding it to globals.css AND
 * here, then running `node tools/check-skins.mjs`.
 */
const SKINS = ['studio'];
const DEFAULT_SKIN = 'studio';

/**
 * THE DISPLAY FACE — on exactly the terms the skin and the accent already run on.
 *
 * A KEY, never a font name or a URL. The faces are loaded by `next/font` in the app's root
 * layout, which is what gives them a preload, a self-hosted file and correct fallback metrics;
 * a stored family name would be a string the browser looks up locally and silently fails to
 * find, and a stored URL would be a font fetched from wherever the field said.
 *
 * SCOPE IS THE MARKETING HEADLINES AND NOTHING ELSE. Body copy stays Inter on every surface,
 * and so does the whole signed-in product — Playfair was dropped in the first place because
 * two alphabets ran through the app and mobile, so a seller met different letterforms in the
 * place they look first (CLAUDE.md §4). This moves display type on five public pages.
 *
 *   inter    the body sans, set heavier — one face on the whole site, no second webfont
 *   outfit   wide and geometric, the reference boards' family of shape
 *   grotesk  Space Grotesk — narrower, more technical
 *
 * Adding one means adding it to app/layout.tsx (the next/font call), globals.css (the one
 * selector), AND here. There is no gate to run: a typeface has no contrast to measure, which
 * is exactly why it can be a free-ish choice where a colour cannot.
 */
const FACES = ['inter', 'outfit', 'grotesk'];
const DEFAULT_FACE = 'outfit';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FAVICON = path.join(HERE, '..', 'assets', 'default-favicon.png');

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/x-icon': 'ico', 'image/svg+xml': 'svg' };

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  // settings is created by support_ai's ensureSettings too; create-if-not-exists makes the
  // duplication harmless and means branding does not depend on that module having loaded.
  _ready = q(`create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())`)
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

async function read() {
  try {
    await ensure();
    const r = await q(`select value from settings where key=$1`, [KEY]);
    const v = r.rows[0]?.value;
    const o = (typeof v === 'string' ? JSON.parse(v) : v) || {};
    return {
      appName: typeof o.appName === 'string' ? o.appName : '',
      logoUrl: typeof o.logoUrl === 'string' ? o.logoUrl : '',
      faviconUrl: typeof o.faviconUrl === 'string' ? o.faviconUrl : '',
      faviconKey: typeof o.faviconKey === 'string' ? o.faviconKey : '',
      // An unknown key — a preset removed after being chosen, a hand-edited row — falls back
      // rather than being passed through. The client sets data-pop from this, and an
      // attribute matching no rule leaves the app on whatever :root says, which is the same
      // colour by a longer route; returning the default makes the panel agree with the page.
      accent: ACCENTS.includes(o.accent) ? o.accent : DEFAULT_ACCENT,
      skin: SKINS.includes(o.skin) ? o.skin : DEFAULT_SKIN,
      face: FACES.includes(o.face) ? o.face : DEFAULT_FACE,
    };
  } catch {
    // A settings read that FAILS is not the same as branding that was never set — but for
    // reading marks, defaults are the right answer either way. The admin PUT is where a
    // database problem must surface.
    return { appName: '', logoUrl: '', faviconUrl: '', faviconKey: '', accent: DEFAULT_ACCENT, skin: DEFAULT_SKIN, face: DEFAULT_FACE };
  }
}

export function brandingRoutes(app, requireAuth, requireAdmin) {
  /**
   * THE FAVICON, always. This URL is what the app's <link rel="icon"> points at, so it can
   * never 404 — a 404 here is a browser with no icon at all, which is worse than the
   * default one. Uploaded mark if there is one, bundled default otherwise.
   */
  app.get('/api/branding/favicon', async (req, reply) => {
    const b = await read();
    if (b.faviconKey && storageEnabled()) {
      try {
        const obj = await getObject(b.faviconKey);
        if (obj?.body?.length) {
          reply.header('Content-Type', obj.contentType || 'image/png');
          // Short cache: an admin who changes the mark expects to see it, not to be told
          // about cache headers. Long enough to spare the round trip on every page.
          reply.header('Cache-Control', 'public, max-age=300');
          return reply.send(obj.body);
        }
      } catch { /* fall through to the default rather than serving nothing */ }
    }
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(fs.readFileSync(DEFAULT_FAVICON));
  });

  /** What the marks are. Any signed-in surface renders them, so this is auth, not admin. */
  /*
   * PUBLIC: THE TWO PRESENTATION KEYS, AND NOTHING ELSE.
   *
   * This exists because the marketing pages could not see the theme at all. They are Server
   * Components rendered for visitors with no session, so `GET /api/branding` above — which is
   * requireAuth, correctly, since it carries the app name and the logo — was unreachable from
   * them. The result was a picker in Settings that repainted the signed-in app and left the
   * public site on whatever `:root` happened to declare. A skin nobody outside the company
   * could see is not a theme, it is a preference.
   *
   * WHY IT IS SAFE TO PUBLISH: both values are allow-listed KEYS, and both are already
   * legible in the CSS and the font files any visitor downloads. Nothing else from the
   * branding blob is here — an ALLOW-LIST rather than a redaction, for the same reason the
   * public catalogue is (CLAUDE.md §2.9): a redaction starts publishing whatever gets added
   * to the blob upstream.
   *
   * Read server-side with a 60-second revalidate, so it costs one request per page per
   * minute and never a client fetch — which is what avoids the flash of the default palette
   * that a useEffect-based version would produce on every cold marketing load.
   */
  app.get('/api/branding/theme', async () => {
    const b = await read();
    return { skin: b.skin, face: b.face };
  });

  app.get('/api/branding', { preHandler: requireAuth }, async () => {
    const b = await read();
    return { appName: b.appName, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl, accent: b.accent, accents: ACCENTS, skin: b.skin, skins: SKINS, face: b.face, faces: FACES };
  });

  app.put('/api/admin/branding', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body || {};
    const cur = await read();
    const next = {
      ...cur,
      ...(typeof body.appName === 'string' ? { appName: body.appName.slice(0, 60) } : {}),
      ...(typeof body.logoUrl === 'string' ? { logoUrl: body.logoUrl.slice(0, 500) } : {}),
      // ALLOW-LIST, not a sanitiser. Nothing outside ACCENTS is stored, so the set of
      // colours the app can wear is the set that has been measured.
      ...(ACCENTS.includes(body.accent) ? { accent: body.accent } : {}),
      // Allow-listed, like the accent. An unknown key is DROPPED rather than stored — a row
      // holding a skin no stylesheet declares renders as whatever :root says while the panel
      // shows it as selected, which is a setting that lies about itself.
      ...(SKINS.includes(body.skin) ? { skin: body.skin } : {}),
      ...(FACES.includes(body.face) ? { face: body.face } : {}),
    };
    try {
      await ensure();
      await q(
        `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [KEY, JSON.stringify(next)]);
    } catch (e) {
      reply.code(502);
      return { error: 'Could not save: ' + ((e && e.message) || 'database error') };
    }
    return { ok: true, appName: next.appName, logoUrl: next.logoUrl, faviconUrl: next.faviconUrl, accent: next.accent, accents: ACCENTS, skin: next.skin, skins: SKINS, face: next.face, faces: FACES };
  });

  /** Upload a mark. Stored PRIVATE and re-served through our own origin, like chat art. */
  app.post('/api/admin/branding/upload', { preHandler: requireAdmin }, async (req, reply) => {
    if (!storageEnabled()) { reply.code(503); return { error: 'File storage is not configured, so an uploaded mark could not be kept.' }; }
    const b = req.body || {};
    const kind = b.kind === 'logo' ? 'logo' : 'favicon';
    if (typeof b.dataUrl !== 'string' || !b.dataUrl.startsWith('data:')) { reply.code(400); return { error: 'dataUrl required' }; }
    const m = /^data:([^;,]+)[^,]*,(.*)$/s.exec(b.dataUrl);
    if (!m) { reply.code(400); return { error: 'Could not read that file.' }; }
    const mime = m[1];
    const ext = MIME_EXT[mime];
    if (!ext) { reply.code(415); return { error: `That file type isn't supported (${mime}). Use PNG, JPEG, WebP, SVG or ICO.` }; }
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) { reply.code(400); return { error: 'That file is empty.' }; }
    if (buf.length > 2 * 1024 * 1024) { reply.code(413); return { error: 'That file is over 2MB — a mark should be far smaller.' }; }

    const key = `branding/${kind}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    try { await putObject(key, buf, mime, 'private'); }
    catch (e) { reply.code(502); return { error: 'Upload failed: ' + ((e && e.message) || 'storage error') }; }

    const base = (process.env.PUBLIC_API_ORIGIN || 'https://egful.store').replace(/\/+$/, '');
    const cur = await read();
    const next = kind === 'favicon'
      // The favicon is served through one stable URL so the <link> never has to change;
      // only the bytes behind it do.
      ? { ...cur, faviconKey: key, faviconUrl: `${base}/api/branding/favicon` }
      : { ...cur, logoUrl: `${base}/api/branding/asset/${encodeURIComponent(key.split('/').pop())}` };
    await ensure();
    await q(
      `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [KEY, JSON.stringify(next)]);
    return { ok: true, kind, url: kind === 'favicon' ? next.faviconUrl : next.logoUrl, bytes: buf.length };
  });

  /** Serve a stored mark. Bare-name check, so it can only ever read under branding/. */
  app.get('/api/branding/asset/:name', async (req, reply) => {
    const name = String(req.params.name || '');
    if (!/^[A-Za-z0-9._-]+$/.test(name)) { reply.code(400); return { error: 'bad name' }; }
    if (!storageEnabled()) { reply.code(503); return { error: 'storage not configured' }; }
    try {
      const obj = await getObject(`branding/${name}`);
      if (!obj) { reply.code(404); return { error: 'not found' }; }
      reply.header('Content-Type', obj.contentType || 'application/octet-stream');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(obj.body);
    } catch { reply.code(502); return { error: 'unavailable' }; }
  });
}
