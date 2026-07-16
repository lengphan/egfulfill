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
      const body = (await res.json()) as { error?: unknown; message?: unknown }
      const err = body?.error ?? body?.message
      // Coerce non-string error bodies so they never render as "[object Object]".
      if (err != null) message = typeof err === "string" ? err : JSON.stringify(err)
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

// ─────────────────── Wallet top-up: VietQR ───────────────────
// create-payment returns the VA-backed EMVCo QR string (`qrCode`) that MUST be
// rendered as-is; `note` is the reference the status poll matches on. The wallet
// is credited server-side by the VietQR callback — the client just polls.
export type VietqrPayment = {
  ok?: boolean
  qrCode?: string
  qrLink?: string
  note?: string
  content?: string
  amount?: number
  error?: string
}
export function createVietqrPayment(amount: number) {
  return api<VietqrPayment>(`/api/vietqr/create-payment`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  })
}
export function vietqrStatus(ref: string) {
  return api<{ paid: boolean; transaction?: unknown }>(`/api/vietqr/status?ref=${encodeURIComponent(ref)}`)
}

// ─────────────────── Wallet top-up: Stripe (card, API) ───────────────────
export function getStripeConfig() {
  return api<{ publishableKey: string; enabled: boolean }>(`/api/stripe/config`)
}
export function createStripeIntent(amount: number) {
  return api<{ clientSecret?: string; id?: string; error?: string }>(`/api/stripe/create-intent`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  })
}
export function verifyStripeIntent(id: string) {
  return api<{ ok?: boolean; amount?: number; status?: string; ref?: string; error?: string }>(`/api/stripe/verify-intent`, {
    method: "POST",
    body: JSON.stringify({ id }),
  })
}

// ─────────────────── Wallet top-up: manual transfer request (PayPal/PingPong/…) ───────────────────
// Creates a pending topup_request an admin reconciles → wallet credited. Same path
// the old wallet used for remittance methods; no third-party API needed.
// The seller's own top-up requests (pending / received / rejected) — surfaced in the
// wallet so a manual/VietQR top-up is visible immediately, before it's confirmed.
export type TopupRequest = {
  id: string
  amount_usd: number | string
  vnd?: number | string | null
  method?: string | null
  ref?: string | null
  status: "pending" | "received" | "rejected"
  txn_id?: string | null
  created_at: string
}
export function getMyTopups() {
  return api<TopupRequest[]>(`/api/topups`)
}

// ── Admin ──────────────────────────────────────────────────────────────────
export type AdminUser = { id: string; email: string; name?: string | null; role: string; store_name?: string | null; active?: boolean; created_at?: string }
export function getUsers() {
  return api<AdminUser[]>(`/api/users`)
}
export function createUserAdmin(body: { email: string; password: string; role?: string; name?: string }) {
  return api<AdminUser & { error?: string }>(`/api/users`, { method: "POST", body: JSON.stringify(body) })
}
export function updateUserAdmin(id: string, patch: { role?: string; password?: string; name?: string; active?: boolean }) {
  return api<{ ok?: boolean; error?: string }>(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })
}

export type AuditRow = { id: number | string; ts: string; actor?: string | null; actor_role?: string | null; action: string; entity_type?: string | null; entity_id?: string | null; note?: string | null }
export function getAudit(params?: { limit?: number; action?: string }) {
  const p = new URLSearchParams()
  if (params?.limit) p.set("limit", String(params.limit))
  if (params?.action) p.set("action", params.action)
  const qs = p.toString()
  return api<AuditRow[]>(`/api/audit${qs ? `?${qs}` : ""}`)
}

// Staff top-up review (pending → credit or reject the seller's wallet).
export function getTopups(status?: string) {
  return api<TopupRequest[]>(`/api/topups${status ? `?status=${encodeURIComponent(status)}` : ""}`)
}
export function confirmTopup(id: string) {
  return api<{ error?: string }>(`/api/topups/${encodeURIComponent(id)}/confirm`, { method: "POST" })
}
export function rejectTopup(id: string) {
  return api<{ error?: string }>(`/api/topups/${encodeURIComponent(id)}/reject`, { method: "POST" })
}

