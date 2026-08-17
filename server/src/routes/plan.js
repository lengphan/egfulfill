/**
 * VOLUME TIERS — the admin ladder and the seller's own meter.
 *
 * THIS LADDER NOW PRICES ORDERS. It did not for its first period on purpose — the numbers
 * were watched before they were allowed to move money — and that gate is gone: pricing.js
 * reads the same table through volumeRateFor, so a tier saved here is a discount on the
 * next charge. An empty ladder is still the off switch, and still the default.
 */
import { q } from '../db.js';
import { isStaff } from '../auth.js';
import { tierFor, normalizeTiers, periodKey, previousPeriod, nextPeriod, unitsForSeller, unitsByPeriod } from '../volume.js';

const TIERS_KEY = 'volume_tiers';

async function readTiers() {
  try {
    const r = await q('select value from settings where key=$1', [TIERS_KEY]);
    return normalizeTiers(r.rows[0]?.value || []);
  } catch {
    return [];   // settings table not ready → feature simply off
  }
}

export function planRoutes(app, requireAuth, requireStaff, requireAdmin) {
  /**
   * The rate a seller was CHARGED at, stamped by freezeQuote when money moved. Added here
   * because this module owns the volume feature, and idempotently because schema.sql only
   * runs on a first database init — an existing deployment never sees it otherwise.
   *
   * Null means "not charged yet, ask the ladder"; a number means "this is history". Nothing
   * reads it until an order is charged, so a deployment where this ALTER fails prices
   * exactly as before rather than breaking a quote.
   */
  q('alter table orders add column if not exists volume_pct numeric').catch(() => {});

  /**
   * A seller's own meter. Team members resolve to their OWNER, because the owner is who
   * ships and who is billed — a member seeing their own (empty) volume would be reporting
   * a number that belongs to nobody.
   */
  async function effectiveSeller(user) {
    if (!user || isStaff(user)) return null;
    try {
      const r = await q("select owner_id from team_members where lower(email)=lower($1) and status='active' limit 1", [user.email || '']);
      if (r.rows[0]?.owner_id) return r.rows[0].owner_id;
    } catch { /* no team table yet → they are their own owner */ }
    return user.sub;
  }

  app.get('/api/plan/tiers', { preHandler: requireAuth }, async () => ({ tiers: await readTiers() }));

  app.post('/api/plan/tiers', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body || {};
    if (!Array.isArray(body.tiers)) { reply.code(400); return { error: 'tiers must be an array' }; }
    // normalizeTiers is the SAME function the engine reads with, so what an admin saves is
    // exactly what a seller earns — a second cleaning rule here is how the two would drift.
    const clean = normalizeTiers(body.tiers);
    await q(
      'insert into settings (key,value,updated_at) values ($1,$2,now()) on conflict (key) do update set value=excluded.value, updated_at=now()',
      [TIERS_KEY, JSON.stringify(clean)]
    );
    return { ok: true, tiers: clean, dropped: (body.tiers?.length || 0) - clean.length };
  });

  /**
   * What I shipped, and what it earns me.
   *
   * Reports TWO periods, because they answer different questions:
   *   earned  — last month's units, which set THIS month's rate. Already decided.
   *   running — this month so far, which sets NEXT month's rate. Still winnable.
   *
   * `applied` is not decoration. It says whether the rate below is money or a forecast, and
   * a seller must never be told they are getting a discount they are not getting. The
   * pricing half has now shipped, so `earned` IS being charged — but only when there is a
   * ladder to earn from: an empty ladder means the programme is off, every rate is 0%, and
   * claiming it is "applied" would be a promise about nothing.
   */
  app.get('/api/plan/usage', { preHandler: requireAuth }, async (req) => {
    /**
     * ?sellerId lets STAFF read someone else's standing, and is ignored for everyone else.
     *
     * Honoured through this route rather than given its own admin endpoint, deliberately: an
     * admin previewing a seller has to see exactly what that seller sees, and the only way to
     * guarantee that is to make it literally the same code path. A parallel "admin view of a
     * seller" query is a second implementation, and second implementations drift.
     *
     * The staff check is what keeps it safe — a seller passing another seller's id is
     * ignored, not obeyed, so this cannot become a way to read a competitor's volume.
     */
    const asked = req.query?.sellerId ? String(req.query.sellerId) : null;
    const sellerId = asked && isStaff(req.user) ? asked : await effectiveSeller(req.user);
    const tiers = await readTiers();
    const now = new Date();
    const thisPeriod = periodKey(now);
    const lastPeriod = previousPeriod(thisPeriod);

    if (!sellerId) {
      // Staff have no volume of their own — hand back the ladder so the admin screen can
      // render without a second call, and say plainly that there is no seller here.
      return { seller: null, tiers, applied: tiers.length > 0 };
    }

    const [earnedUnits, runningUnits] = await Promise.all([
      unitsForSeller(sellerId, lastPeriod),
      unitsForSeller(sellerId, thisPeriod),
    ]);

    return {
      seller: String(sellerId),
      tiers,
      // quoteOrder takes `earned.pct` off the goods subtotal on the next charge. False when
      // the ladder is empty, because then there is no programme to apply.
      applied: tiers.length > 0,
      earned: { period: lastPeriod, appliesTo: thisPeriod, ...tierFor(earnedUnits, tiers) },
      running: { period: thisPeriod, appliesTo: nextPeriod(thisPeriod), ...tierFor(runningUnits, tiers) },
    };
  });

  /** Staff view: every seller's volume for a period, to sanity-check the ladder. */
  app.get('/api/plan/volume', { preHandler: requireStaff }, async (req) => {
    const period = String(req.query?.period || previousPeriod(periodKey(new Date())));
    const tiers = await readTiers();
    const rows = await unitsByPeriod(period);
    return {
      period,
      tiers,
      sellers: rows
        .map((r) => ({ ...r, ...tierFor(r.units, tiers) }))
        .sort((a, b) => b.units - a.units),
    };
  });
}
