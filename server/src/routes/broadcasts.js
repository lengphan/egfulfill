// broadcasts.js — one-to-many email to sellers: draft, resolve an audience, send, and
// keep a record of who sent what to how many.
//
// Deliberately NOT called "campaigns". /api/ads already owns that word for Meta/Google ad
// campaigns, which spend money outward and have nothing to do with mail. Two features
// sharing a noun is how someone ends up pausing the wrong thing.
//
// The two rules that shape everything below:
//
//   1. The audience is resolved AT SEND, never read back from the draft. Someone who
//      unsubscribes between drafting on Monday and sending on Friday must not receive it,
//      and a stored recipient list would happily post to them.
//   2. Unsubscribe is one click and needs no login. RFC 8058 one-click (List-Unsubscribe +
//      List-Unsubscribe-Post) is what Gmail enforces for bulk senders, and it POSTs from
//      their infrastructure with no cookie — so the link carries its own proof.

import crypto from 'node:crypto';
import { q } from '../db.js';
import { sendMail, mailConfigured, lastMailError } from '../mailer.js';
import { audit } from '../audit.js';

// Where the unsubscribe link points. Must be a host Caddy proxies /api/* to Fastify on —
// NOT app.egful.store, which is Vercel and would 404 the whole path.
function publicOrigin() {
  return process.env.PUBLIC_API_ORIGIN || 'https://egful.store';
}

// ── Unsubscribe tokens ────────────────────────────────────────────────────────
// An HMAC over the user id rather than a stored token column: nothing to generate, nothing
// to backfill for existing sellers, and nothing to leak from the database. It cannot be
// enumerated (you'd need JWT_SECRET) and it does not expire, which is correct — an
// unsubscribe link in a year-old email must still work.
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function unsubToken(userId) {
  const secret = process.env.JWT_SECRET || '';
  const id = String(userId);
  const mac = crypto.createHmac('sha256', secret).update('unsub:' + id).digest();
  return b64url(id) + '.' + b64url(mac).slice(0, 27);
}
function verifyUnsubToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  let id;
  try { id = Buffer.from(parts[0], 'base64url').toString('utf8'); } catch (e) { return null; }
  if (!id) return null;
  const want = unsubToken(id).split('.')[1];
  // Constant-time: a token check that short-circuits on the first wrong byte is a
  // forgery oracle, and this endpoint is public and unrated.
  const a = Buffer.from(parts[1]), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

let _ready = null;
function ensureTables() {
  if (_ready) return _ready;
  _ready = (async () => {
    await q(`create table if not exists broadcasts (
      id              bigserial primary key,
      subject         text not null,
      body            text not null,
      audience        jsonb not null default '{}',   -- {} = every seller
      status          text not null default 'draft', -- draft|sending|sent|failed
      recipient_count integer,                       -- resolved at send, not at draft
      sent_count      integer not null default 0,
      failed_count    integer not null default 0,
      created_by      text,
      created_by_name text,
      created_at      timestamptz default now(),
      sent_at         timestamptz
    )`).catch(() => {});
    await q('create index if not exists broadcasts_created_idx on broadcasts(created_at desc)').catch(() => {});
  // WHY a send failed, kept on the row. It was only ever written to the server log — so the
  // screen said "failed" and the one fact that makes it fixable (an unverified sender, a
  // rejected key, a rate limit) lived on a box nobody sending a broadcast is reading.
  await q('alter table broadcasts add column if not exists last_error text').catch(() => {});
  // OPT-OUT FOR ADDRESSES THAT ARE NOT SELLERS.
  //
  // A seller unsubscribes by having marketing_opt_out set on their users row. An address
  // typed into a broadcast by hand has no row, so that mechanism cannot represent it — and
  // mailing marketing to someone whose unsubscribe link silently does nothing is the one
  // part of the message that has to work. Keyed by email, lowercased, so it holds for any
  // recipient regardless of whether an account exists now or later.
  await q(`create table if not exists broadcast_suppressions (
       email      text primary key,
       created_at timestamptz not null default now(),
       source     text)`).catch(() => {});
    // Marketing opt-out is its own flag, NOT `active`. Unsubscribing from broadcasts must
    // never stop a password reset or a top-up receipt arriving — those are transactional,
    // the seller asked for them, and silently swallowing them reads as a broken account.
    await q('alter table users add column if not exists marketing_opt_out boolean not null default false').catch(() => {});
    await q('alter table users add column if not exists marketing_opt_out_at timestamptz').catch(() => {});
  })();
  return _ready;
}

