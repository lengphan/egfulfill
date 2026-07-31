// Browser-side TikTok Shop connect. No PKCE: the seller authorizes at the service page
// (service_id identifies the app), TikTok redirects to the callback registered in Partner
// Center as ?auth_code=&state=, and /oauth-callback exchanges it via /api/tiktok/exchange.
import type { TiktokConfig } from "./api"
import { openOAuthPopup, markOAuthProvider } from "./oauth-popup"

function randStr(): string {
  const a = new Uint8Array(18)
  crypto.getRandomValues(a)
  return btoa(String.fromCharCode(...a)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)
}

/** Open TikTok's authorize page (popup; redirect fallback if blocked). */
export function startTikTokConnect(cfg: TiktokConfig): Window | null {
  if (!cfg.configured || !cfg.service_id) throw new Error("TikTok isn't configured yet — add the app keys in Settings › Integrations.")
  const state = randStr()
  markOAuthProvider("tiktok", state)
  const url = `${cfg.authorize_url}?service_id=${encodeURIComponent(cfg.service_id)}&state=${encodeURIComponent(state)}`
  const p = openOAuthPopup(url)
  if (!p) window.location.href = url
  return p
}
