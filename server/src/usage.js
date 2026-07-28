// Integration usage meter — records every OUTBOUND third-party API call so Settings can show
// per-platform call volume + estimated $ spend, with threshold alerts. Deliberately SEPARATE
// from wallet_ledger: this is high-volume, mostly-$0 API telemetry, not house-money accounting.
// Real per-label / per-PO costs already live in wallet_ledger (costs.js) and the dashboard reads
// those alongside this, so nothing is double-counted.
//
// recordUsage is FIRE-AND-FORGET and can NEVER throw into its caller — a metering failure must
// not break a live shipping / payment / sync call. Callers use it like:
//   recordUsage('etsy', { endpoint: 'GET /receipts', ok: res.ok })
//   recordUsage('usps', { endpoint: 'label', costCents: Math.round(cost * 100), ok: true })
import { q } from './db.js';

let _ready = false;
async function ensureUsage() {
  if (_ready) return;
  await q(`create table if not exists integration_usage (
    id bigserial primary key,
    platform text not null,
    endpoint text,
    cost_cents integer not null default 0,
    ok boolean not null default true,
    at timestamptz not null default now()
  )`);
  await q(`create index if not exists idx_integration_usage_platform_at on integration_usage (platform, at)`);
  _ready = true;
}

// Non-blocking: schedules the insert on a microtask and swallows every error. Returns nothing.
export function recordUsage(platform, opts = {}) {
  const { endpoint = null, costCents = 0, ok = true } = opts;
  Promise.resolve().then(async () => {
    try {
      await ensureUsage();
      await q(
        `insert into integration_usage (platform, endpoint, cost_cents, ok) values ($1,$2,$3,$4)`,
        [String(platform).slice(0, 40), endpoint ? String(endpoint).slice(0, 120) : null, Math.round(Number(costCents) || 0), ok !== false],
      );
    } catch { /* metering is best-effort — never surface to the caller */ }
  });
}

export { ensureUsage };