// ── Audience ──────────────────────────────────────────────────────────────────
// {} means every seller. Every filter narrows; none widens past role='seller', so no
// combination can post staff mail to a seller list or vice versa.
function audienceSql(aud) {
  aud = aud && typeof aud === 'object' ? aud : {};
  const where = [
    "role = 'seller'",
    "email is not null and email <> ''",
    'coalesce(marketing_opt_out, false) = false',
  ];
  const vals = [];
  // Default to active-only. A deactivated account is one we've shut off; mailing it a
  // promotion is the wrong message to the wrong person.
  if (aud.includeInactive !== true) where.push('active = true');
  if (aud.hasOrders === true) where.push('exists (select 1 from orders o where o.seller_id = users.id)');
  if (aud.hasOrders === false) where.push('not exists (select 1 from orders o where o.seller_id = users.id)');
  if (Array.isArray(aud.sellerIds) && aud.sellerIds.length) {
    vals.push(aud.sellerIds.map(String));
    where.push(`id = any($${vals.length}::uuid[])`);
  }
  // Recipients struck off by hand on the confirm screen. Narrows like every other filter,
  // so it can only ever remove people — there is no combination that widens past
  // role='seller'.
  if (Array.isArray(aud.excludeIds) && aud.excludeIds.length) {
    vals.push(aud.excludeIds.map(String));
    where.push(`id <> all($${vals.length}::uuid[])`);
  }
  return { sql: where.join(' and '), vals };
}

// Deliberately loose — this is a "could this possibly be delivered" check, not RFC 5322.
// It exists to catch the address that makes Brevo answer "email is not valid in to", which
// costs a send and reads as a broadcast failure. Anything plausible passes; the transport
// remains the real judge.
const validEmail = (e) => /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(String(e || '').trim());

/**
 * Everyone this broadcast goes to: the audience query, plus any addresses typed in by hand,
 * minus anyone on the email suppression list.
 *
 * `sub` is what the unsubscribe token is signed over. A seller's is their user id — the
 * same value tokens have always carried, so links in mail already delivered keep working.
 * A typed-in address gets `e:<email>`, which the unsubscribe route routes to the
 * suppression table instead of a users row.
 */
async function resolveRecipients(aud) {
  aud = aud && typeof aud === 'object' ? aud : {};
  const { sql, vals } = audienceSql(aud);
  const r = await q(`select id, email, name from users where ${sql} order by created_at asc`, vals);
  const out = r.rows.map((x) => ({ id: x.id, email: x.email, name: x.name, sub: String(x.id), extra: false }));

  const seen = new Set(out.map((x) => String(x.email || '').trim().toLowerCase()));
  for (const raw of (Array.isArray(aud.extraEmails) ? aud.extraEmails : [])) {
    const email = String(raw || '').trim();
    const key = email.toLowerCase();
    // Never mail the same person twice because they were also typed in by hand.
    if (!email || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: null, email, name: null, sub: 'e:' + key, extra: true });
  }

  // The suppression list is authoritative over BOTH sources. A seller who opted out is
  // already filtered by audienceSql; this also catches an address that opted out before it
  // ever had an account, and a hand-typed one that opted out of an earlier send.
  const emails = out.map((x) => String(x.email || '').trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return out;
  const sup = await q('select email from broadcast_suppressions where email = any($1::text[])', [emails])
    .catch(() => ({ rows: [] }));
  const blocked = new Set(sup.rows.map((x) => x.email));
  return out.filter((x) => !blocked.has(String(x.email || '').trim().toLowerCase()));
}

