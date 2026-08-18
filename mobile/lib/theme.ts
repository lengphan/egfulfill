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
 * commits to, and it is what stops this reading as a default template. Paper is warm and
 * off-white so white CARDS lift off it; a floor tool that is white-on-white has no depth at
 * arm's length under warehouse lighting.
 */
export const C = {
  /** The page. Warm, so the white cards on top of it read as objects. */
  bg: "#F6F4EF",
  fg: "#141019",
  muted: "#7a7469",
  border: "#E6E1D8",
  card: "#ffffff",
  accent: "#F1EEFD",
  /** --primary: the vivid violet. Filled surfaces and active state. */
  primary: "#5b2fe8",
  /** --primary-foreground: the lime that sits ON primary. Not decoration — it is the pair. */
  onPrimary: "#dcf56b",
  /** The near-black used for hero blocks. Violet-tinted, never a pure grey — pure grey next
   *  to a saturated violet reads as a rendering fault rather than a choice. */
  ink: "#141019",
  onInk: "#F6F4EF",
  lime: "#dcf56b",
  /** Reserved status colours. These carry meaning on the floor; nothing else may use them. */
  alert: "#d4183d",
  warn: "#c77700",
  success: "#0f8a5f",
} as const

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const

/** One radius scale. Phones read big radii as "current"; 4px corners read as 2014. */
export const R = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const

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

export const toneOf = (stage: string) => STAGE_TONE[stage] ?? STAGE_TONE[""]

/** Card lift. iOS takes the shadow, Android takes elevation; passing both is how one
 *  style object covers the pair without a Platform.select at every call site. */
export const LIFT = {
  shadowColor: "#2b2338",
  shadowOpacity: 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const
