/**
 * THE HOUSE PALETTE, as literals.
 *
 * The web reads these from CSS custom properties in oklch; React Native has neither, so
 * they are converted once, here, and nowhere else. Same values, one place to change them —
 * a colour typed inline in a screen is how two surfaces start disagreeing about what
 * "overdue" looks like.
 *
 * THE LOOK: INK AND ONE SIGNAL (2026-08-21). This used to say "ink and violet, with lime as
 * the shock", and that pair is gone on both front-ends. The chrome now carries NO HUE —
 * every neutral below is a true grey — which is the whole mechanism that lets a single
 * accent read as a DECISION rather than as one colour among several. The previous palette
 * pulled three ways at once: warm paper and a warm border at hue ~91, a cool periwinkle
 * accent, and an acid lime on top of both.
 *
 * The signal is CORAL. One token, `pop`. It is ALWAYS a fill carrying dark text — ink on it
 * measures 8.74:1, white on it 2.18:1 — so it is never a text colour and never a hairline.
 * Its shape is only 2.10:1 against the page, which means it cannot be a borderless button
 * on paper; it earns its keep on the dark blocks and as a small badge, where the fill has
 * real separation and the ink label carries the reading.
 *
 * PAPER, NOT CARDS (2026-08-19, unchanged). Sections are divided by a hairline rule
 * (SECTION) on one continuous surface — never a white card floating on the page. That rule
 * is STRUCTURAL and survives the palette change intact. What changed is only the hue: the
 * paper reads as paper now because nothing is drawn around anything, not because it is
 * tinted beige.
 *
 * Every value below is converted from the web's `web/app/globals.css` light block. Contrast
 * figures in these comments are MEASURED (CLAUDE.md §4), not estimated.
 */
export const C = {
  /** The page. A true near-white — the warm #FCFBF8 it replaced disagreed with a chroma-0
   *  accent system and, next to the coral, read as a slightly dirty white rather than as
   *  paper. Depth comes from the hairline rules, not from a tint. */
  bg: "#FBFBFB",
  fg: "#0A0A0A",
  /** Secondary type. 4.79:1 on the page — clears the 4.5:1 body floor, which the old
   *  #78736B did not everywhere it was used. */
  muted: "#707070",
  border: "#DFDFDF",
  /** Still real, but only for surfaces that ARE surfaces: the login panel, the tab bar,
   *  an image well. Never a content card — see the note above. */
  card: "#FFFFFF",
  /** A flat neutral fill: a chip ground, a pressed row, an inactive segment. */
  accent: "#F2F2F2",
  /** A WELL IN THE PAPER, not a card on it — a slightly deeper tone of the same paper reads
   *  as recessed and needs no line around it. */
  accentPaper: "#F1F1F1",
  /**
   * THE ACTION. Near-black, and it does BOTH of --primary's jobs on the web: it fills the
   * buttons and it inks the type. One value, 18.39:1 as text on the page and 19.03:1 with
   * white on it as a fill — so unlike the periwinkle pair it replaced, it cannot be used
   * the wrong way round. `brand` is deliberately the SAME value: the web collapsed the two
   * when the chrome went monotone, and keeping them apart here would re-introduce the split
   * this change exists to remove.
   */
  primary: "#101010",
  onPrimary: "#FFFFFF",
  brand: "#101010",
  onBrand: "#FFFFFF",
  /** The near-black of the hero blocks. Same family as `primary`; named separately because
   *  it is a SURFACE, and a screen reads better when it says which it meant. */
  ink: "#101010",
  onInk: "#FBFBFB",
  /**
   * CORAL — the one signal. #FF927A.
   *
   * ONE LINE TO CHANGE: every use reads this token, so swapping the pop is a single edit.
   * Roughly twice the chroma of the pale tints tried first, which is the whole difference
   * between a tint and a colour. Warm against an entirely neutral system, which is what
   * makes it read as a decision.
   *
   * ALWAYS A FILL, ALWAYS WITH `onPop` ON IT. Never type, never a border, never a hairline.
   */
  pop: "#FF927A",
  onPop: "#101010",
  /** Reserved status colours. These carry meaning on the floor; nothing else may use them.
   *  Converted from the web's --status-* / --success tokens, all AA on the page. */
  alert: "#B02A2D",
  warn: "#8F5D00",
  success: "#006B3D",
  /** The pale grounds that go under the three above. Derived from the same hues so a chip
   *  and its text are one family; each carries its own ink at 4.9:1 or better. */
  alertTint: "#FFE8E5",
  warnTint: "#FCEEDB",
  successTint: "#E0F7E8",
} as const

