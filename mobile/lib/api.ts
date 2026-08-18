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
  seq?: number | null
  factory_status?: string | null
  rush?: boolean
  created_at?: string | null
  ship_by?: string | null
  label_printed_at?: string | null
  label_scanned_at?: string | null
  items?: OrderItem[]
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
