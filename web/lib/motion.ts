/**
 * motion.ts — the marketing site's motion vocabulary, in one place and editable without a deploy.
 *
 * NO "use client" AND NO REACT HERE, on purpose. site-content.ts imports this to merge the
 * stored blob, and site-content.ts is read by the marketing layout, which is a Server
 * Component — a `createContext` call anywhere in this module's graph would throw there. The
 * context and the hook live in components/marketing/motion-provider.tsx instead; this file is
 * the pure half, which also means the merge and the clamps can be asserted directly in node.
 *
 * WHAT WAS WRONG. `[0.16, 1, 0.3, 1]` was typed out in eighteen places and `Rise` was a single
 * hardcoded 22px fade-up, so every section of every page arrived identically: same distance,
 * same direction, same 0.55s. That is what reads as templated — not the curve, the SAMENESS.
 * Five of the six marketing pages had no motion of their own at all.
 *
 * TWO SEPARATE PROBLEMS, TWO LAYERS, DELIBERATELY.
 *
 *   1. WHICH preset a section uses is structural. A card grid should bloom and a step list
 *      should drift in from the side, and that is a decision about the page, so it lives in
 *      the page's code as `<Rise preset="bloom">`.
 *   2. WHAT each preset FEELS like is taste, and taste gets revised at 11pm without wanting a
 *      deploy. So the numbers live in the same `settings` blob the homepage copy already uses
 *      (Settings › Site content › Motion), with the values below as defaults.
 *
 * Putting (2) in the database and (1) in code is the whole design. The reverse — an admin
 * picking which animation each section uses — is a page builder, and a page builder is how a
 * consistent site stops being consistent.
 *
 * DEFAULTS ARE COMPLETE AND ARE THE FALLBACK. Same contract as site-content.ts: a missing key,
 * a cleared field, a malformed number or an unreachable API renders the values here. A
 * marketing page must never be able to lose its animation because a settings row is bad.
 */
/** The five arrivals. Named for what they LOOK like, because that is what gets chosen. */
export const PRESET_NAMES = ["rise", "settle", "drift", "bloom", "cut"] as const
export type PresetName = (typeof PRESET_NAMES)[number]

export type MotionPreset = {
  /** Horizontal travel in px. Negative comes from the left. */
  x: number
  /** Vertical travel in px. Positive rises from below. */
  y: number
  /** Start scale. 1 = no zoom. Kept near 1 — anything under ~0.9 reads as a popup. */
  scale: number
  /** Seconds. */
  duration: number
  /** Seconds before the element starts. */
  delay: number
  /** Seconds added per sibling — what makes a grid arrive as a sequence, not a slab. */
  stagger: number
  /** cubic-bezier control points. */
  ease: [number, number, number, number]
}

/**
 * THE HOUSE CURVE. A hard ease-out: almost all the distance is covered in the first third,
 * then it settles. That is what makes an entrance feel like an object arriving rather than a
 * value being interpolated, and it is the one thing worth keeping constant across presets —
 * a site whose easings disagree reads as several sites.
 */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]
/** Slower to leave the start, for the two presets that travel far enough to need weight. */
export const EASE_SOFT: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

export const DEFAULT_MOTION: Record<PresetName, MotionPreset> = {
  /** The workhorse. What everything used to do, kept as the baseline so nothing regresses. */
  rise: { x: 0, y: 22, scale: 1, duration: 0.55, delay: 0, stagger: 0.06, ease: EASE_OUT },
  /** Bigger and slower, for a section heading or a single wide panel that owns its screen. */
  settle: { x: 0, y: 44, scale: 1, duration: 0.85, delay: 0, stagger: 0.08, ease: EASE_SOFT },
  /** Sideways. For step lists and alternating rows, where vertical travel fights the reading
   *  direction and every item looks like the one above it. */
  drift: { x: -32, y: 0, scale: 1, duration: 0.7, delay: 0, stagger: 0.07, ease: EASE_OUT },
  /** Scale, no travel. For card grids: twelve cards sliding up is a wave, twelve cards
   *  blooming in place is a grid appearing. */
  bloom: { x: 0, y: 0, scale: 0.965, duration: 0.6, delay: 0, stagger: 0.045, ease: EASE_OUT },
  /** Nearly instant, nearly still. For dense text and tables, where a 40px slide on a
   *  paragraph is just the page moving while someone tries to read it. */
  cut: { x: 0, y: 8, scale: 1, duration: 0.32, delay: 0, stagger: 0.025, ease: EASE_OUT },
}

export type MotionSettings = Record<PresetName, MotionPreset>

/**
 * Bounds, because these numbers get typed by hand into a settings field.
 *
 * Not defensive noise: a duration of 40 is a section that never appears, a stagger of 2 is a
 * grid that takes a minute to finish, and both look exactly like "the animation is broken".
 * The editor clamps to the same numbers, so the slider and the stored value cannot disagree.
 */
export const LIMITS = {
  x: { min: -200, max: 200, step: 1 },
  y: { min: -200, max: 200, step: 1 },
  scale: { min: 0.5, max: 1.5, step: 0.005 },
  duration: { min: 0, max: 3, step: 0.01 },
  delay: { min: 0, max: 2, step: 0.01 },
  stagger: { min: 0, max: 0.5, step: 0.005 },
} as const

export const clampField = (k: keyof typeof LIMITS, v: number) => {
  const { min, max } = LIMITS[k]
  return Math.min(max, Math.max(min, v))
}

/** Overlay a stored (possibly partial, possibly junk) blob onto the defaults. */
export function mergeMotion(stored: unknown): MotionSettings {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>
  const out = {} as MotionSettings

  for (const name of PRESET_NAMES) {
    const d = DEFAULT_MOTION[name]
    const raw = (s[name] && typeof s[name] === "object" ? s[name] : {}) as Record<string, unknown>
    // Number.isFinite, not `|| d.x`: 0 is a legitimate value for every field here — a preset
    // with no travel is `bloom`, and `|| ` would silently replace it with the default.
    const num = (v: unknown, fallback: number, k: keyof typeof LIMITS) =>
      typeof v === "number" && Number.isFinite(v) ? clampField(k, v) : fallback
    const ease =
      Array.isArray(raw.ease) && raw.ease.length === 4 && raw.ease.every((n) => typeof n === "number" && Number.isFinite(n))
        ? ([...(raw.ease as number[])] as [number, number, number, number])
        : d.ease
    out[name] = {
      x: num(raw.x, d.x, "x"),
      y: num(raw.y, d.y, "y"),
      scale: num(raw.scale, d.scale, "scale"),
      duration: num(raw.duration, d.duration, "duration"),
      delay: num(raw.delay, d.delay, "delay"),
      stagger: num(raw.stagger, d.stagger, "stagger"),
      ease,
    }
  }
  return out
}

/**
 * The framer-motion props for one arrival — ONE definition, so the preview in Settings and the
 * live page cannot drift apart.
 *
 * That is the property that makes the editor trustworthy: the panel is not a mock-up of the
 * animation, it calls this same function with the same preset and gets the same object the
 * page gets. `reduce` collapses everything to a short fade, because a reader who asked for
 * less motion did not ask for a shorter slide.
 */
export function entrance(p: MotionPreset, { index = 0, delay = 0, reduce = false } = {}) {
  const at = p.delay + delay + index * p.stagger
  if (reduce) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.3, delay: at },
    }
  }
  return {
    initial: { opacity: 0, x: p.x, y: p.y, scale: p.scale },
    animate: { opacity: 1, x: 0, y: 0, scale: 1 },
    transition: { duration: p.duration, delay: at, ease: p.ease },
  }
}
