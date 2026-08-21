// reports.js — THE NUMBERS, COMPUTED WHERE THE DATA IS.
//
// The dashboard used to call GET /api/orders and derive everything in the browser: GMV, our
// revenue, profit, average order, the daily bars, the fulfilment medians and the production
// line were all reduce() over the same array. Measured on production: 890 orders, 2,321 KB
// of JSON, to render six numbers. Every card sat on a skeleton until the whole payload had
// crossed the wire, been parsed on the main thread and walked several times — and nothing
// cached it, so leaving the page and coming back paid for all of it again.
//
// A number on a dashboard should arrive as a number. This route reads the same rows inside
// the datacentre, where 890 of them cost nothing, and answers with about two kilobytes.
//
// It deliberately does NOT compute money we already book properly: our revenue and profit
// come from the ledger via /api/wallet/factory-pnl, because orders.total is GMV — what a
// buyer paid a seller on their own marketplace — and never our income.
import { q } from '../db.js';
import { normalizeStage } from './orders.js';

const DAY = 864e5;
const num = (v) => Number(v) || 0;

/**
 * An order's stage is its LEAST-ADVANCED line — mirrors orderStage/resolvedOrderStage in
 * web/lib/factory-status.ts, which is what the boards read.
 *
 * An exception on the ORDER wins outright: a cancelled or held order says so on itself and
 * never on its lines, so reading the lines alone would report it as whatever it was doing
 * when it stopped.
 */
const LINE = ['', 'in_review', 'approved', 'working', 'shipped'];
const EXCEPTIONS = new Set(['on_hold', 'cancelled', 'refunded']);
function stageOf(orderStatus, itemStatuses) {
  const own = normalizeStage(orderStatus);
  if (EXCEPTIONS.has(own)) return own;
  const items = (itemStatuses || []).map(normalizeStage).filter((s) => s !== null && s !== undefined);
  if (!items.length) return own;
  if (items.some((s) => EXCEPTIONS.has(s))) return items.find((s) => EXCEPTIONS.has(s));
  let worst = 'shipped';
  for (const s of items) if (LINE.indexOf(s) < LINE.indexOf(worst)) worst = s;
  return worst;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

export function reportsRoutes(app, requireStaff) {
  /**
   * Everything the overview draws, in one answer.
   *
   * `days` bounds the money and the bars; the production line and the stage counts are
   * returned BOTH ways — windowed and whole — because the floor's "what is on the line right
   * now" and the reader's "where did this week's intake go" are different questions and the
   * dashboard offers a toggle between them.
   */
  app.get('/api/reports/overview', { preHandler: requireStaff }, async (req) => {
    const days = Math.max(1, Math.min(365, Number(req.query?.days) || 30));
    const since = Date.now() - days * DAY;

    /*
     * ONE QUERY, LEAN COLUMNS. `items` is 892 of the 2,671 bytes an order weighs on
     * /api/orders and none of it is needed here — only each line's status, to roll up the
     * order's stage. Everything else is a scalar.
     */
    const rows = (await q(`
      select o.id, o.seq, o.factory_status, o.status, o.total, o.created_at,
             o.label_scanned_at, o.delivered_at, o.delivery_status, o.delivery_checked_at,
             o.est_delivery, o.customer->>'name' as customer_name,
             coalesce(array_agg(i.factory_status) filter (where i.id is not null), '{}') as item_statuses
        from orders o
        left join order_items i on i.order_id = o.id
       group by o.id
       order by o.created_at desc`).catch(() => ({ rows: [] }))).rows;

    const todayStr = new Date().toDateString();
    const counts = { total: 0, draft: 0, pending: 0, approved: 0, working: 0, shipped: 0, onHold: 0, cancelled: 0, refunded: 0, createdToday: 0 };
    const windowed = { total: 0, draft: 0, pending: 0, approved: 0, working: 0, shipped: 0, onHold: 0, cancelled: 0, refunded: 0 };
    const KEY = { '': 'draft', in_review: 'pending', approved: 'approved', working: 'working', shipped: 'shipped', on_hold: 'onHold', cancelled: 'cancelled', refunded: 'refunded' };

    let gmv = 0, inWindow = 0;
    const span = Math.max(1, Math.min(90, days));
    const bars = new Array(span).fill(0);
    const prod = [], trans = [], tot = [];
    let onTimeHit = 0, onTimeN = 0;

    for (const r of rows) {
      const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
      const stage = stageOf(r.factory_status || r.status, r.item_statuses);
      const k = KEY[stage];
      counts.total++;
      if (k) counts[k]++;
      if (r.created_at && new Date(r.created_at).toDateString() === todayStr) counts.createdToday++;

      if (!isNaN(t) && t >= since) {
        windowed.total++;
        if (k) windowed[k]++;
        gmv += num(r.total);
        inWindow++;
        const i = span - 1 - Math.floor((Date.now() - t) / DAY);
        if (i >= 0 && i < span) bars[i] += num(r.total);
      }

      /*
       * FULFILMENT SPEED — mirrors fulfillmentSpeed() in web/lib/analytics.ts, over the whole
       * history rather than the window, because a median of three orders is not a median.
       * delivered_at is the carrier's own event time; delivery_checked_at is the fallback for
       * parcels delivered before we started capturing it.
       */
      const ship = r.label_scanned_at ? new Date(r.label_scanned_at).getTime() : NaN;
      let deliv = r.delivered_at ? new Date(r.delivered_at).getTime() : NaN;
      if (isNaN(deliv) && r.delivery_status === 'delivered' && r.delivery_checked_at) deliv = new Date(r.delivery_checked_at).getTime();
      if (!isNaN(t) && !isNaN(ship) && ship >= t) prod.push((ship - t) / DAY);
      if (!isNaN(ship) && !isNaN(deliv) && deliv >= ship) trans.push((deliv - ship) / DAY);
      if (!isNaN(t) && !isNaN(deliv) && deliv >= t) tot.push((deliv - t) / DAY);
      const eta = r.est_delivery ? new Date(r.est_delivery).getTime() : NaN;
      if (!isNaN(deliv) && !isNaN(eta)) { onTimeN++; if (deliv <= eta + DAY) onTimeHit++; }
    }

    const max = Math.max(...bars, 1);
    return {
      days,
      counts,
      windowed,
      money: { gmv: Math.round(gmv * 100) / 100, orders: inWindow, aov: inWindow ? Math.round((gmv / inWindow) * 100) / 100 : 0 },
      // Scaled 0..1, which is all the sparkline draws — the figures themselves are above.
      gmvBars: bars.map((v) => v / max),
      speed: {
        production: { days: round1(median(prod)), n: prod.length },
        transit: { days: round1(median(trans)), n: trans.length },
        total: { days: round1(median(tot)), n: tot.length },
        onTime: { pct: onTimeN ? Math.round((onTimeHit / onTimeN) * 100) : null, n: onTimeN },
      },
      // Eight rows, and only what the list prints — not the orders themselves.
      recent: rows.slice(0, 8).map((r) => ({
        id: r.id, seq: r.seq, customer: r.customer_name || null,
        total: num(r.total), stage: stageOf(r.factory_status || r.status, r.item_statuses),
        created_at: r.created_at,
      })),
    };
  });
}
