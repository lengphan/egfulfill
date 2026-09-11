/**
 * THE MOBILE PALETTE — the "aura" direction, 2026-09-11.
 *
 * This replaces Workshop (tinted page · white card · violet · Anton + Inter) completely.
 * Workshop was the WEB's direction, mirrored here because CLAUDE.md said the web is
 * canonical and the phone follows. That is no longer true for the LOOK, and the divergence
 * is deliberate rather than drift: the owner chose a phone direction of its own. What still
 * mirrors the web exactly is every RULE and GATE — stages, permissions, money, what a seller
 * may see. Only the surface differs.
 *
 * WHAT THE DIRECTION IS, in four facts:
 *
 *   1. WARM PAPER, WHITE CARD. The page is #FBFAF7 and a card is pure white with a 1.5pt
 *      ink hairline. This reverses the 2026-08-19 "paper all the way down, never a white
 *      card" rule, and the reversal is legitimate for the same reason Workshop's was: that
 *      rule was written about white on warm paper held apart by NOTHING but a faint border.
 *      The border here is 1.5pt and visible, and the card radius is large, so the card reads
 *      as an object rather than as a smudge.
 *   2. ONE ACTION COLOUR. Periwinkle. Everything you press that matters is this hue and
 *      nothing else is. Store buttons and status marks carry their own washes so they never
 *      compete with it.
 *   3. LIME IS A HIGHLIGHT, NEVER A FILL FOR ANYTHING LARGE. The live tab dot, the shipped
 *      mark, the balance underline, the lit end of a moment icon. It is 1.19:1 against the
 *      page — it has no shape on paper at all — so it can never be a surface you read on.
 *   4. AURA ONLY ON MOMENTS. A drifting wash behind a welcome, a hero card, an empty state.
 *      Lists and forms stay on the plain page. See `components/aura.tsx`.
 *
 * CONTRAST IS MEASURED, NOT EYEBALLED (CLAUDE.md §4). Every figure in this file was produced
 * by `node tools/check-mobile-theme.mjs`, which re-measures all of them and fails if one
 * drifts. The kit this palette came from shipped FIVE pairs under the floor, and the numbers
 * below are the repaired values rather than the original ones:
 *
 *   white on #6B7CFF        3.53:1  — the primary button label. Fixed: `hue.deep`.
 *   ink40 as a tab label    2.47:1  — inactive tab text. Fixed: `muted`, and ink40 now
 *                                     carries "NOT TEXT" on it.
 *   #5262E6 on mist         4.29:1  — periwinkle as type. Fixed: `hue.deep`.
 *   #1A8A5F on its wash     3.89:1  — the Shopify mark. Fixed below.
 *   #C2551D on its wash     4.06:1  — the Etsy mark. Fixed below.
 */

/** Periwinkle — the one action colour. Change these three and the whole app follows. */
export const hue = {
  /** IDENTITY. Large fills, the aura, a thumbnail well. NEVER carries small text: white on
   *  it is 3.53:1 and ink on it is 4.81:1, so neither is safe at 13–15pt. */
  base: "#6B7CFF",
  /** THE ACTION FILL *and* periwinkle-as-type, deliberately one value doing both jobs.
   *  White on it is 5.19:1 (a button label); it on `mist` is 4.51:1 and on the page 4.98:1
   *  (a link, a chip's word). Two near-identical periwinkles is how a palette starts lying. */
  deep: "#505FDF",
  /** The action's own wash — a soft button, a thumbnail well, a selected row. */
  mist: "#ECEEFF",
} as const

/** Lime — the highlight. Allowed: live tab dot, shipped mark, balance underline, the lit end
 *  of a moment icon, the warm side of the aura. Never a button, never a surface with type. */
export const lime = {
  base: "#D9F26B",
  /** Type ON lime, 5.72:1, and on its wash, 6.65:1. */
  ink: "#4C5F0B",
  wash: "#F4FBD6",
} as const

