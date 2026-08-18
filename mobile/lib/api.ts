import Constants from "expo-constants"
import * as SecureStore from "expo-secure-store"

/**
 * The ONE place the app talks to the server — same rule the web client follows.
 *
 * Same API, same JWT, same role gates. Nothing on the server knows or cares that this
 * request came from a phone, which is why an order started here is on the web the moment
 * it saves: one database, no sync layer to disagree.
 *
 * The token lives in the device keychain via SecureStore, not AsyncStorage — it is a
 * bearer credential for a system that moves money.
 */
const API_BASE: string =
  (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase ?? "https://api.egful.store"

const TOKEN_KEY = "eg_token"

export async function getToken() { return SecureStore.getItemAsync(TOKEN_KEY) }
export async function setToken(t: string) { return SecureStore.setItemAsync(TOKEN_KEY, t) }
export async function clearToken() { return SecureStore.deleteItemAsync(TOKEN_KEY) }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) throw new ApiError(res.status, body?.error || body?.message || `HTTP ${res.status}`)
  return body as T
}

export type User = { id?: string; name?: string; email?: string; role?: string }
export type OrderItem = { qty?: number | null }
export type Order = {
  id: string
  num?: string | null
  seq?: number | null
  factory_status?: string | null
  rush?: boolean
  created_at?: string | null
  ship_by?: string | null
  label_printed_at?: string | null
  label_scanned_at?: string | null
  items?: OrderItem[]
  /* Shipping. Optional throughout: the list payload does not always carry them, and a
     screen must be able to say "not shipped yet" rather than render an empty box that
     looks like a broken feature. */
  carrier?: string | null
  tracking?: string | null
  status?: string | null
  total?: number | string | null
}

export type LedgerRow = {
  id: number
  delta: number | string
  type: string
  note: string | null
  created_at: string
  balance_after?: number
}
export type WalletResponse = {
  account: string
  balance: number
  ledger: LedgerRow[]
  /** The server decides what "low" means — a client that picks its own threshold is how
   *  two screens end up disagreeing about whether to warn. */
  low?: boolean
  lowBelow?: number | null
}

export async function login(email: string, password: string) {
  const r = await request<{ token?: string; user?: User; error?: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  if (!r.token) throw new ApiError(400, r.error || "No token returned")
  await setToken(r.token)
  return r.user ?? null
}

export const getMe = () => request<User>("/api/me")
export const getOrders = () => request<Order[]>("/api/orders")
export const getOrder = (id: string) => request<Order>(`/api/orders/${encodeURIComponent(id)}`)
export const getWallet = () => request<WalletResponse>("/api/wallet")

/* ── Order activity ───────────────────────────────────────────────────────────
 * The same thread the web order page shows. `sender_role` is taken from what the
 * CLIENT sends (`b.role || 'seller'` server-side), so the caller's real role has to be
 * passed or a photo taken on the factory floor is filed as if the seller sent it. */
export type ChatAttachment = { url: string; name: string; mime: string; size?: number }
export type ChatEntry = {
  id: number | string
  by?: string
  role?: string
  me?: boolean
  text?: string
  ts?: number
  system?: boolean
  attachment?: ChatAttachment | null
}
export const getOrderMessages = (id: string) =>
  request<ChatEntry[]>(`/api/orders/${encodeURIComponent(id)}/messages`)

export const postOrderMessage = (
  id: string,
  text: string,
  opts: { role?: string; by?: string; clientId?: string; attachment?: ChatAttachment | null } = {},
) =>
  request<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      text, role: opts.role ?? "seller", by: opts.by,
      clientId: opts.clientId, attachment: opts.attachment ?? undefined,
    }),
  })

/* ── Wallet top-up (VietQR) ───────────────────────────────────────────────────
 * ONE QR, and it comes from the SERVER. VietQR issues a virtual account and only
 * reconciles payments made against the code it issued — an EMVCo payload built on the
 * device would scan and pay perfectly well, and the money would never be matched to an
 * account. `qrCode` is that server-issued string; the device only draws it. */
export type VqrTier = { usd: number; rate: number }
export type TopupConfig = {
  rate: number
  tiers: VqrTier[]
  minUsd: number
  smallPresets: number[]
  bulkPresets: number[]
}
export type VietqrPayment = {
  ok?: boolean
  qrCode?: string
  qrLink?: string
  /** OUR short reference (EG000007) — what the poll matches on. */
  note?: string
  /** The full transfer description as the bank shows it; VietQR wraps our ref in a
   *  virtual-account prefix, so showing `note` alone does not match what the payer sees. */
  content?: string
  amount?: number
  amountUsd?: number
  name?: string
  bankCode?: string
  account?: string
  vaAccount?: string
  error?: string
}
export const getTopupConfig = () => request<TopupConfig>("/api/vietqr/rate")
export const createVietqrPayment = (amount: number, amountUsd?: number) =>
  request<VietqrPayment>("/api/vietqr/create-payment", {
    method: "POST",
    body: JSON.stringify({ amount, amountUsd }),
  })
export const vietqrStatus = (ref: string) =>
  request<{ paid: boolean }>(`/api/vietqr/status?ref=${encodeURIComponent(ref)}`)

/** Store a photo and get a same-origin proxy URL back. 12MB ceiling server-side, which is
 *  why the camera is asked for a compressed image rather than the raw capture. */
export const uploadAttachment = (dataUrl: string, name: string) =>
  request<ChatAttachment & { error?: string }>("/api/support/attachment", {
    method: "POST",
    body: JSON.stringify({ dataUrl, name }),
  })
