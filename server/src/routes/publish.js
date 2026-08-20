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
import { readPricing, quoteFor, chargeForGeneration, refundGeneration } from '../ai-pricing.js';

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
   * Same three outcomes as the chat generator's gate, and deliberately the same rule rather
   * than a second one: admin generates on the factory's account, a seller spends their own
   * wallet if an admin switched it on, and operator/warehouse/designer are refused because
   * they would be spending ours from a screen where it looks like any other button.
   */
  const genGate = async (req, reply) => {
    const role = String(req.user?.role || 'seller');
    if (role === 'admin') return null;
    if (role !== 'seller') {
      reply.code(403);
      return { error: 'Generating photos is limited to admins and sellers.' };
    }
    const pricing = await readPricing();
    if (!pricing.sellersEnabled) {
      reply.code(403);
      return { error: 'AI generation is not switched on for your account yet.' };
    }
    return null;
  };

  /*
   * Sources → bytes, through the ONE allowlisted resolver.
   *
   * The client sends the same strings the publish payload carries: a competitor's
   * etsystatic URL, a data: URL, or one of our own stored renders. imageBytesFrom is what
   * decides which of those is fetchable, so nothing here can be pointed at an arbitrary
   * host — and a source it refuses is SKIPPED rather than fatal, because one dead thumbnail
   * should not throw away a prompt somebody already reviewed.
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
      const raw = await aiComplete({ system, messages: [{ role: 'user', content }], maxTokens: 900 });
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
        img = await generateImage({ prompt, aspectRatio, imageSize, model, images: refs });
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

      results.push({
        url: `${base}/api/support/asset/${name}`,
        model: img.model, size: img.size, aspectRatio: img.aspectRatio,
        // `usd` is what GOOGLE cost US and is staff-only reading; `charged` is what the
        // seller actually paid. Keeping them apart is what stops our cost being shown as
        // their price.
        usd: charge.staff ? img.usd : undefined,
        charged: charge.usd, free: charge.free,
      });
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
