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

const MAX_MSG_CHARS = 2000;
const DAILY_CEILING = 500;          // whole-site AI replies per day

/**
 * The assistant's brief.
 *
 * Written as prohibitions rather than suggestions because this text is the ONLY thing
 * standing between a public chat box and our supplier list. "Prefer not to" is not a
 * control; "never" is.
 */
const SYSTEM = `You are the support assistant on EGFUL's public website. EGFUL is a
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
  /**
   * PUT THE CONVERSATION IN FRONT OF A PERSON, and mark it as theirs.
   *
   * Extracted so the LENGTH CAP can use it too. That cap used to refuse the message —
   * "this conversation has gone on a while, let us pick it up by email" — which threw away
   * what the visitor had just typed, in a widget still showing them an input, and pointed
   * them at a medium they had chosen not to use. A long conversation is not an abuse to be
   * stopped; it is one that has outgrown the bot, which is what a person is for.
   *
   * Idempotent on the channel: the transcript is copied once, so an automatic handover
   * followed by someone pressing the button cannot duplicate it.
   */
  async function handToPerson(row, opts = {}) {
    const id = row.id;
    await q('update public_support set escalated=true, updated_at=now() where id=$1', [id]).catch(() => {});
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
        [channel, opts.reason || `${who} asked to speak to a person. Reply here — they'll get it at ${row.email || 'no address given'}.`,
         JSON.stringify({ web: true, escalated: true, name: row.name || null, email: row.email || null })]
      ).catch(() => {});
    }

    return channel;
  }

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
    /**
     * A LONG CONVERSATION IS HANDED OVER, NEVER REFUSED.
     *
     * The cap exists to bound MODEL SPEND, and the way to stop spending on a conversation
     * is to give it to a person — not to stop listening to it. Past the cap the message is
     * stored like any other and the escalated branch below carries it to the rail, which
     * never calls the model again.
     */

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

    /**
     * ONCE A PERSON IS IN, THE BOT STEPS BACK — and the visitor keeps talking TO THEM.
     *
     * Nothing here read `escalated`, so after a handover two things went wrong at once: the
     * model kept answering over the top of a human who was already in the conversation, and
     * everything the visitor typed after that landed in `public_support.messages` where
     * STAFF NEVER LOOK. They answer in the Conversations rail, which reads order_messages —
     * so the visitor was talking into a room nobody was in, while being answered by a bot
     * the human could not see.
     *
     * So an escalated conversation posts the message into the rail's channel instead, with
     * sender_id null (that is what marks it as theirs rather than a staff reply — see the
     * GET above) and no model call at all. Which also means this path cannot be blocked by
     * the daily ceiling or a model outage: a conversation a person is handling does not
     * depend on the machine that stopped handling it.
     */
    if (row && row.escalated) {
      await q(
        `insert into order_messages (order_id, sender_id, sender_role, body, meta)
         values ($1, null, 'seller', $2, $3)`,
        [`support-web-${id}`, text,
         JSON.stringify({ web: true, name: finalName, email: finalEmail })]
      ).catch(() => {});
      return { conversationId: id, messages, escalated: true, reply: null, withPerson: true };
    }

    // The question is now stored. Ask who they are BEFORE spending anything on a reply.
    if (!finalEmail) {
      return { conversationId: id, needsIdentity: true, messages };
    }

    /**
     * NO MODEL ON THIS ENDPOINT. A PERSON ANSWERS.
     *
     * The bot used to reply here, which is why this route carried a whole-site daily
     * ceiling, a 30-turn cap per conversation and two "a person will follow up" fallbacks:
     * every one of those existed to bound what an unauthenticated stranger could spend.
     *
     * AI helps US draft a reply now (POST /api/support/ai-draft, staff-only) and never
     * speaks to a visitor. So the spend is zero however long the conversation runs, and the
     * guardrails that existed to cap it are gone with the thing they were capping — a cap
     * that can only ever refuse a customer, protecting a cost that no longer exists, is
     * worse than no cap.
     *
     * What remains is the per-IP rate limit at the top, which is about flooding rather than
     * spend, and therefore still earns its keep.
     */
    await handToPerson({ ...(row || {}), id, name: finalName, email: finalEmail, messages }, {
      reason: `${finalName || finalEmail || 'A website visitor'} started a chat on the website. Reply here — they see it in the widget, and it also reaches ${finalEmail || 'no address given'}.`,
    }).catch(() => {});
    await q(
      `insert into order_messages (order_id, sender_id, sender_role, body, meta)
       values ($1, null, 'seller', $2, $3)`,
      [`support-web-${id}`, text, JSON.stringify({ web: true, name: finalName, email: finalEmail })]
    ).catch(() => {});
    return { conversationId: id, messages, reply: null, escalated: true, withPerson: true };
  });

  /**
   * READ THE CONVERSATION BACK — including what a PERSON has since replied.
   *
   * There was no read path at all. Escalating copies the transcript into order_messages
   * under `support-web-<id>`, staff answer it from the Conversations rail, and the visitor's
   * widget had no way to learn that: it said "we'll reply to your email" and then sat there
   * while the answer went somewhere they could not see. On a page that invites a question,
   * that is the reply never arriving.
   *
   * THE ID IS THE CAPABILITY. Conversation ids are 96 bits from crypto.randomBytes and are
   * minted server-side precisely so a caller cannot name someone else's (see the note where
   * one is generated). This route adds no new exposure: anyone holding the id can already
   * grow the conversation through POST, which returns its messages.
   *
   * STAFF REPLIES ARE THE ONES WITH AN AUTHOR. The escalation copies the visitor's own
   * history in with `sender_id = null`; a human answering types with their id attached. That
   * is the discriminator, so the copied transcript cannot come back as a stream of duplicate
   * "replies". Names are not published — a visitor gets "EGFUL", not which of us it was.
   */
  app.get('/api/public/support/:id', async (req, reply) => {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
    // Polled by an open widget, so the ceiling is generous where the POST's is not — this
    // one costs a query, not a model call.
    const stop = limited(reply, `pubsup-read:${ip}`, 120, 10 * 60 * 1000);
    if (stop) return stop;

    const id = String(req.params.id || '').trim();
    if (!/^ps_[a-f0-9]{24}$/.test(id)) { reply.code(404); return { error: 'Conversation not found' }; }
    const row = (await q('select id, messages, escalated from public_support where id=$1', [id])).rows[0];
    if (!row) { reply.code(404); return { error: 'Conversation not found' }; }

    const staff = await q(
      `select body, created_at from order_messages
        where order_id = $1 and sender_id is not null
        order by created_at asc limit 100`, [`support-web-${id}`]
    ).then((r) => r.rows).catch(() => []);

    /**
     * MERGED BY TIME, not concatenated.
     *
     * This was `[...theirs, ...staff]`, which put every visitor message first and every
     * reply after — so a conversation that actually went question, answer, question, answer
     * was shown as one block from each side, in an order nobody spoke in. Two people
     * alternating is the ONE thing a chat transcript has to preserve.
     *
     * Sorted on the timestamp each row already carries, with the original position as the
     * tiebreak: rows written before `at` existed have no time, and keeping their relative
     * order is better than scattering them through the thread on a parsed zero.
     *
     * 'staff' rather than 'assistant': the widget says who is talking, and "a person
     * replied" is the whole point of having escalated.
     */
    const stamped = [
      ...(Array.isArray(row.messages) ? row.messages : []).map((m, i) => ({ m, i, t: Date.parse(m.at || '') || 0 })),
      ...staff.map((m, i) => ({
        m: { role: 'staff', text: String(m.body || ''), at: m.created_at },
        i: 100000 + i,
        t: Date.parse(m.created_at) || 0,
      })),
    ];
    stamped.sort((a, b) => (a.t - b.t) || (a.i - b.i));
    const messages = stamped.map((x) => x.m);
    return { conversationId: id, escalated: !!row.escalated, messages };
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
    await handToPerson(row);

    const lines = (Array.isArray(row.messages) ? row.messages : [])
      .map((m) => `${m.role === 'assistant' ? 'EGFUL' : (row.name || 'You')}: ${m.text}`).join('\n\n');

    if (row.email) {
      sendMail({
        to: row.email,
        subject: 'Your conversation with EGFUL',
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
