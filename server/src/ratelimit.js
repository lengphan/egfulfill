// Per-API-key rate limiting for the public API.
//
// There was none. One partner with a retry loop could saturate a 1-CPU box and take the
// factory's own boards down with it — the public API and the staff UI are the same
// process. A limit is not a courtesy to the caller, it's what stops someone else's bug
// becoming your outage.
//
// Fixed window rather than a token bucket: it is exact at the boundary a partner actually
// reads about ("600 per minute"), needs one integer per key, and the burst it permits at
// a window edge is bounded by the same number. A sliding window would be smoother and is
// not worth the memory on this hardware.
//
// In-process, so the counters reset on deploy and are per-container. That is honest for a
// single-instance deployment; running two API containers would need Redis, and the limit
// would silently become double.

const buckets = new Map();
let lastSweep = 0;

/** Drop windows nobody has touched, so a long-lived process doesn't leak a key per caller. */
function sweep(now) {
  if (now - lastSweep < 300000) return;   // every 5 min at most
  lastSweep = now;
  for (const [k, b] of buckets) if (now - b.start > 600000) buckets.delete(k);
}

/**
 * Count one request against `id`.
 * Returns { ok, limit, remaining, resetIn } — resetIn is seconds until the window rolls.
 */
export function hit(id, limit, windowMs = 60000) {
  const now = Date.now();
  sweep(now);
  let b = buckets.get(id);
  if (!b || now - b.start >= windowMs) { b = { start: now, count: 0 }; buckets.set(id, b); }
  b.count++;
  return {
    ok: b.count <= limit,
    limit,
    remaining: Math.max(0, limit - b.count),
    resetIn: Math.max(1, Math.ceil((b.start + windowMs - now) / 1000)),
  };
}

/**
 * Apply a limit and set the standard headers.
 *
 * Returns NULL when the caller may proceed, or the 429 body to return. It sets the status
 * code but deliberately does NOT send: these routes resolve auth with a helper whose
 * result the handler returns, so sending here too would double-reply.
 *
 * Headers go on every response, not just rejections — a partner can only back off in
 * advance if we tell them what's left before they reach zero.
 */
export function limited(reply, id, limit, windowMs = 60000) {
  const r = hit(id, limit, windowMs);
  reply.header('X-RateLimit-Limit', String(r.limit));
  reply.header('X-RateLimit-Remaining', String(r.remaining));
  reply.header('X-RateLimit-Reset', String(r.resetIn));
  if (r.ok) return null;
  reply.header('Retry-After', String(r.resetIn));
  reply.code(429);
  return {
    error: `Rate limit exceeded — ${r.limit} requests per ${Math.round(windowMs / 1000)}s.`,
    code: 'rate_limited',
    retry_after: r.resetIn,
  };
}

// Printify's published numbers, which partners already build against: 600/min overall,
// tighter on the expensive paths. Order creation writes to the DB and fires webhooks, so
// it gets its own ceiling well below the global one.
export const LIMITS = {
  global: 600,      // per minute, per key
  orders: 60,       // per minute, per key — creating orders is the expensive path
};
