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


/**
 * A FILE FILED AGAINST ARTWORK GOES ONTO THE ORDERS WAITING FOR IT — no press, no prompt.
 *
 * THIS IS A DELIBERATE REVERSAL, and it needs stating because the rule it changes is in
 * CLAUDE.md. §6 says an artwork match SUGGESTS and a human confirms. That rule was written
 * about the PERCEPTUAL match — a lookalike, where being wrong puts somebody else's design on
 * a garment — and it still holds for those: `similar` hits are still only ever offered.
 *
 * An EXACT hit is not a lookalike. `art_hash` is a hash of the artwork bytes, so a match is
 * the same picture, and asking a person to confirm that two identical pictures are identical
 * is a click that can only be answered one way. Owner, 2026-09-23: "dont suggest - attach the
 * files to download button + the files tab" — the suggestion lived in one tab of one card,
 * and a stitch file we already own is no use to the floor if nobody presses the button.
 *
 * IT FILLS GAPS AND NEVER OVERWRITES (§2.6). A line that already carries a stitch file is
 * left exactly as it is, whoever put it there and whatever it is; so is a line covered by an
 * order-wide file. Nothing is replaced, nothing is deleted, and no stage or status moves.
 *
 * WHAT IT DOES TO MONEY, SAID OUT LOUD. computeDesignFees bills digitising for a face with no
 * stitch file and a check fee for one that has it, so attaching here can change what an
 * UNSUBMITTED order costs — downward, and correctly: we are not digitising a picture we have
 * already digitised. An order already charged keeps its charge; nothing here reverses one,
 * the same rule the delete route records.
 */
