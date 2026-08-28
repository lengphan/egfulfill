/**
 * THE HOUSE PALETTE, as literals.
 *
 * The web reads these from CSS custom properties in oklch; React Native has neither, so they
 * are converted once, here, and nowhere else. `tools/check-theme.mjs` re-reads
 * web/app/globals.css and fails if any value below has drifted from the token it claims to
 * mirror — a converted literal with no gate under it is a copy waiting to disagree, which is
 * exactly what happened to the palette this replaces.
 *
 * THE LOOK: WORKSHOP (2026-08-28). This file previously said "ink and one signal" and
 * described a chroma-0 grey system on #FBFBFB with a rose accent. That palette is a
 * generation old: the web moved to Workshop and this did not follow, so the two halves of
 * one product had different pages, different rules and different status colours.
 *
 * What Workshop is, in four facts:
 *
 *   1. THE PAGE IS TINTED and the CARD IS WHITE. This reverses the "paper, not cards" rule
 *      that stood here from 2026-08-19, and the reversal is legitimate rather than a relapse.
 *      That rule was written about WHITE ON WARM PAPER — two near-identical surfaces held
 *      apart by a border, which reads as stuck on. The page is #F3F4F5 now, a cool near-white,
 *      and a white card on it is the depth model the whole direction runs on.
 *   2. NO SHADOW AT ANY LEVEL. Elevation is a change of background value, never a blur.
 *      `LIFT` is GONE — do not reintroduce it. If a surface is not separating, the answer is
 *      a firmer BORDER, never a shadow. (See the tab bar, which was the hard case.)
 *   3. THREE RADII AND NOTHING BETWEEN THEM. See `R`.
 *   4. ONE DARK BLOCK, ONE LIT THING ON IT. The slate `ink` block carries the periwinkle
 *      `lit`, and that pair is the app's whole identity. It is the web's sidebar, converted.
 *
 * Contrast figures in these comments are MEASURED (CLAUDE.md §4), not estimated, and
 * check-theme.mjs re-measures every one of them.
 */