// ── Body rendering ────────────────────────────────────────────────────────────
// The body is authored as PLAIN TEXT and escaped here. Letting staff paste raw HTML into
// something that fans out to every seller is a foot-gun with no upside: one unclosed tag
// swallows the unsubscribe footer, and the footer is the legally required part.
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Brand tokens as HEX, because email clients don't understand the oklch() the app theme is
// authored in. Converted once from web/app/globals.css --primary oklch(0.55 0.245 280).
const BRAND = {
  accent: '#604cfa', // --primary, the one violet flourish
  ink: '#18181b', head: '#0b0b0c', muted: '#71717a', faint: '#a1a1aa',
  line: '#e4e4e7', pageBg: '#f4f4f5', card: '#ffffff',
};
// The whole email is one font family, declared on every text cell rather than once at the
// top: Outlook and Gmail both drop inherited font-family in places, so "declare it once"
// silently falls back to Times in exactly the clients that matter most.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
// The wordmark echoes the app's Fraunces (font-display) with a serif stack — Fraunces
// itself can't be webfont-loaded in mail, but the editorial serif character carries.
const WORDMARK_FONT = "Georgia,'Times New Roman',serif";

// Physical postal address in the footer. CAN-SPAM (US) REQUIRES one on marketing mail, and
// Gmail's bulk-sender rules expect it — its absence is a deliverability risk, not a nicety.
// Configurable because it's a business fact, not a code constant; the fallback is a legal
// stopgap, not a real address (see the note surfaced to the user).
function postalAddress() {
  return process.env.MAIL_POSTAL_ADDRESS || 'EGFULFILL · egful.store';
}

// Autolink bare http(s) URLs AFTER escaping, so the source is still fully escaped and only
// a URL shape becomes a link. A marketing mail almost always carries one, and a raw
// https://… that isn't clickable reads as broken.
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g,
    (u) => `<a href="${u}" style="color:${BRAND.accent};text-decoration:underline">${u}</a>`);
}

// ── Email branding (admin-editable, global) ────────────────────────────────────
// One row in `settings` under 'email_branding' overrides the BRAND defaults at SEND time,
// so a logo / accent / footer set in the UI reaches every broadcast with no deploy. Kept
// deliberately small: a preset only changes the CHROME (accent rule + how the header reads),
// never the body/footer layout, so a theme can't break the legally-required unsubscribe
// footer. Read at send time, and every field is validated because it feeds raw into HTML.
const EMAIL_BRANDING_KEY = 'email_branding';
const EMAIL_PRESETS = {
  branded: { accentBar: true, header: 'wordmark' },
  minimal: { accentBar: false, header: 'wordmark' },
  bold: { accentBar: false, header: 'block' },
};
function cleanBranding(v) {
  const o = (v && typeof v === 'object') ? v : {};
  return {
    preset: EMAIL_PRESETS[o.preset] ? o.preset : 'branded',
    accent: typeof o.accent === 'string' && /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : BRAND.accent,
    // https only: storage URLs are https, and it lands unescaped in a src attribute.
    logoUrl: typeof o.logoUrl === 'string' && /^https:\/\//i.test(o.logoUrl) ? o.logoUrl : '',
    heading: typeof o.heading === 'string' && o.heading.trim() ? o.heading.trim().slice(0, 40) : 'egfulfill',
    footerNote: typeof o.footerNote === 'string' ? o.footerNote.trim().slice(0, 200) : '',
  };
}
async function getEmailBranding() {
  try {
    const r = await q('select value from settings where key = $1', [EMAIL_BRANDING_KEY]);
    return cleanBranding(r.rows[0] && r.rows[0].value);
  } catch { return cleanBranding(null); }
}

// The branded shell. innerHtml is the already-safe message body; everything around it is
// chrome, driven by the (validated) branding. Kept as one function so header/footer live in
// a single place.
function emailShell(innerHtml, unsubUrl, preheader, brand) {
  const b = cleanBranding(brand);
  const preset = EMAIL_PRESETS[b.preset] || EMAIL_PRESETS.branded;
  const header = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.heading)}" height="34" style="height:34px;max-height:36px;width:auto;border:0;display:block">`
    : `<span style="font-family:${WORDMARK_FONT};font-size:26px;font-weight:600;letter-spacing:-0.5px;color:${preset.header === 'block' ? '#ffffff' : BRAND.head}">${esc(b.heading)}</span>`;
  const headerRow = preset.header === 'block'
    ? `<tr><td style="padding:22px 32px;background:${b.accent}">${header}</td></tr>`
    : `<tr><td style="padding:26px 32px 6px 32px">${header}</td></tr>`;
  const accentBar = preset.accentBar
    ? `<tr><td style="height:4px;background:${b.accent};line-height:4px;font-size:4px">&nbsp;</td></tr>`
    : '';
  const footerNote = b.footerNote
    ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.55;color:${BRAND.muted}">${linkify(esc(b.footerNote))}</p>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:${BRAND.pageBg};-webkit-text-size-adjust:100%">
