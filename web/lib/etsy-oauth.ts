// Browser-side Etsy OAuth (PKCE) — mirrors the static site's oauth-callback.html
// flow, but same-origin: authorize + callback both live on the Next app so the
// verifier (stored here) is readable when Etsy redirects back to /oauth-callback.
import type { EtsyConfig } from "./api"

export const ETSY_PKCE_KEY = "eg_etsy_pkce"

type Pkce = { verifier: string; state: string; redirect: string }

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function randStr(): string {
  const a = new Uint8Array(48)
  crypto.getRandomValues(a)
  return b64url(a.buffer)
}

async function challenge(verifier: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return b64url(d)
}

/** Build the PKCE challenge, stash the verifier, and redirect to Etsy's consent screen. */
export async function startEtsyConnect(cfg: EtsyConfig): Promise<void> {
  const verifier = randStr()
  const state = randStr().slice(0, 24)
  // Same-origin callback so the verifier below is in scope on return.
  const redirect = window.location.origin + "/oauth-callback"
  const ch = await challenge(verifier)
  localStorage.setItem(ETSY_PKCE_KEY, JSON.stringify({ verifier, state, redirect } satisfies Pkce))
  window.location.href =
    "https://www.etsy.com/oauth/connect?response_type=code" +
    "&client_id=" + encodeURIComponent(cfg.keystring) +
    "&redirect_uri=" + encodeURIComponent(redirect) +
    "&scope=" + encodeURIComponent(cfg.scopes || "transactions_r listings_r") +
    "&state=" + encodeURIComponent(state) +
    "&code_challenge=" + encodeURIComponent(ch) +
    "&code_challenge_method=S256"
}

export function readPkce(): Pkce | null {
  try {
    const raw = localStorage.getItem(ETSY_PKCE_KEY)
    return raw ? (JSON.parse(raw) as Pkce) : null
  } catch {
    return null
  }
}

export function clearPkce(): void {
  try {
    localStorage.removeItem(ETSY_PKCE_KEY)
  } catch {
    /* ignore */
  }
}