export const C = {
  /** The page — the web's `--background`. Depth comes from the card sitting ON this, so it
   *  cannot go back to white: a white card on a white page is not a surface, it is a border. */
  bg: "#F3F4F5",
  /** `--foreground`. 17.01:1 on the page, 18.73:1 on a card. */
  fg: "#121212",
  /** Secondary type — `--muted-foreground`. 5.49:1 on the page, 6.05:1 on a card, 5.10:1 on
   *  `accent`. It was #707070, which cleared the body floor on the page and only just. */
  muted: "#546570",

  /**
   * TWO EDGE TOKENS, AND THEY ARE NOT INTERCHANGEABLE. This split is the single biggest
   * defect this file shipped and the reason it is first in the list.
   *
   * `border` is a SURFACE rule — what separates a card from the page, or one row from the
   * next. It is allowed to be faint: 1.23:1 on the page, 1.36:1 on a card. That is a line,
   * and a line does not need contrast to do its job because it is not a target.
   *
   * `edge` is a CONTROL boundary — a text field, an outlined button, the tab bar. WCAG
   * 1.4.11 puts a 3:1 FLOOR under it, because a button you cannot find is not a button.
   * This token did not exist here. Every field and outlined control in the app was drawn
   * with `border`, which measured 1.33:1 on white and 1.29:1 on the page — the login form,
   * "Open the full app" and "Sign out" all had boundaries that were, measurably, not there.
   * `edge` is the web's `--input`, the token it introduced for exactly this: 3.13:1 on the
   * page, 3.44:1 on a card.
   */
  border: "#D9DEE2",
  edge: "#7F8C97",

  /** A CONTENT CARD — see fact 1 above. White, bounded by `border`, and NEVER shadowed.
   *  It separates from the page at 1.10:1, which is deliberately small: the border is what
   *  draws the card and the value change is what makes it read as lifted. */
  card: "#FFFFFF",
  /** A flat neutral fill — the web's `--secondary`/`--muted`/`--accent`, which are one
   *  colour under three names over there. A chip ground, a pressed row, an inactive segment,
   *  an image well. Ink on it is 15.80:1 and `muted` is 5.10:1. */
  accent: "#E9ECEF",

  /** INK AS TYPE. `--primary` — what a heading, a figure and a back-chevron are set in. */
  primary: "#121212",
  onPrimary: "#F3F4F5",
  /**
   * THE ACTION — `--brand`, the violet. The web's `default` button is `bg-brand`, not
   * `bg-primary`, and the two are different values on purpose: one is read as letterforms,
   * the other is pressed. White on it is 7.68:1 and its own shape against the page is 6.98:1.
   *
   * IT WAS #1F1B41, a dark eggplant, and mirroring that was correct-at-the-time and wrong:
   * the web had shipped the eggplant by accident (it was whatever happened to be sitting in
   * the skin block) and then corrected it to the value its "Which Violet" study actually
   * picked. tools/check-theme.mjs is what caught the drift, on the first run after the web
   * moved — which is the entire reason that gate exists.
   *
   * It is LOUD, and that is a consequence rather than a preference. The muted violet this
   * family started from failed BECAUSE it was muted: low chroma at hue 282 sits it beside
   * `pending`, a desaturated blue at hue 255, and two quiet colours 27 degrees apart are two
   * quiet colours. A brand has to be a colour no order state is.
   *
   * NEVER ON THE BLOCK. It is 1.56:1 against slate — it has no shape there at all. `lit` is
   * the block's action colour and this is the page's; they are not interchangeable.
   */
  brand: "#4E01FC",
  onBrand: "#FFFFFF",

  /**
   * THE DARK BLOCK — the web's `--sidebar`, and the app's second surface.
   *
   * SLATE, not the near-black #101010 it replaces. The block is 10.88:1 against the page, so
   * it genuinely is a surface rather than a hole, and — the reason it cannot be black — a
   * pale periwinkle has a real shape on it, which is what `lit` needs.
   */
  ink: "#33373C",
  /** Lettering on the block — `--sidebar-foreground`, 9.04:1. */
  onInk: "#DDE0E3",
  /** A STATE STEP on the block — `--sidebar-accent`. A pressed row, a nested well. 1.34:1
   *  against the block, which is a fill change and not a boundary; it is never a border. */
  inkAccent: "#454A4F",

  /**
   * THE ONE LIT THING — `--sidebar-primary`, periwinkle.
   *
   * ONLY ON THE BLOCK, and this is a property of the colour rather than a taste rule: it is
   * 7.18:1 on slate and 1.67:1 on white. On a light surface it has no shape at all, so it
   * cannot be a button, a chip or a border on the page — there is nowhere on paper it works.
   *
   * On the block it is a FILL carrying ink (11.22:1). One per screen: it answers "where am
   * I", which is the one marker worth spending the app's only chromatic element on. That is
   * what the web's selected nav row does, and mirroring it is the whole point of the token.
   */
  lit: "#C0C4FF",
  onLit: "#121212",

  /**
   * ROSE — `--pop`. Unchanged by this rewrite, because it was already the web's value.
   *
   * It means "this is new, and it is for you": an unread mark, a selection that has just
   * appeared. ALWAYS a fill carrying `onPop` (7.51:1) — never type, never a hairline. Its
   * own shape against the page is 2.30:1, so it cannot be a borderless button on paper.
   *
   * NEVER IN CHROME. It was a disc behind the live tab glyph, which made the one bright
   * thing in the app also the most permanent thing in it. That job belongs to `lit` now, and
   * the two are distinguishable because they never share a surface: `lit` is only ever on
   * the block, `pop` only ever on the page.
   */
  pop: "#F472DC",
  onPop: "#101010",

  /**
   * THE THREE SIGNAL INKS. These are TYPE — an error sentence, a warning, a number that
   * moved the right way — so each clears 4.5:1 on the page, on a card, and on its own tint.
   *
   * `alert` and `success` are the web's `--status-alert` and `--success` unchanged. `warn`
   * is one lightness step BELOW `--status-hold`: that token is 4.18:1 on this page, which is
   * fine for a chip fill and fails as a sentence, and this app sets sentences in it.
   */
  alert: "#D02B31",   // 4.68 page · 5.16 card · 4.72 on tint
  warn: "#8D5F00",    // 5.06 page · 5.57 card · 5.15 on tint
  success: "#00733E", // 5.41 page · 5.96 card · 5.60 on tint
  /** The grounds under the three above, at one lightness on each hue so a chip and its text
   *  are one family. Each is LIGHTER than the page (1.01–1.04:1) — the tints these replace
   *  were darker than it, which is why the ink on them measured under the floor. */
  alertTint: "#FFF2EF",
  warnTint: "#FFF5E1",
  successTint: "#E8FDF0",
} as const

/**
 * THE FACES — one, and it is the same one the web resolves to.
 *
 * React Native has NO global font default: loading a face does nothing until a style names
 * it. So every piece of type in this app must come through here, and a bare `fontWeight` is
 * a bug — it silently renders the OS default, which is the "AI-generated" look this module
 * exists to have replaced.
 *
 * The three display tokens differ only in WEIGHT. A screen title is not a different alphabet
 * from the list under it, it is a heavier one.
 */
