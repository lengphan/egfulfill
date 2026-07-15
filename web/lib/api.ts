import { getToken } from "./auth"

// Same-origin in production (Caddy reverse-proxies /api → Fastify). For local
// cross-origin dev against a running API, set NEXT_PUBLIC_API_BASE=http://localhost:3000.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? ""

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

// ─────────────────────────── Wallet ───────────────────────────
// GET /api/wallet → { account, balance, ledger[] } (server-authoritative,
// balance = SUM(delta) over an append-only wallet_ledger).
export type LedgerRow = {
  id: number
  delta: number | string
  type: string
  ref: string | null
  note: string | null
  created_at: string
}

export type WalletResponse = {
  account: string
  balance: number
  ledger: LedgerRow[]
}

export function getWallet(account?: string) {
  const qs = account ? `?account=${encodeURIComponent(account)}` : ""
  return api<WalletResponse>(`/api/wallet${qs}`)
}

// ─────────────────────────── Catalog ───────────────────────────
// GET /api/catalog_products → the full product objects (lossless `data` jsonb).
// Field names mirror the static store, so keep this shape permissive.
export type CatalogProduct = {
  id?: string | number
  name?: string
  sku?: string
  type?: string
  method?: string
  material?: string
  status?: string
  price?: number | string
  basePrice?: number | string
  base_price?: number | string
  mainColor?: string
  sizes?: string[]
  images?: string[]
  img?: string
  image?: string
  hero?: string
  colorImages?: Record<string, string>
}

export function getCatalogProducts() {
  return api<CatalogProduct[]>(`/api/catalog_products`)
}

// ─────────────────────────── Stores / channels ───────────────────────────
// Etsy is the fully-wired channel today (etsy.js). Shopify/TikTok/WooCommerce
// have credentials but no seller-facing OAuth route yet → shown as "coming soon".
export type EtsyConnection = {
  id: number | string
  platform: string
  shop_id: string
  shop_name: string | null
  scopes: string | null
  last_sync_at: string | null
  created_at: string
}

export type EtsyConfig = {
  keystring: string
  redirect_uri: string
  scopes: string
  configured: boolean
}

export function getEtsyConnections() {
  return api<EtsyConnection[]>(`/api/etsy/connections`)
}

export function getEtsyConfig() {
  return api<EtsyConfig>(`/api/etsy/config`)
}

export function syncEtsy() {
  return api<{ ok?: boolean; imported?: number; error?: string }>(`/api/etsy/sync`, { method: "POST" })
}

export function disconnectEtsy(shopId: string) {
  return api<{ ok: boolean }>(`/api/etsy/connections/${encodeURIComponent(shopId)}`, { method: "DELETE" })
}

export function exchangeEtsy(body: { code: string; code_verifier: string; redirect_uri: string }) {
  return api<{ shop_name?: string; error?: string }>(`/api/etsy/exchange`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

// ─────────────────────────── API keys (sandbox) ───────────────────────────
// GET returns key metadata only; POST returns the full key exactly ONCE.
export type ApiKey = {
  id: number | string
  label: string | null
  prefix: string
  mode: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export function getApiKeys() {
  return api<{ keys: ApiKey[] }>(`/api/keys`)
}

export function createApiKey(label: string) {
  return api<{ id: number | string; key: string; prefix: string; label: string; mode: string; created_at: string }>(
    `/api/keys`,
    { method: "POST", body: JSON.stringify({ label }) }
  )
}

export function revokeApiKey(id: number | string) {
  return api<{ ok: boolean }>(`/api/keys/${encodeURIComponent(String(id))}`, { method: "DELETE" })
}

// ─────────────────────────── Team ───────────────────────────
export type TeamMember = {
  id: number | string
  email: string
  user_id: string | null
  role: string
  permissions: string[] | string | null
  status: string
  invited_at: string | null
}

export function getTeam() {
  return api<TeamMember[]>(`/api/team`)
}

export function inviteMember(body: { email: string; role?: string; permissions?: string[] }) {
  return api<{ ok?: boolean; id?: number | string; error?: string }>(`/api/team/invite`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function removeMember(id: number | string) {
  return api<{ ok: boolean }>(`/api/team/members/${encodeURIComponent(String(id))}`, { method: "DELETE" })
}
