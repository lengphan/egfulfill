// Password reset — two delivery paths from one /api/auth/forgot request:
//
//   1) Admin-mediated (always on): every request is recorded as a row staff can
//      see (GET /api/auth/reset-requests) and resolve by setting a new password
//      (POST .../resolve) which the admin then shares with the user.
//   2) Email link: /api/auth/forgot also emails a one-time link to
//      /reset-password?token=…; POST /api/auth/reset completes it. No admin action needed.
//
// The email goes through the SHARED mailer (Brevo HTTP API first), NOT a private SMTP
// transport. This file used to own a nodemailer/SMTP mailer that returned null unless
// SMTP_HOST was set — but the droplet BLOCKS outbound SMTP, so that path could never
// deliver: a seller who forgot their password got a row in the admin queue and no email.
// The shared sendMail() reaches Brevo over 443, which is the only transport that works here.
//
// /api/auth/forgot never reveals whether an email exists (same response either way).
import crypto from 'crypto';
import { q } from '../db.js';
import { hashPassword, passwordProblem, canManageUsers } from '../auth.js';
import { limited } from '../ratelimit.js';
import { sendMail } from '../mailer.js';

// The REACT app — email links must land where the /reset-password route exists.
const APP_URL = (process.env.APP_URL || 'https://app.egful.store').replace(/\/+$/, '');

