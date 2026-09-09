// emails.js — shared branded shells for TRANSACTIONAL mail (welcome, and future notices).
//
// Transactional/relationship email, not marketing: no List-Unsubscribe, no postal address.
// Those are CAN-SPAM requirements for commercial mail, and a welcome or a security notice
// is neither — a "unsubscribe from your account" link would be nonsense.
//
// Marketing broadcasts have their OWN shell in routes/broadcasts.js (it carries the
// unsubscribe footer + postal address the law requires there). The two are kept apart on
// purpose so the compliance footer can never leak onto transactional mail or vice versa.

const BRAND = { accent: '#604cfa', ink: '#18181b', head: '#0b0b0c', muted: '#71717a', line: '#e4e4e7', pageBg: '#f4f4f5', card: '#ffffff' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const WORDMARK_FONT = "Georgia,'Times New Roman',serif";
const APP_URL = (process.env.APP_URL || 'https://app.egful.store').replace(/\/+$/, '');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// The branded chrome. innerHtml is already-safe content. Table-based, all styles inline —
// Outlook/Gmail strip <style>, flex and inherited fonts.
function transactionalShell(innerHtml, preheader) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:${BRAND.pageBg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.pageBg}"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden">
  <tr><td style="height:4px;background:${BRAND.accent};line-height:4px;font-size:4px">&nbsp;</td></tr>
  <tr><td style="padding:26px 32px 6px 32px"><span style="font-family:${WORDMARK_FONT};font-size:26px;font-weight:600;letter-spacing:-0.5px;color:${BRAND.head}">egful</span></td></tr>
  <tr><td style="padding:12px 32px 24px 32px;font-family:${FONT};font-size:15px;line-height:1.6;color:${BRAND.ink}">${innerHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

// A primary action button, table-wrapped so Outlook renders it.
function button(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px">${esc(label)}</a>`;
}

/**
 * Welcome a brand-new seller.
 *
 * Public signup only ever creates a seller (auth.js pins the role), so this always speaks to
 * a seller: what to do first is connect a store, since nothing flows until one is linked.
 */
export function welcomeEmail(name) {
  const hi = name ? `Welcome, ${esc(name)}` : 'Welcome to EGFUL';
  const inner =
    `<p style="margin:0 0 15px;font-size:19px;font-weight:600;color:${BRAND.head}">${hi}</p>
     <p style="margin:0 0 15px">Your seller account is ready. Here's how fulfilment goes hands-off from here:</p>
     <ol style="margin:0 0 20px;padding-left:20px;color:${BRAND.ink}">
       <li style="margin-bottom:7px"><strong>Connect a store</strong> — Etsy, Shopify or TikTok Shop. Orders sync into one queue automatically.</li>
       <li style="margin-bottom:7px"><strong>Add your designs</strong> — map artwork to products once; we handle placement and print files.</li>
       <li style="margin-bottom:7px"><strong>Fund your wallet</strong> — orders print and ship, billed at clear per-order cost. Tracking is pushed back for you.</li>
     </ol>
     <p style="margin:0 0 22px">${button(APP_URL + '/dashboard', 'Connect your first store')}</p>
     <p style="margin:0;font-size:13px;color:${BRAND.muted}">Signed in already? Everything starts from your dashboard. Reply to this email if you get stuck — a real person reads it.</p>`;
  return {
    subject: 'Welcome to EGFUL — let\'s connect your first store',
    text: `${name ? 'Welcome, ' + name : 'Welcome to EGFUL'}!\n\n`
      + `Your seller account is ready. To go hands-off:\n\n`
      + `1. Connect a store (Etsy, Shopify or TikTok Shop) — orders sync into one queue.\n`
      + `2. Add your designs — map artwork to products once.\n`
      + `3. Fund your wallet — orders print, ship, and tracking is pushed back for you.\n\n`
      + `Start here: ${APP_URL}/dashboard\n\nReply to this email if you get stuck — a real person reads it.`,
    html: transactionalShell(inner, 'Your EGFUL seller account is ready — connect a store to start.'),
  };
}

/**
 * CONFIRM THE ADDRESS — a six-digit code, not a link.
 *
 * A link assumes the mail opens on the same device as the signup, and it usually does not:
 * people sign up on a laptop and read email on a phone. A code crosses that gap, and it is
 * the one thing in this message that has to survive being retyped, so it is the largest type
 * in it and it is spaced.
 *
 * NO BUTTON. There is nothing to press — a call to action next to a code is a second thing to
 * decide about, and the whole message is one instruction.
 *
 * It says what happens if they did not ask, because an unexpected confirmation code is how
 * someone finds out their address is being used by somebody else. Ignoring it IS the right
 * action here — nothing was created that they own — and saying so is what stops the email
 * reading like a threat.
 */
export function verifyEmail(code, minutes) {
  const mins = Number(minutes) || 30;
  const inner =
    `<p style="margin:0 0 15px;font-size:19px;font-weight:600;color:${BRAND.head}">Confirm your email</p>
     <p style="margin:0 0 20px">Enter this code to finish setting up your EGFUL account:</p>
     <p style="margin:0 0 20px;font-size:34px;font-weight:700;letter-spacing:7px;color:${BRAND.head};font-family:${FONT}">${esc(code)}</p>
     <p style="margin:0 0 15px;font-size:13px;color:${BRAND.muted}">The code expires in ${mins} minutes. If it does, ask for a new one from the app.</p>
     <p style="margin:0;font-size:13px;color:${BRAND.muted}">Didn't sign up? Ignore this email — nothing has been set up in your name, and the address will not be used again.</p>`;
  return {
    subject: `${code} is your EGFUL confirmation code`,
    text: `Confirm your email\n\nEnter this code to finish setting up your EGFUL account:\n\n`
      + `    ${code}\n\n`
      + `The code expires in ${mins} minutes. If it does, ask for a new one from the app.\n\n`
      + `Didn't sign up? Ignore this email — nothing has been set up in your name.`,
    /* The code in the PREHEADER too: it is the line an inbox shows beside the subject, so on
       a phone the whole job can be done without opening anything. */
    html: transactionalShell(inner, `${code} — your EGFUL confirmation code, good for ${mins} minutes.`),
  };
}

/**
 * A seller has a new reply from a HUMAN teammate on their support thread. This is what makes
 * the handoff promise ("a teammate will reply") reach them even when they're not on the app —
 * especially the after-hours case, where they escalated and left. `snippet` is the reply's
 * opening, quoted so the email stands on its own; the button drops them back into the chat.
 */
export function supportReplyEmail(name, snippet) {
  const hi = name ? esc(name) : 'there';
  const quote = snippet
    ? `<p style="margin:0 0 20px;padding:12px 14px;border-left:3px solid ${BRAND.accent};background:${BRAND.pageBg};color:${BRAND.ink};font-size:14px">${esc(snippet)}</p>`
    : '';
  const inner =
    `<p style="margin:0 0 15px;font-size:19px;font-weight:600;color:${BRAND.head}">You have a reply from EGFUL support</p>
     <p style="margin:0 0 15px">Hi ${hi}, a teammate just replied to your support conversation:</p>
     ${quote}
     <p style="margin:0 0 22px">${button(APP_URL + '/chat', 'Open the conversation')}</p>
     <p style="margin:0;font-size:13px;color:${BRAND.muted}">Reply right in the chat and we'll pick it up there.</p>`;
  return {
    subject: 'You have a reply from EGFUL support',
    text: `Hi ${name || 'there'},\n\nA teammate replied to your support conversation`
      + (snippet ? `:\n\n"${snippet}"\n\n` : '.\n\n')
      + `Open it here: ${APP_URL}/chat`,
    html: transactionalShell(inner, snippet ? String(snippet).slice(0, 120) : 'A teammate replied to your support conversation.'),
  };
}
