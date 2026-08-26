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

import crypto from 'node:crypto';
import { q } from '../db.js';
import { storageEnabled, putObject, getObject, fromDataUrl } from '../storage.js';
import { aiComplete } from './support_ai.js';

const KEY = 'site_content';

// The public base for asset URLs we hand out. Absolute (not a relative /api path) because
// an email logo has to resolve in Gmail, not just same-origin on the homepage. Mirrors
// broadcasts.js publicOrigin().
function assetBase() {
  return (process.env.PUBLIC_API_ORIGIN || 'https://egful.store').replace(/\/+$/, '');
}

/**
 * LEGACY ASSET URLS, REPAIRED ON THE WAY PAST.
 *
 * The hero image used to be stored as the object's RAW address in the storage bucket. The
 * bucket is private — that is deliberate, and the reason /asset below exists — so every
 * visitor got a 400 where the garment should be, and the marketing figure painted its alt
 * text as a paragraph instead. Measured on the live row: the raw URL 400s, the same object
 * through /asset is 200 and 773KB. The bytes were never the problem.
 *
 * The upload route was fixed to hand back the /asset path, but a row saved before that keeps
 * the dead URL for ever — a fix to the writer does nothing for what is already written. So
 * the read repairs it, which needs no migration and reaches every field at once: the hero,
 * the /features and /how-it-works figures, and the email logo, any of which may predate it.
 *
 * SCOPED TO THE TWO STORAGE HOSTS THIS PROJECT HAS USED, not to any URL ending /site/<name>.
 * An admin may legitimately paste an external image address, and rewriting one to point at
 * our own bucket would turn a working picture into a 404 — the exact failure this is here to
 * undo. Matching the host means it can only ever act on an object we put there ourselves.
 */
