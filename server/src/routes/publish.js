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
import crypto from 'node:crypto';
import { destinationsFor, PLATFORM_EXTRA_FIELDS } from '../destinations.js';
import { aiComplete } from './support_ai.js';
import { imageBytesFrom } from '../images.js';
import { generateImage, IMAGE_MODELS, ASPECT_RATIOS } from '../gemini.js';
import { putObject, storageEnabled } from '../storage.js';
import { readPricing, quoteFor, chargeForGeneration, refundGeneration, recordGenerationCost, effectiveSeller } from '../ai-pricing.js';
import { q } from '../db.js';

const LABEL = { etsy: 'Etsy', tiktok: 'TikTok Shop', shopify: 'Shopify' };

/*
 * ETSY'S OWN CEILINGS, and the reason they are HERE as well as in the page.
 *
 * 13 tags of at most 20 characters is the marketplace's limit, not a house preference: a
 * 14th tag and a 21st character are dropped on their way in, silently. The publish page
 * enforces the same two numbers when a person types a tag (`MAX_TAGS`, `cleanTag`), and the
 * model has to be told them in words or it writes "personalized christmas gift for mom" —
 * a fine phrase that is 38 characters and therefore not a tag.
 *
 * Kept in step with web/components/app/publish-product-page.tsx by hand. Two numbers, one
 * rule; a change to one of them that misses the other publishes tags nobody can see.
 */
const MAX_TAGS = 13;
const MAX_TAG_LEN = 20;

/**
 * The model's tag list → tags the listing can actually carry.
 *
 * The same cleaning the page applies to a typed tag, applied to a written one, because a
 * marketplace tag is the same object whichever hand made it: letters, numbers, spaces,
 * apostrophes and hyphens only. Then the two things a model reliably gets wrong —
 * it writes a phrase that is one word too long, and it hands back a tag the listing already
 * has under different capitalisation.
 *
 * Over-length tags are DROPPED rather than truncated. A 24-character phrase cut at 20 is
 * "personalized christm", which is not a search anybody performs — and a tag that matches
 * nothing is worse than a slot left empty, because the slot at least stays available.
 */
