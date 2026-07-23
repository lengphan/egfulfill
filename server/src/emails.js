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
  <tr><td style="padding:26px 32px 6px 32px"><span style="font-family:${WORDMARK_FONT};font-size:26px;font-weight:600;letter-spacing:-0.5px;color:${BRAND.head}">egfulfill</span></td></tr>
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
  const hi = name ? `Welcome, ${esc(name)}` : 'Welcome to EGFULFILL';
  const inner =
    `<p style="margin:0 0 15px;font-size:19px;font-weight:600;color:${BRAND.head}">${hi} 👋</p>
     <p style="margin:0 0 15px">Your seller account is ready. Here's how fulfilment goes hands-off from here:</p>
     <ol style="margin:0 0 20px;padding-left:20px;color:${BRAND.ink}">
       <li style="margin-bottom:7px"><strong>Connect a store</strong> — Etsy, Shopify or TikTok Shop. Orders sync into one queue automatically.</li>
       <li style="margin-bottom:7px"><strong>Add your designs</strong> — map artwork to products once; we handle placement and print files.</li>
       <li style="margin-bottom:7px"><strong>Fund your wallet</strong> — orders print and ship, billed at clear per-order cost. Tracking is pushed back for you.</li>
     </ol>
     <p style="margin:0 0 22px">${button(APP_URL + '/dashboard', 'Connect your first store')}</p>
     <p style="margin:0;font-size:13px;color:${BRAND.muted}">Signed in already? Everything starts from your dashboard. Reply to this email if you get stuck — a real person reads it.</p>`;
  return {
    subject: 'Welcome to EGFULFILL — let\'s connect your first store',
    text: `${name ? 'Welcome, ' + name : 'Welcome to EGFULFILL'}!\n\n`
      + `Your seller account is ready. To go hands-off:\n\n`
      + `1. Connect a store (Etsy, Shopify or TikTok Shop) — orders sync into one queue.\n`
      + `2. Add your designs — map artwork to products once.\n`
      + `3. Fund your wallet — orders print, ship, and tracking is pushed back for you.\n\n`
      + `Start here: ${APP_URL}/dashboard\n\nReply to this email if you get stuck — a real person reads it.`,
    html: transactionalShell(inner, 'Your EGFULFILL seller account is ready — connect a store to start.'),
  };
}
