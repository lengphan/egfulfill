// Audit log — one row per meaningful change, so support can track/inquire (and later
// revert) what a customer or staffer did without trawling the server console.
//   audit(req, 'order.updated', { entityType:'order', entityId:id, before, after, note })
// Fire-and-forget: it must NEVER throw or block the request it's recording.
import { q } from './db.js';

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
    await q('create index if not exists audit_log_ts_idx on audit_log(ts desc)').catch(() => {});
  })();
  return _ready;
}

export function audit(req, action, opts) {
  try {
    opts = opts || {};
    const u = (req && req.user) || {};
    const actor = opts.actor || u.email || u.sub || null;
    const role = opts.actorRole || u.role || (req ? null : 'system');
    ensureAuditTable().then(() => {
      q('insert into audit_log (actor, actor_role, action, entity_type, entity_id, before, after, note) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [actor, role, action,
          opts.entityType || null,
          opts.entityId != null ? String(opts.entityId) : null,
          opts.before != null ? JSON.stringify(opts.before) : null,
          opts.after != null ? JSON.stringify(opts.after) : null,
          opts.note || null]
      ).catch(() => {});
    }).catch(() => {});
  } catch (e) { /* audit must never break the request */ }
}
