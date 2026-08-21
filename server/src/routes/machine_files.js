/**
 * THE MACHINE-FILE LIBRARY — a seller's stitch files, kept once and referenced by id.
 *
 * WHY THIS IS A NEW TABLE RATHER THAN A FLAG ON design_file_data.
 *
 * `design_file_data` is ORDER-SCOPED and always has been: its primary key is a
 * caller-supplied `design_id`, its object key is literally `design-files/<design_id><ext>`,
 * and `GET /api/design_files` refuses a request without an `orderId`. That shape is correct
 * for "the file attached to this line" and it cannot express "a file the seller owns", which
 * is what a library is. Bolting a nullable order_id onto it would have made the primary key
 * do two jobs — and a caller-supplied primary key that two features write is how one upload
 * silently overwrites another, in Postgres AND in the bucket.
 *
 * So: this table owns the BYTES, exactly once. `design_file_data` keeps owning ATTACHMENT,
 * and an attach copies a REFERENCE (the same `storage_key`), never the bytes. A 40-line
 * import that re-posted an 8MB .EMB per line would be 320MB across the wire against a 60MB
 * body limit; it is now one row per line pointing at one object.
 *
 * THAT LAST SENTENCE HOLDS ONLY WHILE OBJECT STORAGE IS ON, which is worth saying rather
 * than leaving to be discovered. With storage off, an upload falls back to keeping the file
 * inline in `data` — and an attach then has no key to point at, so it copies the inline
 * bytes per line. Forty lines would be forty copies in Postgres. Production has storage on
 * (R2), so this is the degraded path and not the normal one; the alternative is losing the
 * upload outright when the bucket hiccups, which is worse. Found by running it against a
 * real database with storage off, which is the only reason this note exists.
 *
 * THE ID PEOPLE TYPE is `MF-<seq>`, mirroring `TPL-<seq>` and `IMG-<id>`. A base36 key is
 * unique and unreadable, and nobody copies one off a card into a spreadsheet by eye.
 *
 * WHAT THIS ROUTE REFUSES, and why each refusal is here rather than in the client:
 *
 *   · a link instead of a file      — fromDataUrl() base64-DECODES a non-data: string, so a
 *                                     URL becomes a few dozen bytes of decoded text WHERE A
 *                                     DELIVERABLE SHOULD BE. design_files learned this the
 *                                     hard way; same refusal, same words.
 *   · a stitch file on a line that  — a .EMB on a DTG line is not a near-miss, it is a fee
 *     is not embroidered              raised for a file nothing can run (CLAUDE.md §4). The
 *                                     canvas enforces it at the drop; a SHEET has no human
 *                                     at the drop, so the gate has to be server-side.
 *   · another seller's id           — answered as "no such file", never 403. Two different
 *                                     answers to "does MF-91 exist" is how a seller learns
 *                                     that it does, and whose it is.
 */
import crypto from 'node:crypto';
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { storageEnabled, putObject, getObject, deleteObject, fromDataUrl } from '../storage.js';
import { audit } from '../audit.js';

/** Extensions we accept. `.emb` is what actually arrives; the rest are what a seller's
 *  digitiser might hand them instead, and refusing those would be refusing the same file
 *  under a different machine's name. */
const MACHINE_RE = /\.(emb|pes|dst|exp|jef|vp3|xxx|hus|sew|pcs|vip|10o|u01)$/i;
const MAX_BYTES = 50 * 1024 * 1024;   // the body limit is 60MB and base64 inflates by ~a third

