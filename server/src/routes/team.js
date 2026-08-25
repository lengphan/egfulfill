// Team members — a seller (owner) invites other users to their account with a
// per-member permission set (the surfaces they may open). PURELY ADDITIVE: a new
// table + new routes, and the AUTH/login path is deliberately untouched. Members
// get their permissions from GET /api/team/my-access (the client reads it on load),
// so a missing membership simply means "no restriction" → full access (fail-open).
import { q } from '../db.js';
import { sendMail, mailConfigured, lastMailError } from '../mailer.js';
import { notify } from './notifications.js';

// Best-effort invite email (no-op unless SMTP_* is configured). Points the invitee at
// Settings → Team, where the in-app banner lets them accept.
function emailInvite(toEmail, ownerName) {
  // The APP (React) lives on app.egful.store; egful.store is the old static site. Linking
  // to /settings.html there sent invitees to a page that can't accept the invite at all.
  const base = process.env.APP_URL || 'https://app.egful.store';
  sendMail({
    to: toEmail,
    subject: (ownerName ? (ownerName + ' invited you') : 'You\'ve been invited') + ' to a team on EGFUL',
    html: '<div style="font-family:Inter,Arial,sans-serif;color:#191918;line-height:1.6">'
      + '<p><b>' + (ownerName || 'A team') + '</b> invited you to join their team on EGFUL.</p>'
      + '<p>Sign in with this email, then open <a href="' + base + '/settings" style="color:#111827;font-weight:600">Settings → Team</a> and click <b>Accept invite</b>.</p>'
      + '<p style="color:#9ca3af;font-size:13px">If you don\'t have an account yet, sign up first at ' + base + '/signup</p></div>'
  }).catch(() => {});
}

