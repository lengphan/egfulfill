import { getToken } from "./auth"
import type { SiteContent } from "./site-content"

// Same-origin in production (Caddy reverse-proxies /api → Fastify). For local
// cross-origin dev against a running API, set NEXT_PUBLIC_API_BASE=http://localhost:3000.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? ""

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // The parsed error-response body, so callers can read fields beyond `error` (e.g. the
    // digitizer's `sample` debug payload) that would otherwise be lost when we throw.
    public body?: unknown
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/* ── Shared-list cache ────────────────────────────────────────────────────────
 *
 * A handful of endpoints are fetched by nearly every board, unchanged, on every mount:
 * /api/orders above all (the hub, the dispatch board, both dashboards), plus the catalog and
 * inventory the hub resolves blanks against. Four components mounting at once fired four
 * identical requests, and moving Orders → Board → Dashboard refetched the same list each
 * time — so you watched a skeleton for a list the browser had just finished loading.
 *
 * Two mechanisms, both small:
 *   · DE-DUPLICATION — concurrent callers share one in-flight promise. Always on; it cannot
 *     serve anything stale because there is only ever one request.
 *   · A SHORT TTL — a repeat read within the window skips the network entirely. This is what
 *     makes board-to-board navigation instant.
 *
 * Staleness is handled by invalidating rather than by guessing:
 *   · any non-GET through api() clears everything (see below) — blunt on purpose, because a
 *     rule that lists which endpoints a mutation affects is a rule that eventually misses one;
 *   · any live event or SSE reconnect clears it too (live.ts calls invalidateLists()).
 * So the window only ever elides a re-read of data that nothing has touched.
 *
 * Errors are never cached — a rejected load leaves the entry absent, so the next call retries.
 */
const _lists = new Map<string, { at: number; data: unknown }>()
const _listInflight = new Map<string, Promise<unknown>>()

/** Drop every cached list. Called on any write, and by live.ts on any server event. */
export function invalidateLists() { _lists.clear() }

async function cachedList<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = _lists.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T
  const flight = _listInflight.get(key) as Promise<T> | undefined
  if (flight) return flight
  const p = (async () => {
    const data = await load()
    _lists.set(key, { at: Date.now(), data })
    return data
  })()
  _listInflight.set(key, p)
  try { return await p } finally { _listInflight.delete(key) }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  // Anything that isn't a GET may have changed what a cached list holds. Clearing on EVERY
  // write — rather than mapping each mutation to the lists it touches — is deliberate: that
  // map would have to be updated by every future route, and the first time someone forgot,
  // the symptom would be a board showing an order state that no longer exists. The cost of
  // being blunt is one extra fetch after a write, which is the request that was happening
  // anyway before any of this existed.
  if (init.method && init.method.toUpperCase() !== "GET") invalidateLists()
  if (!res.ok) {
    let message = res.statusText
    let body: unknown
    try {
      body = await res.json()
      const b = body as { error?: unknown; message?: unknown }
      const err = b?.error ?? b?.message
      // Coerce non-string error bodies so they never render as "[object Object]".
      if (err != null) message = typeof err === "string" ? err : JSON.stringify(err)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, body)
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

/** P&L totals over the FULL ledger (not the 200-row window), grouped by ledger type.
 *  Factory reads revenue/costs/profit from this; a seller reads paid/deposits/refunds. */
export type WalletSummary = {
  revenue: number      // factory: order charges received
  paid: number         // seller: order charges paid
  deposits: number     // top-ups
  refundsIn: number    // seller: refunds received
  refundsOut: number   // factory: refunds paid back
  payouts: number      // withdrawals
  productCost: number  // COGS (blanks POs)
  postage: number      // labels
  design: number       // Pink Design
  dispatch: number     // byeastside pick fee
}
export type WalletResponse = {
  account: string
  balance: number
  ledger: LedgerRow[]
  summary?: WalletSummary
  /** The threshold the SERVER considers low, and whether this balance is under it.
   *  Sent with the balance so no client decides for itself what "low" means — two
   *  screens using different numbers is how one warns and the other stays quiet.
   *  Null for house accounts, which may run negative by design. */
  lowBelow?: number | null
  low?: boolean
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
  /** OUR short reference (EG000007) — what the wallet poll matches on. */
  note?: string
  /** The FULL transfer description as it reaches the bank. VietQR wraps our ref in a
   *  virtual-account prefix, so this is what the payer actually sees — showing `note`
   *  alone is why the description here didn't match the VietQR side. */
  content?: string
  amount?: number
  /** USD credited to the wallet once paid (VND ÷ rate). */
  amountUsd?: number
  /** Receiver, for the payer to check against their banking app before sending. */
  name?: string
  bankCode?: string
  account?: string
  vaAccount?: string
  error?: string
}

/** VN bank codes → display names. Falls back to the raw code rather than inventing one. */
export const VN_BANK_NAMES: Record<string, string> = {
  BIDV: "BIDV", MB: "MB Bank", VCB: "Vietcombank", TCB: "Techcombank", ACB: "ACB",
  VPB: "VPBank", TPB: "TPBank", VIB: "VIB", STB: "Sacombank", HDB: "HDBank",
  MSB: "MSB", SHB: "SHB", OCB: "OCB", SEAB: "SeABank", EIB: "Eximbank",
  VBA: "Agribank", ICB: "VietinBank", NAB: "Nam A Bank", ABB: "ABBANK",
}
// `amount` is VND (what the QR charges); `amountUsd` is the USD the seller picked, credited
// exactly on payment. The admin-set USD→VND rate (getVietqrRate) converts one to the other.
export function createVietqrPayment(amount: number, amountUsd?: number) {
  return api<VietqrPayment>(`/api/vietqr/create-payment`, {
    method: "POST",
    body: JSON.stringify({ amount, amountUsd }),
  })
}
// The shared USD→VND exchange rate + volume tiers (a better VND/$1 the more you add).
// GET is any signed-in user; PUT is admin-only.
export type VqrTier = { usd: number; rate: number }
// The full top-up config the Add Funds dialog runs on: the VietQR rate + volume tiers, the
// admin-set minimum (USD, applies to EVERY method), and the quick-amount presets.
export type TopupConfig = { rate: number; tiers: VqrTier[]; minUsd: number; smallPresets: number[]; bulkPresets: number[] }
export function getVietqrRate() {
  return api<TopupConfig>(`/api/vietqr/rate`)
}
export function setVietqrRate(
  rate: number,
  tiers?: VqrTier[],
  extra?: { minUsd?: number; smallPresets?: number[]; bulkPresets?: number[] },
) {
  return api<Partial<TopupConfig> & { ok?: boolean; error?: string }>(`/api/vietqr/rate`, { method: "PUT", body: JSON.stringify({ rate, tiers, ...extra }) })
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
  /** Cosmetic identity the person set on their own profile — same avatar as the topbar. */
  avatar_emoji?: string | null; avatar_color?: string | null; username?: string | null
  /** Lifetime order count and when the last order landed — the dormant-vs-active signal. */
  orders_total?: number; last_order_at?: string | null
  /** Set when this account is a MEMBER of someone else's team. */
  owner_id?: string | null
  owner_label?: string | null
  team_permissions?: string[] | null
  /** How many active members this account leads. 0 = not a team leader. */
  team_size?: number
  /** Wallet balance (sellers). Staff share the factory wallet, so theirs is always 0. */
  balance?: number
  /** Peak-season DAILY order limit for this seller. null = use the platform default. */
  order_limit?: number | null
  /** Orders this seller has created today — usage against the limit. */
  orders_today?: number
  /** Orders in the trailing 14 days — the "busiest first" sort key. */
  orders_14d?: number
}
/** The current seller's capacity status — information only, never blocks a submit. `mode` is
 *  the master switch; `over` is true only once today's count has reached the limit. limit:0
 *  means "nothing to show" (mode off or no limit set). */
export function getOrderLimitStatus() {
  return api<{ mode: boolean; limit: number; usedToday: number; over: boolean; notice: string | null }>(`/api/orders/limit-status`)
}
/** Whole-factory intake today — staff only. limit:0 = show as a plain count (no ceiling). */
export function getFactoryCapacity() {
  return api<{ mode: boolean; limit: number; usedToday: number }>(`/api/orders/factory-capacity`)
}
export function getUsers() {
  return api<AdminUser[]>(`/api/users`)
}
export function createUserAdmin(body: { email: string; password: string; role?: string; name?: string }) {
  return api<AdminUser & { error?: string }>(`/api/users`, { method: "POST", body: JSON.stringify(body) })
}
/** Manual balance adjustment by staff. Positive credits, negative debits. The reason is
 *  required — an unexplained movement in a money ledger is worse than no movement. */
/** The categories a person may book into. Read from the server so a picker can never
 *  offer something the route would reject. Admin/warehouse only. */
export function getEntryTypes() {
  return api<{ types: { id: string; label: string }[]; error?: string }>(`/api/wallet/entry-types`)
}

/**
 * Write one manual ledger row. Admin/warehouse only, enforced server-side.
 *
 * `delta` is signed: positive money in, negative money out. `ref` makes the write
 * idempotent on (account, type, ref) — the ledger is append-only, so a double-submit that
 * got through would be permanent and correctable only by a counter-entry.
 */
export function addLedgerEntry(body: {
  account: string; delta: number; type: string; note: string; ref?: string; partner?: string
}) {
  return api<{ ok?: boolean; balance?: number; duplicate?: boolean; error?: string }>(`/api/wallet/ledger`, {
    method: "POST", body: JSON.stringify(body),
  })
}

export function adjustBalance(body: { account: string; delta: number; note: string; ref?: string }) {
  return api<{ ok?: boolean; balance?: number; duplicate?: boolean; error?: string }>(`/api/wallet/ledger`, {
    method: "POST",
    body: JSON.stringify({ account: body.account, delta: body.delta, note: body.note, type: "adjust", ref: body.ref }),
  })
}
export function deleteUserAdmin(id: string) {
  return api<{ ok?: boolean; error?: string }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" })
}
/** Distribute the factory daily cap across active sellers, weighted by their recent volume,
 *  and apply each as their order_limit. Returns what it set. */
export function suggestOrderLimits() {
  return api<{ ok?: boolean; applied?: number; cap?: number; error?: string
               assignments?: { id: string; label: string; avgDaily: number; limit: number }[] }>(
    `/api/users/suggest-order-limits`, { method: "POST" })
}
export function updateUserAdmin(id: string, patch: { role?: string; password?: string; name?: string; active?: boolean; plan?: string; spydeck_addon?: boolean; order_limit?: number | null }) {
  return api<{ ok?: boolean; error?: string }>(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })
}

export type AuditRow = { id: number | string; ts: string; actor?: string | null; actor_email?: string | null; actor_name?: string | null; actor_role?: string | null; action: string; entity_type?: string | null; entity_id?: string | null; note?: string | null;
  /** State snapshots the audit row carries — a deleted card's title/payout survive here even
   *  though the card is gone, and a lane move records its from/to cols. Shape varies by action. */
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null }
/**
 * Everything that has happened to one order, newest first. Staff-readable (the unfiltered
 * admin log is separate) — an operator working an order needs its story.
 */
