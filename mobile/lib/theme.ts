/**
 * THE HOUSE PALETTE, as literals.
 *
 * The web reads these from CSS custom properties in oklch; React Native has neither, so
 * they are converted once, here, and nowhere else. Same values, one place to change them —
 * a colour typed inline in a screen is how two surfaces start disagreeing about what
 * "overdue" looks like.
 *
 * THE LOOK: ink and violet, with lime as the shock. The pair (--primary / its foreground)
 * is the brand's, not invented here — lime on violet is the one combination the web already
 * commits to, and it is what stops this reading as a default template.
 *
 * PAPER, NOT CARDS (changed 2026-08-19). This used to say the warm page existed so white
 * cards would lift off it. They did lift — and that was the problem: two near-identical
 * surfaces, one warm and one not, held apart by a border, which reads as stuck-on rather
 * than seamless. Cards also nest, and the queue ended up with four different left margins in
 * one screen. Sections are divided by a hairline rule (SECTION) on one continuous paper
 * surface now. Depth at arm's length comes from type contrast, which is stronger than a
 * 1px border was.
 */
export const C = {
  /** The page. The marketing SURFACE value from CLAUDE.md §4, so the phone and the public
   *  site stand on the same ground rather than two different warms. */
  bg: "#FAF8F3",
  fg: "#0B0B0C",
  muted: "#78736B",
  border: "#EAE5DB",
  /** Still real, but only for surfaces that ARE surfaces: the login panel, the tab bar,
   *  an image well. Never a content card — see the note above. */
  card: "#ffffff",
  accent: "#EEF1FF",
  /** A WELL IN THE PAPER, not a card on it — a slightly deeper tone of the same paper reads
   *  as recessed and needs no line around it. */
  accentPaper: "#F1EEE7",
  /**
   * PERIWINKLE IS A FILL AND CAN NEVER BE TYPE.
   *
   * §4 measures it: #A5B7FF is 1.83:1 on paper — a ghost. So the accent is split by JOB,
   * exactly as the web splits --brand from --primary:
   *   brand   #A5B7FF  large fills only, and whatever sits on it must be INK (10.13:1)
   *   primary #4259D6  the deep step — the only one that may carry WORDS (5.45:1)
   * Getting this backwards is the single easiest way to ship an unreadable screen, and it
   * is why the app palette's vivid violet is not simply re-tinted here.
   */
  primary: "#4259D6",
  onPrimary: "#FAF8F3",
  brand: "#A5B7FF",
  onBrand: "#0B0B0C",
  /** The near-black of the hero blocks and the primary action. Ink and paper carry this app
   *  now; the accent is the one note on top, not the thing doing the work. */
  ink: "#0B0B0C",
  onInk: "#FAF8F3",
  /**
   * RETIRED as a brand colour (2026-08-19). Acid lime on violet is a FLOOR-TOOL pair — built
   * to be read across a warehouse — and it fought Playfair on every screen. It survives only
   * as the highlight on the dark action bar, where lime on near-black is a classic
   * editorial pairing rather than a clash. Never on paper.
   */
  lime: "#DCF56B",
  /** Reserved status colours. These carry meaning on the floor; nothing else may use them. */
  alert: "#C0303F",
  warn: "#B87503",
  success: "#0F7A55",
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
  borderTopColor: "#EAE5DB",
  paddingTop: 20,
  marginTop: 20,
} as const


/**
 * STAGE COLOUR — the reserved vocabulary from CLAUDE.md §4, and only it.
 *
 * emerald shipped · amber hold · violet working · indigo in review · sky approved ·
 * slate untouched · red cancelled. A brand hue must never crowd these: on the floor the
 * colour IS the reading, and someone glancing at a phone across a table is reading the
 * dot, not the word.
 */
export const STAGE_TONE: Record<string, { fg: string; bg: string }> = {
  "":          { fg: "#64748b", bg: "#f1f5f9" },
  in_review:   { fg: "#4f46e5", bg: "#eef2ff" },
  approved:    { fg: "#0284c7", bg: "#e0f2fe" },
  working:     { fg: "#5b2fe8", bg: "#F1EEFD" },
  shipped:     { fg: "#0f8a5f", bg: "#e7f6ef" },
  on_hold:     { fg: "#c77700", bg: "#fdf3e3" },
  cancelled:   { fg: "#d4183d", bg: "#fdeaee" },
  refunded:    { fg: "#d4183d", bg: "#fdeaee" },
}

/**
 * THE SAME STAGES, ON THE INK BLOCK.
 *
 * STAGE_TONE above is a pale tint carrying saturated text, which is right on a WHITE card
 * and wrong on the near-black header: there the tint is a near-white blob, the hue drains
 * out of it, and violet-on-lavender in particular reads as a mistake rather than a status.
 *
 * So on ink the stage hue becomes the FILL — the colour is the reading, and it should be
 * the loud part — and the text is whichever of ink or paper measures higher against it.
 * MEASURED, not eyeballed (CLAUDE.md §4): cream wins on the dark hues, ink wins on sky,
 * emerald and amber, and picking by eye would have put cream on all seven.
 *
 *   New 4.33 · Pending 5.72 · Working 6.33 · Cancelled 4.78   (cream)
 *   Approved 4.59 · Shipped 4.31 · On hold 5.43               (ink)
 */
export const STAGE_TONE_INK: Record<string, { fg: string; bg: string }> = {
  "":          { fg: "#F6F4EF", bg: "#64748b" },
  in_review:   { fg: "#F6F4EF", bg: "#4f46e5" },
  approved:    { fg: "#141019", bg: "#0284c7" },
  working:     { fg: "#F6F4EF", bg: "#5b2fe8" },
  shipped:     { fg: "#141019", bg: "#0f8a5f" },
  on_hold:     { fg: "#141019", bg: "#c77700" },
  cancelled:   { fg: "#F6F4EF", bg: "#d4183d" },
  refunded:    { fg: "#F6F4EF", bg: "#d4183d" },
}

export const toneOf = (stage: string) => STAGE_TONE[stage] ?? STAGE_TONE[""]
/** The pill on a dark block. See STAGE_TONE_INK. */
export const toneOnInk = (stage: string) => STAGE_TONE_INK[stage] ?? STAGE_TONE_INK[""]

/** Card lift. iOS takes the shadow, Android takes elevation; passing both is how one
 *  style object covers the pair without a Platform.select at every call site. */
export const LIFT = {
  shadowColor: "#2b2338",
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
  borderRadius: R.lg,
  paddingVertical: 22,
  paddingHorizontal: 20,
} as const

export const HERO_LABEL = {
  fontSize: 23,
  // A bare fontWeight here rendered the OS face while everything around it was Inter — the
  // exact failure the note on F warns about, missed because the sweep covered app/ and
  // components/ but not the theme that feeds them.
  fontFamily: F.semi,
  letterSpacing: -0.4,
} as const

/** The glyph beside a hero label, when there is one. Sized to sit with 24pt type. */
export const HERO_GLYPH = 24
