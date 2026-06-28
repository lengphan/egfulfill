// Shared best-effort mailer. Mirrors the SMTP setup in password-reset.js so other
// routes (team invites) can send email WITHOUT touching that file. Completely
// dormant until SMTP_* env vars are set — getMailer() returns null and sendMail()
// is a silent no-op, so nothing breaks when email isn't configured.
let _mailer = null;
export async function getMailer() {
  if (!process.env.SMTP_HOST) return null;        // email path off until SMTP creds are set
  if (_mailer) return _mailer;
  try {
    const nodemailer = (await import('nodemailer')).default;
    _mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: String(process.env.SMTP_SECURE || '') === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined
    });
    return _mailer;
  } catch (e) { return null; }
}
// Send an email; returns true if delivered, false if email is off / failed. Never throws.
export async function sendMail(opts) {
  try {
    const m = await getMailer();
    if (!m) return false;
    await m.sendMail(Object.assign(
      { from: process.env.SMTP_FROM || ('EGFULFILL <no-reply@' + process.env.SMTP_HOST + '>') },
      opts || {}));
    return true;
  } catch (e) { return false; }
}
