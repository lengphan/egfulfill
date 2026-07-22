// USPS SCAN forms, via Shippo manifests.
//
// A SCAN form is a single barcoded page covering many parcels: the carrier scans it once
// and every tracking number on it gets an acceptance event, instead of scanning each
// parcel individually.
//
// WHAT THIS ROUTE DOES AND DOESN'T ASSERT
//
// Creating a manifest produces a DOCUMENT. It is not a scan. The acceptance event happens
// later, when a USPS clerk or driver actually scans the form as they take the parcels —
// which may be hours later, or never, if the pile doesn't go out.
//
// So this sets manifested_at and nothing else. It deliberately does NOT set
// label_scanned_at, because that would be us making the carrier's claim on their behalf,
// and the whole point of the readiness tags is that they only say what someone actually
// did. label_scanned_at is filled in by the tracking path in shipping.js when the carrier
// reports the parcel moving — see refreshTracking. Of the three scan routes, this is the
// only one where "scanned" means the carrier said so.
//
// Endpoints:
//   POST /api/manifests          {orderIds, shipmentDate?} → create SCAN form(s)
//   GET  /api/manifests          → history
//   GET  /api/manifests/:id      → one manifest
import { q } from '../db.js';
import { readShipFrom } from './factory_settings.js';
import { audit } from '../audit.js';
import { egBroadcast } from '../events.js';

const SH_BASE = 'https://api.goshippo.com';
// Read at call time, not import time — a token pasted into Settings applies to the next
// request rather than the next redeploy.
const shToken = () => (process.env.SHIPPO_API_TOKEN || '').trim();
const shAuth = () => 'ShippoToken ' + shToken();

// USPS caps one SCAN form at 500 shipments. Past that Shippo issues multiple manifests,
// but chunking here keeps one manifest = one PDF = one row, so nothing is half-recorded.
const MAX_PER_MANIFEST = 500;

/** Poll a QUEUED manifest until it resolves. Creation is async: the POST returns
 *  immediately with no PDF, and the document appears seconds later. */
