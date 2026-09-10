// notify-prefs.js — which pushes a person wants on their phone.
//
// WHAT A MUTE ACTUALLY DOES, and it is deliberately narrow: it stops the PUSH. The
// notification row is still written and the SSE bell still rings, so history stays complete
// and nothing disappears from the app. "Don't buzz my pocket about this" and "pretend this
// never happened" are different requests, and only the first one has a switch.
//
// PRESENCE MEANS MUTED. A row exists only for a channel someone has turned OFF, so an
// account that has never opened this screen has no rows and receives everything — which is
// exactly the behaviour that shipped before this file existed. A defaults-on table would
// have had to be backfilled for every user, and any user it missed would have gone silent.
import { q } from './db.js';

/**
 * THE CHANNELS, AND WHAT REALLY FIRES INTO EACH.
 *
 * Every type below is one that some route actually passes to notify() — checked against the
 * call sites, not imagined. That matters more here than anywhere: a switch labelled
 * "Delivered" that no emitter ever reaches is a control that does nothing, and the person
 * who turns it off and still gets buzzed has been lied to by the settings screen.
 *
 * Two things the mobile prototype asked for are NOT here for that reason: "Hold raised" and
 * "Delivered". Neither exists as a notification type. When something starts emitting them,
 * add the type to a channel here and the switch begins working — there is nothing else to
 * change.
 */
export const CHANNELS = [
  {
    key: 'orders',
    label: 'Orders',
    types: ['order-new', 'order-edited', 'order-channel-open', 'price-changed'],
  },
  {
    key: 'money',
    label: 'Money',
    types: [
      'wallet-low', 'topup-received', 'topup-requested', 'topup_pending',
      'order-fee', 'order-fee-short', 'payout-paid', 'payout-requested',
      'billing-past-due', 'billing-renewed', 'billing-downgraded',
      'billing-trial-started', 'billing-trial-ended',
    ],
  },
  { key: 'design', label: 'Design', types: ['design-card', 'design-file', 'design-quote'] },
  {
    key: 'messages',
    label: 'Messages',
    types: ['support-message', 'staff-message', 'mention', 'support-public'],
  },
  { key: 'announcements', label: 'Announcements', types: ['announcement'] },
];

/** type -> channel key, built once. */
const CHANNEL_OF = new Map(CHANNELS.flatMap((c) => c.types.map((t) => [t, c.key])));

export const channelOf = (type) => CHANNEL_OF.get(String(type)) ?? null;

let _ready = null;
export function ensureNotifyPrefs() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists notification_mutes (
    user_id    uuid not null references users(id) on delete cascade,
    channel    text not null,
    created_at timestamptz not null default now(),
    primary key (user_id, channel)
  )`).catch((e) => { _ready = null; throw e; });
  return _ready;
}

/**
 * The subset of `ids` that still wants a push about `type`.
 *
 * A type belonging to no channel is ALWAYS delivered. There are 29 notification types and
 * five channels; anything unclassified is something added since, and the safe failure for a
 * missing mapping is to notify rather than to go quiet — a switch nobody has seen must not
 * silently swallow a new kind of alert.
 */
export async function pushableIds(ids, type) {
  const channel = channelOf(type);
  if (!channel || !ids.length) return ids;
  try {
    await ensureNotifyPrefs();
    const muted = new Set(
      (await q(
        `select user_id from notification_mutes where channel = $1 and user_id = any($2::uuid[])`,
        [channel, ids]
      )).rows.map((r) => String(r.user_id))
    );
    return ids.filter((id) => !muted.has(String(id)));
  } catch {
    // Same contract as notify() itself: a preference lookup failing must never cost someone
    // an alert. Erring towards delivery is the recoverable direction.
    return ids;
  }
}

/** The channels this user has switched off. */
export async function mutedChannels(userId) {
  await ensureNotifyPrefs();
  const r = await q('select channel from notification_mutes where user_id = $1', [userId]);
  return r.rows.map((x) => x.channel);
}

/** Turn one channel on or off. Unknown keys are refused rather than stored — an unusable
 *  row would sit in the table forever muting nothing. */
export async function setMuted(userId, channel, muted) {
  if (!CHANNELS.some((c) => c.key === channel)) return false;
  await ensureNotifyPrefs();
  if (muted) {
    await q(
      `insert into notification_mutes (user_id, channel) values ($1, $2)
       on conflict (user_id, channel) do nothing`,
      [userId, channel]
    );
  } else {
    await q('delete from notification_mutes where user_id = $1 and channel = $2', [userId, channel]);
  }
  return true;
}
