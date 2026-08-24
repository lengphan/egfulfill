/**
 * THE SKIN — the site's palette, chosen at runtime instead of compiled in.
 *
 * The marketing kit's thirteen colours used to be hex literals in `bold-kit.tsx`, imported
 * by thirteen files and written into ~150 inline styles. Good structure — one file owned the
 * palette — but a hex in JSX can only move by editing and deploying, and the ask was to be
 * able to move it on a running site rather than "later on", without a code change going
 * anywhere near live orders.
 *
 * THE COLOURS ARE NOT HERE, exactly as with the accent. globals.css declares them under
 * `[data-skin="…"]`, the server stores a KEY, and this module only moves the key onto
 * <html>. Which means a picker previews each skin from the SAME declaration the site runs
 * on and cannot show one palette then apply another — and adding a skin is a measured change
 * to CSS plus the server's allow-list, never a hex typed into a field.
 *
 * WHAT A SKIN CANNOT TOUCH is the point of it having a fixed shape: not `--primary` (it inks
 * ~247 pieces of text as well as filling buttons), not the floor's status vocabulary, not
 * `--pop`. See the SCOPE note in globals.css.
 *
 * LIMIT, stated rather than implied: this paints on the surfaces that ask for it — the app,
 * the boards and auth, all of which run `useAccent()`. The PUBLIC marketing pages are served
 * to visitors with no session, so they render whichever skin globals.css declares on `:root`
 * — today, `signal`. Changing what the public site defaults to is a one-line CSS change, not
 * a picker, and pretending otherwise would mean a colour flash on every cold marketing load.
 *
 * That limit is why `signal` was declared on `:root` rather than merely added here: it was
 * asked for on the PUBLIC marketing pages, and a selectable-only skin would have repainted
 * the signed-in app and left those pages exactly as they were.
 *
 * Gate: `node tools/check-skins.mjs`.
 */
export type SkinKey = "signal" | "studio" | "press"

export const SKINS: { key: SkinKey; label: string; what: string }[] = [
  { key: "signal", label: "Signal", what: "Cool grey ground, panels on it. Monochrome." },
  { key: "studio", label: "Studio", what: "Ink on white. One bright accent." },
  { key: "press", label: "Press", what: "Violet plate over warm paper." },
]

const STORE_KEY = "eg_skin"
const isSkin = (v: unknown): v is SkinKey => SKINS.some((s) => s.key === v)

/** Paint it. Safe before hydration, safe twice. */
export function applySkin(key: SkinKey) {
  if (typeof document === "undefined") return
  document.documentElement.dataset.skin = key
}

/**
 * The last known skin, painted IMMEDIATELY from local storage.
 *
 * Without this the site renders in the default until the branding fetch lands, so an admin
 * on `press` watches it flash white on every page load — the same defect as a theme that
 * flips after hydration. The stored value is a cache of a server answer, never the truth.
 */
export function applyStoredSkin() {
  if (typeof window === "undefined") return
  try {
    const v = window.localStorage.getItem(STORE_KEY)
    if (isSkin(v)) applySkin(v)
  } catch { /* a blocked store just means one frame of the default */ }
}

/** Record and paint what the server said. */
export function rememberSkin(key: string | undefined | null) {
  if (!isSkin(key)) return
  applySkin(key)
  try { window.localStorage.setItem(STORE_KEY, key) } catch { /* painting still worked */ }
}
