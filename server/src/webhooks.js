// Outbound webhooks — how a partner learns that something happened here.
//
// Without these the public API is pull-only: a partner who pushes an order via
// POST /api/v1/orders can only discover that it shipped by polling
// GET /api/v1/orders/{id}. That is the question every integrator asks first, and
// "poll us" is the answer that ends the conversation.
//
// Delivery is FIRE AND FORGET on purpose. A webhook is a notification about work that
// has already happened — the parcel is out, the status is written. If a partner's
// endpoint is down, that must not fail the floor's status update or roll anything back.
// Failures are recorded in webhook_deliveries so they can be seen and replayed.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { q } from './db.js';

export const WEBHOOK_EVENTS = [
  'order.received',        // created through the API
  'order.status_changed',  // moved along the factory pipeline
  'order.shipped',         // tracking assigned — the one everybody wants
  'order.cancelled',
];

let _ready = null;
export function ensureWebhookTables() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists webhook_endpoints (
    id          serial primary key,
    seller_id   text not null,
    url         text not null,
    secret      text not null,
    events      text[] not null default '{}',
    active      boolean not null default true,
    created_at  timestamptz not null default now()
  )`)
    .then(() => q('create index if not exists webhook_endpoints_seller_idx on webhook_endpoints(seller_id)'))
    // Every attempt, kept so a partner asking "did you send it?" has an answer that
    // isn't a shrug. Also the basis for replay.
    .then(() => q(`create table if not exists webhook_deliveries (
      id           serial primary key,
      endpoint_id  integer,
      seller_id    text,
      event        text,
      payload      jsonb,
      status_code  integer,
      error        text,
      attempts     integer not null default 0,
      created_at   timestamptz not null default now()
    )`))
    .then(() => q('create index if not exists webhook_deliveries_endpoint_idx on webhook_deliveries(endpoint_id, created_at desc)'))
    .catch(() => {});
  return _ready;
}

export const newWebhookSecret = () => 'egwh_' + randomBytes(24).toString('hex');

/**
 * Reject anything that isn't a public HTTPS endpoint.
 *
 * A webhook URL is a request WE make from inside the network, with our own egress — so
 * an unvalidated one turns this server into a proxy for scanning private hosts (SSRF).
 * Plain http is refused too: the payload carries order contents and buyer addresses.
 */
export function validateWebhookUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'Not a valid URL.'; }
  if (u.protocol !== 'https:') return 'Webhook URLs must use https.';
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return 'That host is not reachable from outside.';
  // Literal private/loopback/link-local/carrier-grade-NAT addresses. A DNS name that
  // RESOLVES into these still gets through — closing that needs resolution at request
  // time, which is worth doing before this is offered to untrusted third parties.
  if (/^(127\.|10\.|0\.|169\.254\.|::1$|\[?::1\]?$|192\.168\.)/.test(h)) return 'That host is not reachable from outside.';
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return 'That host is not reachable from outside.';
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return 'That host is not reachable from outside.';
  return null;
}

/** HMAC-SHA256 of the exact body bytes we send, hex. Partners verify with their secret. */
export const signWebhook = (secret, body) => createHmac('sha256', String(secret)).update(body, 'utf8').digest('hex');

/** Constant-time compare, exported so an inbound receiver can reuse the same rule. */
export function verifyWebhookSignature(secret, body, presented) {
  try {
    const a = Buffer.from(signWebhook(secret, body), 'utf8');
    const b = Buffer.from(String(presented || ''), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

async function deliver(endpoint, event, payload) {
  const body = JSON.stringify({ event, created: new Date().toISOString(), data: payload });
  const sig = signWebhook(endpoint.secret, body);
  let status = null, error = null, attempts = 0;
  // Three attempts, backing off. Beyond that it's the partner's outage, not a transient.
  for (const waitMs of [0, 1000, 5000]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    attempts++;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EG-Event': event,
          'X-EG-Signature': `sha256=${sig}`,
          'User-Agent': 'EGFUL-Webhooks/1',
        },
        body,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      status = res.status;
      error = null;
      if (res.ok) break;
      // 4xx that isn't 408/429 is a rejection, not a blip — retrying can't fix it.
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (e) {
      status = null;
      error = String((e && e.message) || e).slice(0, 300);
    }
  }
  await q(
    `insert into webhook_deliveries (endpoint_id, seller_id, event, payload, status_code, error, attempts)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [endpoint.id, endpoint.seller_id, event, JSON.stringify(payload ?? {}), status, error, attempts]
  ).catch(() => {});
  return { status, error, attempts, ok: !!status && status >= 200 && status < 300 };
}

/**
 * Notify a seller's endpoints that `event` happened. Never throws and never awaits the
 * network on the caller's behalf — call it and move on.
 */
export function emitWebhook(sellerId, event, payload) {
  if (!sellerId || !event) return;
  (async () => {
    await ensureWebhookTables();
    const r = await q(
      `select id, seller_id, url, secret from webhook_endpoints
        where seller_id=$1 and active = true and ($2 = any(events) or events = '{}')`,
      [String(sellerId), event]
    );
    for (const ep of r.rows) await deliver(ep, event, payload).catch(() => {});
  })().catch(() => {});
}

/**
 * Seller-facing management.
 *
 * Authenticates with EITHER the dashboard JWT or an API key. Registering a webhook is a
 * partner action — the whole point is that their server talks to ours — so requiring a
 * human to log into a dashboard to do it would make the feature unusable programmatically,
 * and would 401 the API Playground, which sends X-API-Key.
 *
 * `authKey` is injected rather than imported: sandbox.js already imports emitWebhook from
 * this module, so importing it back would close a cycle.
 */
