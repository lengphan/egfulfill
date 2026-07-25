// Open an OAuth authorize URL in a centered popup so the connect flow stays inside the app.
// The callback (/oauth-callback, same origin) postMessages the opener and closes itself.
// Returns the popup window, or null if the browser blocked it — callers fall back to a
// full-page redirect so the connection can still complete.
export function openOAuthPopup(url: string): Window | null {
  const w = 520, h = 720
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
