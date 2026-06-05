// Password reset — two delivery paths from one /api/auth/forgot request:
//
//   1) Admin-mediated (always on): every request is recorded as a row staff can
//      see (GET /api/auth/reset-requests) and resolve by setting a new password
//      (POST .../resolve) which the admin then shares with the user.
//   2) Email link (auto-on when SMTP_* env is set): /api/auth/forgot also emails a
//      one-time link to reset-password.html?token=…; POST /api/auth/reset completes
//      it. No admin action needed.
//
// /api/auth/forgot never reveals whether an email exists (same response either way).
import crypto from 'crypto';
import { q } from '../db.js';
import { hashPassword } from '../auth.js';

const APP_URL = (process.env.APP_URL || 'https://egful.store').replace(/\/+$/, '');
const SMTP_HOST = process.env.SMTP_HOST || '';

let _mailer = null;
async function getMailer(app) {
  if (!SMTP_HOST) return null;          // email path off until SMTP creds are set
  if (_mailer) return _mailer;
  try {
    const nodemailer = (await import('nodemailer')).default;
    _mailer = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: String(process.env.SMTP_SECURE || '') === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined
    });
    return _mailer;
  } catch (e) { if (app) app.log.error('nodemailer unavailable: ' + e.message); return null; }
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

  // PUBLIC: request a reset. Records a row (admin path) + emails a link (if SMTP on).
  app.post('/api/auth/forgot', async (req, reply) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 0) { reply.code(400); return { error: 'Invalid email' }; }
    try {
      const u = await q('select id, email from users where lower(email)=$1 limit 1', [email]);
      const user = u.rows[0];
      if (user) {
        const token = crypto.randomBytes(24).toString('hex');
        await q(
          "insert into password_resets (user_id, email, token, status, expires_at) values ($1,$2,$3,'pending', now() + interval '1 hour')",
          [user.id, user.email, token]
        );
        const mailer = await getMailer(app);
        if (mailer) {
          const link = APP_URL + '/reset-password.html?token=' + token;
          try {
            await mailer.sendMail({
              from: process.env.SMTP_FROM || ('EGFULFILL <no-reply@' + SMTP_HOST + '>'),
              to: user.email,
              subject: 'Reset your EGFULFILL password',
              text: 'Reset your password using this link (valid for 1 hour):\n\n' + link + '\n\nIf you did not request this, ignore this email.',
              html: '<p>Reset your EGFULFILL password (link valid for 1 hour):</p><p><a href="' + link + '">' + link + '</a></p><p style="color:#888;font-size:12px">If you did not request this, ignore this email.</p>'
            });
          } catch (e) { app.log.error('reset email failed: ' + e.message); }
        }
      }
    } catch (e) { /* never leak failures */ }
    return { ok: true, message: GENERIC };
  });

  // PUBLIC: complete a reset via the emailed one-time token.
  app.post('/api/auth/reset', async (req, reply) => {
    const b = req.body || {};
    const token = String(b.token || '').trim();
    const password = String(b.password || '');
    if (!token || password.length < 6) { reply.code(400); return { error: 'A token and a password of at least 6 characters are required' }; }
    const r = await q("select * from password_resets where token=$1 and status='pending' and expires_at > now() limit 1", [token]);
    const row = r.rows[0];
    if (!row) { reply.code(400); return { error: 'This reset link is invalid or has expired. Request a new one.' }; }
    const hash = await hashPassword(password);
    await q('update users set password_hash=$1 where id=$2', [hash, row.user_id]);
    await q("update password_resets set status='used', resolved_at=now() where id=$1", [row.id]);
    return { ok: true };
  });

  // STAFF: pending reset requests for the admin-mediated flow.
  app.get('/api/auth/reset-requests', { preHandler: requireStaff }, async () => {
    const r = await q("select id, email, status, created_at from password_resets where status='pending' order by created_at desc limit 100");
    return r.rows;
  });

  // STAFF: set a new password for a request's user + mark resolved.
  app.post('/api/auth/reset-requests/:id/resolve', { preHandler: requireStaff }, async (req, reply) => {
    const password = String((req.body || {}).password || '');
    if (password.length < 6) { reply.code(400); return { error: 'Password must be at least 6 characters' }; }
    const r = await q("select * from password_resets where id=$1 and status='pending' limit 1", [req.params.id]);
    const row = r.rows[0];
    if (!row) { reply.code(404); return { error: 'Not found or already handled' }; }
    const hash = await hashPassword(password);
    await q('update users set password_hash=$1 where id=$2', [hash, row.user_id]);
    await q("update password_resets set status='resolved', resolved_at=now(), resolved_by=$2 where id=$1", [req.params.id, req.user.sub]);
    return { ok: true, email: row.email };
  });

  // STAFF: dismiss a request (e.g. spurious).
  app.post('/api/auth/reset-requests/:id/reject', { preHandler: requireStaff }, async (req, reply) => {
    const r = await q("update password_resets set status='rejected', resolved_at=now(), resolved_by=$2 where id=$1 and status='pending' returning id", [req.params.id, req.user.sub]);
    if (!r.rows[0]) { reply.code(404); return { error: 'Not found or already handled' }; }
    return { ok: true };
  });
}
