// branding.js — the marks and names an admin can change without a deploy.
//
// Scope is deliberate: FAVICON, LOGO and APP NAME. Not the palette. --primary inks ~247
// pieces of TEXT as well as filling buttons (see CLAUDE.md §4), the status colours carry
// meaning on the floor, and contrast here is measured rather than eyeballed — so a free
// colour picker in an admin panel is a way to make a quarter of the app unreadable in four
// seconds, with nobody noticing until a seller cannot read their own order status. Colours
// come later as vetted presets with a contrast gate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { q } from '../db.js';
import { putObject, getObject, storageEnabled } from '../storage.js';

const KEY = 'branding';
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
    };
  } catch {
    // A settings read that FAILS is not the same as branding that was never set — but for
    // reading marks, defaults are the right answer either way. The admin PUT is where a
    // database problem must surface.
    return { appName: '', logoUrl: '', faviconUrl: '', faviconKey: '' };
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
  app.get('/api/branding', { preHandler: requireAuth }, async () => {
    const b = await read();
    return { appName: b.appName, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl };
  });

  app.put('/api/admin/branding', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body || {};
    const cur = await read();
    const next = {
      ...cur,
      ...(typeof body.appName === 'string' ? { appName: body.appName.slice(0, 60) } : {}),
      ...(typeof body.logoUrl === 'string' ? { logoUrl: body.logoUrl.slice(0, 500) } : {}),
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
    return { ok: true, appName: next.appName, logoUrl: next.logoUrl, faviconUrl: next.faviconUrl };
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
