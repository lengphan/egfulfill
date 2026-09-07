// Shared best-effort mailer. Two transports, tried in order:
//   1) Brevo HTTP API (BREVO_API_KEY) — over HTTPS:443, so it works even when the host
//      blocks outbound SMTP ports (DigitalOcean blocks 25/465/587 by default → SMTP hangs).
//   2) SMTP (SMTP_HOST + nodemailer) — fallback for hosts where SMTP is open.
// Fully dormant until one is configured; sendMail() is then a silent best-effort no-op.

/**
 * WHO THE MAIL IS FROM — the BRAND, never the mailbox.
 *
 * An inbox lists the display name, and ours was arriving as "No Reply": the address is
 * `no-reply@egful.store`, which is correct — nobody reads replies to it — but that is a
 * fact about the MAILBOX, and a recipient scanning a list of senders needs the fact about
 * the company. Every other line in their inbox says who it is from.
 *
 * The code's own default has always been `EGFUL <…>`, so this is coming from SMTP_FROM /
 * MAIL_FROM in the environment, where somebody wrote the mailbox's name into the display
 * slot. Rather than depend on a variable that is edited by hand on a server and did not
 * survive the last rebuild, a display name that is merely a restatement of "no-reply" is
 * treated as ABSENT and the brand is used. A real name — "EGFUL Support", "EGFUL
 * Fulfilment" — is left exactly as written.
 *
 * MAIL_FROM_NAME overrides the brand for anyone who wants a different one.
 */
const BRAND = () => (process.env.MAIL_FROM_NAME || 'EGFUL').trim() || 'EGFUL';
/** Names that say what the mailbox is for rather than who is writing. */
const NO_REPLY_NAME = /^(no[-_. ]?reply|do[-_. ]?not[-_. ]?reply|noreply|donotreply|automated|system)$/i;
function parseFrom(s) {
  s = s || `${BRAND()} <no-reply@egful.store>`;
  const m = String(s).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = String(m[1] || '').replace(/^["']|["']$/g, '').trim();
    return { name: !name || NO_REPLY_NAME.test(name) ? BRAND() : name, email: m[2].trim() };
  }
  return { name: BRAND(), email: String(s).trim() };
}

// ── 1) Brevo transactional HTTP API (preferred on SMTP-blocked hosts) ──────────
async function sendViaBrevoApi(opts) {
  const key = process.env.BREVO_API_KEY;
  if (!key) return null;                          // not configured → let the next transport try
  // A caller may override the sender — bulk mail sends from the marketing subdomain so a
  // campaign that trips a spam filter can't drag down the domain password resets depend on.
  // Falls back to the transactional default when not given.
  const from = parseFrom(opts.from || process.env.SMTP_FROM || process.env.MAIL_FROM);
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
        htmlContent: opts.html || opts.text || '',
        // Custom headers. Bulk mail needs List-Unsubscribe + List-Unsubscribe-Post or
        // Gmail rejects it outright at volume, and those can only ride as headers —
        // there is no Brevo field for them. nodemailer takes `headers` natively, so
        // the two transports agree on the same option name.
        ...(opts.headers ? { headers: opts.headers } : {})
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

// Why the last send failed. sendMail() deliberately never throws (a failed invite email
// must not fail the invite), but swallowing the reason made a failure undiagnosable:
// /api/team/test-email could only report `sent:false, error:null`, which says nothing
// about WHY — an invalid key and an unverified sender looked identical. Brevo returns a
// precise message; keep it so the diagnostic can show it.
let _lastError = null;
export function lastMailError() { return _lastError; }

// Send an email; returns true if a transport accepted it, false if email is off /
// failed. Never throws — inspect lastMailError() for the reason.
export async function sendMail(opts) {
  opts = opts || {};
  _lastError = null;
  // 1) HTTP API first (works through SMTP blocks).
  try {
    const r = await sendViaBrevoApi(opts);
    if (r === true) return true;
    // r === null → API not configured; fall through to SMTP.
  } catch (e) {
    _lastError = 'brevo: ' + (e && e.message ? e.message : String(e));
  }
  // 2) SMTP.
  try {
    const m = await getMailer();
    if (!m) {
      // No SMTP fallback configured, so the Brevo failure above is the whole story.
      if (!_lastError) _lastError = 'no transport configured (set BREVO_API_KEY or SMTP_HOST)';
      return false;
    }
    await m.sendMail(Object.assign(
      // Through parseFrom as well, so the SMTP path and the API path cannot disagree about
      // the name an inbox shows. Rebuilt into one header rather than passed raw.
      { from: (() => { const f = parseFrom(opts.from || process.env.SMTP_FROM || process.env.MAIL_FROM || ('no-reply@' + process.env.SMTP_HOST)); return `${f.name} <${f.email}>`; })() }, opts));
    return true;
  } catch (e) {
    _lastError = (_lastError ? _lastError + ' | ' : '') + 'smtp: ' + (e && e.message ? e.message : String(e));
    return false;
  }
}
