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
import { q } from '../db.js';
import { audit } from '../audit.js';
import { egBroadcast } from '../events.js';
import { moveFunds, balanceOf } from './wallet.js';
import { readAll as readSettings } from './factory_settings.js';

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

export function dispatchRoutes(app, requireAuth, requireWarehouse) {
  // Their PDF id + when we pushed. On the ORDER rather than a join table: we upload one
  // label per PDF, so the relationship is 1:1 and a table would add joins for nothing.
  q('alter table orders add column if not exists dispatch_pdf_id text').catch(() => {});
  q('alter table orders add column if not exists dispatch_pushed_at timestamptz').catch(() => {});
  q('alter table orders add column if not exists dispatch_error text').catch(() => {});

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
          ref, note: `Expedited dispatch · order ${order.id}` }).catch(() => {});
        out.charged = true;
      } else {
        out.owed = fee;   // surfaced on the order; the parcel still goes
      }
    }
    if (cost > 0) {
      // The partner isn't a wallet holder, so this is a one-sided factory debit: it makes
      // the cost real in the ledger rather than a number living only in Settings.
      await q(
        `insert into wallet_ledger (account, delta, type, ref, note)
         values ('factory', $1, 'expedite-cost', $2, $3) on conflict do nothing`,
        [-cost, ref, `Dispatch partner label · order ${order.id}`]
      ).catch(() => {});
    }
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
   * Push selected orders to the dispatch list. Manual on purpose — pre-scanning starts
   * the buyer's clock, which is a timing decision a person makes, not something software
   * should guess at.
   */
  app.post('/api/dispatch/push', { preHandler: requireWarehouse }, async (req, reply) => {
    if (!dispatchEnabled()) { reply.code(400); return { error: 'Dispatch partner not configured (BYEASTSIDE_API_KEY).' }; }
    const ids = Array.isArray((req.body || {}).orderIds) ? (req.body.orderIds).map(String).filter(Boolean) : [];
    if (!ids.length) { reply.code(400); return { error: 'orderIds required' }; }
    const rows = (await q(
      'select id, seller_id, tracking, tracking_label_url, dispatch_pdf_id from orders where id = any($1)', [ids]
    )).rows;
    const results = [];
    for (const o of rows) results.push(await pushOne(o));
    const pushed = results.filter((r) => r.ok && !r.already).length;
    audit(req, 'dispatch.push', { entityType: 'order', after: { requested: ids.length, pushed } });
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
      await q('update orders set label_scanned_at=coalesce($1::timestamptz, now()) where id=$2 and label_scanned_at is null',
        [hit.pickedAt || null, o.id]).catch(() => {});
      scanned++;
    }
    if (scanned) egBroadcast({ type: 'orders' });
    return { ok: true, checked: pending.length, scanned };
  }

  // Manual "check now", and the same call the timer makes.
  app.post('/api/dispatch/sync', { preHandler: requireWarehouse }, async () => syncScans());

  // What's configured + what's outstanding, for the UI and for diagnosing quietly-off setups.
  app.get('/api/dispatch/status', { preHandler: requireAuth }, async () => {
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
         count(*) filter (where type='expedite-cost')::int                   as labels
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