export function getOrderHistory(entityId: string) {
  return api<AuditRow[]>(`/api/audit/entity?entityId=${encodeURIComponent(entityId)}`)
}
export function getAudit(params?: { limit?: number; action?: string; cats?: string[]; q?: string; since?: string }) {
  const p = new URLSearchParams()
  if (params?.limit) p.set("limit", String(params.limit))
  if (params?.action) p.set("action", params.action)
  if (params?.cats && params.cats.length) p.set("cats", params.cats.join(","))
  if (params?.q) p.set("q", params.q)
  if (params?.since) p.set("since", params.since)
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

// ─────────────────────────── Payouts (manual seller withdrawals) ───────────────────────────
// A seller saves payout details once, then requests an amount; admin/warehouse pay it by
// hand and mark it Paid, which DEBITS the wallet. Mirror of top-ups, sign flipped.
export type PayoutMethod = {
  type?: string          // pingpong | lianlian | bank | vietqr | other
  account_name?: string
  account_id?: string    // PingPong/LianLian email or id
  account_number?: string
  bank_name?: string
  note?: string
  qr?: string            // uploaded VietQR image, as a data URL
}
export type PayoutRequest = {
  id: string
  seller_id?: string | null
  seller_name?: string | null
  seller_email?: string | null
  amount_usd: number | string
  method?: PayoutMethod | null
  note?: string | null
  status: "pending" | "paid" | "rejected" | string
  created_at: string
  resolved_at?: string | null
}
export function getPayoutMethod() {
  // `methods` is keyed by method type (pingpong | lianlian | bank) — each remembers its own
  // saved details so switching the dropdown prefills the right one.
  return api<{ methods: Record<string, PayoutMethod>; min: number; max: number; balance: number }>(`/api/payout/method`)
}
export function savePayoutMethod(info: PayoutMethod) {
  return api<{ ok?: boolean; methods?: Record<string, PayoutMethod>; error?: string }>(`/api/payout/method`, { method: "PUT", body: JSON.stringify({ info }) })
}
export function getPayoutRequests(status?: string) {
  return api<PayoutRequest[]>(`/api/payout/requests${status ? `?status=${encodeURIComponent(status)}` : ""}`)
}
export function createPayoutRequest(amount: number, note: string | undefined, method: PayoutMethod) {
  return api<PayoutRequest & { error?: string }>(`/api/payout/requests`, { method: "POST", body: JSON.stringify({ amount, note, method }) })
}
export function payPayout(id: string) {
  return api<PayoutRequest & { error?: string }>(`/api/payout/requests/${encodeURIComponent(id)}/pay`, { method: "POST" })
}
export function rejectPayout(id: string) {
  return api<PayoutRequest & { error?: string }>(`/api/payout/requests/${encodeURIComponent(id)}/reject`, { method: "POST" })
}

// ─────────────────────────── Catalog ───────────────────────────
// GET /api/catalog_products → the full product objects (lossless `data` jsonb).
// Field names mirror the static store, so keep this shape permissive.
/**
 * Publish/unpublish products in the shop-window catalogue. Separate from pricing on
 * purpose — choosing what to show and choosing what to charge are different decisions.
 */
export function setCatalogSelection(ids: string[], include: boolean) {
  return api<{ ok?: boolean; updated?: number; error?: string }>(`/api/catalog/selection`, {
    method: "POST", body: JSON.stringify({ ids, include }),
  })
}

/**
 * Set the catalogue price — one product explicitly, or a markup over cost across a set.
 *
 * This never touches base_price, which is what bills orders. The markup is computed
 * server-side from our supplier cost and only the result comes back, so neither the cost
 * nor the percentage crosses the wire.
 */
export function setCatalogPrice(body: { id: string; price: number | null }) {
  return api<{ ok?: boolean; catalogPrice?: number | null; error?: string }>(`/api/catalog/pricing`, {
    method: "POST", body: JSON.stringify(body),
  })
}
export function applyCatalogMarkup(ids: string[], markupPct: number) {
  return api<{ ok?: boolean; priced?: number; skippedNoCost?: string[]; error?: string }>(`/api/catalog/pricing`, {
    method: "POST", body: JSON.stringify({ ids, markupPct }),
  })
}

/** The download. A plain link rather than a fetch — the browser handles the file, and
 *  Content-Disposition names it. */
export function catalogExportUrl(all = false) {
  return `${API_BASE}/api/catalog/export${all ? "?all=1" : ""}`
}

/**
 * A supplier style, rolled up from the synced sku rows. `picked` is whether it's published.
 *
 * `maxCost` is OUR supplier cost and this route is staff-only — it exists so the markup
 * preview can show what a percentage produces, and it must never reach a seller surface.
 */
export type SupplierStyle = {
  source: string; ref: string; name?: string; brand?: string; category?: string
  image?: string; colors: string[]; sizes: string[]
  maxCost?: number | null; catalogPrice?: number | null; picked: boolean
}
export function getSupplierStyles(p: { q?: string; limit?: number; offset?: number } = {}) {
  const s = new URLSearchParams()
  if (p.q) s.set("q", p.q)
  s.set("limit", String(p.limit ?? 40))
  s.set("offset", String(p.offset ?? 0))
  return api<{ total: number; styles: SupplierStyle[] }>(`/api/catalog/supplier-styles?${s}`)
}
export function setCatalogPicks(refs: string[], include: boolean, source = "ss") {
  return api<{ ok?: boolean; added?: number; removed?: number; already?: number; error?: string }>(
    `/api/catalog/picks`, { method: "POST", body: JSON.stringify({ refs, include, source }) })
}
export function priceCatalogPicks(body: { refs?: string[]; markupPct?: number; ref?: string; price?: number | null }) {
  return api<{ ok?: boolean; priced?: number; skippedNoCost?: number; error?: string }>(
    `/api/catalog/picks/pricing`, { method: "POST", body: JSON.stringify({ ...body, source: "ss" }) })
}

/** One spread in the printed lookbook: hero shot, sizes, and every colourway with its
 *  own photo, name and sku. Shaped for a PAGE, not for an import — a flat variant list
 *  cannot be laid out. */
export type LookbookStyle = {
  ref: string; name: string; sku: string; description: string; brand: string
  image: string; price: number | null; sizes: string[]
  colors: { name: string; sku: string; image: string }[]
  /** Garment measurements from S&S, as generic name/value pairs per size — their /specs
   *  feed has no fixed columns, so a chart is pivoted from these rather than read. */
  specs: { size: string; order: string; spec: string; value: string }[]
}
export function getLookbook() {
  return api<{ styles: LookbookStyle[] }>(`/api/catalog/lookbook`)
}

/** A saved catalogue — what was in it and at what prices, on the day it was sent. */
export type CatalogExport = {
  id: string; createdAt: string; kind: string; title: string | null
  styleCount: number; by?: string | null
}
export function getCatalogExports() {
  return api<{ exports: CatalogExport[] }>(`/api/catalog/exports`)
}
export function saveCatalogExport(body: { styles: LookbookStyle[]; title?: string; kind?: string }) {
  return api<{ ok?: boolean; id?: string; title?: string; error?: string }>(`/api/catalog/exports`, {
    method: "POST", body: JSON.stringify(body),
  })
}
/** Reopen one. Returns the SNAPSHOT, never the live catalogue — reproducing what was sent
 *  is the whole reason it was kept. */
export function getCatalogExport(id: string) {
  return api<{ id: string; title: string | null; createdAt: string; styles: LookbookStyle[] }>(
    `/api/catalog/exports/${encodeURIComponent(id)}`)
}

/** What is currently IN the catalogue, from both sources. Read on every catalogue screen
 *  so the state is never something you have to open a preview to discover. */
export function getCatalogSummary() {
  return api<{ products: number; styles: number; total: number; unpriced: number }>(
    `/api/catalog/summary`)
}
export function clearCatalog() {
  return api<{ ok?: boolean; cleared?: number; error?: string }>(`/api/catalog/summary`, { method: "DELETE" })
}

export type CatalogProduct = {
  id?: string | number
  name?: string
  /** Published in the shop-window catalogue, and the price shown there. Distinct from
   *  base_price, which is what an order actually charges. */
  inCatalog?: boolean
  catalogPrice?: number | null
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
  //
  // `cost` is the PRODUCT cost — what the blank costs US from the supplier (filled by
  // S&S/Otto syncs). `price` is the BASE COST charged to the seller. Leave `price` blank
  // and pricing computes it as cost + the `base_markup` setting, so a supplier sync only
  // has to supply what it paid. A typed `price` always wins.
  sizePrices?: { size: string; price: number; shipping: number | null; cost?: number | null }[]
  /** Product cost for the whole product, when sizes don't differ. Same role as tier.cost. */
  productCost?: number | string | null
  /** Shipping physicals for label buying + the dim-weight check. Weight in ounces, box in
   *  inches. Dimensional weight (L×W×H÷166 lb) is compared against actual weight so the
   *  editor can flag a box that would be billed on size, not weight. */
  weightOz?: number | string | null
  boxL?: number | string | null
  boxW?: number | string | null
  boxH?: number | string | null
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
export type AiConfig = { keySet?: boolean; last4?: string | null; masked?: string | null; fromEnv?: boolean; model?: string; models?: AiModel[]; ok?: boolean; error?: string }
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

/** The blank catalog. Cached longer than the order list — it's reference data, and the only
 *  thing that changes it is a product edit, which is a write, which clears this. */
export function getCatalogProducts() {
  return cachedList("catalog_products", 120_000, () => api<CatalogProduct[]>(`/api/catalog_products`))
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
/** `styleName` and `partNumber` are what a person actually types — "18500", "00760".
 *  They're now fetched with the style list so a style NUMBER is searchable, not just its
 *  marketing title. */
export type SsStyle = { styleID: string; brand: string; title: string; category?: string; image: string | null; price: number | null; priceMax?: number | null; colors: SsColor[]; favorited?: boolean; styleName?: string; partNumber?: string
  /** Favourites carry these, joined from the synced skus. `synced: false` means the style
   *  has never been pulled — different from a style with no colours, and only one of those
   *  is fixed by pressing Sync. */
  sizes?: string[]; synced?: boolean; colorCount?: number }
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
/** Sync specific S&S styles from the live feed into ss_products — the per-style path, so a
 *  card whose data is missing or stale can be refreshed on its own instead of waiting on
 *  the hours-long full sync-all. The route requires styleIds (or brands); a bare call would
 *  be rejected, which is why this always sends them. */
export function ssSync(styleIds: string[]) {
  return api<{ ok?: boolean; synced?: number; fetched?: number; styles?: number; error?: string }>(
    `/api/ss/sync`, { method: "POST", body: JSON.stringify({ styleIds }) })
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

// ─────────────────── SanMar (SOAP supplier) ───────────────────
// Read services are live once SanMar has whitelisted the server's IP; ordering is a
// server-side dry run until SANMAR_ORDER_LIVE=1 (and the PO format is wired).
export type SanmarProduct = {
  style: string; title: string; brand: string; description?: string; status?: string
  color?: string; catalogColor?: string; size?: string; sizeIndex?: string; availableSizes?: string
  keywords?: string; inventoryKey?: string; uniqueKey?: string; caseSize?: number | null; pieceWeight?: number | null
  image: string | null; colorProductImage?: string | null; colorSquareImage?: string | null
  colorSwatchImage?: string | null; thumbnailImage?: string | null; brandLogoImage?: string | null; specSheet?: string | null
  piecePrice?: number | null; dozenPrice?: number | null; casePrice?: number | null; salePrice?: number | null; priceText?: string
  favorited?: boolean
}
export type SanmarWarehouseQty = { no: number; city: string; state: string; qty: number }
export type SanmarPriceRow = { style: string; color?: string; size?: string; inventoryKey?: string; sizeIndex?: string; piecePrice: number | null; dozenPrice: number | null; casePrice: number | null; salePrice: number | null; myPrice: number | null }
export function getSanmarStatus() {
  return api<{ configured?: boolean; stage?: boolean; base?: string }>(`/api/sanmar/status`)
}
export function getSanmarProducts(p: { style?: string; brand?: string; category?: string }) {
  const s = new URLSearchParams()
  if (p.style) s.set("style", p.style)
  if (p.brand) s.set("brand", p.brand)
  if (p.category) s.set("category", p.category)
  return api<{ total: number; items: SanmarProduct[]; error?: string }>(`/api/sanmar/products?${s.toString()}`)
}
export function getSanmarInventory(p: { style: string; color: string; size: string }) {
  const s = new URLSearchParams({ style: p.style, color: p.color, size: p.size })
  return api<{ style: string; color: string; size: string; total: number; warehouses: SanmarWarehouseQty[]; error?: string }>(`/api/sanmar/inventory?${s.toString()}`)
}
export function getSanmarPricing(p: { style: string; color?: string; size?: string }) {
  const s = new URLSearchParams({ style: p.style })
  if (p.color) s.set("color", p.color)
  if (p.size) s.set("size", p.size)
  return api<{ style: string; items: SanmarPriceRow[]; message?: string; error?: string }>(`/api/sanmar/pricing?${s.toString()}`)
}
export function getSanmarFavorites() {
  return api<{ favorites: { style: string; name: string | null; image: string | null; price: number | null }[] }>(`/api/sanmar/favorites`)
}
export function toggleSanmarFavorite(p: { style: string; name?: string; image?: string | null; price?: number | null }, on: boolean) {
  return api<{ ok?: boolean; favorited?: boolean; error?: string }>(`/api/sanmar/favorites`, { method: "POST", body: JSON.stringify({ ...p, on }) })
}
// A SanMar PO line: prefer inventoryKey+sizeIndex; else style + mainframe color + size.
export type SanmarOrderLine = { style?: string; color?: string; size?: string; inventoryKey?: string; sizeIndex?: string; qty: number }
export type SanmarShipTo = { company?: string; attention?: string; address1?: string; address2?: string; city?: string; state?: string; zip?: string; email?: string; method?: string; residence?: string }
// Inventory pre-check — safe, never places an order.
export function sanmarPresubmit(lines: SanmarOrderLine[], shipTo: SanmarShipTo, extra?: { poNumber?: string; orderRef?: string }) {
  return api<{ ok?: boolean; allAvailable?: boolean; message?: string; lines?: { style: string; color?: string; size?: string; whseNo?: string | null; available: boolean; message?: string }[]; error?: string }>(
    `/api/sanmar/presubmit`, { method: "POST", body: JSON.stringify({ lines, shipTo, ...extra }) })
}
// Place a PO. Dry-run on the server until SANMAR_ORDER_LIVE=1.
export function sanmarOrder(lines: SanmarOrderLine[], shipTo: SanmarShipTo, extra?: { poNumber?: string; orderRef?: string }) {
  return api<{ ok?: boolean; dryRun?: boolean; stage?: boolean; note?: string; missing?: string[]; poNumber?: string; message?: string; payload?: unknown; error?: string }>(
    `/api/sanmar/order`, { method: "POST", body: JSON.stringify({ lines, shipTo, ...extra }) })
}

// ── SanMar bulk catalog (imported SDL/EPDD file) — browsable/searchable like Otto ──
// One card per style; same field vocabulary as OttoStyle so the supplier feed renders it
// with the shared SupplierProductCard.
export type SanmarCatalogStyle = { style: string; brand?: string | null; name: string | null; description?: string | null; category?: string | null; price: number | string | null; price_max?: number | string | null; image: string | null; colors: string[] | null; sizes: string[] | null; qty?: number | null; favorited?: boolean }
export type SanmarCatalogVariant = { color: string | null; size: string | null; sku: string; inventoryKey: string | null; sizeIndex: string | null; price: number | null; image: string | null }
export type SanmarCatalogDetail = { style: string; name: string | null; brand?: string | null; category?: string | null; description?: string | null; price: number | null; image: string | null; colors: string[]; sizes: string[]; colorImages: Record<string, string>; variants: SanmarCatalogVariant[]; skus: string[]; error?: string }
export function getSanmarCatalog(p: { search?: string; limit?: number; offset?: number }) {
  const s = new URLSearchParams()
  if (p.search) s.set("search", p.search)
  if (p.limit != null) s.set("limit", String(p.limit))
  if (p.offset != null) s.set("offset", String(p.offset))
  return api<{ total: number; items: SanmarCatalogStyle[]; error?: string }>(`/api/sanmar/catalog?${s.toString()}`)
}
export function getSanmarCatalogStyle(style: string) {
  return api<SanmarCatalogDetail>(`/api/sanmar/catalog/${encodeURIComponent(style)}`)
}
export function getSanmarCatalogStatus() {
  return api<{ count: number; last: string | null; variants?: number }>(`/api/sanmar/catalog/status`)
}
// Re-read the SDL the server already holds on disk. This is the ONLY route that can carry the
// real catalog: SanMar_SDL_N.csv is ~195MB, over the API's 60MB body limit and far over
// Vercel's ~4.5MB proxy cap, so it can never be uploaded from the browser. Admin-only.
export function syncSanmarCatalog(file?: string) {
  return api<{ ok?: boolean; file?: string; variantRows?: number; styles?: number; imported?: number
               total?: number; seconds?: number; available?: string[]; error?: string; detail?: string }>(
    `/api/sanmar/import/local`, { method: "POST", body: JSON.stringify(file ? { file } : {}) })
}
// Import the SDL/EPDD file. Send its raw text ({ csv }) — the server parses it by column name.
export function importSanmarCatalog(csv: string) {
  return api<{ ok?: boolean; imported?: number; total?: number; error?: string }>(
    `/api/sanmar/import`, { method: "POST", body: JSON.stringify({ csv }) })
}

// ── Inventory (staff) — whole-array upsert: send the full list, missing SKUs are dropped ──
export type InventoryItem = { sku: string; name?: string | null; variant?: string | null; in_stock?: number; reserved?: number; reorder_at?: number; category?: string | null; supplier?: string | null; updated_at?: string }
/** Stock levels. Short window — a scan on the floor changes these, and a scan is a write,
 *  which clears the cache, so the window only ever elides a re-read while nothing has moved. */
export function getInventory() {
  return cachedList("inventory", 30_000, () => api<InventoryItem[]>(`/api/inventory`))
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
/** Remove a file from an order (staff only). The Design readiness tag reverts once it's
 *  gone; the server records it in the order's tag history and broadcasts a refresh. */
export function deleteDesignFile(designId: string) {
  return api<{ ok?: boolean; error?: string }>(`/api/design_files/${encodeURIComponent(designId)}`, { method: "DELETE" })
}

// ── Notifications ──
export type Notification = { id: number | string; type: string; title: string; body?: string | null; href?: string | null; entity_id?: string | null; read_at?: string | null; created_at: string }
/** The bell reads the top of this; the /notifications page pages through all of it —
 *  one channel per user, two views, so a role-targeted announcement lands in one place. */
export function getNotifications(limit = 20, opts?: { offset?: number; unreadOnly?: boolean }) {
  const s = new URLSearchParams({ limit: String(limit) })
  if (opts?.offset) s.set("offset", String(opts.offset))
  if (opts?.unreadOnly) s.set("unread", "1")
  return api<{ unread: number; total: number; notifications: Notification[] }>(`/api/notifications?${s}`)
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
// One quoted rate from the multi-carrier rate-shop. `token` is what you buy against.
export type ShippingRate = { token: string; provider: string; carrier: string; service: string; amount: number; currency?: string; days?: number | null }
export function getShippingRates(body: { to: ShipAddress; from?: ShipAddress; parcel: { weightOz?: number; length?: number; width?: number; height?: number }; extra?: { signature?: boolean; insurance?: number } }) {
  return api<{ rates: ShippingRate[]; errors?: string[]; error?: string }>(`/api/shipping/rates`, { method: "POST", body: JSON.stringify(body) })
}
// `rate`/`rateToken` buys a SPECIFIC carrier rate the operator picked; otherwise the body
// falls back to the USPS-cheapest path. Both record the label the same way.
export function buyUspsLabel(body: { to: ShipAddress; from: ShipAddress; weightOz?: number; length?: number; width?: number; height?: number; mailClass?: string; orderId?: string; directUsps?: boolean; signature?: boolean; insurance?: number; refNo?: string; refNo2?: string; contents?: string; rateToken?: string; rate?: { amount?: number; carrier?: string; service?: string } }) {
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
/** A purchase-order line. `sources` records WHICH ORDERS drove the quantity — an
 *  auto-replenished line of 150 is meaningless without knowing whether that's one urgent
 *  order or thirty small ones, and a line nobody can trace is one nobody can defend when
 *  the invoice arrives. */
export type POLine = {
  sku: string; name?: string; variant?: string; qty: number; price?: number
  auto?: boolean; sources?: { order: string; qty: number }[]
  /** Product thumbnail, captured when the line was picked. Supplier names differ by a
   *  single word, so the picture is what confirms the right sku was chosen. Lines without
   *  one (auto-replenished from inventory) resolve it by sku at render time. */
  image?: string | null
}

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
/** Place with S&S. `extra` carries the fields a real PO needs beyond sku+qty — the
 *  delivery address, shipping method, PO number and confirmation email. The endpoint has
 *  always accepted them; sending only lines is what made the orders incomplete. */
export function ssOrder(
  /** A line may name a warehouse. Splitting one sku across DCs is two lines with the same
   *  sku and different warehouseAbbr — the shape S&S expect. */
  lines: { sku: string; qty: number; warehouseAbbr?: string }[],
  extra: { shippingAddress?: unknown; shippingMethod?: string; email?: string; poNumber?: string
           paymentProfileId?: string; paymentProfileEmail?: string; requirePaymentProfile?: boolean
           /** MUST be false when any line names a warehouse — S&S ignore per-line
            *  warehouses while autoselect is on, and the server refuses that contradiction
            *  rather than letting the buyer's pick vanish silently. */
           autoselectWarehouse?: boolean } = {},
  live = false
) {
  return api<{ ok?: boolean; testOrder?: boolean; dryRun?: boolean; error?: string; detail?: unknown }>(
    `/api/ss/order`, { method: "POST", body: JSON.stringify({ lines, live, ...extra }) })
}
export function ottoOrder(
  items: { sku: string; qty: number }[],
  extra: { shipping_address?: unknown; billing_address?: unknown; shipping_method?: string
           payment_method?: string; customer_po?: string; customer?: string; contact?: string
           /** Otto have no saved cards — the card travels on every credit-card order. The
            *  server strips it from anything it echoes back, so it never reaches storage. */
           card_details?: { name: string; card_number: string; cvv: string; exp_date: string } } = {}
) {
  return api<{ ok?: boolean; dryRun?: boolean; error?: string; ottoResponse?: unknown }>(
    `/api/otto/order`, { method: "POST", body: JSON.stringify({ items, ...extra }) })
}

// Otto Cap has no live catalog API — we import their Product Data export into otto_products
// and browse from there (live price/stock still per-SKU via getOttoInventory).
export type OttoImportRow = { sku: string; style?: string; name?: string; description?: string; color?: string; size?: string; price?: string | number; image?: string; category?: string; brand?: string; data?: Record<string, unknown> }
export type OttoStyle = { style: string; brand?: string | null; name: string | null; description: string | null; price: number | string | null; price_max?: number | string | null; image: string | null; colors: string[] | null; sizes: string[] | null; skus: string[]; category: string | null; favorited?: boolean }
export function getOttoStatus() {
  return api<{ count?: number; last?: string | null }>(`/api/otto/products/status`)
}
export type OttoStyleDetail = { style: string; name: string; description: string | null; price: number | null; category: string | null; colors: string[]; sizes: string[]; colorImages: Record<string, string>; image: string | null; skus: string[]; variants?: OttoVariant[]; error?: string }
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
  /** Which design charge this line attracts, and where its quote stands. Null tier = nobody
   *  has judged it yet, which is deliberate: defaulting to `standard` would assert a
   *  difficulty call no human made, and that call is several times the money. */
  design_tier?: "standard" | "complex" | "supplied" | null
  design_quote_status?: "pending" | "accepted" | "declined" | null
  /** FROZEN at quote time. Settings can change between quoting and accepting, and the
   *  seller must be charged what they agreed to. */
  design_quote_make?: number | string | null
  design_quote_download?: number | string | null
  design_charged_at?: string | null
  qty?: number
  color?: string
  size?: string
  variant?: string
  blank?: string // the catalog product this line resolves to (name/sku/id)
  line_id?: string // stable per-line id — keys identical-SKU siblings apart
  img?: string
  /** Set by the ORDER LIST in place of an inlined base64 `img`: a cacheable URL serving the
   *  same bytes. getOrders() folds it back onto `img`, so nothing downstream reads this. */
  img_ref?: string
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
  profit?: number | string | null
  /** Who uploaded it — resolved server-side ONLY when it's the shop owner or one of their
   *  own team members (else null). Never a factory account. Used for the seller's history. */
  created_by_name?: string | null
  tracking?: string | null
  /** Stored label file, so a label can be reprinted or batched after purchase. */
  tracking_label_url?: string | null
  /** The order already has a machine file (.pes/.emb). Computed by the list query so the
   *  Design readiness tag can read "done" on a collapsed row without fetching every order's
   *  files. See orders.js. */
  has_machine_file?: boolean
  /** A design card exists on the board for this order (sent for review/check). */
  design_on_board?: boolean
  /** That design card has reached the APPROVED lane — the Design chip goes violet only then;
   *  before it (on the board, being checked) the chip stays amber. Staff list query only. */
  design_approved?: boolean
  /** When the label was actually put on paper — distinct from having bought one. */
  label_printed_at?: string | null
  /** Pre-scanned at dispatch — tracking is LIVE for the buyer even though the parcel may
   *  still be in production. Separate from factory_status on purpose; see orders.js. */
  label_scanned_at?: string | null
  /** How label_scanned_at was recorded: 'partner' (dispatch partner), 'in-house', 'carrier'. */
  scanned_via?: string | null
  /** Sent OUT to the dispatch partner (byeastside) — their PDF id is present once pushed, so
   *  this is the "already sent externally" flag. dispatch_pushed_at = when; dispatch_error =
   *  last push failure. The server skips a re-push; the UI uses this to lock re-sends. */
  dispatch_pdf_id?: string | null
  dispatch_pushed_at?: string | null
  dispatch_error?: string | null
  /** Who bought the label and their own reference for it. Recorded at purchase because
   *  the provider says it exactly once; without it a label can be neither voided nor put
   *  on a SCAN form. Null on anything bought before that was recorded. */
  label_provider?: string | null
  label_ref?: string | null
  label_carrier_account?: string | null
  /** On a USPS SCAN form. NOT a scan — the form is a document; the carrier scanning it at
   *  handover is a separate event that fills label_scanned_at. See manifests.js. */
  manifested_at?: string | null
  manifest_id?: string | null
  /** The CARRIER's status, separate from factory_status. Ours ends at 'shipped'; this is
   *  what happens to the parcel afterwards. */
  delivery_status?: string | null
  delivery_detail?: string | null
  delivery_checked_at?: string | null
  /** Carrier's own event times (not our poll time), filled by refreshTracking off the
   *  Shippo track response — the basis for fulfilment-speed metrics. delivered_at = when
   *  the parcel was delivered; est_delivery = the ETA frozen at first sighting. */
  delivered_at?: string | null
  est_delivery?: string | null
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
/** The order list, shared and briefly cached — see the cache note at the top of this file.
 *  Pass `{ force: true }` to bypass the window (a deliberate "refresh now" by a person). */
export async function getOrders(opts?: { force?: boolean }): Promise<OrderRow[]> {
  if (opts?.force) _lists.delete("orders")
  // Returned as a copy so a caller that sorts or splices in place can't corrupt the entry
  // every other board is about to read. The rows themselves are shared and treated as
  // immutable, which is how every consumer already handles them.
  return (await cachedList("orders", 30_000, loadOrders)).slice()
}

async function loadOrders() {
  const rows = await api<OrderRow[]>(`/api/orders`)
  // The list no longer inlines base64 thumbnails — it sends `img_ref`, a cacheable URL for
  // the same bytes (see the aggregate in orders.js; it was 74% of a 6MB response). Resolve
  // it back onto `img` HERE, at the API boundary, so every consumer — the avatars, the row
  // photo strip, the design canvas — keeps reading the one field it always has, and none of
  // them had to learn that the transport changed.
  for (const o of rows ?? []) {
    for (const it of o.items ?? []) if (!it.img && it.img_ref) it.img = `${API_BASE}${it.img_ref}`
  }
  return rows
}
/** Orders to suggest when "@"-tagging in a support thread — the THREAD's seller's orders,
 *  so it works for staff on a seller's inbox thread too (getOrders is caller-only). */
export function getOrderMentions(thread: string, q?: string) {
  const qs = q && q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""
  return api<{ orders?: OrderRow[]; error?: string }>(`/api/support/order-mentions?thread=${encodeURIComponent(thread)}${qs}`)
}
/** Teammates to suggest when "@"-mentioning a person (not everything is about an order).
 *  Mentioning one notifies them server-side. */
export type MentionPerson = { id: string; name: string; username: string | null; role: string }
export function getMentionPeople() {
  return api<{ people?: MentionPerson[] }>(`/api/support/mention-people`)
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

export function updateOrder(id: string, patch: { status?: string; factoryStatus?: string; tracking?: string; carrier?: string; meta?: Record<string, unknown> }) {
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
  /** Print-ready artwork URL for this line (persisted to order_items.design_src). */
  designSrc?: string
}
// %-coords for placing artwork on a mockup: center x/y, width w, rotation r (degrees).
export type DesignPos = { x: number; y: number; w: number; h?: number; r: number }
/** Artwork on one order LINE. `line_id` is the identity; `sku` is what rows saved before
 *  line tracking have, and is only a fallback. Look up as `map[line_id] ?? map[sku]`. */
export type OrderDesign = { sku?: string; line_id?: string | null; kind?: string; data?: string; name?: string; pos?: DesignPos | null }

/**
 * Index designs so both keys resolve. A line-keyed row is stored under its line_id AND
 * (as a fallback) its sku when no line-keyed row has claimed that sku yet.
 *
 * Two lines of the same SKU are different jobs, so keying on sku alone made the second
 * line's artwork overwrite the first in this map exactly as it did in the database.
 */
export function indexDesigns(list: OrderDesign[]): Record<string, OrderDesign> {
  const by: Record<string, OrderDesign> = {}
  // The sku slot holds ONLY unattributed rows. A line-keyed row is filed under its line and
  // nowhere else — deliberately, and this is the crux of the whole fix.
  //
  // Letting a line-keyed row also occupy the sku slot looks harmless and reintroduces the
  // exact bug: order with two lines of one sku, artwork on the first only. The second line
  // has no row of its own, falls back to the sku slot, finds its SIBLING's design and
  // renders it — so the tag reads "artwork attached" for a line that has none, and the
  // floor prints the wrong garment. A caught test, not a hypothetical.
  //
  // So the fallback can only ever reach a genuinely unattributed row, which is what it is
  // for: artwork saved before lines were tracked, where the sku is all we have.
  for (const d of list) if (!d?.line_id && d?.sku) by[d.sku] = d
  for (const d of list) if (d?.line_id) by[d.line_id] = d
  return by
}

/** The artwork for one line: its own, else whatever is filed under its SKU. */
export function designForLine(
  map: Record<string, OrderDesign> | undefined,
  line: { line_id?: string; sku?: string },
): OrderDesign | undefined {
  if (!map) return undefined
  return (line.line_id ? map[line.line_id] : undefined) ?? (line.sku ? map[line.sku] : undefined)
}
// What this order costs the seller to produce: Σ(base cost × qty) + first item's
// shipping + ship_extra per additional unit. Priced by server/src/pricing.js — the SAME
// quote the charge uses, so what the seller is shown is what they're billed.
// `unpriced` lists items with no catalog match; those block submit (no cost = no price).
export type OrderDesignFee = {
  line_id: string | null
  sku: string | null
  name: string | null
  tier: "supplied" | "standard" | "complex"
  /** e.g. "Check Fee (File Provided)", "Design Fee (New)", "Design Fee (Complex)" */
  label: string
  /** null = quoted, under review ("To Be Determined") — shown, never hidden. */
  amount: number | null
  status: "charged" | "estimated" | "tbd"
}
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
  /** Design/check fees per line — visible in the Summary; complex ones are TBD until accepted. */
  designFees?: { items: OrderDesignFee[]; total: number }
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

// ── Dispatch partner (byeastside) — label pre-scan ───────────────────────────
// Manual on purpose: a pre-scan starts the BUYER's tracking clock, so when it happens is
// a timing decision a person makes. Already-pushed orders are skipped, not re-sent.
export type DispatchStatus = {
  configured: boolean; base?: string
  awaiting_scan?: number; prescanned_not_shipped?: number; errored?: number
}
export type DispatchPushResult = {
  ok?: boolean; pushed?: number; skipped?: number; error?: string
  results?: { id: string; ok: boolean; already?: boolean; error?: string }[]
}
export function getDispatchStatus() {
  return api<DispatchStatus>(`/api/dispatch/status`)
}
export function pushToDispatch(orderIds: string[]) {
  return api<DispatchPushResult>(`/api/dispatch/push`, { method: "POST", body: JSON.stringify({ orderIds }) })
}
/**
 * Pull labels back OUT of the pre-scan queue — "we pushed 5, one got picked, we want the
 * other 4 back". Per order, because each push uploads its own PDF.
 *
 * `reason` per order: 'already-scanned' means the partner has picked it and the buyer's
 * tracking clock has started, so it genuinely can't be recalled. 'not-pushed' means it
 * was never there.
 */
export type DispatchCancelResult = {
  ok?: boolean
  cancelled?: number
  results?: { id: string; ok: boolean; reason?: string }[]
  error?: string
}
// ── Partner billing ───────────────────────────────────────────────────────────
// Neither partner can be charged through an API — both settle by invoice — so our
// ledger is what their bill gets reconciled against.
export type LedgerRowOut = {
  id: number | string; created_at: string; account: string
  partner: string | null; type: string; delta: number; ref: string | null; note: string | null
}
export type PartnerTotal = { partner: string; entries: number; total: number }

export function getLedgerPartners() {
  return api<PartnerTotal[]>(`/api/wallet/partners`)
}
export function getLedgerExport(p: { partner?: string; account?: string; type?: string; from?: string; to?: string }) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v) s.set(k, v)
  return api<{ count: number; total: number; rows: LedgerRowOut[] }>(`/api/wallet/export?${s}`)
}
/** CSV comes back as a file, so it bypasses the JSON client and downloads directly. */
export function ledgerExportUrl(p: { partner?: string; account?: string; type?: string; from?: string; to?: string }) {
  const s = new URLSearchParams({ format: "csv" })
  for (const [k, v] of Object.entries(p)) if (v) s.set(k, v)
  return `${API_BASE}/api/wallet/export?${s}`
}

/** `force` (admin only) clears our dispatch link even when the partner refuses the recall
 *  (e.g. a 500), for an order stuck amber that can't be pulled back the normal way. */
export function cancelDispatch(orderIds: string[], force = false) {
  return api<DispatchCancelResult>(`/api/dispatch/cancel`, { method: "POST", body: JSON.stringify({ orderIds, force }) })
}
export function syncDispatch() {
  return api<{ ok?: boolean; checked?: number; scanned?: number }>(`/api/dispatch/sync`, { method: "POST" })
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
/** Attach artwork to a LINE. Pass `line_id` — without it the design keys on sku alone
 *  and two lines of the same sku overwrite each other. */
export function postOrderDesign(id: string, body: { sku: string; line_id?: string; data: string; name?: string; pos?: DesignPos; kind?: string; phash?: string | null }) {
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
  /** True when the current user sent this message — used to pick the bubble side, since
   *  role alone can't tell "me" from a teammate in staff-to-staff channels. */
  me?: boolean
  text?: string
  ts?: number
  system?: boolean
  attachment?: unknown
  // Which order the message is about. Channels no longer fan out per order — an
  // @mention in the body sets this, and the order page filters on it.
  orderRef?: string
  // Staff-only (AI order briefings, internal notes). The server never sends these
  // to a seller; this flag only drives how staff see them.
  internal?: boolean
  // A pinned note in the private Workbench — rendered as a saved card, not a chat bubble.
  note?: boolean
}
export type SellerMatch = { seller_id: string; channel: string; name: string; email: string }
// Staff-only seller directory — start a channel with a seller who hasn't written in.
export function searchSellers(term: string) {
  return api<SellerMatch[]>(`/api/support/sellers?q=${encodeURIComponent(term)}`)
}
export function getOrderMessages(id: string) {
  return api<ChatEntry[]>(`/api/orders/${encodeURIComponent(id)}/messages`)
}
// POST reads b.text / b.role / b.by / b.clientId (idempotent by clientId). Sending
// `{body}` posts an EMPTY message — the server keys off `text`.
// `escalated` marks an explicit "talk to a human" request so staff can tell it apart
// from ordinary chat; the server ignores the flag from staff senders.
export type ChatAttachment = { url: string; name: string; mime: string; size?: number }
export function postOrderMessage(id: string, text: string, opts?: { by?: string; role?: string; clientId?: string; escalated?: boolean; note?: boolean; attachment?: ChatAttachment | null }) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, role: opts?.role ?? "seller", by: opts?.by, clientId: opts?.clientId, escalated: opts?.escalated, note: opts?.note, attachment: opts?.attachment ?? undefined }),
  })
}
/** Upload a chat attachment (data URL). Images are downsized client-side before this. Returns
 *  a same-origin proxy URL to store on the message. */
export function uploadChatAttachment(dataUrl: string, name: string) {
  return api<ChatAttachment & { error?: string }>(`/api/support/attachment`, {
    method: "POST", body: JSON.stringify({ dataUrl, name }),
  })
}

// Current user's id (sub) from the JWT — used to address the seller's own support thread.
export function getMe() {
  return api<{ sub?: string; role?: string; email?: string }>(`/api/me`)
}
// Ask the account-aware AI to reply in the seller's support thread. No-op server-side
// if ANTHROPIC_API_KEY isn't configured ({ ok:false, disabled:true }).
export type SupportAvailability = { open: boolean; hoursLabel: string; resumesLabel?: string; oooMessage?: string }
/** Is the support team within office hours right now? Drives the handoff copy. */
export function getSupportAvailability() {
  return api<SupportAvailability>(`/api/support/availability`)
}
// Admin-editable support hours + manual holiday closure, edited from the chat page.
export type SupportHoursConfig = {
  startH: number; endH: number; tzOffset: number; tzLabel: string; days: number[]
  ooo: { until: string | null; message: string }
}
export function getSupportHoursConfig() {
  return api<{ config: SupportHoursConfig; availability: SupportAvailability }>(`/api/support/hours-config`)
}
export function setSupportHoursConfig(config: SupportHoursConfig) {
  return api<{ ok?: boolean; config?: SupportHoursConfig; availability?: SupportAvailability; error?: string }>(
    `/api/support/hours-config`, { method: "PUT", body: JSON.stringify(config) })
}
export function requestAiReply() {
  // `escalated: true` means the thread has an OPEN human handoff — the assistant deliberately
  // stays quiet until a teammate replies, so there's no `reply`. `office` says whether the
  // team is in hours, so the client can show the right "in queue" vs "we're offline" copy.
  return api<{ ok?: boolean; reply?: string; disabled?: boolean; skipped?: boolean; escalated?: boolean; office?: SupportAvailability; error?: string }>(`/api/support/ai-reply`, {
    method: "POST",
    body: "{}",
  })
}
// Private Workbench: ask the personal AI. Reads ONLY the caller's own desk channel +
// their pinned notes. Same disabled/skipped/error shape as the support reply.
export function deskAiReply() {
  return api<{ ok?: boolean; reply?: string; disabled?: boolean; skipped?: boolean; error?: string }>(`/api/desk/ai-reply`, {
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
  designer_payout?: number; ship_first?: number; ship_extra?: number; emb_price?: number
  /** Seller payout guardrails. payout_max = 0 means "no fixed ceiling — balance is the cap". */
  payout_min?: number; payout_max?: number
  /** Seller-facing design charges. Exactly ONE of the three applies to a line, decided by
   *  where the machine file came from — see factory_settings.js. */
  design_fee_standard?: number; design_fee_complex?: number; check_fee?: number
  emb_price_complex?: number
  ship_cap?: number; ship_heavy?: number; ship_garment?: number
  method_dtg?: number; method_dtf?: number; method_emb?: number; method_apl?: number; method_lsr?: number
  /** The warehouse's own return address, used as the label origin. Shared by the whole
   *  team — it used to live in each browser's localStorage, so it looked unsaved to
   *  everyone but the person who typed it. */
  [key: string]: number | undefined
} & {
  ship_from?: ShipFromAddress | null
  ship_from_complete?: boolean
  /** Carriers the rate picker offers (comma-separated substrings, e.g. "usps,ups"). Empty = all. */
  enabled_carriers?: string
  /** Default Pink Design product type, applied to every push so the picker needn't appear per card. */
  pink_product_type?: string
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
/** Seller-safe: just the design fees a seller is charged (no cost/margin policy). Powers the
 *  fee estimate on the seller-side design canvas, where /api/factory/settings is off-limits. */
export type DesignFees = { standard: number; complex: number; check: number }
export function getDesignFees() {
  return api<DesignFees>(`/api/design_fees`)
}
/** The numeric keys are addressed by name from the settings form, so the body stays
 *  loosely keyed — but the values are narrowed to what the route actually accepts. */
export function setFactorySettings(body: Record<string, string | number | ShipFromAddress | ProductType[] | ThreadColor[] | undefined>) {
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
/**
 * Create a card that belongs to no order yet — artwork that arrived before the job did.
 *
 * Separate from the bulk board save on purpose: that endpoint replaces the whole board
 * from client state, so a create routed through it would race any other tab saving at the
 * same moment, and a just-uploaded design lost to someone else's stale board is not
 * recoverable.
 */
export function createDesignCard(body: { title: string; data?: string; type?: string; sku?: string }) {
  return api<DesignCard & { error?: string }>(`/api/design_cards/new`, {
    method: "POST", body: JSON.stringify(body),
  })
}

/**
 * Attach a card to an order line.
 *
 * Writes the artwork into the order's designs in the same request — setting the order id
 * alone would leave the order's design tag reading empty while the board claimed the work
 * was done, with both tables honestly reporting their own contents.
 */
export function assignDesignCard(id: string, body: { orderId: string; sku: string; lineId?: string }) {
  return api<{ ok?: boolean; orderId?: string; sku?: string; error?: string }>(
    `/api/design_cards/${encodeURIComponent(id)}/assign`,
    { method: "POST", body: JSON.stringify(body) })
}

/**
 * Which design charge a line attracts. Staff decide; `complex` opens a quote and charges
 * nothing until the seller accepts. The other two charge immediately, because setting them
 * IS the decision — there is no second party to ask.
 */
export type DesignTier = "standard" | "complex" | "supplied"
export function setDesignTier(orderId: string, body: { tier: DesignTier; line_id?: string; sku?: string }) {
  return api<{ ok?: boolean; tier?: string; quoted?: boolean
               charged?: { charged: number; reason?: string } | null; error?: string }>(
    `/api/orders/${encodeURIComponent(orderId)}/design-tier`,
    { method: "POST", body: JSON.stringify(body) })
}

/**
 * The seller answers a complex-work quote. Accepting charges the price FROZEN when it was
 * quoted, not today's setting — they agreed to a number and that is the number.
 *
 * Declining does not cancel the line. Cancelling moves money and that path already exists,
 * tested; a second, hastier refund is how the wrong amount gets paid.
 */
export function answerDesignQuote(orderId: string, body: { decision: "accept" | "decline"; line_id?: string; sku?: string }) {
  return api<{ ok?: boolean; decision?: string; charged?: number; already?: boolean
               needsTopup?: boolean; amount?: number; error?: string }>(
    `/api/orders/${encodeURIComponent(orderId)}/design-quote`,
    { method: "POST", body: JSON.stringify(body) })
}

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
  /** The claimer's resolved role (server-side, from the list query). Only a 'designer' is
   *  actually credited on approval, so the card uses this to avoid implying a payout that
   *  won't happen for an operator/warehouse/admin claim. */
  claimed_role?: string | null
  payment?: number | string | null
  pay_status?: string | null
  credited?: boolean // designer paid once on approval — guards against double-credit
  priority?: string | null
  is_emb?: boolean
  /** The linked machine file's id in design_file_data (an EMB card's .emb) — the reliable
   *  key for a stitch-file preview, since the file's order_id can be null. */
  design_id?: string | null
  emb_file_name?: string | null
  /** The card's seller (store, else name/email), resolved server-side from the order —
   *  shown as the name tag, and the reason an EMB card needn't read "Seller file". */
  seller_name?: string | null
  /** Where the design work happens. null/absent = our own designers. A value means it's
   *  OUTSOURCED to a partner (e.g. "pinkdesign") — our designers do embroidery, so DTG/DTF
   *  goes out. Outsourced cards can't be claimed by a designer and never pay one. */
  vendor?: string | null
  vendor_ref?: string | null
  /** Pink's internal task id (distinct from vendor_ref = ref_id). Shown on the card because
   *  their test-webhook form asks for both. */
  vendor_task_id?: string | null
  /** Notes previously posted to the partner's task. A running log kept apart from the
   *  description; the composer that wrote them was removed, but old entries persist. */
  partner_notes?: PartnerNote[]
  /** The exact image URLs sent to the partner on push — for a "this is what we sent"
   *  preview on the card. */
  pushed_images?: string[]
  /** Deliverable links the partner RETURNED via their webhook (often a Drive folder) — for
   *  a "Received from <partner>" section on the card. */
  vendor_files?: string[]
  /** How many design files are attached to this card's order (server-computed) — a
   *  quick-look count on the board tile. */
  file_count?: number
  customer?: string | null
  [k: string]: unknown // preserve extra columns (specs/files/notes/…) on round-trip
}
export function getDesignCards() {
  return api<DesignCard[]>(`/api/design_cards`)
}
/** The board's audit history — deletions, lane moves, credits, assignments — newest first.
 *  Warehouse + admin only (the server gates it), the same people who may delete a card. */
export function getDesignBoardHistory() {
  return api<AuditRow[]>(`/api/design_cards/history`)
}

/** A kanban lane. `system` lanes (incoming = fallback, approved = credits the designer)
 *  can be renamed but never deleted — the server enforces it too. */
export type DesignLane = { id: string; label: string; accent: string; sort: number; system: boolean }
export function getDesignLanes() {
  return api<DesignLane[]>(`/api/design_lanes`)
}
export function createDesignLane(body: { label: string; accent?: string }) {
  return api<DesignLane & { ok?: boolean; error?: string }>(`/api/design_lanes`, { method: "POST", body: JSON.stringify(body) })
}
export function renameDesignLane(id: string, body: { label?: string; sort?: number; accent?: string }) {
  return api<DesignLane & { ok?: boolean; error?: string }>(`/api/design_lanes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })
}
export function deleteDesignLane(id: string) {
  return api<{ ok?: boolean; deleted?: number; cards_moved?: number; error?: string }>(`/api/design_lanes/${encodeURIComponent(id)}`, { method: "DELETE" })
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
/**
 * Delete ONE card. Warehouse/admin only.
 *
 * Removal used to go through saveDesignCards — the whole board minus one card. Every
 * card carries a base64 thumb, so that payload gets very large, and if it failed the
 * delete never ran while the upserts had already succeeded: the card came back on
 * reload with no error shown. One id can't be too big to send and can't half-apply.
 */
export function deleteDesignCard(id: number | string) {
  return api<{ ok?: boolean; deleted?: number; error?: string }>(
    `/api/design_cards/${encodeURIComponent(String(id))}`, { method: "DELETE" })
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
export function renameDesignLibrary(id: number | string, name: string) {
  return api<LibraryDesign & { error?: string }>(`/api/design_library/${encodeURIComponent(String(id))}`, { method: "PATCH", body: JSON.stringify({ name }) })
}

// ── Wilcom EWA (embroidery) ──────────────────────────────────────────────────
// Credentials live in Settings › Integrations (WILCOM_APP_ID / WILCOM_APP_KEY) and never
// reach the browser; these only report whether it's set and whether a live call succeeds.
export type WilcomConfig = { configured: boolean; base?: string }
export function getWilcomConfig() {
  return api<WilcomConfig>(`/api/wilcom/config`)
}
export type WilcomTest = { ok?: boolean; status?: number; message?: string | null; sample?: string; error?: string }
export function testWilcomConnection() {
  return api<WilcomTest>(`/api/wilcom/test`, { method: "POST" })
}
// Auto-digitize: preview (TrueView + stitch count, no file) and digitize (+ machine file).
// `image` is a data URL; downscale to under 2MB client-side before sending.
export type WilcomResult = {
  ok?: boolean; error?: string; status?: number; sample?: string
  trueview?: string | null; machineFile?: { filename: string; base64: string } | null
  stitches?: number | null; colours?: number | null; width?: number | null; height?: number | null
  threads?: { r: number; g: number; b: number; code?: string | null; brand?: string | null; name?: string | null }[]
  id?: string; trueviewUrl?: string | null; fileUrl?: string | null
}
export function wilcomPreview(body: { image: string; filename?: string; width?: number; height?: number }) {
  return api<WilcomResult>(`/api/wilcom/preview`, { method: "POST", body: JSON.stringify(body) })
}
export function wilcomDigitize(body: { image: string; filename?: string; name?: string; orderRef?: string; source?: string; width?: number; height?: number }) {
  return api<WilcomResult>(`/api/wilcom/digitize`, { method: "POST", body: JSON.stringify(body) })
}
/** TrueView PNG for an already-uploaded .emb, by order+sku (or design id). `unavailable`
 *  (Wilcom off / not a native .emb) is a normal outcome — the caller keeps its placeholder. */
export type EmbPreviewResult = { ok: boolean; png?: string; stitches?: number | null; colours?: number | null; unavailable?: boolean; error?: string }
export function getEmbPreview(body: { orderId?: string | null; sku?: string | null; designId?: string }) {
  return api<EmbPreviewResult>(`/api/wilcom/design-preview`, { method: "POST", body: JSON.stringify(body) })
}
export type WilcomGeneration = {
  id: string; name?: string | null; order_ref?: string | null; source?: string | null; type?: string | null
  stitches?: number | null; colours?: number | null; width?: number | null; height?: number | null
  formats?: string[] | null; trueview_url?: string | null; file_url?: string | null; created_at?: string
}
export function getWilcomGenerations() {
  return api<{ generations: WilcomGeneration[] }>(`/api/wilcom/generations`)
}
// Maker — lettering: alphabet list, fast preview, and generate-to-file.
export function getWilcomAlphabets() {
  return api<{ alphabets: string[] }>(`/api/wilcom/alphabets`)
}
export function wilcomLetteringPreview(body: { text: string; alphabet: string; height?: number; color?: string }) {
  return api<WilcomResult>(`/api/wilcom/lettering-preview`, { method: "POST", body: JSON.stringify(body) })
}
export function wilcomLettering(body: { text: string; alphabet: string; height?: number; color?: string }) {
  return api<WilcomResult>(`/api/wilcom/lettering`, { method: "POST", body: JSON.stringify(body) })
}
// Create — image + lettering combined into ONE design (prototype). image and/or text may be
// omitted; the server delegates to the proven single-mode path when only one is present, and
// attempts the combined recipe when both are. `sample` is the raw EWA body on a combine
// failure, kept so the recipe can be iterated against a live account.
/** Move (x/y mm), resize (scale ×), rotate (angle°) for a decoration in the combined design. */
export type WilcomTransform = { x: number; y: number; scale: number; angle: number }
// EWA-native decoration transform (apiguide.wilcom.com …/transform/): dx/dy = mm from the
// location's top-left (+y down), rotation° clockwise, scale hard-limited to 0.8–1.2, mirror.
export type WilcomEwaTransform = { dx: number; dy: number; rotation: number; scale: number; mirror: "none" | "horizontal" | "vertical" | "both" }
// One entry per element in the design, in stitch order (later = on top). An image layer
// carries its base64 to auto-digitize server-side; the text layer's content rides in `text`.
export type WilcomComboLayer =
  | { kind: "image"; image: string; name?: string; targetWidthMm?: number; transform?: WilcomEwaTransform }
  | { kind: "text"; transform?: WilcomEwaTransform }
export type WilcomComboBody = { layers?: WilcomComboLayer[]; image?: string; text?: string; alphabet?: string; height?: number; color?: string; filename?: string; name?: string; orderRef?: string; designTransform?: WilcomTransform; letterTransform?: WilcomTransform }
export function wilcomCombinePreview(body: WilcomComboBody) {
  return api<WilcomResult>(`/api/wilcom/combine-preview`, { method: "POST", body: JSON.stringify(body) })
}
export function wilcomCombine(body: WilcomComboBody) {
  return api<WilcomResult>(`/api/wilcom/combine`, { method: "POST", body: JSON.stringify(body) })
}
export function deleteDesignLibrary(id: number | string) {
  return api<{ ok?: boolean }>(`/api/design_library/${encodeURIComponent(String(id))}`, { method: "DELETE" })
}

// ── Integration usage / spend meter ─────────────────────────────────────────────
// Per-platform API call volume + estimated $ (from an admin per-call rate), plus the REAL
// ledgered costs already in wallet_ledger (postage, blanks, …). Read-only dashboard: monthly
// $ thresholds only alert, never throttle.
export type UsagePlatform = { key: string; label: string; calls: number; errors: number; estDollars: number; estMonthlyDollars: number; costPerCallCents: number; monthlyLimitDollars: number; pct: number | null; over: boolean }
export type UsageLedgerCat = { type: string; label: string; dollars: number; count: number }
export type UsageSummary = { days: number; platforms: UsagePlatform[]; ledgered: UsageLedgerCat[]; totals: { calls: number; estDollars: number; ledgeredDollars: number; alerts: string[] } }
export function getUsageSummary(days = 30) {
  return api<UsageSummary>(`/api/usage/summary?days=${days}`)
}
export function setUsageConfig(body: { platform: string; costPerCallCents?: number; monthlyLimitCents?: number }) {
  return api<{ ok: boolean; config: { costPerCallCents?: number; monthlyLimitCents?: number } }>(`/api/usage/config`, { method: "POST", body: JSON.stringify(body) })
}

// ── Design maker: the seller's reusable Images library ──────────────────────────
// Two sources, both scoped server-side to the caller. "Your uploads" are stored (R2 +
// a row); "order uploads" are buyer art referenced by URL off the seller's own orders.
export type SellerImage = { id: string; url: string; name: string; ts?: number }
export function getSellerImages() {
  return api<{ images: SellerImage[] }>(`/api/design/images`)
}
export function uploadSellerImage(data: string, name?: string) {
  return api<{ ok?: boolean; image?: SellerImage; error?: string }>(`/api/design/images`, {
    method: "POST", body: JSON.stringify({ data, name }),
  })
}
export function deleteSellerImage(id: string) {
  return api<{ ok?: boolean }>(`/api/design/images/${encodeURIComponent(id)}`, { method: "DELETE" })
}
export type OrderUpload = { url: string; orderRef: string; name: string }
export function getOrderUploads() {
  return api<{ images: OrderUpload[] }>(`/api/design/order-uploads`)
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
  store?: string
  meta?: Record<string, unknown>
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
export function signupUser(body: { email: string; username?: string; password: string; name?: string; store_name?: string }) {
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
export type SecretMeta = { name: string; label: string; integration: string; set: boolean; last4: string | null; masked?: string | null; editable?: boolean }
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
  /** The import window this shop was connected with, in days (0 = today, null = a connection
   *  made before the chooser existed). The chooser reads it to grey out anything narrower —
   *  the window ratchets, and backfill.js enforces that server-side regardless. */
  backfill_days?: number | null
  /** The earliest order actually held for this channel. The chooser's fallback floor when
   *  backfill_days is null: history that exists is proof of how far back this shop imported,
   *  even when nothing recorded the window that produced it. */
  oldest_order_at?: string | null
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
/**
 * Publish a draft listing.
 *
 * The `blank`/`design*`/`printType`/`color`/`size` fields are what make the resulting
 * ORDER produceable: the server records them on published_listings, and order sync reads
 * that row back to attach the artwork and name the blank. They were absent here while the
 * server read them all, so every published listing stored NULLs and its orders arrived
 * anonymous — priced only by luck (variant sku match) and unable to reach the Design
 * board at all, because a line with no artwork can't be sent to a designer.
 */
export function publishEtsy(body: { title: string; description?: string; price: number; quantity?: number; image: string; images?: string[]; tags?: string[]; taxonomy_id?: number | string; colors?: string[]; sizes?: string[]; sku_base?: string; size_prices?: Record<string, number>; blank?: string; designId?: string | number; designUrl?: string; designPos?: unknown; printType?: string; color?: string; size?: string }) {
  return api<{ listing_id?: number; url?: string; error?: string; variants_applied?: number; variant_skus?: string[]; variants_error?: string | null }>(`/api/etsy/publish`, { method: "POST", body: JSON.stringify(body) })
}
export function getEtsyConnections() {
  return api<EtsyConnection[]>(`/api/etsy/connections`)
}

// ─────────────────── Publish to TikTok Shop ───────────────────
// TikTok's Create Product needs a few fields Etsy doesn't: a LEAF category, a warehouse for
// per-SKU inventory, and a package weight. The publish route is DRY-RUN until the server's
// TIKTOK_PUBLISH_LIVE flag is set — a dry run returns the assembled `payload` for review.
export type TiktokCategory = { id: string; local_name?: string; is_leaf?: boolean; parent_id?: string; permission_statuses?: string[] }
export type TiktokWarehouse = { id: string; name?: string; type?: string; sub_type?: string }
export function getTiktokCategories(keyword?: string) {
  const qs = keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""
  return api<{ categories?: TiktokCategory[]; error?: string }>(`/api/tiktok/categories${qs}`)
}
export function getTiktokWarehouses() {
  return api<{ warehouses?: TiktokWarehouse[]; error?: string }>(`/api/tiktok/warehouses`)
}
export function publishTiktok(body: {
  title: string; description?: string; price: number; quantity?: number
  images?: string[]; tags?: string[]
  colors?: string[]; sizes?: string[]; sku_base?: string; size_prices?: Record<string, number>
  category_id: string; warehouse_id: string; package_weight: string | number; weight_unit?: string
  brand_id?: string; currency?: string; save_mode?: "AS_DRAFT" | "LISTING"
  blank?: string; designId?: string | number; designUrl?: string; designPos?: unknown; printType?: string; method?: string
}) {
  return api<{
    ok?: boolean; product_id?: string | null; skus?: unknown[]; warnings?: { message?: string }[]
    dryRun?: boolean; note?: string; missing?: string[]; wouldUploadImages?: number; payload?: unknown; error?: string
  }>(`/api/tiktok/publish`, { method: "POST", body: JSON.stringify(body) })
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
  /** Etsy's 300x300 variant, for grid cards. `image` (570px) is for the publish flow. */
  thumb?: string | null
  images?: string[]
  views: number | null
  num_favorers?: number | null
  created?: number | null // unix seconds — listing age drives the sales estimates
  tags?: string[] // Etsy listing tags (up to 13) — keyword research
  shop_name: string | null
  shop_id?: string | null // the shop that listed it — lets a card jump into that shop's catalog
}
// SpyDeck saved/favorited research listings (server-authoritative, per seller).
export type SavedListing = EtsyListing & { saved_at?: string }
export function getSpydeckSaves() {
  return api<SavedListing[]>(`/api/spydeck/saves`)
}
// Daily trending feed (server-cached) — auto-populates SpyDeck without a search.
// `built_at`/`offset` come back so the client can reason about the shared pool; `rebuilt`
// marks a response from a fresh Etsy scan (POST /rebuild) vs a free reshuffle.
export type TrendingFeed = { date?: string; products?: EtsyListing[]; keywords?: string[]; error?: string; built_at?: string | null; offset?: number; rebuilt?: boolean }
/** The heavy half of ONE listing (description + full images), served from the day's
 *  cached pool. Kept out of the grid payload, which ships 120 rows. */
export function getSpydeckListingDetail(id: number | string) {
  return api<{ listing_id: number; description: string; images: string[] }>(
    `/api/spydeck/listing/${encodeURIComponent(String(id))}/detail`)
}
// `seed` (a "More ideas" click) reshuffles the cached pool server-side — FREE, no Etsy call.
export function getSpydeckTrending(seed = 0) {
  return api<TrendingFeed>(`/api/spydeck/trending${seed ? `?seed=${seed}` : ""}`)
}
// Fresh scan — re-hits Etsy to rebuild the shared pool from new niches. Rate-limited
// server-side (429 with a friendly reason: global 30-min lock, seller once/2-days, 20/day cap).
export function rebuildSpydeckTrending(seed = 0) {
  return api<TrendingFeed & { retryInMs?: number; nextAt?: string; dailyCapped?: boolean }>(
    `/api/spydeck/trending/rebuild${seed ? `?seed=${seed}` : ""}`, { method: "POST" })
}
// Admin-editable nav visibility (HIDE-only): role -> hidden surface keys. Readable by any
// signed-in user (so their nav filters); writable admin-only (enforced server-side).
export type NavVisibilityMap = Partial<Record<string, string[]>>
export function getNavVisibility() {
  return api<{ hidden: NavVisibilityMap }>(`/api/nav_visibility`)
}
export function putNavVisibility(hidden: NavVisibilityMap) {
  return api<{ ok?: boolean; hidden?: NavVisibilityMap; error?: string }>(`/api/nav_visibility`, {
    method: "PUT", body: JSON.stringify({ hidden }),
  })
}

// ── Competitor STORE research ────────────────────────────────────────────────
export type SpyShop = {
  shop_id: string; shop_name: string | null; title: string | null; url: string | null;
  icon: string | null; listings: number | null; favorers: number | null;
  reviews: number | null; rating: number | null; sales: number | null;
  since?: number | null; saved_at?: string;
}
export function searchSpydeckShops(q: string) {
  return api<{ shops?: SpyShop[]; error?: string }>(`/api/spydeck/shops?q=${encodeURIComponent(q)}`)
}
export function getSpydeckShop(id: string | number) {
  return api<{ shop?: SpyShop; error?: string }>(`/api/spydeck/shops/${encodeURIComponent(String(id))}`)
}
export function getSpydeckShopsByCategory(taxonomyId: string) {
  return api<{ shops?: SpyShop[]; error?: string }>(`/api/spydeck/shops/by-category?taxonomyId=${encodeURIComponent(taxonomyId)}`)
}
export function getSpydeckShopListings(id: string | number, offset = 0) {
  return api<{ listings?: EtsyListing[]; count?: number; error?: string }>(
    `/api/spydeck/shops/${encodeURIComponent(String(id))}/listings?offset=${offset}&limit=48`)
}
export function getSpydeckSavedShops() {
  return api<{ shops?: SpyShop[] }>(`/api/spydeck/shops/saved`)
}
export function saveSpydeckShop(shop: SpyShop) {
  return api<{ ok?: boolean; error?: string }>(`/api/spydeck/shops/saved`, {
    method: "POST", body: JSON.stringify({ shop_id: shop.shop_id, data: shop }),
  })
}
export function unsaveSpydeckShop(shopId: string) {
  return api<{ ok?: boolean; error?: string }>(`/api/spydeck/shops/saved/${encodeURIComponent(shopId)}`, { method: "DELETE" })
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

// ─────────────────── Outbound webhooks ───────────────────
// Routes accept the dashboard JWT or an API key; from the app we use the JWT.
export type WebhookEndpoint = { id: number; url: string; events: string[]; active: boolean; created_at?: string }
export type WebhookDelivery = { id: number; event: string; status_code: number | null; error: string | null; attempts: number; created_at: string }
/** The secret comes back ONCE, on create, and is never listed again. */
export type WebhookCreated = WebhookEndpoint & { secret: string; error?: string }
export type WebhookTestResult = { ok?: boolean; event?: string; url?: string; status_code?: number | null; attempts?: number; error?: string | null; hint?: string }

export function getWebhooks() {
  return api<WebhookEndpoint[]>(`/api/webhooks`)
}
export function createWebhook(url: string, events: string[]) {
  return api<WebhookCreated>(`/api/webhooks`, { method: "POST", body: JSON.stringify({ url, events }) })
}
export function deleteWebhook(id: number | string) {
  return api<{ ok?: boolean }>(`/api/webhooks/${encodeURIComponent(String(id))}`, { method: "DELETE" })
}
/** Fires a sample event and WAITS — the response says whether it actually landed. */
export function testWebhook(id: number | string, event?: string) {
  return api<WebhookTestResult>(`/api/webhooks/${encodeURIComponent(String(id))}/test`, {
    method: "POST", body: JSON.stringify(event ? { event } : {}),
  })
}
export function getWebhookDeliveries(id: number | string) {
  return api<WebhookDelivery[]>(`/api/webhooks/${encodeURIComponent(String(id))}/deliveries`)
}
export const WEBHOOK_EVENTS = ["order.received", "order.status_changed", "order.shipped", "order.cancelled"] as const

// Research listings already turned into a draft of our own — the Uploaded tab. Held on
// the server, not in React state: a refresh used to empty the tab and offer "Make
// product" again for something already published, which is how a shop collects
// duplicate drafts.
export type UploadedListing = EtsyListing & { uploaded_at?: string; our_listing_id?: string; our_url?: string }
export function getSpydeckUploads() {
  return api<UploadedListing[]>(`/api/spydeck/uploads`)
}
export function recordSpydeckUpload(listing: EtsyListing, our?: { listing_id?: number | string; url?: string }) {
  return api<{ ok?: boolean; error?: string }>(`/api/spydeck/uploads`, {
    method: "POST",
    body: JSON.stringify({
      listing_id: String(listing.listing_id), data: listing,
      our_listing_id: our?.listing_id != null ? String(our.listing_id) : undefined,
      url: our?.url,
    }),
  })
}
export function deleteSpydeckUpload(listingId: number | string) {
  return api<{ ok?: boolean }>(`/api/spydeck/uploads/${encodeURIComponent(String(listingId))}`, { method: "DELETE" })
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
export function exchangeShopify(body: { shop: string; code: string; params: Record<string, string>; backfill_days?: number }) {
  return api<{ shop_name?: string; error?: string }>(`/api/shopify/exchange`, { method: "POST", body: JSON.stringify(body) })
}
export function disconnectShopify(shopId: string) {
  return api<{ ok: boolean }>(`/api/shopify/connections/${encodeURIComponent(shopId)}`, { method: "DELETE" })
}
export function syncShopify() {
  return api<{ ok?: boolean; synced?: unknown[]; error?: string }>(`/api/shopify/sync`, { method: "POST" })
}

/**
 * Finish a TikTok Shop connection.
 *
 * TikTok returns `auth_code`, NOT the `code` every other provider uses — which is why the
 * React callback rejected TikTok outright before this existed: its `if (!code)` guard
 * fired first and the flow died on "No authorization code returned". The server accepts
 * either name, so this sends the one TikTok actually gave us.
 *
 * Authenticated, like the Etsy and Shopify exchanges: the shop attaches to an account, so
 * it cannot complete while signed out.
 */
export function exchangeTiktok(body: { auth_code: string; backfill_days?: number }) {
  return api<{ ok?: boolean; shop_id?: string; shop_name?: string; scopes?: string; error?: string }>(
    `/api/tiktok/exchange`, { method: "POST", body: JSON.stringify(body) })
}
export type TiktokConfig = { service_id: string; authorize_url: string; region?: string; configured: boolean }
export function getTiktokConfig() {
  return api<TiktokConfig>(`/api/tiktok/config`)
}
export function getTiktokConnections() {
  return api<EtsyConnection[]>(`/api/tiktok/connections`)
}
export function disconnectTiktok(shopId: string) {
  return api<{ ok?: boolean }>(`/api/tiktok/disconnect`, { method: "POST", body: JSON.stringify({ shop_id: shopId }) })
}
export function syncTiktok() {
  return api<{ ok?: boolean; imported?: number; synced?: unknown[]; error?: string }>(`/api/tiktok/sync`, { method: "POST" })
}
/** The label TIKTOK generated for a platform-shipped order (not one we bought).
 *  UNVERIFIED against a live order — no TikTok order has synced yet, so the response shape
 *  is what the docs describe, not what we've seen. Errors are surfaced, never swallowed. */
export function getTiktokLabel(orderId: string) {
  return api<{ ok?: boolean; shipping_type?: string | null; documents?: { package_id: string; url: string }[]; error?: string }>(
    `/api/tiktok/orders/${encodeURIComponent(orderId)}/label`)
}

export function exchangeEtsy(body: { code: string; code_verifier: string; redirect_uri: string; backfill_days?: number }) {
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
  /** Last 4 chars of the key (null for keys created before this was stored). */
  last4?: string | null
  mode: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export function getApiKeys() {
  return api<{ keys: ApiKey[] }>(`/api/keys`)
}

export function createApiKey(label: string, mode: "test" | "live" = "test") {
  return api<{ id: number | string; key: string; prefix: string; last4?: string | null; label: string; mode: string; created_at: string }>(
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
export type MyAccess = { member: boolean; membershipId?: string | null; ownerId?: string; role?: string; ownerName?: string; permissions: string[] | null }
export function getMyAccess() {
  return api<MyAccess>(`/api/team/my-access`)
}

// Invites addressed to ME that I haven't accepted. Until one is accepted the membership
// stays 'invited', my-access reports member:false, and NO permission limits apply — so
// this is the step that actually turns a leader's sharing toggles on.
export type MyInvite = {
  id: string; invite_token: string; role: string; permissions: string[]
  owner_id: string; owner_name: string; invited_at: string
  /** The inviter's actual login email. A display name is self-chosen and can be
   *  anything — accepting grants access to your account, so identify them by the
   *  thing they had to prove they own. */
  owner_email?: string | null
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
  /** Owner id when this plan comes from a team leader rather than your own subscription.
   *  Access is inherited; billing control is NOT — renewal fields stay your own. */
  inherited_from?: string | null
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
  /** Present on a DOWNGRADE: the change is scheduled, not applied now. `plan`/`spydeck_addon`
   *  above stay what you're on TODAY; this is what you drop to at `at` (== renews_at). */
  auto_renew?: boolean
  scheduled?: { plan: string; spydeck_addon: boolean; at: string | null }
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

// ── Per-order charges + refunds ────────────────────────────────────────────────
// Charges are itemised into PARTS (product / shipping / expedite / …) so a refund can
// name what goes back rather than only how much — the same shape a marketplace refund
// takes. Reading is staff-wide; issuing is admin/warehouse, enforced server-side.
export type OrderChargePart = {
  key: string; label: string; charged: number; refunded: number; refundable: number
}
export type OrderCharges = {
  lines: { part: string; label: string; amount: number; note?: string | null; at: string }[]
  parts: OrderChargePart[]
  refunds: { amount: number; part: string | null; note?: string | null; at: string; by?: string | null }[]
  charged: number; refunded: number; refundable: number
  canRefund?: boolean
}
export function getOrderCharges(id: string) {
  return api<OrderCharges>(`/api/orders/${encodeURIComponent(id)}/charges`)
}
/** `full` refunds everything left; `select` names parts to refund whole; `amount` is
 *  either a figure (spent top-down) or a per-part map. `clientId` makes a double-click
 *  idempotent — the server dedupes on it. */
export function refundOrder(
  id: string,
  body: { full?: boolean; select?: string[]; amount?: number | Record<string, number>; note?: string; clientId?: string }
) {
  return api<OrderCharges & { ok?: boolean; refunded?: number; error?: string; balance?: number | null }>(
    `/api/orders/${encodeURIComponent(id)}/refund`,
    { method: "POST", body: JSON.stringify(body) }
  )
}

// ── Design partner (Pink Design) ───────────────────────────────────────────────
// Sending a line out for design is always a MANUAL act — sellers usually upload
// print-ready artwork, so most jobs need no outsourced design and auto-sending would open
// a paid task for every one of them. These power the "Send to design partner" window.
export type PinkStatus = {
  configured: boolean; ok?: boolean; base?: string; boardId?: string | null
  boards?: unknown; productTypes?: unknown; productTypeDefault?: string | null; error?: string
}
export function getPinkStatus() {
  return api<PinkStatus>(`/api/pinkdesign/status`)
}
/** Push one line item out for design. `extraImages` are reference URLs (see
 *  uploadPinkAttachment); the artwork itself is resolved server-side and always leads. */
export function pushToPink(body: {
  // One of orderId+sku, cardId, or imageUrl — a send can be anchored to a line item, an
  // existing board card, or nothing at all (speculative artwork with no order yet).
  orderId?: string; sku?: string; cardId?: string; imageUrl?: string
  title?: string; qty?: number; description?: string
  productType?: string; designType?: string; boardId?: string; extraImages?: string[]
}) {
  return api<{ ok?: boolean; refId?: string; board?: string; cardId?: string | null
               orderId?: string | null; error?: string; retryable?: boolean; warning?: string }>(
    `/api/pinkdesign/push`, { method: "POST", body: JSON.stringify(body) })
}
/** Store a reference file and get a URL back — Pink Design accepts URLs only. */
export function uploadPinkAttachment(body: { data: string; name?: string }) {
  return api<{ ok?: boolean; url?: string; name?: string | null; error?: string }>(
    `/api/pinkdesign/attachment`, { method: "POST", body: JSON.stringify(body) })
}
/** Send a card back for revision: a note (and optional images) plus a status flip. */
export function pinkRequestFix(body: { cardId: string | number; message: string; images?: string[] }) {
  return api<{ ok?: boolean; cardId?: number; col?: string; error?: string; commented?: boolean }>(
    `/api/pinkdesign/fix`, { method: "POST", body: JSON.stringify(body) })
}
/** One note previously posted to a partner's task, stored on the card. Retained for the
 *  card's `partner_notes` field; the composer that wrote them was removed (comments to Pink
 *  are unproven against their live API — everything they need goes in the brief instead). */
export type PartnerNote = { message: string; by?: string; at?: string }

/** Design-partner state for one order's lines, keyed by SKU. Read separately from the
 *  order itself so a failure here costs a badge, not the order page. */
export type OrderDesignStatus = {
  bySku: Record<string, {
    cardId: string; vendor: string | null; vendorRef: string | null
    col: string | null; updatedAt?: string
  }>
}
export function getOrderDesignStatus(id: string) {
  return api<OrderDesignStatus>(`/api/orders/${encodeURIComponent(id)}/design-status`)
}

/** Which supplier each SKU actually comes from, resolved server-side from the synced
 *  catalogs (authoritative — the sku IS theirs) then inventory.supplier. A sku in neither
 *  gets no api, so it's ordered by hand rather than guessed at from a PO's name. */
export function resolveSuppliers(skus: string[]) {
  return api<{ bySku: Record<string, { api: "ss" | "otto" | null; supplier: string | null; source: string; image?: string | null; variant?: string | null }> }>(
    `/api/purchase/resolve-suppliers`, { method: "POST", body: JSON.stringify({ skus }) })
}

// ── Supplier ordering (address / payment / shipping) ───────────────────────────
export type SupplierOptions = {
  /** Masked credential previews — enough to tell WHICH key is configured, never enough
   *  to use it. Saves a trip to Integrations just to check a connection. */
  keys?: { ss?: { set: boolean; masked: string | null; account: string | null }
           otto?: { set: boolean; masked: string | null; user: string | null } }
  /** Otto's customers and their contacts. Required on every Otto order and obtainable
   *  only from them, so this is offered as a choice rather than a GUID to paste. */
  ottoCustomers?: { id: string; name: string; contacts: { id: string; name: string }[] }[]
  shipTo: Record<string, string>
  shipToComplete: boolean
  suppliers: {
    ss: { live: boolean; paymentMethods: null; paymentNote: string
          shippingMethods: { id: string; label: string }[]; shippingNote: string
          paymentProfiles?: { available: boolean; reason: string | null; profiles: PaymentProfile[] } }
    otto: { live: boolean; available: boolean; reason: string | null
            paymentMethods: unknown[]; shippingMethods: unknown[] }
  }
  defaults: {
    ss_shipping_method: string; otto_payment_method: string
    otto_shipping_method: string; order_email: string; ss_payment_profile: string
    ss_order_email: string; otto_order_email: string
    /** Otto require both on every order; they come from their Customer API. */
    otto_customer: string; otto_contact: string
  }
}
/** Where supplier orders ship, how they pay, how they move. Otto's methods are read LIVE
 *  from their API (they're per-account); S&S has no such endpoint and bills the account. */
export function getSupplierOptions() {
  return api<SupplierOptions>(`/api/purchase/supplier-options`)
}

// ── Supplier returns ───────────────────────────────────────────────────────────
// The PO equivalent of a refund, and deliberately two steps: goods go back now, the
// credit lands when the supplier decides it does. Booking the credit at return time would
// put money in the P&L that hasn't arrived.
export type PoReturn = {
  id: string; at: string; by?: string | null; note?: string | null; rma?: string | null
  lines: { sku: string; qty: number; credit: number }[]
  credit: number; status: "pending" | "credited"; creditedAt?: string
}
export function returnPoLines(num: string, body: {
  lines: { sku: string; qty: number; credit?: number }[]; note?: string; rma?: string
}) {
  return api<{ ok?: boolean; return?: PoReturn; error?: string }>(
    `/api/purchase/${encodeURIComponent(num)}/return`, { method: "POST", body: JSON.stringify(body) })
}
/** Confirm the credit arrived. `amount` overrides the estimate — restocking fees and
 *  partial credits mean what lands often isn't what was expected. */
export function creditPoReturn(num: string, id: string, amount?: number) {
  return api<{ ok?: boolean; return?: PoReturn; error?: string }>(
    `/api/purchase/${encodeURIComponent(num)}/return/${encodeURIComponent(id)}/credit`,
    { method: "POST", body: JSON.stringify({ amount }) })
}

/** Tracking straight from S&S, by their order number. Boxed: a split shipment has a
 *  number PER BOX, and one number standing for four is how three go missing unnoticed. */
export type SsShipment = {
  carrier: string | null; tracking: string | null; box: string | null; origin: string | null
  orderNumber: string | null; invoiceNumber: string | null
  deliveredAt: string | null; signedBy: string | null
  lastUpdate: { at: string | null; where: string | null; status: string | null } | null
}
export function getSsTracking(p: { orderNumbers?: string[]; invoiceNumbers?: string[] }) {
  const s = new URLSearchParams()
  if (p.orderNumbers?.length) s.set("orderNumbers", p.orderNumbers.join(","))
  if (p.invoiceNumbers?.length) s.set("invoiceNumbers", p.invoiceNumbers.join(","))
  return api<{ shipments: SsShipment[]; error?: string }>(`/api/ss/tracking?${s.toString()}`)
}

// ── S&S order status / returns / cross-ref ─────────────────────────────────────
/** S&S return reason codes, verbatim from their Returns doc. Reason 2 or 6 combined with
 *  a replacement REQUIRES a comment — the server enforces it and names the field. */
export const SS_RETURN_REASONS: Record<string, string> = {
  "1": "Do not need / ordered wrong colour, size or qty",
  "2": "Damaged or defective",
  "3": "Keying error (ordered X, billed and received Y)",
  "5": "Wrong qty (ordered 10, received 2)",
  "6": "Other",
  "7": "Wrong qty (ordered 2, received 10)",
  "10": "Picking error (wrong size)",
  "11": "Picking error (wrong style or colour)",
}
export type SsOrderStatus = {
  orderNumber: string; invoiceNumber: string | null; warehouse: string | null
  status: string | null; deliveryStatus: string | null; tracking: string | null
  carrier: string | null; shippedAt: string | null; total: number; restockFee: number
  lines: { sku: string; title: string | null; color: string | null; size: string | null
           ordered: number; shipped: number | null; price: number; returnable: boolean }[]
}
export function getSsOrder(num: string) {
  return api<{ orders: SsOrderStatus[]; error?: string }>(`/api/ss/order/${encodeURIComponent(num)}`)
}
/** Raise a real return. Returns the RA number and the return shipping label — the two
 *  things that actually make a return happen. */
export function ssReturn(body: {
  lines: { invoiceNumber: string; sku: string; qty: number; returnReason: string
           isReplace?: boolean; returnReasonComment?: string }[]
  email?: string; shippingLabelRequired?: boolean; live?: boolean
}) {
  return api<{
    ok?: boolean; dryRun?: boolean; testOrder?: boolean; error?: string
    returns?: { type: string | null; status: string | null; orderNumber: string
                raNumber: string | null; labelUrl: string | null; total: number
                boxes: { box: number; tracking: string | null; labelPng: string | null }[] }[]
  }>(`/api/ss/return`, { method: "POST", body: JSON.stringify(body) })
}
export function getSsDaysInTransit(zip?: string) {
  return api<{ zip: string; warehouses: { warehouse: string; cutOff: string; days: number | null }[] }>(
    `/api/ss/days-in-transit${zip ? `?zip=${encodeURIComponent(zip)}` : ""}`)
}

/** Full catalogue sync — background, resumable, rate-limited to stay under S&S's 60/min.
 *  Already-synced styles are skipped, so a re-run costs minutes rather than an hour. */
export type SsSyncStatus = {
  running: boolean; total: number; done: number; skipped: number; products: number
  startedAt: number; error: string | null; stylesInDb: number; productsInDb: number
}
export function getSsSyncStatus() {
  return api<SsSyncStatus>(`/api/ss/sync-all/status`)
}
export function startSsSyncAll(refresh = false) {
  return api<{ ok?: boolean; started?: boolean; already?: boolean; total?: number | null; error?: string }>(
    `/api/ss/sync-all`, { method: "POST", body: JSON.stringify({ refresh }) })
}
export function stopSsSyncAll() {
  return api<{ ok?: boolean }>(`/api/ss/sync-all/stop`, { method: "POST" })
}

/** One S&S style's orderable SKUs, fetched LIVE and cached server-side. Lets the picker
 *  reach any style without waiting for a full catalogue sync. */
export function getSsStyleSkus(styleId: string) {
  return api<{ total: number; products: SsProduct[]; live?: boolean; error?: string }>(
    `/api/ss/style-skus/${encodeURIComponent(styleId)}`)
}
/** Otto style detail — full variant rows (sku + colour + size + price + per-colour image),
 *  not the bare sku list it used to return. */
export type OttoVariant = { sku: string; color: string | null; size: string | null; price: number | null; image: string | null }

/** A payment profile label from a supplier — never a full number. S&S return a name like
 *  "BMO Harris Bank 1234 (John Doe)", which already carries the last four. */
export type PaymentProfile = { id: string; type: string | null; name: string | null }

/** Every brand and category across BOTH supplier catalogues, plus the price range.
 *  Read from the whole table, not the loaded page — a filter exists to reach what you
 *  can't already see, so deriving it from what's on screen defeats the point. */
export function getCatalogFilters() {
  return api<{ brands: string[]; categories: string[]; priceMin: number | null; priceMax: number | null }>(
    `/api/purchase/catalog-filters`)
}

/** Ask S&S to cancel a real order. Their doc says it "TRIES to cancel" — an order already
 *  picked comes back 200 with its status unchanged — so the server trusts `orderStatus`,
 *  not the HTTP code, and reports a refusal as a failure naming the real status. */
export function cancelSsOrder(orderNumber: string) {
  return api<{ ok?: boolean; cancelled?: boolean; orderStatus?: string | null
               orderNumber?: string; restockFee?: number; dryRun?: boolean; error?: string
               /** True when the live cancel was refused (past S&S's 10-min window) but S&S
                *  already report the order cancelled, so our record was reconciled to match. */
               reconciled?: boolean }>(
    `/api/ss/order/${encodeURIComponent(orderNumber)}`, { method: "DELETE" })
}

// ── Receiving: scan an S&S box label ───────────────────────────────────────────
/** A scanned carton's exact contents. `qty` is what SHIPPED, `ordered` what was asked
 *  for — on a short shipment they differ, which is what receiving exists to catch. */
export type SsBox = {
  invoiceNumber: string; boxNumber: number; lane: string | null
  orderNumber: string; poNumber: string | null; warehouse: string | null
  carrier: string | null; tracking: string | null; boxCount: number; weight: number | null
  lines: { sku: string; yourSku: string | null; gtin: string | null; title: string | null
           brand: string | null; style: string | null; color: string | null; size: string | null
           ordered: number; qty: number }[]
  error?: string
}
export function getSsBox(barcode: string) {
  return api<SsBox>(`/api/ss/box?barcode=${encodeURIComponent(barcode)}`)
}

/** Per-warehouse stock for a batch of SKUs. Total is the sum across warehouses — which is
 *  NOT the same as "can ship in one box", the distinction the picker exists to show. */
export function getSsInventory(skus: string[]) {
  return api<{ items: { sku: string; styleId: string | null; total: number
                        warehouses: { abbr: string; qty: number }[] }[]
               notFound: string[]; discontinued?: boolean }>(
    `/api/ss/inventory?skus=${encodeURIComponent(skus.join(","))}`)
}

/** Mark a label scanned IN-HOUSE — the warehouse did it, not the dispatch partner. The
 *  fact recorded is identical (tracking is live); only the route differs. */
export function markScannedInHouse(orderId: string, undo = false) {
  return api<{ ok?: boolean; scanned?: boolean; already?: boolean; via?: string; error?: string }>(
    `/api/orders/${encodeURIComponent(orderId)}/scanned`, { method: "POST", body: JSON.stringify({ undo }) })
}

// ── USPS SCAN forms (Shippo manifests) ────────────────────────────────────────
/**
 * A SCAN form is a DOCUMENT, not a scan. Creating one records `manifested_at`; the parcel
 * only counts as scanned when the carrier reports it moving, which the tracking path
 * fills in. Keep that distinction in the UI — it is the whole reason this route exists
 * separately from marking a scan ourselves.
 */
export type ManifestSkip = { id: string; num: string; reason: string }
export type ManifestGroup = {
  carrierAccount: string; count: number
  orders: { id: string; num: string; tracking: string | null }[]
}
export type ManifestRow = {
  id: string; createdAt: string; createdBy: string | null
  shipmentDate: string; status: string; pdf: string | null
  count: number; orderIds: string[]
}
export type ManifestDetail = {
  id: string; createdAt: string; shipmentDate: string; status: string; pdf: string | null
  count: number
  orders: { id: string; num: string; tracking: string | null
            /** The carrier has actually accepted this one — as opposed to it merely being
             *  printed on the form. */
            accepted: boolean; acceptedAt: string | null; delivery: string | null }[]
}

/** What would go on the form, and why anything else can't — without creating it. */
export function previewManifest(orderIds: string[]) {
  return api<{ groups: ManifestGroup[]; skipped: ManifestSkip[]; error?: string }>(
    `/api/manifests/preview`, { method: "POST", body: JSON.stringify({ orderIds }) })
}

/** Create the form(s). One per carrier account — Shippo requires every label on a
 *  manifest to share address, ship date and carrier account. */
export function createManifest(orderIds: string[], shipmentDate?: string) {
  return api<{ ok?: boolean
               manifests: { id: string; status: string; pdf: string | null; count: number }[]
               failed: { carrierAccount: string; count: number; error: string }[]
               skipped: ManifestSkip[]; error?: string }>(
    `/api/manifests`, { method: "POST", body: JSON.stringify({ orderIds, shipmentDate }) })
}

export function getManifests() {
  return api<ManifestRow[]>(`/api/manifests`)
}
export function getManifest(id: string) {
  return api<ManifestDetail>(`/api/manifests/${encodeURIComponent(id)}`)
}

// ── Dispatch history + shipments ───────────────────────────────────────────────
export type DispatchScanRow = {
  id: string; num: string; customer: string | null
  tracking: string | null; carrier: string | null
  scannedAt: string; via: string | null; by: string | null
  stage: string | null; delivery: string | null
}
export function getDispatchHistory(p: { days?: number; search?: string } = {}) {
  const s = new URLSearchParams()
  if (p.days) s.set("days", String(p.days))
  if (p.search) s.set("search", p.search)
  return api<{ scans: DispatchScanRow[] }>(`/api/dispatch/history?${s.toString()}`)
}

export type ShipmentRow = {
  id: string; num: string; customer: string | null; state: string | null
  tracking: string; carrier: string | null; labelUrl: string | null
  /** Shipping service (e.g. "USPS Ground Advantage"), and what the label cost. */
  method: string | null; price: number | null
  stage: string | null
  /** What the CARRIER says, as distinct from `stage` which is what the floor says. When
   *  they disagree, which one is wrong is the thing being worked out. */
  delivery: string | null; deliveryDetail: string | null; deliveryCheckedAt: string | null
  scannedAt: string | null; scannedVia: string | null; createdAt: string
}
export function getShipments(p: { search?: string; limit?: number } = {}) {
  const s = new URLSearchParams()
  if (p.search) s.set("search", p.search)
  if (p.limit) s.set("limit", String(p.limit))
  return api<{ shipments: ShipmentRow[]; labelSpend?: number }>(`/api/shipments?${s.toString()}`)
}
// Void/refund a bought label — cancels it with the carrier AND credits the label cost
// back in the ledger (so it shows in Billing under the carrier). Staff only, server-side.
export function voidLabel(orderId: string) {
  return api<{ ok?: boolean; refunded?: number; error?: string }>(`/api/shipments/${encodeURIComponent(orderId)}/void`, { method: "POST" })
}
// Backfill missing label fees from the provider (Shippo/EasyPost) for labels bought before
// buy-time cost capture landed — reads the real billed amount off the transaction and books
// it. Warehouse/admin only, server-side. `updated` = fees recovered, `failed` = no ref/error.
export function backfillLabelCosts() {
  return api<{ ok?: boolean; scanned?: number; updated?: number; failed?: number; error?: string }>(`/api/shipments/backfill-costs`, { method: "POST" })
}

// ── Broadcasts — one-to-many email to sellers ────────────────────────────────
// Named apart from `ads` campaigns on purpose: those are Meta/Google ad spend, this is
// mail. See server/src/routes/broadcasts.js.

/** {} means every seller. Every field NARROWS — none can widen past role='seller'. */
export type BroadcastAudience = {
  /** Deactivated accounts are excluded unless this is explicitly true. */
  includeInactive?: boolean
  /** true = sellers who have ever had an order; false = sellers who never have. */
  hasOrders?: boolean
  /** A hand-picked set. Combines with the other filters as an AND. */
  sellerIds?: string[]
}

export type Broadcast = {
  id: string | number
  subject: string
  body: string
  audience: BroadcastAudience
  status: "draft" | "sending" | "sent" | "failed"
  /** Null until it sends — the count is resolved AT SEND, so a draft honestly has none. */
  recipient_count: number | null
  sent_count: number
  failed_count: number
  created_by: string | null
  created_by_name: string | null
  created_at: string
  sent_at: string | null
}

export function getBroadcasts() {
  return api<{ broadcasts: Broadcast[]; mailConfigured: boolean }>(`/api/broadcasts`)
}
/** Counts an audience WITHOUT sending — same resolver the send uses, so the number shown
 *  in the confirm dialog cannot drift from the number actually mailed. */
export function previewBroadcastAudience(audience: BroadcastAudience) {
  return api<{ count: number; optedOut: number; sample: string[] }>(`/api/broadcasts/preview`, {
    method: "POST", body: JSON.stringify({ audience }),
  })
}
export function createBroadcast(b: { subject: string; body: string; audience?: BroadcastAudience }) {
  return api<Broadcast>(`/api/broadcasts`, { method: "POST", body: JSON.stringify(b) })
}
export function updateBroadcast(id: string | number, b: { subject?: string; body?: string; audience?: BroadcastAudience }) {
  return api<Broadcast>(`/api/broadcasts/${id}`, { method: "PATCH", body: JSON.stringify(b) })
}
export function deleteBroadcast(id: string | number) {
  return api<{ ok: boolean }>(`/api/broadcasts/${id}`, { method: "DELETE" })
}
/** Admin only. Returns as soon as the audience is resolved — the send continues server-side,
 *  so poll getBroadcasts() for sent_count rather than expecting this to wait. */
export function sendBroadcast(id: string | number) {
  return api<{ id: string; recipientCount: number; status?: string; note?: string }>(`/api/broadcasts/${id}/send`, { method: "POST" })
}

// ── Site content — editable marketing-home copy (admin) ──────────────────────
// The type + defaults live in lib/site-content.ts (shared with the SSR homepage). These
// are the admin read/write used by Settings › Site content.

/** Admin read of the STORED blob merged over defaults. Returns a complete SiteContent so the
 *  editor always has every field populated, never a half-empty form. */
export async function getSiteContentAdmin() {
  const { mergeSiteContent } = await import("./site-content")
  const r = await api<{ content: unknown; updatedAt: string | null }>(`/api/site-content`)
  return { content: mergeSiteContent(r.content), updatedAt: r.updatedAt }
}
export function setSiteContent(content: SiteContent) {
  return api<{ ok?: boolean; error?: string; content: SiteContent }>(`/api/site-content`, {
    method: "PUT", body: JSON.stringify({ content }),
  })
}
/** Upload a hero banner image (data URL) to object storage; returns its public URL to store
 *  in hero.image. The bytes go to storage, never into the content blob. */
export function uploadHeroImage(dataUrl: string) {
  return api<{ url?: string; error?: string }>(`/api/site-content/hero-image`, {
    method: "POST", body: JSON.stringify({ dataUrl }),
  })
}

// ── Global email branding (broadcasts) ─────────────────────────────────────────
/** Logo / accent / preset / footer applied to EVERY broadcast email. Read is staff (editor
 *  + preview), write is admin. `logoUrl` reuses the hero-image upload (any public image URL). */
export type EmailBranding = { preset: string; accent: string; logoUrl: string; heading: string; footerNote: string }
export function getEmailBranding() {
  return api<{ branding: EmailBranding; presets: string[] }>(`/api/email-branding`)
}
export function setEmailBranding(b: EmailBranding) {
  return api<{ ok?: boolean; branding?: EmailBranding; error?: string }>(`/api/email-branding`, {
    method: "PUT", body: JSON.stringify(b),
  })
}

// ─────────────────────────── Backups (admin) ───────────────────────────
// Admin-only Postgres backups to R2 — on-demand + nightly. See server/src/routes/backup.js.
// size_bytes arrives as a string when non-null (node-pg returns bigint as text).
export type DbBackup = {
  id: number
  r2_key: string | null
  size_bytes: string | number | null
  kind: "manual" | "auto"
  status: "running" | "done" | "failed"
  error: string | null
  created_by: string | null
  created_at: string
  finished_at: string | null
}
export type BackupConfig = { frequencyDays: number; keep: number }
export type BackupSummary = {
  totalBytes: number
  doneCount: number
  weekCount: number
  monthCount: number
  lastDone: string | null
  nextAuto: string | null
}
export type BackupsState = {
  backups: DbBackup[]
  storageConfigured: boolean
  pgDumpAvailable: boolean
  pgDumpVersion: string | null
  running: boolean
  config: BackupConfig
  summary: BackupSummary
}
export function listBackups() {
  return api<BackupsState>(`/api/backups`)
}
export function setBackupConfig(c: BackupConfig) {
  return api<{ ok: boolean; config: BackupConfig }>(`/api/backups/config`, {
    method: "PUT", body: JSON.stringify(c),
  })
}
export function runBackup() {
  return api<{ ok: boolean; status: string }>(`/api/backups/run`, { method: "POST" })
}
export function backupDownloadUrl(id: number) {
  return api<{ url: string }>(`/api/backups/${id}/download`)
}
export function deleteBackup(id: number) {
  return api<{ ok: boolean }>(`/api/backups/${id}`, { method: "DELETE" })
}