export function machineFilesRoutes(app, requireAuth) {
  const ready = q(`create table if not exists machine_library (
       id           text primary key,
       seller_id    uuid references users(id) on delete cascade,
       name         text,
       file_name    text,
       mime         text,
       bytes        integer,
       storage_key  text,
       data         text,
       content_hash text,
       kind         text default 'emb',
       created_at   timestamptz default now(),
       updated_at   timestamptz default now()
     )`)
    // `seq` is the readable half of the id and it is a SEPARATE column from the key, for the
    // same reason templates.seq is: the key has to be stable and unique, and the thing a
    // person types has to be short. Chained rather than fired in parallel — two bare q()
    // calls can take different pool connections and run out of order, and the swallowed
    // error leaves the column silently missing.
    .then(() => q('alter table machine_library add column if not exists seq bigserial'))
    .then(() => q('create index if not exists machine_library_seller_idx on machine_library(seller_id, created_at desc)'))
    // Per-seller dedupe: the same bytes uploaded twice is ONE library entry. Not unique
    // across sellers — two sellers may legitimately hold the same file, and collapsing
    // those would make one seller's row disappear when another deleted theirs.
    .then(() => q('create index if not exists machine_library_hash_idx on machine_library(seller_id, content_hash)'))
    .catch(() => {});

  /** The owner a request acts as — a team member acts as the owner; a plain seller is
   *  themselves; staff have no seller of their own. Same resolution design_files uses. */
  async function effectiveSeller(user) {
    if (!user || isStaff(user)) return null;
    try {
      const r = await q("select owner_id from team_members where lower(email)=lower($1) and status='active' limit 1", [user.email || '']);
      if (r.rows[0] && r.rows[0].owner_id) return r.rows[0].owner_id;
    } catch { /* fall through to themselves */ }
    return user.sub;
  }

  /** The row a caller is ALLOWED to see, by internal key or by `MF-<seq>` / bare seq.
   *  Returns null for "not yours" exactly as it does for "not there" — see the header. */
  async function findFor(user, ref) {
    const raw = String(ref ?? '').trim();
    if (!raw) return null;
    const seller = await effectiveSeller(user);
    const seq = /^(?:mf-)?(\d+)$/i.test(raw) ? Number(raw.replace(/^mf-/i, '')) : null;
    const r = await q(
      `select * from machine_library
        where ($1::uuid is null or seller_id = $1)
          and (id = $2 or ($3::bigint is not null and seq = $3))
        limit 1`,
      [seller, raw, seq]).catch(() => null);
    return r?.rows?.[0] ?? null;
  }

  /** Metadata only. The bytes are never in a list response — thirty 8MB files is 240MB of
   *  JSON for a grid that shows names. */
  const shape = (r) => ({
    id: r.id, ref: r.seq != null ? `MF-${r.seq}` : r.id, seq: r.seq ?? null,
    name: r.name || r.file_name || 'Untitled', fileName: r.file_name || null,
    bytes: r.bytes ?? null, kind: r.kind || 'emb', createdAt: r.created_at,
  });

  // ── The library ────────────────────────────────────────────────────────────────────────
  app.get('/api/machine_files', { preHandler: requireAuth }, async (req) => {
    await ready;
    const seller = await effectiveSeller(req.user);
    const r = await q(
      `select id, seq, name, file_name, bytes, kind, created_at from machine_library
        where ($1::uuid is null or seller_id = $1) order by created_at desc limit 200`,
      [seller]).catch(() => ({ rows: [] }));
    return r.rows.map(shape);
  });

  app.post('/api/machine_files', { preHandler: requireAuth }, async (req, reply) => {
    await ready;
    const b = req.body || {};
    const fileName = String(b.fileName || b.name || '').trim();
    if (!b.data) { reply.code(400); return { error: 'data required' }; }
    if (!MACHINE_RE.test(fileName)) {
      reply.code(400);
      return { error: `${fileName || 'That file'} is not a machine file. This library holds .EMB, .PES, .DST and the other stitch formats — artwork goes in Images.` };
    }
    // BYTES ONLY. See the header: a link handed to fromDataUrl() decodes to its own text and
    // replaces the deliverable with it.
    if (!/^data:/i.test(String(b.data))) {
      reply.code(400);
      return { error: 'Send the file itself, not a link to it — a link would be stored as its own text instead of the file.' };
    }
    let parsed;
    try { parsed = fromDataUrl(String(b.data)); } catch { reply.code(400); return { error: "That file couldn't be read." }; }
    if (parsed.buffer.length > MAX_BYTES) {
      reply.code(413);
      return { error: `${fileName} is ${(parsed.buffer.length / 1024 / 1024).toFixed(1)} MB — 50 MB is the limit.` };
    }
    const seller = await effectiveSeller(req.user);
    if (!seller) { reply.code(400); return { error: 'A machine-file library belongs to a seller account.' }; }
    const hash = crypto.createHash('sha256').update(parsed.buffer).digest('hex');

    // THE SAME BYTES TWICE IS ONE ENTRY. A seller who re-uploads the file they already have
    // should get the id they already have, not a second card that means the same thing —
    // two ids for one file is how a sheet ends up half-referencing each.
    const dupe = await q(
      `select * from machine_library where seller_id=$1 and content_hash=$2 limit 1`,
      [seller, hash]).then((r) => r.rows[0]).catch(() => null);
    if (dupe) return { ...shape(dupe), duplicate: true };

    const id = 'mf-' + crypto.randomBytes(8).toString('hex');
    const ext = (fileName.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    let storageKey = null, data = String(b.data);
    if (storageEnabled()) {
      try {
        // CONTENT-ADDRESSED, like template art: the key is the hash, so the same file held
        // by two sellers occupies one object and an attach can point at it without copying.
        const key = 'machine-files/' + hash + ext;
        await putObject(key, parsed.buffer, parsed.mime || 'application/octet-stream');
        storageKey = key; data = null;
      } catch { /* storage down → keep it inline rather than lose the upload */ }
    }
    await q(
      `insert into machine_library (id, seller_id, name, file_name, mime, bytes, storage_key, data, content_hash, kind)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, seller, String(b.name || fileName).slice(0, 120), fileName, parsed.mime || null,
       parsed.buffer.length, storageKey, data, hash, /\.pes$/i.test(fileName) ? 'pes' : 'emb']);
    const row = await q('select * from machine_library where id=$1', [id]).then((r) => r.rows[0]);
    audit(req, 'machine_file.added', {
      entityType: 'machine_file', entityId: id,
      after: { name: fileName, bytes: parsed.buffer.length, ref: shape(row).ref },
    });
    return shape(row);
  });

  app.patch('/api/machine_files/:id', { preHandler: requireAuth }, async (req, reply) => {
    await ready;
    const row = await findFor(req.user, req.params.id);
    if (!row) { reply.code(404); return { error: 'no such file' }; }
    const name = String((req.body || {}).name || '').trim();
    if (!name) { reply.code(400); return { error: 'name required' }; }
    await q('update machine_library set name=$2, updated_at=now() where id=$1', [row.id, name.slice(0, 120)]);
    return { ok: true, ...shape({ ...row, name }) };
  });

  app.delete('/api/machine_files/:id', { preHandler: requireAuth }, async (req, reply) => {
    await ready;
    const row = await findFor(req.user, req.params.id);
    if (!row) { reply.code(404); return { error: 'no such file' }; }
    /**
     * THE OBJECT IS NOT DELETED WITH THE ROW, and that is deliberate.
     *
     * The key is the content hash and an ATTACHED file on an order points at the same key.
     * Deleting the object because a seller tidied their library would empty the stitch file
     * out of every order it was ever attached to — including shipped ones, whose records
     * must not change silently. The library row is the seller's to remove; the bytes belong
     * to the jobs that reference them.
     *
     * Only when nothing references it does it go.
     */
    const stillUsed = await q(
      `select 1 from design_file_data where storage_key=$1 limit 1`, [row.storage_key])
      .then((r) => r.rowCount > 0).catch(() => true);
    await q('delete from machine_library where id=$1', [row.id]);
    if (row.storage_key && !stillUsed) { try { await deleteObject(row.storage_key); } catch { /* the row is gone either way */ } }
    audit(req, 'machine_file.deleted', {
      entityType: 'machine_file', entityId: row.id,
      before: { name: row.file_name, ref: shape(row).ref },
      // Stated in the record, because "deleted" and "deleted but the jobs still have it"
      // are different facts and only one of them means the bytes are gone.
      note: stillUsed ? 'library row removed; object kept — orders still reference it' : 'library row and object removed',
    });
    return { ok: true };
  });

  /**
   * The bytes back — as JSON carrying a data: URL, NOT as a raw octet-stream response.
   *
   * Every call here is authorised by a Bearer JWT that only `lib/api.ts` attaches, so a raw
   * byte route would be reachable only by fetch-then-blob anyway: an <a href> or a
   * window.open() carries no Authorization header and lands on 401. Returning the shape
   * `downloadDesignFile` already returns means the client has one download helper rather
   * than two, and the saved file keeps its NAME — a data: URL opened directly is saved by
   * Chrome as "download" with no extension, which is a .EMB no embroidery program will open.
   *
   * Same-origin either way: the bucket is private and the CDN alias has never resolved —
   * see designUrlOf in orders.js for that whole story.
   */
  app.get('/api/machine_files/:id/download', { preHandler: requireAuth }, async (req, reply) => {
    await ready;
    const row = await findFor(req.user, req.params.id);
    if (!row) { reply.code(404); return { error: 'no such file' }; }
    const mime = row.mime || 'application/octet-stream';
    const name = row.file_name || 'design.emb';
    if (row.storage_key) {
      const obj = await getObject(row.storage_key).catch(() => null);
      if (!obj) { reply.code(410); return { error: 'The stored file could not be read back.' }; }
      const buf = Buffer.isBuffer(obj.body) ? obj.body : Buffer.from(obj.body);
      return { id: row.id, name, mime, data: `data:${mime};base64,${buf.toString('base64')}` };
    }
    if (row.data) return { id: row.id, name, mime, data: row.data };
    reply.code(404); return { error: 'no bytes' };
  });

  /**
   * RESOLVE — what an import sheet's Machine File ID column points at.
   *
   * Metadata for every reference the CALLER owns, so the import dialog can say "MF-12 →
   * comelones.emb" in its preview and fail the row up front rather than importing a line
   * with nothing on it. Unknown and not-yours are the same answer, by design.
   */
  app.post('/api/machine_files/resolve', { preHandler: requireAuth }, async (req) => {
    await ready;
    const refs = Array.isArray((req.body || {}).refs) ? req.body.refs.slice(0, 500) : [];
    const out = {};
    for (const ref of refs) {
      const key = String(ref ?? '').trim();
      if (!key || out[key] !== undefined) continue;
      const row = await findFor(req.user, key);
      out[key] = row ? shape(row) : null;
    }
    return out;
  });

  /**
   * ATTACH ONE LIBRARY FILE TO ONE ORDER LINE.
   *
   * This is the whole point of the table. The browser sends an id and a line, never bytes:
   * the row written into `design_file_data` carries the SAME `storage_key`, so one object
   * serves every line that references it. (When storage is off there is no key and the
   * inline bytes are copied instead — see the note at the top of the file.)
   *
   * THREE THINGS IT WILL NOT DO, each of which is a real failure this design exists to stop:
   *
   *   1. It mints the `design_id` itself. That column is a primary key AND the object key
   *      for anything uploaded through design_files, so a client-chosen id is a way to
   *      overwrite somebody else's file. `MF-<seq>` on its own would collide the moment two
   *      lines used one library file.
   *   2. It always writes `line_id`. NULL in that column means "every line on the order" —
   *      the exact bug the column was added to end — and the sheet importer's own upload
   *      passed no line, so a template's stitch file landed on all five lines of a five-line
   *      order. A file belongs to the unit row that asked for it.
   *   3. It checks the LINE's print method. A stitch file on a DTG line is a check fee for a
   *      file no machine can run.
   */
  app.post('/api/machine_files/:id/attach', { preHandler: requireAuth }, async (req, reply) => {
    await ready;
    const row = await findFor(req.user, req.params.id);
    if (!row) { reply.code(404); return { error: 'no such file' }; }
    const b = req.body || {};
    const orderId = String(b.orderId || '').trim();
    const lineId = String(b.lineId || '').trim();
    if (!orderId || !lineId) { reply.code(400); return { error: 'orderId + lineId required' }; }

    // The order has to be the caller's. Staff may attach anywhere; a seller may not reach
    // into another account's order with their own library.
    const owner = await q('select seller_id from orders where id=$1', [orderId])
      .then((r) => r.rows[0]?.seller_id ?? null).catch(() => null);
    if (!owner) { reply.code(404); return { error: 'no such order' }; }
    const seller = await effectiveSeller(req.user);
    if (seller && String(owner) !== String(seller)) { reply.code(404); return { error: 'no such order' }; }

    /**
     * THE LINE, AND WHAT IT IS PRINTED WITH.
     *
     * `print_type` carries the method; the sku also carries it as a suffix (-EMB, -DTG …)
     * for lines that predate the column, so both are read. A line we cannot identify is
     * refused rather than guessed at: attaching to the wrong unit row is precisely the
     * failure this endpoint exists to prevent, and "probably this one" is not good enough
     * for something that bills a check fee and reaches a machine.
     */
    const line = await q(
      `select line_id, sku, print_type from order_items where order_id=$1 and line_id=$2 limit 1`,
      [orderId, lineId]).then((r) => r.rows[0]).catch(() => null);
    if (!line) { reply.code(404); return { error: `No line ${lineId} on order ${orderId}.` }; }
    const method = String(line.print_type || '').toLowerCase();
    const suffix = /-emb$/i.test(String(line.sku || ''));
    const embroidered = suffix || /emb|stitch|embroid/.test(method);
    if (!embroidered && method) {
      reply.code(409);
      return { error: `That line is ${line.print_type} — a stitch file has no machine to run on it, so it was not attached.` };
    }

    // MINTED HERE, and scoped to the line. Not the library ref: two lines using one library
    // file would write the same primary key and the second would overwrite the first.
    const designId = `MF-${row.seq ?? row.id}-${lineId}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120);
    await q(
      `insert into design_file_data
         (design_id, order_id, sku, line_id, seller_id, file_name, mime, data, storage_key, content_hash, price, kind, source, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,'seller',now(),now())
       on conflict (design_id) do update set
         order_id=excluded.order_id, sku=excluded.sku, line_id=excluded.line_id,
         seller_id=excluded.seller_id, file_name=excluded.file_name, mime=excluded.mime,
         data=excluded.data, storage_key=excluded.storage_key,
         content_hash=excluded.content_hash, kind=excluded.kind, updated_at=now()`,
      [designId, orderId, line.sku || null, lineId, owner, row.file_name, row.mime,
       row.storage_key ? null : row.data, row.storage_key, row.content_hash, row.kind]);
    /* 'design_file.uploaded', not an action of its own: the Design readiness tag matches
       /^design_file\./ and this IS a machine file arriving on a line. A new verb would have
       left the tag's history with a gap exactly where the bulk path filled it. */
    audit(req, 'design_file.uploaded', {
      entityType: 'order', entityId: orderId,
      after: { name: row.file_name, sku: line.sku || null, kind: row.kind, lineId, from: shape(row).ref },
    });
    return { ok: true, designId, ref: shape(row).ref, fileName: row.file_name };
  });
}
