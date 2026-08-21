/**
 * STUDIO TEMPLATES — a prompt you click instead of a prompt you write.
 *
 * The generator already existed and nobody used it, because it opens on an empty box. A
 * blank prompt field asks you to be a photographer at the exact moment you wanted a picture
 * of a t-shirt, so the honest cost of an image was ten minutes of writing rather than three
 * cents of rendering. These are the ten minutes, written once.
 *
 * NOT the same thing as `templates-panel.tsx`. That lists saved product templates — a blank
 * plus an artwork setup you reopen. Same word, different object; these are generation
 * briefs and own nothing.
 *
 * DATA, NOT COMPONENTS. Each entry is a plain object so a new card is four lines here, and
 * so the whole set can move behind Settings later without touching the page that renders
 * it — the same path the homepage copy took (lib/site-content.ts).
 *
 * SLOTS: `{product}`, `{colour}` and `{brand}` are filled from what the studio knows before
 * the prompt is sent. A template that names no slot still works; a slot with nothing behind
 * it is dropped along with the phrase around it rather than sending the literal braces to
 * the model.
 */

export type TemplateGroup = "product" | "social" | "motion" | "site"

export type StudioTemplate = {
  id: string
  group: TemplateGroup
  /** Two or three words. It is a card label, not a sentence. */
  name: string
  /** One line, what you get — shown under the name. */
  what: string
  prompt: string
  /** The shape this brief is composed for. A hero is not a story frame. */
  ratio: string
  /**
   * A motion template still RENDERS A STILL FIRST. Veo costs many times what an image does,
   * so the frame is approved before anything is animated — otherwise a composition you
   * didn't want gets paid for twice. `motion` describes the clip made FROM the still.
   */
  motion?: string
}

