// site_content.js — the editable copy of the public marketing home.
//
// One jsonb blob in `settings` under the key `site_content`, admin-edited from Settings ›
// Site content. GET is PUBLIC: the marketing homepage (a Vercel Server Component) reads it
// unauthenticated, which is correct — this IS the public homepage copy, nothing private.
// The write is admin-only.
//
// The server does NOT hold the default copy. It stores and returns whatever was saved (or
// {} if never saved); the DEFAULTS live in web/lib/site-content.ts and the page merges the
// stored blob over them. Keeping one source of defaults avoids the two-copies-drift trap —
// the server would otherwise need its own duplicate of every marketing string.

import { q } from '../db.js';
import { storageEnabled, putObject, getObject, fromDataUrl } from '../storage.js';

const KEY = 'site_content';

// The public base for asset URLs we hand out. Absolute (not a relative /api path) because
// an email logo has to resolve in Gmail, not just same-origin on the homepage. Mirrors
// broadcasts.js publicOrigin().
function assetBase() {
  return (process.env.PUBLIC_API_ORIGIN || 'https://egful.store').replace(/\/+$/, '');
}

let _ready = null;
function ensureTable() {
  if (_ready) return _ready;
  _ready = q('create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())').catch(() => {});
  return _ready;
}

// Guard against an unbounded blob being persisted and then served on every homepage view.
// The real content is a few KB; anything past this is a mistake or an attack, not copy.
const MAX_BYTES = 64 * 1024;

export function siteContentRoutes(app, requireAdmin) {
  ensureTable();

  // PUBLIC read. No preHandler — the homepage fetches this with no session.
  app.get('/api/site-content', async () => {
    await ensureTable();
    const r = await q('select value, updated_at from settings where key = $1', [KEY]);
    // `content: {}` when unset — the page merges over its defaults, so {} renders the
    // baked-in copy rather than an empty homepage.
    return { content: (r.rows[0] && r.rows[0].value) || {}, updatedAt: r.rows[0] ? r.rows[0].updated_at : null };
  });

  // ADMIN write. Marketing copy is public-facing brand surface; editing it is not an
  // operator's job, and there is no per-field audit worth gating below admin.
  app.put('/api/site-content', { preHandler: requireAdmin }, async (req, reply) => {
    await ensureTable();
    const content = req.body && typeof req.body === 'object' ? req.body.content : undefined;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      reply.code(400); return { error: 'content must be an object' };
    }
    if (JSON.stringify(content).length > MAX_BYTES) {
      reply.code(413); return { error: 'content too large' };
    }
    await q(
      `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [KEY, JSON.stringify(content)]);
    return { ok: true, content };
  });

  // ADMIN: upload a hero banner image to object storage, return its public URL. The panel
  // then stores that URL in content.hero.image via the PUT above — this route only handles
  // the bytes. Kept OUT of the content blob because a base64 image would bloat the row that
  // is served on every homepage view; storage holds the image, the blob holds a URL.
  const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
  const MAX_IMG_BYTES = 8 * 1024 * 1024; // a hero photo, not a video
  app.post('/api/site-content/hero-image', { preHandler: requireAdmin }, async (req, reply) => {
    if (!storageEnabled()) { reply.code(503); return { error: 'Object storage is not configured on the server.' }; }
    const dataUrl = req.body && req.body.dataUrl;
    if (!dataUrl || typeof dataUrl !== 'string') { reply.code(400); return { error: 'dataUrl required' }; }
    const { mime, buffer } = fromDataUrl(dataUrl);
    const ext = IMG_TYPES[mime];
    if (!ext) { reply.code(415); return { error: 'Image must be JPEG, PNG, WebP, AVIF or GIF.' }; }
    if (buffer.length > MAX_IMG_BYTES) { reply.code(413); return { error: 'Image is over 8MB — resize it first.' }; }
    // A timestamped key so a re-upload never collides with or overwrites the previous one,
    // and cached CDN copies of the old URL don't serve stale bytes.
    const name = `hero-${Date.now()}.${ext}`;
    try {
      // PRIVATE, not public-read: the image is served back through /asset below (a signed
      // server-side GET), so it never depends on the storage bucket being publicly readable
      // — which R2 isn't, and a missing/misconfigured SPACES_CDN made the old public URL
      // unreachable (the broken-image bug on both the hero banner and the email logo).
      // 'private' also drops the x-amz-acl header that R2 rejects on PUT. The URL we hand
      // back is ABSOLUTE so it also resolves inside an email client.
      await putObject(`site/${name}`, buffer, mime, 'private');
      return { url: `${assetBase()}/api/site-content/asset/${name}` };
    } catch (e) {
      reply.code(502); return { error: 'Upload failed: ' + (e && e.message ? e.message : 'storage error') };
    }
  });

  // PUBLIC serve for the site assets uploaded above (hero banners, the email logo). Streams
  // the bytes through our own origin so an <img>/background loads whether or not the bucket
  // is public, and an email logo resolves in Gmail. Scoped HARD to the `site/` prefix via a
  // bare-filename check (no slashes, no traversal) so it can never read a private
  // design/print object.
  app.get('/api/site-content/asset/:name', async (req, reply) => {
    const name = String(req.params.name || '');
    if (!/^[A-Za-z0-9._-]+$/.test(name)) { reply.code(400); return { error: 'bad asset name' }; }
    if (!storageEnabled()) { reply.code(503); return { error: 'storage not configured' }; }
    try {
      const obj = await getObject(`site/${name}`);
      if (!obj) { reply.code(404); return { error: 'not found' }; }
      reply.header('Content-Type', obj.contentType || 'application/octet-stream');
      // Keys are timestamped and never overwritten, so cache hard — this keeps repeat views
      // off the storage backend entirely after the first fetch.
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(obj.body);
    } catch {
      reply.code(502); return { error: 'asset unavailable' };
    }
  });
}