export function createTopupRequest(body: { amount: number; method: string; note?: string; ref?: string; name?: string; attachment?: string }) {
  return api<{ id?: number | string; status?: string; error?: string }>(`/api/topups`, {
    method: "POST",
    body: JSON.stringify(body),
  })
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
  shippingFee?: number | string
  shipping_fee?: number | string
  description?: string
  supplier?: string // "S&S" | "Otto Cap" | "" — where the blank derives from
  mainColor?: string
  sizes?: string[]
  images?: string[]
  img?: string
  image?: string
  hero?: string
  colorImages?: Record<string, string>
}

// AI assistant config (admin) — key status + model, editable in Settings › Integrations.
export type AiModel = { id: string; label: string }
export type AiConfig = { keySet?: boolean; last4?: string | null; fromEnv?: boolean; model?: string; models?: AiModel[]; ok?: boolean; error?: string }
export function getAiConfig() {
  return api<AiConfig>(`/api/admin/ai-config`)
}
export function setAiConfig(body: { key?: string; model?: string; clearKey?: boolean }) {
  return api<AiConfig>(`/api/admin/ai-config`, { method: "PUT", body: JSON.stringify(body) })
}
// Live-test a key/model against Anthropic — pass a key to test it BEFORE saving,
// or omit to test the currently-saved key. Returns the real error if it fails.
export function testAiKey(key?: string) {
  return api<{ ok?: boolean; model?: string; status?: number; error?: string }>(`/api/admin/ai-test`, { method: "POST", body: JSON.stringify(key ? { key } : {}) })
}

// Google Sheets import — server reads the sheet and returns a 2D row array,
// then the client reuses the same CSV parsing/validation (lib/order-import).
export function getSheetsConfig() {
  return api<{ enabled?: boolean; templateUrl?: string; canCreate?: boolean }>(`/api/sheets/config`)
}
export function getSheetRows(url: string) {
  return api<{ rows?: string[][]; title?: string; tab?: string; error?: string }>(`/api/sheets?url=${encodeURIComponent(url)}`)
}

export function getCatalogProducts() {
  return api<CatalogProduct[]>(`/api/catalog_products`)
}
// Staff: whole-catalog upsert (send the full array; missing ids are removed).
export function saveCatalogProducts(products: CatalogProduct[]) {
  return api<{ ok?: boolean; count?: number; error?: string }>(`/api/catalog_products`, { method: "POST", body: JSON.stringify(products) })
}

// ── Suppliers: S&S Activewear (browse from the synced DB — fast) + Otto Cap (stock) ──
export type SsStyle = { styleID: string; brand: string; title: string; category?: string; image: string | null; price: number | null; colors: string[]; favorited?: boolean }
export type SsStyleDetail = SsStyle & { sizes?: string[]; colorImages?: Record<string, string>; description?: string; extraImages?: string[]; error?: string }
export function getSsStatus() {
  return api<{ configured?: boolean; synced_count?: number; last_sync?: string | null }>(`/api/ss/status`)
}
export function getSsStyles(p: { search?: string; limit?: number; offset?: number }) {
  const s = new URLSearchParams()
  if (p.search) s.set("search", p.search)
  if (p.limit) s.set("limit", String(p.limit))
  if (p.offset) s.set("offset", String(p.offset))
  return api<{ synced: boolean; total: number; styles: SsStyle[] }>(`/api/ss/styles-synced?${s.toString()}`)
}
// The FULL live S&S catalog (all styles, cached server-side — "fetch them all"). Cards
// come without thumbnails on this account, so resolve a page's images via getSsStyleImgs.
export function getSsStylesAll(p: { search?: string; limit?: number; offset?: number }) {
  const s = new URLSearchParams()
  if (p.search) s.set("search", p.search)
  if (p.limit) s.set("limit", String(p.limit))
  if (p.offset) s.set("offset", String(p.offset))
  return api<{ total: number; styles: SsStyle[] }>(`/api/ss/styles?${s.toString()}`)
}
export function getSsStyleImgs(ids: string[]) {
  return api<Record<string, { image: string | null; colors: string[] }>>(`/api/ss/style-imgs?ids=${encodeURIComponent(ids.join(","))}`)
}
// Pre-warm ALL style thumbnails into the DB (background) so browsing is instant.
export function ssWarm() {
  return api<{ ok?: boolean; total?: number; error?: string }>(`/api/ss/warm`, { method: "POST" })
}
export function getSsWarmStatus() {
  return api<{ running?: boolean; total?: number; done?: number }>(`/api/ss/warm/status`)
}
export function getSsStyle(id: string) {
  return api<SsStyleDetail>(`/api/ss/style/${encodeURIComponent(id)}`)
}
export function ssSync() {
  return api<{ ok?: boolean; count?: number; error?: string }>(`/api/ss/sync`, { method: "POST" })
}
// S&S favorites (shared staff shortlist).
export function getSsFavorites() {
  return api<{ favorites: SsStyle[] }>(`/api/ss/favorites`)
}
export function toggleSsFavorite(s: SsStyle, on: boolean) {
  return on
    ? api(`/api/ss/favorites`, { method: "POST", body: JSON.stringify({ styleID: s.styleID, brand: s.brand, title: s.title, category: s.category, image: s.image }) })
    : api(`/api/ss/favorites/${encodeURIComponent(s.styleID)}`, { method: "DELETE" })
}
export function getOttoInventory(sku: string) {
  return api<unknown>(`/api/otto/inventory?sku=${encodeURIComponent(sku)}`)
}