/**
 * THE MOMENT RAMP — the periwinkle→lime run a drawn mark is stroked with.
 *
 * The two middle stops are not free-hand colours, they are the interpolation between
 * `hue.base` and `lime.base`, and they live here for the same reason LADDER_FILL does: a hex
 * typed into a component is a second opinion about the palette, and the gate fails on one.
 *
 * A STROKE, NEVER A GROUND. These are drawn at 9pt on paper, where they are a picture rather
 * than type — none of them would clear a text floor and none of them is ever asked to.
 */
export const MOMENT_RAMP = { mid: "#9FB0FF", ring: "#8A97FF" } as const

export const C = {
  /** THE PAGE. Warm paper. */
  canvas: "#FBFAF7",
  /** A CARD. Pure white, drawn by a 1.5pt `hairline`, and never shadowed — the only two
   *  things in this app allowed a shadow are named in `LIFT`. */
  surface: "#FFFFFF",

  /** ALL TYPE. Near-navy rather than black — 16.27:1 on the page, 16.98:1 on a card. */
  ink: "#151B33",
  /** SECONDARY TYPE. 4.73:1 on the page, 4.79:1 on a card. It is `ink` at 62%, flattened to
   *  a literal: at the kit's 60% it measured 4.45:1, under the floor by a hair, which is
   *  exactly the kind of miss an alpha hides. */
  muted: "#6C707D",
  /** NOT TEXT. 2.47:1 — a dot, an inactive glyph, a divider tick. The kit set inactive tab
   *  LABELS in this, and they were, measurably, not readable. */
  ink40: "rgba(21,27,51,0.40)",
  /** THE HAIRLINE that draws every card, row and chip. 1.22:1 — a line, not a target. */
  hairline: "rgba(21,27,51,0.10)",
  /** A CONTROL boundary — a text field, an outlined control. WCAG 1.4.11 puts a 3:1 floor
   *  under anything you are meant to FIND, which a 1.22:1 hairline does not clear. */
  edge: "#8E9099",

  hue: hue.base,
  hueDeep: hue.deep,
  hueMist: hue.mist,
  lime: lime.base,
  limeInk: lime.ink,
  limeWash: lime.wash,

  /** THE AURA WASH. Low saturation, and never used for an action — these are the only
   *  colours allowed to sit under content. */
  auraPeri: "#D6DBFF",
  auraLime: "#EDF7C4",
  auraSky: "#D2E6FF",
  auraLilac: "#E4DDFF",

  /** THE THREE SIGNAL INKS — an error sentence, a warning, a figure that moved the right
   *  way. Each clears 4.5:1 on the page, on a card and on its own tint. */
  alert: "#C4302B",
  warn: "#8A5A00",
  success: "#187E56",
  alertTint: "#FDEDEC",
  warnTint: "#FFF4E2",
  successTint: "#E4F7EE",

  /** INTEGRATION MARKS. Each store keeps its own wash so a connected shop is recognisable at
   *  a glance and never borrows the action colour. Repaired from the kit: Etsy was #C2551D
   *  (4.06:1 on its wash) and Shopify #1A8A5F (3.89:1). */
  etsy: "#B6501B",
  etsyWash: "#FFEFE6",
  shopify: "#187E56",
  shopifyWash: "#E4F7EE",
  tiktok: "#5B3FD1",
  tiktokWash: "#F1EEFF",
} as const

/**
 * THE STAGE RAMP — the bar that shows where work is sitting.
 *
 * FOUR STEPS OF THE ONE HUE, not four greys. The ladder this replaces ran #C6CBD0 → #A2AAB1
 * → #6E7880 → the dark block: three neutrals invented for that chart and nowhere else in the
 * app, which is how a palette grows a second palette. A ramp of one hue also says the right
 * thing — these are stages of a single journey, not four unrelated categories.
 *
 * FILLS ONLY. The label under a bar is `muted` on the page, never type on the bar itself:
 * the first two steps are far too light to carry a word.
 */
export const LADDER_FILL = ["#DDE2FF", "#B3BCFA", "#8390F0", "#505FDF"] as const

/**
 * THE FACE — Plus Jakarta Sans, and it is the only one.
 *
 * React Native has NO global font default: loading a face does nothing until a style names
 * it, so every piece of type in this app comes through here and a bare `fontWeight` is a
 * bug — it silently renders the OS face, which is the "AI-generated" look this module exists
 * to have prevented. That rule is unchanged and is the one thing worth keeping from every
 * previous version of this file.
 *
 * Inter and Anton are GONE from the phone. The web still uses them; this is the divergence
 * described at the top. Four weights, and a title is a heavier line rather than a second
 * alphabet.
 */