// Branded transactional shell. Deliberately has NO unsubscribe footer: a password reset is
// transactional, not marketing, so it's exempt from CAN-SPAM's address/unsubscribe rules —
// and letting someone "unsubscribe" from their own account security would be a mistake.
function resetEmail(link) {
  const text = 'Reset your EGFUL password using this link (valid for 1 hour):\n\n' + link
    + '\n\nIf you did not request this, ignore this email — your password stays the same.';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden">
  <tr><td style="height:4px;background:#604cfa;line-height:4px;font-size:4px">&nbsp;</td></tr>
  <tr><td style="padding:26px 32px 6px 32px"><span style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;letter-spacing:-0.5px;color:#0b0b0c">egful</span></td></tr>
  <tr><td style="padding:12px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#18181b">
    <p style="margin:0 0 15px">Someone asked to reset the password for your EGFUL account.</p>
    <p style="margin:0 0 20px">Click below to set a new one. The link is valid for <strong>one hour</strong>.</p>
    <p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#604cfa;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px">Reset your password</a></p>
    <p style="margin:0 0 6px;font-size:13px;color:#71717a">Or paste this link into your browser:</p>
    <p style="margin:0 0 15px;font-size:13px"><a href="${link}" style="color:#604cfa;word-break:break-all">${link}</a></p>
  </td></tr>
  <tr><td style="padding:16px 32px 30px 32px;border-top:1px solid #e4e4e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:#71717a">
    If you didn't request this, you can ignore this email — your password won't change.
  </td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export function passwordResetRoutes(app, requireAuth, requireStaff) {
  q(`create table if not exists password_resets (
       id uuid primary key default gen_random_uuid(),
       user_id uuid references users(id) on delete cascade,
       email text,
       token text,
       status text not null default 'pending',   -- pending | used | resolved | rejected
       created_at timestamptz default now(),
       expires_at timestamptz,
       resolved_at timestamptz,
       resolved_by uuid)`).catch(() => {});

  const GENERIC = "If an account exists for that email, a reset has been started — check your email for a link, or you'll be contacted with a new password shortly.";

  // The reset-request trio writes users.password_hash, so it follows the /api/users rule
  // rather than the broader requireStaff it used to carry. requireStaff admits operator
  // and designer, which made this a two-call escalation from the lowest staff role:
  // POST /api/auth/forgot {admin email} (public) → GET reset-requests → resolve → log in
  // as admin. users.js was already written to block exactly this; this file was a second
  // door around it into the same column.
  const requireUserManager = async (req, reply) => {
    if (!canManageUsers(req.user)) { reply.code(403); return reply.send({ error: 'Admin only' }); }
  };
  /** Warehouse shares the chores but must not be able to take an admin account. */
  const adminTargetBlocked = async (req, reply, userId) => {
    if (req.user.role === 'admin') return false;
    const target = await q('select role from users where id=$1', [userId]).then((r) => r.rows[0]);
    if (target && target.role === 'admin') {
      reply.code(403); reply.send({ error: 'Only an admin can reset an admin account' });
      return true;
    }
    return false;
  };

  // PUBLIC: request a reset. Records a row (admin path) + emails a link (if SMTP on).
  app.post('/api/auth/forgot', async (req, reply) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 0) { reply.code(400); return { error: 'Invalid email' }; }
    // Same brute-force guard as login. This route answers identically whether or not the
    // address exists — which is right — but unthrottled it is still a free way to spray
    // reset mail at a list of addresses, and every hit that DOES match sends a real email
    // from our sender reputation.
    {
      const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
      const stop = limited(reply, `auth-ip:${ip}`, 20, 10 * 60 * 1000)
        || limited(reply, `auth-id:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 24)}`, 5, 10 * 60 * 1000);
      if (stop) return stop;
    }
    try {
      const u = await q('select id, email from users where lower(email)=$1 limit 1', [email]);
      const user = u.rows[0];
      if (user) {
        const token = crypto.randomBytes(24).toString('hex');
        await q(
          "insert into password_resets (user_id, email, token, status, expires_at) values ($1,$2,$3,'pending', now() + interval '1 hour')",
          [user.id, user.email, token]
        );
        // Path, not /reset-password.html: APP_URL points at the REACT app, where the route
        // is /reset-password (it reads the same ?token=). The .html suffix would 404 on
        // Vercel and break every reset email.
        const link = APP_URL + '/reset-password?token=' + token;
        const { text, html } = resetEmail(link);
        // sendMail is best-effort and never throws — a false return (no transport) still
        // leaves the admin-mediated row in place as the fallback path.
        const sent = await sendMail({ to: user.email, subject: 'Reset your EGFUL password', text, html });
        if (!sent) app.log.warn('password reset email not sent (no transport / send failed) for ' + user.email);
      }
    } catch (e) { /* never leak failures */ }
    return { ok: true, message: GENERIC };
  });

  // PUBLIC: complete a reset via the emailed one-time token.
  app.post('/api/auth/reset', async (req, reply) => {
    const b = req.body || {};
    const token = String(b.token || '').trim();
    const password = String(b.password || '');
    if (!token) { reply.code(400); return { error: 'A token and a new password are required' }; }
    const r = await q("select * from password_resets where token=$1 and status='pending' and expires_at > now() limit 1", [token]);
    const row = r.rows[0];
    if (!row) { reply.code(400); return { error: 'This reset link is invalid or has expired. Request a new one.' }; }
    // Validated AFTER the token is resolved, so the rule can be checked against the account's
    // own name and address. The old floor here was six characters — three below signup's —
    // which made "forgot password" the cheapest way to weaken any account on the platform.
    const u = await q('select email, name, username from users where id=$1', [row.user_id]).then((x) => x.rows[0] || {});
    const weak = passwordProblem(password, u);
    if (weak) { reply.code(400); return { error: weak }; }
    const hash = await hashPassword(password);
    await q('update users set password_hash=$1 where id=$2', [hash, row.user_id]);
    await q("update password_resets set status='used', resolved_at=now() where id=$1", [row.id]);
    return { ok: true };
  });

  // STAFF: pending reset requests for the admin-mediated flow.
  app.get('/api/auth/reset-requests', { preHandler: requireUserManager }, async () => {
    const r = await q("select id, email, status, created_at from password_resets where status='pending' order by created_at desc limit 100");
    return r.rows;
  });

  // STAFF: set a new password for a request's user + mark resolved.
  app.post('/api/auth/reset-requests/:id/resolve', { preHandler: requireUserManager }, async (req, reply) => {
    const password = String((req.body || {}).password || '');
    const r = await q("select * from password_resets where id=$1 and status='pending' limit 1", [req.params.id]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'Not found or already handled' }; }
    if (await adminTargetBlocked(req, reply, row.user_id)) return;
    // Same rule as every other door, checked against the TARGET's identity — a staff-set
    // password is still that person's password.
    const u = await q('select email, name, username from users where id=$1', [row.user_id]).then((x) => x.rows[0] || {});
    const weak = passwordProblem(password, u);
    if (weak) { reply.code(400); return { error: weak }; }
    const hash = await hashPassword(password);
    await q('update users set password_hash=$1 where id=$2', [hash, row.user_id]);
    await q("update password_resets set status='resolved', resolved_at=now(), resolved_by=$2 where id=$1", [req.params.id, req.user.sub]);
    return { ok: true, email: row.email };
  });

  // STAFF: dismiss a request (e.g. spurious).
  app.post('/api/auth/reset-requests/:id/reject', { preHandler: requireUserManager }, async (req, reply) => {
    const r = await q("update password_resets set status='rejected', resolved_at=now(), resolved_by=$2 where id=$1 and status='pending' returning id", [req.params.id, req.user.sub]);
    if (!r.rows[0]) { reply.code(404); return { error: 'Not found or already handled' }; }
    return { ok: true };
  });
}