// ── Inventory (staff) — whole-array upsert: send the full list, missing SKUs are dropped ──
export type InventoryItem = { sku: string; name?: string | null; variant?: string | null; in_stock?: number; reserved?: number; reorder_at?: number; category?: string | null; supplier?: string | null; updated_at?: string }
export function getInventory() {
  return api<InventoryItem[]>(`/api/inventory`)
}
export function saveInventory(items: InventoryItem[]) {
  return api<{ ok?: boolean; count?: number }>(`/api/inventory`, { method: "POST", body: JSON.stringify(items) })
}

// ── Purchase orders (staff) — draft → placed → received ──
export type POLine = { sku: string; name?: string; variant?: string; qty: number; price?: number }
export type PurchaseOrder = { num: string; supplier?: string | null; items: POLine[]; status: string; total?: number; meta?: Record<string, unknown> | null; created_at?: string }
export function getPurchaseOrders() {
  return api<PurchaseOrder[]>(`/api/purchase`)
}
export function savePurchaseOrder(po: PurchaseOrder) {
  return api<{ ok?: boolean; num?: string; error?: string }>(`/api/purchase`, { method: "POST", body: JSON.stringify(po) })
}
export function deletePurchaseOrder(num: string) {
  return api<{ ok?: boolean }>(`/api/purchase/${encodeURIComponent(num)}`, { method: "DELETE" })
}
// Place a supplier order (safe/test mode server-side by default).
export function ssOrder(lines: { sku: string; qty: number }[], live = false) {
  return api<{ ok?: boolean; testOrder?: boolean; error?: string; detail?: unknown }>(`/api/ss/order`, { method: "POST", body: JSON.stringify({ lines, live }) })
}
export function ottoOrder(items: { sku: string; qty: number }[]) {
  return api<{ ok?: boolean; dryRun?: boolean; error?: string; ottoResponse?: unknown }>(`/api/otto/order`, { method: "POST", body: JSON.stringify({ items }) })
}