export const F = {
  bold: "PlusJakartaSans_700Bold",
  semi: "PlusJakartaSans_600SemiBold",
  medium: "PlusJakartaSans_500Medium",
  body: "PlusJakartaSans_400Regular",
} as const

/**
 * THE TYPE SCALE.
 *
 * A VALUE IS NOT A CAPTION (CLAUDE.md §4). Anything a person READS, COPIES or TRANSCRIBES —
 * an order number, a tracking number, an account number, a total — is `value` (15) or
 * larger. `small` (13) is a LABEL, read once and then ignored. There is no 11pt step in this
 * app on purpose: 11px is not small, it is illegible, and an identifier never belongs there.
 */
export const TYPE = {
  h1: { fontSize: 32, lineHeight: 36, letterSpacing: -0.6 },
  h2: { fontSize: 22, lineHeight: 26, letterSpacing: -0.3 },
  h3: { fontSize: 18, lineHeight: 22, letterSpacing: -0.2 },
  /** Body copy, and the floor for any value someone has to read. */
  body: { fontSize: 15, lineHeight: 23 },
  value: { fontSize: 15, lineHeight: 20 },
  /** A LABEL. Never an identifier. */
  small: { fontSize: 13, lineHeight: 18 },
  eyebrow: { fontSize: 13, lineHeight: 16 },
  amount: { fontSize: 40, lineHeight: 42, letterSpacing: -1.2 },
} as const

/** FOUR RADII AND NOTHING BETWEEN THEM. A button is a PILL here — that is the phone's
 *  direction, and it deliberately differs from the web, where `Button` is `rounded-lg`. */
export const R = { chip: 16, row: 20, card: 24, pill: 999 } as const

export const S = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, xxl: 40 } as const

/**
 * THE MOTION BUDGET, and it is a budget rather than a menu: the aura drifts, one staggered
 * entrance per screen, a press scales, a moment icon draws itself in once. Nothing else in
 * this app animates. Every one of them is skipped under `useReducedMotion` (lib/motion.ts)
 * by DOING NOTHING, never by doing something slower.
 */
export const MOTION = { fast: 180, base: 320, slow: 600, stagger: 60, pressScale: 0.97 } as const

/**
 * THE FLOATING TAB BAR's metrics, exported because every scrolling screen needs them. The
 * bar is absolutely positioned, so nothing reserves space for it — a list that pads only for
 * the safe-area inset hides its own last row behind the bar, on every tab.
 * `clearance` is what a scroll container adds BELOW the safe-area inset.
 */
export const TAB_BAR = { height: 64, gap: 12, get clearance() { return this.height + this.gap + 16 } } as const

/** A CARD — the bounded white surface content sits on. The hairline is 1.5pt, not 1: at 1pt
 *  on warm paper the card edge disappears and the direction collapses into a flat wash. */
export const CARD = {
  backgroundColor: C.surface,
  borderRadius: R.card,
  borderWidth: 1.5,
  borderColor: C.hairline,
} as const

/** A SECTION WITHIN A SURFACE, and the only way to divide one: a rule and space, with
 *  nothing drawn around anything. */
export const SECTION = {
  borderTopWidth: 1,
  borderTopColor: C.hairline,
  paddingTop: S.lg,
  marginTop: S.lg,
} as const

/** THE ONLY LIFT IN THE APP, and it has exactly two callers: the primary button and the
 *  floating tab bar, which are objects ABOVE the page. Everything else sits ON it and is
 *  drawn by `hairline`. Tinted with the hue rather than black, so it reads as the control
 *  glowing rather than as a generic drop shadow. */
export const LIFT = {
  shadowColor: hue.base,
  shadowOpacity: 0.28,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 6,
} as const

