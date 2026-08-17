// Where a product can be published, as ONE list.
//
// The publish dialog used to hardcode three tabs — Etsy, TikTok, Shopify — which is a
// statement about which integrations exist, not about where THIS seller can actually send
// a listing. A seller with one Etsy shop saw two tabs they could never use; a seller with
// two Etsy shops could only ever publish to whichever they connected first.
//
// So the client asks this route instead, and renders whatever comes back. One shop → no
// picker at all. Four shops across three platforms → four rows. Two Etsy shops → two rows
// that differ by shop name. None of those are branches in the UI; they're just lengths of
// this array.
import { destinationsFor, PLATFORM_EXTRA_FIELDS } from '../destinations.js';
import { aiComplete } from './support_ai.js';

const LABEL = { etsy: 'Etsy', tiktok: 'TikTok Shop', shopify: 'Shopify' };

export function publishRoutes(app, requireAuth) {
  app.get('/api/publish/destinations', { preHandler: requireAuth }, async (req) => {
    const rows = await destinationsFor(req.user);
    // TikTok's publish gate, read HERE as well as in the publish route, so the dialog can
    // say "dry run" on the row BEFORE anything is sent rather than reporting a green tick
    // for a product that was never created. Read at call time, never at module load — the
    // flag is set in the environment and a module-level snapshot would need a deploy to
    // notice a change.
    const ttLive = String(process.env.TIKTOK_PUBLISH_LIVE || '') === '1';
    return {
      destinations: rows.map((c) => ({
        connection_id: c.id,
        platform: c.platform,
        platform_label: LABEL[c.platform] || c.platform,
        // The name the seller knows the shop by. shop_id is the fallback because a row
        // with no name is still a real destination, and "Etsy shop" twice over is worse
        // than an id you can at least tell apart.
        shop_name: c.shop_name || c.shop_id,
        shop_id: c.shop_id,
        connected_at: c.created_at,
        // What this row needs on top of the shared fields. The dialog expands a row only
        // when this is non-empty, which is why ticking an Etsy shop adds no work.
        extra_fields: PLATFORM_EXTRA_FIELDS[c.platform] || [],
        // Publishing here creates nothing yet — said on the row, not discovered afterwards.
        dry_run: c.platform === 'tiktok' && !ttLive,
      })),
    };
  });

  /**
   * REWRITE THE LISTING COPY — ONLY WHEN SOMEONE ASKS.
   *
   * A POST behind a button press, never a GET the dialog can fire on open and never
   * anything keyed to typing. Every call costs money and a second of waiting, and a
   * listing dialog that quietly re-generated copy while you edited it would spend both on
   * work nobody asked for. The same rule the loader bug taught this codebase: a request
   * that can recur on its own eventually does.
   *
   * IT SUGGESTS. The route returns a proposal and the client shows it beside what the
   * seller wrote — it does not overwrite the fields. Copy is the seller's voice and their
   * legal exposure, and a model editing it in place is a change nobody reviewed.
   *
   * NO NEW BRAND NAMES. The system prompt forbids inventing them, because the input is
   * often a scraped competitor listing that already contains one — "rewrite this Disney
   * shirt listing" must not come back with a fluent, well-formatted trademark violation.
   * The publish screen still runs detectTrademarks over the result, so this is the second
   * line rather than the only one.
   *
   * NO NEW FACTS. It may not invent materials, sizes, delivery times or claims. A listing
   * is a promise to a buyer; a model guessing "ships in 2 days" writes a promise the
   * factory never made.
   */
  app.post('/api/publish/rewrite', { preHandler: requireAuth }, async (req, reply) => {
    const b = req.body || {};
    const title = String(b.title || '').slice(0, 500).trim();
    const description = String(b.description || '').slice(0, 8000).trim();
    if (!title && !description) { reply.code(400); return { error: 'Nothing to rewrite — add a title or a description first.' }; }

    // Facts the model is allowed to use, and nothing else. Passed explicitly rather than
    // letting it infer them from the prose, which is how a 3XL appears on a listing that
    // stops at XL.
    const facts = [
      b.product && `Product: ${String(b.product).slice(0, 200)}`,
      Array.isArray(b.colors) && b.colors.length && `Colours available: ${b.colors.slice(0, 40).join(', ')}`,
      Array.isArray(b.sizes) && b.sizes.length && `Sizes available: ${b.sizes.slice(0, 40).join(', ')}`,
      b.method && `Decoration method: ${String(b.method).slice(0, 60)}`,
    ].filter(Boolean).join('\n');

    const system = [
      'You rewrite print-on-demand marketplace listing copy so it is clear and easy to scan.',
      '',
      'RULES, in order of importance:',
      '1. Never introduce a brand, character, franchise, team or celebrity name that is not already in the input. If the input contains one, keep it only where removing it would break the sentence — never add emphasis to it.',
      '2. Never invent a fact. No materials, weights, sizes, colours, delivery times, guarantees, review counts or superlatives that are not in the input or in the PRODUCT FACTS below.',
      '3. Keep the seller\'s meaning and voice. This is an edit, not a new listing.',
      '4. No emoji, no ALL CAPS words, no "best", "#1", "guaranteed", or invented urgency.',
      '',
      'Return STRICT JSON and nothing else: {"title": "...", "description": "..."}',
      'The title is one line, at most 130 characters, front-loaded with what the thing actually is.',
      'The description is plain text. Use short paragraphs separated by a blank line. Where the input lists ordering steps, keep them as "1- ", "2- " on their own lines. Do not use HTML.',
      facts ? '\nPRODUCT FACTS (the only facts you may add):\n' + facts : '',
    ].join('\n');

    try {
      const raw = await aiComplete({
        system,
        messages: [{ role: 'user', content: `TITLE:\n${title || '(none)'}\n\nDESCRIPTION:\n${description || '(none)'}` }],
        maxTokens: 1200,
      });
      // The model was told to return only JSON; a fenced block or a stray sentence around it
      // is the common failure and is cheap to survive, so pull the outermost object out
      // rather than failing a call the seller has already waited for.
      const m = /\{[\s\S]*\}/.exec(raw || '');
      let out = null;
      try { out = m ? JSON.parse(m[0]) : null; } catch { out = null; }
      if (!out || (!out.title && !out.description)) {
        reply.code(502);
        return { error: 'The assistant returned something we could not read. Try again.' };
      }
      return {
        title: String(out.title || '').replace(/\s+/g, ' ').trim().slice(0, 255),
        description: String(out.description || '').trim().slice(0, 8000),
      };
    } catch (e) {
      // `disabled` means no key is configured, which is a setup answer, not a failure.
      reply.code(e.status || 502);
      return { error: e.message, disabled: !!e.disabled };
    }
  });
}
