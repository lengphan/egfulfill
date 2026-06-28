// Shared best-effort mailer. Two transports, tried in order:
//   1) Brevo HTTP API (BREVO_API_KEY) — over HTTPS:443, so it works even when the host
//      blocks outbound SMTP ports (DigitalOcean blocks 25/465/587 by default → SMTP hangs).
//   2) SMTP (SMTP_HOST + nodemailer) — fallback for hosts where SMTP is open.
// Fully dormant until one is configured; sendMail() is then a silent best-effort no-op.

function parseFrom(s) {
  s = s || 'EGFULFILL <no-reply@egful.store>';
  const m = String(s).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || 'EGFULFILL', email: m[2] };
  return { name: 'EGFULFILL', email: String(s).trim() };
}

// ── 1) Brevo transactional HTTP API (preferred on SMTP-blocked hosts) ──────────
async function sendViaBrevoApi(opts) {
  const key = process.env.BREVO_API_KEY;
  if (!key) return null;                          // not configured → let the next transport try
  const from = parseFrom(process.env.SMTP_FROM || process.env.MAIL_FROM);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        sender: { email: from.email, name: from.name },
        to: [{ email: opts.to }],
        subject: opts.subject || '',
        htmlContent: opts.html || opts.text || ''
      }),
      signal: ctrl.signal
    });
    if (r.ok) return true;
    let detail = ''; try { detail = (await r.text()).slice(0, 200); } catch (e) {}
    throw new Error('Brevo API ' + r.status + ' ' + detail);
  } finally { clearTimeout(t); }
}

// ── 2) SMTP fallback (nodemailer) ─────────────────────────────────────────────
let _mailer = null;
async function getMailer() {
  if (!process.env.SMTP_HOST) return null;
  if (_mailer) return _mailer;
  try {
    const nodemailer = (await import('nodemailer')).default;
    _mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: String(process.env.SMTP_SECURE || '') === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
      connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000
    });
    return _mailer;
  } catch (e) { return null; }
}

export function mailConfigured() { return !!(process.env.BREVO_API_KEY || process.env.SMTP_HOST); }

// Send an email; returns true if a transport accepted it, false if email is off /
// failed. Never throws. Throwing inside is caught and surfaced via the return value.
export async function sendMail(opts) {
  opts = opts || {};
  // 1) HTTP API first (works through SMTP blocks).
  try {
    const r = await sendViaBrevoApi(opts);
    if (r === true) return true;
    // r === null → API not configured; fall through to SMTP.
  } catch (e) { /* API failed → try SMTP */ }
  // 2) SMTP.
  try {
    const m = await getMailer();
    if (!m) return false;
    await m.sendMail(Object.assign(
      { from: process.env.SMTP_FROM || ('EGFULFILL <no-reply@' + process.env.SMTP_HOST + '>') }, opts));
    return true;
  } catch (e) { return false; }
}