// Otto Cap has no live catalog API — we import their Product Data export into otto_products
// and browse from there (live price/stock still per-SKU via getOttoInventory).
export type OttoImportRow = { sku: string; style?: string; name?: string; description?: string; color?: string; size?: string; price?: string | number; image?: string; category?: string; brand?: string; data?: Record<string, unknown> }
export type OttoStyle = { style: string; brand?: string | null; name: string | null; description: string | null; price: number | string | null; price_max?: number | string | null; image: string | null; colors: string[] | null; sizes: string[] | null; skus: string[]; category: string | null; favorited?: boolean }
export function getOttoStatus() {
  return api<{ count?: number; last?: string | null }>(`/api/otto/products/status`)
}
export type OttoStyleDetail = { style: string; name: string; description: string | null; price: number | null; category: string | null; colors: string[]; sizes: string[]; colorImages: Record<string, string>; image: string | null; skus: string[]; error?: string }
export function getOttoStyle(style: string) {
  return api<OttoStyleDetail>(`/api/otto/style/${encodeURIComponent(style)}`)
}
export type OttoFav = { style: string; name: string | null; image: string | null; price: number | string | null }
export function getOttoFavorites() {
  return api<{ favorites: OttoFav[] }>(`/api/otto/favorites`)
}
export function toggleOttoFavorite(s: { style: string; name?: string | null; image?: string | null; price?: number | string | null }, on: boolean) {
  return api(`/api/otto/favorites`, { method: "POST", body: JSON.stringify({ style: s.style, name: s.name, image: s.image, price: s.price, on }) })
}
export function getOttoProducts(p: { search?: string; limit?: number; offset?: number }) {
  const s = new URLSearchParams()
  if (p.search) s.set("search", p.search)
  if (p.limit) s.set("limit", String(p.limit))
  if (p.offset) s.set("offset", String(p.offset))
  return api<{ total: number; items: OttoStyle[]; error?: string }>(`/api/otto/products?${s.toString()}`)
}
export function importOttoProducts(products: OttoImportRow[]) {
  return api<{ ok?: boolean; imported?: number; total?: number; error?: string }>(`/api/otto/import`, { method: "POST", body: JSON.stringify({ products }) })
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
  factory_status?: string | null
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

// Staff: set one line item's factory_status (drives the production boards).
export function postItemStatus(id: string, sku: string, status: string) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/item-status`, {
    method: "POST",
    body: JSON.stringify({ sku, status }),
  })
}

export function updateOrder(id: string, patch: { status?: string; factoryStatus?: string; tracking?: string; carrier?: string }) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export type NewOrderItem = {
  name?: string
  sku?: string
  img?: string
  qty?: number
  unitPrice?: number
  color?: string
  size?: string
  printType?: string
}
// %-coords for placing artwork on a mockup: center x/y, width w, rotation r (degrees).
export type DesignPos = { x: number; y: number; w: number; h?: number; r: number }
export type OrderDesign = { sku?: string; kind?: string; data?: string; name?: string; pos?: DesignPos | null }
export function getOrderDesigns(id: string) {
  return api<OrderDesign[] | { designs?: OrderDesign[] }>(`/api/orders/${encodeURIComponent(id)}/designs`)
}
export function postOrderDesign(id: string, body: { sku: string; data: string; name?: string; pos?: DesignPos; kind?: string }) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/designs`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}
// The messages endpoint returns reconstructed chat entries (NOT raw rows):
// { id, by, role, text, ts, system?, attachment? }. Order chat AND support chat
// (order id `support-<sellerId>`) share these endpoints.
export type ChatEntry = {
  id: number | string
  by?: string
  role?: string
  text?: string
  ts?: number
  system?: boolean
  attachment?: unknown
}
export function getOrderMessages(id: string) {
  return api<ChatEntry[]>(`/api/orders/${encodeURIComponent(id)}/messages`)
}
// POST reads b.text / b.role / b.by / b.clientId (idempotent by clientId). Sending
// `{body}` posts an EMPTY message — the server keys off `text`.
export function postOrderMessage(id: string, text: string, opts?: { by?: string; role?: string; clientId?: string }) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, role: opts?.role ?? "seller", by: opts?.by, clientId: opts?.clientId }),
  })
}

