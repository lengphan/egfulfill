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