export async function applyToWaitingLines(srcDesignId, artHash, user) {
  if (!/^[0-9a-f]{64}$/.test(String(artHash || ''))) return [];
  const src = await q('select * from design_file_data where design_id=$1', [String(srcDesignId)])
    .then((r) => r.rows[0]);
  /* ONLY A STITCH FILE. A design IMAGE filed against artwork is a picture of the artwork,
     and putting one on an order as though it were the thing the machine runs is the exact
     confusion the two kinds exist to prevent. */
  if (!src || !['pes', 'emb'].includes(String(src.kind))) return [];

  const waiting = await q(
    `select distinct d.order_id, d.line_id, d.sku
       from order_designs d
       /* THE LINE IT WOULD LAND ON. Required, not optional: a design row whose sku matches
          no item on the order has no line to be a file FOR, and attaching there produced a
          stitch file floating on the order, attributed to nothing, which the fee engine
          cannot see and a person cannot place. */
       join order_items i on i.order_id = d.order_id
        and ( (d.line_id is not null and i.line_id = d.line_id)
           or (d.line_id is null and i.sku = d.sku) )
      where d.art_hash = $1
        /**
         * ONLY AN EMBROIDERED FACE TAKES A STITCH FILE.
         *
         * Without this it attached a .EMB to a DTG shirt and to an appliqué line, because the
         * artwork is what matched and artwork has no method. The floor then finds a stitch
         * file on a job no machine will hoop.
         *
         * THE SAME TEST designLines ALREADY USES, verbatim: a face with its own method is
         * taken at its word, one that says nothing inherits the line. Two spellings of "is
         * this embroidery" is how the fee engine and the file engine come to disagree about
         * the same line (§5).
         */
        and (d.method ~* 'emb' or (coalesce(d.method, '') = '' and coalesce(i.print_type, '') ~* 'emb'))
        and not exists (
          select 1 from design_file_data f
           where f.order_id = d.order_id
             and f.kind in ('pes','emb')
             and (
               /* the same line, the same sku-scoped file, or a file that covers the whole
                  order — any of the three means this line is already answered */
               (d.line_id is not null and f.line_id = d.line_id)
               or (d.line_id is null and f.sku is not null and f.sku = d.sku)
               or (f.line_id is null and f.sku is null)
             )
        )`, [String(artHash)]).then((r) => r.rows).catch(() => []);

  const done = [];
  for (const w of waiting) {
    /* The order's own seller, read here rather than through the routes' ownerOfOrder —
       that one is scoped inside designFilesRoutes and this helper is not. Same query. */
    const seller = await q('select seller_id from orders where id=$1', [w.order_id])
      .then((r) => (r.rows[0] && r.rows[0].seller_id) || null).catch(() => null);
    const newId = `${src.kind === 'pes' ? 'DL' : 'EMB'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      await q(
        /* The same insert the manual reuse route writes, storage_key included — without it
           the copy points at the object through a URL the download route cannot read, so a
           reused file downloads as nothing while the original works.
           NO `side`: the file answers the line, which is what a file attached before sides
           existed has always meant, and it is the reading that keeps those orders priced
           exactly as they were. */
        `insert into design_file_data (design_id, order_id, sku, line_id, seller_id, file_name, mime, data, url, storage_key, content_hash, price, kind, art_hash, source, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'factory', now(), now())`,
        [newId, w.order_id, w.sku || null, w.line_id || null, seller || null, src.file_name, src.mime,
         src.data, src.url, src.storage_key || null, src.content_hash, Number(src.price) || 0, src.kind,
         String(artHash)]);
      audit({ user }, 'design_file.auto_attached', {
        entityType: 'order', entityId: String(w.order_id),
        after: { from: String(srcDesignId), to: newId, line_id: w.line_id || null, sku: w.sku || null, art_hash: String(artHash) },
      });
      /* The boards re-read on this ping, so an order open on somebody's screen picks the
         file up without a reload — the same broadcast an ordinary upload sends. */
      egBroadcast({ type: 'design-file', orderId: String(w.order_id), sku: w.sku || null, kind: src.kind });
      done.push({ order_id: w.order_id, line_id: w.line_id || null, design_id: newId });
    } catch { /* one order failing must not stop the rest */ }
  }
  return done;
}


/**
 * THE OTHER DIRECTION: artwork lands on a line, and we already hold its stitch file.
 *
 * applyToWaitingLines covers "the file arrived last". This covers "the ORDER arrived last" —
 * a picture we have digitised before turning up on a new line — which is the commoner of the
 * two and the one a library is for. Same rules: exact hash only, never a lookalike; only a
 * line with no stitch file of its own; nothing overwritten.
 *
 * The newest library file wins when a picture has more than one. A second file is normally
 * the corrected one, and the same choice the reuse panel already makes when it offers the
 * first of several.
 */
export async function attachLibraryFileForArtwork(artHash, user) {
  const h = String(artHash || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return [];
  const src = await q(
    `select design_id from design_file_data
      where art_hash = $1 and order_id is null and kind in ('pes','emb')
      order by created_at desc nulls last
      limit 1`, [h]).then((r) => r.rows[0]).catch(() => null);
  if (!src) return [];
  return applyToWaitingLines(src.design_id, h, user);
}

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
    /**
     * WHICH ARTWORK this file is the stitch file FOR — as a fact about the file, not one
     * inferred from whichever order it happened to be uploaded against.
     *
     * Until now that link was only ever a JOIN: a file belonged to an order, the order's
     * line carried an art_hash, and reuse matched through both. That works for a file
     * uploaded on an order and cannot express the thing the factory library needs — "here
     * is the .EMB for this picture", filed once, with no order in sight.
     *
     * NULL on every existing row, and the join below is kept exactly as it was, so nothing
     * already stored changes meaning. The two are read together: this column when the file
     * says so itself, the join when only the order can say.
     */
    .then(() => q('alter table design_file_data add column if not exists art_hash text'))
    .then(() => q('create index if not exists design_file_data_art_hash on design_file_data (art_hash)'))
    .then(() => q('alter table design_file_data add column if not exists line_id text'))
    /**
     * WHICH FACE, when the line prints on more than one. NULL means "the whole line",
     * which is every row written before the sheet could ask for five placements — so
     * nothing has to be backfilled and every existing reader keeps its answer.
     *
     * It exists because the machine file genuinely is per POSITION: a front logo and a
     * back design are two different .EMB files. Without a side here, `attach` minted its
     * design_id as MF-<seq>-<lineId> and its own `on conflict (design_id) do update`
     * silently OVERWROTE the first file with the second — the same collision its comment
     * already warned about one level up, for two lines sharing one library file.
     */
    .then(() => q('alter table design_file_data add column if not exists side text'))
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
    // Worksheets already on file were stored before the kind existed. One statement, run at
    // load like every other late column here — it only ever touches rows nothing looks for.
    .then(() => q("update design_file_data set kind='sheet' where coalesce(kind,'other')='other' and (lower(file_name) like '%.pdf' or mime='application/pdf')"))
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
    /**
     * THE PRODUCTION WORKSHEET — the PDF a digitiser sends beside the stitch file.
     *
     * It is the design as it will sew, with the stitch count, the colour changes, the
     * thread list by brand and code, the machine and the hoop size. Wilcom prints it; so
     * does every other digitising package. When one arrives with the .DST it is a BETTER
     * artefact than anything we can render — it is the digitiser's own statement about
     * their file — and it costs nothing to show, where a TrueView costs an EWA call and
     * cannot be produced at all for a licence-locked .emb.
     *
     * It was landing in 'other', which is the bucket for things nothing looks for. Naming
     * it is the whole change; visibility is untouched, because that reads `kind === 'pes'
     * or source === 'seller'` and a worksheet is neither.
     */
    if (/\.pdf$/.test(n) || String(mime || '') === 'application/pdf') return 'sheet';
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
  /**
   * WHAT THIS ORDER'S ARTWORK HAS ALREADY BEEN DIGITISED AS — every line, in three queries.
   *
   * ONE IMPLEMENTATION, because the single-line lookup below is now a wrapper around it. The
   * matching rules here are delicate — line-first keys, files with no sku attributed only
   * when their order carries exactly one artwork, a fuzzy pass that runs only when nothing
   * matched exactly — and a second copy of them is how the two surfaces come to disagree
   * about whether we already own a file (§5).
   *
   * THREE QUERIES WHATEVER THE ORDER'S SIZE. The per-line route loaded up to 500 candidate
   * rows for its fuzzy pass; doing that once per line would be that again for every item on
   * the order. Sources come back together, exact hits are matched on `= any(hashes)`, and the
   * candidates are compared in JS — so a ten-line order costs what a one-line order costs.
   *
   * STAFF ONLY, at every caller. §6: a seller must never learn their design was used by
   * another seller, and this answer names the other order and its shop.
   */
  async function reuseForOrder(orderId) {
    /* THE SOURCE ARTWORK PER LINE, matched on all three key shapes rather than sku alone.
       A design row written by the older client stores the LINE ID in its sku column, so a
       lookup by sku alone misses it and reports nothing — indistinguishable from "no
       matches", which is why that never looked broken. Front first: a line holds a row per
       side, and "is this already digitised" is asked about the design the item is identified
       by, not whichever face was saved last. */
    const sources = await q(
      `select coalesce('L:' || i.line_id, 'S:' || i.sku) as key, d.art_hash, d.art_phash
         from order_items i
         join lateral (
           select art_hash, art_phash from order_designs d
            where d.order_id = i.order_id and d.art_hash is not null
              and ( (i.line_id is not null and d.line_id = i.line_id)
                 or (d.line_id is null and (d.sku = i.sku or d.sku = i.line_id)) )
            order by (coalesce(d.side,'front') = 'front') desc, d.updated_at desc nulls last
            limit 1
         ) d on true
        where i.order_id = $1`, [orderId]).then((r) => r.rows).catch(() => []);
    const out = {};
    if (!sources.length) return out;

    const hashes = [...new Set(sources.map((r) => r.art_hash).filter(Boolean))];
    /* Files whose ORDER LINE carried the same artwork. Excludes this order's own files —
       "you already have one here" is not reuse, it is the normal case. */
    const exactRows = await q(
      `select d.art_hash, f.design_id, f.file_name, f.kind, f.order_id, f.created_at,
              coalesce(u.store_name, u.name, u.email, '—') as seller
         from design_file_data f
         join order_designs d on d.order_id = f.order_id
           and (
             f.sku = d.sku
             /* A FILE WITH NO SKU still belongs to its order's artwork. 6 of 19 machine files
                carry none, so d.sku = f.sku dropped them and they could never be offered.
                Attributed only when that order has exactly ONE distinct artwork — with two we
                would be guessing which design the file is for, and a false positive here puts
                the wrong artwork on somebody's order. */
             or (f.sku is null and (
                   select count(distinct x.art_hash) from order_designs x
                    where x.order_id = f.order_id and x.art_hash is not null) = 1)
           )
         left join users u on u.id = f.seller_id
        where d.art_hash = any($1::text[]) and f.order_id <> $2 and f.kind in ('pes','emb')
          and f.art_hash is null
        union all
        /* AND THE FILES THAT NAME THEIR OWN ARTWORK — the factory library's, which have no
           order to join through. The art_hash-is-null test above keeps the two halves
           disjoint (and backticks stay OUT of this comment: it sits inside a JS template
           literal, and one of them ends the string mid-query),
           so a file that carries the column is offered once and through the better of the
           two links rather than twice. */
        select f.art_hash, f.design_id, f.file_name, f.kind, f.order_id, f.created_at,
               coalesce(u.store_name, u.name, u.email, '—') as seller
          from design_file_data f
          left join users u on u.id = f.seller_id
         where f.art_hash = any($1::text[])
           and coalesce(f.order_id,'') <> $2 and f.kind in ('pes','emb')
        order by created_at desc limit 200`,
      [hashes, orderId]).then((r) => r.rows).catch(() => []);
    const byHash = new Map();
    for (const r of exactRows) {
      const list = byHash.get(r.art_hash) || [];
      if (list.length < 20) list.push({ design_id: r.design_id, file_name: r.file_name, kind: r.kind,
                                        order_id: r.order_id, created_at: r.created_at, seller: r.seller });
      byHash.set(r.art_hash, list);
    }

    /* The fuzzy pass runs only for lines with no exact hit — if we already have the real
       thing, offering lookalikes is noise. Loaded once and compared per line. */
    const needFuzzy = sources.some((r) => !(byHash.get(r.art_hash) || []).length && r.art_phash);
    let cand = [];
    if (needFuzzy) {
      cand = await q(
        `select f.design_id, f.file_name, f.kind, f.order_id, f.created_at, d.art_phash,
                coalesce(u.store_name, u.name, u.email, '—') as seller
           from design_file_data f
           join order_designs d on d.order_id = f.order_id
           and (
             f.sku = d.sku
             or (f.sku is null and (
                   select count(distinct x.art_hash) from order_designs x
                    where x.order_id = f.order_id and x.art_hash is not null) = 1)
           )
           left join users u on u.id = f.seller_id
          where d.art_phash is not null and f.order_id <> $1 and f.kind in ('pes','emb')
          order by f.created_at desc limit 500`,
        [orderId]).then((r) => r.rows).catch(() => []);
    }

    for (const src of sources) {
      const exact = byHash.get(src.art_hash) || [];
      let similar = [];
      if (!exact.length && src.art_phash) {
        similar = cand
          .map((row) => ({ row, dist: phashDistance(src.art_phash, row.art_phash) }))
          .filter((x) => x.dist != null && x.dist <= PHASH_NEAR)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 10)
          .map((x) => ({ ...x.row, distance: x.dist, art_phash: undefined }));
      }
      out[src.key] = { exact, similar, hashed: true };
    }
    return out;
  }

  /**
   * EVERY LINE AT ONCE — so the answer can be SHOWN rather than waited for.
   *
   * The per-line lookup below is asked at one moment only: when staff press Send to board.
   * That is the last useful moment and not the first — by then someone has already decided
   * to spend a designer, and a file we already own should have stopped them before they got
   * there (owner, 2026-09-21: "surfaces when file is submitted, not after press send to
   * board"). This is read whenever staff open the order, so artwork a seller dropped
   * overnight is answered the moment anybody looks.
   */
  /**
   * THE FACTORY'S DESIGN LIBRARY — one row per piece of artwork we have ever had to print.
   *
   * The question it answers is the expensive one: HAVE WE DIGITISED THIS BEFORE. A design
   * briefed twice is paid for twice, and until now the only way to ask was per order, at
   * the moment somebody pressed Send to board — which is the last moment, not the first.
   *
   * KEYED ON art_hash, so the same picture ordered by six shops is ONE row and not six.
   * That is the same identity design_ids issues DSN-#### from, so the number on this page
   * is the number on the board card and in the designer.
   *
   * SOURCED FROM order_designs, NOT design_library. The seller's library is a scratch
   * gallery — it holds uploads that were never ordered, and its per-seller listing is
   * capped. This is the artwork that actually reached a line, which is the only artwork
   * the floor can be asked to make.
   *
   * STAFF ONLY, and §6 is the reason rather than a convention: the row names every seller
   * who ordered a design, and a seller must never learn theirs was used by another. There
   * is no seller-facing shape of this endpoint and there must not be one.
   */
  app.get('/api/design_files/library', { preHandler: requireAuth }, async (req, reply) => {
    /* The handler is wrapped below rather than each query catching for itself — one place
       that decides what a failure looks like, and it is never an empty list. */
    /* REFUSED EXPLICITLY, not by a middleware name. designFilesRoutes is handed requireAuth
       and nothing else, and §6 is not a convention worth hiding behind a preHandler: this
       row names every seller who ordered a design. */
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const qy = req.query || {};
    const sellerId = /^[0-9a-f-]{36}$/i.test(String(qy.seller || '')) ? String(qy.seller) : null;
    /* Free text over the design NUMBER and the artwork's name. A hash is 64 characters
       nobody types, so DSN-1042 and "route 66" are what search has to accept. */
    const term = String(qy.q || '').trim().slice(0, 80);
    const dsn = (term.match(/^\s*(?:dsn-)?(\d{3,})\s*$/i) || [])[1] || null;
    const limit = Math.min(200, Math.max(1, parseInt(qy.limit, 10) || 60));
    const offset = Math.max(0, parseInt(qy.offset, 10) || 0);
    /**
     * ONE ROW PER ARTWORK, and every aggregate computed in the same pass so the counts
     * cannot disagree with the list they describe.
     *
     * `has_file` reads BOTH links — a file that names its own artwork, and one attributed
     * through the order it was uploaded against — for the same reason reuseForOrder does.
     * A library that said "no file" about artwork the reuse panel offers a file for would
     * be worse than no library.
     */
    const rows = await q(
      `with art as (
         select d.art_hash,
                min(d.updated_at) as first_seen,
                max(d.updated_at) as last_seen,
                count(distinct d.order_id) as orders,
                /* WHICH ORDERS, not just how many. "3 orders" is the fact; the numbers are
                   what a person acts on — they are what you type into the order search to
                   go and look. node-pg hands a jsonb array straight back as JS, and the
                   client needs ref_no/seq/id to print the same EGF-###### every other
                   surface does (numOf), so the whole shape travels rather than a string
                   built here. Capped in the mapper below, not the aggregate: the count has
                   to stay the TRUE count even when the list is trimmed. */
                jsonb_agg(distinct jsonb_build_object(
                  'id', o.id, 'ref_no', o.ref_no, 'seq', o.seq)) as order_refs,
                count(distinct o.seller_id) as sellers,
                array_agg(distinct coalesce(u.store_name, u.name, u.email, '—')) as seller_names,
                max(d.name) as name
           from order_designs d
           join orders o on o.id = d.order_id
           left join users u on u.id = o.seller_id
          where d.art_hash is not null
            and ($1::uuid is null or o.seller_id = $1)
          group by d.art_hash
       )
       select a.*, i.design_no,
              /* THE FILES THEMSELVES, NOT A TICK. It answered with an EXISTS — true, and
                 nothing else — so the library could say a stitch file was on record without
                 saying WHICH, and there was no way to open the thing it was talking about.
                 (No backticks in here: this sits inside a JS template literal and one of
                 them would end the string mid-query — the same trap noted in reuseForOrder.)

                 ALL OF THEM, newest first, not just the newest one: a picture can end up
                 with a second file because the first was wrong, and a card that shows one
                 cannot be used to fix that. Capped at 6 — past that the card is a list, and
                 the answer is to delete the ones that are wrong.

                 The own flag is the half that decides what may be DELETED here: a file filed
                 against the artwork itself has no order behind it and is the library's, and
                 one attributed through an order belongs to that order — the delete route
                 refuses it, and it should not be offered.

                 The same two links the boolean read. */
              f.files,
              (f.files is not null) as has_file
         from art a
         left join design_ids i on i.art_hash = a.art_hash
         left join lateral (
           select json_agg(x) as files from (
             select f.design_id, f.file_name, f.kind, f.created_at,
                    (f.order_id is null) as own
               from design_file_data f
              where f.kind in ('pes','emb')
                and ( f.art_hash = a.art_hash
                   or exists (select 1 from order_designs d2
                               where d2.order_id = f.order_id and d2.art_hash = a.art_hash) )
              order by f.created_at desc nulls last
              limit 6
           ) x
         ) f on true
        where ($2::bigint is null or i.design_no = $2)
          and ($3::text is null or a.name ilike '%' || $3 || '%')
        /* FILES FIRST BY THEIR ABSENCE. The page exists to stop work being redone, so the
           artwork nobody has digitised yet, ordered by how many orders are waiting on it,
           is what has to be at the top. */
        order by has_file asc, a.orders desc, a.last_seen desc
        limit $4 offset $5`,
      [sellerId, dsn, dsn ? null : (term || null), limit, offset]
    /**
     * NOT SWALLOWED. `.catch(() => [])` rendered a failing query as "no artwork has ever
     * reached an order" — the exact shape CLAUDE.md names ("a swallowed error is not an
     * empty order"), and I wrote it, and it is what made the first look at this page
     * unexplainable: an empty list is a fact, and it must not also be what a broken one
     * looks like.
     */
    ).then((r) => r.rows);
    /**
     * HOW MANY DESIGN ROWS HAVE NO FINGERPRINT — the one number that explains an empty page.
     *
     * `art_hash` is computed on save, and the boot backfill only covers rows that still
     * carry inline `data`; artwork in object storage from before the column existed has
     * `storage_key` and no hash, and this listing cannot see it. An empty library is
     * therefore two different facts — "nothing has been printed" and "nothing we printed
     * has been fingerprinted yet" — and §4 forbids drawing them the same.
     */
    const unhashed = await q(
      `select count(*)::int as n from order_designs
        where art_hash is null and (data is not null or storage_key is not null)`
    ).then((r) => r.rows[0]?.n || 0).catch(() => 0);
    return {
      unhashed,
      designs: rows.map((r) => ({
        art_hash: r.art_hash,
        design_no: r.design_no == null ? null : Number(r.design_no),
        /* The picture at an address, never its bytes — a page of 60 base64 images is the
           same mistake the seller library's own listing note describes. */
        thumb: `/api/order_designs/art/${r.art_hash}`,
        name: r.name || null,
        orders: Number(r.orders) || 0,
        sellers: Number(r.sellers) || 0,
        seller_names: (r.seller_names || []).filter(Boolean),
        /* Newest first and capped: a picture on sixty orders is a scroll nobody reads, and
           the count beside it already says there are more. */
        order_refs: (r.order_refs || [])
          .filter((x) => x && x.id)
          .sort((a, b) => Number(b.ref_no || 0) - Number(a.ref_no || 0))
          .slice(0, 24),
        has_file: !!r.has_file,
        /* Named so a card can print them and a press can fetch one. `design_id` is what
           the download route takes — ART-<hash16> for a file filed against the artwork
           itself, an order's own design id for one attributed through its order. */
        files: (r.files || []).map((f) => ({
          design_id: f.design_id,
          file_name: f.file_name || null,
          kind: f.kind || null,
          created_at: f.created_at || null,
          own: !!f.own,
        })),
        first_seen: r.first_seen,
        last_seen: r.last_seen,
      })),
      /* Whether there is another page, without a second count(*) over the whole table:
         a full page is the only thing that can have one. */
      more: rows.length === limit,
    };
  });

  /** The sellers who have ordered printed artwork, for the library's filter. Staff only,
   *  same §6 reason as the listing it feeds. */
  app.get('/api/design_files/library/sellers', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'Staff only' }; }
    const r = await q(
      `select o.seller_id as id,
              coalesce(u.store_name, u.name, u.email, '—') as name,
              count(distinct d.art_hash) as designs
         from order_designs d
         join orders o on o.id = d.order_id
         left join users u on u.id = o.seller_id
        where d.art_hash is not null and o.seller_id is not null
        group by o.seller_id, u.store_name, u.name, u.email
        order by designs desc, name asc`).then((x) => x.rows).catch(() => []);
    return { sellers: r.map((x) => ({ id: x.id, name: x.name, designs: Number(x.designs) || 0 })) };
  });

  app.get('/api/orders/:id/design_reuse', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    return { lines: await reuseForOrder(String(req.params.id)) };
  });

  app.get('/api/design_files/reuse', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const orderId = String(req.query.orderId || '');
    const sku = String(req.query.sku || '');
    const lineId = req.query.lineId ? String(req.query.lineId) : null;
    /**
     * A LINE ID IS ENOUGH, and requiring a sku is what switched this off for manual orders.
     *
     * Every line on a manual order carries an empty sku — measured on EGF-002155, where both
     * lines do — so this returned 400 and the caller skipped the lookup entirely. Cross-seller
     * duplicate detection, which is the whole point, never ran on any of them. The matching
     * below has always keyed line-first; only the guard insisted on the weaker identifier.
     */
    if (!orderId || (!sku && !lineId)) { reply.code(400); return { error: 'orderId + sku or lineId required' }; }
    const all = await reuseForOrder(orderId);
    /* Line-first, then the sku shapes — the same precedence the sources query uses. */
    const hit = (lineId && all[`L:${lineId}`]) || (sku && all[`S:${sku}`]) || null;
    return hit || { exact: [], similar: [], hashed: false };
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
    /* THE LINE, when the caller has one — and on a manual order it is all they have. Same
       reason the lookup stopped insisting on a sku: every line of a manual order carries an
       empty one, so offering a reuse the factory could then not APPLY would be worse than
       not offering it. The copy lands on the line rather than on a sku that identifies
       nothing (§5: line_id is line identity). */
    const lineId = b.line_id ? String(b.line_id) : (b.lineId ? String(b.lineId) : null);
    if (!orderId || (!sku && !lineId)) { reply.code(400); return { error: 'orderId + sku or line_id required' }; }

    const src = await q('select * from design_file_data where design_id=$1', [String(req.params.designId)])
      .then((r) => r.rows[0]);
    if (!src) { reply.code(404); return { error: 'Source file not found' }; }

    const seller = await ownerOfOrder(orderId, null);
    const newId = `${src.kind === 'pes' ? 'DL' : 'EMB'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await q(
      // storage_key travels with the copy. Without it the new row points at the same object
      // through a URL the download route can no longer read, so a reused file downloads as
      // nothing while the original works.
      `insert into design_file_data (design_id, order_id, sku, line_id, seller_id, file_name, mime, data, url, storage_key, content_hash, price, kind, created_at, updated_at)
       values ($1,$2,$3,$13,$4,$5,$6,$7,$8,$12,$9,$10,$11, now(), now())`,
      [newId, orderId, sku || null, seller || null, src.file_name, src.mime, src.data, src.url, src.content_hash,
       Number(src.price) || 0, src.kind, src.storage_key || null, lineId]
    );
    // Audited so the reuse is traceable on OUR side even though it's invisible on theirs.
    audit(req, 'design_file.reused', {
      entityType: 'order', entityId: orderId,
      after: { from: String(req.params.designId), to: newId, sku: sku || null, line_id: lineId },
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
      `insert into design_file_data (design_id, order_id, sku, line_id, side, seller_id, file_name, mime, data, url, storage_key, content_hash, price, kind, source, art_hash, created_at, updated_at)
       values ($1,$2,$3,$12,$15,$4,$5,$6,$7,$8,$13,$9, coalesce($10, 0), $11, $14, $16, now(), now())
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
         -- ...and the FACE rides with it, for the same reason and with the same verbatim
         -- rule: re-filing a front logo as a file for the whole garment (side null) must not
         -- silently keep it pinned to the face it started on. A file with no line cannot
         -- have a face at all, which the caller has already resolved below.
         side=excluded.side,
         seller_id=coalesce(excluded.seller_id, design_file_data.seller_id),
         file_name=excluded.file_name, mime=excluded.mime, data=excluded.data, url=excluded.url,
         storage_key=excluded.storage_key, content_hash=excluded.content_hash,
         price=coalesce($10, design_file_data.price), kind=excluded.kind,
         /* COALESCED, not overwritten: a re-upload that does not say which artwork it is for
            must not forget the answer an earlier one gave. */
         art_hash=coalesce(excluded.art_hash, design_file_data.art_hash), updated_at=now()`,
      [String(b.designId), b.orderId || null, b.sku || null, seller || null, b.name || null, b.mime || null, data, url, b.hash || null,
       priceFor(req.user, b, defaultPrice),
       kindOf(b.name, b.mime),
       // "" and undefined both mean the whole order — only a real line id scopes a file.
       (b.lineId || b.line_id) ? String(b.lineId || b.line_id) : null,
       storageKey,
       isStaff(req.user) ? 'factory' : 'seller',
       /**
        * WHICH FACE — and only ever alongside a line, because a file that applies to the
        * whole order cannot belong to one surface of one garment.
        *
        * The CALLER decides whether to send one, and the rule it follows is worth stating
        * because getting it wrong is silent: take the selected face only when the garment
        * has more than one to choose between. A single-face line then stores null exactly
        * as it always did, so nothing about a one-sided order changes shape.
        */
       ((b.lineId || b.line_id) && b.side)
         ? String(b.side).trim().toLowerCase().slice(0, 24) || null
         : null,
       /**
        * $16 — WHICH ARTWORK, when the caller knows. The factory library sends it because it
        * has no order to infer from; an ordinary per-order upload sends nothing and keeps
        * resolving through the join, exactly as before.
        *
        * Validated rather than trusted: this is the key reuse matches on, and a caller that
        * sent the wrong shape would attach a file to nothing in a way that looks like "no
        * matches found".
        */
       /^[0-9a-f]{64}$/.test(String(b.artHash || '').toLowerCase())
         ? String(b.artHash).toLowerCase()
         : null]);
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
     * FILED AGAINST ARTWORK WITH NO ORDER BEHIND IT — the Design Lab › Files upload. It goes
     * straight onto every order line carrying that exact artwork and waiting for a stitch
     * file. See applyToWaitingLines for why an exact hash attaches where a lookalike only
     * ever suggests, and for what it refuses to touch.
     *
     * Only when there is no `orderId`: an upload made ON an order is already where it
     * belongs, and fanning it out from there would put one line's file onto every other
     * order that happens to share the picture, which is a much larger claim than the person
     * dropping a file on one line was making.
     */
    let attached = [];
    if (!b.orderId && b.artHash) {
      attached = await applyToWaitingLines(String(b.designId), String(b.artHash).toLowerCase(), req.user)
        .catch(() => []);
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
    /* SAY WHERE IT WENT. The card that uploaded it can then report "on 3 orders" rather
       than leaving a person to go and check — and a zero here is the honest answer that
       nothing was waiting on this picture, which is different from nothing happening. */
    return { ok: true, stored: url ? 'object-storage' : 'inline', attached: attached.length, orders: attached };
  });

  // Remove a file from an order. Staff-only: a machine file is a factory artefact, and a
  // seller must not be able to delete a working file. The Design readiness tag reverts on
  // its own once the file is gone (it reads has_machine_file), and the two lines below make
  // that live — egBroadcast wakes the boards to re-read, audit leaves a 'Machine file
  // removed' row in the tag's history so a file appearing then vanishing is explained, not
  // a mystery. No ledger touch: removing the record is not a refund (charge/refund ride the
  // wallet on purchase/cancel, not on a staff file cleanup).
  /**
   * REMOVE A FILE FROM A LINE — the same zones the ARTWORK delete already uses, not a
   * stricter rule of its own.
   *
   * This was `staff only`, and between the two of them nobody could remove a file from an
   * unsubmitted order at all: a seller failed the staff test, and staff are locked OUT of a
   * pre-submit order by the zone rule (DELETE /api/orders/:id/designs) because it is still
   * the seller's draft. So the ✕ was absent on the one file people most often want to swap
   * — the .EMB they just uploaded by mistake — and the answer was to delete the order.
   *
   * The zones, verbatim from the artwork route so the two cannot drift:
   *   before submit  the order is the SELLER's — they may change their own files; staff
   *                  keep their hands off, admin excepted
   *   after submit   it is in production — the FACTORY's, and the seller asks in chat
   *   admin          the escape hatch, as everywhere else here
   *
   * A file with no order (the design library) has no owner to check against and stays
   * staff-only.
   *
   * WHAT IT DOES NOT DO: it does not touch design_charged_at or reverse a charge. If a check
   * fee was billed, a person opened that file and looked at it; deleting it afterwards does
   * not give the time back. Same rule, and the same sentence, as the artwork route.
   */
  app.delete('/api/design_files/:designId', { preHandler: requireAuth }, async (req, reply) => {
    const designId = String(req.params.designId || '');
    const row = await q('select order_id, sku, file_name, kind from design_file_data where design_id=$1', [designId]).then((r) => r.rows[0]);
    if (!row) { reply.code(404); return { error: 'File not found.' }; }
    const staff = isStaff(req.user);
    const admin = !!req.user && req.user.role === 'admin';
    if (!row.order_id) {
      if (!staff) { reply.code(403); return { error: 'staff only' }; }
    } else if (!admin) {
      // OWNERSHIP FIRST, so a seller can never reach another seller's file by id.
      if (!staff) {
        const mine = await ownerOfOrder(row.order_id, null);
        const me = await effectiveSeller(req.user);
        if (!mine || !me || String(mine) !== String(me)) { reply.code(403); return { error: 'forbidden' }; }
      }
      const ord = (await q('select factory_status from orders where id=$1', [row.order_id])).rows[0];
      const preSubmit = ['', 'new', 'draft'].includes(String((ord && ord.factory_status) || ''));
      if (staff ? preSubmit : !preSubmit) {
        reply.code(409);
        return { error: staff
          ? 'This order is still with the seller — their files are theirs to change until it is submitted.'
          : 'This order is in production, so its files are settled. Ask us to change them.' };
      }
    }
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
    if (!canPrice(req.user)) { reply.code(403); return { error: 'Only an admin can set a file price' }; }
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
      /* `side` travels with the row. The column has existed since per-side artwork did; it was
   simply never selected, so no client could tell a front logo from a back design and the
   Files panel asserted "every face" about both. */
      'select design_id, order_id, sku, line_id, side, seller_id, file_name, mime, price, kind, source, created_at from design_file_data where order_id=$1 order by created_at',
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
        designId: x.design_id, sku: x.sku, lineId: x.line_id, side: x.side ?? null, name: x.file_name, mime: x.mime, kind: x.kind,
        source: x.source || 'factory',
        price: Number(x.price) || 0, created_at: x.created_at,
        // Their own upload is not a purchase. `paid` drives the button, and a file they
        // sent us must never be offered back to them with a price on it.
        paid: x.source === 'seller' || (Number(x.price) || 0) <= 0 || (await isPaid(x, eff)),
      })));
    }
    // Staff (every factory board) see every file on the order.
    return r.rows.map((x) => ({ designId: x.design_id, sku: x.sku, lineId: x.line_id, side: x.side ?? null, name: x.file_name, mime: x.mime, kind: x.kind, source: x.source || "factory", price: Number(x.price) || 0, created_at: x.created_at, paid: true, canPrice: canPrice(req.user) }));
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
    /**
     * THE RUNG UNDER THE LINE — which FACE, when the garment prints on more than one.
     *
     * The column has existed since per-side artwork did ("NULL means the whole line"), and
     * nothing could ever set it: this route moved a file between the order and a line and
     * stopped there. So a front logo and a back design were one undifferentiated list, and
     * the Files panel said "every face" about both — an assertion the data never made.
     *
     * Three answers, the same three `method` and `template_id` already use: absent keeps
     * what is recorded, null pins the file to the whole LINE, a value pins it to one face.
     * A file widened to the whole ORDER cannot belong to a face, so that combination clears
     * the side rather than storing a contradiction.
     */
    const sideSpoken = b.side !== undefined;
    const side = lineId ? (String(b.side || '').trim().toLowerCase().slice(0, 24) || null) : null;
    await q(
      `update design_file_data
          set line_id=$2,
              side=(case when $4 or $2::text is null then $3 else side end),
              updated_at=now()
        where design_id=$1`,
      [id, lineId, side, sideSpoken]);
    audit(req, 'design_file.scoped', {
      entityType: 'order', entityId: String(row.order_id || ''),
      after: { design_id: id, line_id: lineId, sku: row.sku || null, ...(sideSpoken ? { side } : {}) },
    });
    egBroadcast({ type: 'design-file', orderId: row.order_id || null });
    return { ok: true, lineId, ...(sideSpoken ? { side } : {}) };
  });

  // Download a machine file. Staff any; a seller only their own AND only once paid.
  app.get('/api/design_files/:designId', { preHandler: requireAuth }, async (req, reply) => {
    const r = await q('select design_id, order_id, sku, seller_id, file_name, mime, data, url, storage_key, price, kind, source from design_file_data where design_id=$1', [String(req.params.designId)]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (!isStaff(req.user)) {
      const eff = await effectiveSeller(req.user);
      if (row.seller_id && row.seller_id !== eff) { reply.code(403); return { error: 'forbidden' }; }
      /**
       * A SELLER MAY ALWAYS TAKE BACK WHAT THEY SENT.
       *
       * The two guards below exist to protect OUR work: a factory working file is not a
       * deliverable, and a digitised .pes is paid for before it is handed over. Neither
       * describes a file the seller uploaded themselves — they already have it, they gave
       * it to us, and charging them to fetch their own artwork back would be absurd.
       *
       * `source === 'seller'` is the same flag the listing route already trusts for exactly
       * this (it reports those rows as `paid`), so this is closing a gap between the two
       * rather than opening the paywall: the seller-ID check above still stands, so this
       * only ever returns a file to the account that sent it.
       */
      const isOwnUpload = row.source === 'seller';
      if (!isOwnUpload) {
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
