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
export type AdminUser = {
  id: string; email: string; name?: string | null; role: string; store_name?: string | null
  active?: boolean; plan?: string; spydeck_addon?: boolean; created_at?: string
  /** Set when this account is a MEMBER of someone else's team. */
  owner_id?: string | null
  owner_label?: string | null
  team_permissions?: string[] | null
  /** How many active members this account leads. 0 = not a team leader. */
  team_size?: number
  /** Wallet balance (sellers). Staff share the factory wallet, so theirs is always 0. */
  balance?: number
}
export function getUsers() {
  return api<AdminUser[]>(`/api/users`)
}
export function createUserAdmin(body: { email: string; password: string; role?: string; name?: string }) {
  return api<AdminUser & { error?: string }>(`/api/users`, { method: "POST", body: JSON.stringify(body) })
}
/** Manual balance adjustment by staff. Positive credits, negative debits. The reason is
 *  required — an unexplained movement in a money ledger is worse than no movement. */
export function adjustBalance(body: { account: string; delta: number; note: string; ref?: string }) {
  return api<{ ok?: boolean; balance?: number; duplicate?: boolean; error?: string }>(`/api/wallet/ledger`, {
    method: "POST",
    body: JSON.stringify({ account: body.account, delta: body.delta, note: body.note, type: "adjust", ref: body.ref }),
  })
}
export function deleteUserAdmin(id: string) {
  return api<{ ok?: boolean; error?: string }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" })
}
export function updateUserAdmin(id: string, patch: { role?: string; password?: string; name?: string; active?: boolean; plan?: string; spydeck_addon?: boolean }) {
  return api<{ ok?: boolean; error?: string }>(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })
}

export type AuditRow = { id: number | string; ts: string; actor?: string | null; actor_email?: string | null; actor_name?: string | null; actor_role?: string | null; action: string; entity_type?: string | null; entity_id?: string | null; note?: string | null }
/**
 * Everything that has happened to one order, newest first. Staff-readable (the unfiltered
 * admin log is separate) — an operator working an order needs its story.
 */
export function getOrderHistory(entityId: string) {
  return api<AuditRow[]>(`/api/audit/entity?entityId=${encodeURIComponent(entityId)}`)
}
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
  // Per-SIZE price tiers. Canonical shape from npmCollectPriceTiers (eg-products.js):
  // an ARRAY of {size, price, shipping}, not a keyed map. `shipping: null` means "no
  // override — use shippingFee". A 3XL costs more to buy AND to ship; colour changes
  // neither, which is why tiers key on size alone. Priced by server/src/pricing.js.
  sizePrices?: { size: string; price: number; shipping: number | null }[]
  // Print-method surcharge, e.g. { DTG: 3, EMB: 5 } — EMB stitches cost more than ink.
  methodPrices?: Record<string, number>
  // This product's own extra-item shipping, overriding the platform's ship_extra.
  additionalItemShipping?: number | null
  description?: string
  supplier?: string // "S&S" | "Otto Cap" | "" — where the blank derives from
  mainColor?: string
  sizes?: string[]
  images?: string[]
  img?: string
  image?: string
  hero?: string
  colorImages?: Record<string, string>
  // The uploaded blank mockup graphic (the 2D garment image), + per-side variants
  // ({front, back, left, right, ...}) for placing artwork on more than one face.
  mockup?: string
  sideMockups?: Record<string, string>
  side_mockups?: Record<string, string>
  // Explicit per-variant SKUs ([{sku,color,size}] | string[]) — how a marketplace
  // listing's SKU resolves back to this product. Matched by pricing.js + the variant picker.
  variantSkus?: (string | { sku?: string; SKU?: string; color?: string; size?: string })[]
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
// A colour is either a bare name (older cache rows) or {name, swatch} where swatch is the
// supplier's real swatch image URL — beats guessing a hex from a name like "Dk.Grn/Kha".
export type SsColor = string | { name: string; swatch: string | null }
// Flatten either colour shape to bare names — for the catalog/favorite paths that only
// store names, and anywhere a string[] is still expected.
export const colorNames = (colors?: SsColor[] | null): string[] =>
  (colors ?? []).map((c) => (typeof c === "string" ? c : c.name)).filter(Boolean)
