/**
 * ── THE HERO CANDIDATES ──────────────────────────────────────────────────────────────
 *
 * A PLAIN module, and that is the whole point of it existing.
 *
 * This map lived in home-press.tsx, which carries `"use client"`. Importing it into the
 * server component that reads `?hero=` looked fine, typechecked, and silently did the wrong
 * thing: across the client boundary the import is a client REFERENCE, not the object, so
 * `"2" in HEROES` was false and every request fell through to the default. The param was
 * arriving correctly the whole time — `hero="2"` with `key="3"` is what the debug marker
 * printed — and nothing errored.
 *
 * Anything a server component needs to READ has to come from a module without the directive.
 */
export const HEROES = {
  "1": { src: "/brand/hero-cand-1.jpg", label: "Thread rows",
         alt: "A long row of thread cones receding into darkness on an embroidery floor" },
  "2": { src: "/brand/hero-cand-2.jpg", label: "Production hall",
         alt: "A wide production hall at night with a shaft of daylight cutting through dust" },
  "3": { src: "/brand/hero-cand-3.jpg", label: "Garment in air",
         alt: "A heavyweight cotton garment caught mid-air, lit from the side with a violet rim" },
  "4": { src: "/brand/hero-cand-4.jpg", label: "Model, cropped",
         alt: "A model in a plain heavyweight tee, cropped close from shoulder to waist" },
  "5": { src: "/brand/hero-cand-5.jpg", label: "Models, moving",
         alt: "Three models in plain oversized garments walking through a dark studio, cloth blurred with motion" },
  "6": { src: "/brand/hero-cand-6.jpg", label: "Pulling it on",
         alt: "A figure pulling a heavyweight fleece hoodie over their head, arms raised" },
} as const

export type HeroKey = keyof typeof HEROES
export const DEFAULT_HERO: HeroKey = "5"
