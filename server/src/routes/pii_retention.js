// Buyer-PII retention purge.
//
// Amazon's Data Protection Policy requires buyer personally identifiable information to be
// deleted within 30 days of order shipment unless a law requires keeping it. Etsy, TikTok and
// Shopify impose comparable duties; this job is written channel-agnostically so one policy
// covers every connected marketplace rather than four half-policies.
//
// WHAT IT DESTROYS, and why it ships DISABLED:
// redaction is irreversible — the buyer's name, address and label PDF are gone, and the only
// way back is a database restore. That is exactly the kind of change that must not start
// running by itself on a deploy, so `enabled` defaults to FALSE. Preview it, then turn it on
// in Settings. Nothing is redacted until an admin does.
//
// What survives: order id, seq, totals, SKUs, tracking number, timestamps. Reports read
// `total`/`created_at` (web/lib/analytics.ts) and never touch `customer`/`address`, so revenue
// and growth history is unaffected by a purge — only the buyer's identity goes.
import { q } from '../db.js';
import { audit } from '../audit.js';

const CONFIG_KEY = 'pii_retention';
const TICK_MS = 60 * 60 * 1000;            // wake hourly; the window is measured in days
const DEFAULTS = { enabled: false, days: 30 };
// Amazon's ceiling is 30 days after shipment. Allow a shorter window, never a longer one —
// a 90-day setting would silently put the account out of compliance with the DPP.
const MAX_DAYS = 30;

// Terminal states after which no further fulfilment work needs the buyer's address. An order
// still in production is never purged no matter how old, because we could not ship it.
const SHIPPED = ['shipped', 'delivered', 'fulfilled', 'in_transit'];

async function getConfig() {
  try {
    const r = await q('select value from settings where key=$1', [CONFIG_KEY]);
    const v = r.rows[0] && r.rows[0].value;
    const o = v && typeof v === 'object' ? v : {};
    const days = Number.isFinite(Number(o.days))
      ? Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(o.days))))
      : DEFAULTS.days;
    return { enabled: o.enabled === true, days };
  } catch { return { ...DEFAULTS }; }
}

// Columns are added idempotently at load, like the rest of the route-owned tables — schema.sql
// only ever runs on a first DB init, so an existing deployment would never see these.
let _ready = null;
function ensureColumns() {
  if (_ready) return _ready;
  _ready = Promise.all([
    q('alter table orders add column if not exists shipped_at timestamptz'),
    q('alter table orders add column if not exists pii_purged_at timestamptz'),
  ]).then(() => q(
    'create index if not exists orders_pii_purge_idx on orders(shipped_at) where pii_purged_at is null'
  )).catch((e) => { _ready = null; throw e; });
  return _ready;
}

// `shipped_at` has no writer in the status-transition paths, and adding one there would mean
// touching every place an order can reach a shipped state. Instead it self-heals here on each
// tick — the same approach orders.js already uses to backfill line_id. `updated_at` is when
// the row last changed, which for an order sitting in a terminal state IS when it shipped;
// marketplace_fulfilled_at is preferred when present because it is an explicit event.
async function stampShipped() {
  const r = await q(
    `update orders
        set shipped_at = coalesce(marketplace_fulfilled_at, updated_at, created_at)
      where shipped_at is null
        and (lower(coalesce(factory_status,'')) = any($1) or lower(coalesce(status,'')) = any($1))`,
    [SHIPPED]
  );
  return r.rowCount || 0;
}

function cutoff(days) { return `${days} days`; }

/** How many orders the purge would redact right now, without changing anything. */
export async function previewPurge() {
  await ensureColumns();
  const stamped = await stampShipped();
  const cfg = await getConfig();
  const r = await q(
    `select count(*)::int as due, min(shipped_at) as oldest
       from orders
      where pii_purged_at is null
        and shipped_at is not null
        and shipped_at < now() - $1::interval`,
    [cutoff(cfg.days)]
  );
  return { ...cfg, stamped, due: r.rows[0].due, oldest: r.rows[0].oldest };
}

