// Public support chat — the bubble on the MARKETING site, for visitors who have no account.
// -----------------------------------------------------------------------------------------
// THIS IS AN UNAUTHENTICATED ENDPOINT THAT SPENDS MONEY. Every message is an Anthropic call,
// so without limits it is an API bill pointed at the open internet. Three separate bounds,
// because each stops a different thing and any one alone leaves a hole:
//
//   per IP           20 messages / 10 min   one script hammering us
//   per conversation 30 messages total      one tab looping forever
//   per day          a hard global ceiling  the worst case is bounded, not unbounded
//
// AND the AI does not answer until a name and email have been given. That is not only lead
// capture — it puts a small human act in front of the expensive call, which is most of what
// stops casual abuse. The QUESTION is stored either way, so a visitor who abandons the form
// still leaves us the thing worth having.
//
// WHAT THE ASSISTANT MAY NOT SAY is as load-bearing as the limits. This is a public surface,
// so CLAUDE.md 2.8 applies directly: it must never name a supplier. It also must not quote a
// specific seller's pricing, because it has no idea who it is talking to.
import crypto from 'node:crypto';
import { q } from '../db.js';
import { limited } from '../ratelimit.js';
import { aiComplete } from './support_ai.js';
import { sendMail } from '../mailer.js';
import { notify } from './notifications.js';

// Created at route load like the other late tables — schema.sql only runs on first DB init,
// so an existing deployment would never see this.
q(`create table if not exists public_support (
     id text primary key,
     name text,
     email text,
     messages jsonb not null default '[]',
     escalated boolean not null default false,
     ip text,
     created_at timestamptz default now(),
     updated_at timestamptz default now()
   )`).catch(() => {});

const MAX_PER_CONVO = 30;
const MAX_MSG_CHARS = 2000;
const DAILY_CEILING = 500;          // whole-site AI replies per day

/**
 * The assistant's brief.
 *
 * Written as prohibitions rather than suggestions because this text is the ONLY thing
 * standing between a public chat box and our supplier list. "Prefer not to" is not a
 * control; "never" is.
 */
const SYSTEM = `You are the support assistant on EGFULFILL's public website. EGFULFILL is a
print-on-demand fulfilment platform: sellers connect Etsy, Shopify or TikTok Shop, orders
sync into one queue, we print and ship them, and tracking is pushed back.

You are talking to a VISITOR who does not have an account. Be brief, concrete and warm.

NEVER do any of the following:
- Name, hint at, or confirm which supplier, manufacturer, distributor or wholesaler provides
  our blanks. If asked, say we work with several and the catalogue is what we can make.
- Quote a specific price for a specific seller, or promise a delivery date. Prices vary by
  product, method and destination; point at the catalogue or offer a human.
- Invent a policy, a lead time, a discount, or a product we do not list.
- Ask for a password, card number or any credential.

If you do not know, say so and offer to pass it to a person. That is always a good answer.

FORMAT — this is a small chat bubble, not a document:
- Write PLAIN TEXT. No markdown at all: no **bold**, no *italics*, no #headings, no backticks.
  Asterisks are rendered literally here, so they arrive as visible clutter.
- Keep it to two or three short sentences where you can.
- If you must list steps, put each on its OWN LINE starting with "1." "2." "3." — a real line
  break between them, never a run-on sentence.
- Reply in the language the visitor wrote in.`;

/**
 * Strip markdown the model emitted anyway.
 *
 * The prompt says plain text, but a prompt is a request and this is a guarantee. Asterisks
 * render literally in the bubble, so **bold** arrived as visible clutter. Also forces a real
 * line break before "2." style steps, which is the other half of what made a numbered list
 * come out as one run-on sentence.
 */
