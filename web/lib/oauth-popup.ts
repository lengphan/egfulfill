// Open an OAuth authorize URL in a centered popup so the connect flow stays inside the app.
// The callback (/oauth-callback, same origin) postMessages the opener and closes itself.
// Returns the popup window, or null if the browser blocked it — callers fall back to a
// full-page redirect so the connection can still complete.
export function openOAuthPopup(url: string): Window | null {
  // Sized for the roomiest authorize page we open — TikTok Shop's Seller Center consent
  // screen is wide and tall, and at the old 520×720 its content overflowed so the user had
  // to drag the window bigger by hand. Clamp to the available screen so it still fits on a
  // small display instead of opening larger than the monitor.
  const avail = typeof window.screen !== "undefined" ? window.screen : { availWidth: 1024, availHeight: 768 }
  const w = Math.min(680, Math.max(360, avail.availWidth - 40))
  const h = Math.min(860, Math.max(560, avail.availHeight - 60))
  const x = window.screenX + Math.max(0, Math.round((window.outerWidth - w) / 2))
  const y = window.screenY + Math.max(0, Math.round((window.outerHeight - h) / 2))
  try {
    const p = window.open(url, "eg-oauth", `popup=1,width=${w},height=${h},left=${x},top=${y}`)
    if (p) p.focus()
    return p
  } catch {
    return null
  }
}

// Message the callback posts back to the opener.
export type OAuthMessage = { source: "eg-oauth"; ok: boolean; shop?: string; message?: string }

// Which provider a connect flow was started for. The callback reads this to route to the
// right exchange INSTEAD of guessing from the returned params — TikTok's US Seller Center
// returns `code` while the global page returns `auth_code`, so param-name detection
// misrouted US TikTok connects into the Etsy branch ("Lost the security key"). Same-origin,
// so the popup (or a redirect) shares it with the opener.
//
// The marker is READ WITHOUT CONSUMING and only cleared once a connection completes. It used
// to be deleted the moment the callback read it, which meant anything that ran the callback
// twice — a reload, a re-mounted effect, reopening the window — lost the routing on the
// second pass and produced the same misleading "Lost the security key" card.
export const OAUTH_PROVIDER_KEY = "eg_oauth_provider"
export type OAuthProvider = "etsy" | "shopify" | "tiktok" | "alibaba"
export type OAuthMarker = { provider: OAuthProvider; state?: string; at?: number }

/** Stash which provider (and the `state` we sent it) started this connect. */
export function markOAuthProvider(p: OAuthProvider, state?: string): void {
  try {
    localStorage.setItem(OAUTH_PROVIDER_KEY, JSON.stringify({ provider: p, state, at: Date.now() } satisfies OAuthMarker))
  } catch { /* ignore */ }
}

/** Read the marker without clearing it. Tolerates the older bare-string format so a connect
 *  already in flight when this ships still routes correctly. */
export function peekOAuthProvider(): OAuthMarker | null {
  try {
    const raw = localStorage.getItem(OAUTH_PROVIDER_KEY)
    if (!raw) return null
    if (raw[0] !== "{") return { provider: raw as OAuthProvider }
    const m = JSON.parse(raw) as OAuthMarker
    return m && m.provider ? m : null
  } catch { return null }
}

export function clearOAuthProvider(): void {
  try { localStorage.removeItem(OAUTH_PROVIDER_KEY) } catch { /* ignore */ }
}
