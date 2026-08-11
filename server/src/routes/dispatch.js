// Dispatch partner (byeastside) — label PRE-SCAN.
// -----------------------------------------------------------------------------
// We buy postage ourselves (Shippo/EasyPost/USPS) and already hold the tracking number
// and the label PDF. This partner does the physical pick: we send them the label, their
// floor scans it, and the scan is what starts the buyer's tracking clock.
//
// Their API takes a PDF FILE upload (not a URL — the opposite of the design partner) and
// extracts one tracking label per page:
//   POST /customer/pdfs/upload      multipart file      -> { id, status: PENDING }
//   GET  /customer/pdfs/:id                             -> { status, totalLabels, scannedLabels }
//   GET  /customer/pdfs/:id/labels                      -> [{ trackingNumber, status: NEW|PICKED, pickedAt }]
//   DELETE /customer/pdfs/:id                           -> 409 once scanned/completed
//
// The TRACKING NUMBER is the join key: it's printed on the label they scan and already
// stored on our order, so nothing else has to cross the boundary.
//
// A pre-scan sets orders.label_scanned_at — NOT factory_status. Pre-scanning starts the
// clock while the parcel may still be in production; those are independent facts and one
// stage field can't hold both. See the column comment in orders.js.
//
// Dormant until BYEASTSIDE_API_KEY is set: every route answers honestly and nothing
// throws, exactly like the storage and mail integrations.
import { q, softQ } from '../db.js';
import { isStaff } from '../auth.js';
import { audit } from '../audit.js';
import { refundOrder } from './order_refunds.js';
import { aggregatorRefundLabel, aggregatorFetchCost } from './shipping.js';

/**
 * Undo the money booked by a successful push, when a label is cancelled BEFORE it's picked.
 * billExpedite() books two things; a cancel must reverse both, or the seller stays charged
 * and the byeastside cost stands for a pick that never happened.
 *
 *   1. byeastside cost — a "per-label PICK fee" (costs.js). Cancel only ever runs on an
 *      un-scanned label (the handler guards on label_scanned_at / their 409), so the pick
 *      never happened and the cost never really occurred. Book a compensating credit with a
 *      NEW ref (`expedite-cancel-…`) so it dedupes on retry via the (account,type,ref) index.
 *   2. seller's expedite fee — refunded through the canonical refundOrder(), so the per-part
 *      cap and idempotency are the SAME ones the manual refund UI uses (no double-pay if a
 *      human already refunded it, no double-pay on a re-cancel).
 *
 * Best-effort throughout: a missing accounting row is a report blemish, never a reason to
 * fail a cancel the partner already accepted.
 */
async function reverseExpediteOnCancel(order, by) {
  const out = { costReversed: 0, feeRefunded: 0 };
  try {
    const orig = await q(
      "select delta from wallet_ledger where account='factory' and type='expedite-cost' and ref=$1",
      [`expedite-${order.id}`]);
    const paid = orig.rows[0] ? -Number(orig.rows[0].delta) : 0;   // stored as a negative delta
    if (paid > 0) {
      await q(
        `insert into wallet_ledger (account, delta, type, ref, note, order_id)
         values ('factory', $1, 'expedite-cost', $2, $3, $4) on conflict do nothing`,
        [paid, `expedite-cancel-${order.id}`,
         `Dispatch cancelled — byeastside label pulled back before pick · order ${order.id}`, order.id]);
      out.costReversed = paid;
    }
  } catch { /* leave costReversed 0 */ }
  if (order.seller_id) {
    try {
      const res = await refundOrder({ orderId: order.id, select: ['expedite'], full: true,
        note: `Expedited Shipping cancelled · order ${order.id}`, by, clientId: `expedite-cancel-${order.id}` });
      if (res && res.ok) out.feeRefunded = res.refunded || 0;
    } catch { /* leave feeRefunded 0 */ }
  }
  return out;
}
import { egBroadcast } from '../events.js';
import { moveFunds, balanceOf } from './wallet.js';
import { readAll as readSettings } from './factory_settings.js';
import { recordCost } from '../costs.js';

// Read at CALL time, not module load: the key can be set from Settings › Integrations
// (secrets.js overlays app_secrets onto process.env), and a module-load capture would
// keep using the old value until someone restarted the API — which defeats storing it in
// the DB in the first place.
const apiKey = () => (process.env.BYEASTSIDE_API_KEY || '').trim();
const apiBase = () => (process.env.BYEASTSIDE_API_BASE || 'https://api.byeastside.uk/api').replace(/\/+$/, '');
const MAX_PDF = 50 * 1024 * 1024;   // their documented limit

export function dispatchEnabled() { return !!apiKey(); }

