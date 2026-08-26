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
 * SCOPE: this module paints the surfaces that run `useAccent()` — the app, the boards and
 * auth. The PUBLIC marketing pages do NOT go through here and never should: they are Server
 * Components rendered for visitors with no session, so a client paint would flash the default
 * palette on every cold load. They read the same stored key on the server instead and render
 * `data-skin` into the markup — see lib/public-theme.ts. Both halves therefore honour one
 * admin choice, by two routes, for the same reason: whichever avoids a wrong first frame.
 *
 * Gate: `node tools/check-skins.mjs`.
 */
export type SkinKey = "workshop" | "studio" | "press"

export const SKINS: { key: SkinKey; label: string; what: string }[] = [
  { key: "workshop", label: "Workshop", what: "Parchment page, white cards, one lime. The house style." },
  { key: "studio", label: "Studio", what: "Ink on white. One bright accent." },
  { key: "press", label: "Press", what: "Violet plate over warm paper." },
]

/**
 * THE MARKETING DISPLAY FACE — the same shape as the skin, and NOT painted by this module.
 *
 * A skin has to be applied on the client for the signed-in app, which is why `applySkin`
 * exists. The face is a MARKETING-only choice, and the marketing pages are Server Components:
 * `app/(marketing)/layout.tsx` renders `data-face` into the markup from the stored key (see
 * lib/public-theme.ts), so nothing has to paint it after hydration and there is no first frame
 * in the wrong typeface. This list is only here so the picker and the type live together.
 *
 * Mirrors FACES in server/src/routes/branding.js — that file is the allow-list, this is the
 * label. Adding one means a next/font call in app/layout.tsx and a line in globals.css too.
 */
export type FaceKey = "sans" | "inter" | "outfit" | "grotesk"

export const FACES: { key: FaceKey; label: string; what: string }[] = [
  { key: "sans", label: "Plus Jakarta Sans", what: "The body stack. One face everywhere — the default." },
  { key: "outfit", label: "Outfit", what: "Wide, geometric. A second alphabet on the public pages." },
  { key: "grotesk", label: "Space Grotesk", what: "Narrower, more technical." },
  { key: "inter", label: "Inter", what: "The body sans until 2026-08-26." },
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