const LEGACY_ASSET_URL = /^https?:\/\/[^/]*(?:r2\.cloudflarestorage\.com|digitaloceanspaces\.com)\/site\/([A-Za-z0-9._-]+)$/i;
function healAssetUrls(v) {
  if (typeof v === 'string') {
    const m = LEGACY_ASSET_URL.exec(v);
    return m ? `${assetBase()}/api/site-content/asset/${m[1]}` : v;
  }
  if (Array.isArray(v)) return v.map(healAssetUrls);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = healAssetUrls(v[k]);
    return out;
  }
  return v;
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
    return { content: healAssetUrls((r.rows[0] && r.rows[0].value) || {}), updatedAt: r.rows[0] ? r.rows[0].updated_at : null };
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
    // Healed on the way in as well, so a row that is edited stops carrying the dead URL at
    // rest rather than depending on the reader for ever.
    const healed = healAssetUrls(content);
    await q(
      `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [KEY, JSON.stringify(healed)]);
    return { ok: true, content: healed };
  });

  /*
   * ADMIN: WRITE ONE FIELD OF MARKETING COPY.
   *
   * The inline editor made a headline editable where it is read; this makes it WRITABLE
   * there. The round trip it removes is the one nobody admits to: open a chat in another
   * tab, describe the page, paste the answer back, discover it is the wrong length for the
   * space, do it again. The field already knows what it is and what it currently says, so
   * the only thing a person should have to supply is what they want changed.
   *
   * ONE FIELD, ONE STRING BACK. Not the blob — a route that could rewrite the whole of
   * `site_content` in one model call is a route that can blank the homepage on a bad
   * response, and the draft/Save flow in the editor is what makes an edit reviewable. This
   * returns text to a draft; the existing admin PUT is still the only thing that publishes.
   *
   * IT DOES NOT WRITE ANYTHING. Deliberately: the editor holds a draft and the person
   * presses Save, exactly as when they type. A generator that saved its own output would be
   * the one edit on this page nobody reviewed.
   */
  const COPY_KINDS = {
    // label → how the model should treat it. The KIND is what carries the length limit,
    // because "keep it short" in a free-text instruction is advice and this is a constraint:
    // a 90-character headline does not wrap, it overflows the grid column it sits in.
    headline: { words: 'at most 8 words', what: 'a marketing headline' },
    accent: { words: 'at most 4 words', what: 'the accent phrase that completes a headline' },
    subhead: { words: 'one sentence, at most 25 words', what: 'a subheading under a headline' },
    label: { words: 'at most 4 words', what: 'a short caps label' },
    body: { words: 'at most 45 words', what: 'a short paragraph' },
    button: { words: 'at most 4 words', what: 'a button label' },
  };

  app.post('/api/site-content/ai-copy', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    const kind = COPY_KINDS[String(b.kind || '')] ? String(b.kind) : 'body';
    const instruction = String(b.instruction || '').trim();
    const current = String(b.current || '').trim().slice(0, 600);
    if (!instruction) { reply.code(400); return { error: 'Say what you want it to say.' }; }
    if (instruction.length > 600) { reply.code(400); return { error: 'That instruction is too long.' }; }

    const k = COPY_KINDS[kind];
    /*
     * THE SUPPLIER RULE REACHES HERE TOO (CLAUDE.md §2.9). This writes text for the PUBLIC
     * marketing site, which is the most unauthenticated surface we have — so the prompt is
     * told plainly, rather than relying on the model not to volunteer a blank supplier it
     * has no way of knowing is commercially sensitive.
     */
    const system = [
      'You write copy for EGFULFILL, a print-on-demand fulfilment platform.',
      'Sellers connect Etsy, Shopify or TikTok Shop; orders sync into one queue; a factory prints and ships them; tracking is pushed back.',
      '',
      `You are writing ${k.what}. Return ${k.words}.`,
      '',
      'RULES:',
      '- Return ONLY the replacement text. No quotes, no preamble, no options, no explanation.',
      '- Never invent a statistic, a customer name, a price or a guarantee.',
      '- Never name a garment supplier, brand or wholesaler.',
      '- Plain sentence case. No emoji. No trailing full stop on a headline, label or button.',
    ].join('\n');

    const messages = [{
      role: 'user',
      content: (current ? `It currently says: "${current}"\n\n` : '') + `What I want: ${instruction}`,
    }];

    try {
      // maxTokens is small on purpose — the KIND caps the length, and a ceiling here is the
      // backstop that stops a misread instruction returning an essay into a headline slot.
      /*
       * A UNIQUE REF PER CALL, and this is not a detail.
       *
       * costRef becomes the ledger's dedupe key: wallet_ledger has a unique index on
       * (account, type, ref), so a constant ref here would book the FIRST rewrite anyone
       * ever asked for and silently drop every one after it — the cost of the feature would
       * read as a single cent for ever. Retries are new work and new money, so the ref is
       * new each time; there is no automatic retry on this route for it to protect against.
       */
      const ref = 'site-copy-' + crypto.randomBytes(8).toString('hex');
      const out = await aiComplete({ system, messages, maxTokens: 300, costRef: ref, costNote: `Marketing copy · ${kind}` });
      // One line. The model occasionally wraps a headline in quotes however plainly it is
      // told not to, and a stray newline in a jsonb string renders as a literal on the page.
      const text = String(out || '')
        .replace(/\s+/g, ' ')
        .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '')
        .trim();
      if (!text) { reply.code(502); return { error: 'Nothing came back — try again.' }; }
      return { ok: true, text };
    } catch (e) {
      // A REFUSAL CARRIES ITS REASON: aiComplete throws a 503 with the words an admin needs
      // when the key is missing, and that sentence is more useful than "failed".
      reply.code(e?.status || 502);
      return { error: e?.message || 'Could not write that.' };
    }
  });

  // ADMIN: upload a hero banner image to object storage, return its public URL. The panel
  // then stores that URL in content.hero.image via the PUT above — this route only handles
  // the bytes. Kept OUT of the content blob because a base64 image would bloat the row that
  // is served on every homepage view; storage holds the image, the blob holds a URL.
  const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
  const MAX_IMG_BYTES = 8 * 1024 * 1024; // a hero photo, not a video

  /*
   * THE HERO SLOT TAKES A VIDEO TOO — added 2026-08-26, because the hero is the one surface
   * where a moving picture is the point and everything else on these pages is a cut-out.
   *
   * SEPARATE MAP AND SEPARATE CEILING, deliberately. Folding video into IMG_TYPES would have
   * given an mp4 the 8MB image limit and the error text "resize it first", which is advice
   * nobody can act on for a video. The two are different media with different failure modes,
   * so they get different gates and different sentences.
   *
   * 48MB against the app's 60MB body limit. A data URL is base64, so it arrives ~4/3 the size
   * of the file — 48MB of bytes is about 64MB on the wire, which is why the browser sends this
   * straight to api.egful.store rather than through Vercel's ~4.5MB proxy (lib/api.ts routes a
   * large body there on its own). A hero loop is seconds long; anything near this ceiling is a
   * film that wants encoding down, not a bigger limit.
   *
   * NO TRANSCODE HERE. The bytes are stored as uploaded, so what plays is what was handed in —
   * h.264 in an .mp4 is the safe answer and .webm is accepted for anyone who prefers it.
   */
  const VID_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
  const MAX_VID_BYTES = 48 * 1024 * 1024;
  app.post('/api/site-content/hero-image', { preHandler: requireAdmin }, async (req, reply) => {
    if (!storageEnabled()) { reply.code(503); return { error: 'Object storage is not configured on the server.' }; }
    const dataUrl = req.body && req.body.dataUrl;
    if (!dataUrl || typeof dataUrl !== 'string') { reply.code(400); return { error: 'dataUrl required' }; }
    const { mime, buffer } = fromDataUrl(dataUrl);
    // Video is checked FIRST only so the branch reads in the order the sizes do; the two maps
    // are disjoint, so the order cannot change which one matches.
    const isVideo = !!VID_TYPES[mime];
    const ext = isVideo ? VID_TYPES[mime] : IMG_TYPES[mime];
    if (!ext) { reply.code(415); return { error: 'Must be an image (JPEG, PNG, WebP, AVIF, GIF) or a video (MP4, WebM, MOV).' }; }
    const cap = isVideo ? MAX_VID_BYTES : MAX_IMG_BYTES;
    if (buffer.length > cap) {
      reply.code(413);
      return { error: isVideo
        ? 'That video is over 48MB — export it shorter or at a lower bitrate.'
        : 'Image is over 8MB — resize it first.' };
    }
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

      /*
       * ── RANGE REQUESTS, WHICH THE HERO VIDEO NEEDS TO PLAY AT ALL ──────────────────
       *
       * This is not an optimisation. Safari opens a <video> by asking for `bytes=0-1` and
       * requires a 206 back; served a plain 200 with the whole body it decides the resource
       * is not seekable and refuses to play — silently, with no console error, which is the
       * worst version of this bug because the markup looks correct. Chrome and Firefox are
       * more forgiving, so a video that "works on my machine" and is dead on every iPhone is
       * exactly the shape this produces. Announced with Accept-Ranges on every asset.
       *
       * The slice is cheap because getObject already buffers the whole object — it is one
       * subarray, not a second fetch. That buffering is also the ceiling on this route: a
       * 48MB video is 48MB of process memory per concurrent cold request, which is fine for
       * a hero everyone's browser caches immutably and would not be fine for a library. If
       * this route ever serves many videos, stream the storage GET instead of buffering it.
       */
      const total = obj.body.length;
      reply.header('Accept-Ranges', 'bytes');
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
      if (m && (m[1] !== '' || m[2] !== '')) {
        let start, end;
        if (m[1] === '') {
          // A SUFFIX RANGE ("bytes=-500") means the LAST n bytes, not "from 0 to 500". Read
          // the wrong way it serves the head of the file where the tail was asked for, and
          // the player shows a frozen first frame rather than an error.
          start = Math.max(0, total - Number(m[2]));
          end = total - 1;
        } else {
          start = Number(m[1]);
          end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
        }
        if (!Number.isFinite(start) || start >= total || start > end) {
          reply.code(416);
          reply.header('Content-Range', `bytes */${total}`);
          return reply.send();
        }
        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
        reply.header('Content-Length', String(end - start + 1));
        return reply.send(obj.body.subarray(start, end + 1));
      }
      reply.header('Content-Length', String(total));
      return reply.send(obj.body);
    } catch {
      reply.code(502); return { error: 'asset unavailable' };
    }
  });
}