export type SsStyle = { styleID: string; brand: string; title: string; category?: string; image: string | null; price: number | null; priceMax?: number | null; colors: SsColor[]; favorited?: boolean }
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
  return api<Record<string, { image: string | null; colors: SsColor[]; price?: number | null; priceMax?: number | null }>>(`/api/ss/style-imgs?ids=${encodeURIComponent(ids.join(","))}`)
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
// Synced S&S products at SKU level (style search only gets you a style — a PO line
// needs the orderable sku, i.e. a specific colour + size).
export type SsProduct = {
  sku: string; style_id?: string | null; brand?: string | null; style_name?: string | null
  color?: string | null; size?: string | null; price?: number | string | null; qty?: number | null
  image?: string | null; category?: string | null
}
export function getSsProducts(p: { search?: string; limit?: number; offset?: number }) {
  const s = new URLSearchParams()
  if (p.search) s.set("search", p.search)
  if (p.limit) s.set("limit", String(p.limit))
  if (p.offset) s.set("offset", String(p.offset))
  return api<{ total: number; products: SsProduct[]; error?: string }>(`/api/ss/products?${s.toString()}`)
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
/**
 * Whole-list upsert: every SKU missing from `items` is DELETED server-side, and every
 * row's values are written from this snapshot. That makes it a clobber risk — if stock
 * was scanned since the list was fetched, saving here erases it. Prefer patchInventoryItem
 * / addInventoryItem / deleteInventoryItem for edits. Kept for the legacy floor.html path.
 */
export function saveInventory(items: InventoryItem[]) {
  return api<{ ok?: boolean; count?: number }>(`/api/inventory`, { method: "POST", body: JSON.stringify(items) })
}
// Partial write — only the supplied fields move, so a concurrent scan survives.
export function patchInventoryItem(sku: string, fields: Partial<InventoryItem>) {
  return api<{ ok: boolean; item: InventoryItem }>(`/api/inventory/${encodeURIComponent(sku)}`, { method: "PATCH", body: JSON.stringify(fields) })
}
export function addInventoryItem(item: InventoryItem) {
  return api<{ ok: boolean; item: InventoryItem }>(`/api/inventory/item`, { method: "POST", body: JSON.stringify(item) })
}
export function deleteInventoryItem(sku: string) {
  return api<{ ok?: boolean }>(`/api/inventory/${encodeURIComponent(sku)}`, { method: "DELETE" })
}

// ── Ads (Meta + Google) ──
// Spend/budget are already normalised to whole currency server-side (Meta reports
// cents, Google micros) — never re-scale them here.
export type AdCampaign = {
  channel: "meta" | "google"
  account: string
  id: string
  name: string
  status: string
  objective?: string | null
  dailyBudget?: number | null
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  roas?: number | null
}
export type AdsResponse = {
  days: number
  since: string
  until: string
  campaigns: AdCampaign[]
  totals: { spend: number; impressions: number; clicks: number; conversions: number; revenue: number; roas?: number | null }
  errors: { channel: string; account: string; error: string }[]
}
export type AdsConfig = {
  meta: { enabled: boolean; appId?: string | null; scopes: string }
  google: { enabled: boolean; clientId?: string | null; scopes: string }
}
export type AdConnection = { id: string; platform: string; account_id: string; shop_name?: string | null; created_at?: string }

export function getAdsConfig() { return api<AdsConfig>(`/api/ads/config`) }
export function getAdConnections() { return api<AdConnection[]>(`/api/ads/connections`) }
export function deleteAdConnection(id: string) { return api<{ ok: boolean }>(`/api/ads/connections/${encodeURIComponent(id)}`, { method: "DELETE" }) }
export function getAdCampaigns(days = 7) { return api<AdsResponse>(`/api/ads/campaigns?days=${days}`) }
export function exchangeAds(channel: "meta" | "google", code: string, redirectUri: string) {
  return api<{ ok?: boolean; accounts?: unknown[]; error?: string }>(`/api/ads/${channel}/exchange`, { method: "POST", body: JSON.stringify({ code, redirectUri }) })
}
export function createAdCampaign(body: { channel: "meta" | "google"; name: string; dailyBudget: number; objective?: string; accountId?: string }) {
  return api<{ ok?: boolean; id?: string; status?: string; error?: string }>(`/api/ads/campaigns`, { method: "POST", body: JSON.stringify(body) })
}
export function setAdCampaignStatus(channel: string, id: string, status: "ACTIVE" | "PAUSED") {
  return api<{ ok?: boolean; error?: string }>(`/api/ads/campaigns/${channel}/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) })
}

// ── Design files (drag-drop onto a board card → linked to the order/item) ──
// Every type is stored; the SERVER routes by `kind`: .pes = the seller's paid
// deliverable, .emb = factory working file, image/* = artwork. Price is admin+
// warehouse only, and that's enforced server-side — not just hidden in the UI.
export type DesignFileRow = { designId: string; sku?: string | null; name?: string | null; mime?: string | null; kind?: string; price?: number; paid?: boolean; canPrice?: boolean; created_at?: string }
/** A prior deliverable made from the same artwork. `distance` is set only on fuzzy hits. */
export type ReuseMatch = { design_id: string; file_name?: string | null; kind?: string; order_id?: string; seller?: string; created_at?: string; distance?: number }
/** exact = identical artwork, safe to reuse. similar = looks alike, needs a human to confirm. */
/** Copy an existing machine file onto another order. Staff only — the receiving seller
 *  sees a normal deliverable on their own order and learns nothing about its origin. */
export function reuseDesignFile(designId: string, body: { orderId: string; sku: string }) {
  return api<{ ok?: boolean; designId?: string; error?: string }>(
    `/api/design_files/${encodeURIComponent(designId)}/reuse`,
    { method: "POST", body: JSON.stringify(body) })
}
export function getDesignReuse(orderId: string, sku: string) {
  return api<{ exact: ReuseMatch[]; similar: ReuseMatch[]; hashed: boolean }>(
    `/api/design_files/reuse?orderId=${encodeURIComponent(orderId)}&sku=${encodeURIComponent(sku)}`)
}
export function getDesignFiles(orderId: string) {
  return api<DesignFileRow[]>(`/api/design_files?orderId=${encodeURIComponent(orderId)}`)
}
export function uploadDesignFile(body: { designId: string; orderId?: string; sku?: string; name?: string; mime?: string; data: string; price?: number }) {
  return api<{ ok?: boolean; stored?: string; error?: string }>(`/api/design_files`, { method: "POST", body: JSON.stringify(body) })
}
export function setDesignFilePrice(designId: string, price: number) {
  return api<{ ok?: boolean; price?: number; error?: string }>(`/api/design_files/${encodeURIComponent(designId)}/price`, { method: "PATCH", body: JSON.stringify({ price }) })
}
export function purchaseDesignFile(designId: string) {
  return api<{ ok?: boolean; paid?: boolean; balance?: number; error?: string; needsTopup?: boolean }>(`/api/design_files/${encodeURIComponent(designId)}/purchase`, { method: "POST" })
}
/** Returns the bytes as a data-URL / object-storage URL — 402 if not purchased. */
export function downloadDesignFile(designId: string) {
  return api<{ designId: string; name?: string; mime?: string; data?: string; url?: string }>(`/api/design_files/${encodeURIComponent(designId)}`)
}

// ── Notifications ──
export type Notification = { id: number | string; type: string; title: string; body?: string | null; href?: string | null; entity_id?: string | null; read_at?: string | null; created_at: string }
export function getNotifications(limit = 20) {
  return api<{ unread: number; notifications: Notification[] }>(`/api/notifications?limit=${limit}`)
}
export function markNotificationsRead(id?: number | string) {
  return api<{ ok: boolean; unread: number }>(`/api/notifications/read`, { method: "POST", body: JSON.stringify(id ? { id } : {}) })
}

// ── SpyDeck Account Analyzer ──
// The server computes every number (deterministic, same estimate model as the rest of
// SpyDeck) and only the write-up comes from the model. Results cache for 24h per
// seller — pass refresh to force a re-run and a new AI call.
export type ShopSummary = { shop_id?: string; shop_name?: string | null; url?: string | null; num_favorers?: number; listing_active_count?: number; review_count?: number | null; review_average?: number | null }
export type ShopStats = {
  listingCount: number
  medianPrice: number
  priceRange?: { min: number; max: number } | null
  totalFavorites: number
  estRevenue: number
  avgTags: number
  issues: { noTags: number; thinTags: number; shortTitles: number; singleImage: number }
  topTags: { tag: string; n: number }[]
  best: { title: string; price: number | null; favorites: number; estSoldPerDay: number; tags: number }[]
  worst: { title: string; price: number | null; favorites: number; ageDays: number; tags: number }[]
}
/** REAL sales from synced Etsy receipts — present only once the seller's orders sync.
 *  Etsy exposes no shop stats, so without this everything is an estimate. */
export type ShopSales = {
  windowDays: number
  orders: number
  revenue: number
  avgOrderValue: number
  topSellers: { name: string | null; units: number; revenue: number }[]
}
export type ShopAnalysis = {
  cached?: boolean
  at?: string
  shop?: ShopSummary
  stats?: ShopStats
  sales?: ShopSales | null
  advice?: string | null
  aiError?: string | null
  listings?: EtsyListing[]
  empty?: boolean
  error?: string
  needsConnect?: boolean
}
/** Cached run only — never triggers an AI call, so opening the tab is free. */
export function getShopAnalysis() {
  return api<ShopAnalysis>(`/api/spydeck/analysis`)
}
export function analyzeShop(refresh = false) {
  return api<ShopAnalysis>(`/api/spydeck/analyze`, { method: "POST", body: JSON.stringify({ refresh }) })
}

// ── Inventory scan in/out ──
// A scan is an ATOMIC DELTA server-side (in_stock = in_stock + n), NOT the whole-list
// upsert saveInventory() uses — so two people scanning at once can't clobber each other.
export type ScanRow = { id: string; sku: string; direction: "in" | "out"; qty: number; order_ref?: string | null; created_at?: string; by_name?: string | null; item_name?: string | null }
export function scanInventory(body: { sku: string; direction: "in" | "out"; qty?: number; order_ref?: string | null }) {
  return api<{ ok: boolean; item: InventoryItem; scan: ScanRow }>(`/api/inventory/scan`, { method: "POST", body: JSON.stringify(body) })
}
export function getScanHistory(sku?: string, limit = 100) {
  const qs = new URLSearchParams()
  if (sku) qs.set("sku", sku)
  qs.set("limit", String(limit))
  return api<ScanRow[]>(`/api/inventory/scan?${qs}`)
}
export function undoScan(id: string) {
  return api<{ ok: boolean; item: InventoryItem | null }>(`/api/inventory/scan/${encodeURIComponent(id)}`, { method: "DELETE" })
}

// ── USPS-direct label (Labels 3.0) — buys a real label + writes tracking onto the order ──
export type ShipAddress = { name?: string; street?: string; street2?: string; city?: string; state?: string; zip?: string }
export type UspsLabelResult = { ok?: boolean; error?: string; mock?: boolean; trackingNumber?: string; labelUrl?: string; labelImage?: string; labelHtml?: string; imageType?: string; carrier?: string; service?: string; cost?: number }
export function buyUspsLabel(body: { to: ShipAddress; from: ShipAddress; weightOz?: number; length?: number; width?: number; height?: number; mailClass?: string; orderId?: string; directUsps?: boolean }) {
  // Route through the aggregator (Shippo/EasyPost) when one is configured — it needs no
  // USPS EPS billing approval, and a test key buys free sample labels.
  //
  // This used to force directUsps:true on EVERY call, which skipped the aggregator
  // unconditionally and billed USPS EPS instead. That's where "we are having trouble
  // validating your credit card" came from: an EPS billing failure for an account the
  // aggregator path never touches. Now opt-in, for when you deliberately want
  // USPS-direct (Labels 3.0).
  return api<UspsLabelResult>(`/api/usps/label`, { method: "POST", body: JSON.stringify(body) })
}

// ── Purchase orders (staff) — draft → placed → received ──
export type POLine = { sku: string; name?: string; variant?: string; qty: number; price?: number }

// ── Factory-global shared lists (staff-only KV blobs, whole-array replace) ──
// The key must be on the server's ALLOWED whitelist in routes/factory_lists.js.
export function getFactoryList<T>(k: string) {
  return api<T | null>(`/api/factory_lists/${encodeURIComponent(k)}`)
}
export function saveFactoryList(k: string, v: unknown) {
  return api<{ ok?: boolean }>(`/api/factory_lists/${encodeURIComponent(k)}`, { method: "POST", body: JSON.stringify(v) })
}
/** A PO line pulled out of a draft but kept to re-add later. */
export type SavedPOLine = POLine & { supplier?: string | null; savedAt?: string }
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
  variant?: string
  blank?: string // the catalog product this line resolves to (name/sku/id)
  line_id?: string // stable per-line id — keys identical-SKU siblings apart
  img?: string
  // The BUYER's uploaded artwork from a marketplace order (Etsy/Shopify), + any
  // personalization text they entered. Distinct from the factory-placed design in
  // order_designs — this is what the customer sent, to adopt or reference.
  design_src?: string
  personalization?: string
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
  /** Stored label file, so a label can be reprinted or batched after purchase. */
  tracking_label_url?: string | null
  /** When the label was actually put on paper — distinct from having bought one. */
  label_printed_at?: string | null
  /** The CARRIER's status, separate from factory_status. Ours ends at 'shipped'; this is
   *  what happens to the parcel afterwards. */
  delivery_status?: string | null
  delivery_detail?: string | null
  delivery_checked_at?: string | null
  carrier?: string | null
  timeline?: Array<{ status?: string; at?: string }> | null
  created_at?: string | null
  meta?: Record<string, unknown> | null
  items?: OrderItem[]
}

/** ONE order by id. Staff may read any; a seller only their own. Preferred over scanning
 *  getOrders(), which excludes orders by role/status and made a real order read as missing. */
export function getOrder(id: string) {
  return api<OrderRow & { error?: string }>(`/api/orders/${encodeURIComponent(id)}`)
}
export function getOrders() {
  return api<OrderRow[]>(`/api/orders`)
}

/** Staff: set ONE line item's factory_status (drives the production boards).
 *  Pass line_id whenever the item has one — sku alone can't address a marketplace line
 *  with a null sku, and moves identical-SKU siblings together. */
/** What the auto-push did when a line entered the design stage (see autoPushDesigns). */
export type AutoPushResult = { pushed: boolean; reason?: string; designId?: string; cardId?: number }
/** Stamp (or clear) a label as printed. */
/** Ask the carrier where a parcel is now. */
export function refreshTracking(id: string) {
  return api<{ ok?: boolean; status?: string | null; carrier_status?: string; detail?: string; error?: string }>(
    `/api/orders/${encodeURIComponent(id)}/refresh-tracking`, { method: "POST" })
}
export function markLabelPrinted(id: string, undo = false) {
  return api<{ ok?: boolean; label_printed_at?: string | null }>(`/api/orders/${encodeURIComponent(id)}/label-printed`, {
    method: "POST", body: JSON.stringify({ undo }),
  })
}
export function postItemStatus(id: string, sku: string, status: string, lineId?: string | null) {
  return api<{ ok?: boolean; error?: string; design?: AutoPushResult | null }>(`/api/orders/${encodeURIComponent(id)}/item-status`, {
    method: "POST",
    body: JSON.stringify({ sku, status, line_id: lineId ?? undefined }),
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
  /** The catalog blank to produce on — what pricing and the stock barcode key on. */
  blank?: string
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
// What this order costs the seller to produce: Σ(base cost × qty) + first item's
// shipping + ship_extra per additional unit. Priced by server/src/pricing.js — the SAME
// quote the charge uses, so what the seller is shown is what they're billed.
// `unpriced` lists items with no catalog match; those block submit (no cost = no price).
export type OrderQuote = {
  lines: { id: string; sku: string; name: string; qty: number; size: string | null; unitCost: number; shipFee: number }[]
  unpriced: { sku: string; name: string }[]
  fees: { ship_first: number; ship_extra: number }
  subtotal: number
  shipping: number
  units: number
  total: number
  charged: number
  balance: number
}
export function getOrderQuote(id: string) {
  return api<OrderQuote>(`/api/orders/${encodeURIComponent(id)}/quote`)
}

// Set a line item's variant picks (blank/colour/size/method). Keyed by line_id when
// available, else sku. Rejected (409) once the order is submitted — its cost is frozen.
export function postItemSetup(id: string, body: { line_id?: string; sku?: string; blank?: string; color?: string; size?: string; printType?: string; variant?: string }) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/item-setup`, {
    method: "POST", body: JSON.stringify(body),
  })
}

// Matched embroidery threads per line item, so the factory knows which cones to load.
export type OrderThreadRow = { sku: string; threads: { code: string; name: string; hex: string }[] }
export function getOrderThreads(id: string) {
  return api<OrderThreadRow[]>(`/api/orders/${encodeURIComponent(id)}/threads`)
}
export function postOrderThreads(id: string, sku: string, threads: { code: string; name: string; hex: string }[]) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/threads`, {
    method: "POST", body: JSON.stringify({ sku, threads }),
  })
}

export function getOrderDesigns(id: string) {
  return api<OrderDesign[] | { designs?: OrderDesign[] }>(`/api/orders/${encodeURIComponent(id)}/designs`)
}
export function postOrderDesign(id: string, body: { sku: string; data: string; name?: string; pos?: DesignPos; kind?: string; phash?: string | null }) {
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
// `escalated` marks an explicit "talk to a human" request so staff can tell it apart
// from ordinary chat; the server ignores the flag from staff senders.
export function postOrderMessage(id: string, text: string, opts?: { by?: string; role?: string; clientId?: string; escalated?: boolean }) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, role: opts?.role ?? "seller", by: opts?.by, clientId: opts?.clientId, escalated: opts?.escalated }),
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
// `escalated` = the seller asked for a human and no staffer has replied since.
export type SupportThread = { order_id: string; seller_id: string; seller_name: string | null; last: string; last_at: number; n: number; escalated?: boolean }
export function getSupportThreads() {
  return api<SupportThread[]>(`/api/support/threads`)
}
export function aiDraft(threadId: string) {
  return api<{ ok?: boolean; draft?: string; disabled?: boolean; error?: string }>(`/api/support/ai-draft`, { method: "POST", body: JSON.stringify({ threadId }) })
}
// Platform factory settings (design fee, default shipping, emb file price). Any staff can
// read; warehouse/admin write.
/** Platform-wide factory settings. The flat shipping bands (ship_cap / ship_heavy /
 *  ship_garment) and per-method surcharges (method_dtg / _dtf / _emb / _apl / _lsr) are
 *  admin-editable, so pricing policy changes without a deploy. The index signature keeps
 *  the method_* keys addressable by name from the settings form. */
export type FactorySettings = {
  design_fee?: number; ship_first?: number; ship_extra?: number; emb_price?: number
  ship_cap?: number; ship_heavy?: number; ship_garment?: number
  method_dtg?: number; method_dtf?: number; method_emb?: number; method_apl?: number; method_lsr?: number
  /** The warehouse's own return address, used as the label origin. Shared by the whole
   *  team — it used to live in each browser's localStorage, so it looked unsaved to
   *  everyone but the person who typed it. */
  [key: string]: number | undefined
} & {
  ship_from?: ShipFromAddress | null
  ship_from_complete?: boolean
  product_types?: ProductType[]
  /** The factory's own cone stock. Empty = fall back to the built-in starter palette. */
  thread_palette?: ThreadColor[]
}

/** One cone on the shelf: code (what you pull), name (what you call it), hex (what it looks like). */
export type ThreadColor = { code: string; name: string; hex: string }

/**
 * The cone stock. Readable by ANY signed-in user — the seller-side Design Maker
 * thread-matches too, and codes/names/colours carry no cost information. Writing goes
 * through setFactorySettings, which the server gates to warehouse/admin.
 */
export function getThreadPalette() {
  return api<ThreadColor[]>(`/api/thread_palette`)
}
/** A managed product type and the 2D mockup that represents the whole category. */
export const ALL_SIDES = ["front", "back", "left", "right", "sleeve", "hood", "inside", "wrap"] as const
export type ProductType = {
  name: string
  /** Which faces this category has — chosen once per type, inherited by every product in it. */
  sides?: string[]
  /** Positioning outline per side. Only sides that are ON carry one. */
  mockups?: Record<string, string>
  /** Legacy front-only field, kept in sync with mockups.front. */
  mockup?: string | null
}
export type ShipFromAddress = {
  name?: string; company?: string; street?: string; street2?: string
  city?: string; state?: string; zip?: string; country?: string
  phone?: string; email?: string
}
/** Types + category mockups, readable by any signed-in user (the seller Design Maker
 *  needs them to resolve a blank). Distinct from getFactorySettings, which is staff-only. */
export function getProductTypes() {
  return api<ProductType[]>(`/api/product_types`)
}
export function getFactorySettings() {
  return api<FactorySettings>(`/api/factory/settings`)
}
/** The numeric keys are addressed by name from the settings form, so the body stays
 *  loosely keyed — but the values are narrowed to what the route actually accepts. */
export function setFactorySettings(body: Record<string, number | ShipFromAddress | ProductType[] | ThreadColor[] | undefined>) {
  return api<FactorySettings & { ok?: boolean; error?: string }>(`/api/factory/settings`, { method: "PUT", body: JSON.stringify(body) })
}

// Update the signed-in user's profile (currently just the display name).
export function updateProfile(patch: { name?: string; username?: string | null; avatar_emoji?: string | null; avatar_color?: string | null; notify_sound?: boolean }) {
  return api<{ id?: string; name?: string; username?: string | null; email?: string; role?: string; avatar_emoji?: string | null; avatar_color?: string | null; error?: string }>(`/api/me`, {
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
  /** Stable per-line id. Two lines of the same SKU on one order (same product, different
   *  personalisation) are DIFFERENT jobs — without this they collapse into one card. */
  line_id?: string
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
/** Credit the designer who claimed a card. The SERVER decides who (and whether) —
 *  staff uploads aren't billable, and a shared board pays the claimer, not a pool. */
export function creditDesignCard(id: string | number, amount: number) {
  return api<{ ok?: boolean; credited?: boolean; account?: string; reason?: string; error?: string }>(
    `/api/design_cards/${encodeURIComponent(String(id))}/credit`,
    { method: "POST", body: JSON.stringify({ amount }) })
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

/** `colors`/`sizes` publish real Etsy variants, each carrying OUR sku — that sku comes
 *  back on the buyer's order line, which is how a variant resolves after the seller
 *  renames it on the marketplace. `variant_skus` must be saved onto the catalog product
 *  so the returned sku matches something. */
export function publishEtsy(body: { title: string; description?: string; price: number; quantity?: number; image: string; images?: string[]; tags?: string[]; taxonomy_id?: number | string; colors?: string[]; sizes?: string[]; sku_base?: string }) {
  return api<{ listing_id?: number; url?: string; error?: string; variants_applied?: number; variant_skus?: string[]; variants_error?: string | null }>(`/api/etsy/publish`, { method: "POST", body: JSON.stringify(body) })
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
  /** Server-converted USD price (fx.js). Null when no rate was available — show the
   *  original `price`/`currency` then rather than a made-up dollar figure. */
  price_usd?: number | null
  /** True when price_usd came from a conversion, so the UI can mark it approximate. */
  price_converted?: boolean
  /** Real variation price range, when the listing has variable pricing. `price` alone is
   *  a single figure that variations often override — a listing priced 38 can sell 19–30. */
  price_min?: number | null
  price_max?: number | null
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

/** Owner-only: change what a member may see. Scoped to the caller's own team server-side. */
export function updateTeamMember(id: number | string, patch: { permissions?: string[]; role?: string; status?: string }) {
  return api<{ ok?: boolean; error?: string }>(`/api/team/members/${encodeURIComponent(String(id))}`, {
    method: "PATCH", body: JSON.stringify(patch),
  })
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

// Am I someone's team MEMBER, and which surfaces did they share with me? `member:false`
// means I'm an owner (my own account) and see everything. Drives the seller sidebar so a
// member only sees the pages their leader turned on.
export type MyAccess = { member: boolean; ownerId?: string; role?: string; ownerName?: string; permissions: string[] | null }
export function getMyAccess() {
  return api<MyAccess>(`/api/team/my-access`)
}

// Invites addressed to ME that I haven't accepted. Until one is accepted the membership
// stays 'invited', my-access reports member:false, and NO permission limits apply — so
// this is the step that actually turns a leader's sharing toggles on.
export type MyInvite = {
  id: string; invite_token: string; role: string; permissions: string[]
  owner_id: string; owner_name: string; invited_at: string
}
export function getMyInvites() {
  return api<MyInvite[]>(`/api/team/my-invites`)
}
export function acceptInvite(token: string) {
  return api<{ ok?: boolean; error?: string; permissions?: string[] }>(
    `/api/team/accept/${encodeURIComponent(token)}`, { method: "POST" })
}

// ── Subscription billing ──────────────────────────────────────────────────────
// Plans are server truth (users.plan). Prices come from the server too — the client
// copy in lib/plans.ts is for display only, so a caller can never set its own price.
export type BillingPlan = {
  plan: string
  spydeck_addon: boolean
  renews_at: string | null
  auto_renew: boolean
  past_due_since: string | null
  // What the CURRENT paid month covers (null once it lapses) — the high-water tier bought
  // before renews_at. Lets the client price a change exactly as the server does: returning
  // to a tier this month already paid for costs $0.
  paid_plan: string | null
  paid_addon: boolean
  grace_days: number
  balance: number
  prices: { plans: Record<string, number>; spydeck_addon: number }
}
export function getBillingPlan() {
  return api<BillingPlan>(`/api/billing/plan`)
}
export type SubscribeResult = {
  ok?: boolean; plan?: string; spydeck_addon?: boolean; charged?: number
  renews_at?: string | null; balance?: number
}
/** 402 (ApiError) means the wallet can't cover it — the body carries the shortfall and
 *  the top-up methods that can fund it, so the caller offers a top-up rather than a dead end. */
export function subscribePlan(body: { plan?: string; spydeckAddon?: boolean; method?: string }) {
  return api<SubscribeResult>(`/api/billing/subscribe`, { method: "POST", body: JSON.stringify(body) })
}

/** Turn monthly renewal on/off. Off doesn't cancel now — the paid month runs out, then
 *  the plan lapses to Starter instead of charging again. */
export function setAutoRenew(on: boolean) {
  return api<{ ok?: boolean; auto_renew?: boolean; renews_at?: string | null }>(`/api/billing/auto-renew`, {
    method: "POST",
    body: JSON.stringify({ on }),
  })
}

// ── Inventory services (seller-owned stock in our warehouse) ──────────────────
// Kept separate from /api/inventory, which models stock WE own and has no owner column.
export type ConsignmentLine = {
  id: number
  shipment_id: string
  seller_sku: string | null
  internal_sku: string | null
  name: string | null
  variant: string | null
  qty_declared: number
  qty_received: number
  qty_reserved: number
  location: string | null
}
export type ConsignmentShipment = {
  id: string
  seller_id: string
  seller_name?: string | null
  status: string
  carrier: string | null
  tracking: string | null
  expected_at: string | null
  note: string | null
  received_at: string | null
  created_at: string
  lines: ConsignmentLine[]
}
export type WarehouseBin = { code: string; zone: string | null; capacity: number; note: string | null; used: number }
export type ConsignmentStock = {
  internal_sku: string | null; seller_sku: string | null; name: string | null; variant: string | null
  location: string | null; on_hand: number; reserved: number; seller_id: string; seller_name: string | null
}

export function getConsignmentShipments() {
  return api<ConsignmentShipment[]>(`/api/consignment/shipments`)
}
export function createConsignmentShipment(body: {
  carrier?: string; tracking?: string; expected_at?: string; note?: string; seller_id?: string
  lines: { seller_sku?: string; name?: string; variant?: string; qty_declared: number }[]
}) {
  return api<{ ok?: boolean; id?: string; error?: string }>(`/api/consignment/shipments`, { method: "POST", body: JSON.stringify(body) })
}
/** Count a shipment in: per-line received qty + bin. Mints the internal SKU server-side. */
export function receiveConsignment(id: string, lines: { id: number; qty_received: number; location?: string }[]) {
  return api<{ ok?: boolean; discrepancy?: boolean; lines?: ConsignmentLine[]; error?: string }>(
    `/api/consignment/shipments/${encodeURIComponent(id)}/receive`, { method: "POST", body: JSON.stringify({ lines }) })
}
export function getWarehouseBins() {
  return api<WarehouseBin[]>(`/api/consignment/locations`)
}
export function createWarehouseBin(body: { code: string; zone?: string; capacity?: number; note?: string }) {
  return api<{ ok?: boolean; code?: string; error?: string }>(`/api/consignment/locations`, { method: "POST", body: JSON.stringify(body) })
}
export function getConsignmentStock() {
  return api<ConsignmentStock[]>(`/api/consignment/stock`)
}
export function suggestBin(internalSku?: string | null, qty?: number) {
  const p = new URLSearchParams()
  if (internalSku) p.set("internal_sku", internalSku)
  if (qty) p.set("qty", String(qty))
  return api<{ location: string | null }>(`/api/consignment/suggest-bin?${p.toString()}`)
}

/** What one unit of a spec costs US to make + ship (same path that bills an order).
 *  Powers the margin readout when a seller sets a retail price. */
export type SpecQuote = {
  matched: { id: string; sku: string | null; name: string | null } | null
  unitCost: number | null
  shipping: number | null
  total: number | null
}
export function getSpecQuote(spec: { blank?: string; sku?: string; size?: string; printType?: string }) {
  const p = new URLSearchParams()
  if (spec.blank) p.set("blank", spec.blank)
  if (spec.sku) p.set("sku", spec.sku)
  if (spec.size) p.set("size", spec.size)
  if (spec.printType) p.set("printType", spec.printType)
  return api<SpecQuote>(`/api/pricing/spec?${p.toString()}`)
}

// ── Product templates ─────────────────────────────────────────────────────────
// Server-stored so the heavy composite previews don't fill localStorage. The list/delete
// queries were broken until recently (they filtered on a column that never existed), so
// nothing had ever read these back — this is the first client to.
export type ProductTemplate = {
  id: string
  name: string | null
  data: Record<string, unknown> | null
  composite: string | null
  layers: unknown[] | null
}
export function getTemplates() {
  return api<ProductTemplate[]>(`/api/templates`)
}
export function saveTemplate(body: { id: string; name?: string; data?: unknown; composite?: string; layers?: unknown }) {
  return api<{ ok?: boolean; id?: string; error?: string }>(`/api/templates`, { method: "POST", body: JSON.stringify(body) })
}
export function deleteTemplate(id: string) {
  return api<{ ok?: boolean }>(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** Backfill buyer addresses from the seller's Etsy CSV export — Etsy redacts them from
 *  the API but their own Shop Manager export still contains them. Matched by receipt id. */
export function importEtsyAddresses(rows: { order_id: string; name?: string; street?: string; street2?: string; city?: string; state?: string; zip?: string; country?: string }[]) {
  return api<{ ok?: boolean; updated: number; skipped: number; notFound: number; alreadyHad: number; missing?: string[]; rejected?: { order_id: string; why: string }[]; error?: string }>(
    `/api/etsy/import-addresses`, { method: "POST", body: JSON.stringify({ rows }) })
}

/** Optional automation of the CSV step: the seller exports from Etsy by hand (that
 *  download is behind their Shop Manager session — we never hold their credentials) and
 *  drops it into a link-shared Google Sheet, which the server re-reads hourly. */
export function getAddressSheet() {
  return api<{ url: string }>(`/api/etsy/address-sheet`)
}
export function setAddressSheet(url: string) {
  return api<{ ok?: boolean; url?: string; error?: string }>(`/api/etsy/address-sheet`, { method: "PUT", body: JSON.stringify({ url }) })
}
export function runAddressSheet() {
  return api<{ ok?: boolean; updated?: number; skipped?: string | number; notFound?: number; alreadyHad?: number; error?: string }>(
    `/api/etsy/address-sheet/run`, { method: "POST" })
}

/** The seller's unique inbound address for forwarding Etsy sale emails. */
export function getIngestAddress() {
  return api<{ token: string | null; address: string | null; configured: boolean }>(`/api/mail/ingest-address`)
}