export const TEMPLATE_GROUPS: { id: TemplateGroup; label: string; what: string }[] = [
  { id: "product", label: "Product photos", what: "For a listing — Etsy, Shopify, TikTok." },
  { id: "social", label: "Social & marketing", what: "Posts, announcements, campaign art." },
  { id: "motion", label: "Motion", what: "A still you approve, then animated." },
  { id: "site", label: "Site imagery", what: "Heroes and section art for egful.store." },
]

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  // ── Product ───────────────────────────────────────────────────────────────
  {
    id: "hero", group: "product", name: "Product hero", ratio: "1:1",
    what: "The main listing photo, on a clean ground.",
    prompt: "A {colour} {product} centred on a plain seamless off-white background under even, soft studio light. No props, no cast shadow, the whole item in frame with a little room around it. Sharp focus across the print. Commercial product photography.",
  },
  {
    id: "flatlay", group: "product", name: "Flat lay", ratio: "1:1",
    what: "Shot from overhead, styled but simple.",
    prompt: "A {colour} {product} laid flat and smoothed out, photographed from directly overhead on a warm neutral surface. Soft even daylight from one side, a few simple props just out of frame. Slight natural creasing so it reads as fabric, not a render.",
  },
  {
    id: "onmodel", group: "product", name: "On a model", ratio: "4:5",
    what: "Worn, cropped so the print fills the frame.",
    prompt: "A person wearing a {colour} {product}, cropped from the shoulders to the hips so the printed area fills the frame. Natural indoor daylight, relaxed posture, face out of frame. Real fabric drape and texture.",
  },
  {
    id: "detail", group: "product", name: "Close detail", ratio: "1:1",
    what: "The print and the weave, up close.",
    prompt: "An extreme close crop on the printed area of a {colour} {product}, the fabric weave and the print texture clearly visible. Raking light from one side to bring up the surface. Shallow depth of field falling off at the edges.",
  },
  {
    id: "stack", group: "product", name: "Folded stack", ratio: "1:1",
    what: "Several folded together — good for a range.",
    prompt: "Three or four {product} folded and stacked neatly on a pale wooden surface, the top one showing its print. Soft window light from the left, gentle shadows, warm neutral grade.",
  },

  // ── Social & marketing ────────────────────────────────────────────────────
  {
    id: "drop", group: "social", name: "New drop", ratio: "4:5",
    what: "An announcement post with room for a headline.",
    prompt: "A {colour} {product} arranged in the lower two thirds of the frame against a plain, softly graded background, with clean empty space across the top for a headline to be set later. Bold directional light, confident modern styling.",
  },
  {
    id: "lifestyle", group: "social", name: "Lifestyle scene", ratio: "4:5",
    what: "In a real setting, styled and warm.",
    prompt: "A {colour} {product} in a lived-in setting — a kitchen counter, a hallway bench, a sunlit desk — with a few simple props softly out of focus behind it. Warm side light, shallow depth of field, unposed and candid.",
  },
  {
    id: "gift", group: "social", name: "Gift moment", ratio: "1:1",
    what: "Wrapped or being handed over.",
    prompt: "A {colour} {product} folded beside simple kraft wrapping and twine on a warm surface, as a gift about to be given. Soft daylight, muted seasonal styling, nothing glossy.",
  },
  {
    id: "flatgrid", group: "social", name: "Colour range", ratio: "1:1",
    what: "The same item across several colours.",
    prompt: "Several {product} in different colours laid out flat in an even grid, shot from directly overhead on a neutral surface under flat even light. Equal spacing, no perspective distortion.",
  },

  // ── Motion ────────────────────────────────────────────────────────────────
  {
    id: "turntable", group: "motion", name: "Slow turn", ratio: "1:1",
    what: "The product rotating on the spot.",
    prompt: "A {colour} {product} centred on a plain seamless background under even studio light, front on, the whole item in frame.",
    motion: "The product rotates slowly and smoothly on the spot, one steady revolution, the camera locked off. Nothing else in the frame moves.",
  },
  {
    id: "reveal", group: "motion", name: "Fabric settle", ratio: "9:16",
    what: "The garment falling into place.",
    prompt: "A {colour} {product} hanging against a soft neutral background, lit from one side, the fabric still.",
    motion: "The fabric settles gently as if just hung, a slow drift and rest. Light shifts almost imperceptibly. Camera locked off, no cuts.",
  },
  {
    id: "pan", group: "motion", name: "Slow push", ratio: "16:9",
    what: "A gentle move toward the detail.",
    prompt: "A {colour} {product} laid on a warm surface with the printed area toward the camera, soft daylight, shallow depth of field.",
    motion: "The camera pushes in slowly and steadily toward the printed area over the full clip. No cuts, no shake, nothing else moves.",
  },

  // ── Site imagery ──────────────────────────────────────────────────────────
  {
    id: "hero-wide", group: "site", name: "Page hero", ratio: "16:9",
    what: "A wide plate for the top of a page.",
    prompt: "A wide, calm production scene — folded garments, a work surface, soft natural light — composed with generous empty space on one side for a headline. Muted neutral grade, nothing branded, nothing readable in frame.",
  },
  {
    id: "section", group: "site", name: "Section art", ratio: "4:5",
    what: "A supporting picture for a feature block.",
    prompt: "A quiet, close detail from a small print workshop — thread cones, a stack of blanks, a hand smoothing fabric — shot with a shallow depth of field in soft daylight. Warm neutral grade, no faces, no text.",
  },
  {
    id: "texture", group: "site", name: "Texture plate", ratio: "16:9",
    what: "An abstract ground to sit type on.",
    prompt: "An abstract close texture of woven cotton fabric filling the frame, lit at a raking angle so the weave reads clearly. Very soft contrast, single muted colour, nothing else in frame.",
  },
]

/**
 * Fill the slots, and remove what cannot be filled.
 *
 * A missing value takes its surrounding phrase with it. "{colour} t-shirt" with no colour
 * would otherwise become " t-shirt" and read as a typo to the model, or worse — send the
 * literal braces, which some models will happily draw.
 */
export function fillTemplate(prompt: string, vals: { product?: string; colour?: string; brand?: string }): string {
  return prompt
    .replace(/\{product\}/g, vals.product?.trim() || "garment")
    .replace(/\{colour\}\s*/g, vals.colour?.trim() ? `${vals.colour.trim()} ` : "")
    .replace(/\{brand\}\s*/g, vals.brand?.trim() ? `${vals.brand.trim()} ` : "")
    .replace(/\s{2,}/g, " ")
    .trim()
}
