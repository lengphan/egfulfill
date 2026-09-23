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
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { q } from './db.js';
import { limited, LIMITS } from './ratelimit.js';

/** See the registration route: every endpoint multiplies one event into one more outbound
 *  request from our egress, so the fan-out has a ceiling. */
export const MAX_ENDPOINTS_PER_SELLER = 10;

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
/**
 * Is this ADDRESS one we must never send a request to?
 *
 * Separate from the URL check because the two questions are asked at different moments and
 * the second one is the one that matters: a hostname is validated when the endpoint is
 * REGISTERED, and the packet is sent minutes or months later against whatever DNS says
 * then. `webhooks.attacker.example` is a perfectly good public name that can answer
 * 127.0.0.1 — or 169.254.169.254, the cloud metadata address — on the lookup that counts.
 */
export function isPrivateAddress(addr) {
  const a = String(addr || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!a) return true;
  if (isIP(a) === 6) {
    if (a === '::' || a === '::1') return true;
    if (a.startsWith('fc') || a.startsWith('fd')) return true;          // unique-local
    if (a.startsWith('fe80')) return true;                              // link-local
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);        // IPv4 wearing a v6 hat
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  if (isIP(a) !== 4) return true;                                       // not an address at all
  const [x, y] = a.split('.').map(Number);
  if (x === 0 || x === 127 || x === 10) return true;
  if (x === 169 && y === 254) return true;                              // link-local + metadata
  if (x === 172 && y >= 16 && y <= 31) return true;
  if (x === 192 && y === 168) return true;
  if (x === 100 && y >= 64 && y <= 127) return true;                    // carrier-grade NAT
  if (x >= 224) return true;                                            // multicast + reserved
  return false;
}

export function validateWebhookUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'Not a valid URL.'; }
  if (u.protocol !== 'https:') return 'Webhook URLs must use https.';
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return 'That host is not reachable from outside.';
  if (isIP(h) && isPrivateAddress(h)) return 'That host is not reachable from outside.';
  return null;
}

/**
 * The check that actually protects the network: resolve the host AT SEND TIME and refuse
 * if any address it answers with is private.
 *
 * It returns a CODE rather than a message because its two callers need different answers to
 * the same question. `unresolved` is fatal at send time (there is nowhere to send) and must
 * NOT be fatal at registration: a partner wiring this up before DNS has propagated, or
 * against a host that is briefly down, is doing nothing dangerous — refusing them was this
 * check's first act and the leak gate caught it on the run that introduced it. Only
 * `private` is a security answer, and that one is refused in both places.
 *
 * Registration-time validation alone was never enough, and this file said so — a DNS name
 * that resolves inward got straight through it. Now the lookup happens on every attempt,
 * and every address returned must be public: a name answering one public and one private
 * address is a rebinding attack wearing a disguise, not a multi-homed server.
 *
 * WHAT IS LEFT. Between this lookup and the socket, the resolver can answer differently —
 * the classic TOCTOU window. Closing it completely means connecting to a pinned IP with
 * the hostname carried in SNI and Host, which needs an undici Agent this server does not
 * have as a dependency. Stating the residual honestly beats implying it is gone.
 */
export async function checkSendTarget(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return { ok: false, code: 'invalid', message: 'Not a valid URL.' }; }
  if (u.protocol !== 'https:') return { ok: false, code: 'not_https', message: 'Webhook URLs must use https.' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isPrivateAddress(host)
      ? { ok: false, code: 'private', message: 'That host is not reachable from outside.' }
      : { ok: true };
  }
  let addrs;
  try { addrs = await lookup(host, { all: true, verbatim: true }); }
  catch { return { ok: false, code: 'unresolved', message: 'That host does not resolve right now.' }; }
  if (!addrs.length) return { ok: false, code: 'unresolved', message: 'That host does not resolve right now.' };
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    return { ok: false, code: 'private', message: 'That host resolves to a private address.' };
  }
  return { ok: true };
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
    /* RESOLVED EVERY ATTEMPT, not once at registration. The retry is a second request and
       deserves the same check — a name that answered publicly a second ago is not a
       promise about this packet. */
    const target = await checkSendTarget(endpoint.url);
    if (!target.ok) { status = null; error = `Not sent: ${target.message}`.slice(0, 300); break; }
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
        /* A REDIRECT IS NOT FOLLOWED, and this is the other half of the SSRF fix.
           Validating the registered URL means nothing if the endpoint answers 302 to
           http://169.254.169.254/ — fetch follows by default, so the address we refused
           to accept is reached anyway, from inside, with a body the caller chose. It is
           reported as a failed delivery naming the redirect, because the fix is for the
           partner to register the final URL. */
        redirect: 'manual',
      }).finally(() => clearTimeout(t));
      status = res.status;
      error = null;
      if (res.status >= 300 && res.status < 400) {
        error = 'Endpoint redirected — register the final https URL instead; redirects are not followed.';
        break;
      }
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
    /* METERED LIKE EVERY OTHER KEY-AUTHED ROUTE. These sat outside the limiter: the docs
       promise X-RateLimit-* on every response, and registering an endpoint is the one call
       that ARMS outbound requests from our egress — the last place to leave unbounded. A
       dashboard JWT is not metered here; it is a human on their own account. */
    if (key) {
      const over = limited(reply, `k:${key.id}`, LIMITS.global);
      if (over) { reply.send(over); return; }
    }
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
    /* Resolved HERE TOO, so a host that points inward is refused while somebody is looking
       at the answer rather than filling a delivery log nobody reads. Only `private` is
       refused: a name that does not resolve YET is a partner ahead of their own DNS, and
       delivery re-checks every attempt anyway — this is the courtesy, that is the control. */
    const target = await checkSendTarget(b.url);
    if (!target.ok && target.code === 'private') { reply.code(400); return { error: target.message }; }
    const events = Array.isArray(b.events) ? b.events.filter((e) => WEBHOOK_EVENTS.includes(String(e))) : [];
    if (b.events && !events.length) { reply.code(400); return { error: 'No recognised events.', supported: WEBHOOK_EVENTS }; }
    /* A CEILING, because every endpoint multiplies our egress. One order event against 200
       registered endpoints is 200 outbound requests, each retrying three times — a seller
       can otherwise turn a single order into an amplifier pointed wherever they like, and
       nothing in the product needs more than a handful.
       The duplicate check is the same rule in the common case: the way that list grows is
       a retried registration, not a deliberate fan-out. */
    const mine = await q('select id, url from webhook_endpoints where seller_id=$1', [req._sellerId]);
    const dupe = mine.rows.find((r) => String(r.url) === String(b.url));
    if (dupe) { reply.code(409); return { error: 'That URL is already registered.', id: dupe.id,
      hint: 'Delete it first if you need a new signing secret.' }; }
    if (mine.rows.length >= MAX_ENDPOINTS_PER_SELLER) {
      reply.code(409);
      return { error: `At most ${MAX_ENDPOINTS_PER_SELLER} webhook endpoints per account.`,
        hint: 'Delete one you no longer use, or fan out on your own side where you can see the traffic.' };
    }
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
