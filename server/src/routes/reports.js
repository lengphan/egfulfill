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

/**
 * THE ALL-TIME BAR WINDOW: which calendar months the chart covers, and where a date lands.
 *
 * Exported because it is the one piece of this route that is pure arithmetic on dates, and
 * date arithmetic is where off-by-one lives — months are not a fixed number of milliseconds,
 * so it cannot be checked by dividing. Driven directly by tools/check-report-window.mjs.
 *
 * `span` is capped at 90 columns, the same ceiling the daily windows use, and the window
 * ENDS at `now`: a floor with more history than that loses its oldest months, never its
 * newest.
 */
export function monthWindow(oldestTs, nowTs) {
  const monthIndex = (ms) => { const d = new Date(ms); return d.getFullYear() * 12 + d.getMonth(); };
  const nowMonth = monthIndex(nowTs);
  const oldest = Number.isFinite(oldestTs) ? monthIndex(oldestTs) : nowMonth;
  const monthSpan = Math.max(1, Math.min(90, nowMonth - oldest + 1));
  return { monthIndex, firstMonth: nowMonth - (monthSpan - 1), monthSpan };
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
   * `days` bounds THE MONEY AND THE BARS, and nothing else.
   *
   * The stage counts and the production line are always the whole floor. This used to answer
   * both ways — a `windowed` count set beside the whole one, and a `windowLine` flag — on the
   * reading that "what is on the line now" and "where did this week's intake go" are two
   * questions worth offering. In practice nothing ever read `windowed`, while `windowLine`
   * WAS being sent: the bracket drew an all-time count next to a windowed age, which is not
   * either question answered. Both are gone. What is on the floor is what is on the floor.
   */
  app.get('/api/reports/overview', { preHandler: requireStaff }, async (req) => {
    /**
     * `all` MEANS ALL, and it used to mean a year.
     *
     * The client sent days=365 for "All" and this clamped to 365 anyway, so on a floor
     * holding two-year-old orders the all-time GMV silently dropped everything older than
     * twelve months — the one window whose whole promise is that it drops nothing.
     *
     * A named window rather than a huge number: `days=all` is unbounded here, and a caller
     * that means "a year" can still say 365 and get one.
     */
    const ALL = String(req.query?.days ?? '').toLowerCase() === 'all';
    const days = ALL ? 0 : Math.max(1, Math.min(365, Number(req.query?.days) || 30));
    const since = ALL ? 0 : Date.now() - days * DAY;

    /*
     * ONE QUERY, LEAN COLUMNS. `items` is 892 of the 2,671 bytes an order weighs on
     * /api/orders and none of it is needed here — only each line's status, to roll up the
     * order's stage. Everything else is a scalar.
     */
    const rows = (await q(`
      select o.id, o.seq, o.store, o.source, o.factory_status, o.status, o.total, o.created_at,
             o.label_scanned_at, o.delivered_at, o.delivery_status, o.delivery_checked_at,
             o.est_delivery, o.customer->>'name' as customer_name,
             coalesce(array_agg(i.factory_status) filter (where i.id is not null), '{}') as item_statuses
        from orders o
        left join order_items i on i.order_id = o.id
       group by o.id
       order by o.created_at desc`).catch(() => ({ rows: [] }))).rows;

    const todayStr = new Date().toDateString();
    const counts = { total: 0, draft: 0, pending: 0, approved: 0, working: 0, shipped: 0, onHold: 0, cancelled: 0, refunded: 0, createdToday: 0 };

    const KEY = { '': 'draft', in_review: 'pending', approved: 'approved', working: 'working', shipped: 'shipped', on_hold: 'onHold', cancelled: 'cancelled', refunded: 'refunded' };

    let gmv = 0, inWindow = 0;
    /**
     * THE BUCKET FOLLOWS THE WINDOW, because a one-day window bucketed by day is one bar.
     *
     * `span` was always `days`, so "Today" drew a single column at 100% height — a filled
     * rectangle the width of the panel, which reads as a broken chart rather than as a day
     * with one bar in it. The shape is the whole point of this series; one bar has no shape.
     *
     * Under two days the slot is an HOUR, which turns Today into 24 columns and keeps the
     * same column design at every range. `since` is already a rolling window (now - days),
     * so 24 hourly slots cover it exactly and no arithmetic below has to change — only the
     * size of a slot and how many there are.
     */
    const HOUR = 36e5;
    const hourly = !ALL && days <= 1;
    /**
     * ALL TIME IS BUCKETED BY MONTH, and it has to be.
     *
     * Every other window divides evenly into fixed slots, so a bucket is arithmetic on
     * milliseconds. All time does not: ninety DAILY columns over two years of trading is a
     * chart of the last quarter with an all-time figure written above it, which is worse
     * than no chart — the two halves of the panel would be answering different questions.
     *
     * Months are not a fixed number of milliseconds, so these buckets are indexed by
     * calendar arithmetic (monthIndex) rather than by division. The span runs from the
     * OLDEST order to now, capped at 90 columns — the same ceiling the daily windows use.
     */
    const monthly = ALL;
    const oldestTs = rows.reduce((min, r) => {
      const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
      return !isNaN(t) && t < min ? t : min;
    }, Date.now());
    /* ANCHORED TO NOW, NOT TO THE OLDEST ORDER — the same end the daily windows are anchored
       to, and the reason matters. Indexed from the oldest, a floor with more than 90 months
       of history would number this month past the end of the array and the guard below would
       silently DROP it: the chart would show the first seven years and lose the current one,
       which is the worst way for it to be wrong. Anchored to now, the overflow falls off the
       far end instead, exactly as a 365-day window drops day 366. */
    const { monthIndex, firstMonth, monthSpan } = monthWindow(oldestTs, Date.now());
    const slot = hourly ? HOUR : DAY;
    const span = monthly
      ? monthSpan
      : Math.max(1, Math.min(90, hourly ? Math.round((days * DAY) / HOUR) : days));
    const bars = new Array(span).fill(0);
    /* WHAT EACH COLUMN IS MADE OF. The scaled height alone cannot answer "when did orders
       come in" — it is a shape with no numbers behind it. Orders and money per bucket, plus
       the moment each bucket starts, so the panel can label a column without re-deriving the
       arithmetic and getting a different answer. */
    const barOrders = new Array(span).fill(0);
    const barValue = new Array(span).fill(0);
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
        gmv += num(r.total);
        inWindow++;
        const i = monthly
          ? monthIndex(t) - firstMonth
          : span - 1 - Math.floor((Date.now() - t) / slot);
        if (i >= 0 && i < span) { bars[i] += num(r.total); barValue[i] += num(r.total); barOrders[i]++; }
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

    /*
     * THE PRODUCTION LINE, pre-grouped. The card draws one row per stage, split by channel,
     * with the age of the oldest order in it — all of which is counting, and counting is
     * what a database is for. `platformOf` on the client reads the id prefix; so does this.
     */
    const platformOf = (id) => (/^etsy-/i.test(id) ? 'etsy' : /^shopify-/i.test(id) ? 'shopify' : /^tiktok-/i.test(id) ? 'tiktok' : 'manual');
    const line = new Map();
    for (const r of rows) {
      const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
      /* NO WINDOW ON THE LINE. It used to skip orders outside the money window whenever the
         caller asked, which is how a bracket tile came to show an ALL-TIME count beside an
         age computed over the last thirty days — two populations, one row. The line is the
         live floor; the range control is the money's, and it says so by sitting on the money
         panel now rather than in the page header. */
      const stage = stageOf(r.factory_status || r.status, r.item_statuses);
      let e = line.get(stage);
      if (!e) { e = { id: stage, n: 0, oldest: null, byPlatform: {} }; line.set(stage, e); }
      e.n++;
      const p = platformOf(String(r.id || ''));
      e.byPlatform[p] = (e.byPlatform[p] || 0) + 1;
      if (r.created_at && (!e.oldest || new Date(r.created_at) < new Date(e.oldest))) e.oldest = r.created_at;
    }

    const max = Math.max(...bars, 1);
    return {
      days,
      counts,
      money: { gmv: Math.round(gmv * 100) / 100, orders: inWindow, aov: inWindow ? Math.round((gmv / inWindow) * 100) / 100 : 0 },
      // Scaled 0..1, which is all the sparkline draws — the figures themselves are above.
      gmvBars: bars.map((v) => v / max),
      /** What one bar covers — 'hour' on a single-day window, 'day' otherwise. Sent so the
       *  panel never has to infer the slot from the bar count. */
      gmvBucket: hourly ? 'hour' : monthly ? 'month' : 'day',
      /** Orders and money behind each column, and when each column starts (epoch ms). The
       *  start is SENT rather than recomputed on the client: the index arithmetic here is the
       *  only place that knows the slot size and the window's end, and two derivations of one
       *  timestamp is two chances to be an hour out. */
      gmvBarOrders: barOrders,
      gmvBarValue: barValue.map((v) => Math.round(v * 100) / 100),
      /* Each column's start. Months are calendar steps, not a multiple of `slot`, so they
         are built from the month index rather than by subtracting milliseconds. */
      gmvBarAt: monthly
        ? bars.map((_, i) => { const m = firstMonth + i; return new Date(Math.floor(m / 12), m % 12, 1).getTime(); })
        : bars.map((_, i) => Date.now() - (span - 1 - i) * slot),
      speed: {
        production: { days: round1(median(prod)), n: prod.length },
        transit: { days: round1(median(trans)), n: trans.length },
        total: { days: round1(median(tot)), n: tot.length },
        onTime: { pct: onTimeN ? Math.round((onTimeHit / onTimeN) * 100) : null, n: onTimeN },
      },
      line: [...line.values()],
      /*
       * WHAT NEEDS A PERSON — the exceptions, oldest first.
       *
       * `recent` is the eight NEWEST of everything, which is the wrong eight for this: an
       * account can hold twelve orders and have none of them in the newest eight, so a
       * dashboard filtering `recent` for holds would report nothing while twelve sat there.
       *
       * Oldest first because this is a to-do list, not a feed — the one that has waited
       * longest is the one to answer. Same projection as `recent`, and capped the same way:
       * a queue is for working through on its own page, not for reading whole here.
       */
      attention: rows
        .filter((r) => EXCEPTIONS.has(stageOf(r.factory_status || r.status, r.item_statuses)))
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
        .slice(0, 8)
        .map((r) => ({
          id: r.id, seq: r.seq, store: r.store || null, source: r.source || null,
          customer: r.customer_name || null,
          total: num(r.total), stage: stageOf(r.factory_status || r.status, r.item_statuses),
          created_at: r.created_at,
        })),
      // Eight rows, and only what the list prints — not the orders themselves.
      recent: rows.slice(0, 8).map((r) => ({
        id: r.id, seq: r.seq, store: r.store || null, source: r.source || null,
        customer: r.customer_name || null,
        total: num(r.total), stage: stageOf(r.factory_status || r.status, r.item_statuses),
        created_at: r.created_at,
      })),
    };
  });
}
