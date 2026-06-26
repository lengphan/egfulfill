// Factory shared lists — backorders + purchase orders. These are factory-global
// (every staff board reads the same queue) and the client treats each as ONE
// array it get/sets wholesale (EGStore.getBackorders/setBackorders, …). So the
// lowest-friction, lossless mirror is a per-key JSON blob rather than fighting
// two row-shaped tables the client never queries by row. Staff-only.
import { q } from '../db.js';
import { isStaff } from '../auth.js';

const ALLOWED = { backorders: 1, purchase_orders: 1, inventory: 1 };

export function factoryListsRoutes(app, requireAuth) {
  q(`create table if not exists factory_lists (
       k text primary key,
       v jsonb not null default '[]',
       updated_at timestamptz not null default now()
     )`).catch(() => {});

  // Read one list (whole array). Staff-only — these are internal factory queues.
  app.get('/api/factory_lists/:k', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    if (!ALLOWED[req.params.k]) { reply.code(404); return { error: 'unknown list' }; }
    const r = await q('select v from factory_lists where k=$1', [req.params.k]);
    return r.rows[0] ? r.rows[0].v : [];
  });

  // Replace one list wholesale (matches the client's setBackorders(list) model).
  app.post('/api/factory_lists/:k', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    if (!ALLOWED[req.params.k]) { reply.code(404); return { error: 'unknown list' }; }
    const v = Array.isArray(req.body) ? req.body : (req.body && Array.isArray(req.body.list) ? req.body.list : []);
    await q(
      `insert into factory_lists (k, v, updated_at) values ($1,$2, now())
       on conflict (k) do update set v=excluded.v, updated_at=now()`,
      [req.params.k, JSON.stringify(v)]);
    return { ok: true, count: v.length };
  });
}