const deMarkdown = (t) => String(t || '')
  .replace(/\*\*(.+?)\*\*/g, '$1')          // **bold**
  .replace(/(^|\s)\*(\S[^*]*?)\*/g, '$1$2')  // *italic*, not a bare bullet asterisk
  .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')      // `code`
  .replace(/^#{1,6}\s+/gm, '')                // # headings
  .replace(/(?<!\n)\s+(\d\.)\s/g, '\n$1 ')   // run-on "1. x 2. y" -> its own line
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const validEmail = (e) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(String(e || '').trim());

export function publicSupportRoutes(app) {
  /**
   * One turn of the conversation.
   *
   * Returns `needsIdentity` rather than an error when we don't have a name/email yet: the
   * message IS stored, so the client can show the form knowing the question is already safe.
   * Answering before that point is what would make this free to abuse.
   */
  app.post('/api/public/support', async (req, reply) => {
    const b = req.body || {};
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';

    const stop = limited(reply, `pubsup-ip:${ip}`, 20, 10 * 60 * 1000);
    if (stop) return stop;

    const text = clean(b.message, MAX_MSG_CHARS);
    if (!text) { reply.code(400); return { error: 'Say something and we\'ll help.' }; }

    // The id is OURS, not the client's — a caller-supplied id would let anyone read or grow
    // someone else's conversation. An unknown id simply starts a new one.
    let id = String(b.conversationId || '').trim();
    if (!/^ps_[a-f0-9]{24}$/.test(id)) id = 'ps_' + crypto.randomBytes(12).toString('hex');

    const row = (await q('select * from public_support where id=$1', [id])).rows[0] || null;
    const history = Array.isArray(row?.messages) ? row.messages : [];
    if (history.length >= MAX_PER_CONVO) {
      reply.code(429);
      return { error: 'This conversation has gone on a while — let us pick it up by email.', conversationId: id, needsHuman: true };
    }

    const name = clean(b.name, 80);
    const email = clean(b.email, 160);
    const known = row ? { name: row.name, email: row.email } : { name: null, email: null };
    const finalName = known.name || name || null;
    const finalEmail = known.email || (validEmail(email) ? email.toLowerCase() : null);

    const messages = [...history, { role: 'user', text, at: new Date().toISOString() }];
    await q(
      `insert into public_support (id, name, email, messages, ip)
       values ($1,$2,$3,$4::jsonb,$5)
       on conflict (id) do update set
         name = coalesce(public_support.name, excluded.name),
         email = coalesce(public_support.email, excluded.email),
         messages = excluded.messages, updated_at = now()`,
      [id, finalName, finalEmail, JSON.stringify(messages), ip]
    ).catch(() => {});

    // The question is now stored. Ask who they are BEFORE spending anything on a reply.
    if (!finalEmail) {
      return { conversationId: id, needsIdentity: true, messages };
    }

    // A whole-site ceiling, so the worst day is bounded rather than open-ended.
    const today = (await q(
      `select count(*)::int as n from public_support
        where updated_at > now() - interval '1 day'`
    ).then((r) => r.rows[0]?.n || 0).catch(() => 0));
    if (today > DAILY_CEILING) {
      return { conversationId: id, messages, reply: null, needsHuman: true,
               notice: 'We\'re at capacity on instant replies right now — a person will follow up by email.' };
    }

    let answer = null;
    try {
      answer = await aiComplete({
        system: SYSTEM,
        messages: messages.slice(-12).map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.text || ''),
        })),
        maxTokens: 500,
      });
    } catch { answer = null; }

    // A failed model call is NOT an empty answer. Say a person will pick it up rather than
    // leaving a visitor talking to a box that stopped responding.
    if (!answer) {
      return { conversationId: id, messages, reply: null, needsHuman: true,
               notice: 'I couldn\'t answer that one — a person will follow up by email.' };
    }

    const shaped = deMarkdown(answer);
    const withReply = [...messages, { role: 'assistant', text: shaped, at: new Date().toISOString() }];
    await q('update public_support set messages=$2::jsonb, updated_at=now() where id=$1',
      [id, JSON.stringify(withReply)]).catch(() => {});
    return { conversationId: id, messages: withReply, reply: shaped };
  });

  /**
   * Hand the conversation to a person.
   *
   * Emails the visitor a copy so the thread survives them closing the tab — which is the
   * whole reason an address is collected — and alerts staff. Both are best-effort: an
   * escalation that fails to send mail must still be RECORDED, or it is lost entirely.
   */
  app.post('/api/public/support/escalate', async (req, reply) => {
    const b = req.body || {};
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
    const stop = limited(reply, `pubsup-esc:${ip}`, 5, 10 * 60 * 1000);
    if (stop) return stop;

    const id = String(b.conversationId || '').trim();
    const row = (await q('select * from public_support where id=$1', [id])).rows[0];
    if (!row) { reply.code(404); return { error: 'Conversation not found' }; }

    await q('update public_support set escalated=true, updated_at=now() where id=$1', [id]).catch(() => {});

    /**
     * PUT IT WHERE STAFF ALREADY LOOK.
     *
     * The Conversations rail is built from order_messages rows whose order_id is like
     * 'support-%' — nothing more. So an escalation copied in under 'support-web-<id>'
     * appears in that list AND opens through the existing message path, with no second
     * inbox to build and no chance of the two disagreeing about what was said.
     *
     * Idempotent on the channel: escalating twice must not duplicate the transcript.
     * `escalated` on the meta of the last row is what sorts it to the top of the rail as
     * an unanswered request for a human — the same flag a seller's own escalation sets.
     */
    const channel = `support-web-${id}`;
    const already = await q('select 1 from order_messages where order_id=$1 limit 1', [channel])
      .then((r) => r.rowCount > 0).catch(() => false);
    if (!already) {
      const who = row.name || row.email || 'Website visitor';
      for (const m of (Array.isArray(row.messages) ? row.messages : [])) {
        await q(
          `insert into order_messages (order_id, sender_id, sender_role, body, meta)
           values ($1, null, $2, $3, $4)`,
          [channel, m.role === 'assistant' ? 'assistant' : 'seller', String(m.text || ''),
           JSON.stringify({ web: true, name: row.name || null, email: row.email || null })]
        ).catch(() => {});
      }
      await q(
        `insert into order_messages (order_id, sender_id, sender_role, body, meta)
         values ($1, null, 'assistant', $2, $3)`,
        [channel, `${who} asked to speak to a person. Reply here — they'll get it at ${row.email || 'no address given'}.`,
         JSON.stringify({ web: true, escalated: true, name: row.name || null, email: row.email || null })]
      ).catch(() => {});
    }

    const lines = (Array.isArray(row.messages) ? row.messages : [])
      .map((m) => `${m.role === 'assistant' ? 'EGFULFILL' : (row.name || 'You')}: ${m.text}`).join('\n\n');

    if (row.email) {
      sendMail({
        to: row.email,
        subject: 'Your conversation with EGFULFILL',
        text: `Thanks for getting in touch — a person is picking this up and will reply to this address.\n\n---\n\n${lines}`,
      }).catch(() => {});
    }
    notify({
      roles: ['admin', 'operator'],
      type: 'support-public',
      title: `Website enquiry from ${row.name || row.email || 'a visitor'}`,
      body: (Array.isArray(row.messages) && row.messages[0]?.text || '').slice(0, 140),
      href: '/chat',
      entityId: id,
    });
    return { ok: true, conversationId: id };
  });
}