export function webhookRoutes(app, requireAuth, authKey, allows) {
  ensureWebhookTables();

  // Resolve the caller to a seller id from whichever credential they presented, and carry
  // the key through so scope can be checked. A dashboard JWT is the account owner and is
  // not scope-limited; scopes constrain the credential you hand to someone else.
  const sellerOf = async (req) => {
    if (req.user && req.user.sub) return { id: String(req.user.sub), key: null };
    if (typeof authKey === 'function') {
      const k = await authKey(req).catch(() => null);
      if (k && k.seller_id) return { id: String(k.seller_id), key: k };
    }
    return { id: null, key: null };
  };
  /** `scope` is enforced only for API keys — see above. */
  const seller = (scope) => async (req, reply) => {
    const { id, key } = await sellerOf(req);
    if (!id) { reply.code(401).send({ error: 'Sign in or send an API key (X-API-Key).' }); return; }
    if (key && scope && typeof allows === 'function' && !allows(key, scope)) {
      reply.code(403).send({ error: `This API key is not allowed to ${scope}.`, code: 'insufficient_scope',
        required: scope, granted: key.scopes || [] });
      return;
    }
    req._sellerId = id;
  };
  const requireSeller = seller(null);

  app.get('/api/webhooks', { preHandler: seller('webhooks.read') }, async (req) => {
    await ensureWebhookTables();
    const r = await q(
      'select id, url, events, active, created_at from webhook_endpoints where seller_id=$1 order by created_at desc',
      [req._sellerId]
    );
    // The secret is shown ONCE, at creation. Listing it back would make every read of
    // this page a place to steal signing keys.
    return r.rows;
  });

  app.post('/api/webhooks', { preHandler: seller('webhooks.write') }, async (req, reply) => {
    await ensureWebhookTables();
    const b = req.body || {};
    const bad = validateWebhookUrl(b.url);
    if (bad) { reply.code(400); return { error: bad }; }
    const events = Array.isArray(b.events) ? b.events.filter((e) => WEBHOOK_EVENTS.includes(String(e))) : [];
    if (b.events && !events.length) { reply.code(400); return { error: 'No recognised events.', supported: WEBHOOK_EVENTS }; }
    const secret = newWebhookSecret();
    const r = await q(
      `insert into webhook_endpoints (seller_id, url, secret, events) values ($1,$2,$3,$4)
       returning id, url, events, active, created_at`,
      [req._sellerId, String(b.url), secret, events]
    );
    return { ...r.rows[0], secret, _note: 'Store this secret now — it is not shown again. Verify deliveries with HMAC-SHA256 over the raw body.' };
  });

  app.delete('/api/webhooks/:id', { preHandler: seller('webhooks.write') }, async (req) => {
    await ensureWebhookTables();
    await q('delete from webhook_endpoints where id=$1 and seller_id=$2', [Number(req.params.id) || 0, req._sellerId]);
    return { ok: true };
  });

  // Recent attempts, so "we never got it" is answerable.
  app.get('/api/webhooks/:id/deliveries', { preHandler: seller('webhooks.read') }, async (req, reply) => {
    await ensureWebhookTables();
    const own = await q('select id from webhook_endpoints where id=$1 and seller_id=$2', [Number(req.params.id) || 0, req._sellerId]);
    if (!own.rows.length) { reply.code(404); return { error: 'No such endpoint.' }; }
    const r = await q(
      'select id, event, status_code, error, attempts, created_at from webhook_deliveries where endpoint_id=$1 order by created_at desc limit 100',
      [Number(req.params.id) || 0]
    );
    return r.rows;
  });

  /**
   * Fire a sample event at one endpoint and report what happened, synchronously.
   *
   * Exists because a TEST key can't exercise the real path: POST /api/v1/orders only
   * emits from createRealOrder, which a test key never reaches — by design, since a
   * simulated order doesn't exist and announcing one would be a lie. That left no way to
   * check webhook wiring short of putting a real order through the factory.
   *
   * Unlike production emits this AWAITS delivery and returns the status code: the whole
   * point of a test is finding out that it failed, which fire-and-forget can't tell you.
   * The payload is stamped test:true so a receiver can't mistake it for a real shipment.
   */
  app.post('/api/webhooks/:id/test', { preHandler: seller('webhooks.write') }, async (req, reply) => {
    await ensureWebhookTables();
    const r = await q('select id, seller_id, url, secret from webhook_endpoints where id=$1 and seller_id=$2',
      [Number(req.params.id) || 0, req._sellerId]);
    if (!r.rows.length) { reply.code(404); return { error: 'No such endpoint.' }; }
    const event = WEBHOOK_EVENTS.includes(String((req.body || {}).event)) ? String(req.body.event) : 'order.shipped';
    const result = await deliver(r.rows[0], event, {
      test: true,
      id: 'API-TESTORDER', number: null, status: 'shipped',
      tracking: { carrier: 'USPS', code: '9400100000000000000000' },
      total: 24.5,
    });
    return {
      ok: result.ok, event, url: r.rows[0].url,
      status_code: result.status, attempts: result.attempts, error: result.error,
      hint: result.ok ? 'Delivered. Verify X-EG-Signature against your stored secret.'
        : 'Not delivered — your endpoint must be public https and answer 2xx. See /api/webhooks/{id}/deliveries.',
    };
  });

  app.get('/api/webhooks/events', { preHandler: requireSeller }, async () => ({ events: WEBHOOK_EVENTS }));
}