// Current user's id (sub) from the JWT — used to address the seller's own support thread.
export function getMe() {
  return api<{ sub?: string; role?: string; email?: string }>(`/api/me`)
}
// Ask the account-aware AI to reply in the seller's support thread. No-op server-side
// if ANTHROPIC_API_KEY isn't configured ({ ok:false, disabled:true }).
export function requestAiReply() {
  return api<{ ok?: boolean; reply?: string; disabled?: boolean; skipped?: boolean; error?: string }>(`/api/support/ai-reply`, {
    method: "POST",
    body: "{}",
  })
}
// Staff support inbox: every seller support thread + an AI-drafted reply (not posted).
export type SupportThread = { order_id: string; seller_id: string; seller_name: string | null; last: string; last_at: number; n: number }
export function getSupportThreads() {
  return api<SupportThread[]>(`/api/support/threads`)
}
export function aiDraft(threadId: string) {
  return api<{ ok?: boolean; draft?: string; disabled?: boolean; error?: string }>(`/api/support/ai-draft`, { method: "POST", body: JSON.stringify({ threadId }) })
}
// Platform factory settings (design fee, default shipping, emb file price). Any staff can
// read; warehouse/admin write.
export type FactorySettings = { design_fee?: number; ship_first?: number; ship_extra?: number; emb_price?: number }
export function getFactorySettings() {
  return api<FactorySettings>(`/api/factory/settings`)
}
export function setFactorySettings(body: FactorySettings) {
  return api<FactorySettings & { ok?: boolean; error?: string }>(`/api/factory/settings`, { method: "PUT", body: JSON.stringify(body) })
}

