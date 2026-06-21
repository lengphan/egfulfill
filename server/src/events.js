// Server-Sent Events hub — one-way realtime push so dashboards + the mobile app
// update the instant something changes, instead of waiting for the next poll.
// Single Fastify process, so an in-memory Set of open responses is enough.
const clients = new Set();

// Register an open SSE response. Returns an unsubscribe fn.
export function addClient(res) {
  clients.add(res);
  return () => { try { clients.delete(res); } catch (e) {} };
}

// Push an event to every connected client. Drops any dead socket it hits.
export function egBroadcast(event) {
  const payload = 'data: ' + JSON.stringify(event || {}) + '\n\n';
  for (const res of clients) {
    try { res.write(payload); } catch (e) { try { clients.delete(res); } catch (_) {} }
  }
}

export function clientCount() { return clients.size; }