function cleanTags(raw, have = []) {
  const seen = new Set(have.map((t) => String(t).toLowerCase().trim()));
  const out = [];
  for (const item of (Array.isArray(raw) ? raw : [])) {
    const t = String(item || '').replace(/[^\p{L}\p{N} '-]/gu, '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > MAX_TAG_LEN) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

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

  /*
   * Sources → bytes, through the ONE allowlisted resolver.
   *
   * The client sends the same strings the publish payload carries: a competitor's
   * etsystatic URL, a data: URL, or one of our own stored renders. imageBytesFrom is what
   * decides which of those is fetchable, so nothing here can be pointed at an arbitrary
   * host — and a source it refuses is SKIPPED rather than fatal, because one dead thumbnail
   * should not throw away a prompt somebody already reviewed.
   *
 * Used by BOTH the copy rewriter and the photo-prompt writer — one resolver, so a source
 * one of them accepts and the other refuses is not a thing that can happen.
   *
   * The 3.5MB ceiling is Anthropic's per-image limit with headroom for base64 expansion;
   * an Etsy fullxfull occasionally clears it and the API would 400 on the whole request.
   */
  const MAX_REF_BYTES = 3.5 * 1024 * 1024;
  const VISION_MIME = /^image\/(jpeg|png|gif|webp)$/;

  async function refBytes(list, cap) {
    const out = [];
    for (const raw of (Array.isArray(list) ? list : []).slice(0, cap)) {
      let img = null;
      try { img = await imageBytesFrom(String(raw || '')); } catch { img = null; }
      if (!img || !img.buf || !img.buf.length) continue;
      if (img.buf.length > MAX_REF_BYTES) continue;
      out.push(img);
    }
    return out;
  }

  /**
   * WRITE THE LISTING — THE COPY AND THE KEYWORDS, FROM THE PHOTOS.
   *
   * ONE CALL, NOT THREE. Title, description and tags were three separate questions with
   * three separate answers, and the seller was the only thing joining them up — which is
   * how a listing ends up with a title about a "retro sunset tee" and thirteen tags about
   * a "comfort colors shirt". They are one answer to one question: what is this, and what
   * would a buyer type to find it. A phrase that leads the title has to be a tag, and a tag
   * that is worth a slot has to be a phrase the description actually supports.
   *
   * IT READS THE PHOTOS. The pictures are the only place the ARTWORK is described — a
   * seller arriving from the design maker has mockups and an empty form, and a rewriter
   * that can only see an empty form can only give an empty answer back. See the `images`
   * handling below for what that costs and what it refuses.
   *
   * WRITTEN FOR SEARCH. See §6 of CLAUDE.md: the primary phrase leads the title, the
   * description opens with it and then becomes bullets, and the tags are long-tail phrases
   * rather than a restatement of the title. That is a RULE, not a preference — a listing
   * nobody can find is a listing that did not get published.
   *
   * ONLY WHEN SOMEONE ASKS.
   *
   * A POST behind a GESTURE — a button press, or the drop that puts photos on the page.
   * Never a GET the page can fire on open, and never anything keyed to typing. Every call
   * costs money and a second of waiting, and a listing page that quietly re-generated copy
   * while you edited it would spend both on work nobody asked for. The same rule the loader
   * bug taught this codebase: a request that can recur on its own eventually does. A drop
   * cannot recur on its own; an effect watching `images.length` can, and that is exactly the
   * shape this must never take.
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
    const have = (Array.isArray(b.tags) ? b.tags : []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, MAX_TAGS);

    /*
     * THE PHOTOS ARE AN INPUT NOW, and they are what makes this callable with an empty form.
     *
     * A seller arrives from the design maker with mockups and nothing written: the old 400
     * ("add a title or a description first") refused exactly the moment the assist was worth
     * most. Four is the cap for the same reason the prompt writer uses it — every extra photo
     * is real tokens on a call somebody is waiting for, and the first four say what the
     * product is.
     *
     * A source that cannot be read is SKIPPED, never fatal: one dead thumbnail must not throw
     * away a rewrite the other three photos can answer perfectly well.
     */
    const usable = (await refBytes(b.images, 4)).filter((r) => VISION_MIME.test(r.mime));
    if (!title && !description && !usable.length) {
      reply.code(400);
      return { error: 'Nothing to work from — add a photo, a title or a description first.' };
    }

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
      'You write print-on-demand marketplace listing copy that ranks in marketplace search and reads like a person wrote it.',
      '',
      'RULES, in order of importance:',
      '1. Never introduce a brand, character, franchise, team or celebrity name that is not already in the input. If the input contains one, keep it only where removing it would break the sentence — never add emphasis to it.',
      '2. Never invent a fact. No materials, weights, sizes, colours, delivery times, guarantees, review counts or superlatives that are not in the input, in the photos, or in the PRODUCT FACTS below.',
      '3. Keep the seller\'s meaning and voice. This is an edit, not a new listing.',
      '4. No emoji, no ALL CAPS words, no "best", "#1", "guaranteed", or invented urgency.',
      '',
      'HOW BUYERS FIND THIS — the copy is written for search, not only for reading:',
      '· Decide the PRIMARY PHRASE first: the two-to-four words a buyer would actually type to find this exact thing (item + occasion or recipient + style). Everything else is built around it.',
      '· The title OPENS with the primary phrase, in the first 40 characters — that is all a buyer sees in a search result. Then the useful variations, separated by " | ". At most 130 characters, and no word repeated more than twice across the whole title.',
      '· The description\'s FIRST SENTENCE contains the primary phrase in a natural sentence, because the first ~160 characters are what a search engine shows.',
      '· Tags are long-tail SEARCH PHRASES, not a summary. Two or three words each, the way people type them, lower case.',
      '· Never stuff. A phrase repeated in the title, the first line and six tags reads as spam to a buyer and adds nothing to the ranking.',
      '',
      'THE DESCRIPTION IS SCANNED, NOT READ:',
      '· One opening sentence (the primary phrase, what the thing is, who it is for).',
      '· Then 3-6 bullet lines, each starting with "• ", each one fact a buyer decides on — what it is, how it is made, how it fits, how it is printed, what it comes in. One line each, no paragraph hiding inside a bullet.',
      '· Then, only if the input has them, the ordering or personalisation steps kept as "1- ", "2- " on their own lines.',
      '· Plain text. No HTML, no markdown headings, no asterisks.',
      '',
      `Return STRICT JSON and nothing else: {"title": "...", "description": "...", "tags": ["...", "..."]}`,
      `"tags" is up to ${MAX_TAGS} phrases, each at most ${MAX_TAG_LEN} characters — that is the marketplace's own limit and a longer one is simply rejected. No punctuation, no hashtags, no repeats, no brand names.`,
      have.length ? `The listing already carries these tags — do not repeat them, fill the remaining slots: ${have.join(', ')}` : '',
      usable.length ? `\nYou are shown ${usable.length} photo${usable.length === 1 ? '' : 's'} of the listing itself. Use ${usable.length === 1 ? 'it' : 'them'} to see what the product and the artwork ACTUALLY are — the subject, the style, the occasion. Describe nothing you cannot see, and never transcribe a logo or a watermark.` : '',
      facts ? '\nPRODUCT FACTS (the only facts you may add):\n' + facts : '',
    ].filter(Boolean).join('\n');

    const content = usable.map((r) => ({
      type: 'image',
      source: { type: 'base64', media_type: r.mime, data: r.buf.toString('base64') },
    }));
    content.push({
      type: 'text',
      text: `TITLE:\n${title || '(none)'}\n\nDESCRIPTION:\n${description || '(none)'}`,
    });

    try {
      const raw = await aiComplete({
        system,
        messages: [{ role: 'user', content }],
        maxTokens: 1600,
        costRef: `airewrite-${crypto.randomBytes(8).toString('hex')}`,
        costNote: usable.length
          ? `Listing copy + tags from ${usable.length} photo${usable.length === 1 ? '' : 's'}`
          : 'Listing copy rewrite',
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
        tags: cleanTags(out.tags, have),
        // Said plainly, because "I sent 5 and it read 3" is otherwise invisible and silently
        // changes what the copy is based on.
        photosRead: usable.length,
      };
    } catch (e) {
      // `disabled` means no key is configured, which is a setup answer, not a failure.
      reply.code(e.status || 502);
      return { error: e.message, disabled: !!e.disabled };
    }
  });

  /* ══════════════════ THE LISTING PHOTO STUDIO ══════════════════
   *
   * A product made from a SpyDeck card arrives with the competitor's photos as REFERENCE and
   * an empty publishable set — that is deliberate and stays true here. What was missing was
   * any way to get from "here is what sells" to "here is our own photograph of it" without
   * saving every competitor shot to a laptop and re-uploading it into the chat generator.
   *
   * Two routes, and the split is the point:
   *
   *   photo-prompt   READS the reference photos and WRITES a prompt. It renders nothing and
   *                  spends nothing at Google. Its output is a suggestion in a text box the
   *                  person edits before anything is made.
   *   photo-generate TAKES that prompt, plus whichever references were left ticked, and
   *                  renders 1-4 candidates.
   *
   * Neither writes to the listing. The client shows renders as CANDIDATES and a press moves
   * one into the publishable set — so a bad render is never already in the set, which is the
   * same rule the reference strip itself exists to enforce.
   *
   * WHAT THE PROMPT WRITER IS FOR, AND WHAT IT MUST NOT DO. It describes the SHOT — garment,
   * colour, crop, light, surface, props — because that is the part a competitor's photograph
   * legitimately teaches. It is explicitly forbidden from reproducing their artwork, their
   * watermark, or any brand, character or franchise name, for exactly the reason the
   * "attach anyway" button was removed from this page: the shop that gets suspended is the
   * seller's. The publish screen still runs detectTrademarks over the copy, so this is a
   * second line rather than the only one.
   */

  /*
   * Same outcomes as the chat generator's gate, and deliberately the same rule rather than a
   * second one: admin and operator generate on the factory's account, a seller spends their
   * own wallet if an admin switched it on, and warehouse/designer are refused.
   *
   * Kept in step with `IMAGE_ROLES` in support_ai.js by hand — two routes, one rule, and a
   * role added to one and not the other is a page that half works.
   */
  const IMAGE_ROLES = new Set(['admin', 'operator']);
  const genGate = async (req, reply) => {
    const role = String(req.user?.role || 'seller');
    if (IMAGE_ROLES.has(role)) return null;
    if (role !== 'seller') {
      reply.code(403);
      return { error: 'Generating photos is limited to admins, operators and sellers.' };
    }
    const pricing = await readPricing();
    if (!pricing.sellersEnabled) {
      reply.code(403);
      return { error: 'AI generation is not switched on for your account yet.' };
    }
    return null;
  };


  /**
   * READ THE PHOTOS, WRITE A PROMPT. No image is rendered and no money is spent at Google.
   *
   * On a click, never on open and never on a keystroke — same rule as the copy rewriter
   * above, and for the same reason: a request that can recur on its own eventually does.
   */
  app.post('/api/publish/photo-prompt', { preHandler: requireAuth }, async (req, reply) => {
    const denied = await genGate(req, reply); if (denied) return denied;
    const b = req.body || {};

    const refs = await refBytes(b.images, 4);
    const usable = refs.filter((r) => VISION_MIME.test(r.mime));
    if (!usable.length) {
      reply.code(400);
      return { error: 'None of those photos could be read. Try again, or describe the shot yourself.' };
    }

    // Facts the model may state, passed explicitly. Everything else it can only DESCRIBE
    // from the picture — this is what stops a 3XL or a fabric weight appearing in a prompt
    // that becomes a photograph a buyer reads as a promise.
    const facts = [
      b.product && `We will print on: ${String(b.product).slice(0, 200)}`,
      b.method && `Decoration method: ${String(b.method).slice(0, 60)}`,
      Array.isArray(b.colors) && b.colors.length && `Garment colours we offer: ${b.colors.slice(0, 24).join(', ')}`,
      b.title && `Our listing title: ${String(b.title).slice(0, 200)}`,
    ].filter(Boolean).join('\n');

    const system = [
      'You write prompts for a text-to-image model that renders PRODUCT PHOTOGRAPHY for print-on-demand listings.',
      'You are shown a competitor\'s own listing photos. You are studying HOW THE PRODUCT IS PHOTOGRAPHED so we can shoot our own version — you are not copying their listing.',
      '',
      'RULES, in order of importance:',
      '1. NEVER describe or reproduce their artwork literally. Say what KIND of design sits on the garment (subject, era, mood, lettering style, palette) at the level a photographer would brief it. Do not transcribe their slogan word for word and do not recreate their illustration.',
      '2. NEVER name a brand, character, franchise, team, celebrity or shop — not theirs, not ours, not the garment manufacturer. If the photo shows a logo, a name tape or a watermark, leave it out entirely.',
      '3. NEVER include a watermark, a signature, a price sticker, a border or any overlaid text in the prompt. We are making a clean photograph.',
      '4. Describe the SHOT, which is the part worth learning: garment type and colour, how it is presented (flat lay, on a person, hanging), the crop, the background surface, the props, the light and its direction, and the overall colour grade.',
      '5. State no fact you cannot see. No fabric weights, no sizes, no delivery claims.',
      '6. Plain descriptive English, one paragraph, 60-120 words. No camera brand names, no artist names, no "8k / masterpiece / trending" filler.',
      '',
      'Return STRICT JSON and nothing else: {"prompt": "...", "read": "..."}',
      '"prompt" is the paragraph described above, ready to paste into the image model.',
      '"read" is one short sentence for a human, saying what you noticed about how they shot it.',
      facts ? '\nWHAT WE ARE ACTUALLY MAKING (the only facts you may state):\n' + facts : '',
    ].join('\n');

    const content = usable.map((r) => ({
      type: 'image',
      source: { type: 'base64', media_type: r.mime, data: r.buf.toString('base64') },
    }));
    content.push({
      type: 'text',
      text: `The ${usable.length === 1 ? 'photo above is' : `${usable.length} photos above are`} the competitor's own listing shot${usable.length === 1 ? '' : 's'}. Write the prompt for OUR photograph.`,
    });

    try {
      // keepEmoji: false — the paragraph is read by a person here and pasted into a prompt,
      // and an emoji in a rendering prompt is noise the model tries to draw.
      //
      // costRef books what Anthropic charged for READING the photos. It is roughly a cent
      // with four references and it is pressed repeatedly while the wording is tuned, so it
      // belongs in the same line as the render it precedes rather than nowhere.
      const raw = await aiComplete({
        system, messages: [{ role: 'user', content }], maxTokens: 900,
        costRef: `aiprompt-${crypto.randomBytes(8).toString('hex')}`,
        costNote: `Prompt from ${usable.length} reference photo${usable.length === 1 ? '' : 's'}`,
      });
      const m = /\{[\s\S]*\}/.exec(raw || '');
      let out = null;
      try { out = m ? JSON.parse(m[0]) : null; } catch { out = null; }
      if (!out || !out.prompt) {
        reply.code(502);
        return { error: 'The assistant returned something we could not read. Try again.' };
      }
      return {
        prompt: String(out.prompt).replace(/\s+/g, ' ').trim().slice(0, 2000),
        read: String(out.read || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        // Said plainly, because "I sent 5 and it looked at 3" is otherwise invisible and
        // silently changes what the prompt is based on.
        photosRead: usable.length,
      };
    } catch (e) {
      reply.code(e.status || 502);
      return { error: e.message, disabled: !!e.disabled };
    }
  });

  /**
   * RENDER 1-4 CANDIDATES. Nothing here touches the listing.
   *
   * SEQUENTIAL, not Promise.all. Four 2K Pro renders fired together is a burst against a
   * model that already answers "high demand" under load, and the failure mode of a parallel
   * batch is four charges and one picture. One at a time means a cap, a balance or an
   * overload stops the batch and the caller keeps whatever already rendered.
   */
  const MAX_BATCH = 4;

  /*
   * THE HISTORY — every render, kept, because every render was paid for.
   *
   * The candidates lived in the dialog's own state, so closing the window threw away work
   * somebody had been charged for. The picture itself was never lost — it is a private
   * object in storage behind a same-origin proxy path, and a published listing reads it
   * back from there — but the ONLY thing that knew the path was a React array, and that
   * array does not survive the window shutting.
   *
   * FILED UNDER THE ACCOUNT THAT PAID, not the person who pressed. A team member spends the
   * owner's wallet (effectiveSeller), so filing by `sub` would hide a member's renders from
   * the owner whose money made them. Staff pay nothing and are their own account.
   *
   * DELETING A ROW DELETES THE ROW. The stored object stays, deliberately: by the time you
   * tidy the history the photo may already be live on a listing, and removing it from a
   * history panel must never be a way to blank a marketplace photo. This is the list of what
   * you can come back to, not the storage itself.
   *
   * Created at route load rather than in schema.sql, which runs on first db init only — the
   * same pattern as ai_generations, order_designs and the rest of the late tables.
   */
  let _renders;
  const renderHistoryTable = () => {
    _renders ??= q(`create table if not exists listing_renders (
        id          bigserial primary key,
        owner_id    text not null,
        actor_id    text,
        url         text not null,
        prompt      text,
        model       text,
        size        text,
        aspect_ratio text,
        charged     numeric(10,4) not null default 0,
        created_at  timestamptz not null default now()
      )`)
      .then(() => q('create index if not exists listing_renders_owner on listing_renders (owner_id, created_at desc)'))
      .catch((e) => { _renders = undefined; throw e; });
    return _renders;
  };

  /** Whose history this is. Null from effectiveSeller means staff — their own account. */
  const historyOwner = async (user) => (await effectiveSeller(user)) || String(user?.sub || '');

  const historyRow = (r) => ({
    id: String(r.id),
    url: r.url,
    prompt: r.prompt || undefined,
    model: r.model || '',
    size: r.size || '',
    aspectRatio: r.aspect_ratio || '1:1',
    charged: Number(r.charged || 0),
    createdAt: r.created_at,
  });

  /*
   * A GET, and safe as one: it reads a table and spends nothing, which is exactly the
   * property the two POSTs above do not have. The dialog may call it on open.
   */
  app.get('/api/publish/photo-history', { preHandler: requireAuth }, async (req) => {
    await renderHistoryTable();
    const owner = await historyOwner(req.user);
    const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query?.limit) || 60)));
    const r = await q(
      `select id, url, prompt, model, size, aspect_ratio, charged, created_at
         from listing_renders where owner_id = $1
        order by created_at desc, id desc limit $2`, [owner, limit]);
    return { renders: r.rows.map(historyRow) };
  });

  app.delete('/api/publish/photo-history/:id', { preHandler: requireAuth }, async (req, reply) => {
    // Validated as digits BEFORE the cast: `id = $1::bigint` on 'abc' is a 500 from Postgres
    // rather than the 404 this should be.
    const id = String(req.params?.id || '');
    if (!/^\d+$/.test(id)) { reply.code(400); return { error: 'That is not a render id.' }; }
    await renderHistoryTable();
    const owner = await historyOwner(req.user);
    // Scoped by owner in the WHERE, not checked after the read — one query, and no way to
    // delete a row off another account by guessing its id.
    const r = await q('delete from listing_renders where id = $1::bigint and owner_id = $2 returning id', [id, owner]);
    if (!r.rowCount) { reply.code(404); return { error: 'That photo is not in your history.' }; }
    return { ok: true };
  });


  app.post('/api/publish/photo-generate', { preHandler: requireAuth }, async (req, reply) => {
    const denied = await genGate(req, reply); if (denied) return denied;
    if (!storageEnabled()) { reply.code(503); return { error: 'File storage is not configured, so a generated photo could not be kept.' }; }

    const b = req.body || {};
    const prompt = String(b.prompt || '').trim();
    if (!prompt) { reply.code(400); return { error: 'Describe the photo you want.' }; }
    if (prompt.length > 4000) { reply.code(400); return { error: 'That prompt is too long (max 4000 characters).' }; }

    const spec = IMAGE_MODELS.find((m) => m.id === b.model) || null;
    const model = spec ? spec.id : undefined;                       // undefined → gemini.js picks the configured default
    const aspectRatio = ASPECT_RATIOS.includes(b.aspectRatio) ? b.aspectRatio : '1:1';
    // Opt-in cut-out backdrop — validated in gemini.js, which owns the clause. Passing it
    // through unchecked here would put two copies of the allow-list in the codebase.
    const backdrop = b.backdrop;
    const imageSize = spec && spec.sizes.includes(b.imageSize) ? b.imageSize : undefined;
    const count = Math.min(MAX_BATCH, Math.max(1, Math.floor(Number(b.count) || 1)));

    const refs = await refBytes(b.images, (spec && spec.maxRefs) || 6);

    const base = (process.env.PUBLIC_API_ORIGIN || 'https://egful.store').replace(/\/+$/, '');
    const results = [];
    const errors = [];

    for (let i = 0; i < count; i++) {
      /*
       * TAKE THE MONEY FIRST, per render. moveFunds refuses to overdraw, so charging here is
       * what stops an unfunded render BEFORE Google bills us for it — and doing it inside the
       * loop is what makes "you have 2 left today" stop the batch at two rather than charging
       * for four and rendering two.
       */
      let charge;
      try {
        charge = await chargeForGeneration(req.user, 'image');
      } catch (e) {
        errors.push(e.message || 'Could not start this generation.');
        break;   // a cap or an empty wallet does not clear on the next pass round the loop
      }

      let img;
      try {
        img = await generateImage({ prompt, aspectRatio, imageSize, model, images: refs, backdrop });
      } catch (e) {
        req.log?.warn?.({ err: String(e), detail: e.detail }, 'listing-photo generation failed');
        await refundGeneration(charge, 'image generation failed');
        errors.push(e.message || 'Image generation failed');
        // An overload or a missing key applies to every remaining render in the batch, so
        // stop rather than spending the next three seconds failing three more times.
        if (e.overloaded || e.disabled) break;
        continue;
      }

      const ext = img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/webp' ? 'webp' : 'png';
      const name = `gen-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      try {
        // PRIVATE, same as a chat upload, and handed back as a same-origin proxy path. It
        // loads in an <img> without a public bucket, and imageBytesFrom reads it straight
        // out of storage when the listing is published — so what publishes is a ~60-byte
        // string rather than a multi-megabyte base64 blob riding in the payload.
        await putObject(`chat/${name}`, img.buffer, img.mime, 'private');
      } catch (e) {
        req.log?.error?.({ err: String(e) }, 'listing-photo storage failed');
        await refundGeneration(charge, 'image could not be saved');
        errors.push('A photo was generated but could not be saved: ' + ((e && e.message) || 'storage error'));
        continue;
      }

      // Google has billed us for this one — booked before anything else can go wrong with it.
      await recordGenerationCost(charge.ref, img.usd, `Image · ${img.model} · ${img.size} · ${img.aspectRatio} · listing photo`);

      const row = {
        url: `${base}/api/support/asset/${name}`,
        model: img.model, size: img.size, aspectRatio: img.aspectRatio,
        // `usd` is what GOOGLE cost US and is staff-only reading; `charged` is what the
        // seller actually paid. Keeping them apart is what stops our cost being shown as
        // their price.
        usd: charge.staff ? img.usd : undefined,
        charged: charge.usd, free: charge.free,
      };

      /*
       * FILE IT — after the money and after the storage, and never fatal.
       *
       * The render exists and has been paid for by the time this runs, so a history insert
       * that fails must hand back the photo anyway; losing the row costs a line in a panel,
       * and throwing here would cost the picture. The prompt rides along because coming back
       * to a render you liked is mostly about coming back to the BRIEF that made it.
       */
      try {
        await renderHistoryTable();
        const ins = await q(
          `insert into listing_renders (owner_id, actor_id, url, prompt, model, size, aspect_ratio, charged)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, created_at`,
          [charge.sellerId || String(req.user?.sub || ''), String(req.user?.sub || ''), row.url,
           prompt.slice(0, 4000), row.model, row.size, row.aspectRatio, charge.usd || 0]);
        row.id = String(ins.rows[0].id);
        row.createdAt = ins.rows[0].created_at;
      } catch (e) {
        req.log?.warn?.({ err: String(e) }, 'listing-photo history insert failed');
      }

      results.push(row);
    }

    return {
      ok: results.length > 0,
      results,
      errors,
      // Refreshed AFTER the batch so the panel's "2 free left" is the count that survived it.
      quote: await quoteFor(req.user),
    };
  });
}
