// Per-seller "my uploads" design library — the re-add gallery in Design Maker.
// Stored SERVER-side, never localStorage: each entry is a multi-MB image data URL,
// and 20 of them blew the browser's ~5MB localStorage cap, which then evicted the
// order list (orders silently vanished). The server is the right home for images.
import { q } from '../db.js';
import { createHash } from 'node:crypto';

// SHA-256 of the image BYTES (data-URL prefix stripped) — the fingerprint used to detect
// the same artwork uploaded by different sellers. Returns null if it can't be hashed.
function hashOf(dataUrl) {
  try {
    var s = String(dataUrl || ''); if (!s) return null;
    var b64 = s.indexOf(',') >= 0 ? s.slice(s.indexOf(',') + 1) : s;
    return createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
  } catch (e) { return null; }
}

export function designLibraryRoutes(app, requireAuth, requireStaff) {
  q(`create table if not exists design_library (
       id          serial primary key,
       seller_id   uuid references users(id) on delete cascade,
       name        text,
       data        text,
       thumb       text,
       created_at  timestamptz default now()
     )`).catch(() => {});
  q('alter table design_library add column if not exists thumb text').catch(() => {});
  q('create index if not exists design_library_seller_idx on design_library(seller_id, created_at desc)').catch(() => {});
  // Cross-seller duplicate detection: a content hash per design + a one-time backfill.
  q('alter table design_library add column if not exists content_hash text').catch(() => {});
  q('create index if not exists design_library_hash_idx on design_library(content_hash)').catch(() => {});
  (async () => {
    try {
      const r = await q('select id, data from design_library where content_hash is null and data is not null limit 2000');
      for (const row of r.rows) { const h = hashOf(row.data); if (h) { try { await q('update design_library set content_hash=$1 where id=$2', [h, row.id]); } catch (e) {} } }
    } catch (e) {}
  })();

  const CAP = 30; // keep the N most-recent uploads per seller

  // List this seller's recent uploads — LIGHTWEIGHT: only the small thumbnail, never
  // the full multi-MB data URL (returning 30 full images made Design Maker crawl on
  // load). The full image is fetched on demand from GET /:id when re-added.
  app.get('/api/design_library', { preHandler: requireAuth }, async (req) => {
    const r = await q(
      'select id, name, coalesce(thumb, left(data, 0)) as thumb, created_at from design_library where seller_id=$1 order by created_at desc limit $2',
      [req.user.sub, CAP]
    );
    return r.rows;
  });

  // Cross-seller DUPLICATE detection — FACTORY/STAFF ONLY (sellers never call this). Given
  // a design's content hash, return every seller's design with the SAME bytes, so the
  // factory can spot reused artwork and reuse an already-digitised file instead of redoing
  // it. Returns thumbnails + the seller's store, not the full image.
  app.get('/api/design_library/duplicates/:hash', { preHandler: requireStaff }, async (req) => {
    const h = String(req.params.hash || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) return { hash: h, count: 0, matches: [] };
    const r = await q(
      `select dl.id, dl.name, dl.thumb, dl.created_at, dl.seller_id,
              coalesce(u.store_name, u.name, u.email, '—') as seller
         from design_library dl left join users u on u.id = dl.seller_id
        where dl.content_hash = $1
        order by dl.created_at desc`, [h]);
    return { hash: h, count: r.rows.length, matches: r.rows };
  });

  // Full image data for one upload (fetched only when the seller re-adds it).
  app.get('/api/design_library/:id', { preHandler: requireAuth }, async (req) => {
    const r = await q('select data, content_hash from design_library where id=$1 and seller_id=$2', [req.params.id, req.user.sub]);
    const row = r.rows[0];
    if (row && !row.content_hash && row.data) { const h = hashOf(row.data); if (h) { try { await q('update design_library set content_hash=$1 where id=$2', [h, req.params.id]); } catch (e) {} } }
    return row ? { data: row.data } : { data: null };
  });

  // Save an upload. Dedupe by (seller, name) — matches the client's re-use dedupe —
  // then trim older entries beyond CAP so the library can't grow unbounded.
  app.post('/api/design_library', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    if (!b.data) { reply.code(400); return { error: 'data required' }; }
    const hash = hashOf(b.data);
    // De-dupe on the ARTWORK, not the name — two different images both defaulting to
    // "Untitled design" must not collide (that made every unnamed save overwrite the last).
    // But identity and the dedup key are SEPARATE concerns: re-adding the same image updates
    // the existing row IN PLACE, keeping its id, because DSN-<id> is the reference sellers put
    // on an import sheet. delete+insert would mint a new id and orphan those references.
    if (hash) {
      const ex = await q('select id from design_library where seller_id=$1 and content_hash=$2 order by id limit 1', [req.user.sub, hash]);
      if (ex.rows[0]) {
        const u = await q(
          'update design_library set name=$1, data=$2, thumb=$3 where id=$4 returning id, name, thumb, created_at',
          [b.name || 'Untitled', b.data, b.thumb || null, ex.rows[0].id]
        );
        return u.rows[0];
      }
    }
    const r = await q(
      'insert into design_library (seller_id, name, data, thumb, content_hash) values ($1,$2,$3,$4,$5) returning id, name, thumb, created_at',
      [req.user.sub, b.name || 'Untitled', b.data, b.thumb || null, hash]
    );
    await q(
      `delete from design_library where seller_id=$1 and id not in (
         select id from design_library where seller_id=$1 order by created_at desc limit $2)`,
      [req.user.sub, CAP]
    ).catch(() => {});
    return r.rows[0];
  });

  // Remove one (only the seller's own).
  app.delete('/api/design_library/:id', { preHandler: requireAuth }, async (req) => {
    await q('delete from design_library where id=$1 and seller_id=$2', [req.params.id, req.user.sub]).catch(() => {});
    return { ok: true };
  });
}
