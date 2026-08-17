/**
 * MARKETPLACE DESCRIPTIONS, GIVEN THEIR STRUCTURE BACK.
 *
 * Every publish path had the same bug in its own dialect. Shopify put the raw string into
 * `body_html`, so a plain-text blob rendered as one unbroken paragraph. TikTok split on
 * blank lines and wrapped whatever came out. Etsy passed it through untouched. A scraped
 * marketplace description has NO blank lines — it arrives as one run of text — so all three
 * published the same 900-character wall:
 *
 *   "…Disney Family Vacation How to Order T-shirt 1- Please, check and review all photos
 *    2- Please choose your t-shirt style and size 3- …6.1 oz./yd² (US)…"
 *
 * Correct, and unreadable, which on a product page is the same as wrong.
 *
 * ONE PARSER, TWO RENDERERS. The structure is a property of the text, not of the channel —
 * only the output format differs, and writing that per platform is what let three copies
 * drift into three different wrongnesses. HTML for Shopify and TikTok, plain text with real
 * newlines for Etsy (whose description field is text, not markup).
 *
 * IT RE-FLOWS, IT DOES NOT REWRITE. No word is added, removed or reordered. Making the copy
 * better is a job for the AI assist, where a person reviews the result — a formatter that
 * quietly edits a seller's words is one nobody can predict or trust.
 */

const squash = (v) => String(v).replace(/\s+/g, ' ').trim();

/** Roughly a screenful. Past this a paragraph stops being read and starts being skipped. */
const MAX_PARA = 300;

/**
 * Prose to paragraphs, broken at sentence ends.
 *
 * Splitting mid-sentence to hit a length is worse than a long paragraph, so the break only
 * happens where a sentence already ended and the running buffer is over the limit.
 */
function proseBlocks(raw) {
  const t = squash(raw);
  if (!t) return [];
  if (t.length <= MAX_PARA) return [{ type: 'p', text: t }];
  const out = [];
  const sentences = t.match(/[^.!?]+[.!?]*\s*/g) || [t];
  let buf = '';
  for (const s of sentences) {
    if (buf && (buf + s).length > MAX_PARA) { out.push({ type: 'p', text: squash(buf) }); buf = ''; }
    buf += s;
  }
  if (squash(buf)) out.push({ type: 'p', text: squash(buf) });
  return out;
}

/**
 * The blocks a description is really made of.
 *
 * A NUMBERED STEP NEEDS ITS DIGIT. Splitting on a bare " - " looks tempting and destroys the
 * commonest line in a POD listing: "Silver - Burnt Orange - Light Pink - Safety Pink" is a
 * colour run, not four steps, and "Shoulder to shoulder" is one phrase. Requiring `1-`, `2.`
 * or `3)` is the whole difference between a list and a hyphen.
 *
 * AND THE LIST HAS TO END. Nothing marks the end of the last step the way "2-" marks the end
 * of "1-", so the final bullet absorbed the fabric spec, the stock colours and the shipping
 * table — one 759-character item beginning "Please click the Proceed to Check Out button."
 * A step is an instruction and an instruction is a sentence, so the last one keeps its first
 * sentence and hands the remainder back to the prose builder, where that content belonged.
 */
export function descriptionBlocks(text) {
  const blocks = [];
  for (const rawPara of String(text || '').split(/\n{2,}/)) {
    const para = squash(rawPara);
    if (!para) continue;
    const parts = para.split(/(?=\b\d{1,2}\s*[-.)]\s+)/g).map(squash).filter(Boolean);
    if (parts.length > 1) {
      const lead = /^\d{1,2}\s*[-.)]/.test(parts[0]) ? null : parts.shift();
      if (lead) blocks.push(...proseBlocks(lead));
      const items = [];
      const flush = () => { if (items.length) { blocks.push({ type: 'ul', items: items.slice() }); items.length = 0; } };
      parts.forEach((p, i) => {
        const body = squash(p.replace(/^\d{1,2}\s*[-.)]\s*/, ''));
        if (i < parts.length - 1) { items.push(body); return; }
        const m = /^([^.!?]*[.!?])\s*([\s\S]*)$/.exec(body);
        // 40 chars: a trailing clause shorter than that is part of the step, not a new
        // section, and cutting it out would strand half an instruction in its own paragraph.
        if (m && squash(m[2]).length > 40) {
          items.push(squash(m[1]));
          flush();
          blocks.push(...proseBlocks(m[2]));
        } else {
          items.push(body);
        }
      });
      flush();
      continue;
    }
    blocks.push(...proseBlocks(para));
  }
  return blocks;
}

/** Shopify `body_html` and TikTok `description`. Callers clean to their own rules FIRST —
 *  TikTok rejects entities and bare angle brackets, Shopify does not care. */
export function blocksToHtml(blocks) {
  return (blocks || []).map((b) => (b.type === 'ul'
    ? `<ul>${b.items.map((i) => `<li>${i}</li>`).join('')}</ul>`
    : `<p>${b.text}</p>`)).join('');
}

/** Etsy, whose description is PLAIN TEXT — markup there is printed literally, so a listing
 *  published with <p> tags shows the tags to the buyer. Blank line between blocks, a real
 *  bullet per item. */
export function blocksToText(blocks) {
  return (blocks || []).map((b) => (b.type === 'ul'
    ? b.items.map((i) => `• ${i}`).join('\n')
    : b.text)).join('\n\n');
}

/** Convenience: text in, HTML out, falling back to a title rather than emitting nothing. */
export function descriptionHtml(text, fallback = '') {
  const blocks = descriptionBlocks(text);
  return blocks.length ? blocksToHtml(blocks) : (fallback ? `<p>${squash(fallback)}</p>` : '');
}

/** Convenience: text in, plain text out. */
export function descriptionText(text, fallback = '') {
  const blocks = descriptionBlocks(text);
  return blocks.length ? blocksToText(blocks) : squash(fallback);
}
