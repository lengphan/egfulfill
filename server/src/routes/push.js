// push.js — device push notifications, hung off the notification system that already exists.
//
// WHY THERE IS NO EVENT WIRING IN THIS FILE. The obvious version of "add push" picks a
// handful of interesting events and calls a send helper from each one. That is how a
// notification surface drifts: the bell and the phone end up knowing about different sets of
// things, and the difference is invisible until somebody misses a shipment.
//
// notifications.js already fans out on write to a resolved list of recipients, and 33 call
// sites across the server reach it through notify(). So push hangs off THAT, once. Every
// event that already rings a bell now also reaches a phone, and any event added later gets
// push without anyone remembering to ask for it.
//
// FIRE-AND-FORGET IS A CONTRACT, inherited from notify(): a push must NEVER fail the business
// action that triggered it. Every path below swallows. A missed notification is a nuisance;
// a shipment that would not save because Expo was down is an outage.
import { q } from '../db.js';

/**
 * ONE ROW PER DEVICE, KEYED BY THE TOKEN — not by (user, token).
 *
 * A phone is a physical object that changes hands: an operator signs out and a warehouse lead
 * signs in on the same handset. With the token as the primary key, registering it against the
 * new user MOVES it, so the previous user stops receiving that device's notifications the
 * moment somebody else signs in on it. Keyed by the pair instead, both rows would survive and
 * the phone would deliver two people's notifications to whoever is holding it — which on this
 * product means a seller's balance and another seller's orders on one lock screen.
 */
let _ready = null;
export function ensurePushDevices() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists push_devices (
    token       text primary key,
    user_id     uuid references users(id) on delete cascade,
    platform    text,
    created_at  timestamptz not null default now(),
    last_seen   timestamptz not null default now()
  )`)
    .then(() => q('create index if not exists push_devices_user_idx on push_devices (user_id)'))
    .catch((e) => { _ready = null; throw e; });
  return _ready;
}

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
/** Expo's own documented ceiling for one request. */
const CHUNK = 100;

/**
 * Read the access token at CALL TIME, never at module load.
 *
 * A module-level `const KEY = process.env.X` snapshots at boot, so a key saved in Settings ›
 * Integrations after the container started would never apply — the failure CLAUDE.md §3
 * records. Expo only requires this when push security is enabled on the account; unset is a
 * legitimate configuration, not an error.
 */
const accessToken = () => (process.env.EXPO_ACCESS_TOKEN || '').trim();

/**
 * Send to every device belonging to these users.
 *
 * Returns nothing and throws nothing. The one thing it DOES do on failure is prune: Expo
 * answers `DeviceNotRegistered` for a token whose app has been deleted or whose permission
 * was revoked, and a registry that never forgets those grows for the life of the product and
 * spends a request on each one forever.
 */
export async function pushToUsers(userIds, { title, body, data }) {
  try {
    const ids = Array.from(new Set((userIds || []).filter(Boolean).map(String)));
    if (!ids.length || !title) return;
    await ensurePushDevices();

    const r = await q('select token from push_devices where user_id = any($1::uuid[])', [ids]);
    const tokens = r.rows.map((x) => x.token).filter((t) => /^Expo(nent)?PushToken\[/.test(t));
    if (!tokens.length) return;

    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    const key = accessToken();
    if (key) headers.authorization = `Bearer ${key}`;

    for (let i = 0; i < tokens.length; i += CHUNK) {
      const slice = tokens.slice(i, i + CHUNK);
      const messages = slice.map((to) => ({
        to,
        title: String(title).slice(0, 100),
        body: body ? String(body).slice(0, 240) : undefined,
        data: data || {},
        sound: 'default',
        // The phone opens straight to the thing, so the badge is cleared when it lands
        // rather than being counted here — a server-side count would have to model "read"
        // twice, and notifications.read_at is already the one that means it.
        channelId: 'default',
      }));

      let res;
      try {
        res = await fetch(EXPO_SEND, { method: 'POST', headers, body: JSON.stringify(messages) });
      } catch {
        // No network, or Expo is down. Nothing to prune and nothing to retry — the bell
        // already has the notification and the app reads it on next focus.
        continue;
      }
      if (!res.ok) continue;

      const out = await res.json().catch(() => null);
      const rows = Array.isArray(out?.data) ? out.data : [];
      const dead = rows
        .map((row, n) => (row?.details?.error === 'DeviceNotRegistered' ? slice[n] : null))
        .filter(Boolean);
      if (dead.length) await q('delete from push_devices where token = any($1::text[])', [dead]).catch(() => {});
    }
  } catch {
    // See the contract at the top of this file.
  }
}

export function pushRoutes(app, requireAuth) {
  ensurePushDevices().catch(() => {});

  /**
   * The phone hands over its token after sign-in, and on every launch — the token can be
   * reissued by the OS, and `last_seen` is what makes a stale registry legible later.
   *
   * `on conflict (token)` is the hand-over described above: the row moves to whoever is
   * signed in now.
   */
  app.post('/api/push/devices', { preHandler: requireAuth }, async (req, reply) => {
    const token = String(req.body?.token || '').trim();
    const platform = String(req.body?.platform || '').slice(0, 16) || null;
    if (!/^Expo(nent)?PushToken\[.+\]$/.test(token)) {
      return reply.code(400).send({ error: 'That is not an Expo push token.' });
    }
    await ensurePushDevices();
    await q(
      `insert into push_devices (token, user_id, platform, last_seen)
       values ($1, $2, $3, now())
       on conflict (token) do update set user_id = excluded.user_id,
                                         platform = excluded.platform,
                                         last_seen = now()`,
      [token, req.user.id, platform]
    );
    return { ok: true };
  });

  /**
   * SIGN-OUT FORGETS THE DEVICE, and it has to, or the handset keeps receiving the previous
   * account's notifications until someone else signs in on it. Scoped to the caller's own
   * rows: a token is a plain string and anyone could otherwise post somebody else's.
   */
  app.delete('/api/push/devices', { preHandler: requireAuth }, async (req) => {
    const token = String(req.body?.token || req.query?.token || '').trim();
    if (!token) return { ok: true };
    await ensurePushDevices();
    await q('delete from push_devices where token = $1 and user_id = $2', [token, req.user.id]);
    return { ok: true };
  });

  /** Whether this account has any device registered — what the Settings row reads. */
  app.get('/api/push/devices', { preHandler: requireAuth }, async (req) => {
    await ensurePushDevices();
    const r = await q(
      'select token, platform, last_seen from push_devices where user_id = $1 order by last_seen desc',
      [req.user.id]
    );
    return { devices: r.rows };
  });
}
