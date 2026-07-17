// Server-Sent Events hub — one-way realtime push so dashboards + the mobile app
// update the instant something changes, instead of waiting for the next poll.
// Single Fastify process, so an in-memory Map of open responses is enough.
//
// Each connection is bound to its AUTHENTICATED user. That matters: notifications
// used to go out on a blanket broadcast carrying their recipient list, and every
// client filtered locally — so anyone with devtools could read event titles meant
// for other people. Targeted events are now written ONLY to their recipients'
// sockets. Client-side filtering is not a security boundary.
const clients = new Map(); // res -> { userId, role }

/** Register an open SSE response for a user. Returns an unsubscribe fn. */
export function addClient(res, user) {
  const id = user && (user.sub || user.id);
  clients.set(res, { userId: id ? String(id) : null, role: user && user.role });
  return () => { try { clients.delete(res); } catch (e) {} };
}

function write(res, event) {
  try { res.write('data: ' + JSON.stringify(event || {}) + '\n\n'); }
  catch (e) { try { clients.delete(res); } catch (_) {} }
}

/**
 * Push to every connected client. Use ONLY for non-sensitive cache-invalidation
 * pings (e.g. "orders changed — re-fetch"): the receiver then re-queries through its
 * own access-controlled endpoint, so the payload itself reveals nothing.
 */
export function egBroadcast(event) {
  for (const res of clients.keys()) write(res, event);
}

/**
 * Push to specific users only — for anything carrying content (titles, names,
 * bodies). A user with no open socket just misses the live ping and picks the
 * notification up on their next load.
 */
export function egSendTo(userIds, event) {
  const want = new Set((userIds || []).filter(Boolean).map(String));
  if (!want.size) return;
  for (const [res, meta] of clients.entries()) {
    if (meta.userId && want.has(meta.userId)) write(res, event);
  }
}

export function clientCount() { return clients.size; }
