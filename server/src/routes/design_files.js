// Machine deliverable files (.pes/.emb/.dst/.exp/.jef/.vp3) stored SERVER-SIDE — the raw bytes the
// client used to keep only in localStorage (eg_design_files), which vanished on a cache clear and
// never reached another device. Bytes are stored inline as a base64 data-URL string, keyed by the
// design id (DL-…/DSN-…). Access-controlled: staff any; a seller only their OWN files (seller_id,
// resolved from the order the design belongs to; a seller's active team member counts as the owner).
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { storageEnabled, putObject, fromDataUrl } from '../storage.js';
import { notify } from './notifications.js';

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
  const canPrice = (u) => !!u && (u.role === 'admin' || u.role === 'warehouse');

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
  app.post('/api/design_files', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    if (!b.designId || !b.data) { reply.code(400); return { error: 'designId + data required' }; }
    const seller = await ownerOfOrder(b.orderId, req.user.sub);
    // A non-staff caller may only write under their OWN order/design.
    if (!isStaff(req.user) && seller && seller !== (await effectiveSeller(req.user))) { reply.code(403); return { error: 'forbidden' }; }
    // Prefer object storage (Spaces/S3) — keep the big base64 OUT of Postgres. Falls back to inline.
    let data = String(b.data), url = null;
    if (storageEnabled()) {
      try {
        const parsed = fromDataUrl(data);
        const ext = (String(b.name || '').match(/\.[a-z0-9]+$/i) || [''])[0] || '';
        url = await putObject('design-files/' + encodeURIComponent(String(b.designId)) + ext, parsed.buffer, b.mime || parsed.mime);
        data = null;
      } catch (e) { /* storage failed → keep inline */ }
    }
    await q(
      `insert into design_file_data (design_id, order_id, sku, seller_id, file_name, mime, data, url, content_hash, price, kind, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, coalesce($10, 0), $11, now(), now())
       on conflict (design_id) do update set
         order_id=coalesce(excluded.order_id, design_file_data.order_id),
         sku=coalesce(excluded.sku, design_file_data.sku),
         seller_id=coalesce(excluded.seller_id, design_file_data.seller_id),
         file_name=excluded.file_name, mime=excluded.mime, data=excluded.data, url=excluded.url,
         content_hash=excluded.content_hash,
         price=coalesce($10, design_file_data.price), kind=excluded.kind, updated_at=now()`,
      [String(b.designId), b.orderId || null, b.sku || null, seller || null, b.name || null, b.mime || null, data, url, b.hash || null,
       (canPrice(req.user) && b.price != null) ? Math.max(0, Number(b.price) || 0) : null,
       kindOf(b.name, b.mime)]);
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
    return { paid: price <= 0 || (await isPaid(row, eff)), price, name: row.file_name };
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
      'select design_id, order_id, sku, seller_id, file_name, mime, price, kind, created_at from design_file_data where order_id=$1 order by created_at',
      [orderId]
    );
    if (!isStaff(req.user)) {
      const eff = await effectiveSeller(req.user);
      // Sellers get their .pes deliverable only. Factory working files (.emb) and
      // internal mockups stay on the factory boards.
      const mine = r.rows.filter((x) => (!x.seller_id || x.seller_id === eff) && x.kind === 'pes');
      if (r.rows.length && !mine.length) { reply.code(403); return { error: 'forbidden' }; }
      // Tell the seller what's unlocked without handing over any bytes.
      return Promise.all(mine.map(async (x) => ({
        designId: x.design_id, sku: x.sku, name: x.file_name, mime: x.mime, kind: x.kind,
        price: Number(x.price) || 0, created_at: x.created_at,
        paid: (Number(x.price) || 0) <= 0 || (await isPaid(x, eff)),
      })));
    }
    // Staff (every factory board) see every file on the order.
    return r.rows.map((x) => ({ designId: x.design_id, sku: x.sku, name: x.file_name, mime: x.mime, kind: x.kind, price: Number(x.price) || 0, created_at: x.created_at, paid: true, canPrice: canPrice(req.user) }));
  });

  // Download a machine file. Staff any; a seller only their own AND only once paid.
  app.get('/api/design_files/:designId', { preHandler: requireAuth }, async (req, reply) => {
    const r = await q('select design_id, order_id, sku, seller_id, file_name, mime, data, url, price, kind from design_file_data where design_id=$1', [String(req.params.designId)]);
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
    // data = the download source (inline base64 data-URL OR the object-storage URL — both work as an <a download> href).
    return { designId: row.design_id, orderId: row.order_id, sku: row.sku, name: row.file_name, mime: row.mime, data: row.data || row.url, url: row.url };
  });
}
