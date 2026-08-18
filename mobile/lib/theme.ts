/**
 * The house palette, as literals.
 *
 * The web reads these from CSS custom properties in oklch; React Native has neither, so
 * they are converted once, here, and nowhere else. Same values, one place to change them —
 * a colour typed inline in a screen is how two surfaces start disagreeing about what
 * "overdue" looks like.
 */
export const C = {
  bg: "#ffffff",
  fg: "#111111",
  muted: "#7a7469",
  border: "#e2ded6",
  card: "#ffffff",
  accent: "#f1eefd",
  /** --primary: the vivid violet. Filled surfaces and active state. */
  primary: "#5b2fe8",
  /** --primary-foreground: the lime that sits ON primary. Not decoration — it is the pair. */
  onPrimary: "#dcf56b",
  /** Reserved status colours. These carry meaning on the floor; nothing else may use them. */
  alert: "#d4183d",
  warn: "#c77700",
  success: "#0f8a5f",
} as const

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const
