/**
 * VOLUME TIERS — what a seller earns from what they actually shipped.
 *
 * The model is Printful's, not Printify's: the discount is EARNED by volume rather than
 * bought with a subscription. The plan sells tools (SpyDeck, seats, shop connections);
 * this sells nothing — it just recognises what a seller already did.
 *
 * EARN IN ONE MONTH, APPLY THE NEXT. November's units set December's rate. This is
 * deliberate and it is the load-bearing decision in the whole feature:
 *
 *   - A live rolling count would move a seller's price BETWEEN adding an item and
 *     submitting the order. Prices shifting under someone mid-flow is the kind of bug
 *     that generates support tickets nobody can answer.
 *   - A stored period rate is a fact, not a derivation, so an admin editing the tier
 *     table can never rewrite a rate a seller was already told they had earned. Same
 *     reasoning as freezeQuote in pricing.js: store the RESULT, not the inputs.
 *   - It gives the seller board something true and specific to say — "40 units from
 *     Tier 3, reach it by Nov 30 and December is 6%" — which is the entire pitch.
 *
 * quoteOrder READS THIS. pricing.js resolves a seller's rate through volumeRateFor and
 * takes it off the goods subtotal, so a tier saved by an admin is a discount on the next
 * charge. DEFAULT_TIERS is empty and an empty ladder earns every seller 0%, so the feature
 * is off until somebody deliberately turns it on.
 */
import { q } from './db.js';

/**
 * No tiers configured = the feature is OFF, and every seller earns 0%.
 *
 * Deliberately empty rather than a sensible-looking default. A default ladder would start
 * discounting real orders the moment this module is imported, which is exactly the kind of
 * silent money change that must never happen by deployment.
 */
export const DEFAULT_TIERS = [];

/** `2026-08` for a Date — the period key. UTC, so a rollup can't land in two months. */
export function periodKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The period BEFORE the given one — what a rate is earned in. `2026-01` → `2025-12`. */
export function previousPeriod(key) {
  const [y, m] = String(key).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The period AFTER the given one — what this month's units will apply to. */
export function nextPeriod(key) {
  const [y, m] = String(key).split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Normalise an admin-entered tier table: numeric, sorted ascending, no duplicates,
 * nothing negative or over 100%.
 *
 * Sorting here rather than trusting input is what lets tierFor walk it and take the LAST
 * match — an admin typing rows in any order still gets the right ladder.
 */
export function normalizeTiers(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    /*
     * NAME IS CARRIED THROUGH, and it is the only optional field here.
     *
     * A rung was {minUnits, pct} and everything displayed it as "Tier 2" from its position —
     * which renumbers itself the moment a rung is inserted below it, so the thing an admin
     * told a seller they were on silently became a different label. A name is stable across
     * edits and is what a programme is actually called ("Gold", "Partner rate").
     *
     * Trimmed and capped rather than validated: it is a label, and the only harm a long one
     * does is to a table cell. Empty stays empty so the display can fall back to the position,
     * which is what every existing ladder has.
     */
    .map((t) => ({
      minUnits: Math.floor(Number(t && t.minUnits)),
      pct: Number(t && t.pct),
      name: String((t && t.name) || '').trim().slice(0, 40) || null,
    }))
    .filter((t) => Number.isFinite(t.minUnits) && t.minUnits > 0)
    .filter((t) => Number.isFinite(t.pct) && t.pct > 0 && t.pct <= 100)
    .sort((a, b) => a.minUnits - b.minUnits)
    .filter((t) => (seen.has(t.minUnits) ? false : seen.add(t.minUnits)));
}

/**
 * Which tier `units` earns. Pure — no database, so it can be asserted directly.
 *
 * Returns the tier itself plus what the board needs to be useful: the next rung and the
 * distance to it. `index` is 1-based for display ("Tier 2"); 0 means no tier earned.
 */
export function tierFor(units, tiers) {
  const ladder = normalizeTiers(tiers);
  const n = Math.max(0, Math.floor(Number(units) || 0));
  let current = null;
  let index = 0;
  for (let i = 0; i < ladder.length; i += 1) {
    if (n >= ladder[i].minUnits) { current = ladder[i]; index = i + 1; }
  }
  const next = ladder[index] || null;
  return {
    units: n,
    pct: current ? current.pct : 0,
    // The rung's own label when it has one. Callers fall back to `index` ("Tier 2"), which
    // is what every ladder saved before names existed will use.
    name: current ? current.name : null,
    index,
    minUnits: current ? current.minUnits : 0,
    next,
    unitsToNext: next ? next.minUnits - n : null,
  };
}

/**
 * Units SHIPPED per seller for a period.
 *
 * shipped_at, not created_at: a volume programme has to reward what was actually
 * fulfilled, or a seller who syncs 500 drafts and ships none earns the top tier.
 *
 * Cancelled and refunded orders are excluded — they are not volume, and counting them
 * would let a seller earn a discount by placing and cancelling.
 */
export async function unitsByPeriod(period) {
  const r = await q(
    `select o.seller_id::text as seller_id, sum(i.qty)::int as units, count(distinct o.id)::int as orders
       from orders o
       join order_items i on i.order_id = o.id
      where o.shipped_at is not null
        and to_char(o.shipped_at at time zone 'UTC', 'YYYY-MM') = $1
        and lower(coalesce(o.factory_status, '')) not in ('cancelled', 'refunded')
        and lower(coalesce(o.status, '')) not in ('cancelled', 'refunded')
      group by 1`,
    [period]
  );
  return r.rows.map((row) => ({ sellerId: row.seller_id, units: row.units, orders: row.orders }));
}

/** One seller's units for a period — the same query, filtered. */
export async function unitsForSeller(sellerId, period) {
  const all = await unitsByPeriod(period);
  const hit = all.find((r) => r.sellerId === String(sellerId));
  return hit ? hit.units : 0;
}