<!-- Preheader: the inbox-preview line. Hidden in the body, but it's what shows next to the
     subject in the list, so it's the first thing read. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.pageBg}">
<tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden">
  ${accentBar}
  ${headerRow}
  <!-- Body -->
  <tr><td style="padding:12px 32px 8px 32px;font-family:${FONT};font-size:15px;line-height:1.6;color:${BRAND.ink}">
    ${innerHtml}
  </td></tr>
  <!-- Footer. The unsubscribe line + postal address are REQUIRED and are never themed away. -->
  <tr><td style="padding:22px 32px 30px 32px;border-top:1px solid ${BRAND.line}">
    ${footerNote}
    <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.55;color:${BRAND.muted}">
      You're receiving this because you have an EGFULFILL seller account.
      <a href="${esc(unsubUrl)}" style="color:${BRAND.muted};text-decoration:underline">Unsubscribe from updates like this</a>.
      Emails about your account and orders will still reach you.
    </p>
    <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.55;color:${BRAND.faint}">${esc(postalAddress())}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function renderHtml(body, name, unsubUrl, brand) {
  const greeting = name ? `Hi ${esc(name)},` : 'Hi,';
  const paras = String(body).split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 15px">${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`).join('');
  const inner = `<p style="margin:0 0 15px">${greeting}</p>${paras}`;
  // Preheader = the first line of the body, so the inbox preview shows the message's own
  // opening rather than the greeting or, worse, the hidden-div fallback some clients grab.
  const preheader = String(body).replace(/\s+/g, ' ').trim().slice(0, 140);
  return emailShell(inner, unsubUrl, preheader, brand);
}

function renderText(body, name, unsubUrl) {
  return `${name ? 'Hi ' + name + ',' : 'Hi,'}\n\n${body}\n\n---\nYou're receiving this because you have an EGFULFILL seller account.\nUnsubscribe from updates like this: ${unsubUrl}\nAccount and order emails will still reach you.`;
}

/**
 * @param requireDraft  read + draft: anyone on the team can write one
 * @param requireAdmin  the send itself. See the note on POST /:id/send.
 */