async function bes(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(apiBase() + path, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey()}`, ...(init.headers || {}) },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    // Network/timeout — retryable, and the caller must be able to tell that from a 4xx.
    return { ok: false, status: 0, data: null, error: e.message };
  } finally { clearTimeout(timer); }
}

/**
 * Is this failure worth retrying?
 *
 * They publish no error codes, so HTTP semantics are all we have — which is still enough
 * to avoid flagging an order because their box hiccuped. 5xx/429/network are transient;
 * a 4xx means they rejected the request itself and sending it again changes nothing.
 */
const isRetryable = (r) => r.status === 0 || r.status === 429 || r.status >= 500;

// Recover label fees missing from the Price column. Labels bought before buy-time cost
// capture landed (Shippo returns the rate as a bare id, so `cost` came back null) show an
// empty Price even though the carrier billed them — the number sits on the provider's
// dashboard. This reads the real billed amount off the transaction, writes it to the order
// and books it to the ledger. Idempotent on `ref`, so a re-run or a since-fixed row is a
// no-op. Only touches rows with a stored provider reference (nothing else is recoverable).
//
// Runs automatically when the shipments list is read — no button, no manual step. A
// module-level lock stops overlapping loads from firing duplicate provider calls, and the
// candidate query is cheap and returns nothing once everything is recovered, so a page that
// has no gaps does one throwaway SELECT and no provider calls.
let _feeBackfillRunning = false;
async function recoverLabelCosts(limit = 200) {
  if (_feeBackfillRunning) return { skipped: true, updated: 0 };
  _feeBackfillRunning = true;
  try {
    const rows = (await q(
      `select o.id, o.label_provider, o.label_ref
         from orders o
        where coalesce(o.tracking,'') <> '' and coalesce(o.label_ref,'') <> ''
          and o.label_cost is null
          and not exists (select 1 from wallet_ledger w where w.type='label-cost' and w.ref='label-'||o.id)
        order by coalesce(o.label_scanned_at, o.created_at) desc
        limit $1`, [limit]).catch(() => ({ rows: [] }))).rows;
    let updated = 0, failed = 0;
    for (const o of rows) {
      const got = await aggregatorFetchCost(o.label_provider, o.label_ref).catch(() => null);
      if (!got || !isFinite(Number(got.cost)) || Number(got.cost) <= 0) { failed++; continue; }
      await q(`update orders set label_cost=$1, ship_service=coalesce(nullif(ship_service,''), nullif($2,'')) where id=$3`,
        [Number(got.cost), got.service || '', o.id]).catch(() => {});
      await recordCost('label', Number(got.cost), `label-${o.id}`, `Postage · ${got.carrier || 'carrier'} · order ${o.id} (backfilled)`, { orderId: o.id });
      updated++;
    }
    return { scanned: rows.length, updated, failed };
  } finally {
    _feeBackfillRunning = false;
  }
}

export function dispatchRoutes(app, requireAuth, requireWarehouse) {
  // Their PDF id + when we pushed. On the ORDER rather than a join table: we upload one
  // label per PDF, so the relationship is 1:1 and a table would add joins for nothing.
  q('alter table orders add column if not exists dispatch_pdf_id text').catch(() => {});
  // Was this label bought against a TEST key? Recorded rather than inferred, because the
  // only moment it is knowable is the buy response — afterwards a test label looks exactly
  // like a real one: real-shaped tracking, a real PDF, a real-looking price, and no charge.
  // Null means "bought before we asked", which is not the same as false.
  q('alter table orders add column if not exists label_test boolean').catch(() => {});
  q('alter table orders add column if not exists dispatch_pushed_at timestamptz').catch(() => {});
  q('alter table orders add column if not exists dispatch_error text').catch(() => {});
  // Scan provenance — who scanned a label out and via which channel (in-house / partner /
  // carrier). These are WRITTEN by the scan endpoints below and READ by /api/shipments,
  // but nothing ever created them: not schema.sql, not an ALTER. On any live DB the column
  // was absent, so `o.scanned_via` in the Shipments SELECT threw, softQ swallowed it, and
  // the page came back EMPTY however many labels had been bought — the label was recorded
  // on the order, the list just couldn't be read. The comment at the in-house scan endpoint
  // already assumed these ALTERs existed; now they do.
  q('alter table orders add column if not exists scanned_by text').catch(() => {});
  q('alter table orders add column if not exists scanned_via text').catch(() => {});

  /**
   * Bill the expedited dispatch, both sides.
   *
   *   seller  → factory   expedite_fee   (what the seller pays)
   *   factory → partner   expedite_cost  (what byeastside invoices us)
   *
   * Recording BOTH leaves the real margin in the ledger instead of implied by a fixed
   * sell price — the sell price is set once in Settings while the supplier cost can
   * move, which is exactly where margin erodes without anyone noticing.
   *
   * Idempotent on the order id, so a double-click, a retry or an overlapping batch bills
   * once. Money is never a reason to block a parcel: if the wallet is short we still
   * dispatch and record what's owed, because holding a physical parcel over $2 costs the
   * seller a marketplace deadline.
   */
  async function billExpedite(order) {
    const cfg = await readSettings().catch(() => ({}));
    const fee = Number(cfg.expedite_fee ?? 2) || 0;
    const cost = Number(cfg.expedite_cost ?? 0.5) || 0;
    const ref = `expedite-${order.id}`;
    const out = { fee, cost, charged: false, owed: 0 };
    if (fee > 0 && order.seller_id) {
      const bal = await balanceOf(order.seller_id).catch(() => 0);
      if (bal >= fee) {
        await moveFunds({ from: order.seller_id, to: 'factory', amount: fee, type: 'expedite',
          // Note text the SELLER reads on their wallet ledger, so it matches the fee's
          // label in the order summary. Only new rows carry it — rows already written
          // keep the wording they were written with, which is the point of a ledger.
          ref, note: `Expedited Shipping · order ${order.id}` }).catch(() => {});
        out.charged = true;
      } else {
        out.owed = fee;   // surfaced on the order; the parcel still goes
      }
    }
    // One-sided house debit through the shared recorder, so every external cost is
    // booked the same way and the billing view can group them without special cases.
    await recordCost('dispatch', cost, ref, `Dispatch partner label · order ${order.id}`, { orderId: order.id });
    return out;
  }

  /** Push ONE order's label. Returns a plain result so a batch can report per order. */
  async function pushOne(order) {
    if (!order.tracking) return { id: order.id, ok: false, error: 'No label bought yet — nothing to dispatch.' };
    if (!order.tracking_label_url) return { id: order.id, ok: false, error: 'Label has no stored PDF — re-buy the label, then push.' };
    if (order.dispatch_pdf_id) return { id: order.id, ok: true, already: true, pdfId: order.dispatch_pdf_id };

    // Fetch our own label PDF, then hand the BYTES over (they have no URL intake).
    let buf;
    try {
      const lr = await fetch(order.tracking_label_url);
      if (!lr.ok) return { id: order.id, ok: false, retryable: lr.status >= 500, error: `Could not fetch the label PDF (${lr.status}).` };
      const ab = await lr.arrayBuffer();
      if (ab.byteLength > MAX_PDF) return { id: order.id, ok: false, error: 'Label PDF is over their 50MB limit.' };
      buf = Buffer.from(ab);
    } catch (e) {
      return { id: order.id, ok: false, retryable: true, error: `Could not fetch the label PDF: ${e.message}` };
    }

    const form = new FormData();
    // Name it after the order so their dashboard is readable by a human chasing a parcel.
    form.append('file', new Blob([buf], { type: 'application/pdf' }), `${order.id}.pdf`);
    // NB no Content-Type header — fetch must set it so the multipart boundary matches.
    const r = await bes('/customer/pdfs/upload', { method: 'POST', body: form });
    if (!r.ok) {
      const msg = (r.data && (r.data.message || r.data.error)) || r.error || `Upload failed (${r.status})`;
      // Their raw words, kept verbatim: with no documented error codes this text is the
      // only real diagnostic, and a generic "failed" would strand whoever picks it up.
      await q('update orders set dispatch_error=$1 where id=$2', [String(msg).slice(0, 300), order.id]).catch(() => {});
      return { id: order.id, ok: false, retryable: isRetryable(r), error: msg };
    }
    const pdfId = r.data && (r.data.id ?? r.data.pdfId);
    await q('update orders set dispatch_pdf_id=$1, dispatch_pushed_at=now(), dispatch_error=null where id=$2',
      [String(pdfId), order.id]);
    // Bill only once the push actually succeeded — charging for a dispatch that never
    // happened is the one failure a seller would rightly be angry about.
    const billed = await billExpedite(order).catch(() => ({}));
    if (billed.owed) {
      await q('update orders set dispatch_error=$1 where id=$2',
        [`Dispatched, but the $${billed.owed.toFixed(2)} expedite fee is unpaid — wallet was short.`, order.id]).catch(() => {});
    }
    return { id: order.id, ok: true, pdfId, ...billed };
  }

  /**
   * Shipment history — every order that has ever had a tracking number.
   *
   * Scattered across the boards until now: a parcel's number lived on its order, and an
   * order leaves the board once it ships, so "where is 9300120845500000367870" had no
   * answer short of remembering which order it belonged to. That question is asked by
   * whoever is on the phone to a buyer, and it is asked by the tracking number, because
   * that is the only thing the buyer has.
   *
   * Searchable by tracking, order id, customer name or carrier — all four are things
   * someone might arrive holding.
   */
  app.get('/api/shipments', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user || req.user.role === 'seller') { reply.code(403); return { error: 'Staff only' }; }
    const search = String((req.query && req.query.search) || '').trim().toLowerCase();
    const limit = Math.min(500, Math.max(1, parseInt((req.query && req.query.limit) || '200', 10) || 200));
    const args = [];
    let where = "where coalesce(o.tracking,'') <> ''";
    if (search) {
      args.push('%' + search + '%');
      where += ` and (lower(o.tracking) like $1 or lower(o.id) like $1
                      or lower(coalesce(o.carrier,'')) like $1
                      or lower(coalesce(o.customer->>'name','')) like $1)`;
    }
    args.push(limit);
    const r = await softQ('shipments',
      `select o.id, o.seq, o.tracking, o.carrier, o.tracking_label_url,
              o.factory_status, o.delivery_status, o.delivery_detail, o.delivery_checked_at,
              o.label_scanned_at, o.scanned_via, o.created_at, o.ship_service, o.label_test,
              -- price from the order column if stored, else the label-cost ledger row (so
              -- labels bought before the column existed still show what they cost).
              coalesce(o.label_cost,
                (select -sum(w.delta) from wallet_ledger w where w.type='label-cost' and w.ref='label-'||o.id)
              )::float as label_cost,
              -- What came BACK. A void books a positive label-cost row under a 'label-void-'
              -- ref (see the void route below), so the refund is already recorded — it just
              -- had no way to reach the screen, which is why a voided label looked exactly
              -- like a live one and its postage looked like money still spent.
              (select sum(w.delta) from wallet_ledger w
                where w.type='label-cost' and w.ref='label-void-'||o.id)::float as label_refund,
              o.customer->>'name' as customer, o.address->>'state' as state
         from orders o
         ${where}
        order by coalesce(o.label_scanned_at, o.created_at) desc
        limit $${args.length}`, args);
    // Total label spend (all time), for the page's stat tile — straight off the ledger.
    // Gross and refunded are reported SEPARATELY rather than netted: "we spent $65.90" and
    // "we spent $71.90 and got $6 back" are different facts about how the week went, and a
    // single net figure hides the second one entirely. The screen does the subtraction.
    // The test slice is reported alongside rather than deducted. The ledger is append-only
    // and those rows are settled history — a screen that quietly subtracted them would be
    // showing a number that reconciles against nothing. Naming it lets someone read the
    // real figure without either total being a lie.
    const totals = await q(
      `select coalesce(-sum(w.delta) filter (where w.ref not like 'label-void-%'), 0)::float as spend,
              coalesce( sum(w.delta) filter (where w.ref like 'label-void-%'), 0)::float as refunded,
              coalesce(-sum(w.delta) filter (where w.ref not like 'label-void-%' and o.label_test is true), 0)::float as test_spend
         from wallet_ledger w
         left join orders o on w.ref = 'label-' || o.id
        where w.type='label-cost'`)
      .then((x) => x.rows[0] || {}).catch(() => ({}));
    const spend = totals.spend || 0;
    // Fill in any missing label fees in the background. It runs off the critical path so the
    // list returns immediately; when it recovers anything, a live 'orders' event nudges the
    // page to reload and the newly-priced rows appear on their own. Converges to nothing —
    // once every label with a provider reference has its fee, this does a cheap SELECT and
    // stops. (Rows with no reference, e.g. externally-scanned parcels, stay blank by design.)
    recoverLabelCosts(50).then((res) => { if (res && res.updated) egBroadcast({ type: 'orders' }); }).catch(() => {});
    return {
      labelSpend: spend,
      labelRefunded: totals.refunded || 0,
      labelSpendTest: totals.test_spend || 0,
      shipments: r.rows.map((x) => ({
        id: x.id, num: x.seq ? '#' + x.seq : x.id,
        customer: x.customer || null, state: x.state || null,
        tracking: x.tracking, carrier: x.carrier || null,
        labelUrl: x.tracking_label_url || null,
        method: x.ship_service || null,
        price: x.label_cost != null ? Number(x.label_cost) : null,
        // > 0 means this label was voided and the postage credited back. Kept as the AMOUNT
        // rather than a boolean: "voided" and "voided, $6.24 back" answer different questions,
        // and a refund that came back short is the one worth seeing.
        refunded: x.label_refund != null ? Number(x.label_refund) : null,
        // true = bought on a test key and never charged. Null is "we didn't ask", not "no".
        test: x.label_test === true,
        stage: x.factory_status || null,
        // Two DIFFERENT facts, kept apart on purpose: `stage` is what the floor says,
        // `delivery` is what the carrier says. They disagree, and which one is wrong is
        // exactly what someone is trying to work out.
        delivery: x.delivery_status || null,
        deliveryDetail: x.delivery_detail || null,
        deliveryCheckedAt: x.delivery_checked_at,
        scannedAt: x.label_scanned_at, scannedVia: x.scanned_via || null,
        createdAt: x.created_at,
      })),
    };
  });

  /**
   * Manual trigger for the same fee recovery that runs automatically on the shipments list.
   * Kept as an escape hatch (force a sweep without waiting for a page load); the UI no longer
   * needs it. Warehouse/admin only — it moves money.
   */
  app.post('/api/shipments/backfill-costs', { preHandler: requireWarehouse }, async (req) => {
    const res = await recoverLabelCosts(200);
    audit(req, 'label.backfill_cost', { after: res });
    if (res.updated) egBroadcast({ type: 'orders' });
    return { ok: true, scanned: res.scanned || 0, updated: res.updated || 0, failed: res.failed || 0 };
  });

  /**
   * Void a bought label — refund the postage with the carrier (via the aggregator) AND
   * reverse the label-cost in the ledger, so the credit shows in Billing under 'carrier'
   * (the same gap the dispatch-cancel fix closed for byeastside). Best-effort on the ledger
   * so a booking blip can't undo a successful carrier refund. Warehouse/admin only (money).
   */
  app.post('/api/shipments/:id/void', { preHandler: requireWarehouse }, async (req, reply) => {
    const id = String(req.params.id);
    const o = (await q('select id, label_provider, label_ref, tracking_label_url from orders where id=$1', [id]).catch(() => ({ rows: [] }))).rows[0];
    if (!o) { reply.code(404); return { error: 'Order not found' }; }
    if (!o.label_ref) { reply.code(400); return { error: "No provider reference stored for this label — void it in the carrier's dashboard." }; }
    const refund = await aggregatorRefundLabel(o.label_provider, o.label_ref).catch((e) => ({ ok: false, message: e.message }));
    if (!refund.ok) { reply.code(400); return { error: refund.message || 'The carrier refused the void.' }; }
    // Credit the postage back in the ledger (new ref so it dedupes on retry).
    let refunded = 0;
    try {
      const paid = (await q("select -sum(delta)::float as paid from wallet_ledger where account='factory' and type='label-cost' and ref=$1", [`label-${id}`])).rows[0]?.paid || 0;
      if (paid > 0) {
        await q(`insert into wallet_ledger (account, delta, type, ref, note, order_id)
                 values ('factory', $1, 'label-cost', $2, $3, $4) on conflict do nothing`,
          [paid, `label-void-${id}`, `Label voided — postage refunded (${refund.status || 'submitted'}) · order ${id}`, id]);
        refunded = paid;
      }
    } catch { /* best-effort */ }
    /**
     * A VOIDED LABEL LEAVES NO SHIPMENT BEHIND.
     *
     * This dropped only the PDF, so the order kept its tracking number, its carrier, and —
     * if the number had already gone to the marketplace — a marketplace_fulfilled_at stamp
     * saying the buyer was told. The result was an order that looked shipped, showed a dead
     * tracking number to the customer, and could never push a corrected one, because that
     * stamp is exactly what stops a second push.
     *
     * So the whole shipment is cleared. label_scanned_at goes too: a scan is a claim that
     * this parcel was handed over, and the parcel it referred to no longer exists.
     *
     * What is NOT cleared is the ledger — the charge and its compensating credit both stand,
     * because both really happened. Money is history; the shipment is state.
     *
     * NB the marketplace is not told. Etsy's API creates shipments and cannot retract one,
     * so a number already pushed stays on their receipt. Clearing the stamp is what lets a
     * REPLACEMENT label push cleanly, which is the best correction available — see the
     * note on pushMarketplaceTracking in orders.js.
     */
    await q(`update orders set tracking_label_url=null, tracking=null, carrier=null,
               label_ref=null, label_provider=null, label_scanned_at=null,
               marketplace_fulfilled_at=null
             where id=$1`, [id]).catch(() => {});
    audit(req, 'label.void', { entityType: 'order', entityId: id, after: { refundStatus: refund.status || 'submitted', refunded } });
    egBroadcast({ type: 'orders' });
    /**
     * The STAGE is deliberately left alone, and reported instead.
     *
     * An order sitting at 'shipped' with no tracking is now inconsistent — shipBlockers
     * refuses to mark shipped without a label, so it could never have been set that way by
     * hand. But walking a stage BACKWARDS is a claim about the goods, not the label, and
     * this route only knows about the label. Voiding to reprint is routine; voiding because
     * the order is cancelled is not, and only the person clicking knows which.
     *
     * So the caller is told and decides. Silently reversing the stage would be this route
     * asserting something it cannot know.
     */
    const stage = (await q('select factory_status from orders where id=$1', [id])
      .then((r) => String(r.rows[0]?.factory_status || '')).catch(() => ''));
    return {
      ok: true, status: refund.status || 'submitted', refunded,
      stage,
      needsStageReview: stage === 'shipped',
    };
  });

  /**
   * Scan history — what was scanned, when, by whom, and by which route.
   *
   * The awaiting-scan queue answers "what's left". This answers "what happened", which is
   * the question asked when a carrier says a parcel never arrived: a scan with a time and
   * a name against it settles that, and a queue that has simply emptied does not.
   */
  app.get('/api/dispatch/history', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user || req.user.role === 'seller') { reply.code(403); return { error: 'Staff only' }; }
    const days = Math.min(365, Math.max(1, parseInt((req.query && req.query.days) || '30', 10) || 30));
    const search = String((req.query && req.query.search) || '').trim().toLowerCase();
    const args = [String(days)];
    let where = `where o.label_scanned_at is not null and o.label_scanned_at > now() - ($1 || ' days')::interval`;
    if (search) {
      args.push('%' + search + '%');
      where += ` and (lower(o.id) like $2 or lower(coalesce(o.tracking,'')) like $2
                      or lower(coalesce(o.customer->>'name','')) like $2)`;
    }
    const r = await softQ('dispatch history',
      `select o.id, o.seq, o.tracking, o.carrier, o.label_scanned_at, o.scanned_by, o.scanned_via,
              o.factory_status, o.delivery_status, o.customer->>'name' as customer
         from orders o
         ${where}
        order by o.label_scanned_at desc
        limit 500`, args);
    return {
      scans: r.rows.map((x) => ({
        id: x.id, num: x.seq ? '#' + x.seq : x.id,
        customer: x.customer || null,
        tracking: x.tracking || null, carrier: x.carrier || null,
        scannedAt: x.label_scanned_at,
        // 'in-house' or 'partner'. Null means it predates the distinction being recorded,
        // which is stated rather than guessed at.
        via: x.scanned_via || null,
        by: x.scanned_by || null,
        stage: x.factory_status || null,
        delivery: x.delivery_status || null,
      })),
    };
  });

  /**
   * Mark a label scanned IN-HOUSE — the warehouse did it themselves.
   *
   * Pre-scanning exists to start the buyer's tracking clock, and the dispatch partner is
   * one way to do that, not the only way. When the floor scans the label here, the fact is
   * identical — tracking is live — but until now only byeastside could record it, so an
   * in-house scan left the order looking permanently unscanned and the readiness tag dark.
   *
   * Records WHO and by which route. "Scanned" and "scanned by us at 14:02" answer different
   * questions when a carrier says they never received it, and the second one is the one
   * that settles it.
   *
   * Sets label_scanned_at ONLY. The production stage is untouched, for the same reason the
   * partner path leaves it alone: a scan is not a claim about how far the work has got.
   */
  app.post('/api/orders/:id/scanned', { preHandler: requireAuth }, async (req, reply) => {
    // Same boundary as every other custody claim: an operator's zone ends at the scan, and
    // asserting the label is physically scanned is a warehouse fact.
    const role = req.user && req.user.role;
    if (!['admin', 'warehouse', 'operator'].includes(role)) {
      reply.code(403);
      return { error: 'Only the floor can mark a label scanned.' };
    }
    const id = String(req.params.id);
    const undo = (req.body || {}).undo === true;

    const row = await q('select id, tracking, label_scanned_at from orders where id=$1', [id])
      .then((r) => r.rows[0]).catch(() => null);
    if (!row) { reply.code(404); return { error: 'Order not found' }; }

    if (undo) {
      await q('update orders set label_scanned_at=null, scanned_by=null, scanned_via=null where id=$1', [id]);
      audit(req, 'order.scan.undo', { entityType: 'order', entityId: id });
      return { ok: true, scanned: false };
    }

    // No label, nothing to scan. Refusing beats recording a scan of something that doesn't
    // exist — which would light the readiness tag on an order that can't ship.
    if (!row.tracking) {
      reply.code(409);
      return { error: 'No label on this order yet, so there is nothing to scan. Buy the label first.' };
    }
    if (row.label_scanned_at) {
      return { ok: true, already: true, scannedAt: row.label_scanned_at };
    }

    // Two writes, deliberately. The SCAN is the fact that matters — the tag, the buyer's
    // tracking, everything downstream reads label_scanned_at — so it goes first, alone,
    // and its failure is reported rather than swallowed.
    //
    // This was one statement setting all three columns with .catch(() => {}) after it. If
    // scanned_by/scanned_via weren't present (the idempotent ALTERs run at route load and
    // are themselves best-effort), the whole update threw, was swallowed, and the endpoint
    // returned { ok: true, scanned: true } having written nothing. The tag stayed grey and
    // nothing anywhere said why.
    try {
      await q('update orders set label_scanned_at = now() where id = $1', [id]);
    } catch (e) {
      reply.code(500);
      return { error: `Couldn't record the scan: ${e.message}` };
    }
    // Provenance is worth having and not worth losing a scan over, so it's separate and
    // may fail quietly — the scan itself is already safely recorded above.
    await q(`update orders set scanned_by=$2, scanned_via='in-house' where id=$1`,
      [id, String((req.user && req.user.sub) || '')]).catch(() => {});
    audit(req, 'order.scan', { entityType: 'order', entityId: id, after: { via: 'in-house' } });
    egBroadcast({ type: 'order-scanned', id });
    return { ok: true, scanned: true, via: 'in-house' };
  });

  /**
   * Push selected orders to the dispatch list. Manual on purpose — pre-scanning starts
   * the buyer's clock, which is a timing decision a person makes, not something software
   * should guess at.
   */
  /**
   * Sending a label to the pre-scan queue is part of moving an order along, not a claim
   * about physical custody — the partner's floor is what actually scans it. So operators
   * can push and un-push. What stays warehouse/admin is everything that asserts custody
   * or costs money: /sync (writes label_scanned_at) and /billing.
   */
  const canDispatch = (req, reply, done) => {
    const role = req.user && req.user.role;
    if (role !== 'admin' && role !== 'warehouse' && role !== 'operator') {
      reply.code(403).send({ error: 'Operator, warehouse or admin only' });
      return;
    }
    done();
  };

  app.post('/api/dispatch/push', { preHandler: canDispatch }, async (req, reply) => {
    if (!dispatchEnabled()) { reply.code(400); return { error: 'Dispatch partner not configured (BYEASTSIDE_API_KEY).' }; }
    const ids = Array.isArray((req.body || {}).orderIds) ? (req.body.orderIds).map(String).filter(Boolean) : [];
    if (!ids.length) { reply.code(400); return { error: 'orderIds required' }; }
    const rows = (await q(
      'select id, seller_id, tracking, tracking_label_url, dispatch_pdf_id from orders where id = any($1)', [ids]
    )).rows;
    const results = [];
    for (const o of rows) results.push(await pushOne(o));
    const pushed = results.filter((r) => r.ok && !r.already).length;
    // PER ORDER, with an entityId. This audited once for the whole batch and with no
    // entity, so it belonged to no order — and the tag history, which looks up events BY
    // order, could never find it. The hand-off to the partner simply wasn't in any
    // order's history, which is the one place someone goes looking for it.
    for (const r of results) {
      if (!r.ok || r.already) continue;
      audit(req, 'dispatch.push', { entityType: 'order', entityId: String(r.id),
        after: { partner: 'byeastside', queued: true } });
    }
    if (pushed) egBroadcast({ type: 'orders' });
    return { ok: true, pushed, skipped: results.filter((r) => r.already).length, results };
  });

  /**
   * Poll the partner for scans. Their labels carry the tracking number, so a PICKED label
   * is matched back to whichever order holds that tracking — no ids cross the boundary.
   *
   * Sets label_scanned_at only; the order's production stage is deliberately untouched.
   */
  async function syncScans() {
    if (!dispatchEnabled()) return { ok: false, reason: 'not-configured' };
    // Only orders we've pushed and haven't yet seen a scan for.
    const pending = (await q(
      `select id, dispatch_pdf_id, tracking from orders
        where dispatch_pdf_id is not null and label_scanned_at is null`
    ).catch(() => ({ rows: [] }))).rows;
    let scanned = 0;
    for (const o of pending) {
      const r = await bes(`/customer/pdfs/${encodeURIComponent(o.dispatch_pdf_id)}/labels`);
      if (!r.ok || !Array.isArray(r.data)) continue;      // transient → try again next tick
      const hit = r.data.find((l) => String(l.status || '').toUpperCase() === 'PICKED'
        && (!o.tracking || String(l.trackingNumber || '') === String(o.tracking)));
      if (!hit) continue;
      // Their pickedAt is the true scan time; fall back to now if they omit it.
      await q("update orders set label_scanned_at=coalesce($1::timestamptz, now()), scanned_via=coalesce(scanned_via,'partner') where id=$2 and label_scanned_at is null",
        [hit.pickedAt || null, o.id]).catch(() => {});
      scanned++;
    }
    if (scanned) egBroadcast({ type: 'orders' });
    return { ok: true, checked: pending.length, scanned };
  }

  /**
   * Un-push labels — "we sent 10, we're only shipping 5 today".
   *
   * Possible per-order because we upload ONE PDF per order (see pushOne: the file is
   * named after the order id), so their DELETE /customer/pdfs/:id targets exactly one
   * label. A batched PDF would have made this all-or-nothing.
   *
   * Their API returns 409 once a label is scanned or completed, and that refusal is
   * correct: the buyer's tracking clock has already started, so the parcel is committed
   * whatever we think. Those are reported back per order rather than failing the batch —
   * cancelling 5 where 1 has already been picked should still cancel the other 4.
   */
  app.post('/api/dispatch/cancel', { preHandler: canDispatch }, async (req, reply) => {
    if (!dispatchEnabled()) { reply.code(400); return { error: 'Dispatch partner not configured (BYEASTSIDE_API_KEY).' }; }
    const ids = Array.isArray((req.body || {}).orderIds) ? req.body.orderIds.map(String).filter(Boolean) : [];
    if (!ids.length) { reply.code(400); return { error: 'orderIds required' }; }
    // Admin escape hatch: when the PARTNER refuses the recall (e.g. a 500 on their side), the
    // order is stuck with a dispatch_pdf_id we can't clear the normal way, and the Scan tag
    // stays amber forever. force lets an admin clear OUR link anyway — recorded honestly,
    // because the label may still be in the partner's queue. Admin-only; ignored otherwise.
    const force = !!(req.body || {}).force && req.user && req.user.role === 'admin';

    const rows = (await q(
      'select id, dispatch_pdf_id, label_scanned_at, tracking, seller_id from orders where id = any($1)', [ids]
    )).rows;
    const by = (req.user && (req.user.email || req.user.sub)) || 'dispatch-cancel';

    const results = [];
    for (const o of rows) {
      if (!o.dispatch_pdf_id) { results.push({ id: o.id, ok: false, reason: 'not-pushed' }); continue; }
      if (o.label_scanned_at) { results.push({ id: o.id, ok: false, reason: 'already-scanned' }); continue; }
      const r = await bes(`/customer/pdfs/${encodeURIComponent(o.dispatch_pdf_id)}`, { method: 'DELETE' });
      if (r.status === 409) {
        // They scanned it between our check and this call. Record the scan rather than
        // pretending it's still cancellable.
        await q("update orders set label_scanned_at=coalesce(label_scanned_at, now()), scanned_via=coalesce(scanned_via,'partner') where id=$1", [o.id]).catch(() => {});
        results.push({ id: o.id, ok: false, reason: 'already-scanned' });
        continue;
      }
      if (!r.ok && r.status !== 404) {   // 404 = already gone their side; treat as cancelled
        const msg = (r.data && (r.data.message || r.data.error)) || `partner error (${r.status})`;
        if (force) {
          // Partner won't recall it, but the admin wants it off OUR board. Clear the link and
          // RECORD why (the label may still be in their queue). No money reversal — that only
          // runs on a genuine recall; a forced clear isn't proof the partner charge went away.
          await q('update orders set dispatch_pdf_id=null, dispatch_error=$2 where id=$1',
            [o.id, `force-cleared after recall failed: ${String(msg).slice(0, 200)}`]).catch(() => {});
          results.push({ id: o.id, ok: true, forced: true, partnerError: msg });
          continue;
        }
        results.push({ id: o.id, ok: false, reason: msg });
        continue;
      }
      await q('update orders set dispatch_pdf_id=null where id=$1', [o.id]).catch(() => {});
      // Pull the money back: reverse the byeastside cost + refund the seller's expedite fee.
      const credited = await reverseExpediteOnCancel(o, by);
      results.push({ id: o.id, ok: true, ...credited });
    }

    const cancelled = results.filter((x) => x.ok).length;
    for (const r of results) {
      if (!r.ok) continue;
      audit(req, r.forced ? 'dispatch.force_clear' : 'dispatch.cancel', { entityType: 'order', entityId: String(r.id),
        after: r.forced
          ? { partner: 'byeastside', forced: true, note: 'partner recall failed — link force-cleared; label may still be in their queue', partnerError: r.partnerError }
          : { partner: 'byeastside', pulledBack: true } });
    }
    if (cancelled) egBroadcast({ type: 'orders' });
    return { ok: true, cancelled, results };
  });

  // ── EXTERNAL LABELS ─────────────────────────────────────────────────────────
  //
  // A label that is NOT one of our orders. Someone hands the floor a parcel from a
  // different system, or a customer's own postage, and it still has to be pre-scanned.
  // Today that means opening byeastside's own website, which is a second login, a second
  // place to look, and no record on our side of what was sent.
  //
  // DELIBERATELY UNLINKED, and that is the whole design. Earlier this feature was declined
  // precisely because a dropped label has no EGFULFILL order to hang scans on — so it does
  // not pretend to have one. It gets its own table and its own list, touches no order, and
  // bills nothing: the expedite fee exists because a seller asked us to rush THEIR order,
  // and there is no seller and no order here.
  q(`create table if not exists dispatch_uploads (
       id             bigserial primary key,
       pdf_id         text,                     -- their id, the join key for every poll
       file_name      text,
       public_url     text,                     -- their copy of the file, for "open the label"
       status         text,                     -- PENDING | EXTRACTED | ... their vocabulary, not ours
       total_pages    integer,
       total_labels   integer,
       scanned_labels integer not null default 0,
       labels         jsonb not null default '[]',
       note           text,
       error          text,
       created_by     text,
       created_at     timestamptz not null default now(),
       synced_at      timestamptz)`).catch(() => {});
  // WHO THE PARCEL IS FOR, read off the label in the browser before it was sent.
  //
  // Not from byeastside — their extractor returns tracking numbers and nothing else. The
  // label itself prints the addressee, and the uploader parses it out of the PDF, so these
  // are the only reason an external row can fill the same Customer and Ship-to columns as
  // a real order instead of two dashes.
  //
  // A separate ALTER because `create table if not exists` is a no-op on a deployment that
  // already has the table — which is every deployment that has ever pre-scanned a label.
  // Nullable on purpose: an image-only label has nothing to read, and that is a normal row,
  // not a broken one.
  q(`alter table dispatch_uploads
       add column if not exists recipient  text,
       add column if not exists ship_to    text,
       add column if not exists tracking   text`).catch(() => {});

  /** Their words for a batch that will never change again — nothing left to poll for. */
  const settled = (row) => Number(row.total_labels || 0) > 0
    && Number(row.scanned_labels || 0) >= Number(row.total_labels || 0);

  /**
   * Drop a label file straight through to the partner.
   *
   * PDF ONLY, on both sides of the boundary. Their upload answers
   * `400 {"message":"Only PDF files are allowed"}` to anything else — measured against the
   * live API on 2026-08-10, not assumed — and every label we or a carrier produce is
   * already a PDF, so there is nothing to convert and no reason to carry a converter.
   *
   * Checked twice on the way in, because the two checks catch different mistakes: the mime
   * is what the caller CLAIMS, the %PDF- magic is what the file IS. Rejecting here rather
   * than letting them reject it means the message names the fix instead of quoting a
   * partner's validator.
   */
  app.post('/api/dispatch/uploads', { preHandler: canDispatch }, async (req, reply) => {
    if (!dispatchEnabled()) { reply.code(400); return { error: 'Dispatch partner not configured (BYEASTSIDE_API_KEY).' }; }
    const b = req.body || {};
    const dataUrl = String(b.dataUrl || '');
    const m = /^data:([^;,]+)[^,]*,(.*)$/s.exec(dataUrl);
    if (!m) { reply.code(400); return { error: 'Send the file as a data URL.' }; }
    const mime = m[1].toLowerCase();
    if (mime !== 'application/pdf') {
      reply.code(400);
      return { error: `${mime} isn't a label file — every carrier label is a PDF, and their queue only takes PDFs.` };
    }
    let buf;
    try { buf = Buffer.from(m[2], 'base64'); } catch { reply.code(400); return { error: "That file couldn't be decoded." }; }
    if (!buf.length) { reply.code(400); return { error: 'That file is empty.' }; }
    // Check the bytes, not the label on the tin. A data URL's mime is whatever the caller
    // typed; %PDF- is what their extractor will actually look for.
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      reply.code(400); return { error: "That file isn't really a PDF — re-export it from wherever the label came from." };
    }
    const fileName = String(b.fileName || 'label.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    if (buf.length > MAX_PDF) { reply.code(400); return { error: 'That file is over their 50MB limit.' }; }

    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'application/pdf' }), fileName);
    const r = await bes('/customer/pdfs/upload', { method: 'POST', body: form });
    if (!r.ok) {
      // Their raw words. With no documented error codes this text is the only diagnostic,
      // and it is what told us images were refused in the first place.
      const msg = (r.data && (r.data.message || r.data.error)) || r.error || `Upload failed (${r.status})`;
      reply.code(502);
      return { error: String(msg) };
    }
    const d = r.data || {};
    const row = await q(
      `insert into dispatch_uploads (pdf_id, file_name, public_url, status, total_pages, total_labels, note, created_by,
                                     recipient, ship_to, tracking, synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now()) returning *`,
      [String(d.id ?? ''), fileName, d.publicUrl || null, d.status || 'PENDING',
       d.totalPages ?? null, d.totalLabels ?? null,
       b.note ? String(b.note).slice(0, 200) : null, String((req.user && req.user.email) || ''),
       // Read off the label by the uploader. Trimmed to sane lengths and otherwise stored
       // verbatim — this is what the label PRINTS, and a value we tidy is a value that no
       // longer matches the parcel someone is holding.
       b.recipient ? String(b.recipient).slice(0, 120) : null,
       b.shipTo ? String(b.shipTo).slice(0, 160) : null,
       b.tracking ? String(b.tracking).replace(/[^\w]/g, '').slice(0, 40) : null]);
    audit(req, 'dispatch.upload', { entityType: 'dispatch_upload', entityId: String(d.id ?? ''),
      after: { file: fileName, pages: d.totalPages ?? null }, note: `External label ${fileName} sent for pre-scan` });
    return { ok: true, upload: row.rows[0] };
  });

  /**
   * The list, refreshed from their side on read.
   *
   * Polled here rather than on the dispatch timer: these are unlinked, so nothing else in
   * the product depends on them being current, and a batch nobody is looking at does not
   * need to be asked about every minute. Rows that are fully scanned are never asked
   * again — they cannot change.
   */
  app.get('/api/dispatch/uploads', { preHandler: canDispatch }, async () => {
    const rows = (await q('select * from dispatch_uploads order by created_at desc limit 200')
      .catch(() => ({ rows: [] }))).rows;
    if (!dispatchEnabled()) return { configured: false, uploads: rows };
    for (const row of rows) {
      if (!row.pdf_id || settled(row)) continue;
      const st = await bes(`/customer/pdfs/${encodeURIComponent(row.pdf_id)}`);
      if (!st.ok || !st.data) continue;
      const lb = await bes(`/customer/pdfs/${encodeURIComponent(row.pdf_id)}/labels`);
      const labels = Array.isArray(lb.data) ? lb.data : [];
      const picked = labels.filter((l) => String(l.status || '').toUpperCase() === 'PICKED').length;
      const upd = await q(
        `update dispatch_uploads set status=$2, total_pages=$3, total_labels=$4,
                scanned_labels=$5, labels=$6::jsonb, synced_at=now()
           where id=$1 returning *`,
        [row.id, st.data.status || row.status, st.data.totalPages ?? row.total_pages,
         st.data.totalLabels ?? row.total_labels, picked, JSON.stringify(labels)]).catch(() => null);
      if (upd && upd.rows[0]) Object.assign(row, upd.rows[0]);
    }
    return { configured: true, uploads: rows };
  });

  /**
   * Pull one back. Their DELETE answers 409 once a label has been scanned, and that
   * refusal is correct — the parcel is committed. Reported as their own sentence rather
   * than swallowed into a generic failure.
   */
  app.delete('/api/dispatch/uploads/:id', { preHandler: canDispatch }, async (req, reply) => {
    const row = (await q('select * from dispatch_uploads where id=$1::bigint', [String(req.params.id)])
      .catch(() => ({ rows: [] }))).rows[0];
    if (!row) { reply.code(404); return { error: 'not found' }; }
    if (row.pdf_id && dispatchEnabled()) {
      const r = await bes(`/customer/pdfs/${encodeURIComponent(row.pdf_id)}`, { method: 'DELETE' });
      if (!r.ok) {
        const msg = (r.data && (r.data.message || r.data.error)) || r.error || `Their side refused (${r.status})`;
        reply.code(r.status === 409 ? 409 : 502);
        return { error: r.status === 409 ? 'Already scanned — it can\'t be pulled back now.' : String(msg) };
      }
    }
    await q('delete from dispatch_uploads where id=$1::bigint', [String(req.params.id)]).catch(() => {});
    audit(req, 'dispatch.upload.cancel', { entityType: 'dispatch_upload', entityId: String(row.pdf_id || req.params.id),
      note: `External label ${row.file_name || ''} pulled back` });
    return { ok: true };
  });

  // Manual "check now", and the same call the timer makes.
  app.post('/api/dispatch/sync', { preHandler: requireWarehouse }, async () => syncScans());

  // What's configured + what's outstanding, for the UI and for diagnosing quietly-off setups.
  // Staff only: the counts are factory-WIDE (every seller's orders), so on requireAuth any
  // signed-in seller could poll total throughput and backlog. Every other dispatch route
  // is canDispatch or requireWarehouse; this one was the gap.
  app.get('/api/dispatch/status', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    const counts = (await q(
      `select count(*) filter (where dispatch_pdf_id is not null and label_scanned_at is null)::int as awaiting_scan,
              count(*) filter (where label_scanned_at is not null and factory_status <> 'shipped')::int as prescanned_not_shipped,
              count(*) filter (where dispatch_error is not null)::int as errored
         from orders`
    ).catch(() => ({ rows: [{}] }))).rows[0] || {};
    return { configured: dispatchEnabled(), base: apiBase(), ...counts };
  });

  /**
   * Expedited-dispatch billing. Both sides of every push are already in the ledger, so
   * this is a read over what's there rather than a second set of books — one source of
   * truth, and the summary can't drift from the money.
   *
   *   expedite-in   → what sellers paid us (credited to factory)
   *   expedite-cost → what the partner charged us (debited from factory)
   *   margin        → the difference, which is the number worth watching: the sell price
   *                   is fixed in Settings while the partner's cost can move under it.
   */
  app.get('/api/dispatch/billing', { preHandler: requireWarehouse }, async (req) => {
    const days = Math.min(365, Math.max(1, parseInt((req.query || {}).days, 10) || 30));
    const since = `now() - interval '${days} days'`;
    const sum = (await q(
      `select
         coalesce(sum(delta) filter (where type='expedite-in'), 0)::float   as revenue,
         coalesce(sum(-delta) filter (where type='expedite-cost'), 0)::float as cost,
         count(*) filter (where type='expedite-cost' and delta < 0)::int     as labels
       from wallet_ledger
       where account='factory' and created_at >= ${since}`
    ).catch(() => ({ rows: [{}] }))).rows[0] || {};
    const revenue = Number(sum.revenue) || 0;
    const cost = Number(sum.cost) || 0;
    // Recent movements, newest first — the audit trail for "why is the margin off".
    const history = (await q(
      `select created_at, type, delta::float as delta, ref, note
         from wallet_ledger
        where account='factory' and type in ('expedite-in','expedite-cost')
          and created_at >= ${since}
        order by created_at desc limit 100`
    ).catch(() => ({ rows: [] }))).rows;
    // Fees we dispatched but couldn't collect (wallet was short at push time).
    const unpaid = (await q(
      `select count(*)::int as n from orders where dispatch_error like 'Dispatched, but the%'`
    ).catch(() => ({ rows: [{}] }))).rows[0]?.n || 0;
    return {
      days, labels: Number(sum.labels) || 0,
      revenue, cost,
      margin: Math.round((revenue - cost) * 100) / 100,
      perLabel: sum.labels ? Math.round(((revenue - cost) / sum.labels) * 100) / 100 : 0,
      unpaidFees: unpaid,
      history,
    };
  });

  // Poll on a timer. Same single-instance guard as the other background jobs so a hot
  // reload can't stack them, and unref() so it never holds the process open.
  if (dispatchEnabled() && !globalThis.__egDispatchPoll) {
    globalThis.__egDispatchPoll = setInterval(() => { syncScans().catch(() => {}); }, 10 * 60 * 1000);
    if (globalThis.__egDispatchPoll.unref) globalThis.__egDispatchPoll.unref();
  }
}
