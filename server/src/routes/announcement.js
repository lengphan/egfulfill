// The dashboard announcement — one short line an admin can put across every dashboard.
//
// It rides in the ticker at the top of the seller dashboard and the staff boards, after the
// account's own figures, so it is seen without interrupting anything. That is the whole
// feature: a sentence and a switch.
//
// STORED IN `settings` under one key, the same shape as nav_visibility and site_content, so
// changing it is an admin action rather than a deploy. No new table and no migration.
//
// READABLE BY ANY SIGNED-IN USER, because every dashboard draws it. It carries nothing
// sensitive — it is a line of copy an admin wrote for everyone to read — which is the same
// rationale /api/nav_visibility is read on.
import { q } from '../db.js';

const KEY = 'dashboard_announcement';

// Long enough for a real sentence, short enough that it cannot become a paragraph scrolling
// past someone's order queue. The ticker gives it ONE line and never wraps.
const MAX = 200;

// A KEY, not a number of seconds. The strip's duration is computed from how WIDE the track
// actually is, so a raw duration would mean something different on every dashboard — a busy
// account with more figures would scroll faster for the same setting. These are reading
// speeds in pixels per second, resolved client-side.
const SPEEDS = ['slow', 'normal', 'fast'];

let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = q('create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())')
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

// settings.value is jsonb (already parsed by node-pg) on a current DB, but an older one may
// hand back text — handle both, exactly like the other settings readers here.
const readVal = (row) => {
  if (!row || row.value == null) return {};
  const v = typeof row.value === 'string' ? JSON.parse(row.value || '{}') : row.value;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};

/** { text, on } — always both, so a client never has to guess what a missing field meant. */
function shape(v) {
  const text = typeof v.text === 'string' ? v.text.trim().slice(0, MAX) : '';
  const speed = SPEEDS.includes(v.speed) ? v.speed : 'normal';
  // OFF unless explicitly on AND there is something to say. An announcement switched on with
  // an empty box is not an announcement, and a strip that draws an empty slot for it looks
  // broken rather than blank.
  return { text, on: v.on === true && text.length > 0, speed };
}

export function announcementRoutes(app, requireAuth) {
  app.get('/api/announcement', { preHandler: requireAuth }, async () => {
    await ensure();
    try {
      const r = await q('select value from settings where key=$1', [KEY]);
      return shape(readVal(r.rows[0]));
    } catch {
      // A failed read means NO announcement, never a stale or half one — the dashboard has
      // to render regardless, and a blank strip is the honest answer.
      return { text: '', on: false, speed: 'normal' };
    }
  });

  // Admin only: this is one line on every person's first screen.
  app.put('/api/announcement', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.user || req.user.role !== 'admin') { reply.code(403); return { error: 'Admin only' }; }
    const body = req.body || {};
    if (body.text != null && typeof body.text !== 'string') {
      reply.code(400); return { error: 'text must be a string' };
    }
    const next = shape({ text: body.text ?? '', on: body.on === true, speed: body.speed });
    await ensure();
    await q(
      'insert into settings (key,value,updated_at) values ($1,$2::jsonb,now()) on conflict (key) do update set value=excluded.value, updated_at=now()',
      [KEY, JSON.stringify(next)],
    ).catch(() => {});
    return { ok: true, ...next };
  });
}
