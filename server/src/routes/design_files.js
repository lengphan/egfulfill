// Machine deliverable files (.pes/.emb/.dst/.exp/.jef/.vp3) stored SERVER-SIDE — the raw bytes the
// client used to keep only in localStorage (eg_design_files), which vanished on a cache clear and
// never reached another device. Bytes are stored inline as a base64 data-URL string, keyed by the
// design id (DL-…/DSN-…). Access-controlled: staff any; a seller only their OWN files (seller_id,
// resolved from the order the design belongs to; a seller's active team member counts as the owner).
import { q } from '../db.js';
import { readAll } from './factory_settings.js';
import { isStaff, canMoveMoney } from '../auth.js';
import { storageEnabled, putObject, getObject, fromDataUrl } from '../storage.js';
import { notify } from './notifications.js';
import { audit } from '../audit.js';
import { egBroadcast } from '../events.js';
import { phashDistance, PHASH_NEAR } from '../fingerprint.js';

export function designFilesRoutes(app, requireAuth) {
  q(`create table if not exists design_file_data (
       design_id    text primary key,
       order_id     text,
       sku          text,
       seller_id    uuid,
       file_name    text,
       mime         text,
       data         text,
       url          text,
       content_hash text,
       created_at   timestamptz default now(),
       updated_at   timestamptz default now()
     )`)
    .then(() => q('alter table design_file_data add column if not exists url text'))
    // `price` is what the seller pays to download. Chained after the create — two
    // bare q() calls can hit different pool connections and run out of order, and the
    // swallowed error would leave the column silently missing.
    .then(() => q('alter table design_file_data add column if not exists price numeric(12,2) default 0'))
    // 'pes' = the seller's paid deliverable | 'emb' = factory working file | 'image'
    // = artwork/mockup | 'other' = anything else. Every type is stored; `kind` only
    // decides who SEES it.
    .then(() => q("alter table design_file_data add column if not exists kind text default 'other'"))
    /**
     * WHICH LINE this file belongs to. NULL means "every line on the order".
     *
     * Files used to carry only (order_id, sku), so a file dropped on one item showed up on
     * all of them — two lines of the same SKU are different jobs, and a marketplace line
     * arrives with its variant (and therefore its SKU) unset, which made the sku match
     * universal. That is the bug this column exists to end.
     *
     * NULL = all is deliberate, not a leftover: every row that predates this column already
     * has no line_id, and "applies to the whole order" is exactly the behaviour those files
     * have today. So the existing data needs no migration and no guess about which line a
     * file was really meant for — it keeps doing what it already did, and only new per-item
     * uploads are scoped.
     */
    .then(() => q('alter table design_file_data add column if not exists line_id text'))
    /**
     * WHO PUT THIS FILE HERE — 'seller' or 'factory'.
     *
     * Visibility was decided by `kind` alone, and `kind` is a fact about the FILE TYPE, not
     * about who it belongs to: a seller could see 'pes' and nothing else. So a seller who
     * dropped their own .dst on their own order got "Sent your machine file" and then "No
     * files on this order yet" underneath it — the row existed, was theirs, and was filtered
     * out of their own list. Worse, when it was the order's only file the list answered 403.
     *
     * A file someone sent us is not a deliverable to be bought back; it is their file. This
     * column is what lets the read say so. Rows written before it are factory files by
     * definition — sellers had no upload path that survived the filter.
     */
    .then(() => q("alter table design_file_data add column if not exists source text"))
    /**
     * THE OBJECT KEY, because the URL beside it points at a host that does not exist.
     *
     * `url` holds whatever putObject() returned, and putObject prefers SPACES_CDN — set to
     * https://cdn.egful.store, which has never been connected and answers NXDOMAIN. So every
     * storage-backed machine file handed the browser a dead link: 23 of the 24 rows on the
     * live database, i.e. every .EMB/.PES a seller has bought or a machine operator has
     * tried to fetch since storage was switched on.
     *
     * Serving the bytes back through this API needs the key, not the link — the same shape
     * order designs and design cards already use. Existing rows are backfilled from the URL
     * path, which IS the key: putObject built the URL as `<base>/<key>`.
     */
    .then(() => q('alter table design_file_data add column if not exists storage_key text'))
    .then(() => q("update design_file_data set storage_key = regexp_replace(url, '^https?://[^/]+/', '') where url is not null and storage_key is null"))
    .then(() => q('create index if not exists design_file_data_order on design_file_data (order_id)'))
    .catch(() => {});

  // What a file IS, from its name/mime. Drives visibility, not storage — we record
  // every type either way.
  //   .pes                    → the seller's deliverable (paywalled)
  //   .emb/.dst/.exp/.jef/... → factory working files (staff only)
  //   image/*                 → artwork + mockups (staff; free)
  function kindOf(name, mime) {
    const n = String(name || '').toLowerCase();
    if (/\.pes$/.test(n)) return 'pes';
    if (/\.(emb|dst|exp|jef|vp3|xxx|hus)$/.test(n)) return 'emb';
    if (/^image\//.test(String(mime || '')) || /\.(png|jpe?g|webp|gif|svg|tiff?|bmp)$/.test(n)) return 'image';
    return 'other';
  }
  // Only admin + warehouse may set what a seller pays. Operators and designers are
  // staff but must NOT be able to price a deliverable.
  const canPrice = canMoveMoney;   // shared predicate — see auth.js

  // Effective owner for a request (a team member acts as the owner; a plain seller is themselves).
  async function effectiveSeller(user) {
    if (!user || isStaff(user)) return null;   // staff → no seller filter (see all)
    try {
      const r = await q("select owner_id from team_members where lower(email)=lower($1) and status='active' limit 1", [user.email || '']);
      if (r.rows[0] && r.rows[0].owner_id) return r.rows[0].owner_id;
    } catch (e) {}
    return user.sub;
  }
  async function ownerOfOrder(orderId, fallback) {
    if (orderId) { try { const r = await q('select seller_id from orders where id=$1', [orderId]); if (r.rows[0] && r.rows[0].seller_id) return r.rows[0].seller_id; } catch (e) {} }
    return fallback;
  }

  // Save/replace a machine file. Staff (the factory uploads the .PES) or the owning seller.
  // body: { designId, data (base64 data-URL), orderId?, sku?, name?, mime?, hash?, price? }
  // `price` is what the SELLER pays to download it; only staff may set it (a seller
  // pricing their own paywall would be nonsense).
  /**
   * "Have we already made a machine file from this artwork?" — STAFF ONLY.
   *
   * Given an order line, look up its artwork fingerprint and return every deliverable
   * (.pes / .emb) previously produced from the SAME artwork, on any order, for any
   * seller. That's what lets the floor reuse a digitised file instead of paying a
   * designer to redo work that already exists.
   *
   * Two tiers, kept strictly separate and never merged:
   *   exact   — identical bytes. Safe to offer as a straight reuse.
   *   similar — within PHASH_NEAR bits. A SUGGESTION for a human to confirm, never an
   *             automatic attach: a false positive here puts the wrong artwork on
   *             someone's order, which is far worse than digitising twice.
   */
  app.get('/api/design_files/reuse', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const orderId = String(req.query.orderId || '');
    const sku = String(req.query.sku || '');
    // The LINE, when the caller knows it. Optional so older callers keep working, and
    // load-bearing when they pass it — see the key shapes below.
    const lineId = req.query.lineId ? String(req.query.lineId) : null;
    if (!orderId || !sku) { reply.code(400); return { error: 'orderId + sku required' }; }

    /**
     * THE SOURCE ARTWORK, matched on all three key shapes rather than sku alone.
     *
     * `where sku=$2` missed any design row written by the older client, which stores the
     * LINE ID in the sku column (verified: order 12345's row carries line_id NULL and its
     * line id in `sku`). A missed source returns hashed:false and shows nothing — and a
     * failed lookup is indistinguishable from "no matches", which is why this never
     * looked broken. Same three cases the order list join uses, most specific first.
     */
    const src = await q(
      `select art_hash, art_phash from order_designs
        where order_id = $1
          and art_hash is not null
          and ( ($3::text is not null and line_id = $3)
             or (line_id is null and (sku = $2 or ($3::text is not null and sku = $3))) )
        order by (line_id is not null) desc, (sku = $3) desc, updated_at desc nulls last
        limit 1`,
      [orderId, sku, lineId]).then((r) => r.rows[0]).catch(() => null);
    if (!src || !src.art_hash) return { exact: [], similar: [], hashed: false };

    // Files whose ORDER LINE carried the same artwork. Excludes this order's own files —
    // "you already have one here" is not reuse, it's the normal case.
    const exact = await q(
      `select f.design_id, f.file_name, f.kind, f.order_id, f.created_at,
              coalesce(u.store_name, u.name, u.email, '—') as seller
         from design_file_data f
         join order_designs d on d.order_id = f.order_id
           and (
             f.sku = d.sku
             -- A FILE WITH NO SKU still belongs to its order's artwork. 6 of 19 machine
             -- files carry none, so d.sku = f.sku dropped them and they could never be
             -- offered for reuse. Attributed only when that order has exactly ONE distinct
             -- artwork — with two, we would be guessing which design the file is for, and
             -- a false positive here puts the wrong artwork on someone's order.
             or (f.sku is null and (
                   select count(distinct x.art_hash) from order_designs x
                    where x.order_id = f.order_id and x.art_hash is not null) = 1)
           )
         left join users u on u.id = f.seller_id
        where d.art_hash = $1 and f.order_id <> $2 and f.kind in ('pes','emb')
        order by f.created_at desc limit 20`,
      [src.art_hash, orderId]).then((r) => r.rows).catch(() => []);

    // Fuzzy pass runs only when there's no exact hit — if we already have the real thing,
    // offering lookalikes is noise.
    let similar = [];
    if (!exact.length && src.art_phash) {
      const cand = await q(
        `select f.design_id, f.file_name, f.kind, f.order_id, f.created_at, d.art_phash,
                coalesce(u.store_name, u.name, u.email, '—') as seller
           from design_file_data f
           join order_designs d on d.order_id = f.order_id
           and (
             f.sku = d.sku
             -- A FILE WITH NO SKU still belongs to its order's artwork. 6 of 19 machine
             -- files carry none, so d.sku = f.sku dropped them and they could never be
             -- offered for reuse. Attributed only when that order has exactly ONE distinct
             -- artwork — with two, we would be guessing which design the file is for, and
             -- a false positive here puts the wrong artwork on someone's order.
             or (f.sku is null and (
                   select count(distinct x.art_hash) from order_designs x
                    where x.order_id = f.order_id and x.art_hash is not null) = 1)
           )
           left join users u on u.id = f.seller_id
          where d.art_phash is not null and f.order_id <> $1 and f.kind in ('pes','emb')
          order by f.created_at desc limit 500`,
        [orderId]).then((r) => r.rows).catch(() => []);
      similar = cand
        .map((row) => ({ row, dist: phashDistance(src.art_phash, row.art_phash) }))
        .filter((x) => x.dist != null && x.dist <= PHASH_NEAR)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 10)
        .map((x) => ({ ...x.row, distance: x.dist, art_phash: undefined }));
    }
    return { exact, similar, hashed: true };
  });

  /**
   * Reuse an existing machine file on ANOTHER order — staff only.
   *
   * The factory can see that two sellers uploaded the same artwork and reuse the file
   * rather than paying to digitise it twice. The receiving seller must NOT learn that:
   * they see a deliverable on their own order, priced and downloadable, with no hint of
   * where it came from.
   *
   * So this COPIES rather than links. A link would mean either exposing the source row
   * (whose seller_id is someone else's, and which their file list would reject anyway)
   * or loosening the seller filter — both leak. A copy is a normal file on their order,
   * indistinguishable from one made for them, and the entitlement they buy is their own.
   */
  app.post('/api/design_files/:designId/reuse', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const b = req.body || {};
    const orderId = String(b.orderId || '');
    const sku = String(b.sku || '');
    if (!orderId || !sku) { reply.code(400); return { error: 'orderId + sku required' }; }

    const src = await q('select * from design_file_data where design_id=$1', [String(req.params.designId)])
      .then((r) => r.rows[0]);
    if (!src) { reply.code(404); return { error: 'Source file not found' }; }

    const seller = await ownerOfOrder(orderId, null);
    const newId = `${src.kind === 'pes' ? 'DL' : 'EMB'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await q(
      // storage_key travels with the copy. Without it the new row points at the same object
      // through a URL the download route can no longer read, so a reused file downloads as
      // nothing while the original works.
      `insert into design_file_data (design_id, order_id, sku, seller_id, file_name, mime, data, url, storage_key, content_hash, price, kind, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$12,$9,$10,$11, now(), now())`,
      [newId, orderId, sku, seller || null, src.file_name, src.mime, src.data, src.url, src.content_hash,
       Number(src.price) || 0, src.kind, src.storage_key || null]
    );
    // Audited so the reuse is traceable on OUR side even though it's invisible on theirs.
    audit(req, 'design_file.reused', {
      entityType: 'order', entityId: orderId,
      after: { from: String(req.params.designId), to: newId, sku },
    });
    return { ok: true, designId: newId };
  });

  /**
   * What a new file costs the seller to download.
   *
   * emb_price has been an editable setting all along and was never read: the insert
   * defaulted every file to `coalesce($10, 0)`, so every deliverable we have ever produced
   * has been free to download. The setting existed, the revenue didn't.
   *
   * Only DELIVERABLES get a price. A mockup or a reference image priced at the embroidery
   * rate would put a paywall in front of the seller's own artwork.
   *
   * An explicit price from someone allowed to set one always wins; returning null leaves
   * an existing file's price untouched on re-upload, which is what stops a seller replacing
   * their own file to zero out what staff charged.
   */
  function priceFor(user, b, fallback) {
    if (canPrice(user) && b.price != null) return Math.max(0, Number(b.price) || 0);
    const kind = kindOf(b.name, b.mime);
    if (kind !== 'pes' && kind !== 'emb') return null;
    const n = Number(fallback);
    return isFinite(n) && n > 0 ? n : null;
  }

  app.post('/api/design_files', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    if (!b.designId || !b.data) { reply.code(400); return { error: 'designId + data required' }; }
    // Read at call time — a price changed in Settings must apply to the next upload, not
    // the next redeploy.
    const defaultPrice = await readAll().then((s) => s.emb_price).catch(() => 0);
    const seller = await ownerOfOrder(b.orderId, req.user.sub);
    // A non-staff caller may only write under their OWN order/design.
    if (!isStaff(req.user) && seller && seller !== (await effectiveSeller(req.user))) { reply.code(403); return { error: 'forbidden' }; }
    /**
     * BYTES ONLY. fromDataUrl() base64-DECODES anything that isn't a data: URL, so a caller
     * that passed a link — which "apply this file to every item" did, because the download
     * route used to hand back a storage URL rather than the file — silently replaced the
     * deliverable with a few dozen bytes of decoded URL text. Refuse it out loud instead:
     * this endpoint stores a file, and a link is not one. (order_designs hit the same trap;
     * there a link is a legitimate value, so it resolves rather than refuses.)
     */
    if (!/^data:/i.test(String(b.data))) {
      reply.code(400);
      return { error: 'Send the file itself, not a link to it — a link would overwrite the file with its own text.' };
    }
    // Prefer object storage (Spaces/S3) — keep the big base64 OUT of Postgres. Falls back to inline.
    let data = String(b.data), url = null, storageKey = null;
    if (storageEnabled()) {
      try {
        const parsed = fromDataUrl(data);
        const ext = (String(b.name || '').match(/\.[a-z0-9]+$/i) || [''])[0] || '';
        const key = 'design-files/' + encodeURIComponent(String(b.designId)) + ext;
        url = await putObject(key, parsed.buffer, b.mime || parsed.mime);
        // The key, not just the URL: the URL is a CDN address that has never resolved, and
        // the download route reads the bytes back through this key.
        storageKey = key;
        data = null;
      } catch (e) { /* storage failed → keep inline */ }
    }
    await q(
      `insert into design_file_data (design_id, order_id, sku, line_id, seller_id, file_name, mime, data, url, storage_key, content_hash, price, kind, source, created_at, updated_at)
       values ($1,$2,$3,$12,$4,$5,$6,$7,$8,$13,$9, coalesce($10, 0), $11, $14, now(), now())
       on conflict (design_id) do update set
         -- Whoever wrote it LAST owns the row's provenance: staff replacing a seller's file
         -- with a cut version makes it a factory file, which is exactly what it now is.
         source=excluded.source,
         order_id=coalesce(excluded.order_id, design_file_data.order_id),
         sku=coalesce(excluded.sku, design_file_data.sku),
         -- line_id takes the INCOMING value verbatim, including null. Everywhere else here
         -- coalesces to keep the old value, but scope is the one thing a re-upload has to be
         -- able to widen: re-filing a per-line file as an "applies to all" file (line_id
         -- null) must not silently keep it pinned to the line it started on.
         line_id=excluded.line_id,
         seller_id=coalesce(excluded.seller_id, design_file_data.seller_id),
         file_name=excluded.file_name, mime=excluded.mime, data=excluded.data, url=excluded.url,
         storage_key=excluded.storage_key, content_hash=excluded.content_hash,
         price=coalesce($10, design_file_data.price), kind=excluded.kind, updated_at=now()`,
      [String(b.designId), b.orderId || null, b.sku || null, seller || null, b.name || null, b.mime || null, data, url, b.hash || null,
       priceFor(req.user, b, defaultPrice),
       kindOf(b.name, b.mime),
       // "" and undefined both mean the whole order — only a real line id scopes a file.
       (b.lineId || b.line_id) ? String(b.lineId || b.line_id) : null,
       storageKey,
       isStaff(req.user) ? 'factory' : 'seller']);
    /**
     * Record it + wake the boards. Without these two lines the file lands in storage but
     * nothing tells the UI: the Design readiness tag stayed grey until a full reload (it
     * flips on a `pes`/`emb` file, which this now is) and the tag's history popover had no
     * row for how the file got there. A drag-drop that changes nothing on screen reads as
     * a drop that failed.
     *   · audit  → the Design tag matches /^design_file\./, so this shows as
     *              "Machine file uploaded" in that tag's history.
     *   · egBroadcast → a cache-invalidation ping (carries no bytes); every open board
     *              re-fetches the shared file list through its own access-controlled
     *              endpoint, so the tag flips colour live wherever the file was dropped.
     */
    if (b.orderId) {
      const savedKind = kindOf(b.name, b.mime);
      audit(req, 'design_file.uploaded', {
        entityType: 'order', entityId: String(b.orderId),
        after: { name: b.name || String(b.designId), sku: b.sku || null, kind: savedKind },
      });
      egBroadcast({ type: 'design-file', orderId: String(b.orderId), sku: b.sku || null, kind: savedKind });
    }
    /**
     * A SELLER'S OWN MACHINE FILE enters the verification queue.
     *
     * Seller-supplied stitch files are the ones that cause problems — wrong size, wrong
     * format, wrong machine — so somebody here opens every one. That check is what the
     * check fee pays for, and a check nobody is queued to do is a check that doesn't
     * happen: without a card this file would sit attached to the order, unlooked at, and
     * the first person to see it would be whoever ran the machine.
     *
     * In REVIEW, not incoming: the work of making it is done, what's left is judging it.
     * Unclaimed and unpriced, because verifying is not cutting — the payout rule pays
     * whoever claimed a card they worked, and nobody has worked this one.
     *
     * The tier (and therefore the check fee) is deliberately NOT set here. Staff decide
     * that after looking, which keeps a charge on a human's judgement rather than on a
     * seller's upload succeeding.
     */
    const uploadedKind = kindOf(b.name, b.mime);
    /**
     * A SELLER'S MACHINE FILE GOES TO THE FACTORY, NOT TO THE BOARD.
     *
     * It used to raise a designer card on upload. Designers must not be the first to see a
     * seller's stitch file — operator, warehouse or admin opens it, and if it is fine there
     * is nothing to send anyone. A card is created only when the factory decides to send
     * one, which is what the existing "send to the designer board" action is for.
     */
    if (!isStaff(req.user) && b.orderId && (uploadedKind === 'emb' || uploadedKind === 'pes')) {
      notify({
        roles: ['operator', 'warehouse', 'admin'],
        type: 'design-file', title: 'A seller sent their own machine file',
        body: `${b.orderId} · ${b.sku || ''} — ${b.name || b.designId}. Needs checking before production.`,
        href: `/orders/${b.orderId}`, entityId: String(b.orderId),
      }).catch(() => {});
    }

    // Only ping the seller about a file that is THEIRS — a factory .emb or a mockup
    // is not something they can see, so telling them about it would be noise.
    if (isStaff(req.user) && seller && b.orderId && kindOf(b.name, b.mime) === 'pes') {
      notify({
        userIds: [seller], type: 'design-file',
        title: 'Your design file is ready',
        body: b.name || String(b.designId),
        href: `/orders/${b.orderId}`, entityId: String(b.designId),
      });
    }
    return { ok: true, stored: url ? 'object-storage' : 'inline' };
  });

  // Remove a file from an order. Staff-only: a machine file is a factory artefact, and a
  // seller must not be able to delete a working file. The Design readiness tag reverts on
  // its own once the file is gone (it reads has_machine_file), and the two lines below make
  // that live — egBroadcast wakes the boards to re-read, audit leaves a 'Machine file
  // removed' row in the tag's history so a file appearing then vanishing is explained, not
  // a mystery. No ledger touch: removing the record is not a refund (charge/refund ride the
  // wallet on purchase/cancel, not on a staff file cleanup).
  app.delete('/api/design_files/:designId', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const designId = String(req.params.designId || '');
    const row = await q('select order_id, sku, file_name, kind from design_file_data where design_id=$1', [designId]).then((r) => r.rows[0]);
    if (!row) { reply.code(404); return { error: 'File not found.' }; }
    await q('delete from design_file_data where design_id=$1', [designId]);
    if (row.order_id) {
      audit(req, 'design_file.removed', {
        entityType: 'order', entityId: String(row.order_id),
        after: { name: row.file_name || designId, sku: row.sku || null, kind: row.kind || null },
      });
      egBroadcast({ type: 'design-file', orderId: String(row.order_id), sku: row.sku || null, kind: row.kind || null });
    }
    return { ok: true };
  });

  // ── Paywall ────────────────────────────────────────────────────────────────
  // A machine file is a deliverable the seller BUYS. The entitlement was previously
  // only a localStorage flag (eg_emb_paid) flipped on the client — so the download
  // endpoint below happily served the bytes to anyone who called it directly. The
  // ledger is the real source of truth, so check it here.
  //
  // Ref convention (kept from the old app so existing purchases still count):
  //   emb-file    → ref `orderId|sku`
  //   design-file → ref the design id (DL-…)
  async function isPaid(row, sellerId) {
    if (!sellerId) return false;
    const refs = [String(row.design_id)];
    if (row.order_id && row.sku) refs.push(`${row.order_id}|${row.sku}`);
    const r = await q(
      `select 1 from wallet_ledger
        where account=$1 and type in ('emb-file','design-file') and ref = any($2::text[]) limit 1`,
      [String(sellerId), refs]
    );
    return r.rowCount > 0;
  }

  // What a seller owes for a file, and whether they've already paid.
  app.get('/api/design_files/:designId/access', { preHandler: requireAuth }, async (req, reply) => {
    const r = await q('select design_id, order_id, sku, seller_id, file_name, price from design_file_data where design_id=$1', [String(req.params.designId)]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (isStaff(req.user)) return { paid: true, staff: true, price: Number(row.price) || 0, name: row.file_name };
    const eff = await effectiveSeller(req.user);
    if (row.seller_id && row.seller_id !== eff) { reply.code(403); return { error: 'forbidden' }; }
    const price = Number(row.price) || 0;
    // canBuy tells the UI whether to offer the button at all — a team member should see
    // "ask the owner", not a Buy button that 403s.
    return {
      paid: price <= 0 || (await isPaid(row, eff)),
      price, name: row.file_name,
      canBuy: String(eff) === String(req.user.sub),
    };
  });

  // Buy the file — one idempotent debit. (account,type,ref) is uniquely indexed, so a
  // double-click or a retry can never charge twice.
  app.post('/api/design_files/:designId/purchase', { preHandler: requireAuth }, async (req, reply) => {
    const r = await q('select design_id, order_id, sku, seller_id, file_name, price from design_file_data where design_id=$1', [String(req.params.designId)]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (isStaff(req.user)) { reply.code(400); return { error: 'Staff already have access — nothing to buy' }; }
    const eff = await effectiveSeller(req.user);
    if (row.seller_id && row.seller_id !== eff) { reply.code(403); return { error: 'forbidden' }; }

    // Only the account OWNER buys. A team member acts under the owner (effectiveSeller
    // resolves to owner_id), which meant a member could spend the owner's wallet — so
    // spending is restricted to the owner while everything else a member does still
    // resolves to the owner as before. A purchased file stays usable by the whole team;
    // it's the SPEND that's the leader's call.
    if (String(eff) !== String(req.user.sub)) {
      reply.code(403);
      return { error: 'Only the account owner can buy design files. Ask them to purchase it for the team.' };
    }

    const price = Number(row.price) || 0;
    if (price <= 0) return { ok: true, paid: true, free: true };
    if (await isPaid(row, eff)) return { ok: true, paid: true, already: true };

    // Balance is SUM(delta) over the append-only ledger — no stored balance to drift.
    const b = await q('select coalesce(sum(delta),0)::float as bal from wallet_ledger where account=$1', [String(eff)]);
    const bal = Number(b.rows[0]?.bal || 0);
    if (bal < price) { reply.code(400); return { error: `Not enough balance — this file is $${price.toFixed(2)}, your balance is $${bal.toFixed(2)}.`, needsTopup: true, price, balance: bal }; }

    const isEmb = /\.(pes|emb|dst|exp|jef|vp3)$/i.test(String(row.file_name || ''));
    const type = isEmb ? 'emb-file' : 'design-file';
    const ref = (isEmb && row.order_id && row.sku) ? `${row.order_id}|${row.sku}` : String(row.design_id);
    await q(
      `insert into wallet_ledger (account, delta, type, ref, note, created_by)
       values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
      [String(eff), -price, type, ref, `Design file: ${row.file_name || row.design_id}`, String(req.user.sub)]
    );
    const b2 = await q('select coalesce(sum(delta),0)::float as bal from wallet_ledger where account=$1', [String(eff)]);
    return { ok: true, paid: true, balance: Number(b2.rows[0]?.bal || 0) };
  });

  // Re-price a deliverable. Admin + warehouse only — an operator or designer is
  // staff but has no business setting what a seller pays.
  app.patch('/api/design_files/:designId/price', { preHandler: requireAuth }, async (req, reply) => {
    if (!canPrice(req.user)) { reply.code(403); return { error: 'Only admin or warehouse can set a file price' }; }
    const price = Math.max(0, Number(req.body && req.body.price) || 0);
    const r = await q('update design_file_data set price=$1, updated_at=now() where design_id=$2 returning design_id, price', [price, String(req.params.designId)]);
    if (!r.rows.length) { reply.code(404); return { error: 'not found' }; }
    return { ok: true, designId: r.rows[0].design_id, price: Number(r.rows[0].price) || 0 };
  });

  // Every file attached to an order — drives the board card + the seller's order page.
  // Never returns bytes; download goes through the paywalled route below.
  app.get('/api/design_files', { preHandler: requireAuth }, async (req, reply) => {
    const orderId = String(req.query?.orderId || '');
    if (!orderId) { reply.code(400); return { error: 'orderId is required' }; }
    const r = await q(
      'select design_id, order_id, sku, line_id, seller_id, file_name, mime, price, kind, source, created_at from design_file_data where order_id=$1 order by created_at',
      [orderId]
    );
    if (!isStaff(req.user)) {
      const eff = await effectiveSeller(req.user);
      // Sellers get their .pes deliverable only. Factory working files (.emb) and
      // internal mockups stay on the factory boards.
      // Design files are the OWNER's by default — a member sees none unless the owner
      // grants 'files'. Same shape as the wallet: hidden until shared, and sharing the
      // VIEW never grants the ability to buy, which stays the owner's alone.
      const isMember = String(eff) !== String(req.user.sub);
      if (isMember) {
        const perms = await q(
          "select permissions from team_members where lower(email)=lower($1) and status='active' limit 1",
          [req.user.email || '']
        ).then((x) => (Array.isArray(x.rows[0]?.permissions) ? x.rows[0].permissions : [])).catch(() => []);
        if (perms.indexOf('files') < 0) return [];
      }
      /**
       * TWO THINGS A SELLER MAY SEE, and only one of them was here.
       *
       *   their .pes deliverable  — behind the wallet paywall, as before
       *   a file THEY sent us     — theirs already; nothing to unlock, nothing to buy
       *
       * The filter was `kind === 'pes'` alone, so a seller's own upload vanished from their
       * own order the moment it landed, and an order whose only file was that upload
       * answered 403 — the panel then rendered "No files on this order yet" over the top of
       * "Sent your machine file". Factory working files stay hidden either way: those are
       * `source='factory'` whatever their type.
       */
      const ours = r.rows.filter((x) => !x.seller_id || x.seller_id === eff);
      // 403 only when NONE of the order's files are this account's — that is somebody
      // else's order. Files that exist but aren't visible to a seller are a normal state
      // (every factory .emb is one), and answering 403 for it broke the seller's panel.
      if (r.rows.length && !ours.length) { reply.code(403); return { error: 'forbidden' }; }
      const mine = ours.filter((x) => x.kind === 'pes' || x.source === 'seller');
      // Tell the seller what's unlocked without handing over any bytes.
      return Promise.all(mine.map(async (x) => ({
        designId: x.design_id, sku: x.sku, lineId: x.line_id, name: x.file_name, mime: x.mime, kind: x.kind,
        source: x.source || 'factory',
        price: Number(x.price) || 0, created_at: x.created_at,
        // Their own upload is not a purchase. `paid` drives the button, and a file they
        // sent us must never be offered back to them with a price on it.
        paid: x.source === 'seller' || (Number(x.price) || 0) <= 0 || (await isPaid(x, eff)),
      })));
    }
    // Staff (every factory board) see every file on the order.
    return r.rows.map((x) => ({ designId: x.design_id, sku: x.sku, lineId: x.line_id, name: x.file_name, mime: x.mime, kind: x.kind, source: x.source || "factory", price: Number(x.price) || 0, created_at: x.created_at, paid: true, canPrice: canPrice(req.user) }));
  });

  /**
   * RE-SCOPE A FILE — this line only, or the whole order. Metadata, no bytes.
   *
   * "Apply file to all items" used to download the file and re-upload it with line_id
   * null. A seller cannot download their own .emb (the download route serves them 'pes'
   * only), so their click died on `forbidden` before it started — and even for staff it
   * moved megabytes through the browser to change one column.
   */
  app.post('/api/design_files/:designId/scope', { preHandler: requireAuth }, async (req, reply) => {
    const id = String(req.params.designId);
    const row = (await q('select design_id, order_id, seller_id, sku from design_file_data where design_id=$1', [id])).rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (!isStaff(req.user)) {
      const eff = await effectiveSeller(req.user);
      if (row.seller_id && String(row.seller_id) !== String(eff)) { reply.code(403); return { error: 'forbidden' }; }
    }
    const b = req.body || {};
    // null / '' = the whole order. A real line id scopes it back to one line.
    const lineId = b.lineId ? String(b.lineId) : null;
    await q('update design_file_data set line_id=$2, updated_at=now() where design_id=$1', [id, lineId]);
    audit(req, 'design_file.scoped', {
      entityType: 'order', entityId: String(row.order_id || ''),
      after: { design_id: id, line_id: lineId, sku: row.sku || null },
    });
    egBroadcast({ type: 'design-file', orderId: row.order_id || null });
    return { ok: true, lineId };
  });

  // Download a machine file. Staff any; a seller only their own AND only once paid.
  app.get('/api/design_files/:designId', { preHandler: requireAuth }, async (req, reply) => {
    const r = await q('select design_id, order_id, sku, seller_id, file_name, mime, data, url, storage_key, price, kind from design_file_data where design_id=$1', [String(req.params.designId)]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (!isStaff(req.user)) {
      const eff = await effectiveSeller(req.user);
      if (row.seller_id && row.seller_id !== eff) { reply.code(403); return { error: 'forbidden' }; }
      // Factory working files are not seller deliverables, whatever the price says.
      if (row.kind && row.kind !== 'pes') { reply.code(403); return { error: 'forbidden' }; }
      // The paywall. Without this the bytes were one direct GET away, whatever the
      // client-side flag said.
      const price = Number(row.price) || 0;
      if (price > 0 && !(await isPaid(row, eff))) {
        reply.code(402);   // Payment Required
        return { error: 'This file has not been purchased yet.', price, needsPurchase: true };
      }
    }
    /**
     * THE BYTES, NOT THE ADDRESS.
     *
     * `url` is whatever putObject returned, and putObject prefers SPACES_CDN —
     * https://cdn.egful.store, a host that has never been connected. So this used to hand
     * back a link that resolves to nothing for 23 of the 24 stored files: every machine
     * file a seller has paid for and every one an operator has tried to open.
     *
     * Read back through the key and returned as a data: URL — the exact shape this route
     * served before storage existed, so `<a download>` and the dialog's Download button
     * need no change. It also keeps the paywall above meaningful: a storage link, once
     * issued, is readable by anyone holding it, whereas these bytes only leave here after
     * the checks. Machine files are kilobytes-to-a-few-megabytes, so inlining them is not
     * the cost it would be for artwork.
     */
    let payload = row.data;
    if (!payload && row.storage_key) {
      const obj = await getObject(row.storage_key).catch(() => null);
      if (obj && obj.body) {
        const mime = row.mime || obj.contentType || 'application/octet-stream';
        payload = `data:${mime};base64,${obj.body.toString('base64')}`;
      }
    }
    if (!payload) { reply.code(404); return { error: 'The file is recorded but its contents could not be read back from storage.' }; }
    return { designId: row.design_id, orderId: row.order_id, sku: row.sku, name: row.file_name, mime: row.mime, data: payload, url: null };
  });
}
