// Integration usage / spend dashboard. Read-only meter (no throttling) with per-platform
// monthly $ thresholds that only ALERT. Backed by integration_usage (call volume + est cost,
// see ../usage.js) plus the real ledgered costs already in wallet_ledger (costs.js).
import { q } from '../db.js';
import { ensureUsage } from '../usage.js';

// The platforms we meter. `ledgerType` links a platform group to the real-$ category that
// costs.js already books, so the dashboard can show actual money next to call volume.
const PLATFORMS = [
  { key: 'wilcom',   label: 'Wilcom EWA' },
  { key: 'shippo',   label: 'Shipping · Shippo',   ledgerType: 'label-cost' },
  { key: 'easypost', label: 'Shipping · EasyPost', ledgerType: 'label-cost' },
  { key: 'usps',     label: 'Shipping · USPS',     ledgerType: 'label-cost' },
  { key: 'etsy',     label: 'Etsy' },
  { key: 'shopify',  label: 'Shopify' },
  { key: 'tiktok',   label: 'TikTok Shop' },
  { key: 'stripe',   label: 'Stripe' },
  { key: 'paypal',   label: 'PayPal' },
  { key: 'vietqr',   label: 'VietQR' },
  { key: 'ss',       label: 'S&S ActiveWear', ledgerType: 'blanks-cost' },
  { key: 'ottocap',  label: 'Otto Cap',       ledgerType: 'blanks-cost' },
];

// Real-$ categories from wallet_ledger (costs.js COST_TYPES) surfaced as their own strip.
const LEDGER_CATS = [
  { type: 'label-cost',          label: 'Postage (labels)' },
  { type: 'blanks-cost',         label: 'Blanks (POs)' },
  { type: 'design-partner-cost', label: 'Design partner' },
  { type: 'expedite-cost',       label: 'Dispatch / expedite' },
  { type: 'sample-cost',         label: 'Sourcing samples' },
];

const CFG_KEY = 'integration_usage_config'; // settings jsonb: { [platform]: {costPerCallCents, monthlyLimitCents} }
async function readConfig() {
  try { const r = await q(`select value from settings where key=$1`, [CFG_KEY]); return r.rows[0]?.value || {}; }
  catch { return {}; }
}

// ADMIN-only. This is what the integrations COST us per platform; it isn't needed to pick,
// print or ship an order.
export function usageRoutes(app, requireAdminRead, requireAdmin) {
  // Per-platform call volume + estimated/real $ over a window, with monthly-normalised alerts.
  app.get('/api/usage/summary', { preHandler: requireAdminRead }, async (req) => {
    await ensureUsage();
    const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30));
    const cfg = await readConfig();

    const usage = await q(
      `select platform, count(*)::int as calls, coalesce(sum(cost_cents),0)::int as stored_cents,
              count(*) filter (where not ok)::int as errors
         from integration_usage where at > now() - ($1 || ' days')::interval group by platform`,
      [String(days)],
    );
    const byPlat = {};
    for (const r of usage.rows) byPlat[r.platform] = r;

    let ledgered = [];
    try {
      const led = await q(
        `select type, coalesce(sum(-delta),0)::numeric as dollars, count(*)::int as n from wallet_ledger
           where type = any($1) and created_at > now() - ($2 || ' days')::interval group by type`,
        [LEDGER_CATS.map((c) => c.type), String(days)],
      );
      const lm = {}; for (const r of led.rows) lm[r.type] = r;
      ledgered = LEDGER_CATS.map((c) => ({ type: c.type, label: c.label, dollars: Number(lm[c.type]?.dollars || 0), count: lm[c.type]?.n || 0 }));
    } catch { /* wallet_ledger may not exist yet on a fresh DB */ }

    const platforms = PLATFORMS.map((p) => {
      const u = byPlat[p.key] || { calls: 0, stored_cents: 0, errors: 0 };
      const pc = cfg[p.key] || {};
      const perCall = Number(pc.costPerCallCents) || 0;
      // Estimate: an admin per-call rate wins; otherwise fall back to any real cost recorded
      // on the call rows (labels stamp their postage there). The two never both apply.
      const estCents = perCall > 0 ? u.calls * perCall : u.stored_cents;
      const limitCents = Number(pc.monthlyLimitCents) || 0;
      const estMonthlyCents = Math.round(estCents * 30 / days); // normalise the window to a month
      return {
        key: p.key, label: p.label,
        calls: u.calls, errors: u.errors,
        estDollars: +(estCents / 100).toFixed(2),
        estMonthlyDollars: +(estMonthlyCents / 100).toFixed(2),
        costPerCallCents: perCall,
        monthlyLimitDollars: +(limitCents / 100).toFixed(2),
        pct: limitCents > 0 ? Math.round((estMonthlyCents / limitCents) * 100) : null,
        over: limitCents > 0 && estMonthlyCents >= limitCents,
      };
    });

    const totalsEst = platforms.reduce((s, p) => s + p.estDollars, 0);
    const totalsLedgered = ledgered.reduce((s, c) => s + c.dollars, 0);
    return {
      days,
      platforms,
      ledgered,
      totals: {
        calls: platforms.reduce((s, p) => s + p.calls, 0),
        estDollars: +totalsEst.toFixed(2),
        ledgeredDollars: +totalsLedgered.toFixed(2),
        alerts: platforms.filter((p) => p.over).map((p) => p.key),
      },
    };
  });

  // Admin: set a platform's estimated cost-per-call and/or monthly $ alert threshold.
  app.post('/api/usage/config', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    const platform = String(b.platform || '').trim();
    if (!PLATFORMS.some((p) => p.key === platform)) { reply.code(400); return { ok: false, error: 'Unknown platform.' }; }
    const cfg = await readConfig();
    const cur = cfg[platform] || {};
    if (b.costPerCallCents != null) cur.costPerCallCents = Math.max(0, Math.round(Number(b.costPerCallCents) || 0));
    if (b.monthlyLimitCents != null) cur.monthlyLimitCents = Math.max(0, Math.round(Number(b.monthlyLimitCents) || 0));
    cfg[platform] = cur;
    await q(
      `insert into settings (key, value, updated_at) values ($1, $2, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [CFG_KEY, JSON.stringify(cfg)],
    );
    return { ok: true, config: cfg[platform] };
  });
}