/**
 * THE ONE BIG ACTION at the top of an order.
 *
 * Two components render it — the stage advance ("Start Order", "Approve Order") and Confirm
 * shipment — and they are the same control wearing different words. Typed separately they
 * had already drifted a step apart, so the shape lives here and the callers bring only the
 * word and the fill.
 *
 * A PILL, like every other button in this direction. It was `R.control` (10pt) under
 * Workshop, where a button was a soft rectangle; carrying that over would have left the one
 * biggest control on the screen as the only square thing on it.
 */
export const HERO_BUTTON = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  borderRadius: R.pill,
  paddingVertical: 16,
  paddingHorizontal: 18,
} as const

export const HERO_LABEL = {
  fontSize: 16,
  /* A bare fontWeight here rendered the OS face while everything around it was the brand's —
     the exact failure the note on `F` warns about, and it was missed because the sweep that
     found it covered app/ and components/ but not the theme that feeds them. */
  fontFamily: F.bold,
  letterSpacing: -0.1,
} as const

/** The glyph beside a hero label, when there is one. Sized to sit with 16pt type. */
export const HERO_GLYPH = 18

/**
 * A STATUS IS A WORD, SET IN ONE OF THREE REGISTERS — weight, not colour.
 *
 * KEPT ACROSS THE REDESIGN, and this is the one place the kit was NOT followed. The kit
 * ships a `StatusPill` with six tinted capsules. The web MEASURED that exact vocabulary and
 * retired it (web/lib/status-tone.ts): 16 of 36 hue pairs sat under the 0.150 OKLab
 * separation floor and `packed`↔`info` came to 0.010 — the same colour twice. A hue is also
 * the one channel that survives neither a bad screen nor a colourblind reader, and this app
 * is read across a table on a factory floor. The kit's stage list (artwork/stitching/
 * printing/packing/shipping/delivered) is not this product's pipeline either.
 *
 *   LIVE       something is happening, or someone is expected to act    heavy ink
 *   SETTLED    finished, cancelled or refunded — nothing to do          light, muted
 *   ATTENTION  stuck, and a person is needed                            heavy ink + a rule
 *
 * The rule under ATTENTION is a SHAPE. It survives greyscale, a colourblind reader and a
 * printed pick sheet, none of which a tint does.
 */
export const STATUS_REGISTER = {
  live: { color: C.ink, fontFamily: F.semi },
  settled: { color: C.muted, fontFamily: F.body },
  attention: {
    color: C.ink, fontFamily: F.semi,
    textDecorationLine: "underline" as const,
    textDecorationStyle: "solid" as const,
  },
} as const

export type StatusRegister = keyof typeof STATUS_REGISTER

/**
 * WHICH REGISTER A STAGE TAKES. Mirrors TONE_CLASS in web/lib/factory-status.ts exactly —
 * draft and shipped are both SETTLED because neither is waiting on anybody. A stage this
 * does not know is LIVE: an unrecognised state is one somebody should look at, and
 * defaulting it to "nothing to do" is the failure worth avoiding.
 */
const REGISTER_OF: Record<string, StatusRegister> = {
  "": "settled",          // Draft
  in_review: "live",      // Pending — seller submitted, awaiting the factory
  approved: "live",
  working: "live",
  shipped: "settled",
  on_hold: "attention",
  cancelled: "settled",
  refunded: "settled",
}

export const registerOf = (stage: string): StatusRegister => REGISTER_OF[stage] ?? "live"
/** The style a stage's WORD takes. */
export const toneOf = (stage: string) => STATUS_REGISTER[registerOf(stage)]

/**
 * WHAT A PAYMENT METHOD IS CALLED ON SCREEN.
 *
 * The stored value is the RAIL — `vietqr` — because that is what issues the virtual account,
 * what the poll reconciles against and what the ledger is keyed on. None of that may change:
 * renaming the data would break the match between a payment and the row it settles. But
 * nobody transferring money recognises "VietQR"; they see BIDV in their banking app and on
 * their statement. A display map, never a migration.
 */
const METHOD_LABEL: Record<string, string> = {
  vietqr: "BIDV",
  VietQR: "BIDV",
  VIETQR: "BIDV",
}
export function methodLabel(m?: string | null): string {
  const raw = String(m ?? "").trim()
  if (!raw) return "Transfer"
  return METHOD_LABEL[raw] ?? METHOD_LABEL[raw.toLowerCase()] ?? raw
}
