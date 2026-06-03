// Design templates — stored SERVER-side so the heavy composite images don't fill
// the browser's ~5MB localStorage (which was throwing "browser storage is full"
// on save). Mirrors the order_designs pattern: localStorage is just a cache; the
// server is the source of truth. Templates are a shared library (like the catalog).
import { q } from '../db.js';

export function templatesRoutes(app, requireAuth) {
  q(`create table if not exists templates (
       id text primary key,
       owner_id uuid,
       name text,
       data jsonb,          -- the card metadata (cat, price, tech, productImg, designOnlyImg, …)
       composite text,      -- composite preview image (base64 data URL)
       layers jsonb,        -- editable layer snapshot for re-opening in Design Maker
       updated_at timestamptz default now())`).catch(() => {});

  // Save / update a template (upsert by id).
  app.post('/api/templates', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    if (!b.id) return { error: 'template id required' };
    await q(
      `insert into templates (id, owner_id, name, data, composite, layers, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (id) do update set
         name=excluded.name, data=excluded.data, composite=excluded.composite,
         layers=excluded.layers, updated_at=now()`,
      [String(b.id), req.user.sub, b.name || null, b.data || {}, b.composite || null, b.layers || []]
    );
    return { ok: true, id: b.id };
  });

  // List templates (newest first). Includes composite so the cards render; the set
  // is small (capped) so the payload stays reasonable.
  app.get('/api/templates', { preHandler: requireAuth }, async () => {
    const r = await q(`select id, name, data, composite, layers from templates order by updated_at desc limit 200`);
    return r.rows;
  });

  app.delete('/api/templates/:id', { preHandler: requireAuth }, async (req) => {
    await q(`delete from templates where id=$1`, [req.params.id]);
    return { ok: true };
  });
}
