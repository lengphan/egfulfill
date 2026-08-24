/**
 * THE PUBLIC SITE'S THEME, READ ON THE SERVER.
 *
 * This exists because the marketing pages could not see the theme at all. An admin picked a
 * skin in Settings › Branding, `lib/skin.ts` painted it onto <html> — and `useAccent()` is
 * called from the app shell and the boards layout and nowhere else, so the choice reached the
 * signed-in product and stopped there. The public pages rendered whatever `:root` declared.
 * A skin nobody outside the company can see is not a theme, it is a preference.
 *
 * WHY SERVER-SIDE AND NOT `useAccent()`. These are Server Components rendered for visitors
 * with no session; a client fetch would mean the default palette paints first and the real one
 * replaces it a moment later, on every cold load, for every visitor. That is the flash
 * `applyStoredSkin` exists to prevent for signed-in users, and there is no localStorage cache
 * to prevent it with for someone arriving for the first time. Rendered into the markup, there
 * is no first frame to be wrong.
 *
 * KEYS, NEVER VALUES — the whole discipline the skin was built on (see globals.css). What
 * comes back is checked against the lists here, so a value that is missing, malformed, or
 * added upstream by a newer server than this build renders as the default rather than as an
 * attribute nothing has a rule for. `/api/branding/theme` is the only public part of branding
 * and returns exactly these two fields.
 *
 * A FAILED FETCH IS THE DEFAULT, silently. The marketing site must render if the API is down —
 * the same contract `getSiteContent()` already keeps for the copy.
 */

/** Mirrors SKINS in server/src/routes/branding.js and lib/skin.ts. */
const SKINS = ["studio", "press"] as const
/** Mirrors FACES in server/src/routes/branding.js. `inter` is the body sans set heavier. */
const FACES = ["inter", "outfit", "grotesk"] as const

export type PublicTheme = { skin: (typeof SKINS)[number]; face: (typeof FACES)[number] }

/** What the site renders with no stored choice, and what a bad answer falls back to. */
export const DEFAULT_PUBLIC_THEME: PublicTheme = { skin: "studio", face: "outfit" }

export async function getPublicTheme(): Promise<PublicTheme> {
  const origin = (process.env.API_ORIGIN || "https://egful.store").replace(/\/+$/, "")
  try {
    // Same 60-second window as getSiteContent, so a marketing page still costs one revalidate
    // per minute rather than one request per visit, and the two never disagree about how
    // stale they are.
    const res = await fetch(`${origin}/api/branding/theme`, { next: { revalidate: 60 } })
    if (!res.ok) return DEFAULT_PUBLIC_THEME
    const body = (await res.json()) as { skin?: unknown; face?: unknown }
    return {
      skin: SKINS.includes(body?.skin as PublicTheme["skin"]) ? (body.skin as PublicTheme["skin"]) : DEFAULT_PUBLIC_THEME.skin,
      face: FACES.includes(body?.face as PublicTheme["face"]) ? (body.face as PublicTheme["face"]) : DEFAULT_PUBLIC_THEME.face,
    }
  } catch {
    return DEFAULT_PUBLIC_THEME
  }
}
