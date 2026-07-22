// Poll S&S for order status, because they don't push it.
//
// There is no webhook — no receiver here, nothing registered there. Every supplier status
// we have is pulled on demand, when a human opens the PO. So an order cancelled on S&S's
// side stayed "Placed" in our board indefinitely: not a missed webhook, nothing was ever
// listening. This closes that by asking, on a timer.
//
// RATE LIMIT IS THE CONSTRAINT. S&S allow 60 requests a minute across everything we do —
// rate shopping, catalogue sync, tracking, this. So the poll is deliberately small and
// slow: a handful of orders per tick, spaced, several minutes apart. A poller that eats
// the budget breaks the paths people are actually waiting on.
import { q } from './db.js';
import { audit } from './audit.js';
import { notify } from './routes/notifications.js';
import { egBroadcast } from './events.js';

const EVERY_MS = 5 * 60 * 1000;   // one sweep every five minutes
const PER_TICK = 8;               // at most 8 orders a sweep
const SPACING_MS = 1500;          // ~0.7 req/s while sweeping — a fraction of the budget
/** Stop asking eventually. An order nobody received and nobody cancelled is a housekeeping
 *  problem, not something to keep spending API calls on forever. */
const MAX_AGE_DAYS = 45;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Their order number, wherever it ended up in the response. Mirrors supplierOrderNo in
 *  purchase-view.tsx — their payloads are arrays as often as objects, one per warehouse. */
function supplierOrderNo(meta) {
  const r = (meta && meta.response) || {};
  const pick = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) { for (const x of o) { const v = pick(x); if (v) return v; } return null; }
    const v = o.orderNumber ?? o.order_number ?? o.orderNo ?? o.salesOrderNumber;
    return v == null || v === '' ? null : String(v);
  };
  return pick(r.orders) ?? pick(r.ssResponse) ?? pick(r) ?? null;
}

/** What a status string means for us. Anything unrecognised is left alone rather than
 *  guessed at — inventing a meaning for a status we've never seen is how a live order gets
 *  marked done. */
function classify(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('ship') || s.includes('complete') || s.includes('invoice')) return 'shipped';
  return null;
}

let running = false;

/**
 * One sweep. Reads open S&S POs, asks their status, records what changed.
 *
 * Only touches POs that can still change: not received, not already cancelled, and young
 * enough to be live. Everything else is a request spent learning nothing.
 */
export async function pollSupplierOrders(ssOrderStatus) {
  if (running) return { skipped: 'already-running' };
  running = true;
  try {
    const rows = await q(
      `select num, supplier, status, meta from purchase_orders
        where coalesce(status,'') not in ('received', 'cancelled', 'draft')
          and created_at > now() - ($1 || ' days')::interval
        order by created_at desc
        limit $2`, [String(MAX_AGE_DAYS), PER_TICK]
    ).then((r) => r.rows).catch(() => []);
    if (!rows.length) return { checked: 0 };

    let checked = 0, changed = 0;
    for (const po of rows) {
      const orderNo = supplierOrderNo(po.meta);
      if (!orderNo) continue;                 // never placed with them — nothing to ask about
      try {
        const res = await ssOrderStatus(orderNo);
        checked++;
        const verdict = classify(res && (res.orderStatus || res.status));
        if (!verdict) continue;
        // Record the raw status either way, so a human opening the PO sees what they said
        // even when we couldn't classify it.
        const meta = { ...(po.meta || {}), supplierStatus: res.orderStatus || res.status || null, supplierCheckedAt: new Date().toISOString() };

        if (verdict === 'cancelled' && po.status !== 'cancelled') {
          await q('update purchase_orders set status=$2, meta=$3 where num=$1', [po.num, 'cancelled', meta]);
          changed++;
          audit(null, 'purchase.supplier-cancelled', { entityType: 'purchase_order', entityId: po.num, after: { status: res.orderStatus } });
          // Loud, because the goods are not coming and everything downstream — the orders
          // waiting on these blanks — is still assuming they are.
          notify({
            roles: ['operator', 'warehouse', 'admin'],
            type: 'purchase', title: 'S&S cancelled a purchase order',
            body: `${po.num} (their ${orderNo}) came back as "${res.orderStatus || 'Cancelled'}". The blanks are not coming — anything waiting on them needs re-ordering.`,
            href: '/purchase', entityId: po.num,
          }).catch(() => {});
        } else {
          await q('update purchase_orders set meta=$2 where num=$1', [po.num, meta]).catch(() => {});
        }
      } catch { /* one order failing must not end the sweep */ }
      await sleep(SPACING_MS);
    }
    if (changed) egBroadcast({ type: 'orders' });
    return { checked, changed };
  } finally { running = false; }
}

/**
 * Start the timer. No-op when S&S isn't configured, so a dev box doesn't sit making calls
 * it has no credentials for.
 *
 * unref() so the interval can't hold the process open — a container that won't exit on
 * SIGTERM gets killed instead, and a half-written sweep is worse than a skipped one.
 */
export function startSupplierPoll({ enabled, ssOrderStatus }) {
  if (!enabled || !enabled()) return null;
  const t = setInterval(() => {
    pollSupplierOrders(ssOrderStatus).catch(() => {});
  }, EVERY_MS);
  t.unref?.();
  return t;
}
