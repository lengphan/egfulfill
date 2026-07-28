// Audit log — one row per meaningful change, so support can track/inquire (and later
// revert) what a customer or staffer did without trawling the server console.
//   audit(req, 'order.updated', { entityType:'order', entityId:id, before, after, note })
// Fire-and-forget: it must NEVER throw or block the request it's recording.
import { q } from './db.js';
import { isStaff } from './auth.js';

let _ready = null;
export function ensureAuditTable() {
  if (_ready) return _ready;
  _ready = (async () => {
    await q(`create table if not exists audit_log (
      id          bigserial primary key,
      ts          timestamptz default now(),
      actor       text,            -- email or user id
      actor_role  text,            -- seller|operator|warehouse|admin|designer|system
      action      text not null,   -- e.g. order.updated, design.uploaded, wallet.topup
      entity_type text,            -- order|item|design|wallet|...
      entity_id   text,
      before      jsonb,
      after       jsonb,
      note        text
    )`).catch(() => {});
    await q('create index if not exists audit_log_entity_idx on audit_log(entity_type, entity_id, ts desc)').catch(() => {});
    // Display name of the actor. A team tracking "who did this" asks by name, not by
    // login — and a member's email is often noise on a shared account.
    await q('alter table audit_log add column if not exists actor_name text').catch(() => {});
    await q('create index if not exists audit_log_ts_idx on audit_log(ts desc)').catch(() => {});
  })();
  return _ready;
}

// Admin-only read API for the Activity page. Filterable by entity / id / action /
// actor / time, newest first. GET /api/audit?entityId=FF-123 answers "what happened
// to this order?" without touching the server console.
export function auditRoutes(app, requireAdmin, requireAuth) {
  ensureAuditTable();

  /**
   * History for ONE entity — what happened to this order, in order.
   *
   * Split from the admin feed deliberately. The unfiltered log is an admin tool (it spans
   * every seller and every action); the history of a single order is operational, and any
   * staff working that order needs it. Requiring an entityId is what keeps the two apart:
   * you can read the story of a thing you're already allowed to see, not browse everything.
   */
  if (requireAuth) {
    app.get('/api/audit/entity', { preHandler: requireAuth }, async (req, reply) => {
      if (!isStaff(req.user)) { reply.code(403); return { error: 'staff only' }; }
      const id = String((req.query || {}).entityId || '');
      if (!id) { reply.code(400); return { error: 'entityId required' }; }
      // A DESIGNER sees only the design story. They work artwork for the factory and
      // aren't part of fulfilment, so status moves, labels and money aren't theirs to
      // read — while everything about the design, including who on the team uploaded or
      // removed a file, is exactly what they need.
      const designOnly = req.user.role === 'designer';
      const r = await q(
        `select id, ts, action, actor as actor_email, actor_name, actor_role,
                entity_type, entity_id, note, before, after
           from audit_log
          where entity_id = $1
            ${designOnly ? "and (action like 'design.%' or action like 'design_file.%')" : ''}
          order by ts desc limit 200`, [id]);
      return r.rows;
    });
  }

  app.get('/api/audit', { preHandler: requireAdmin }, async (req) => {
    const f = req.query || {};
    const where = [], vals = []; let n = 1;
    if (f.entityType) { where.push(`entity_type=$${n++}`); vals.push(f.entityType); }
    if (f.entityId)   { where.push(`entity_id=$${n++}`); vals.push(String(f.entityId)); }
    if (f.action)     { where.push(`action=$${n++}`); vals.push(f.action); }
    if (f.actor)      { where.push(`actor ilike $${n++}`); vals.push('%' + f.actor + '%'); }
    if (f.since)      { where.push(`ts >= $${n++}`); vals.push(f.since); }
    // Category filter: comma-separated action PREFIXES (order., design, label. …) — matches
    // ANY, so the Activity page can fold ~40 raw action types into a handful of toggles.
    if (f.cats) {
      const prefixes = String(f.cats).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);
      if (prefixes.length) {
        const ors = prefixes.map((p) => { const i = n++; vals.push(p + '%'); return `action like $${i}`; });
        where.push('(' + ors.join(' or ') + ')');
      }
    }
    // Free-text across the human-visible fields (actor, note, id, action).
    if (f.q) {
      const i = n++; vals.push('%' + String(f.q).trim() + '%');
      where.push(`(action ilike $${i} or actor ilike $${i} or coalesce(actor_name,'') ilike $${i} or coalesce(note,'') ilike $${i} or coalesce(entity_id,'') ilike $${i})`);
    }
    const lim = Math.min(parseInt(f.limit, 10) || 200, 1000);
    const sql = `select id, ts, actor, actor_name, actor_role, action, entity_type, entity_id, before, after, note
                 from audit_log ${where.length ? 'where ' + where.join(' and ') : ''}
                 order by ts desc, id desc limit ${lim}`;
    const r = await q(sql, vals);
    return r.rows;
  });
}

export function audit(req, action, opts) {
  try {
    opts = opts || {};
    const u = (req && req.user) || {};
    const actor = opts.actor || u.email || u.sub || null;
    const name = opts.actorName || u.name || null;
    const role = opts.actorRole || u.role || (req ? null : 'system');
    ensureAuditTable().then(() => {
      q('insert into audit_log (actor, actor_name, actor_role, action, entity_type, entity_id, before, after, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [actor, name, role, action,
          opts.entityType || null,
          opts.entityId != null ? String(opts.entityId) : null,
          opts.before != null ? JSON.stringify(opts.before) : null,
          opts.after != null ? JSON.stringify(opts.after) : null,
          opts.note || null]
      ).catch(() => {});
    }).catch(() => {});
  } catch (e) { /* audit must never break the request */ }
}