export function teamRoutes(app, requireAuth) {
  // Diagnostic: confirm SMTP is wired + Brevo accepts a send. Sends to the caller's
  // own email by default (?to= override). Returns whether SMTP env is set and whether
  // the message was accepted by the relay — so we can tell config vs delivery problems.
  app.get('/api/team/test-email', { preHandler: requireAuth }, async (req) => {
    const to = (req.query && req.query.to) || req.user.email || '';
    if (!to) return { smtpConfigured: !!process.env.SMTP_HOST, sent: false, error: 'no recipient' };
    let sent = false, error = null;
    try {
      sent = await sendMail({
        to,
        subject: 'EGFUL · email test',
        html: '<div style="font-family:Inter,Arial,sans-serif">If you can read this, your EGFUL email is working.</div>'
      });
    } catch (e) { error = e.message; }
    // sendMail never throws, so `error` was ALWAYS null here — the real reason lived
    // inside the mailer and was discarded. Report it, plus the From address, because the
    // most common Brevo rejection is a sender that hasn't been verified in their dashboard.
    if (!sent && !error) error = lastMailError();
    return {
      mailConfigured: mailConfigured(),
      transport: process.env.BREVO_API_KEY ? 'brevo-api' : (process.env.SMTP_HOST ? 'smtp' : 'none'),
      from: process.env.SMTP_FROM || process.env.MAIL_FROM || '(unset → EGFUL <no-reply@egful.store>)',
      to, sent, error,
      hint: sent ? undefined : 'A Brevo 400/401 here is almost always an unverified sender or a bad key. The From address above must be verified under Senders, Domains & Dedicated IPs → Senders.',
    };
  });

  q(`create table if not exists team_members (
       id uuid primary key default gen_random_uuid(),
       owner_id   text not null,        -- the team owner's user id
       email      text not null,        -- the member's login email
       user_id    text,                 -- filled once they accept / exist
       role       text default 'editor',
       permissions jsonb default '[]',  -- surfaces the member may open
       status     text default 'invited', -- 'invited' | 'active'
       invite_token text,
       invited_at timestamptz default now(),
       accepted_at timestamptz
     )`).catch(() => {});
  q(`create unique index if not exists team_members_owner_email on team_members (owner_id, lower(email))`).catch(() => {});
  q(`create index if not exists team_members_email on team_members (lower(email))`).catch(() => {});

  // ── The member-facing endpoint (drives nav-hiding) ─────────────────────────
  // The ACTIVE membership for the signed-in user, by email. Returns null perms
  // when they aren't a restricted member → the client shows everything.
  // NB the joins below cast u.id to text: users.id is uuid, team_members.owner_id is
  // text. Postgres refuses 'uuid = text' with "operator does not exist", and BOTH of
  // these queries were wrapped in a catch that returned an empty/none result — so the
  // whole team feature failed silently from the day it was written. Invites never
  // listed, and my-access always reported "not a member", which meant permission
  // limits never applied to anyone.
  app.get('/api/team/my-access', { preHandler: requireAuth }, async (req) => {
    try {
      const r = await q(
        `select t.id, t.owner_id, t.role, t.permissions,
                coalesce(nullif(u.store_name,''), nullif(u.name,''), u.email) as owner_name
           from team_members t left join users u on u.id::text = t.owner_id
          where lower(t.email)=lower($1) and t.status='active' limit 1`, [req.user.email || '']);
      if (!r.rows[0]) return { member: false, permissions: null };
      const row = r.rows[0];
      // membershipId lets the member leave the team from their own settings.
      return { member: true, membershipId: row.id, ownerId: row.owner_id, role: row.role, ownerName: row.owner_name || 'your team',
               permissions: Array.isArray(row.permissions) ? row.permissions : [] };
    } catch (e) {
      // FAIL CLOSED. `{member:false, permissions:null}` is the client's signal for "not a
      // restricted member — show everything", so returning it on a DB error silently
      // promoted a permission-limited team member to full navigation for that session.
      // This file's own header records that a swallowed error here hid a broken query for
      // the feature's entire life; my-invites was already changed to 500 loudly for the
      // same reason. Server-side surface checks still hold, so this is nav only — but a
      // read that failed must not be reported as a permission answer.
      req.log?.error?.({ err: String(e) }, 'team my-access failed');
      throw e;
    }
  });

  // Pending invites addressed to the signed-in user (so a member sees "you've been
  // invited to X's team" in their own Settings → Team, even without email delivery).
  app.get('/api/team/my-invites', { preHandler: requireAuth }, async (req, reply) => {
    // Resolve the identity from the DATABASE, not the JWT.
    //
    // The token is signed for 7 days and carries whatever email the account had when it
    // was minted, so a stale token silently matches nothing and the invite panel renders
    // empty — identical to having no invites. The user id in `sub` is the stable fact;
    // read the current email from it and keep the token's copy only as a fallback.
    let email = '';
    try {
      const me = await q('select email from users where id=$1', [req.user.sub]);
      email = (me.rows[0] && me.rows[0].email) || '';
    } catch (e) { /* fall through to the token's copy */ }
    if (!email) email = req.user.email || '';

    try {
      const r = await q(
        `select t.id, t.invite_token, t.role, t.permissions, t.owner_id, t.invited_at,
                coalesce(nullif(u.store_name,''), nullif(u.name,''), u.email) as owner_name,
                u.email as owner_email
           from team_members t left join users u on u.id::text = t.owner_id
          where (lower(t.email)=lower($1) or t.user_id=$2::text) and t.status='invited'
          order by t.invited_at desc`, [email, req.user.sub]);
      return r.rows;
    } catch (e) {
      // Returning [] on failure disguised a broken query as "you have no invites",
      // which is exactly how a working invite looked like a missing feature.
      req.log.error({ err: e }, 'my-invites query failed');
      reply.code(500);
      return { error: 'Could not read your invites: ' + e.message };
    }
  });

  // ── Owner management — the caller is always the owner of the rows they touch ─
  app.get('/api/team', { preHandler: requireAuth }, async (req) => {
    const r = await q(
      `select id, email, user_id, role, permissions, status, invited_at
         from team_members where owner_id=$1 order by invited_at asc`, [req.user.sub]);
    return r.rows;
  });

  // Invite (or re-invite) a member. Creates an 'invited' row + token. Idempotent
  // per (owner, email) — re-inviting updates role/permissions and re-issues the token.
  app.post('/api/team/invite', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    const email = String(b.email || '').toLowerCase().trim();
    if (!email) return { error: 'email required' };
    if (email === String(req.user.email || '').toLowerCase()) return { error: "you can't invite yourself" };
    const token = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const perms = JSON.stringify(Array.isArray(b.permissions) ? b.permissions : ['orders']);
    // Tell the invitee, two ways. Email is best-effort and SILENTLY no-ops when neither
    // BREVO_API_KEY nor SMTP_HOST is set, so it can't be the only signal — an in-app
    // notification lands in their bell whether or not mail is wired, provided they
    // already have an account (the common case: you invite someone who signed up).
    let ownerName = null;
    try {
      const on = await q(`select coalesce(nullif(store_name,''),nullif(name,''),email) as nm from users where id=$1`, [req.user.sub]);
      ownerName = on.rows[0] && on.rows[0].nm;
      emailInvite(email, ownerName);
    } catch (e) {}
    try {
      const u = await q('select id from users where lower(email)=lower($1) limit 1', [email]);
      if (u.rows[0]) {
        notify({
          userIds: [u.rows[0].id], type: 'team-invite',
          title: `${ownerName || 'A seller'} invited you to their team`,
          body: 'Open Settings → Team to accept. Until you accept, nothing changes for your account.',
          // Deep-link to the TAB, not just the page. A bare '/settings' opened on
          // Profile, so the notification pointed at a page where the invite was
          // invisible — which reads as the invite not existing.
          href: '/settings?tab=team',
        }).catch(() => {});
      }
    } catch (e) {}
    const ex = await q('select id from team_members where owner_id=$1 and lower(email)=lower($2)', [req.user.sub, email]);
    if (ex.rows[0]) {
      await q(`update team_members set role=$1, permissions=$2, invite_token=$3, status=case when status='active' then 'active' else 'invited' end where id=$4`,
        [b.role || 'editor', perms, token, ex.rows[0].id]);
      return { ok: true, id: ex.rows[0].id, token, reinvited: true };
    }
    const r = await q(
      `insert into team_members (owner_id, email, role, permissions, status, invite_token)
       values ($1,$2,$3,$4,'invited',$5) returning id`,
      [req.user.sub, email, b.role || 'editor', perms, token]);
    return { ok: true, id: r.rows[0].id, token };
  });

  // Update a member's permissions / role (owner only).
  app.patch('/api/team/members/:id', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {}; const sets = [], vals = []; let n = 1;
    if (Array.isArray(b.permissions)) { sets.push(`permissions=$${n++}`); vals.push(JSON.stringify(b.permissions)); }
    if (b.role) { sets.push(`role=$${n++}`); vals.push(b.role); }
    if (b.status === 'active' || b.status === 'invited') { sets.push(`status=$${n++}`); vals.push(b.status); }
    if (!sets.length) return { ok: true };
    vals.push(req.params.id); vals.push(req.user.sub);
    await q(`update team_members set ${sets.join(',')} where id=$${n++} and owner_id=$${n}`, vals);
    return { ok: true };
  });

  /**
   * Remove a membership row. Two legitimate callers, and only these two:
   *   • the OWNER — removing someone from their team, or cancelling a pending invite
   *   • the MEMBER themselves — leaving a team, or declining an invite
   *
   * The member half was missing, so accepting was one-way: a mis-clicked invite left
   * you restricted to whatever the owner had shared, with no way out except asking
   * them to remove you. Declining a pending invite was impossible for the same reason,
   * which is why test invites piled up instead of being cleared.
   *
   * Matched on user_id OR email because a PENDING invite has no user_id yet.
   */
  app.delete('/api/team/members/:id', { preHandler: requireAuth }, async (req) => {
    let email = '';
    try {
      const me = await q('select email from users where id=$1', [req.user.sub]);
      email = (me.rows[0] && me.rows[0].email) || '';
    } catch (e) { /* fall back to the token's copy */ }
    if (!email) email = req.user.email || '';

    const r = await q(
      `delete from team_members
        where id=$1 and (owner_id=$2 or user_id=$2::text or lower(email)=lower($3))`,
      [req.params.id, req.user.sub, email]);
    return { ok: true, removed: r.rowCount || 0 };
  });

  // Accept an invite — the invitee must be SIGNED IN and their email must match the
  // invite. Flips the membership to 'active' and links their user id. (The emailed
  // link lands them here; until accepted they aren't restricted.)
  app.post('/api/team/accept/:token', { preHandler: requireAuth }, async (req) => {
    const r = await q(
      `update team_members set status='active', user_id=$1, accepted_at=now()
        where invite_token=$2 and lower(email)=lower($3) and status<>'active'
        returning owner_id, permissions`,
      [req.user.sub, req.params.token, req.user.email || '']);
    if (!r.rows[0]) { return { error: 'invite not found, already used, or email mismatch' }; }
    return { ok: true, permissions: r.rows[0].permissions };
  });
}
