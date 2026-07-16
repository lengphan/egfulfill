// Browser-side Shopify OAuth — per-store: the seller enters <shop>.myshopify.com, we
// redirect to that store's authorize screen, Shopify returns to /oauth-callback (same
// origin), which posts code + params to /api/shopify/exchange (HMAC-verified server-side).
import type { ShopifyConfig } from "./api"

export const SHOPIFY_OAUTH_KEY = "eg_shopify_oauth"
type ShopifyOAuth = { shop: string; state: string; redirect: string }

function randStr(): string {
  const a = new Uint8Array(24)
  crypto.getRandomValues(a)
  return btoa(String.fromCharCode(...a)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)
}

// "mystore", "mystore.myshopify.com", or a full URL → canonical <name>.myshopify.com.
export function normalizeShop(input: string): string | null {
  let s = (input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  if (!s) return null
  if (!s.includes(".")) s = s + ".myshopify.com"
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return null
  return s
}

/** Redirect to the store's Shopify consent screen. */
export function startShopifyConnect(cfg: ShopifyConfig, shopInput: string): void {
  const shop = normalizeShop(shopInput)
  if (!shop) throw new Error("Enter your store as mystore.myshopify.com")
  const state = randStr()
  const redirect = window.location.origin + "/oauth-callback"
  localStorage.setItem(SHOPIFY_OAUTH_KEY, JSON.stringify({ shop, state, redirect } satisfies ShopifyOAuth))
  window.location.href =
    `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(cfg.api_key)}` +
    `&scope=${encodeURIComponent(cfg.scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&state=${encodeURIComponent(state)}`
}

export function readShopifyOAuth(): ShopifyOAuth | null {
  try { const raw = localStorage.getItem(SHOPIFY_OAUTH_KEY); return raw ? (JSON.parse(raw) as ShopifyOAuth) : null } catch { return null }
}
export function clearShopifyOAuth(): void {
  try { localStorage.removeItem(SHOPIFY_OAUTH_KEY) } catch { /* ignore */ }
}