/**
 * THE FACES — the same pair the web carries, so one product has one letterform.
 *
 * React Native has NO global font default: loading a face does nothing until a style names
 * it. So every piece of type in this app must come through here, and a bare `fontWeight`
 * is now a bug — it silently renders the OS default, which is the look this replaced.
 *
 * Playfair is the DISPLAY face and it earns its place only at size: a high-contrast serif
 * set at 13px is mud. Order numbers, screen titles, the one big figure on a card. Inter
 * does everything else, and does most of it at 400 — the old app had 25 declarations at
 * weight 900 and exactly one at 400, which is why nothing on a screen ever looked more
 * important than anything else.
 */
export const F = {
  display: "PlayfairDisplay_700Bold",
  displaySemi: "PlayfairDisplay_600SemiBold",
  displayMed: "PlayfairDisplay_500Medium",
  /** Body. The default for anything a person reads a sentence of. */
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  semi: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const

/**
 * THE FLOATING TAB BAR's own metrics, exported because every scrolling screen has to know
 * them. The bar is position:absolute, so nothing reserves space for it — a list that pads
 * only for the safe-area inset hides its own last row behind it, on every tab.
 * `clearance` is what a scroll container must add BELOW the safe-area inset.
 */
export const TAB_BAR = { height: 60, gap: 10, get clearance() { return this.height + this.gap + 14 } } as const

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const

/** One radius scale. Phones read big radii as "current"; 4px corners read as 2014. */
export const R = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const
/**
 * A SECTION ON THE PAGE, and the only way to divide one.
 *
 * The detail screen stacked six white cards on warm paper, each with its own border, its own
 * shadow and its own padding — six boxes, six inner margins, nothing sharing an edge. That
 * reads as tiles, and on a warm ground the white also reads as stuck on.
 *
 * A rule and space do the same job with nothing drawn around anything, and every section
 * that uses this shares one left margin with the screen title. Import it; a card typed
 * inline in a screen is how the six got there.
 */
export const SECTION = {
  borderTopWidth: 1,
  borderTopColor: C.border,
  paddingTop: 20,
  marginTop: 20,
} as const


/**
 * STAGE COLOUR — the reserved vocabulary from CLAUDE.md §4, and only it.
 *
 * emerald shipped · amber hold · violet working · indigo in review · sky approved ·
 * slate untouched · red cancelled. A brand hue must never crowd these: on the floor the
 * colour IS the reading, and someone glancing at a phone across a table is reading the
 * dot, not the word. The coral is not in this table and must never enter it.
 *
 * Rebuilt 2026-08-21 from the web's --status-* tokens rather than from hand-picked Tailwind
 * shades. The eight now sit at ONE lightness and chroma per family, so they read as a set;
 * the tints are the same hue at L 0.955, so a chip and its text belong together. Every pair
 * measures 4.84:1 or better, which the shades they replaced did not.
 */
export const STAGE_TONE: Record<string, { fg: string; bg: string }> = {
  "":          { fg: "#65696F", bg: "#EFF0F2" },  // 4.84:1
  in_review:   { fg: "#475FA5", bg: "#E7F0FF" },  // 5.31:1
  approved:    { fg: "#006A9E", bg: "#DFF3FF" },  // 5.18:1
  working:     { fg: "#5E58A1", bg: "#EDEEFF" },  // 5.40:1
  shipped:     { fg: "#006B3D", bg: "#E0F7E8" },  // 5.88:1
  on_hold:     { fg: "#8F5D00", bg: "#FCEEDB" },  // 4.93:1
  cancelled:   { fg: "#B02A2D", bg: "#FFE8E5" },  // 5.58:1
  refunded:    { fg: "#B02A2D", bg: "#FFE8E5" },  // 5.58:1
}

/**
 * THE SAME STAGES, ON THE INK BLOCK.
 *
 * STAGE_TONE above is a pale tint carrying saturated text, which is right on paper and wrong
 * on the near-black header: there the tint is a near-white blob, the hue drains out of it,
 * and violet-on-lavender in particular reads as a mistake rather than a status.
 *
 * So on ink the stage hue becomes the FILL and the label is ink.
 *
 * THESE ARE THE WEB'S DARK-MODE STATUS STEPS, not the light ones (2026-08-21). Deriving them
 * from the light tokens was tried first and FAILED measurement: at L 0.46-0.52 the shipped,
 * cancelled and refunded fills came to 2.87-2.91:1 against the block behind them. The label
 * on them was legible, but a chip whose own EDGE is under 3:1 has no shape — it reads as
 * text floating on the header rather than as a pill. The ink block is a dark surface, so it
 * takes the dark surface's steps; that is what the web already does, and mirroring it is
 * cheaper than maintaining a third ladder.
 *
 * Because the fill is light and the label is ink, ONE measurement covers both jobs here:
 * the label's contrast against the fill and the fill's separation from the block are the
 * same number. All eight land between 6.66:1 and 9.41:1.
 *
 * CONSTRAINT: `cancelled` sits 0.077 from `pop` in OKLab — close enough to be confused. They
 * are safe today only because they never share a screen (toneOnInk is the order-detail
 * header; C.pop is the orders-list batch bar). Do not put a coral control on the ink header.
 */
export const STAGE_TONE_INK: Record<string, { fg: string; bg: string }> = {
  "":          { fg: "#101010", bg: "#A6ABB1" },  // 8.23:1
  in_review:   { fg: "#101010", bg: "#8CA8F4" },  // 8.18:1
  approved:    { fg: "#101010", bg: "#5AAEE5" },  // 7.81:1
  working:     { fg: "#101010", bg: "#A3A0F1" },  // 8.02:1
  shipped:     { fg: "#101010", bg: "#5ACB90" },  // 9.41:1
  on_hold:     { fg: "#101010", bg: "#DFA54D" },  // 8.72:1
  cancelled:   { fg: "#101010", bg: "#F2716A" },  // 6.66:1
  refunded:    { fg: "#101010", bg: "#F2716A" },  // 6.66:1
}

export const toneOf = (stage: string) => STAGE_TONE[stage] ?? STAGE_TONE[""]
/** The pill on a dark block. See STAGE_TONE_INK. */
export const toneOnInk = (stage: string) => STAGE_TONE_INK[stage] ?? STAGE_TONE_INK[""]

/** Card lift. iOS takes the shadow, Android takes elevation; passing both is how one
 *  style object covers the pair without a Platform.select at every call site.
 *  The shadow is NEUTRAL — it used to be #2b2338, a violet, which tinted every edge in the
 *  app with the hue the palette just removed. */
export const LIFT = {
  shadowColor: "#0A0A0A",
  shadowOpacity: 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const


/**
 * THE ONE BIG ACTION at the top of an order.
 *
 * Two components render it — the stage advance ("Start Order", "Approve Order") and
 * Confirm shipment — and they are the same control wearing different words and a different
 * fill. Typed separately they had already drifted a step apart: 22pt padding against 18,
 * 24pt type against 22, which on two buttons that sit within a screen of each other reads
 * as one of them being slightly wrong rather than as two sizes.
 *
 * So the shape is here and the callers bring only the colour and the word.
 */
export const HERO_BUTTON = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  borderRadius: 12,
  paddingVertical: 15,
  paddingHorizontal: 18,
} as const

export const HERO_LABEL = {
  fontSize: 16,
  // A bare fontWeight here rendered the OS face while everything around it was Inter — the
  // exact failure the note on F warns about, missed because the sweep covered app/ and
  // components/ but not the theme that feeds them.
  fontFamily: F.semi,
  letterSpacing: -0.1,
} as const

/** The glyph beside a hero label, when there is one. Sized to sit with 16pt type. */
export const HERO_GLYPH = 18

/**
 * WHAT A PAYMENT METHOD IS CALLED ON SCREEN.
 *
 * The stored value is the RAIL — `vietqr` — because that is what issues the virtual account,
 * what the poll reconciles against, and what the ledger is keyed on. None of that may change:
 * renaming the data would break the match between a payment and the row it settles.
 *
 * But nobody transferring money recognises "VietQR". They see BIDV on their banking app and
 * on their statement, so BIDV is what the screen says. A display map, never a migration.
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
