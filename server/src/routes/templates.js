// Design templates — stored SERVER-side so the heavy composite images don't fill
// the browser's ~5MB localStorage (which was throwing "browser storage is full"
// on save). Mirrors the order_designs pattern: localStorage is just a cache; the
// server is the source of truth. Templates are a shared library (like the catalog).
import crypto from 'node:crypto';
import { q } from '../db.js';
import { storageEnabled, putObject, getObject, fromDataUrl } from '../storage.js';

/**
 * THE IMAGES GO TO OBJECT STORAGE. THEY USED TO GO INTO POSTGRES.
 *
 * `composite` was a base64 data URL in a text column and `layers` held the artwork in jsonb,
 * so every template put its full-resolution pictures in the database — and into every nightly
 * backup with them. A 4000×5000 PNG is 10–25MB before base64 adds a third, and the Design Lab
 * is about to hold several per template rather than one.
 *
 * order_designs and design_files both solved this already: bytes to the bucket, a KEY in the
 * row, and the bytes re-served same-origin through this API (the bucket is private, and the
 * CDN alias has never resolved — see designUrlOf in orders.js for that whole story). This is
 * the same three moves on the third table.
 *
 * CONTENT-ADDRESSED. The object key IS the sha256 of the bytes, so the serve route rebuilds
 * the key from the URL with no lookup table, and the same picture used on ten layers or in
 * fifty templates is stored ONCE. On a design tool where people duplicate a layer and nudge
 * it, that dedupe is most of the saving on its own.
 */
const ART_PREFIX = 'template-art/';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' };

const isDataUrl = (v) => typeof v === 'string' && /^data:image\//i.test(v);

/**
 * One data URL → the bucket, returning our own address for it.
 *
 * Returns the ORIGINAL string on any failure, which is the important half: storage being
 * off, or a bucket hiccup, must degrade to the old inline behaviour rather than lose a
 * design somebody just spent an hour on.
 */
async function offload(value, seen) {
  if (!isDataUrl(value) || !storageEnabled()) return value;
  try {
    const { mime, buffer } = fromDataUrl(value);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = EXT[String(mime).toLowerCase()] || 'png';
    const key = ART_PREFIX + hash + '.' + ext;
    const url = '/api/templates/art/' + hash + '.' + ext;
    // ONE UPLOAD PER PICTURE PER SAVE. Content-addressing already means ten layers of the
    // same image occupy one object — but without this it was PUT ten times to write the
    // identical bytes to the identical key, which is ten round trips and, on a 20MB
    // artwork, 200MB across the wire for one save.
    if (seen && seen.has(key)) return url;
    await putObject(key, buffer, mime);
    if (seen) seen.add(key);
    return url;
  } catch {
    return value;
  }
}

/**
 * Walk a layer snapshot and offload every data URL in it, whatever it is called.
 *
 * The Design Lab's layer shape is the client's to define and it has changed before, so this
 * matches on the VALUE (a data:image/ URL) rather than on a list of field names — a renamed
 * key would silently start writing megabytes back into Postgres, and nothing would say so.
 * Depth is capped because this walks caller-supplied JSON.
 */
async function offloadDeep(node, seen, depth = 0) {
  if (depth > 6) return node;
  if (isDataUrl(node)) return await offload(node, seen);
  if (Array.isArray(node)) {
    const out = [];
    for (const v of node) out.push(await offloadDeep(v, seen, depth + 1));
    return out;
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = await offloadDeep(v, seen, depth + 1);
    return out;
  }
  return node;
}

/**
 * A CEILING ON LAYERS, enforced where it cannot be argued with.
 *
 * Ten is generous for a garment print and it is the point past which the editor stops being
 * legible anyway. The real reason it is here rather than only in the browser: this endpoint
 * accepts whatever is posted, and "the client limits it" is not a limit.
 */
const MAX_LAYERS = 10;