// Update the signed-in user's profile (currently just the display name).
export function updateProfile(patch: { name?: string }) {
  return api<{ id?: string; name?: string; email?: string; role?: string; error?: string }>(`/api/me`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

// Design cards — the Designer board (kanban). Staff see all; sellers see their own.
// The POST is a WHOLE-BOARD replace (upsert all + delete the rest), so always send the
// full array of the raw rows (with your edits) to avoid wiping other cards/fields.
export type DesignCard = {
  id: number | string
  title?: string
  product?: string
  type?: string
  sku?: string
  thumb?: string | null
  order_id?: string | null
  col?: string | null
  claimed_by?: string | null
  payment?: number | string | null
  pay_status?: string | null
  credited?: boolean // designer paid once on approval — guards against double-credit
  priority?: string | null
  is_emb?: boolean
  customer?: string | null
  [k: string]: unknown // preserve extra columns (specs/files/notes/…) on round-trip
}
export function getDesignCards() {
  return api<DesignCard[]>(`/api/design_cards`)
}
export function saveDesignCards(cards: DesignCard[]) {
  return api<{ ok?: boolean; count?: number; error?: string }>(`/api/design_cards`, { method: "POST", body: JSON.stringify(cards) })
}

// Staff wallet transfer (factory ↔ seller/designer). Idempotent by ref.
export function walletTransfer(body: { fromAccount?: string; toAccount?: string; toOrderId?: string; toEmail?: string; amount: number; ref?: string; type?: string; note?: string }) {
  return api<{ ok?: boolean; error?: string }>(`/api/wallet/transfer`, { method: "POST", body: JSON.stringify(body) })
}

// Seller design library ("my designs") — reusable artwork the seller creates/uploads.
export type LibraryDesign = { id: number | string; name?: string | null; thumb?: string | null; created_at?: string }
export function getDesignLibrary() {
  return api<LibraryDesign[]>(`/api/design_library`)
}
export function getDesignLibraryItem(id: number | string) {
  return api<{ data?: string }>(`/api/design_library/${encodeURIComponent(String(id))}`)
}
export function saveDesignLibrary(body: { name?: string; data: string; thumb?: string }) {
  return api<LibraryDesign & { error?: string }>(`/api/design_library`, { method: "POST", body: JSON.stringify(body) })
}
export function deleteDesignLibrary(id: number | string) {
  return api<{ ok?: boolean }>(`/api/design_library/${encodeURIComponent(String(id))}`, { method: "DELETE" })
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
export type SecretMeta = { name: string; label: string; integration: string; set: boolean; last4: string | null; editable?: boolean }
export function getAdminSecrets() {
  return api<{ secrets: SecretMeta[] }>(`/api/admin/secrets`)
}
export function setAdminSecret(name: string, value: string) {
  return api<{ ok?: boolean; name?: string; set?: boolean; last4?: string | null; error?: string }>(`/api/admin/secrets`, { method: "PUT", body: JSON.stringify({ name, value }) })
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

export function publishEtsy(body: { title: string; description?: string; price: number; quantity?: number; image: string; tags?: string[]; taxonomy_id?: number | string }) {
  return api<{ listing_id?: number; url?: string; error?: string }>(`/api/etsy/publish`, { method: "POST", body: JSON.stringify(body) })
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
  description?: string
  price: number | null
  currency: string
  url: string
  image: string | null
  images?: string[]
  views: number | null
  num_favorers?: number | null
  created?: number | null // unix seconds — listing age drives the sales estimates
  tags?: string[] // Etsy listing tags (up to 13) — keyword research
  shop_name: string | null
}
// SpyDeck saved/favorited research listings (server-authoritative, per seller).
export type SavedListing = EtsyListing & { saved_at?: string }
export function getSpydeckSaves() {
  return api<SavedListing[]>(`/api/spydeck/saves`)
}
// Daily trending feed (server-cached) — auto-populates SpyDeck without a search.
export type TrendingFeed = { date?: string; products?: EtsyListing[]; keywords?: string[]; error?: string }
export function getSpydeckTrending() {
  return api<TrendingFeed>(`/api/spydeck/trending`)
}
export function saveSpydeckListing(listing: EtsyListing) {
  return api<{ ok?: boolean; error?: string }>(`/api/spydeck/saves`, {
    method: "POST",
    body: JSON.stringify({ listing_id: String(listing.listing_id), data: listing }),
  })
}
export function unsaveSpydeckListing(listingId: number | string) {
  return api<{ ok?: boolean }>(`/api/spydeck/saves/${encodeURIComponent(String(listingId))}`, { method: "DELETE" })
}

export type EtsySearchOpts = { sort?: string; sortOrder?: string; limit?: number; taxonomyId?: string | number; minPrice?: number; maxPrice?: number }
export function searchEtsy(q: string, opts?: EtsySearchOpts) {
  const p = new URLSearchParams({ q })
  if (opts?.sort) p.set("sort", opts.sort)
  if (opts?.sortOrder) p.set("sortOrder", opts.sortOrder)
  if (opts?.limit) p.set("limit", String(opts.limit))
  if (opts?.taxonomyId) p.set("taxonomyId", String(opts.taxonomyId))
  if (opts?.minPrice) p.set("minPrice", String(opts.minPrice))
  if (opts?.maxPrice) p.set("maxPrice", String(opts.maxPrice))
  return api<{ count: number; query: string; results: EtsyListing[] }>(`/api/etsy/search?${p.toString()}`)
}
export type EtsyCategory = { id: number; name: string }
export function getEtsyCategories() {
  return api<{ categories: EtsyCategory[] }>(`/api/etsy/categories`)
}

export function syncEtsy() {
  return api<{ ok?: boolean; imported?: number; error?: string }>(`/api/etsy/sync`, { method: "POST" })
}

export function disconnectEtsy(shopId: string) {
  return api<{ ok: boolean }>(`/api/etsy/connections/${encodeURIComponent(shopId)}`, { method: "DELETE" })
}

// ── Shopify (per-store OAuth) — parallel to Etsy ──
export type ShopifyConfig = { api_key: string; scopes: string; redirect_uri: string; configured: boolean }
export function getShopifyConfig() {
  return api<ShopifyConfig>(`/api/shopify/config`)
}
export function getShopifyConnections() {
  return api<EtsyConnection[]>(`/api/shopify/connections`)
}
export function exchangeShopify(body: { shop: string; code: string; params: Record<string, string> }) {
  return api<{ shop_name?: string; error?: string }>(`/api/shopify/exchange`, { method: "POST", body: JSON.stringify(body) })
}
export function disconnectShopify(shopId: string) {
  return api<{ ok: boolean }>(`/api/shopify/connections/${encodeURIComponent(shopId)}`, { method: "DELETE" })
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

export function createApiKey(label: string, mode: "test" | "live" = "test") {
  return api<{ id: number | string; key: string; prefix: string; label: string; mode: string; created_at: string }>(
    `/api/keys`,
    { method: "POST", body: JSON.stringify({ label, mode }) }
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
