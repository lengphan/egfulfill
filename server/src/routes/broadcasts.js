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
  return { sql: where.join(' and '), vals };
}

async function resolveRecipients(aud) {
  const { sql, vals } = audienceSql(aud);
  const r = await q(`select id, email, name from users where ${sql} order by created_at asc`, vals);
  return r.rows;
}

// ── Body rendering ────────────────────────────────────────────────────────────
// The body is authored as PLAIN TEXT and escaped here. Letting staff paste raw HTML into
// something that fans out to every seller is a foot-gun with no upside: one unclosed tag
// swallows the unsubscribe footer, and the footer is the legally required part.
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderHtml(body, name, unsubUrl) {
  const greeting = name ? `Hi ${esc(name)},` : 'Hi,';
  const paras = String(body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#18181b;max-width:560px">
<p style="margin:0 0 14px">${greeting}</p>
${paras}
<hr style="border:0;border-top:1px solid #e4e4e7;margin:28px 0 12px">
<p style="margin:0;font-size:12px;color:#71717a">
You're receiving this because you have an EGFULFILL seller account.
<a href="${esc(unsubUrl)}" style="color:#71717a">Unsubscribe from updates like this</a>.
Account and order emails will still reach you.
</p></div>`;
}

function renderText(body, name, unsubUrl) {
  return `${name ? 'Hi ' + name + ',' : 'Hi,'}\n\n${body}\n\n---\nYou're receiving this because you have an EGFULFILL seller account.\nUnsubscribe from updates like this: ${unsubUrl}\nAccount and order emails will still reach you.`;
}

/**
 * @param requireStaff  read + draft: anyone on the team can write one
 * @param requireAdmin  the send itself. See the note on POST /:id/send.
 */
export function broadcastsRoutes(app, requireStaff, requireAdmin) {
  ensureTables();

  // ── PUBLIC. No preHandler, by design: Gmail's one-click POSTs from their own
  // infrastructure with no cookie and no bearer token, and a human clicking the link in a
  // mail client is not logged in either. The HMAC in the token is the whole authorisation.
  const doUnsubscribe = async (token) => {
    const id = verifyUnsubToken(token);
    if (!id) return false;
    await ensureTables();
    await q('update users set marketing_opt_out = true, marketing_opt_out_at = now() where id = $1::uuid', [id]).catch(() => {});
    audit(null, 'seller.unsubscribed', {
      entityType: 'user', entityId: id, actor: id, actorRole: 'system',
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
  app.get('/api/broadcasts', { preHandler: requireStaff }, async () => {
    await ensureTables();
    const r = await q(`select id, subject, body, audience, status, recipient_count, sent_count,
                              failed_count, created_by, created_by_name, created_at, sent_at
                         from broadcasts order by created_at desc limit 200`);
    return { broadcasts: r.rows, mailConfigured: mailConfigured() };
  });

  // ── Count an audience WITHOUT sending. Powers the "this will go to N sellers" line the
  // send dialog shows before anything leaves. Same resolver the send uses, so the number
  // shown and the number mailed can't drift apart.
  app.post('/api/broadcasts/preview', { preHandler: requireStaff }, async (req) => {
    await ensureTables();
    const rows = await resolveRecipients((req.body || {}).audience);
    const optedOut = await q('select count(*)::int as n from users where role = $1 and coalesce(marketing_opt_out,false) = true', ['seller']);
    return { count: rows.length, optedOut: optedOut.rows[0] ? optedOut.rows[0].n : 0, sample: rows.slice(0, 5).map((x) => x.email) };
  });

  app.post('/api/broadcasts', { preHandler: requireStaff }, async (req, reply) => {
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

  app.patch('/api/broadcasts/:id', { preHandler: requireStaff }, async (req, reply) => {
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

  app.delete('/api/broadcasts/:id', { preHandler: requireStaff }, async (req, reply) => {
    await ensureTables();
    const r = await q("delete from broadcasts where id = $1::bigint and status = 'draft' returning id", [String(req.params.id)]);
    if (!r.rows.length) { reply.code(409); return { error: 'Only a draft can be deleted — a sent broadcast is a record.' }; }
    return { ok: true };
  });

  /**
   * Send.
   *
   * ADMIN, not staff. requireStaff includes operator, and an operator's zone ends at the
   * scan — mailing every seller on the platform is the least reversible action in the
   * product: there is no unsend, and the blast radius is the entire customer base. Drafting
   * is open to the team; the irreversible step is not. To widen it, swap requireAdmin for
   * requireStaff on this one route.
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
      for (const r of recipients) {
        const unsubUrl = `${publicOrigin()}/api/broadcasts/unsubscribe?t=${unsubToken(r.id)}`;
        const sent = await sendMail({
          to: r.email,
          subject: bc.subject,
          html: renderHtml(bc.body, r.name, unsubUrl),
          text: renderText(bc.body, r.name, unsubUrl),
          headers: {
            // Both forms: the URL is what one-click POSTs to, the mailto is the fallback
            // for clients that don't implement RFC 8058.
            'List-Unsubscribe': `<${unsubUrl}>, <mailto:${process.env.MAIL_UNSUB_INBOX || 'support@egful.store'}?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }).catch(() => false);
        if (sent) ok++; else bad++;
        // Live counters, so a long send shows progress instead of looking hung.
        if ((ok + bad) % 10 === 0) {
          await q('update broadcasts set sent_count = $2, failed_count = $3 where id = $1::bigint', [id, ok, bad]).catch(() => {});
        }
        // Gentle pacing. Brevo rate-limits, and a burst that trips it fails messages that
        // would otherwise have gone.
        await new Promise((res) => setTimeout(res, 120));
      }
      await q(
        `update broadcasts set sent_count = $2, failed_count = $3, sent_at = now(),
                status = case when $2 = 0 then 'failed' else 'sent' end
           where id = $1::bigint`, [id, ok, bad]).catch(() => {});
      if (bad) app.log.warn({ broadcast: id, ok, bad, lastError: lastMailError() }, 'broadcast finished with failures');
    })().catch((e) => {
      app.log.error({ err: e, broadcast: id }, 'broadcast send loop crashed');
      q("update broadcasts set status = 'failed' where id = $1::bigint", [id]).catch(() => {});
    });

    return { id, recipientCount: recipients.length, status: 'sending' };
  });
}
