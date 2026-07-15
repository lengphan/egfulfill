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

// ─────────────────────────── Orders ───────────────────────────
// GET /api/orders → order rows (orders table) each with an aggregated items[].
export type OrderItem = {
  name?: string
  sku?: string
  qty?: number
  color?: string
  size?: string
  img?: string
  unit_price?: number | string
  print_type?: string
}
export type OrderRow = {
  id: string
  seq?: number | null
  store?: string | null
  source?: string | null
  customer?: { name?: string; email?: string } | null
  address?: Record<string, unknown> | null
  status?: string | null
  factory_status?: string | null
  total?: number | string | null
  tracking?: string | null
  carrier?: string | null
  timeline?: Array<{ status?: string; at?: string }> | null
  created_at?: string | null
  meta?: Record<string, unknown> | null
  items?: OrderItem[]
}

export function getOrders() {
  return api<OrderRow[]>(`/api/orders`)
}

export function updateOrder(id: string, patch: { status?: string; factoryStatus?: string; tracking?: string }) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export type NewOrderItem = {
  name?: string
  sku?: string
  qty?: number
  unitPrice?: number
  color?: string
  size?: string
  printType?: string
}
export type OrderDesign = { sku?: string; kind?: string; data?: string; name?: string }
export function getOrderDesigns(id: string) {
  return api<OrderDesign[] | { designs?: OrderDesign[] }>(`/api/orders/${encodeURIComponent(id)}/designs`)
}
export type OrderMessage = { id: number | string; sender_role?: string; body?: string; created_at?: string }
export function getOrderMessages(id: string) {
  return api<OrderMessage[] | { messages?: OrderMessage[] }>(`/api/orders/${encodeURIComponent(id)}/messages`)
}
export function postOrderMessage(id: string, body: string) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  })
}

export function createOrder(order: {
  id: string
  seq?: number
  customer?: { name?: string; email?: string }
  address?: Record<string, unknown>
  source?: string
  status?: string
  total?: number
  items?: NewOrderItem[]
}) {
  return api<{ ok?: boolean; id?: string; error?: string }>(`/api/orders`, {
    method: "POST",
    body: JSON.stringify(order),
  })
}

// ─────────────────────────── Auth: Google ───────────────────────────
export function getGoogleClientId() {
  return api<{ clientId: string }>(`/api/auth/google/client-id`)
}

// ─────────────────────────── Auth: signup / password reset ───────────────────────────
export function signupUser(body: { email: string; password: string; name?: string; store_name?: string }) {
  return api<{ token?: string; user?: Record<string, unknown>; error?: string }>(`/api/auth/signup`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}
export function forgotPassword(email: string) {
  return api<{ ok?: boolean; message?: string; error?: string }>(`/api/auth/forgot`, {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}
export function resetPassword(token: string, password: string) {
  return api<{ ok?: boolean; error?: string }>(`/api/auth/reset`, {
    method: "POST",
    body: JSON.stringify({ token, password }),
  })
}

export function googleLogin(credential: string) {
  return api<{ token?: string; user?: Record<string, unknown>; error?: string }>(`/api/auth/google`, {
    method: "POST",
    body: JSON.stringify({ credential }),
  })
}

// ─────────────────── Integration credentials (masked, read-only, staff) ───────────────────
export type SecretMeta = { name: string; label: string; integration: string; set: boolean; last4: string | null }
export function getAdminSecrets() {
  return api<{ secrets: SecretMeta[] }>(`/api/admin/secrets`)
}

// ─────────────────── Address validation (USPS) ───────────────────
export type ValidatedAddress = { street: string; street2: string; city: string; state: string; zip: string; zip4: string }
export function validateAddress(a: {
  streetAddress: string
  secondaryAddress?: string
  city: string
  state: string
  ZIPCode: string
}) {
  const p = new URLSearchParams()
  Object.entries(a).forEach(([k, v]) => v && p.set(k, v))
  return api<{ ok?: boolean; address?: ValidatedAddress; error?: string }>(`/api/usps/validate-address?${p.toString()}`)
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

// ─────────────────── SpyDeck: public Etsy listing search ───────────────────
export type EtsyListing = {
  listing_id: number
  title: string
  price: number | null
  currency: string
  url: string
  image: string | null
  images?: string[]
  views: number | null
  shop_name: string | null
}
export function searchEtsy(q: string, opts?: { sort?: string; limit?: number }) {
  const p = new URLSearchParams({ q })
  if (opts?.sort) p.set("sort", opts.sort)
  if (opts?.limit) p.set("limit", String(opts.limit))
  return api<{ count: number; query: string; results: EtsyListing[] }>(`/api/etsy/search?${p.toString()}`)
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
