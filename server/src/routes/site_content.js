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
import { storageEnabled, putObject, fromDataUrl } from '../storage.js';

const KEY = 'site_content';

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
    const key = `site/hero-${Date.now()}.${ext}`;
    try {
      const url = await putObject(key, buffer, mime, 'public-read');
      return { url };
    } catch (e) {
      reply.code(502); return { error: 'Upload failed: ' + (e && e.message ? e.message : 'storage error') };
    }
  });
}