// ADMIN-only to draft, as well as to send. Sending was already admin-gated, but drafting
// let any staff account compose mail to the ENTIRE seller list and read the audience — the
// draft is most of the blast radius.
export function broadcastsRoutes(app, requireDraft, requireAdmin) {
  ensureTables();

  // ── PUBLIC. No preHandler, by design: Gmail's one-click POSTs from their own
  // infrastructure with no cookie and no bearer token, and a human clicking the link in a
  // mail client is not logged in either. The HMAC in the token is the whole authorisation.
  const doUnsubscribe = async (token) => {
    const sub = verifyUnsubToken(token);
    if (!sub) return false;
    await ensureTables();

    // TWO KINDS OF SUBJECT, one token format.
    //
    // A seller's token is signed over their user id and always has been — so every link in
    // mail already delivered keeps working, unchanged. An address typed into a broadcast by
    // hand has no user row to flag, so its token carries `e:<email>` and lands in the
    // suppression table instead. Both are the same HMAC; only the subject differs.
    if (sub.startsWith('e:')) {
      const email = sub.slice(2).trim().toLowerCase();
      if (!email) return false;
      await q(
        `insert into broadcast_suppressions (email, source) values ($1, 'one-click')
           on conflict (email) do nothing`, [email]).catch(() => {});
      audit(null, 'broadcast.suppressed', {
        entityType: 'email', entityId: email, actor: email, actorRole: 'system',
        note: 'One-click unsubscribe from a broadcast (address is not a seller account)',
      });
      return true;
    }

    await q('update users set marketing_opt_out = true, marketing_opt_out_at = now() where id = $1::uuid', [sub]).catch(() => {});
    // Also suppress by address. A seller who opts out and is later typed into a broadcast by
    // hand would otherwise be mailed again through the extras path, which reads as ignoring
    // their opt-out — and is, whatever the mechanism.
    await q(
      `insert into broadcast_suppressions (email, source)
         select lower(trim(email)), 'seller-opt-out' from users where id = $1::uuid and email is not null
         on conflict (email) do nothing`, [sub]).catch(() => {});
    audit(null, 'seller.unsubscribed', {
      entityType: 'user', entityId: sub, actor: sub, actorRole: 'system',
      note: 'One-click unsubscribe from a broadcast',
    });
    return true;
  };

  // RFC 8058: Gmail/Yahoo POST here with List-Unsubscribe=One-Click. Must answer 200
  // without a redirect and without asking anything of the user.
  app.post('/api/broadcasts/unsubscribe', async (req, reply) => {
    const t = String((req.query || {}).t || (req.body || {}).t || '');
    const ok = await doUnsubscribe(t);
    reply.code(ok ? 200 : 400).type('text/plain');
    return ok ? 'Unsubscribed.' : 'Invalid or expired link.';
  });

  // The human path — same token, clicked from a mail client.
  app.get('/api/broadcasts/unsubscribe', async (req, reply) => {
    const ok = await doUnsubscribe(String((req.query || {}).t || ''));
    reply.type('text/html');
    const msg = ok
      ? `<h1 style="font-size:20px;margin:0 0 10px">You're unsubscribed</h1>
         <p>You won't get product updates or announcements from EGFULFILL any more.</p>
         <p style="color:#71717a">Emails about your account and your orders — password resets, top-up receipts, shipping notices — will still reach you. Those aren't marketing, and turning them off would break your account.</p>`
      : `<h1 style="font-size:20px;margin:0 0 10px">That link didn't work</h1>
         <p>It may have been altered in transit. You can turn off updates from Settings inside your EGFULFILL account.</p>`;
    reply.code(ok ? 200 : 400);
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EGFULFILL — unsubscribe</title>
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:12vh auto;padding:0 22px;line-height:1.55;color:#18181b">${msg}</div>`;
  });

  // ── Staff: the list. Newest first; this IS the record of who sent what to how many.
  app.get('/api/broadcasts', { preHandler: requireDraft }, async () => {
    await ensureTables();
    const r = await q(`select id, subject, body, audience, status, recipient_count, sent_count,
                              failed_count, last_error, created_by, created_by_name, created_at, sent_at
                         from broadcasts order by created_at desc limit 200`);
    return { broadcasts: r.rows, mailConfigured: mailConfigured() };
  });

  // ── Count an audience WITHOUT sending. Powers the "this will go to N sellers" line the
  // send dialog shows before anything leaves. Same resolver the send uses, so the number
  // shown and the number mailed can't drift apart.
  app.post('/api/broadcasts/preview', { preHandler: requireDraft }, async (req) => {
    await ensureTables();
    const rows = await resolveRecipients((req.body || {}).audience);
    // Shown BEFORE sending, because that is the only point at which it is cheap to fix.
    const invalid = rows.filter((r) => !validEmail(r.email)).map((r) => ({ id: r.id, email: r.email || '' }));
    const optedOut = await q('select count(*)::int as n from users where role = $1 and coalesce(marketing_opt_out,false) = true', ['seller']);
    return {
      count: rows.length,
      optedOut: optedOut.rows[0] ? optedOut.rows[0].n : 0,
      sample: rows.slice(0, 5).map((x) => x.email),
      // The full list, so the confirm screen can show who is actually being mailed rather
      // than "first few" — and the malformed ones separately, since those are the only
      // recipients a send cannot reach and the only ones still cheap to fix.
      recipients: rows.map((x) => ({ id: x.id, email: x.email, name: x.name || null })),
      invalid,
    };
  });

  // ── Global email branding — logo / accent / preset / footer, applied to every send ──
  // Read is staff (the editor + preview need it); the write is admin, like the site content.
  // The `settings` table is shared with site_content.js and created idempotently here too,
  // so this works whichever route registers first.
  app.get('/api/email-branding', { preHandler: requireDraft }, async () => {
    return { branding: await getEmailBranding(), presets: Object.keys(EMAIL_PRESETS) };
  });
  app.put('/api/email-branding', { preHandler: requireAdmin }, async (req) => {
    await q('create table if not exists settings (key text primary key, value jsonb, updated_at timestamptz default now())').catch(() => {});
    const clean = cleanBranding(req.body);
    await q(
      `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [EMAIL_BRANDING_KEY, JSON.stringify(clean)]);
    audit(req, 'email_branding.update', { entityType: 'settings', entityId: EMAIL_BRANDING_KEY, after: clean });
    return { ok: true, branding: clean };
  });

  app.post('/api/broadcasts', { preHandler: requireDraft }, async (req, reply) => {
    await ensureTables();
    const b = req.body || {};
    const subject = String(b.subject || '').trim();
    const body = String(b.body || '').trim();
    if (!subject || !body) { reply.code(400); return { error: 'Subject and body are both required.' }; }
    const r = await q(
      `insert into broadcasts (subject, body, audience, created_by, created_by_name)
       values ($1,$2,$3,$4,$5) returning *`,
      [subject, body, JSON.stringify(b.audience || {}), req.user && req.user.email, req.user && req.user.name]);
    return r.rows[0];
  });

  app.patch('/api/broadcasts/:id', { preHandler: requireDraft }, async (req, reply) => {
    await ensureTables();
    const b = req.body || {};
    // A sent broadcast is a historical record. Editing its subject after the fact would
    // make the log describe mail nobody received.
    const cur = await q('select status from broadcasts where id = $1::bigint', [String(req.params.id)]);
    if (!cur.rows.length) { reply.code(404); return { error: 'not found' }; }
    if (cur.rows[0].status !== 'draft') { reply.code(409); return { error: 'Only a draft can be edited.' }; }
    const r = await q(
      `update broadcasts set subject = coalesce($2, subject), body = coalesce($3, body),
              audience = coalesce($4, audience)
         where id = $1::bigint returning *`,
      [String(req.params.id),
       b.subject != null ? String(b.subject).trim() : null,
       b.body != null ? String(b.body).trim() : null,
       b.audience != null ? JSON.stringify(b.audience) : null]);
    return r.rows[0];
  });

  app.delete('/api/broadcasts/:id', { preHandler: requireDraft }, async (req, reply) => {
    await ensureTables();
    const r = await q("delete from broadcasts where id = $1::bigint and status = 'draft' returning id", [String(req.params.id)]);
    if (!r.rows.length) { reply.code(409); return { error: 'Only a draft can be deleted — a sent broadcast is a record.' }; }
    return { ok: true };
  });

  /**
   * Send.
   *
   * ADMIN, not staff. requireDraft includes operator, and an operator's zone ends at the
   * scan — mailing every seller on the platform is the least reversible action in the
   * product: there is no unsend, and the blast radius is the entire customer base. Drafting
   * is open to the team; the irreversible step is not. To widen it, swap requireAdmin for
   * requireDraft on this one route.
   *
   * Returns as soon as the audience is resolved rather than after the last message. A few
   * hundred sequential Brevo calls outlives any sane request timeout, and a send that
   * "failed" because the HTTP request gave up — while the mail kept going — is the worst
   * possible thing to show someone.
   */
  app.post('/api/broadcasts/:id/send', { preHandler: requireAdmin }, async (req, reply) => {
    await ensureTables();
    const id = String(req.params.id);
    if (!mailConfigured()) { reply.code(503); return { error: 'No mail transport configured — set BREVO_API_KEY.' }; }

    // Claim the row before doing anything. Conditioning the update on status='draft' means
    // two clicks (or two operators) can't both start the same send: the second updates
    // zero rows and stops here.
    const claim = await q("update broadcasts set status = 'sending' where id = $1::bigint and status = 'draft' returning *", [id]);
    if (!claim.rows.length) {
      const cur = await q('select status from broadcasts where id = $1::bigint', [id]);
      reply.code(cur.rows.length ? 409 : 404);
      return { error: cur.rows.length ? `Already ${cur.rows[0].status} — a broadcast sends once.` : 'not found' };
    }
    const bc = claim.rows[0];

    // Resolved HERE, at send. Anyone who unsubscribed since this was drafted is already
    // gone from this list.
    const recipients = await resolveRecipients(bc.audience);
    await q('update broadcasts set recipient_count = $2 where id = $1::bigint', [id, recipients.length]);

    if (!recipients.length) {
      await q("update broadcasts set status = 'sent', sent_at = now() where id = $1::bigint", [id]);
      return { id, recipientCount: 0, note: 'Nobody matched — nothing was sent.' };
    }

    audit(req, 'broadcast.sent', {
      entityType: 'broadcast', entityId: id,
      after: { subject: bc.subject, recipients: recipients.length, audience: bc.audience },
      note: `"${bc.subject}" to ${recipients.length} seller${recipients.length === 1 ? '' : 's'}`,
    });

    // Fire the loop and let the request return. Errors are recorded on the row, which is
    // what the board polls — nothing here can reject into an unhandled rejection.
    (async () => {
      let ok = 0, bad = 0;
      let firstBad = null;
      // Read the branding ONCE for the whole send, not per recipient.
      const brand = await getEmailBranding();
      for (const r of recipients) {
        // Don't spend a send on an address that cannot be delivered. Counted as failed —
        // it IS a person who didn't get the mail — but with a reason that names the fix.
        if (!validEmail(r.email)) {
          bad++;
          if (!firstBad) firstBad = { email: r.email || '(blank)', why: 'not a valid email address — fix it on the seller record' };
          continue;
        }
        const unsubUrl = `${publicOrigin()}/api/broadcasts/unsubscribe?t=${unsubToken(r.sub || r.id)}`;
        const sent = await sendMail({
          to: r.email,
          // Sent from the MARKETING subdomain (mail.egful.store, authenticated separately),
          // not the transactional domain. This is the whole reason that subdomain exists: a
          // campaign that lands in spam damages the reputation of whatever domain sent it,
          // and password resets must not be that domain. Falls back to the default only if
          // MAIL_FROM_BULK is unset, so a missing env var degrades to working-but-shared
          // rather than not sending.
          from: process.env.MAIL_FROM_BULK || undefined,
          subject: bc.subject,
          html: renderHtml(bc.body, r.name, unsubUrl, brand),
          text: renderText(bc.body, r.name, unsubUrl),
          headers: {
            // Both forms: the URL is what one-click POSTs to, the mailto is the fallback
            // for clients that don't implement RFC 8058.
            'List-Unsubscribe': `<${unsubUrl}>, <mailto:${process.env.MAIL_UNSUB_INBOX || 'support@egful.store'}?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }).catch(() => false);
        if (sent) ok++;
        else {
          bad++;
          // NAME THE RECIPIENT. "email is not valid in to" is Brevo telling us one address
          // is malformed — useless without knowing WHICH, since the fix is editing that
          // user's record and the list can be hundreds long. Keep the first failure's
          // address and reason; later ones are almost always the same fault.
          if (!firstBad) firstBad = { email: r.email, why: lastMailError() || 'unknown reason' };
        }
        // Live counters, so a long send shows progress instead of looking hung.
        if ((ok + bad) % 10 === 0) {
          await q('update broadcasts set sent_count = $2, failed_count = $3 where id = $1::bigint', [id, ok, bad]).catch(() => {});
        }
        // Gentle pacing. Brevo rate-limits, and a burst that trips it fails messages that
        // would otherwise have gone.
        await new Promise((res) => setTimeout(res, 120));
      }
      // Lead with the count so a partial failure reads as one — the row shows "17 / 18"
      // beside this, and an unqualified transport error under it looked like the whole
      // send had failed when 17 people had the mail in hand.
      const why = bad
        ? (firstBad
            ? `${bad} of ${recipients.length} failed — first was ${firstBad.email}: ${firstBad.why}`
            : `${bad} of ${recipients.length} failed — ${lastMailError() || 'unknown reason'}`)
        : null;
      await q(
        `update broadcasts set sent_count = $2, failed_count = $3, sent_at = now(),
                last_error = $4,
                status = case when $2 = 0 then 'failed' else 'sent' end
           where id = $1::bigint`, [id, ok, bad, why]).catch(() => {});
      if (bad) app.log.warn({ broadcast: id, ok, bad, lastError: why }, 'broadcast finished with failures');
    })().catch((e) => {
      app.log.error({ err: e, broadcast: id }, 'broadcast send loop crashed');
      q("update broadcasts set status = 'failed', last_error = $2 where id = $1::bigint",
        [id, 'Send loop crashed: ' + String((e && e.message) || e).slice(0, 300)]).catch(() => {});
    });

    return { id, recipientCount: recipients.length, status: 'sending' };
  });
}
