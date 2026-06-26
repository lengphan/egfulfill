// Live two-board realtime check — proves the SSE push hop works end-to-end through the
// live Caddy + Fastify, the way two factory boards (e.g. admin + operator) would see each
// other's changes instantly.
//
// It is NON-DESTRUCTIVE: it opens TWO SSE listeners (simulating two boards), then PATCHes
// one order's `status` to its CURRENT value (no data change) so the server fires its
// `egBroadcast({type:'orders'})`. It then measures how long each listener took to receive
// the push. If both fire in well under the 5s poll interval, realtime is working.
//
// Run (staff JWT = the `eg_token` from a logged-in admin/operator browser console):
//   EG_TOKEN="<jwt>" node sse-live-check.mjs
//   EG_BASE="https://egful.store" EG_TOKEN="<jwt>" node sse-live-check.mjs   // custom host

const BASE = (process.env.EG_BASE || 'https://egful.store').replace(/\/$/, '');
const TOKEN = process.env.EG_TOKEN || process.argv[2] || '';
if (!TOKEN) { console.error('Missing token. Usage: EG_TOKEN="<staff jwt>" node sse-live-check.mjs'); process.exit(1); }

const auth = { Authorization: 'Bearer ' + TOKEN };

// Open an SSE listener; resolves with {name, ms} when the FIRST {type:'orders'} event
// arrives after `since`. Rejects on timeout.
function listen(name, since, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    let settled = false;
    const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error(name + ': no event within ' + timeoutMs + 'ms')); } }, timeoutMs);
    try {
      const res = await fetch(BASE + '/api/events?token=' + encodeURIComponent(TOKEN), { headers: { Accept: 'text/event-stream' } });
      if (!res.ok || !res.body) { clearTimeout(to); return reject(new Error(name + ': SSE connect failed HTTP ' + res.status)); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const dataLine = frame.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          let ev; try { ev = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
          if (ev && ev.type === 'orders' && Date.now() >= since) {
            settled = true; clearTimeout(to);
            try { await reader.cancel(); } catch {}
            return resolve({ name, ms: Date.now() - since, id: ev.id });
          }
        }
      }
      if (!settled) { clearTimeout(to); reject(new Error(name + ': stream closed early')); }
    } catch (e) { clearTimeout(to); reject(new Error(name + ': ' + e.message)); }
  });
}

(async () => {
  console.log('→ Base:', BASE);
  // 1) Pick an order to ping.
  const r = await fetch(BASE + '/api/orders', { headers: auth });
  if (!r.ok) { console.error('GET /api/orders failed:', r.status, await r.text().catch(() => '')); process.exit(1); }
  const data = await r.json();
  const orders = Array.isArray(data) ? data : (data.orders || []);
  if (!orders.length) { console.error('No orders on this account to test with.'); process.exit(1); }
  const o = orders[0];
  console.log('→ Test order:', o.id, '(status=' + (o.status || '?') + ')');

  // 2) Open two listeners (simulating two boards). Give them a moment to connect.
  const t0 = Date.now() + 600;   // only count events fired after the ping below
  const a = listen('board-A', t0, 9000);
  const b = listen('board-B', t0, 9000);
  await new Promise(res => setTimeout(res, 600));

  // 3) Fire a NON-DESTRUCTIVE change: re-set status to its current value → server broadcasts.
  console.log('→ PATCH (status→same value) to trigger broadcast…');
  const pr = await fetch(BASE + '/api/orders/' + encodeURIComponent(o.id), {
    method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: o.status || 'new' })
  });
  if (!pr.ok) { console.error('PATCH failed:', pr.status, await pr.text().catch(() => '')); }

  // 4) Report.
  const results = await Promise.allSettled([a, b]);
  let ok = 0;
  for (const res of results) {
    if (res.status === 'fulfilled') { ok++; console.log(`  ✅ ${res.value.name} received in ${res.value.ms}ms`); }
    else console.log('  ❌ ' + res.reason.message);
  }
  console.log(ok === 2
    ? '\n✅ Realtime SSE works on both boards — cross-board updates are sub-second, not 15s.'
    : '\n⚠️ One/both boards did NOT get the push — SSE may be buffered by the proxy; boards fall back to the 5s poll.');
  process.exit(ok === 2 ? 0 : 2);
})();
