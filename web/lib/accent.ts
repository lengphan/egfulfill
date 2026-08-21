/**
 * THE ACCENT — the one colour in an otherwise chroma-0 grey system.
 *
 * It carries exactly one meaning: "this is new, and it is for you". The unread badge, the
 * unread dot, the unread row. Nothing else takes it, because an accent used for two things
 * is not an accent — it is a second UI colour, and the app already learned what happens when
 * every label is a capsule.
 *
 * THE COLOURS ARE NOT HERE. globals.css declares them under [data-pop="…"], the server
 * stores a key, and this module only moves the key onto <html>. That means the settings
 * panel previews each preset from the SAME declaration the app runs on and cannot show one
 * colour then apply another — and adding a preset is a measured change to CSS plus the
 * server's allow-list, never a hex typed into a field.
 *
 * Gate: `node tools/check-pop-presets.mjs`.
 */
export type AccentKey = "rose" | "lime"

export const ACCENTS: { key: AccentKey; label: string; what: string }[] = [
  { key: "rose", label: "Rose", what: "Warm pink. The default." },
  { key: "lime", label: "Lime", what: "Bright yellow-green." },
]

const STORE_KEY = "eg_accent"
const isAccent = (v: unknown): v is AccentKey => ACCENTS.some((a) => a.key === v)

/** Paint it. Safe to call before hydration and safe to call twice. */
export function applyAccent(key: AccentKey) {
  if (typeof document === "undefined") return
  document.documentElement.dataset.pop = key
}

/**
 * The last known accent, painted IMMEDIATELY from local storage.
 *
 * Without this the app renders in the default until the branding fetch lands, so an admin
 * who chose lime watches it flash rose on every page load — the same class of defect as a
 * theme that flips after hydration. The stored value is a cache of a server answer, never
 * the source of truth: `syncAccent` overwrites it as soon as the real one arrives.
 */
export function applyStoredAccent() {
  if (typeof window === "undefined") return
  try {
    const v = window.localStorage.getItem(STORE_KEY)
    if (isAccent(v)) applyAccent(v)
  } catch { /* a blocked store just means one frame of the default */ }
}

/** Record and paint what the server said. */
export function rememberAccent(key: string | undefined | null) {
  if (!isAccent(key)) return
  applyAccent(key)
  try { window.localStorage.setItem(STORE_KEY, key) } catch { /* painting still worked */ }
}