async function waitForManifest(id, tries = 12) {
  for (let i = 0; i < tries; i++) {
    // Back off gently — a tight loop against their API buys nothing and risks a 429.
    await new Promise((r) => setTimeout(r, i === 0 ? 800 : 1500));
    const r = await fetch(SH_BASE + '/manifests/' + encodeURIComponent(id), { headers: { Authorization: shAuth() } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) continue;
    if (d.status === 'SUCCESS' || d.status === 'ERROR') return d;
  }
  // Not a failure: the manifest exists and is still processing. The caller records it as
  // QUEUED and the PDF is fetched on next read, rather than throwing away a form that
  // USPS may already consider issued.
  return null;
}

const pdfOf = (d) => (d && ((d.documents && d.documents[0]) || d.manifest_url)) || null;

export function manifestRoutes(app, requireWarehouse) {
  q(`create table if not exists manifests (
       id text primary key,
       created_at timestamptz not null default now(),
       created_by text,
       carrier_account text,
       shipment_date date,
       status text,
       pdf_url text,
       order_ids text[] not null default '{}'
     )`).catch(() => {});
  // Owned by this feature but written by the label path in usps.js, so both create them.
  q('alter table orders add column if not exists label_provider text').catch(() => {});
  q('alter table orders add column if not exists label_ref text').catch(() => {});
  q('alter table orders add column if not exists label_carrier_account text').catch(() => {});
  q('alter table orders add column if not exists manifested_at timestamptz').catch(() => {});
  q('alter table orders add column if not exists manifest_id text').catch(() => {});

  /**
   * Which of these orders can go on a SCAN form, and why the rest can't.
   *
   * Returned as reasons per order rather than a filtered list. "3 of 8 are eligible" with
   * no explanation is the kind of message that gets clicked past, and the reasons here are
   * all actionable — buy a label, wait for the carrier, or nothing, it's already on one.
   */
  app.post('/api/manifests/preview', { preHandler: requireWarehouse }, async (req, reply) => {
    const ids = (req.body && req.body.orderIds) || [];
    if (!Array.isArray(ids) || !ids.length) { reply.code(400); return { error: 'Select at least one order.' }; }
    const { groups, skipped } = await plan(ids);
    return {
      groups: groups.map((g) => ({
        carrierAccount: g.carrierAccount,
        count: g.orders.length,
        orders: g.orders.map((o) => ({ id: o.id, num: o.seq ? '#' + o.seq : o.id, tracking: o.tracking })),
      })),
      skipped,
    };
  });

  /** Shared eligibility + grouping, so the preview and the real thing can never disagree. */
  async function plan(ids) {
    const rows = (await q(
      `select id, seq, tracking, carrier, label_provider, label_ref, label_carrier_account,
              manifested_at, manifest_id, label_scanned_at
         from orders where id = any($1::text[])`, [ids.map(String)]
    ).catch(() => ({ rows: [] }))).rows;

    const eligible = [];
    const skipped = [];
    for (const o of rows) {
      const num = o.seq ? '#' + o.seq : o.id;
      if (!o.tracking) { skipped.push({ id: o.id, num, reason: 'No label bought yet — there is nothing to manifest.' }); continue; }
      if (o.manifested_at) { skipped.push({ id: o.id, num, reason: 'Already on a SCAN form. A label cannot appear on two.' }); continue; }
      if (o.label_scanned_at) { skipped.push({ id: o.id, num, reason: 'Already scanned — a SCAN form would add nothing.' }); continue; }
      if (o.label_provider && o.label_provider !== 'shippo') {
        skipped.push({ id: o.id, num, reason: `Bought through ${o.label_provider}, which has no SCAN form in this integration.` }); continue;
      }
      // A Shippo label always has a carrier account, but one bought before that column
      // existed has label_ref and no account. Grouping those under '' would POST an empty
      // carrier_account and come back as an opaque Shippo validation error naming a field
      // nobody here chose — so they're refused up front, with the actual reason.
      if (o.label_ref && !o.label_carrier_account) {
        skipped.push({ id: o.id, num, reason: 'We have this label\'s reference but not the carrier account it was bought under, which a SCAN form requires. Labels bought from now on record both.' });
        continue;
      }
      if (!o.label_ref) {
        // The honest version of this. These are labels bought before the reference was
        // persisted; saying "not eligible" would read as a rule rather than a gap.
        skipped.push({ id: o.id, num, reason: 'This label was bought before we started recording its Shippo reference, so it cannot be manifested. Newer labels can.' });
        continue;
      }
      eligible.push(o);
    }

    // One manifest per carrier account: Shippo requires every transaction in a manifest to
    // share address_from, shipment_date and carrier_account. Ship-from is a single
    // configured warehouse today, and shipment_date is chosen per request, so the carrier
    // account is the only axis that can actually vary within one call.
    const byAccount = new Map();
    for (const o of eligible) {
      const k = o.label_carrier_account || '';
      if (!byAccount.has(k)) byAccount.set(k, []);
      byAccount.get(k).push(o);
    }
    const groups = [];
    for (const [account, list] of byAccount.entries()) {
      for (let i = 0; i < list.length; i += MAX_PER_MANIFEST) {
        groups.push({ carrierAccount: account, orders: list.slice(i, i + MAX_PER_MANIFEST) });
      }
    }
    return { groups, skipped };
  }

  /**
   * Create the SCAN form(s).
   *
   * Warehouse-and-above: this commits labels to a form they can never be moved off, and
   * the pile it describes is a physical handover. An operator's zone ends before that.
   */
  app.post('/api/manifests', { preHandler: requireWarehouse }, async (req, reply) => {
    if (!shToken()) { reply.code(400); return { error: 'Shippo is not configured, so no SCAN form can be created.' }; }
    const body = req.body || {};
    const ids = body.orderIds || [];
    if (!Array.isArray(ids) || !ids.length) { reply.code(400); return { error: 'Select at least one order.' }; }

    // The date the parcels are handed over. Defaults to today; a form dated for a day the
    // pile doesn't actually go out is one USPS can refuse at the counter.
    const shipDate = String(body.shipmentDate || '').trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shipDate)) { reply.code(400); return { error: 'Ship date must be YYYY-MM-DD.' }; }

    const from = (await readShipFrom().catch(() => null)) || {};
    if (!from.street1 && !from.street) { reply.code(400); return { error: 'Set the warehouse ship-from address first — USPS requires it on a SCAN form.' }; }
    const addressFrom = {
      name: from.name || '', company: from.company || '',
      street1: from.street1 || from.street || '', street2: from.street2 || '',
      city: from.city || '', state: from.state || '', zip: from.zip || '', country: from.country || 'US',
      phone: from.phone || process.env.SHIP_FROM_PHONE || '5555555555',
      email: from.email || process.env.SHIP_FROM_EMAIL || 'fulfillment@egful.store',
    };

    const { groups, skipped } = await plan(ids);
    if (!groups.length) { reply.code(400); return { error: 'None of the selected orders can go on a SCAN form.', skipped }; }

    const made = [];
    const failed = [];
    for (const g of groups) {
      const payload = {
        carrier_account: g.carrierAccount,
        shipment_date: shipDate + 'T00:00:00Z',
        address_from: addressFrom,
        transactions: g.orders.map((o) => o.label_ref),
        async: false,
      };
      let d;
      try {
        const r = await fetch(SH_BASE + '/manifests/', {
          method: 'POST', headers: { Authorization: shAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        d = await r.json().catch(() => ({}));
        if (!r.ok || !d.object_id) {
          const msg = (d && (d.detail || (d.messages && d.messages.map((m) => m.text).join('; ')))) || ('Shippo HTTP ' + r.status);
          failed.push({ carrierAccount: g.carrierAccount, count: g.orders.length, error: String(msg).slice(0, 300) });
          continue;
        }
      } catch (e) {
        failed.push({ carrierAccount: g.carrierAccount, count: g.orders.length, error: e.message });
        continue;
      }

      // The form exists from here on. Everything below is bookkeeping, and a failure in it
      // must not lose the fact that these labels are now committed to a manifest —
      // Shippo will refuse to put them on a second one, and without a local record they'd
      // look manifestable forever while every retry failed.
      const settled = d.status === 'SUCCESS' ? d : (await waitForManifest(d.object_id).catch(() => null)) || d;
      const orderIds = g.orders.map((o) => String(o.id));

      await q(
        `insert into manifests (id, created_by, carrier_account, shipment_date, status, pdf_url, order_ids)
         values ($1,$2,$3,$4::date,$5,$6,$7::text[])
         on conflict (id) do update set status=excluded.status, pdf_url=coalesce(excluded.pdf_url, manifests.pdf_url)`,
        [d.object_id, String((req.user && req.user.sub) || ''), g.carrierAccount || null, shipDate,
         settled.status || 'QUEUED', pdfOf(settled), orderIds]
      ).catch(() => {});

      // manifested_at only. Not label_scanned_at — see the note at the top of this file.
      await q(
        `update orders set manifested_at = now(), manifest_id = $1 where id = any($2::text[]) and manifested_at is null`,
        [d.object_id, orderIds]
      ).catch(() => {});

      for (const id of orderIds) {
        audit(req, 'order.manifested', { entityType: 'order', entityId: id, after: { manifest: d.object_id, shipDate } });
      }
      made.push({ id: d.object_id, status: settled.status || 'QUEUED', pdf: pdfOf(settled), count: orderIds.length, carrierAccount: g.carrierAccount });
    }

    if (made.length) egBroadcast({ type: 'orders' });
    if (!made.length) { reply.code(502); return { error: failed[0] ? failed[0].error : 'Shippo did not create the SCAN form.', failed, skipped }; }
    return { ok: true, manifests: made, failed, skipped };
  });

  /** History. Newest first — a SCAN form is looked up on the day it was made, or the day
   *  someone asks where a parcel went. */
  app.get('/api/manifests', { preHandler: requireWarehouse }, async (req) => {
    const rows = (await q(
      `select m.*, coalesce(array_length(m.order_ids, 1), 0) as count,
              (select u.name from users u where u.id::text = m.created_by) as created_by_name
         from manifests m order by m.created_at desc limit 200`
    ).catch(() => ({ rows: [] }))).rows;
    return rows.map((m) => ({
      id: m.id, createdAt: m.created_at, createdBy: m.created_by_name || null,
      shipmentDate: m.shipment_date, status: m.status, pdf: m.pdf_url,
      count: m.count, orderIds: m.order_ids || [],
    }));
  });

  /**
   * One manifest. Re-reads Shippo when the PDF isn't in hand yet: creation is async, so a
   * form recorded as QUEUED usually has its document a few seconds later, and without this
   * the row would say QUEUED forever with no way to reach the page you need to print.
   */
  app.get('/api/manifests/:id', { preHandler: requireWarehouse }, async (req, reply) => {
    const id = String(req.params.id);
    const row = (await q('select * from manifests where id=$1', [id]).catch(() => ({ rows: [] }))).rows[0];
    if (!row) { reply.code(404); return { error: 'No such SCAN form.' }; }
    let status = row.status, pdf = row.pdf_url;
    if (!pdf && shToken()) {
      const r = await fetch(SH_BASE + '/manifests/' + encodeURIComponent(id), { headers: { Authorization: shAuth() } })
        .then((x) => x.json()).catch(() => null);
      if (r && r.object_id) {
        status = r.status || status; pdf = pdfOf(r) || pdf;
        await q('update manifests set status=$1, pdf_url=coalesce($2, pdf_url) where id=$3', [status, pdf, id]).catch(() => {});
      }
    }
    const orders = (await q(
      `select id, seq, tracking, label_scanned_at, delivery_status from orders where id = any($1::text[]) order by seq`,
      [row.order_ids || []]
    ).catch(() => ({ rows: [] }))).rows;
    return {
      id: row.id, createdAt: row.created_at, shipmentDate: row.shipment_date, status, pdf,
      count: (row.order_ids || []).length,
      orders: orders.map((o) => ({
        id: o.id, num: o.seq ? '#' + o.seq : o.id, tracking: o.tracking,
        // The honest per-parcel state: on the form vs actually accepted by the carrier.
        accepted: !!o.label_scanned_at, acceptedAt: o.label_scanned_at, delivery: o.delivery_status,
      })),
    };
  });
}