export const F = {
  display: "Inter_700Bold",
  displaySemi: "Inter_600SemiBold",
  displayMed: "Inter_500Medium",
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

/**
 * THREE RADII, AND NOTHING BETWEEN THEM.
 *
 * The scale this replaces had five steps, and the app had drifted to FOURTEEN distinct
 * literal `borderRadius` values on top of them — 2, 3, 4, 8, 9, 10, 12, 14, 16, 18, 20, 21,
 * 26, 999. When any value is available, the one a developer reaches for stops being a
 * decision, and a conspicuous single radius IS the shape language here.
 *
 * The web resolves its whole Tailwind scale onto exactly these three, so `rounded-lg` and
 * `rounded-2xl` are the same box over there and the utility you pick cannot matter:
 *
 *   badge    8   the ONE thing squarer than a button — a chip, a status mark, a thumbnail
 *   control 10   anything you press or type into: button, field, segment, tab pill
 *   card    26   anything BOUNDED that holds content: a card, the dark block, a sheet
 *   pill   999   only what is genuinely round: an avatar, a count dot, a circular target
 *
 * There is no fourth value. Soften `card` back toward 14–16 "to be safe" and the direction
 * collapses into every other warm-minimal app.
 */
export const R = { badge: 8, control: 10, card: 26, pill: 999 } as const

/**
 * A CARD — the bounded white surface content sits on.
 *
 * NO SHADOW, and there is no token that provides one any more. `LIFT` was removed with this
 * rewrite: Workshop's depth model is a change of background value plus a border, and a blur
 * under a card is the single fastest way to make the whole system read as generic. If a card
 * is not separating from the page, make the BORDER firmer.
 */
export const CARD = {
  backgroundColor: C.card,
  borderRadius: R.card,
  borderWidth: 1,
  borderColor: C.border,
} as const

/** The same surface in the dark block's colours — the order header, the chat bubble. */
export const CARD_INK = {
  backgroundColor: C.ink,
  borderRadius: R.card,
} as const

/**
 * A SECTION WITHIN A SURFACE, and the only way to divide one.
 *
 * A rule and space, with nothing drawn around anything. This survives the card reversal
 * intact and is still what divides the INSIDE of a card or a run of rows on the page — what
 * changed is only that a card is now a legitimate container to put sections in, where before
 * this was the only structure available at all.
 */
export const SECTION = {
  borderTopWidth: 1,
  borderTopColor: C.border,
  paddingTop: 20,
  marginTop: 20,
} as const

/**
 * A STATUS IS A WORD, SET IN ONE OF THREE REGISTERS — weight, not colour.
 *
 * This replaces STAGE_TONE and STAGE_TONE_INK, two tables of eight tinted capsules each, and
 * it is not a simplification for its own sake. The web MEASURED that vocabulary and retired
 * it (web/lib/status-tone.ts): 16 of the 36 hue pairs sat under the 0.150 OKLab separation
 * floor and `packed`↔`info` came to 0.010 — the same colour twice. The nine shared three
 * lightness steps and four chroma steps, so only hue separated them, which is why a column
 * of them read as one muddy family rather than as nine decisions.
 *
 * Re-stepping the hues was the wrong repair, and it is worth saying why it was tempting: on
 * a factory floor someone glances at a phone across a table and reads the mark, not the word.
 * But that is an argument for a signal that survives a bad screen and a colourblind operator,
 * and a hue is the one channel that survives neither. So:
 *
 *   LIVE       something is happening, or someone is expected to act    heavy ink
 *   SETTLED    finished, cancelled or refunded — nothing to do          light, muted
 *   ATTENTION  stuck, and a person is needed                            heavy ink + a rule
 *
 * The rule under ATTENTION is a SHAPE. It survives greyscale, a colourblind reader and a
 * printed pick sheet, none of which a tint does.
 */
export const STATUS_REGISTER = {
  live: { color: C.fg, fontFamily: F.semi },
  settled: { color: C.muted, fontFamily: F.body },
  attention: {
    color: C.fg, fontFamily: F.semi,
    textDecorationLine: "underline" as const,
    textDecorationStyle: "solid" as const,
  },
} as const

/**
 * THE SAME THREE ON THE DARK BLOCK.
 *
 * `C.muted` is 5.49:1 on the page and 1.7:1 on slate, so the settled register cannot simply
 * be reused there — it would vanish. This is the block's own step: #DDE0E3 at 70% over slate
 * is #AAADB1, 5.32:1, which is a real reading rather than a hint.
 */
export const STATUS_REGISTER_INK = {
  live: { color: C.onInk, fontFamily: F.semi },
  settled: { color: "#AAADB1", fontFamily: F.body },
  attention: {
    color: C.onInk, fontFamily: F.semi,
    textDecorationLine: "underline" as const,
    textDecorationStyle: "solid" as const,
  },
} as const

export type StatusRegister = keyof typeof STATUS_REGISTER

/**
 * WHICH REGISTER A STAGE TAKES.
 *
 * Mirrors TONE_CLASS in web/lib/factory-status.ts exactly — draft and shipped are both
 * SETTLED because neither is waiting on anybody, which is the reading the register describes.
 * A stage this does not know is LIVE: an unrecognised state is one somebody should look at,
 * and defaulting it to "nothing to do" is the failure worth avoiding.
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
/** The style a stage's WORD takes on the page. */
export const toneOf = (stage: string) => STATUS_REGISTER[registerOf(stage)]
/** ...and on the dark block. */
export const toneOnInk = (stage: string) => STATUS_REGISTER_INK[registerOf(stage)]

/**
 * THE ONE BIG ACTION at the top of an order.
 *
 * Two components render it — the stage advance ("Start Order", "Approve Order") and Confirm
 * shipment — and they are the same control wearing different words and a different fill.
 * Typed separately they had already drifted a step apart, so the shape is here and the
 * callers bring only the colour and the word.
 */
export const HERO_BUTTON = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  borderRadius: R.control,
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
