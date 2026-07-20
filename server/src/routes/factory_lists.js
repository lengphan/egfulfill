// Factory shared lists — backorders + purchase orders. These are factory-global
// (every staff board reads the same queue) and the client treats each as ONE
// array it get/sets wholesale (EGStore.getBackorders/setBackorders, …). So the
// lowest-friction, lossless mirror is a per-key JSON blob rather than fighting
// two row-shaped tables the client never queries by row. Staff-only.
import { q } from '../db.js';
import { isStaff } from '../auth.js';

// Factory-global staff KV. Arrays (backorders/POs/inventory) OR objects (setup maps, board state,
// the ship_origin blob) — all shared across every staff board + device (was per-browser localStorage).
const ALLOWED = {
  backorders: 1, purchase_orders: 1, inventory: 1, ship_origin: 1,
  po_saved: 1,           // PO lines pulled OUT of a draft but kept to re-add later
  neworder_setup: 1,     // factory's blank/colour/size/method picks per order line (keyed object)
  design_cards: 1,       // design-board workflow state (columns, assignee, checklist, notes)
  design_lab_assigned: 1,// design-lab assignments
  design_types: 1        // board settings — thread/design types
};

export function factoryListsRoutes(app, requireAuth) {
  q(`create table if not exists factory_lists (
       k text primary key,
       v jsonb not null default '[]',
       updated_at timestamptz not null default now()
     )`).catch(() => {});

  // Read one blob (array or object). Staff-only. Absent → null (existing array callers check
  // Array.isArray and skip on null, so this is back-compatible).
  app.get('/api/factory_lists/:k', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    if (!ALLOWED[req.params.k]) { reply.code(404); return { error: 'unknown list' }; }
    const r = await q('select v from factory_lists where k=$1', [req.params.k]);
    return r.rows[0] ? r.rows[0].v : null;
  });

  // Replace one blob wholesale — accepts an array (setBackorders(list) model), the legacy {list:[…]}
  // wrapper, or an arbitrary object (keyed setup maps / board state).
  app.post('/api/factory_lists/:k', { preHandler: requireAuth }, async (req, reply) => {
    if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
    if (!ALLOWED[req.params.k]) { reply.code(404); return { error: 'unknown list' }; }
    let v;
    if (Array.isArray(req.body)) v = req.body;
    else if (req.body && Array.isArray(req.body.list)) v = req.body.list;
    else if (req.body && typeof req.body === 'object') v = req.body;
    else v = [];
    await q(
      `insert into factory_lists (k, v, updated_at) values ($1,$2, now())
       on conflict (k) do update set v=excluded.v, updated_at=now()`,
      [req.params.k, JSON.stringify(v)]);
    return { ok: true, count: Array.isArray(v) ? v.length : 1 };
  });
}
