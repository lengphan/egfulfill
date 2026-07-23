// design_images.js — the seller's reusable Images library for the design maker.
//
// Two sources, both HARD-SCOPED to the authenticated seller:
//  • "Your uploads"  — images the seller deliberately uploads and keeps. Stored in object
//                      storage (R2) with a seller_images row. Storage-conscious: only what
//                      they upload is persisted, nothing is hoarded.
//  • "From orders"   — buyer artwork that arrived on THEIR orders (order_items.design_src,
//                      the marketplace-hosted URL). Referenced by URL, never copied — the
//                      gallery just points at what's already on the order. A same-origin
//                      copy is only ever made downstream, when the art is composed onto a
//                      design canvas (a tainted canvas can't export) — not here.

import crypto from 'node:crypto';
import { q } from '../db.js';
import { storageEnabled, putObject, fromDataUrl } from '../storage.js';

// seller_images is created idempotently at route load, like the other late-added tables.
let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists seller_images (
      id text primary key,
      seller_id uuid not null,
      url text not null,
      name text,
      created_at timestamptz not null default now()
    )`)
    .then(() => q(`create index if not exists seller_images_seller on seller_images (seller_id, created_at desc)`))
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

export function designImagesRoutes(app, requireAuth) {
  // ── Your uploads: list ───────────────────────────────────────────────────────
  app.get('/api/design/images', { preHandler: requireAuth }, async (req) => {
    await ensure();
    const r = await q(
      `select id, url, name, created_at from seller_images
        where seller_id=$1 order by created_at desc limit 200`, [req.user.sub]);
    return {
      images: r.rows.map((x) => ({
        id: x.id, url: x.url, name: x.name || '',
        ts: x.created_at ? new Date(x.created_at).getTime() : 0,
      })),
    };
  });

  // ── Your uploads: save (data:image/… → R2, record the row) ───────────────────
  app.post('/api/design/images', { preHandler: requireAuth }, async (req, reply) => {
    await ensure();
    const b = req.body || {};
    const dataUrl = String(b.data || '');
    if (!dataUrl.startsWith('data:image/')) { reply.code(400); return { error: 'Send a data:image/... payload.' }; }
    if (!storageEnabled()) { reply.code(503); return { error: 'Image storage is not configured on the server.' }; }
    try {
      const parsed = fromDataUrl(dataUrl);           // { mime, buffer }
      // Guard the size here too — the body limit is 60MB, but a reusable library image
      // has no business being that big, and we're the ones paying to keep it.
      if (parsed.buffer.length > 8 * 1024 * 1024) { reply.code(413); return { error: 'Image is over 8MB — use a smaller file.' }; }
      const id = 'IMG-' + crypto.randomBytes(8).toString('hex');
      const sub = (parsed.mime && parsed.mime.split('/')[1]) || 'png';
      const ext = '.' + sub.replace('+xml', '').replace(/[^a-z0-9]/gi, '') || '.png';
      const key = `seller-images/${req.user.sub}/${id}${ext}`;
      const url = await putObject(key, parsed.buffer, parsed.mime || 'image/png', 'public-read');
      await q(`insert into seller_images (id, seller_id, url, name) values ($1,$2,$3,$4)`,
        [id, req.user.sub, url, String(b.name || '').slice(0, 120)]);
      return { ok: true, image: { id, url, name: String(b.name || '') } };
    } catch (e) {
      req.log?.warn?.({ err: String(e) }, 'seller image upload failed');
      reply.code(500); return { error: e.message || 'Upload failed' };
    }
  });

  // ── Your uploads: delete (only your own row) ─────────────────────────────────
  app.delete('/api/design/images/:id', { preHandler: requireAuth }, async (req) => {
    await ensure();
    // The object in storage is left in place — cheap, and a shared art_hash could be
    // referenced elsewhere. Removing the row is what takes it out of the library.
    await q(`delete from seller_images where id=$1 and seller_id=$2`, [String(req.params.id), req.user.sub]);
    return { ok: true };
  });

  // ── From orders: buyer artwork across the seller's OWN orders (by URL, no copy) ─
  app.get('/api/design/order-uploads', { preHandler: requireAuth }, async (req) => {
    // design_src is the marketplace-hosted buyer upload (a URL). Only this seller's
    // orders, newest first, deduped by URL. base64-placed art (order_designs.data) is
    // deliberately excluded here — it can be huge and is already reachable from the order.
    const r = await q(
      `select oi.design_src as url, o.seq, o.id as order_id, oi.name
         from order_items oi
         join orders o on o.id = oi.order_id
        where o.seller_id = $1
          and oi.design_src is not null and oi.design_src <> ''
          and oi.design_src like 'http%'
        order by o.created_at desc
        limit 300`, [req.user.sub]);
    const seen = new Set();
    const out = [];
    for (const x of r.rows) {
      if (seen.has(x.url)) continue;
      seen.add(x.url);
      out.push({ url: x.url, orderRef: x.seq ? `#${x.seq}` : x.order_id, name: x.name || '' });
    }
    return { images: out };
  });
}
