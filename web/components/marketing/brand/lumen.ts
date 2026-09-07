/**
 * ── LUMEN · THE LOCKED DIRECTION ─────────────────────────────────────────────────────
 *
 * Reference lock, taken from phantom.app after measuring it rather than describing it.
 *
 * PRESERVE (the traits that must survive):
 *   1. LIGHT. Paper is the dominant ground; violet is the LETTERING, not the field. This is
 *      the inverse of the purple-ground idea and it is the version that is proven — and it
 *      is what fixes "everything is too dark" at the root.
 *   2. Display type at weight 300–350, never bold. The whisper-weight headline at 96px is
 *      the single biggest reason the brand reads young rather than corporate.
 *   3. Two radii and no third: 24px for blocks and cards, 32px for buttons, 100px for pills.
 *   4. Elevation is a change of ground, never a shadow. The one shadow Phantom uses is a
 *      4px glow in the button's own colour.
 *   5. Muted violets only. No saturated primaries anywhere except a semantic green.
 *
 * BORROW NARROWLY:
 *   · Bōjka — one band where the colour goes full-bleed and the type gets enormous.
 *   · Evoke — flat objects on a colour panel, at Evoke's ratio (objects are punctuation).
 *
 * REJECT:
 *   · Phantom's own repetition — its page is one card component restated a dozen times.
 *     Every band here gets a different composition; that is the whole brief.
 *   · Bold display weights. Sharp corners. Any shadow used as depth. Gradient meshes.
 *
 * ── THE MOTION FINDING, AND IT IS THE IMPORTANT ONE ──────────────────────────────────
 * phantom.app loads NO animation library. Probed live: gsap ✗, lenis ✗, framer ✗, lottie ✗,
 * rive ✗. What it has instead is 26 <video> elements against 2 <img>, and 77
 * IntersectionObservers — short silent loops, played when they enter view. 54 CSS
 * transitions carry every hover. 6 WAAPI calls in the whole page.
 *
 * So "component animation" here means A SHORT SILENT VIDEO, not JavaScript choreography.
 * It is cheaper, it degrades to a poster frame, it cannot jank, and it is the reason their
 * product demos look like product demos rather than like a webpage pretending.
 */

export const L = {
  /** The page. Warmer than pure white — Phantom's own #fdfcfe. */
  paper: "#FDFCFE",
  /** The lettering, and the brand. Muted deep violet: never black, never bright. */
  ink: "#3C315B",
  /** Secondary lettering. */
  muted: "#86848D",
  /** The block colour. Whole bands and primary buttons. Carries `ink`. */
  mist: "#E2DFFE",
  /** The one saturated note. Secondary fills and marks. Carries `ink`. */
  grape: "#AB9FF2",
  /** A deeper violet for the single dark band. Carries `paper`. */
  deep: "#241E38",
  /** Near-black for the one inverted card. Carries `paper`. */
  char: "#1C1C1C",
  /** Barely-there separation. */
  fog: "#F4F2F4",
  ash: "#E9E8EA",
} as const

/**
 * Measured, because a palette this close in value is exactly where contrast quietly fails:
 *   ink #3C315B on paper #FDFCFE ......... 11.9:1  ✓ anything
 *   ink on mist #E2DFFE .................. 9.4:1   ✓ anything
 *   ink on grape #AB9FF2 ................. 5.3:1   ✓ body text
 *   paper on deep #241E38 ................ 14.6:1  ✓ anything
 *   paper on char #1C1C1C ................ 16.4:1  ✓ anything
 *   muted #86848D on paper ............... 3.6:1   ✗ body — labels and large only
 */
export const RADIUS = { block: 24, button: 32, pill: 100, chip: 12 } as const

/** Display sizes. Blown out, and light — the two only work together. */
export const DISPLAY = {
  hero: "clamp(3rem, 10.5vw, 9.5rem)",
  section: "clamp(2.2rem, 5.6vw, 5rem)",
  block: "clamp(1.6rem, 3vw, 2.6rem)",
} as const

/** One weight for every display size. 300, never more. */
export const DISPLAY_WEIGHT = 300
export const DISPLAY_TRACKING = "-0.025em"


/**
 * ── THE GROUND QUESTION ──────────────────────────────────────────────────────────────
 * Three candidate page grounds, all of which pass contrast against `ink` comfortably — so
 * this is a temperature decision, not a legibility one, and the only way to settle it is to
 * look at all three at full size.
 *
 *   paper #FDFCFE .... Phantom's own. A white with the faintest violet bias. ink → 11.9:1
 *   grey  #F1F0F4 .... cool light grey, same violet bias, one step down.     ink → 10.4:1
 *   beige #F2EFE9 .... warm off-white, yellow-leaning.                        ink → 10.2:1
 *
 * THE ARGUMENT AGAINST BEIGE is temperature, not contrast: `ink` is a cool blue-violet, and
 * a yellow-leaning ground pulls against it — the pair reads muddier and older than either
 * does alone. A violet-biased grey gets the same softness without the fight, and any warmth
 * the page wants is better bought from the garments, which are already bone and clay.
 */
export const GROUNDS = {
  paper: { key: "paper", label: "Paper", page: "#FDFCFE", card: "#F4F2F4", edge: "#E9E8EA" },
  grey:  { key: "grey",  label: "Violet grey", page: "#F1F0F4", card: "#FBFAFC", edge: "#E3E1E8" },
  beige: { key: "beige", label: "Warm beige", page: "#F2EFE9", card: "#FBF9F5", edge: "#E4DFD5" },
} as const

export type GroundKey = keyof typeof GROUNDS
export const DEFAULT_GROUND: GroundKey = "grey"