/**
 * Redact buyer PII on every order past the retention window.
 *
 * `customer` keeps a visible "[redacted]" name rather than being emptied: an empty object
 * renders as "—" in the order list, which is indistinguishable from an order whose buyer
 * failed to load. Saying which it is, is the point.
 *
 * `address` keeps country and state only — neither identifies a buyer, and shipping-mix
 * reporting by region survives. Street, city, postcode, name, email and phone all go.
 *
 * `tracking_label_url` is cleared because the label PDF behind it has the buyer's full
 * address printed on it; leaving the link would leave the PII reachable.
 */
export async function runPurge({ actorEmail } = {}) {
  await ensureColumns();
  await stampShipped();
  const cfg = await getConfig();
  const r = await q(
    `update orders
        set customer = jsonb_build_object('name', '[redacted]', 'redacted', true),
            address  = jsonb_strip_nulls(jsonb_build_object(
                         'redacted', true,
                         'country', address->>'country',
                         'state',   address->>'state'
                       )),
            tracking_label_url = null,
            pii_purged_at = now()
      where pii_purged_at is null
        and shipped_at is not null
        and shipped_at < now() - $1::interval
      returning id`,
    [cutoff(cfg.days)]
  );
  const ids = r.rows.map((x) => x.id);
  if (ids.length) {
    // One audit row for the run, not one per order — the log is for detecting incidents, and
    // 500 near-identical rows would bury the signal. Count + window is what an assessor asks for.
    audit(null, 'pii.purged', {
      actor: actorEmail || 'system',
      entityType: 'orders',
      after: { count: ids.length, retention_days: cfg.days },
      note: `Redacted buyer PII on ${ids.length} order(s) shipped over ${cfg.days} days ago`,
    });
  }
  return { purged: ids.length, days: cfg.days };
}

// ── scheduler (in-process, same shape as backup.js; the container restarts unless-stopped) ──
async function tick() {
  try {
    const cfg = await getConfig();
    if (!cfg.enabled) return;      // opt-in only — never redacts until an admin switches it on
    await runPurge({ actorEmail: 'system' });
  } catch { /* swallow so the timer survives to the next hour */ }
}

let _started = false;
function startScheduler() {
  if (_started) return;
  _started = true;
  setTimeout(tick, 90 * 1000);                      // one pass shortly after boot
  const t = setInterval(tick, TICK_MS);
  if (t.unref) t.unref();                           // never hold the process open on its own
}

export function piiRetentionRoutes(app, requireAdmin) {
  ensureColumns().catch(() => {});   // best-effort at load; handlers re-ensure. Must not reject boot.
  startScheduler();

  // Current policy + what a run would do right now.
  app.get('/api/pii-retention', { preHandler: requireAdmin }, async () => {
    try { return await previewPurge(); }
    catch (e) { return { ...DEFAULTS, due: 0, oldest: null, error: String(e.message || e) }; }
  });

  // Turn the policy on/off and set the window. Capped at 30 days by getConfig().
  app.put('/api/pii-retention', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(b.days) || DEFAULTS.days)));
    const enabled = b.enabled === true;
    try {
      await q(
        `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [CONFIG_KEY, JSON.stringify({ enabled, days })]
      );
      audit(req, 'pii.retention.configured', {
        entityType: 'settings', entityId: CONFIG_KEY, after: { enabled, days },
      });
      return { enabled, days };
    } catch (e) {
      reply.code(500);
      return { error: String(e.message || e) };
    }
  });

  // Run it now, regardless of the enabled flag — an explicit admin action is its own consent.
  app.post('/api/pii-retention/run', { preHandler: requireAdmin }, async (req, reply) => {
    try { return await runPurge({ actorEmail: (req.user && req.user.email) || 'admin' }); }
    catch (e) { reply.code(500); return { error: String(e.message || e) }; }
  });
}