export function templatesRoutes(app, requireAuth) {
  q(`create table if not exists templates (
       id text primary key,
       owner_id uuid,
       name text,
       data jsonb,          -- the card metadata (cat, price, tech, productImg, designOnlyImg, …)
       composite text,      -- composite preview: a /api/templates/art/<hash> path (older rows: base64)
       layers jsonb,        -- editable layer snapshot for re-opening in Design Maker
       updated_at timestamptz default now())`).catch(() => {});
  // A SHORT, HUMAN NUMBER. The primary key is a client-minted
  // `TPL-<base36 timestamp><random>` — unique and unguessable, and unusable as something a
  // person reads off a card and types into a spreadsheet ("TPL-ms04ehic3elu"). bigserial
  // backfills existing rows in creation order, so templates saved before this get numbers
  // too. The text id stays the key: it is what the URL and the delete route address, and
  // renaming a primary key to make a label prettier is not worth the blast radius.
  q('alter table templates add column if not exists seq bigserial').catch(() => {});

  // Save / update a template (upsert by id).
  app.post('/api/templates', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    if (!b.id) return { error: 'template id required' };
    const layersIn = Array.isArray(b.layers) ? b.layers : [];
    if (layersIn.length > MAX_LAYERS) {
      reply.code(400);
      return { error: `A template can hold ${MAX_LAYERS} layers — this one has ${layersIn.length}. Flatten or remove some and save again.` };
    }
    // Every picture out of the row and into the bucket before it is written. Awaited, not
    // fire-and-forget: a template whose composite is a link to an object that failed to
    // upload is a card that renders as a broken image forever.
    // Shared across all three, so a composite that is simply the flattened front — the
    // common case — is uploaded once and the layer using it reuses the key.
    const seen = new Set();
    const composite = await offload(b.composite || null, seen);
    const layers = await offloadDeep(layersIn, seen);
    const data = await offloadDeep(b.data || {}, seen);
    await q(
      `insert into templates (id, owner_id, name, data, composite, layers, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (id) do update set
         name=excluded.name, data=excluded.data, composite=excluded.composite,
         layers=excluded.layers, updated_at=now()`,
      [String(b.id), req.user.sub, b.name || null, data, composite, JSON.stringify(layers)]
    );
    return { ok: true, id: b.id, layers: layers.length };
  });

  /**
   * The bytes, same-origin.
   *
   * UNAUTHENTICATED BY DESIGN, identically to /api/order_designs/art/:hash and
   * /api/design_cards/art — an <img> cannot carry a Bearer header, and the path is the
   * artwork's sha256, which is unguessable. Knowing the hash means already having the bytes.
   */
  app.get('/api/templates/art/:hash', async (req, reply) => {
    const raw = String(req.params.hash || '');
    const hash = raw.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) { reply.code(404); return { error: 'not found' }; }
    const ext = (raw.match(/\.([a-z0-9]+)$/i) || [null, 'png'])[1].toLowerCase();
    const obj = await getObject(ART_PREFIX + hash + '.' + ext).catch(() => null);
    if (!obj || !obj.body) { reply.code(404); return { error: 'not found' }; }
    // Content-addressed, so the bytes at this URL can never change — cache them hard.
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Content-Type', obj.contentType || MIME[ext] || 'application/octet-stream');
    return reply.send(obj.body);
  });

  // List templates (newest first). Includes composite so the cards render; the set
  // is small (capped) so the payload stays reasonable.
  // Templates are per-user product setups — each user (seller or staff) sees & deletes ONLY their
  // own. Prevents one seller reading or deleting another seller's templates.
  app.get('/api/templates', { preHandler: requireAuth }, async (req) => {
    // owner_id, not seller_id — the insert above writes owner_id and no seller_id column
    // has ever existed, so this query threw "column seller_id does not exist" on every
    // call. Nothing read templates back (the only caller POSTs), so it went unseen.
    //
    // Rows are returned as stored: newer ones carry /api/templates/art/<hash> paths, older
    // ones still hold inline base64. Both render in an <img> with no client change, which is
    // what makes this migration invisible rather than a cutover.
    const r = await q(`select id, seq, name, data, composite, layers from templates where owner_id=$1 order by updated_at desc limit 200`, [req.user.sub]);
    return r.rows;
  });

  app.delete('/api/templates/:id', { preHandler: requireAuth }, async (req) => {
    // The OBJECTS are deliberately left. They are content-addressed and shared: two templates
    // built from the same picture point at one key, so deleting on behalf of one would blank
    // the other. Orphans are cheap and a wrongly-deleted design is not.
    await q(`delete from templates where id=$1 and owner_id=$2`, [req.params.id, req.user.sub]);
    return { ok: true };
  });
}
