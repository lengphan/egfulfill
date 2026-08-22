import { getToken, clearSession, setToken } from "./auth"
import type { SiteContent } from "./site-content"

// Same-origin in production (Caddy reverse-proxies /api → Fastify). For local
// cross-origin dev against a running API, set NEXT_PUBLIC_API_BASE=http://localhost:3000.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? ""

/**
 * The base a fetch should actually use — which is NOT the same on the server as in the
 * browser.
 *
 * "" means "relative to the current origin", and that only has meaning in a browser. In a
 * Server Component the fetch runs on Vercel's server, where a relative URL has no origin and
 * `fetch` throws before any request leaves the box. The marketing catalogue is exactly that
 * case: it rendered "the catalogue isn't published yet" permanently while the API was
 * returning products, because the throw landed in its `.catch` and an unreadable list is
 * indistinguishable from an empty one unless you make it distinguishable.
 *
 * The rewrite in next.config.ts cannot help here either — that maps /api/* for requests
 * arriving at the app, and a server-side fetch never goes through it. So the server needs the
 * real origin, and it is the SAME constant the rewrite targets, kept in step deliberately:
 * two different ideas of where the API lives is how one of them ends up stale.
 */
const SERVER_API_ORIGIN =
  process.env.NEXT_PUBLIC_API_BASE || process.env.API_ORIGIN || "https://egful.store"

function baseFor(): string {
  if (typeof window !== "undefined") return API_BASE
  return SERVER_API_ORIGIN
}

/**
 * BIG BODIES GO STRAIGHT TO THE API, NOT THROUGH VERCEL.
 *
 * Attaching a photo to a design and sending the line to the board failed with
 * `{"code":"502","message":"An error occurred with this application."}` — Vercel's own
 * envelope, not ours. The API's log for that request reads:
 *
 *     res 400  err {"message":"aborted","code":"ECONNRESET"}  msg "aborted"
 *
 * The body never finished arriving. Artwork is carried as a base64 data URL, which is ~33%
 * larger than the file, and the app accepts up to 32MB of it. Streamed through the
 * `/api/:path*` rewrite the upload outlived the proxy, which hung up mid-request and
 * answered the browser itself. Nothing was wrong with the route — it never got the request.
 *
 * IT IS NOT A BODY-SIZE CAP — that was the obvious guess and production disproves it:
 * 5.7MB and 28MB both pass through the rewrite and reach Fastify. What times out is the
 * RESPONSE. `aborted`/`ECONNRESET` is Fastify noticing the client has gone, and the client
 * here is the proxy: this route may fetch the artwork from a marketplace URL (up to 15s)
 * and then write it to object storage before it answers, and the proxy stops waiting.
 *
 * So the threshold is not a size limit, it is a cheap way to recognise "this request
 * carries artwork". 1MB, not 3MB: a base64 data URL of any real print file clears it
 * easily, and an ordinary JSON write never comes close — the gap between the two is three
 * orders of magnitude, so the exact number is not load-bearing.
 *
 * `api.egful.store` exists for exactly this — one Caddy hop to Fastify, no proxy in
 * between — and until now nothing in the app used it. CORS already allows the app's origin,
 * so this needs no server change.
 *
 * Deliberately automatic rather than a flag on the handful of routes that upload today:
 * a flag is something the next artwork route has to remember, and forgetting it fails as a
 * cut-off upload with an error naming the wrong system.
 *
 * Only in the browser, and only when we are same-origin in production. If
 * NEXT_PUBLIC_API_BASE is set the developer has named an API and we must not silently talk
 * to a different one.
 */
const DIRECT_API_ORIGIN = process.env.NEXT_PUBLIC_DIRECT_API_BASE ?? "https://api.egful.store"
const DIRECT_BODY_BYTES = 1024 * 1024

function originFor(body: BodyInit | null | undefined): string {
  const base = baseFor()
  if (typeof window === "undefined" || base !== "" || !DIRECT_API_ORIGIN) return base
  // Only a string body has a length we can read without consuming it. Blob/FormData uploads
  // don't come through this client today; if one does, it keeps the normal path.
  if (typeof body === "string" && body.length > DIRECT_BODY_BYTES) return DIRECT_API_ORIGIN
  return base
}

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

  const res = await fetch(`${originFor(init.body)}${path}`, { ...init, headers })
  // Anything that isn't a GET may have changed what a cached list holds. Clearing on EVERY
  // write — rather than mapping each mutation to the lists it touches — is deliberate: that
  // map would have to be updated by every future route, and the first time someone forgot,
  // the symptom would be a board showing an order state that no longer exists. The cost of
  // being blunt is one extra fetch after a write, which is the request that was happening
  // anyway before any of this existed.
  if (init.method && init.method.toUpperCase() !== "GET") invalidateLists()
  /* SLIDING SESSION. The server reissues a still-valid token once it is past half its life
     and returns it here, so an active session never hits the 7-day expiry mid-task. Storing
     it is the whole client side of that — nothing else changes, and a response without the
     header (the normal case) does nothing. */
  const renewed = res.headers.get("X-Session-Token")
  if (renewed) setToken(renewed)
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
    /* A DEAD SESSION IS NOT A FAILED FETCH.
       401 means the token is gone, expired or no longer accepted — signing in elsewhere,
       a 7-day expiry lapsing, or the server no longer honouring it. Nothing handled that
       centrally, so every panel caught its own error and rendered its own "couldn't load"
       message: the app stayed fully drawn while saying "Not signed in" in a dozen places
       at once, with no way back to a login screen except typing the URL.

       So end the session where it dies. Clear it and go to /login carrying where we were,
       which is the same return path the shell's gate uses.

       Only 401. A 403 means signed in but not allowed — bouncing that to /login would
       throw a legitimate user out of the app and, on a role-gated page, loop them. It
       stays an error for the caller to render. */
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      clearSession()
      const here = window.location.pathname + window.location.search
      window.location.replace(`/login?next=${encodeURIComponent(here)}`)
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
  /** The account's balance immediately AFTER this row, summed by the server over the whole
   *  ledger rather than the returned window — so it stays correct however this list is
   *  paged or filtered. Absent on older responses; the client falls back to walking back
   *  from the current balance. */
  balance_after?: number
  /** Marked as not-real-money by an admin. The row still shows — you cannot unmark what you
   *  cannot see — but it is excluded from the balance and every summary total. */
  is_test?: boolean
  /** Which real account this movement passed through. Null = not placed yet, which is a
   *  visible state rather than a silent one (see the Unassigned card in Finance). */
  cash_account?: string | null
}

/** The card Shippo charges postage to. Passthrough from Shippo's /billing — brand and last
 *  four only, nothing stored our side. There is no BALANCE to report: Shippo's payment_type
 *  is STRIPE, meaning a card charged per label rather than a prepaid account. */
export type ShippoBilling = {
  configured: boolean
  paymentType?: string | null
  blocked?: boolean
  currency?: string | null
  error?: string
  /** The card Shippo says it is charging right now (its top-level stripe_cc_* fields),
   *  which is the one fact worth leading with — `methods` is every card on file. */
  current?: { brand: string | null; last4: string; expires: string | null } | null
  /** `current` isn't one of `methods` — then it has to be shown on its own line. */
  currentUnlisted?: boolean
  /** DEDUPED — Shippo returns one row per (card × account), so the same card arrives
   *  several times. `charging` marks the one the top-level stripe_cc_* names. */
  methods: { brand: string | null; last4: string | null; expires: string | null; active: boolean; default: boolean; authorized: boolean
    charging?: boolean; expired?: boolean; expiringSoon?: boolean }[]
}
/**
 * Shippo has no public API for payment methods — see the panel.
 *
 * This is the address SHIPPO'S OWN error names when it refuses a label ("Review the payment
 * status of your invoices at https://shippo.com/user/billing/"), which beats a path guessed
 * from the dashboard's URL shape: it is the page that lists the invoices, not just the page
 * that holds the cards, and an unpaid invoice is what actually blocks a label.
 */
export const SHIPPO_BILLING_URL = "https://shippo.com/user/billing/"
export function getShippoBilling() {
  return api<ShippoBilling>(`/api/shipping/billing`)
}

// ── Cash accounts — WHERE the money actually sits ────────────────────────────
// wallet_ledger says what moved; these say which real account it moved through. See
// server/src/routes/cash_accounts.js.

export type CashAccount = {
  id: string; name: string; kind: string; opening: number
  is_postage: boolean; note: string | null
  /** opening + every movement attributed to it, test-marked rows excluded. */
  balance: number
  movements: number
}
export type CashAccountsView = {
  accounts: CashAccount[]
  /** Money the platform has seen that nobody has placed yet. Its own line on purpose. */
  unassigned: { amount: number; entries: number }
  total: number
}

export function getCashAccounts() {
  return api<CashAccountsView>(`/api/cash-accounts`)
}
export function saveCashAccount(a: { id: string; name: string; kind?: string; opening?: number; isPostage?: boolean; note?: string }) {
  return api<{ ok: boolean; id: string }>(`/api/cash-accounts`, { method: "POST", body: JSON.stringify(a) })
}
export function archiveCashAccount(id: string) {
  return api<{ ok: boolean }>(`/api/cash-accounts/${encodeURIComponent(id)}`, { method: "DELETE" })
}
/** Tell it what the account REALLY holds. The difference is recorded as its own ledger
 *  entry rather than overwriting history — that gap is money that moved unseen. */
export function reconcileCashAccount(id: string, actual: number) {
  return api<{ ok: boolean; balance?: number; adjustment?: number; unchanged?: boolean }>(
    `/api/cash-accounts/${encodeURIComponent(id)}/reconcile`, { method: "POST", body: JSON.stringify({ actual }) })
}
/** Money in or out of a real account — the factory's own payment, not a seller top-up. */
export function recordCashPayment(id: string, p: { amount: number; direction: "in" | "out"; note?: string }) {
  return api<{ ok: boolean }>(`/api/cash-accounts/${encodeURIComponent(id)}/payment`, { method: "POST", body: JSON.stringify(p) })
}
/** One pass over every past label cost with no account, onto the marked postage card.
 *  Only touches unattributed rows, so a hand-made correction is never overwritten. */
export function backfillPostage() {
  return api<{ ok: boolean; attributed: number; account: string }>(`/api/cash-accounts/backfill-postage`, { method: "POST" })
}

/** Move an existing ledger entry onto an account — how Unassigned gets emptied. */
export function attributeLedgerEntry(ledgerId: string | number, account: string | null) {
  return api<{ ok: boolean }>(`/api/cash-accounts/attribute/${ledgerId}`, { method: "PATCH", body: JSON.stringify({ account }) })
}

/** Mark a ledger row as test money, or restore it. Admin only; audited before/after,
 *  because it changes a balance someone has already been shown. Returns the account's
 *  recomputed balance so the screen can settle without a refetch. */
/** Set (or clear) the factory's private note on an order. STAFF ONLY — the server gates the
 *  field, not just the route, and strips it from every seller-facing response. */
export function setInternalNote(id: string, internalNote: string) {
  return api<{ ok?: boolean }>(`/api/orders/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify({ internalNote }),
  })
}

export function markLedgerTest(id: string | number, isTest: boolean) {
  return api<{ ok: boolean; is_test: boolean; balance?: number; unchanged?: boolean }>(
    `/api/wallet/ledger/${id}/test`, { method: "PATCH", body: JSON.stringify({ is_test: isTest }) })
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
  samples: number      // sourcing samples (sample-cost)
  /** What Google and Anthropic charged US per generation (aigen-cost) — a cost incurred by a
   *  button, with nothing shipped behind it. */
  aiCost?: number
  /** What sellers paid US for their own generations (aigen-in). Kept apart from `aiCost`
   *  because netting them describes neither: factory renders are pure cost, seller renders
   *  are margin, and one figure hides which just moved. */
  aiRevenue?: number
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
/** Nobody is going to pay this one — take it out of the admin queue and the seller's
 *  history. The virtual account stays live and a late payment still reconciles; this only
 *  hides a request that was never acted on. */
export function abandonVietqr(ref: string) {
  return api<{ ok?: boolean; abandoned?: number }>(`/api/vietqr/abandon`, {
    method: "POST", body: JSON.stringify({ ref }),
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
  method?: string
  /** Some products carry their techniques as a LIST rather than a joined string — imports
   *  and anything built against the API. Read alongside `method`, never instead of it. */
  methods?: string[] | null
  ref?: string | null
  /** `abandoned` = the seller closed the QR window. It leaves the ADMIN queue but stays
   *  the seller's to pay: the virtual account is live and the reference still settles. */
  status: "pending" | "received" | "rejected" | "abandoned"
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
  /**
   * WHAT THIS ACCOUNT HAS ACTUALLY MOVED, in UNITS — the row's detail panel.
   *
   * Units, not orders: `orders_total` already counts orders, and a seller with four orders
   * of fifty pieces is not the seller with fifty orders of four. `items_waiting` excludes
   * cancelled and refunded, so a dead order can't make an idle account look busy, and
   * `units_last_month` is the figure the volume ladder reads (last month earns, this month
   * spends) — it says WHY a seller is on the rung they are on.
   *
   * OPTIONAL, and undefined is not zero: a server that predates these sends nothing, and a
   * panel that printed 0 would report "shipped nothing" for an account it simply cannot
   * measure. The panel prints a dash for undefined.
   */
  items_shipped?: number
  items_waiting?: number
  units_last_month?: number
  /** The team's members by address — `team_size` counts them, this names them. email is the
   *  only identity team_members is guaranteed to hold. */
  team_emails?: string[] | null
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
/** `fee` is what the transfer itself cost — PingPong's cut, a wire charge, the FX spread.
 *  Credited amount is unaffected: the seller gets the full sum and the fee is a separate,
 *  named debit, so what they sent and what they were charged stay legible as two facts. */
export function confirmTopup(id: string, fee?: number) {
  return api<{ error?: string }>(`/api/topups/${encodeURIComponent(id)}/confirm`,
    { method: "POST", body: JSON.stringify({ fee: fee && fee > 0 ? fee : 0 }) })
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
 * The same rows the CSV is built from, as data.
 *
 * A partner sheet is filled in the browser — the mapping has to be previewed against real
 * values before anything is written — so the rows come back as JSON rather than a file.
 * `fields` is the server's own list of what a row contains, so the mapping UI can never
 * offer a field the export doesn't actually emit.
 */
export type CatalogExportRow = Record<string, string>
export function getCatalogRows(all = false) {
  return api<{ rows: CatalogExportRow[]; fields: string[]; products: number; picks: number }>(
    `/api/catalog/rows${all ? "?all=1" : ""}`
  )
}

/**
 * A partner's workbook, stored as the SHAPE it was found to have plus a field mapping.
 * See lib/partner-sheet.ts — the parsing and the writing both happen client-side; the
 * server only remembers the arrangement so it survives the tab closing.
 */
export type PartnerTemplate = {
  id: string
  name: string
  fileName: string | null
  layout: { sheets: { name: string; blocks: { id: string; title: string; headerRow: number; columns: { index: number; label: string }[] }[] }[] }
  mapping: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
export function getPartnerTemplates() {
  return api<{ templates: PartnerTemplate[] }>(`/api/partner/templates`)
}
export function createPartnerTemplate(body: { name: string; fileName?: string; layout: unknown; mapping: unknown }) {
  return api<PartnerTemplate & { error?: string }>(`/api/partner/templates`, {
    method: "POST", body: JSON.stringify(body),
  })
}
/** Partial on purpose — saving a mapping must not clear the layout it refers to. */
export function updatePartnerTemplate(id: string, body: { name?: string; fileName?: string; layout?: unknown; mapping?: unknown }) {
  return api<PartnerTemplate & { error?: string }>(`/api/partner/templates/${encodeURIComponent(id)}`, {
    method: "PUT", body: JSON.stringify(body),
  })
}
export function deletePartnerTemplate(id: string) {
  return api<{ ok?: boolean; error?: string }>(`/api/partner/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
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
  /** Which list this page came from — our own catalogue products, or a picked S&S style.
   *  It decides where an edit is written, so it travels with the style rather than being
   *  re-derived from the shape of the ref. OPTIONAL: a saved export predates it. */
  source?: "mine" | "ss"
  /** True when this page's copy or photo has been overridden for the lookbook. Shown, and
   *  revertible — a document you can't tell you've altered is one you can't check. */
  edited?: boolean
  image: string; price: number | null; sizes: string[]
  colors: { name: string; sku: string; image: string }[]
  /** Garment measurements from S&S, as generic name/value pairs per size — their /specs
   *  feed has no fixed columns, so a chart is pivoted from these rather than read. */
  specs: { size: string; order: string; spec: string; value: string }[]
  /** What it costs to send one of these as the FIRST item in a parcel, and what each
   *  additional unit in the same box adds. Straight from pricing.js's shipFeeOf/extraFeeOf,
   *  so the price table quotes what actually bills.
   *
   *  OPTIONAL because a SAVED export is a snapshot: copies written before this existed have
   *  no fees, and null means "we don't know", never "free". The table prints a dash. */
  ship?: number | null
  shipExtra?: number | null
  /** What a SELLER pays us to make one. `price` is catalog_price — the trade rate quoted to
   *  partners — and a style nobody has priced for the trade printed a dash on a page whose
   *  job is to be ordered from. Its own field, never coalesced server-side: the two mean
   *  different things to different readers, and the template decides which to show. */
  sellerPrice?: number | null
  /** One price per TECHNIQUE — base + that method's surcharge. null means the product does
   *  not offer it, which the table prints as N/A rather than as a dash: "we don't run this"
   *  and "we haven't priced it" are different answers. Optional: a saved export predates it. */
  priceByMethod?: { print: number | null; embroidery: number | null }
}
export function getLookbook() {
  return api<{ styles: LookbookStyle[] }>(`/api/catalog/lookbook`)
}
/**
 * Edit one page of the lookbook.
 *
 * `name` / `description` / `image` are the SHEET's copy — stored against the style for this
 * document and applied over whatever the source says, so retitling a page never renames the
 * product a seller buys or writes into the supplier's own data. `price` is different: it goes
 * to the catalogue price that already exists, the one the Catalogue page and the markup button
 * write, because a second price is how a document ends up disagreeing with the screen.
 *
 * `null` clears a field back to the source. `{ reset: true }` puts the whole page back.
 * An image must be an uploaded file (a data: URL) — see the route.
 */
export function saveLookbookStyle(
  source: "mine" | "ss", ref: string,
  body: { name?: string | null; description?: string | null; image?: string | null; price?: number | null; reset?: boolean },
) {
  return api<{ ok?: boolean; error?: string; catalogPrice?: number | null }>(
    `/api/catalog/lookbook/${source}/${encodeURIComponent(ref)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  )
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
  return api<{
    products: number; styles: number; total: number; unpriced: number
    /** How many the MARKETING SITE shows — counted off product `status`, not off this list.
     *  `total` is the LOOKBOOK (in_catalog products + supplier styles), a trade document with
     *  its own prices; the website is a separate surface. See the summary route. */
    publicVisible?: number
    publicHidden?: { unpriced: number }
  }>(`/api/catalog/summary`)
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
  /** Hand-picked for the front of the public catalogue. Published by name in the public
   *  shape; distinct from inCatalog (the trade lookbook) and from status (who may see it
   *  at all) — this one only decides whether it LEADS. */
  featured?: boolean
  /** OURS — "EG-1001". Inventory is keyed on it, an order line resolves to it, and publish
   *  writes it onto the seller's listing, where the seller reads it as their product SKU. */
  sku?: string
  /** THEIRS — the supplier's own style number. Factory-only: the server strips it from a
   *  seller's copy (sellerSafe in catalog.js), because a code that identifies the supplier
   *  lets anyone buy the same blank without us (§2.8). Matched as an ALIAS when resolving
   *  older order lines, never published. */
  supplierSku?: string
  type?: string
  method?: string
  /** Some products carry their techniques as a LIST rather than a joined `method` string —
   *  imports, and anything built against the API. Read alongside `method`, never instead of
   *  it, or a product that has both loses half its options. */
  methods?: string[] | null
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
  /** `blank` is what this size costs UNDECORATED — charged when an order line carries no
   *  print method. Null when we don't sell this one as a blank, which leaves the printed
   *  base cost in charge; it is never 0, because 0 would mean giving the garment away. */
  /**
   * `weightOz` — WHAT THIS SIZE WEIGHS, and why it is per SIZE rather than per product.
   *
   * A 3XL crewneck is not the same parcel as a S: the difference runs to several ounces,
   * and postage is priced in bands (4oz, 8oz, 12oz, 15.999oz, then 1lb on USPS Ground
   * Advantage), so one size can sit a whole band above another. A single product-level
   * figure has to be either the heaviest — over-declaring every small one — or an average,
   * which under-declares the big ones and gets corrected by the carrier days later at
   * roughly $1.65 a parcel.
   *
   * It rides in the size row for the same reason `blank` does: it is the same garment in
   * the same size, so it is a column here rather than a second dimension.
   */
  sizePrices?: { size: string; price: number; shipping: number | null; cost?: number | null; blank?: number | null; weightOz?: number | null }[]
  /**
   * OUR variant sku → the SUPPLIER's code for that same variant ("EG-CAP-ORN-ADJ" →
   * "B49795660"). Per variant, because a supplier's catalogue is keyed by colour AND size
   * while `supplierSku` on this product is the style — which cannot say what was in the box.
   * See lib/supplier-sku.ts; this is what lets a purchase cart line carry OUR sku so the
   * shelf it credits is the one order lines read.
   */
  supplierSkus?: Record<string, string>
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
  /**
   * The page we actually buy this on. Staff-only, like supplierSku, and published nowhere.
   *
   * It exists so "order by hand" is one click: a shortage of a hand-bought blank reaches the
   * purchase cart with nothing but a name, and the person holding it then has to remember
   * where it came from. Typed once on the product; carried onto every parked line for it.
   */
  supplierUrl?: string
  mainColor?: string
  sizes?: string[]
  images?: string[]
  img?: string
  image?: string
  hero?: string
  /** THE colour's photo — one per colourway, and the one every other surface reads: the
   *  swatch, the row avatar, the print mockup. Its KEYS are also where colorsOf() gets the
   *  colour list from, so a colour with no picture still belongs here with an empty value. */
  colorImages?: Record<string, string>
  /**
   * EVERY photo of that colourway, not just the representative one.
   *
   * Suppliers send a front, a back, a side and on-model shots PER COLOUR. Only the front fitted
   * in `colorImages`, so the rest arrived as an anonymous `images` gallery and the product
   * editor showed thirty tiles asking "— colour —" for photos whose colour the supplier had
   * already told us.
   *
   * Additive on purpose: `colorImages` keeps its exact meaning and every existing reader is
   * untouched. This is the extra angles, keyed by the same colour names.
   */
  colorGallery?: Record<string, string[]>
  /**
   * HOW THE MAIN PHOTO IS FRAMED ON A CARD — zoom percent and the vertical point to hold.
   *
   * Supplier photography has whitespace baked into the file: a cap sits small in the middle
   * of its own frame, so object-cover crops to a square and still shows a small cap. There is
   * nothing to fix in the layout — the padding is IN the image — so the only cure is to
   * scale it up and choose which part stays centred.
   *
   * Stored per product because it is a property of that photo, not a global taste. Absent
   * means 100% / centre, which is exactly the old behaviour, so nothing already saved moves.
   */
  imgZoom?: number
  imgFocusY?: number
  // The uploaded blank mockup graphic (the 2D garment image), + per-side variants
  // ({front, back, left, right, ...}) for placing artwork on more than one face.
  mockup?: string
  sideMockups?: Record<string, string>
  side_mockups?: Record<string, string>
  /**
   * The dashed print area per side. `x/y/w/h` are 0–100% of the mockup — where the
   * rectangle sits. `wIn/hIn` are what it MEASURES, in inches.
   *
   * Both are needed and neither implies the other: the percentages place the box on the
   * picture, the inches say how big the real thing is, and a photo has no scale of its own.
   * The inches are what a DPI check has to divide by, so without them the designer was
   * asking whoever opened it to type a number nobody had recorded.
   *
   * Absent ⇒ the garment-type fallback in lib/print-zone.ts, and the 12×16 base size.
   * Set by staff in the product editor, never in the designer.
   */
  printAreas?: Record<string, { x: number; y: number; w: number; h: number; wIn?: number; hIn?: number }>
  print_areas?: Record<string, { x: number; y: number; w: number; h: number; wIn?: number; hIn?: number }>
  // Explicit per-variant SKUs ([{sku,color,size}] | string[]) — how a marketplace
  // listing's SKU resolves back to this product. Matched by pricing.js + the variant picker.
  variantSkus?: (string | { sku?: string; SKU?: string; color?: string; size?: string })[]
}

// AI assistant config (admin) — key status + model, editable in Settings › Integrations.
export type AiModel = { id: string; label: string }
export type AiConfig = { keySet?: boolean; last4?: string | null; masked?: string | null; fromEnv?: boolean; model?: string; models?: AiModel[]; ok?: boolean; error?: string }
// ── Branding (admin): the marks, the name and the accent, editable without a deploy ──
// The PALETTE still stays in code: --primary inks ~247 pieces of text as well as filling
// buttons, the status colours carry meaning on the floor, and contrast here is measured
// rather than eyeballed — so a colour PICKER in an admin panel is a way to make a quarter of
// the app unreadable without anyone noticing.
//
// `accent` is the vetted-preset exception, and it is a KEY, never a colour: globals.css owns
// the values under [data-pop="…"], the server allow-lists the keys, and both have been
// through tools/check-pop-presets.mjs. See lib/accent.ts.
export type Branding = {
  appName?: string; logoUrl?: string; faviconUrl?: string
  accent?: string; accents?: string[]
  /** The site's PALETTE, on exactly the same terms as `accent`: a key, allow-listed by the
   *  server, whose values live in globals.css under [data-skin="…"]. See lib/skin.ts. */
  skin?: string; skins?: string[]
  error?: string
}
export function getBranding() {
  return api<Branding>(`/api/branding`)
}
export function setBranding(body: { appName?: string; logoUrl?: string; accent?: string; skin?: string }) {
  return api<Branding & { ok?: boolean }>(`/api/admin/branding`, { method: "PUT", body: JSON.stringify(body) })
}
/** `dataUrl` is a base64 data URL read from a file input. Max 2MB, PNG/JPEG/WebP/SVG/ICO. */
export function uploadBrandingAsset(kind: "favicon" | "logo", dataUrl: string) {
  return api<{ ok?: boolean; kind?: string; url?: string; bytes?: number; error?: string }>(
    `/api/admin/branding/upload`, { method: "POST", body: JSON.stringify({ kind, dataUrl }) })
}

// ── AI generation pricing ────────────────────────────────────────────────────
// Two reads on purpose, the same split /api/design_fees uses: a seller may know what THEY
// pay and what they have left, and never what a render costs us. `AiQuote` is per-caller —
// it counts that account's own month and day — so it must not be cached across users.
export type AiQuote = {
  staff: boolean
  enabled: boolean
  imagePrice: number
  videoPrice: number
  freeLeft: number
  freeImagesPerMonth?: number
  /** The channel generated images land in, named by the server — a team member shares the
   *  owner's, and cannot work that id out for themselves. Absent for staff. */
  genChannel?: string
  imagesLeftToday: number | null
  videosLeftToday: number | null
}
export type AiPricing = {
  sellersEnabled: boolean
  imagePrice: number
  videoPrice: number
  freeImagesPerMonth: number
  dailyImageCap: number
  dailyVideoCap: number
}
/** What the signed-in caller pays right now. Safe for sellers. */
export function getAiQuote() {
  return api<AiQuote>(`/api/ai_pricing`)
}
export function getAiPricing() {
  return api<AiPricing>(`/api/admin/ai_pricing`)
}
export function saveAiPricing(body: Partial<AiPricing>) {
  return api<AiPricing & { ok?: boolean; error?: string }>(
    `/api/admin/ai_pricing`, { method: "PUT", body: JSON.stringify(body) })
}

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

// Image AI config (admin) — the Google key behind staff image generation. Separate
// credential and separate provider from the Claude assistant above, so it gets its own
// card rather than sharing one and implying a single key covers both.
// Omit rather than intersect: `AiConfig["models"]` is AiModel[], and `A & B` would resolve
// `models` to AiModel[] & ImageGenModel[] — property access then picks AiModel and the
// price fields vanish. Same key, different element type, so it has to be replaced.
export type ImageAiConfig = Omit<AiConfig, "models"> & { models?: ImageGenModel[]; staleModel?: string | null; storageReady?: boolean }
export function getImageAiConfig() {
  return api<ImageAiConfig>(`/api/admin/image-ai-config`)
}
export function setImageAiConfig(body: { key?: string; model?: string; clearKey?: boolean }) {
  return api<ImageAiConfig>(`/api/admin/image-ai-config`, { method: "PUT", body: JSON.stringify(body) })
}
/** Live-test the Google key. Unlike the Claude test there is no free ping on an image
 *  endpoint, so this RENDERS one image on the cheapest model — it costs about $0.034. */
export function testImageAiKey(key?: string) {
  return api<{ ok?: boolean; model?: string; bytes?: number; mime?: string; usd?: number; costNote?: string; error?: string }>(
    `/api/admin/image-ai-test`, { method: "POST", body: JSON.stringify(key ? { key } : {}) })
}

// Google Sheets import — server reads the sheet and returns a 2D row array,
// then the client reuses the same CSV parsing/validation (lib/order-import).
export function getSheetsConfig() {
  /** `copyUrl` is Google's force-a-copy link for our master template — the whole seller
   *  flow. `needsTemplate` is admin-only and true when no master has been configured yet;
   *  `shareWith` (the service-account address) is signed-in only. See the route. */
  return api<{
    enabled?: boolean
    templateUrl?: string
    copyUrl?: string
    canCreate?: boolean
    shareWith?: string
    isTemplateAdmin?: boolean
    needsTemplate?: boolean
  }>(`/api/sheets/config`)
}
/** Admin: point the Make-a-copy button at a master template sheet. Any Sheets URL works —
 *  the /copy form is derived server-side, so pasting the /edit link is correct. */
export function setSheetTemplate(url: string) {
  return api<{ ok?: boolean; templateUrl?: string; copyUrl?: string }>(`/api/sheets/template`, {
    method: "PUT",
    body: JSON.stringify({ url }),
  })
}
/** Admin: write our bands, widths, header rows and DROPDOWNS into the master sheet.
 *  Google's .xlsx conversion drops data validation, so a master made that way has none
 *  until this runs. Needs the sheet shared with the service account as Editor. */
export function formatSheetTemplate() {
  return api<{ ok?: boolean; tab?: string; dropdowns?: string[] }>(`/api/sheets/template/format`, { method: "POST" })
}
export function getSheetRows(url: string) {
  return api<{ rows?: string[][]; title?: string; tab?: string; error?: string }>(`/api/sheets?url=${encodeURIComponent(url)}`)
}
/** Create a ready-formatted Orders sheet in the service account's Drive, shared
 *  anyone-with-link → editor. Only available when `canCreate` is true. */
export function createSheet() {
  return api<{ ok?: boolean; id?: string; url?: string; error?: string; formattingError?: string | null }>(`/api/sheets/create`, { method: "POST" })
}

/** The blank catalog. Cached longer than the order list — it's reference data, and the only
 *  thing that changes it is a product edit, which is a write, which clears this. */
/** One colourway a visitor can choose. `image` is null when we hold no renderable picture
 *  for it — the server drops internal storage keys rather than emitting a broken URL. */
export type PublicColor = { name: string; image: string | null }
export type PublicProduct = {
  /** URL handle, derived server-side from the name. The row id is never published. */
  slug: string
  name: string
  image: string | null
  category: string | null
  /** Supplier prose, tags stripped and capped server-side. */
  description: string | null
  /** The GARMENT's brand — null when the stored value was the supplier's own name, which
   *  the SanMar import uses as a fallback. Publishing that would name our supplier on a
   *  public page (CLAUDE.md 2.8), so the server filters it rather than trusting it. */
  brand: string | null
  /** What a SELLER pays us. Never our cost. */
  price: number
  /** The cheapest orderable size. Equals `price` on a product with one price. */
  priceFrom?: number
  /** True when sizes are priced differently — the page says "from" only then, because a
   *  single-price product dressed as a range is the other half of getting this wrong. */
  priceVaries?: boolean
  /** What each priced size costs. Allow-listed to {size, price} server-side — the stored
   *  tier also carries our cost. A size missing from this list is charged `price`. */
  sizePrices?: { size: string; price: number }[]
  /** Hand-picked for the front of the catalogue, set in the product editor. */
  featured?: boolean
  /** What THIS product ships for as the first item in a parcel — its own fee if it carries
   *  one, otherwise its garment band. Resolved by the same function that bills the order. */
  ship: number | null
  methods: string[]
  colors: PublicColor[]
  sizes: string[]
  /** How the photo is framed — the crop set in the product editor, so the public site shows
   *  the same composition the app does. Null when nobody has framed it. See
   *  lib/product-framing.ts; the server clamps both to the editor's own bounds. */
  imgZoom?: number | null
  imgFocusY?: number | null
  /** Garment measurements, straight from the supplier's /specs feed and cached server-side.
   *  Generic {size, spec, value} rows because the measurements differ per garment
   *  ("Chest Width", "Bill/ Brim Length"), so a chart is PIVOTED from these rather than read
   *  off fixed columns. Detail route only — the grid never asks for it. */
  specs?: { size: string; spec: string; value: string }[]
}
/** Published products for the PUBLIC marketing site — no auth, allow-listed server-side to
 *  named fields. Never use this inside the app: it deliberately omits the blank SKU, cost,
 *  margin and supplier that the authenticated catalog carries. Colourways and sizes ARE
 *  published — they describe the finished product a buyer picks from. */
/**
 * THE ONLY TWO CALLS THAT MAY BE CACHED, and the reason they may.
 *
 * `api()` sends no cache hint, so under Next 15+ every fetch is uncached — and an uncached
 * fetch during a render makes the whole route DYNAMIC, which silently overrode
 * `revalidate = 300` on the marketing product page and rebuilt it from scratch on every
 * first visit. generateStaticParams could not help while that was true.
 *
 * These two are safe to cache and nothing else here is: they are UNAUTHENTICATED and
 * PUBLIC — no Bearer token, no per-user shape, the same bytes for every reader. Caching an
 * authenticated call would risk handing one account's response to another, which is why this
 * is opted into per call rather than defaulted in api().
 *
 * 300s matches the pages' own revalidate, so publishing reaches the marketing site on the
 * same schedule either way.
 */
const PUBLIC_CACHE = { next: { revalidate: 300 } } as RequestInit

export function getPublicProducts() {
  /** `shipping.extra` is each ADDITIONAL unit in the same box. The first unit's fee is on
   *  each product (`ship`), because it depends on the garment — a cap and a hoodie never
   *  shipped for the same money, though one flat figure here used to say they did. The
   *  bands ride along for the grid, where no single product is on screen.
   *  Published beside the prices because a garment price on its own is the half of the
   *  answer that flatters us. */
  return api<{ products: PublicProduct[]; shipping?: { bands: ShipBands; extra: number } }>(`/api/public/products`, PUBLIC_CACHE)
}
/** One published product by slug, for the marketing detail page. 404s for anything not
 *  published — deliberately without distinguishing "unpublished" from "does not exist", so
 *  the route can't be used to probe for unreleased products. */
export function getPublicProduct(slug: string) {
  return api<{ product: PublicProduct }>(`/api/public/products/${encodeURIComponent(slug)}`, PUBLIC_CACHE)
}

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
export type SsStyleDetail = SsStyle & { sizes?: string[]; colorImages?: Record<string, string>; description?: string; extraImages?: string[]; error?: string
  /** The same extra angles as `extraImages`, still keyed by the colourway S&S sent them for —
   *  so the product editor doesn't have to ask a human to match photos to names by eye. */
  colorExtras?: Record<string, string[]>
  /** Stock, summed from the SAME rows the detail already fetches — `qty` is in the S&S
   *  product fields, so these cost no extra request. Absent for Otto and SanMar, which keep
   *  no quantity in our data: absent means UNKNOWN, never zero. */
  stockByColor?: Record<string, number>
  stockByVariant?: Record<string, Record<string, number>>
  stockTotal?: number
  /** Ounces PER SIZE, heaviest variant of that size. Absent, or an empty map, means S&S sent
   *  no weight — UNKNOWN, never zero, because a zero-ounce garment quotes free postage and
   *  the carrier corrects it days later. */
  weightBySize?: Record<string, number> }
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
/**
 * `style_id` is S&S's INTERNAL row id (16) and `style_name` is the marketing title — neither
 * is the number on the spec sheet. `style_no` is that number ("5000"), read out of the raw
 * product row the sync already stores. Show style_no; key by style_id.
 */
export type SsProduct = {
  sku: string; style_id?: string | null; brand?: string | null; style_name?: string | null; style_no?: string | null
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
/** `image` is the SMALL grid photo (~7KB) — browse serves card_image here on purpose.
 *  `fullImage` is the 1200x1800 original, for anything that keeps or enlarges the photo. */
export type SanmarCatalogStyle = { style: string; brand?: string | null; name: string | null; description?: string | null; category?: string | null; price: number | string | null; price_max?: number | string | null; image: string | null; fullImage?: string | null; colors: string[] | null; sizes: string[] | null; qty?: number | null; favorited?: boolean }
export type SanmarCatalogVariant = { color: string | null; size: string | null; sku: string; inventoryKey: string | null; sizeIndex: string | null; price: number | null; image: string | null
  /** SanMar's per-piece weight in ounces, or null when the import predates us reading that
   *  column. Null is UNKNOWN and must never be treated as zero — a zero-ounce garment quotes
   *  free postage and the carrier corrects it days later. */
  weightOz?: number | null }
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
/**
 * How far a stocked SKU may travel. Mirrors VISIBILITY in server/src/routes/inventory.js.
 *
 *   factory  internal only.
 *   seller   published in the partner stock feed (GET /api/v1/stock).
 *   public   additionally cleared for unauthenticated surfaces.
 *
 * Optional on the type because rows written before the column existed are read back by
 * older cached responses; treat a missing value as "factory".
 */
export type SkuVisibility = "factory" | "seller" | "public"
export type InventoryItem = { sku: string; name?: string | null; variant?: string | null; in_stock?: number; reserved?: number; reorder_at?: number; category?: string | null; supplier?: string | null; visibility?: SkuVisibility; updated_at?: string }
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
/**
 * Set the shelf count for a product's VARIANTS — one request for the whole grid.
 *
 * Only `in_stock` moves (plus the labels a new row needs to be readable). Reorder points,
 * category, supplier and visibility are left as they are, which is what makes this safe to
 * call from the product editor: setting a count must never quietly republish a factory-only
 * sku or reset a reorder level somebody chose. Nothing is pruned — dropping a colour from a
 * product does not empty its shelf.
 *
 * A row with `in_stock: null` is SKIPPED, not written as 0: an absent sku reads as "we don't
 * stock this" and a 0 reads as "we are out", and those send a person to different places.
 */
export function saveVariantStock(rows: { sku: string; name?: string | null; variant?: string | null; in_stock: number | null }[]) {
  return api<{ ok?: boolean; written?: number; error?: string }>(`/api/inventory/stock`, {
    method: "POST", body: JSON.stringify({ rows }),
  })
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
/** `lineId` is the file's SCOPE: a line id pins it to that one line, null/absent means it
 *  applies to the whole order. Files written before the column existed have no lineId, which
 *  is why "no line" reads as order-wide rather than as unattributed. */
export type DesignFileRow = { designId: string; sku?: string | null; lineId?: string | null; name?: string | null; mime?: string | null; kind?: string; price?: number; paid?: boolean; canPrice?: boolean; created_at?: string
  /** WHO put it here — "seller" (they sent it to us) or "factory" (we made it). Visibility
   *  and the buy button both hang off this: a file a seller sent is already theirs, so it is
   *  never offered back to them with a price on it. */
  source?: "seller" | "factory" }

/** Which files apply to THIS line: its own, else the order-wide ones. Line beats whole-order,
 *  the same precedence designForLine uses for artwork — so a file filed against one item
 *  overrides an "apply to all" without deleting it. */
export function filesForLine(files: DesignFileRow[] | undefined, line: { line_id?: string | null; sku?: string | null }): DesignFileRow[] {
  const list = files ?? []
  const own = line.line_id ? list.filter((f) => f.lineId === line.line_id) : []
  if (own.length) return own
  // Order-wide files. `sku` is the LEGACY fallback only — rows written before line_id
  // existed carry a sku and no line, and dropping them would hide real files on live orders.
  return list.filter((f) => !f.lineId && (!f.sku || !line.sku || f.sku === line.sku))
}
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
/** `lineId` matters: a design row written by the older client stores the LINE ID in its
 *  sku column, so a lookup by sku alone misses it and reports "no matches" — which is
 *  indistinguishable from a failed lookup. Optional, so older callers still work. */
export function getDesignReuse(orderId: string, sku: string, lineId?: string | null) {
  return api<{ exact: ReuseMatch[]; similar: ReuseMatch[]; hashed: boolean }>(
    `/api/design_files/reuse?orderId=${encodeURIComponent(orderId)}&sku=${encodeURIComponent(sku)}${lineId ? `&lineId=${encodeURIComponent(lineId)}` : ""}`)
}
export function getDesignFiles(orderId: string) {
  return api<DesignFileRow[]>(`/api/design_files?orderId=${encodeURIComponent(orderId)}`)
}
/** `lineId` scopes the file to one line; omit it (or pass null) for "applies to every item". */
export function uploadDesignFile(body: { designId: string; orderId?: string; sku?: string; lineId?: string | null; name?: string; mime?: string; data: string; price?: number }) {
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
/**
 * Copy an order into a fresh DRAFT — lines, variants, customer, address and the artwork on
 * every line. New id, empty charge ledger, so submitting it charges properly.
 *
 * The cancelled original is left exactly as it is. Reopening one would rewrite a settled
 * record, and there is a trap under it: chargeForSubmit skips when the charge leg is
 * non-zero, and a refund never subtracts from that leg — so a reopened order would read
 * "already charged" and be produced for nothing.
 */
export function duplicateOrder(id: string) {
  return api<{ ok?: boolean; id?: string; seq?: number; lines?: number; artwork?: number; error?: string }>(
    `/api/orders/${encodeURIComponent(id)}/duplicate`, { method: "POST" },
  )
}
/** Remove a file from an order (staff only). The Design readiness tag reverts once it's
 *  gone; the server records it in the order's tag history and broadcasts a refresh. */
/** Widen a file to the whole order (lineId null) or pin it back to one line. Metadata only
 *  — no bytes move, so it works for a seller, who cannot download their own machine file. */
export function scopeDesignFile(designId: string, lineId: string | null) {
  return api<{ ok?: boolean; lineId?: string | null; error?: string }>(
    `/api/design_files/${encodeURIComponent(designId)}/scope`,
    { method: "POST", body: JSON.stringify({ lineId }) })
}
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
/**
 * ONE SKU'S STOCK HISTORY — the journal behind its count.
 *
 * `in_stock` used to be a running number with nothing behind it, so a count that looked
 * wrong could not be explained. Every write to it now lands a movement, and this reads
 * them. `journal` is the sum of those deltas: it SHOULD equal `inStock`, and where it
 * doesn't the row predates the ledger — which the screen says rather than papering over.
 */
export type StockMovement = {
  id: string
  /** Which variant moved — carried even on a single-sku read, so one dialog renders both. */
  sku: string
  delta: number
  /** One of the STOCK_REASONS ids — see server/src/stock.js. */
  reason: string
  ref: string | null
  orderId: string | null
  note: string | null
  at: string
}
export type StockHistory = { sku?: string; skus?: string[]; inStock: number | null; journal: number; movements: StockMovement[] }

export function getStockMovements(sku: string, limit = 100) {
  return api<StockHistory>(`/api/inventory/${encodeURIComponent(sku)}/movements?limit=${limit}`)
}

/** A whole product's shelf — every variant's movements merged, newest first. The grid has
 *  no per-row menu, so this is how a multi-variant product reaches its own journal. */
export function getStockMovementsForSkus(skus: string[], limit = 200) {
  return api<StockHistory>(`/api/inventory/movements?skus=${encodeURIComponent(skus.join(","))}&limit=${limit}`)
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
export type UspsLabelResult = { ok?: boolean; error?: string; mock?: boolean; trackingNumber?: string; labelUrl?: string; labelImage?: string; labelHtml?: string; imageType?: string; carrier?: string; service?: string; cost?: number
  /** A label bought with NO order gets a shipment of its own, and this is its id. The
   *  server has always returned it (usps.js recordLabel); the type simply dropped it, so
   *  the print step had nothing to fetch and standalone labels never auto-printed. */
  shipmentId?: string }
// One quoted rate from the multi-carrier rate-shop. `token` is what you buy against.
/** `carrierAccount` is the ONLY place this value exists. Shippo puts it on the rate and
 *  returns `rate` as a bare id string on the bought transaction, so it has to survive the
 *  round trip from quote to buy or the label records none — and a label with no carrier
 *  account can never go on a USPS SCAN form (manifests.js:119). */
/** `eta` is a readable SPAN ("2–5 days") because USPS never commits to an integer; `days`
 *  stays the aggregator's number. `test` marks a quote from USPS's TEM host, where a bought
 *  label is a free sample and not postage. */
export type ShippingRate = { token: string; provider: string; carrier: string; service: string; amount: number; currency?: string; days?: number | null; eta?: string; test?: boolean; carrierAccount?: string }
export function getShippingRates(body: { to: ShipAddress; from?: ShipAddress; parcel: { weightOz?: number; length?: number; width?: number; height?: number }; extra?: { signature?: boolean; insurance?: number } }) {
  return api<{ rates: ShippingRate[]; errors?: string[]; error?: string }>(`/api/shipping/rates`, { method: "POST", body: JSON.stringify(body) })
}
// `rate`/`rateToken` buys a SPECIFIC carrier rate the operator picked; otherwise the body
// falls back to the USPS-cheapest path. Both record the label the same way.
export function buyUspsLabel(body: { to: ShipAddress; from: ShipAddress; weightOz?: number; length?: number; width?: number; height?: number; mailClass?: string; orderId?: string; directUsps?: boolean; signature?: boolean; insurance?: number; refNo?: string; refNo2?: string; contents?: string; rateToken?: string; rate?: { amount?: number; carrier?: string; service?: string; carrierAccount?: string } }) {
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
  auto?: boolean
  /** Which orders drove this line. `order` is the internal id (`etsy-3311908445`); `num` is
   *  what a human calls it (`#4099`) and is what the cart shows — they are not the same
   *  string for a marketplace order. `num` is absent on lines parked before it was carried. */
  sources?: { order: string; num?: string; qty: number }[]
  /** Product thumbnail, captured when the line was picked. Supplier names differ by a
   *  single word, so the picture is what confirms the right sku was chosen. Lines without
   *  one (auto-replenished from inventory) resolve it by sku at render time. */
  image?: string | null
  /**
   * HOW MANY EACHES ARE IN ONE OF WHAT YOU ORDERED.
   *
   * Suppliers sell blanks by the case. A line reading "2" against a case of 24 is 48
   * garments, and the shelf counts garments — so receiving that line as 2 puts a number on
   * the shelf that is wrong by a factor of the pack, silently, in the direction that makes
   * you think you are out of stock.
   *
   * `qty` stays in the unit you ORDER in (cases), `pack` converts it to the unit you STORE
   * in (eaches). Absent or 1 means they are the same thing, which is every line raised from
   * Inventory and most direct buys.
   */
  pack?: number
  /** THE SUPPLIER'S code for this same variant, when the line came from their catalogue.
   *  `sku` is always OURS — it is what receiving credits and what order lines resolve to —
   *  and this is what the supplier's own order needs to name. Keeping both is the whole
   *  point: one string for the shelf, one for the vendor. */
  supplierSku?: string
  /** How many of this line have actually arrived. Absent on every line raised before
   *  receiving existed, which reads as none — the honest default, since nothing was
   *  recorded either way. `qty - received` is what is still outstanding. */
  received?: number
  /**
   * WHERE `price` CAME FROM, on a line that was placed without one of its own.
   *
   * "catalog" means the figure was the supplier catalogue's last synced price at the
   * MOMENT OF PLACING, frozen onto the line so a past order keeps a real total. It is our
   * best knowledge at that moment, not a supplier confirmation — the invoice can still
   * differ — and it is marked so the two are never read as the same claim.
   *
   * Absent means the price is whatever was put on the line (browsed, or typed).
   */
  priceSource?: "catalog"
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
export type SavedPOLine = POLine & { supplier?: string | null; savedAt?: string
  /** Where to buy it, from the product. Staff-only, and the whole point of it is that
   *  "order by hand" should not mean "go and remember where this came from". */
  supplierUrl?: string | null }
export type PurchaseOrder = { num: string; supplier?: string | null; items: POLine[]; status: string; total?: number; meta?: Record<string, unknown> | null; created_at?: string }
export function getPurchaseOrders() {
  return api<PurchaseOrder[]>(`/api/purchase`)
}
export function savePurchaseOrder(po: PurchaseOrder) {
  return api<{ ok?: boolean; num?: string; error?: string }>(`/api/purchase`, { method: "POST", body: JSON.stringify(po) })
}
/**
 * Book a delivery in against a purchase order's own lines.
 *
 * WAREHOUSE, not admin — purchasing commits money and is admin-gated; receiving is a floor
 * job. Crediting the shelf by LINE rather than by typed sku is the point: the mapping from
 * supplier goods to our variant sku was already made when the PO was raised, so nobody at
 * the door has to know it. Returns what landed, what is still outstanding, and any line it
 * could not credit.
 */
export function receivePurchaseOrder(num: string, lines: { sku: string; qty: number }[]) {
  return api<{ ok?: boolean; num?: string; status?: string; error?: string; problems?: string[]
               received?: { sku: string; qty: number; asked?: number; pack: number; eaches: number; inStock: number; received: number }[] }>(
    `/api/purchase/${encodeURIComponent(num)}/receive`,
    { method: "POST", body: JSON.stringify({ lines }) },
  )
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
  /** What the artwork on this line is called, and its automatic number — issued by
   *  ARTWORK, so the same design reused across orders carries one id (server/design-id.js).
   *  Both ride on the list so a board can be searched by design, not only by order. */
  design_name?: string | null
  design_no?: number | null
  personalization?: string
  unit_price?: number | string
  /** FROZEN AT SUBMIT — what this line costs the seller to produce, stored on the line so a
   *  later catalogue edit can't move a charged price. It is the number the row shows once
   *  the order is submitted and the live quote is no longer consulted. */
  unit_cost?: number | string | null
  print_type?: string
  factory_status?: string | null
  /** The seller's OWN mockup per side — `{front, back}`, same-origin paths. A backdrop for
   *  placement, never the print file: a line with one of these and no artwork is still a
   *  line with no artwork, and the ship gate says so. */
  mockups?: Record<string, string> | null
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
  /**
   * THE FACTORY'S OWN ORDER, not a seller's — derived server-side from the owner's role,
   * never sent by a client. It decides two things the UI can't work out for itself: that
   * nothing here is charged to anyone, and that the Pending stage doesn't apply (see
   * FACTORY_LINE in lib/factory-status.ts — those orders go Draft → Awaiting scan).
   */
  factory_order?: boolean | null
  total?: number | string | null
  profit?: number | string | null
  /** Who uploaded it — resolved server-side ONLY when it's the shop owner or one of their
   *  own team members (else null). Never a factory account. Used for the seller's history. */
  created_by_name?: string | null
  /** WHOSE ORDER IT IS — the seller account that owns the row, name or email. STAFF LISTS
   *  ONLY: the seller's own query never selects it, because a seller reading their own
   *  orders would only ever see themselves. Distinct from created_by_name (who uploaded it)
   *  and from `store` (which storefront it came from — one seller can run three). */
  seller_name?: string | null
  tracking?: string | null
  /**
   * THE MARKETPLACE'S OWN SHIP-BY DATE — a promise, not an inference.
   *
   * Etsy's `expected_ship_date`, the earliest across the receipt's lines (a parcel that
   * ships together is bound by the first promise it carries). This is the date Etsy shows
   * the buyer AND the date it measures the shop's late-shipment rate against, so lateness
   * is judged against it wherever it exists.
   *
   * Null on manual orders and on any channel that doesn't give us one — those fall back to
   * the admin's `overdue_days` age threshold, which is a guess about a promise rather than
   * the promise itself. The two must never be presented as the same thing.
   */
  ship_by?: string | null
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
  /** Row last changed. NOT a true ship timestamp — `shipped_at` has no writer in the
   *  status-transition paths (pii_retention.js backfills it from this), so "shipped today"
   *  is really "moved to shipped and not touched since". Good enough for throughput, wrong
   *  for anything that needs the actual moment. */
  updated_at?: string | null
  shipped_at?: string | null
  /** Someone on the floor flagged this to jump the queue. A DECISION, unlike overdue,
   *  which is computed from age — so it carries who and when. */
  rush?: boolean
  rushed_at?: string | null
  label_printed_at?: string | null
  /** What the postage cost US — staff-facing. Present on the order row; the seller is
   *  charged shipping through the quote, which is a different number. */
  label_cost?: number | null
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
  /** When the factory accepted the job — stamped once at Approved (or the first stage past
   *  it) and never cleared. The seller's cancel window closes on THIS, not on the current
   *  stage, so stepping an order back on the board can't re-open it. */
  approved_at?: string | null
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
/**
 * The factory's own P&L from the append-only ledger — what WE earned and spent.
 *
 * Deliberately not derived from `orders.total`: that is what buyers paid sellers on their
 * marketplaces (GMV through the platform), not money that reaches us.
 */
/**
 * THE OVERVIEW'S FIGURES, COMPUTED ON THE SERVER.
 *
 * The dashboard used to fetch every order and reduce them in the browser — 890 orders and
 * 2,321 KB to render six numbers. This is the same arithmetic done where the rows already
 * are, and it answers in about two kilobytes. See server/src/routes/reports.js.
 *
 * `counts` is the whole floor; `windowed` is the same shape bounded by `days`, because "what
 * is on the line now" and "where did this week's intake go" are different questions.
 */
export type OverviewCounts = {
  total: number; draft: number; pending: number; approved: number; working: number
  shipped: number; onHold: number; cancelled: number; refunded: number; createdToday?: number
}
export type OverviewLineRow = { id: string; n: number; oldest: string | null; byPlatform: Record<string, number> }
export type Overview = {
  days: number
  counts: OverviewCounts
  windowed: OverviewCounts
  money: { gmv: number; orders: number; aov: number }
  /** Daily GMV scaled 0..1 — the shape of the run, which is all the sparkline draws. */
  gmvBars: number[]
  speed: {
    production: { days: number | null; n: number }
    transit: { days: number | null; n: number }
    total: { days: number | null; n: number }
    onTime: { pct: number | null; n: number }
  }
  line: OverviewLineRow[]
  recent: { id: string; seq?: number | null; store?: string | null; source?: string | null; customer: string | null; total: number; stage: string; created_at?: string | null }[]
}

/** The onEdit helper that makes the sheet's variant dropdowns depend on the chosen product.
 *  Served rather than bundled so it can never drift from the column names the template
 *  writes — see APPS_SCRIPT in server/src/routes/sheets.js. Admin only. */
export function getSheetsAppsScript() {
  return api<{ script: string; tab: string; listsTab: string; manifest: string }>(`/api/sheets/apps-script`)
}

export function getOverview(days = 30, windowLine = false) {
  return api<Overview>(`/api/reports/overview?days=${days}${windowLine ? "&windowLine=1" : ""}`)
}

export type FactoryPnl = {
  days: number
  income: number
  cost: number      // negative
  profit: number
  /** False when nothing is booked in the window — "nothing yet", never a profit of zero. */
  known: boolean
  byType: { type: string; income: number; cost: number; n: number }[]
}
export function getFactoryPnl(days = 30) {
  return api<FactoryPnl>(`/api/reports/pnl?days=${days}`)
}

// ─────────────────────────── Alibaba (sourcing) ───────────────────────────
// Admin-only. One connection for the whole factory — this is OUR buyer account, not a
// per-seller one, so there is no seller scoping anywhere in here.
export type AlibabaConfig = {
  configured: boolean
  /** A token exists AND is not past its expiry. Not a live probe — a token revoked early at
   *  Alibaba's end still reads connected until the next call. */
  connected: boolean
  /** A token exists but has aged out. Distinct from never-connected: one needs renewing, the
   *  other setting up, and they are different sentences to a reader. */
  expired: boolean
  base: string
  account: string | null
  expiresAt: string | null
  /** Where an admin goes to authorise. Built server-side because it carries the app key. */
  authorizeUrl: string | null
  redirectUri: string
}
export function getAlibabaConfig() {
  return api<AlibabaConfig>(`/api/alibaba/config`)
}
/** One signed call, returning Alibaba's own reply verbatim — a signature or permission
 *  error is readable from their message and guessable from nothing else. */
export function testAlibaba(keyword?: string) {
  const qs = keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""
  return api<{ ok?: boolean; signatureAccepted?: boolean; returned?: number; sample?: unknown; error?: string; detail?: unknown }>(
    `/api/alibaba/test${qs}`
  )
}
export function exchangeAlibaba(code: string) {
  return api<{ ok?: boolean; account?: string | null; error?: string; detail?: unknown }>(
    `/api/alibaba/exchange`, { method: "POST", body: JSON.stringify({ code }) }
  )
}
/** What the live search actually returns — no MOQ and no supplier name are in the payload,
 *  so they aren't here either. `price` is a RANGE string like "$0.88-1.05" (Alibaba prices
 *  by quantity band), not a number. */
export type AlibabaProduct = { id?: string | null; title?: string | null; image?: string | null; url?: string | null; price?: string | null }
export function searchAlibaba(p: { keyword: string; page?: number; pageSize?: number }) {
  const qs = new URLSearchParams({ keyword: p.keyword })
  if (p.page) qs.set("page", String(p.page))
  if (p.pageSize) qs.set("pageSize", String(p.pageSize))
  return api<{ products?: AlibabaProduct[]; page?: number; error?: string }>(`/api/alibaba/search?${qs}`)
}

/** Flag or clear a rush. Any factory staff — the person who notices a job is urgent is
 *  usually the one at the machine. Sellers are refused server-side. */
export function setOrderRush(id: string, rush: boolean) {
  return api<{ ok?: boolean; rush?: boolean; rushed_at?: string | null; error?: string }>(
    `/api/orders/${encodeURIComponent(id)}/rush`,
    { method: "POST", body: JSON.stringify({ rush }) }
  )
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

export function updateOrder(id: string, patch: { status?: string; factoryStatus?: string; tracking?: string; carrier?: string; total?: number; meta?: Record<string, unknown> }) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export type NewOrderItem = {
  /**
   * THE LINE'S IDENTITY, when the caller has a reason to know it before the order exists.
   *
   * The server mints one for every line and honours a supplied one ("marketplace importers
   * carry their own, and they must stay stable across a re-sync"). It was never declared
   * here, so the one caller that genuinely needs it — the sheet importer, which has to
   * attach a machine file to the unit row that asked for it — had no way to say so in types.
   *
   * `createOrder` answers `{ ok, id }` and no line ids, and a SKU is not identity: two lines
   * of the same SKU are different jobs (§5). Minting is the only way to hold a handle on a
   * specific line across the create.
   */
  lineId?: string
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
export type OrderDesign = { sku?: string; line_id?: string | null; kind?: string; data?: string; name?: string; pos?: DesignPos | null
  /** Which face of the garment. Absent = front, which is what every pre-per-side row is. */
  side?: string | null
  /**
   * The template this artwork came off — `TPL-…`, or null for artwork somebody dropped.
   *
   * Recorded per line and per SIDE, because that is how a template is chosen: two lines of
   * one order can come off two different recipes. It survives to the factory, so "what else
   * have we cut from this one" is an index lookup rather than a perceptual guess.
   */
  template_id?: string | null }

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
  //
  // ONE PER LINE, AND IT IS THE FRONT. A line now holds a row PER SIDE, so several rows
  // share a key and the last one written would win — meaning the order page could draw the
  // BACK design on the mockup, decided by nothing but row order. Every caller of this map
  // wants "the design for this line" in the singular, and for a garment that is the front.
  //
  // A row with no side is front too: that is what every row written before per-side artwork
  // existed already is (server: coalesce(side,'front')).
  const isFront = (d: OrderDesign) => !d.side || String(d.side).toLowerCase() === "front"
  const put = (k: string, d: OrderDesign) => {
    const cur = by[k]
    // First writer wins UNLESS this one is the front and the sitting one is not — so a line
    // whose only artwork is on the back still resolves to something rather than to nothing.
    if (!cur || (isFront(d) && !isFront(cur))) by[k] = d
  }
  for (const d of list) if (!d?.line_id && d?.sku) put(d.sku, d)
  for (const d of list) if (d?.line_id) put(d.line_id, d)
  return by
}

/**
 * EVERY SIDE OF EVERY LINE — line key → side → design.
 *
 * indexDesigns answers "what does this line look like"; this answers "what is on each face",
 * which is what the designer needs to place artwork per side and what a side list reads. Same
 * keying rule, so the two can never disagree about which line a row belongs to.
 */
export function designsBySide(list: OrderDesign[]): Record<string, Record<string, OrderDesign>> {
  const by: Record<string, Record<string, OrderDesign>> = {}
  const put = (k: string, d: OrderDesign) => {
    const side = String(d.side || "front").toLowerCase()
    if (!by[k]) by[k] = {}
    if (!by[k][side]) by[k][side] = d
  }
  for (const d of list) if (!d?.line_id && d?.sku) put(d.sku, d)
  for (const d of list) if (d?.line_id) put(d.line_id, d)
  return by
}

/** The faces of ONE line, by side name. Same fallback as designForLine: its own, else its sku. */
export function sidesForLine(
  map: Record<string, Record<string, OrderDesign>> | undefined,
  line: { line_id?: string | null; sku?: string | null },
): Record<string, OrderDesign> {
  if (!map) return {}
  return (line.line_id ? map[line.line_id] : undefined) ?? (line.sku ? map[line.sku] : undefined) ?? {}
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
  /** Staff typed this figure instead of taking the tier's list price. */
  overridden?: boolean
  status: "charged" | "estimated" | "tbd"
  /** Every line this ONE fee covers. Both fees pay for work done once — a file is checked
   *  once however many items carry it, a picture is digitised once — so lines sharing a
   *  design are billed together and `name` reads "ab11 +2 items". */
  lines?: { line_id: string | null; sku: string | null }[]
}
export type OrderQuote = {
  /** `supplierCost` is what the BLANK costs us — STAFF ONLY. The server strips it from a
   *  seller's copy of the quote (it names our margin, and across orders our supplier's
   *  price list), so it is absent rather than zero on a seller's request. */
  lines: { id: string; sku: string; name: string; qty: number; size: string | null; unitCost: number; shipFee: number
    /** What unitCost is MADE OF: the blank's price for this size, plus the print method's
     *  surcharge. A $13.50 product quoting $18.50 on an embroidered line is not two prices
     *  — it is the blank and the technique, and the row shows both so they can't read as a
     *  disagreement. */
    baseCost?: number | null; methodFee?: number
    supplierCost?: number | null }[]
  unpriced: { sku: string; name: string }[]
  /** The live fee settings the charge itself reads. `method_side` is what each
   *  ADDITIONAL printed face adds per unit — 0 means a second side is free. */
  fees: { ship_extra: number; method_side?: number }
  subtotal: number
  shipping: number
  units: number
  /** The seller's volume rate for this order, and what it takes off. Off the GOODS only —
   *  never shipping, which is a courier's price and not ours to discount. 0 when there is
   *  no ladder configured or the seller earned no rung, which is the default. */
  volumePct: number
  volumeDiscount: number
  /** What earned the rate: units shipped last period, and the 1-based rung. Null once the
   *  order is charged — `volumeFrozen` — because the stamped rate is then all we know, and
   *  showing this month's units beside last month's charged rate invites them to be read
   *  as one statement. */
  volumeUnits?: number | null
  volumeTier?: number | null
  volumeFrozen?: boolean
  total: number
  charged: number
  balance: number
  /** Design/check fees per line — visible in the Summary; complex ones are TBD until accepted. */
  designFees?: { items: OrderDesignFee[]; total: number }
  /** Σ(supplier cost × qty) over the lines we know a blank cost for. Null = we know none,
   *  which is not the same as zero and must never be subtracted as if it were. STAFF ONLY. */
  supplierTotal?: number | null
  /** How many lines that total actually covers, so a partial figure can say so. */
  supplierKnown?: number
}
export function getOrderQuote(id: string) {
  return api<OrderQuote>(`/api/orders/${encodeURIComponent(id)}/quote`)
}

// Set a line item's variant picks (blank/colour/size/method). Keyed by line_id when
// available, else sku. Rejected (409) once the order is submitted — its cost is frozen.
export function postItemSetup(id: string, body: { line_id?: string; sku?: string; blank?: string; color?: string; size?: string; printType?: string; variant?: string; qty?: number }) {
  return api<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}/item-setup`, {
    method: "POST", body: JSON.stringify(body),
  })
}

/**
 * Add a line to an order that is still being set up. STAFF ONLY, and refused (409) once
 * the order is approved. It adds something to MAKE — the charge was frozen at submit and
 * is not reopened, so an added line is produced and not invoiced.
 */
export function addOrderItem(id: string, body: { name?: string; sku?: string; blank?: string; color?: string; size?: string; printType?: string; qty?: number }) {
  return api<{ ok?: boolean; lineId?: string; error?: string }>(`/api/orders/${encodeURIComponent(id)}/items`, {
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
 * EXTERNAL LABELS — a label that is not one of our orders.
 *
 * Unlinked by design: it touches no order and bills nothing. The expedite fee exists
 * because a seller asked us to rush THEIR order; there is no seller and no order here.
 */
export type DispatchUpload = {
  id: string | number
  /** Their id — the key every status poll goes through. */
  pdf_id: string | null
  file_name: string | null
  /** Their copy of the file, so "open the label" doesn't need us to store it. */
  public_url: string | null
  /** THEIR vocabulary (PENDING / EXTRACTED / …), passed through rather than translated —
   *  a word we invent here can't be matched against what their own dashboard shows. */
  status: string | null
  total_pages: number | null
  /** Null until their extractor has run. Null and 0 mean different things: "not looked
   *  yet" versus "looked and found none". */
  total_labels: number | null
  scanned_labels: number
  labels: { trackingNumber?: string; status?: string; pickedAt?: string }[]
  /** Read off the label PDF by the uploader before it was sent — see lib/label-pdf.ts.
   *  Null whenever the label was an image with no text layer, which is common enough that
   *  the row has to say so rather than show a blank. */
  recipient: string | null
  /** "CITY, ST, ZIP", the same shape the queue prints for a real order's ship-to. */
  ship_to: string | null
  /** The number printed on the label. Distinct from `labels[].trackingNumber`, which is
   *  what byeastside's extractor found — this one exists before they have looked. */
  tracking: string | null
  note: string | null
  created_by: string | null
  created_at: string
  synced_at: string | null
}
export function getDispatchUploads() {
  return api<{ configured: boolean; uploads: DispatchUpload[] }>(`/api/dispatch/uploads`)
}
/** `dataUrl` is a PDF or a JPEG. Anything else the browser can display should be drawn to
 *  a canvas and exported as JPEG first — the server has no image decoder, and their API
 *  refuses images outright, so a JPEG is wrapped in a one-page PDF server-side. */
export function uploadDispatchLabel(body: {
  fileName: string; dataUrl: string; note?: string
  /** What the browser read off the label. Sent because byeastside never returns it — their
   *  extractor deals in tracking numbers — so if we don't carry it across the send, the row
   *  loses its customer and ship-to the moment it stops being a staged file. */
  recipient?: string; shipTo?: string; tracking?: string
}) {
  return api<{ ok?: boolean; upload?: DispatchUpload; error?: string }>(`/api/dispatch/uploads`, {
    method: "POST", body: JSON.stringify(body),
  })
}
export function deleteDispatchUpload(id: string | number) {
  return api<{ ok?: boolean; error?: string }>(`/api/dispatch/uploads/${id}`, { method: "DELETE" })
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
/**
 * The seller's own product photo, as the BACKDROP for one side of one line.
 *
 * A mockup is not artwork and never satisfies the print-file requirement — the ship gate
 * reads order_designs and this writes order_items.mockups, deliberately a different place
 * so no future query can confuse the two. `url` must be a same-origin path from our own
 * upload route; null clears the side and falls back to the catalogue photo.
 */
export function setItemMockup(orderId: string, body: { line_id?: string | null; sku?: string | null; side?: string; url: string | null }) {
  return api<{ ok?: boolean; mockups?: Record<string, string>; error?: string }>(
    `/api/orders/${encodeURIComponent(orderId)}/item-mockup`,
    { method: "POST", body: JSON.stringify(body) },
  )
}
export function postOrderDesign(id: string, body: { sku: string; line_id?: string; /** Which face. Omitted = front, which is what the server assumes. */ side?: string; data: string; name?: string; pos?: DesignPos; kind?: string; phash?: string | null
  /** The template this placement came from. Omitting it LEAVES any id already recorded
   *  alone — the server coalesces — so a routine re-save cannot erase the provenance. */
  template_id?: string | null }) {
  /** `design_no`/`design_id` come back from the save: the number minted for these exact
   *  bytes, or the existing one if this artwork has been seen before (server/design-id.js). */
  return api<{ ok?: boolean; error?: string; design_no?: number | null; design_id?: string | null }>(`/api/orders/${encodeURIComponent(id)}/designs`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}
/**
 * Take the artwork OFF a line — the thing the designer's ✕ only ever pretended to do.
 *
 * `side` absent removes every side on the line; naming one removes just that face. The
 * server decides who may: before submit the order is the seller's, after it the factory's,
 * and admin either way. It does NOT reverse a design charge — that is somebody's decision,
 * not a side effect.
 */
export function deleteOrderDesign(id: string, body: { line_id?: string | null; sku?: string | null; side?: string | null }) {
  return api<{ ok?: boolean; removed?: number; error?: string }>(`/api/orders/${encodeURIComponent(id)}/designs`, {
    method: "DELETE",
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
/** `reason` distinguishes a policy switch from a missing key; `unavailable` means the
 *  server couldn't read its settings at all, which is temporary rather than actionable. */
export function requestAiReply() {
  // `escalated: true` means the thread has an OPEN human handoff — the assistant deliberately
  // stays quiet until a teammate replies, so there's no `reply`. `office` says whether the
  // team is in hours, so the client can show the right "in queue" vs "we're offline" copy.
  return api<{ ok?: boolean; reply?: string; disabled?: boolean; unavailable?: boolean; skipped?: boolean; empty?: boolean; reason?: string; escalated?: boolean; office?: SupportAvailability; error?: string }>(`/api/support/ai-reply`, {
    method: "POST",
    body: "{}",
  })
}
// Private Workbench: ask the personal AI. Reads ONLY the caller's own desk channel +
// their pinned notes. Same disabled/skipped/error shape as the support reply.
export function deskAiReply() {
  return api<{ ok?: boolean; reply?: string; disabled?: boolean; skipped?: boolean; empty?: boolean; reason?: string; error?: string }>(`/api/desk/ai-reply`, {
    method: "POST",
    body: "{}",
  })
}
// ── Image generation (Nano Banana), STAFF ONLY, in the staffer's own "My EG" channel ──
// Every render is real money at Google, so this is deliberately not a seller-facing
// feature: the server gates it with requireStaff and always posts into the CALLER'S own
// thread — there is no thread parameter to point somewhere else.
export type ImageGenModel = {
  id: string; label: string; note: string
  sizes: string[]; defaultSize: string
  /** Per-image USD at the standard tier, keyed by size. */
  usd: Record<string, number>
  /** How many reference photos this model accepts (Pro takes fewer than Flash). */
  maxRefs?: number
}
export type DeskImageConfig = {
  enabled: boolean
  /** Told apart so the UI can name WHICH half is missing rather than "unavailable". */
  keySet: boolean; storageReady: boolean
  model: string; models: ImageGenModel[]
  ratios: string[]; ratioHints: Record<string, string>
  /** What THIS caller pays and what they have left, so a composer can price its button
   *  rather than making someone find out by pressing it. */
  quote?: AiQuote
}
export function getDeskImageConfig() {
  return api<DeskImageConfig>(`/api/desk/image/config`)
}
/** Generates, stores, and posts the image into the caller's own assistant thread.
 *  Returns `ok:false` with a reason rather than throwing, same as the other AI calls. */
export function generateDeskImage(body: {
  prompt: string; aspectRatio?: string; imageSize?: string; model?: string
  /** Bare asset filenames of reference photos already stored for this chat. */
  imageNames?: string[]
}) {
  return api<{ ok?: boolean; attachment?: ChatAttachment; model?: string; size?: string; aspectRatio?: string; usd?: number; refsUsed?: number; disabled?: boolean; overloaded?: boolean; error?: string }>(
    `/api/desk/image`, { method: "POST", body: JSON.stringify(body) })
}

// ── Video generation (Veo 3.1), same staff-only gate and channel as images ────
// A clip takes 1–3 minutes, so POST only STARTS a job and returns; the finished video is
// posted into the thread by the server and arrives the way an AI reply does.
export type VideoGenModel = {
  id: string; label: string; note: string
  resolutions: string[]; defaultResolution: string
  /** Per-SECOND USD, keyed by resolution — multiply by duration for the clip cost. */
  usdPerSec: Record<string, number>
}
export type DeskVideoConfig = {
  enabled: boolean; keySet: boolean; storageReady: boolean
  model: string; models: VideoGenModel[]
  ratios: string[]; ratioHints: Record<string, string>; durations: number[]
}
export function getDeskVideoConfig() {
  return api<DeskVideoConfig>(`/api/desk/video/config`)
}
/** `imageName` is the bare asset filename of an already-generated still — passing it turns
 *  this into image-to-video, so the clip starts from that exact frame. */
export function generateDeskVideo(body: {
  prompt: string; aspectRatio?: string; resolution?: string
  durationSeconds?: number; model?: string; imageName?: string
}) {
  return api<{ ok?: boolean; started?: boolean; jobId?: string; usd?: number; seconds?: number; model?: string; resolution?: string; disabled?: boolean; error?: string }>(
    `/api/desk/video`, { method: "POST", body: JSON.stringify(body) })
}
export function getDeskVideoJob(id: string) {
  return api<{ id: string; status: string; error?: string | null; seconds?: number; model?: string; resolution?: string }>(
    `/api/desk/video/${encodeURIComponent(id)}`)
}

// Staff support inbox: every seller support thread + an AI-drafted reply (not posted).
// `escalated` = the seller asked for a human and no staffer has replied since.
export type SupportThread = {
  order_id: string; seller_id: string; seller_name: string | null
  last: string; last_at: number; n: number; escalated?: boolean
  /** Incoming messages since our last HUMAN reply — the unread badge. Answered threads
   *  report 0, which is what makes the badge mean "needs you" rather than "is long". */
  unanswered?: number
  /** The account's own avatar, so the rail shows the person rather than a generic glyph.
   *  Null for a website visitor — they have no account, and a made-up face is worse than
   *  their initial. */
  avatar_emoji?: string | null; avatar_color?: string | null
}
export function getSupportThreads() {
  return api<SupportThread[]>(`/api/support/threads`)
}

/** The pinned rail channels (factory room, own assistant thread, generations,
 *  announcements) carry the same two things a seller thread does: what was said last,
 *  and how much of it you haven't seen. `unread` is messages since you last had the
 *  channel open — not "unanswered", which means nothing in a room nobody owes a reply in. */
export type ChannelSummary = { id: string; last: string; last_at: number; unread: number }
export function getChannelSummaries(ids: string[]) {
  if (!ids.length) return Promise.resolve([] as ChannelSummary[])
  return api<ChannelSummary[]>(`/api/support/channels?ids=${encodeURIComponent(ids.join(","))}`)
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
  designer_payout?: number; ship_extra?: number; emb_price?: number
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
  /** Where undeliverable parcels go back to, when that isn't the address we ship from.
   *  Null/streetless = unset, and the carrier falls back to the sender. */
  return_address?: ShipFromAddress | null
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
 * thread-matches too, and codes/names/colours carry no cost information.
 */
export function getThreadPalette() {
  return api<ThreadColor[]>(`/api/thread_palette`)
}
/**
 * Save the cone list — the ONE factory setting the floor may change.
 *
 * Its own endpoint rather than setFactorySettings, which is admin-only because it also
 * carries the base markup, the shipping bands and every design fee. The palette is not
 * policy: it is an inventory of what is physically on the rack, and the people at the
 * machines are the ones who know a cone ran out. The server gates it to operator, warehouse
 * and admin, and it writes exactly one settings key — no request shape can reach a fee
 * through it.
 */
export function setThreadPalette(thread_palette: ThreadColor[]) {
  return api<{ ok?: boolean; thread_palette?: ThreadColor[]; error?: string }>(`/api/thread_palette`, {
    method: "PUT", body: JSON.stringify({ thread_palette }),
  })
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
  /** BLIND SHIPPING. When true (the default) the label's sender NAME is the seller's own
   *  shop name instead of `name` above — so a buyer sees the shop they bought from, and two
   *  parcels from two shops don't advertise a shared factory. The address is unaffected.
   *  Only on `ship_from`; a return address is always under our own name. */
  blind?: boolean
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
/** What a SELLER pays us: the three design charges, and the parcel. Served here because
 *  this is the seller-safe fee read every app screen already calls, and a garment price
 *  with no shipping beside it is not the price.
 *
 *  `shipBands` is the FIRST item's fee, by garment class — a cap, a hoodie, everything
 *  else. It replaced a single flat `shipFirst`, which named a platform default that
 *  pricing.js could never reach: one of the three bands always applies, so the flat number
 *  billed nothing while every product page printed it. `shipExtra` is each additional unit
 *  in the same parcel. */
export type ShipBands = { cap: number; heavy: number; garment: number }
export type DesignFees = { standard: number; complex: number; check: number; shipBands?: ShipBands; shipExtra?: number }
export function getDesignFees() {
  return api<DesignFees>(`/api/design_fees`)
}
/** The numeric keys are addressed by name from the settings form, so the body stays
 *  loosely keyed — but the values are narrowed to what the route actually accepts. */
export function setFactorySettings(body: Record<string, string | number | boolean | ShipFromAddress | ProductType[] | ThreadColor[] | undefined>) {
  return api<FactorySettings & { ok?: boolean; error?: string }>(`/api/factory/settings`, { method: "PUT", body: JSON.stringify(body) })
}

/** Update the signed-in user's own profile. `email` is a REPAIR path, not an edit: the
 *  server accepts it only while the stored one isn't a real address (old signups let a
 *  username land in that column), and moves the old identifier into `username` so the
 *  person can still sign in with what they've always typed. 403 otherwise. */
export function updateProfile(patch: { name?: string; username?: string | null; email?: string; avatar_emoji?: string | null; avatar_color?: string | null; notify_sound?: boolean }) {
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
export function createDesignCard(body: {
  title: string; data?: string; type?: string; sku?: string
  /** Which lane it lands in. Validated server-side against design_lanes and falling back to
   *  `incoming` — which is the embroidery designers' own pick-up queue, and therefore the
   *  wrong home for work we have already actioned and handed on. */
  col?: string
}) {
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
/**
 * Classify a line's design work, and optionally price it.
 *
 * `amount` is OPTIONAL and `null` is meaningful: omit it and any stored override is left
 * alone (a plain tier change must not wipe a price somebody typed), pass null to clear it
 * back to the tier's list price, pass a number to override. The server charges — and quotes
 * — whatever this resolves to, so the figure on screen is the figure billed.
 */
export function setDesignTier(orderId: string, body: { tier: DesignTier; amount?: number | null; line_id?: string; sku?: string }) {
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
  /** A stitch preview is already rendered and cached for this card's machine file, so
   *  showing it costs nothing. False ⇒ rendering one is a Wilcom call, so the board waits
   *  to be asked. */
  has_preview?: boolean
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
  /** WHO PUT IT ON THE BOARD, resolved from created_by. Distinct from both of the above:
   *  seller_name is whose order it is, claimed_by is who is working it, this is who sent
   *  it. All three used to be one nameless badge. */
  created_by_name?: string | null
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
/** One card per line that has been sent to the design board, for THIS order. Staff only —
 *  a lane name is factory workflow, not seller-facing status. `lane_label` is resolved
 *  server-side because lanes are renameable. */
export type OrderDesignCard = {
  id: number | string
  line_id?: string | null
  sku?: string | null
  col?: string | null
  lane_label?: string | null
  title?: string | null
  claimed_by?: string | null
  /** Set once the card has been handed to an outside partner ("pinkdesign"), with their
   *  own task reference. Null while our designers hold it. */
  vendor?: string | null
  vendor_ref?: string | null
}
export function getOrderDesignCards(orderId: string) {
  return api<OrderDesignCard[]>(`/api/design_cards/for-order/${encodeURIComponent(orderId)}`)
}
/** The card covering a line: its own, else one filed against the order before lines were
 *  tracked (matched on sku, the same legacy fallback filesForLine uses). */
export function cardForLine(cards: OrderDesignCard[] | undefined, line: { line_id?: string | null; sku?: string | null }): OrderDesignCard | undefined {
  const list = cards ?? []
  return (line.line_id ? list.find((c) => c.line_id === line.line_id) : undefined)
    ?? list.find((c) => !c.line_id && !!c.sku && !!line.sku && c.sku === line.sku)
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

/**
 * ── THE MACHINE-FILE LIBRARY ─────────────────────────────────────────────────
 *
 * A seller's own stitch files, held ONCE and referenced by `MF-<seq>`. Distinct from
 * `design_files`, which is the file ATTACHED to an order line: that store is order-scoped
 * (its endpoint refuses a request without an orderId) and its primary key is caller-supplied,
 * which is exactly the shape a library must not have.
 *
 * The bytes never travel twice. `attachMachineFile` sends an id and a LINE; the server writes
 * a design_files row carrying the same storage key. A 40-line import re-posting an 8MB .EMB
 * per line would be 320MB against a 60MB body limit.
 */
export type MachineFile = {
  id: string
  /** What a person types into a sheet — `MF-12`. */
  ref: string
  seq: number | null
  name: string
  fileName: string | null
  bytes: number | null
  kind: string
  createdAt?: string
  /** Set when an upload matched bytes already in the library — the same id came back. */
  duplicate?: boolean
  error?: string
}
export function getMachineFiles() {
  return api<MachineFile[]>(`/api/machine_files`)
}
/** `data` is a base64 data URL. `fileName` decides the format, so it is not optional: the
 *  server refuses anything that is not a stitch extension. */
export function uploadMachineFile(body: { data: string; fileName: string; name?: string }) {
  return api<MachineFile>(`/api/machine_files`, { method: "POST", body: JSON.stringify(body) })
}
export function renameMachineFile(id: string, name: string) {
  return api<MachineFile & { ok?: boolean }>(`/api/machine_files/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) })
}
export function deleteMachineFile(id: string) {
  return api<{ ok?: boolean; error?: string }>(`/api/machine_files/${encodeURIComponent(id)}`, { method: "DELETE" })
}
/** The bytes, as a data URL. NOT a plain link: every route here is behind a Bearer JWT that
 *  only this module attaches, and an <a href> or window.open() carries no Authorization
 *  header — it lands on 401. Same shape `downloadDesignFile` returns, so one client helper
 *  saves both. */
export function downloadMachineFile(id: string) {
  return api<{ id?: string; name?: string; mime?: string; data?: string; error?: string }>(
    `/api/machine_files/${encodeURIComponent(id)}/download`)
}
/**
 * What a sheet's Machine File ID column points at, per reference.
 *
 * `null` for a reference that does not resolve — which covers "no such file" AND "not
 * yours", deliberately and identically. Two different answers to "does MF-91 exist" is how
 * one seller learns another seller has it.
 */
export function resolveMachineFiles(refs: string[]) {
  return api<Record<string, MachineFile | null>>(`/api/machine_files/resolve`, { method: "POST", body: JSON.stringify({ refs }) })
}
/** Put one library file on ONE order line. The server mints the design id and always writes
 *  `line_id` — a null line means "every line on the order", which is the bug this replaces. */
export function attachMachineFile(id: string, body: { orderId: string; lineId: string }) {
  return api<{ ok?: boolean; designId?: string; ref?: string; fileName?: string; error?: string }>(
    `/api/machine_files/${encodeURIComponent(id)}/attach`, { method: "POST", body: JSON.stringify(body) })
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
/** `reason` is a CODE, not a sentence — 'not-stitch-file', 'not-configured', or whatever EWA
 *  said when a render failed (stored and replayed from cache). The caller turns it into
 *  words; the server keeps it quotable. `error` is used for the outright failures instead. */
export type EmbPreviewResult = { ok: boolean; png?: string; stitches?: number | null; colours?: number | null; unavailable?: boolean; reason?: string; cached?: boolean; error?: string }
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
  /** This row exists only to hold a standalone label — no lines, nothing to produce. It
   *  stays off the production boards and appears in Shipments instead. */
  labelOnly?: boolean
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
/** `restartRequired`: the module using this key snapshots process.env at import, so saving
 *  it does not reach that code until the API restarts. Everything else is live on the next
 *  request. The masked preview updates either way — which is why this flag exists. */
/** `kind` says what the field IS, so the panel stops rendering every setting as a masked
 *  password. Only `secret` is masked; `value` is populated for the others and a real
 *  credential never leaves the server in the clear. */
export type SecretKind = "secret" | "text" | "toggle" | "choice"
export type SecretMeta = { name: string; label: string; integration: string; set: boolean; last4: string | null; masked?: string | null; editable?: boolean; restartRequired?: boolean; kind?: SecretKind; value?: string; options?: { value: string; label: string }[] }
export function getAdminSecrets() {
  return api<{ secrets: SecretMeta[] }>(`/api/admin/secrets`)
}
export function setAdminSecret(name: string, value: string) {
  return api<{ ok?: boolean; name?: string; set?: boolean; last4?: string | null; error?: string; restartRequired?: boolean }>(`/api/admin/secrets`, { method: "PUT", body: JSON.stringify({ name, value }) })
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
/** Etsy's own declaration of who physically made the item. The seller's statement about
 *  their shop — always send it explicitly rather than letting the server fall back. */
export type EtsyWhoMade = "i_did" | "someone_else" | "collective"
export function publishEtsy(body: { connection_id?: string; title: string; description?: string; price: number; quantity?: number; image: string; images?: string[]; tags?: string[]; taxonomy_id?: number | string; colors?: string[]; sizes?: string[]; sku_base?: string; size_prices?: Record<string, number>; blank?: string; designId?: string | number; designUrl?: string; designPos?: unknown; printType?: string; color?: string; size?: string; who_made?: EtsyWhoMade;
  /** "draft" (default) or "active" — whether the listing goes in front of buyers straight
   *  away. Etsy can't activate a listing before its photos exist, so the server creates the
   *  draft, uploads, then flips it; `activation_error` says so if that last step refused. */
  state?: "draft" | "active" }) {
  // `primary_image` is Etsy's OWN url for the cover photo after upload. Prefer it over the
  // source we sent: a local upload is a multi-megabyte data: URL, and storing that as a
  // card thumbnail put a base64 blob in the database on every publish.
  return api<{ listing_id?: number; url?: string; error?: string; state?: string; images_uploaded?: number; primary_image?: string | null; tags_applied?: number; variants_applied?: number; variant_skus?: string[]; variants_error?: string | null; activation_error?: string | null }>(`/api/etsy/publish`, { method: "POST", body: JSON.stringify(body) })
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
/**
 * WHERE A PRODUCT CAN BE PUBLISHED — one row per connected SHOP, not per platform.
 *
 * The dialog used to hardcode three tabs, which states which integrations exist rather
 * than where this seller can actually send a listing. A seller with one Etsy shop saw two
 * tabs they could never use; a seller with two Etsy shops could only reach the first.
 * Render this array and all of those cases are just lengths.
 */
export type PublishDestination = {
  connection_id: string
  platform: "etsy" | "tiktok" | "shopify"
  platform_label: string
  shop_name: string
  shop_id: string
  connected_at?: string
  /** What this shop needs beyond the shared fields. Empty for Etsy and Shopify, which is
   *  why ticking one of those adds no work. */
  extra_fields: string[]
  /** Publishing here creates nothing yet — said on the row, not discovered afterwards. */
  dry_run: boolean
}
/**
 * Ask the assistant to rewrite listing copy. CALLED ON A CLICK, never from an effect —
 * every call costs money and a second of waiting, and a dialog that regenerated copy while
 * you typed would spend both on work nobody asked for.
 *
 * Returns a SUGGESTION. The caller shows it for review; it must not be written straight
 * into the fields, because the copy is the seller's voice and their legal exposure.
 */
export function rewriteListingCopy(body: {
  title?: string; description?: string
  product?: string; colors?: string[]; sizes?: string[]; method?: string
}) {
  return api<{ title?: string; description?: string; error?: string; disabled?: boolean }>(
    `/api/publish/rewrite`, { method: "POST", body: JSON.stringify(body) })
}
/**
 * READ THE COMPETITOR'S PHOTOS AND WRITE A PROMPT FOR OURS.
 *
 * Renders nothing and spends nothing at Google — it returns words for a person to edit.
 * On a click only: the same rule as rewriteListingCopy, because a call that can fire on
 * its own eventually fires forever.
 *
 * `images` are the SAME source strings the publish payload carries (an etsystatic URL, a
 * data: URL, one of our own stored renders); the server resolves them through its one
 * allowlisted resolver, so nothing here can aim a fetch at an arbitrary host.
 */
export function readPhotosForPrompt(body: {
  images: string[]
  title?: string; product?: string; method?: string; colors?: string[]
}) {
  return api<{ prompt?: string; read?: string; photosRead?: number; error?: string; disabled?: boolean }>(
    `/api/publish/photo-prompt`, { method: "POST", body: JSON.stringify(body) })
}

export type ListingRender = {
  /** Same-origin proxy path to the stored render. Publishable as-is — the server reads it
   *  back out of storage rather than fetching itself, so it needs no public bucket. */
  url: string
  model: string; size: string; aspectRatio: string
  /** What GOOGLE cost US. Staff-only — absent for a seller, and never their price. */
  usd?: number
  /** What the caller actually paid, and whether it came out of the free monthly allowance. */
  charged: number; free?: boolean
  /** Set once the backdrop has been lifted off in the browser — the url is then a
   *  transparent PNG data URL rather than the stored JPEG. Client-side only. */
  cutOut?: boolean
  /** The history row this render was filed under. Absent only if that insert failed — the
   *  photo is handed back either way, because it has already been paid for. */
  id?: string
  /** The brief that made it. Kept because coming back to a render you liked is mostly about
   *  coming back to the words that made it. */
  prompt?: string
  createdAt?: string
}

/**
 * EVERY RENDER THIS ACCOUNT HAS PAID FOR, newest first.
 *
 * A GET, and safe to call when the studio opens: it reads a table and spends nothing, which
 * is what separates it from the two POSTs above.
 *
 * Filed against the account the money came out of, so a team member and the owner read one
 * list rather than two halves of one.
 */
export function listListingRenders(limit = 60) {
  return api<{ renders: ListingRender[]; error?: string }>(`/api/publish/photo-history?limit=${limit}`)
}
/**
 * Drop one from the history. The stored photo is NOT deleted — by the time anyone tidies
 * this list the picture may already be live on a listing, and tidying must never be a way
 * to blank a marketplace photo.
 */
export function deleteListingRender(id: string) {
  return api<{ ok?: boolean; error?: string }>(
    `/api/publish/photo-history/${encodeURIComponent(id)}`, { method: "DELETE" })
}
/**
 * Render 1–4 CANDIDATES. Nothing lands in the listing — the caller shows them and a press
 * moves one into the publishable set.
 *
 * Partial success is the normal shape, not an edge case: a daily cap or an empty wallet
 * stops the batch part-way, so `results` and `errors` can both be non-empty and both have
 * to be shown.
 */
export function generateListingPhotos(body: {
  prompt: string
  images?: string[]
  model?: string; aspectRatio?: string; imageSize?: string
  count?: number
}) {
  return api<{ ok?: boolean; results: ListingRender[]; errors: string[]; quote?: AiQuote; error?: string }>(
    `/api/publish/photo-generate`, { method: "POST", body: JSON.stringify(body) })
}
export function getPublishDestinations() {
  return api<{ destinations: PublishDestination[] }>(`/api/publish/destinations`)
}

// Both are read against a SHOP's cipher, so they take the connection they're filling in
// for. Omitted, the server falls back to the caller's first TikTok shop as before.
export function getTiktokCategories(keyword?: string, connectionId?: string) {
  const qs = new URLSearchParams()
  if (keyword) qs.set("keyword", keyword)
  if (connectionId) qs.set("connection_id", connectionId)
  const s = qs.toString()
  return api<{ categories?: TiktokCategory[]; error?: string }>(`/api/tiktok/categories${s ? `?${s}` : ""}`)
}
export function getTiktokWarehouses(connectionId?: string) {
  const qs = connectionId ? `?connection_id=${encodeURIComponent(connectionId)}` : ""
  return api<{ warehouses?: TiktokWarehouse[]; error?: string }>(`/api/tiktok/warehouses${qs}`)
}
export function publishTiktok(body: {
  /** Which connected shop this goes to. Omitted → the caller's first TikTok shop. */
  connection_id?: string
  title: string; description?: string; price: number; quantity?: number
  images?: string[]; tags?: string[]
  colors?: string[]; sizes?: string[]; sku_base?: string; size_prices?: Record<string, number>
  category_id: string; warehouse_id: string; package_weight: string | number; weight_unit?: string
  /** Package size. TikTok validates all three together and refuses the create call when any
   *  is zero or missing — required, not optional, and we sent none of it until now. */
  package_length?: string | number; package_width?: string | number; package_height?: string | number
  dimension_unit?: string
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
/**
 * What WE published — the thing an Uploaded card is actually about.
 *
 * Kept deliberately separate from the `EtsyListing` it was sourced from. Those two sets
 * of numbers look alike and mean opposite things: the source listing's `views` and
 * `num_favorers` belong to a competitor's shop, and rendering them on a card headed by
 * our title would present someone else's sales as ours.
 */
/** Every photo on one of OUR Etsy listings, read live. The publish record keeps a cover
 *  and a count but no list, and a stored list would go stale the moment the seller
 *  reordered photos on Etsy's own form. */
export function getEtsyListingImages(listingId: string | number) {
  return api<{ images?: string[]; error?: string }>(`/api/etsy/listings/${encodeURIComponent(String(listingId))}/images`)
}

/**
 * Publish a product to the caller's OWN Shopify shop, as a draft.
 *
 * Requires the `write_products` scope, which was added after most shops connected — a shop
 * that predates it must RECONNECT before this can succeed, and the server says so by name
 * rather than failing generically.
 */
export function publishShopify(body: {
  connection_id?: string
  title: string; description?: string; price?: number | string | null
  tags?: string[]; images?: string[]
  colors?: string[]; sizes?: string[]
  blank_sku?: string; print_type?: string
  design_id?: string | number; design_data?: string; design_pos?: unknown
  /** "draft" (default) or "active". Shopify takes this at creation. */
  state?: "draft" | "active"
}) {
  return api<{
    ok?: boolean; error?: string
    listing_id?: string; state?: string; url?: string
    images_uploaded?: number; primary_image?: string | null
    variants_applied?: number; variant_skus?: string[]
  }>(`/api/shopify/publish`, { method: "POST", body: JSON.stringify(body) })
}

export type PublishedRecord = {
  platform?: "etsy" | "tiktok" | "shopify"
  /** OUR listing on the marketplace. This is also the key `published_listings` is stored
   *  under, so it's what lets the server join back to the blank and artwork we sent. */
  listing_id?: string
  title?: string
  price?: number | null
  /** The photo that became the listing's cover — what we sent, not what we copied. */
  image?: string
  /** Etsy's own word for it. Every publish lands as `draft`; the seller activates. */
  state?: string
  blank_sku?: string
  blank_name?: string
  print_type?: string
  colors?: string[]
  sizes?: string[]
  variant_skus?: string[]
  variants_applied?: number
  /** Set when the draft published but its inventory PUT was rejected — a flat listing. */
  variants_error?: string | null
  images_uploaded?: number
}
export type UploadedListing = EtsyListing & {
  uploaded_at?: string
  /** The form as it was sent — the whole of it, from one write. Preferred over `product`
   *  when reopening, because that one is reassembled from per-platform rows. */
  submitted?: SubmittedListing
  /** Who pressed publish. Recorded from the first row and surfaced only now — a factory
   *  running several people through one set of shops has to be able to ask. */
  by_name?: string | null
  by_role?: string | null
  our_listing_id?: string
  our_url?: string
  /** Sent by the publish dialog at upload time. */
  published?: PublishedRecord
  /** Joined server-side from `published_listings`, so what we built is still known for
   *  rows written before the dialog carried it — and for any publish path that isn't
   *  this dialog. Authoritative where the two disagree. */
  product?: {
    blank_sku?: string; print_type?: string; color?: string; size?: string; platform?: string
    /** The ARTWORK this was built from, so the record can reopen the publish dialog with
     *  the design already attached. A re-publish without these would make a listing with
     *  the right blank and variants and no design on it. */
    design_id?: string | null; design_data?: string | null; design_pos?: unknown
    /** THE WORDS WE SENT — kept so reopening the publish window doesn't ask for them a
     *  second time. Deliberately named apart from the competitor's title/description that
     *  also ride on this row: mixing them is how a re-publish quietly restores someone
     *  else's copy. */
    title?: string | null; description?: string | null; tags?: string[] | null
  }
}
/**
 * THE LABEL'S BYTES, WITH THE TOKEN ATTACHED.
 *
 * An <iframe src> and an <a href> are plain browser navigations: they carry cookies, and
 * this app authenticates with a Bearer header out of localStorage. So pointing a frame at
 * the label route rendered the route's own refusal — `{"error":"Not signed in"}` — inside
 * the window, which is exactly what a reader would take for a broken label.
 *
 * Fetched properly and handed back as a Blob. The caller makes an object URL from it, which
 * a frame can show and `download` can save, and no token ever appears in a URL.
 */
/** One order this loose parcel might belong to. `score` is why it is ranked where it is —
 *  2 for the address, 2 for an exact name, 1 for a partial — and the two `matched*` flags
 *  are what the UI shows instead of the number, because "address + name" can be checked by
 *  a human and a 4 cannot. `createdAt` is the order's import date: two orders for the same
 *  buyer are told apart by when they arrived. */
export type ShipmentCandidate = {
  id: string
  seq?: number | null
  createdAt?: string | null
  status?: string | null
  factoryStatus?: string | null
  customer?: string | null
  tracking?: string | null
  address: { street?: string; city?: string; state?: string; zip?: string }
  score: number
  matchedZip: boolean
  matchedName: boolean
}
export function getShipmentCandidates(id: string) {
  return api<{
    shipment: { id: string; tracking?: string | null; orderId?: string | null; to: { name?: string; city?: string; state?: string; zip?: string } }
    candidates: ShipmentCandidate[]
    error?: string
  }>(`/api/shipments/${encodeURIComponent(id)}/candidates`)
}
/** Move a loose label onto the order it was really for. The postage is NOT re-booked (it
 *  was charged once already) and the marketplace is NOT told — telling the buyer is its own
 *  decision, not a side effect of fixing our own records. */
export function attachShipmentToOrder(id: string, orderId: string) {
  return api<{ ok?: boolean; orderId?: string; tracking?: string; error?: string }>(
    `/api/shipments/${encodeURIComponent(id)}/attach`,
    { method: "POST", body: JSON.stringify({ orderId }) })
}
/** Take tracking off an order so a correct label can be bought. NOT a refund — the postage
 *  stays bought and stays charged; voiding is the other button and cannot be undone. */
export function detachOrderLabel(orderId: string) {
  return api<{ ok?: boolean; removed?: string; marketplaceWasTold?: boolean; error?: string }>(
    `/api/orders/${encodeURIComponent(orderId)}/label/detach`, { method: "POST" })
}
/** UNDO the above. The postage was never refunded and the label still exists at the carrier,
 *  so unlinking is reversible: the whole label is restored — tracking, PDF, cost and the
 *  provider reference a refund needs. `via` says where it came from ("snapshot" = exactly
 *  what was removed, "provider" = recovered from the carrier by tracking number). Refuses
 *  with 409 if the order has been given a different label in the meantime. */
export function restoreOrderLabel(orderId: string) {
  return api<{ ok?: boolean; tracking?: string; via?: string; cost?: number | null; error?: string }>(
    `/api/orders/${encodeURIComponent(orderId)}/label/restore`, { method: "POST" })
}

export async function fetchShipmentLabel(id: string): Promise<Blob> {
  const token = getToken()
  const res = await fetch(`${baseFor()}/api/shipments/${encodeURIComponent(id)}/label`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json())?.error || msg } catch { /* not json */ }
    throw new ApiError(res.status, msg)
  }
  return res.blob()
}

/** `all` — everyone's, for staff. The server refuses it for a seller, so passing it is
 *  a request rather than a claim: a seller asking still gets only their own. */
export function getSpydeckUploads(all?: boolean) {
  return api<UploadedListing[]>(`/api/spydeck/uploads${all ? "?all=1" : ""}`)
}
/**
 * A locally-uploaded photo reaches us as a `data:` URL that is routinely 2–5MB. Persisting
 * one as a card thumbnail writes a base64 blob into the row — 500 of those is a table that
 * can't be read in one request, and it's the likeliest reason an upload record came back
 * without its image at all. Small ones (an icon, a swatch) are harmless and kept.
 */
const KEEP_INLINE_MAX = 64 * 1024
const persistableImage = (u?: string | null) =>
  (u && u.startsWith("data:") && u.length > KEEP_INLINE_MAX) ? undefined : (u ?? undefined)

/**
 * WHAT WAS ON THE FORM WHEN SEND WAS PRESSED.
 *
 * Kept whole, on the upload row, so reopening a listing restores what you typed rather than
 * what three per-platform rows can be reassembled into. Those rows are written per shop and
 * per shop they differ — TikTok's carries no title, description or tags at all — so the
 * answer to "show me what I sent" was whichever destination happened to run last.
 *
 * Photos are URLs only. A photo picked off the seller's machine is a `data:` URL of several
 * megabytes and persisting one writes a base64 blob into the row (see persistableImage);
 * those are dropped here and re-read from the shop's own listing when the record is opened.
 */
export type SubmittedListing = {
  title?: string
  description?: string
  tags?: string[]
  price?: number | null
  /** URLs, never bytes — a locally-picked photo is put in object storage first and this
   *  holds the /api/spydeck/photo link it came back with. */
  images?: string[]
  /** ~8KB WebP of the cover, so the history card draws instantly and keeps drawing after
   *  the marketplace draft is deleted. See lib/thumbnail.ts. */
  cover_thumb?: string
  colors?: string[]
  sizes?: string[]
  blank_sku?: string
  print_type?: string
  design_id?: string | number
  design_data?: string
  design_pos?: unknown
  at?: string
}

export function recordSpydeckUpload(
  listing: EtsyListing,
  our?: { listing_id?: number | string; url?: string; published?: PublishedRecord; submitted?: SubmittedListing },
) {
  const data = {
    ...listing,
    image: persistableImage(listing.image) ?? null,
    thumb: persistableImage(listing.thumb) ?? null,
    // The source's other photos are only ever competitor CDN links, but a merged record
    // can carry the publish payload's array too — and that one is data: URLs.
    images: (listing.images ?? []).filter((u) => persistableImage(u) !== undefined),
  }
  const published = our?.published
    ? { ...our.published, image: persistableImage(our.published.image) }
    : undefined
  // The form as sent, minus anything too big to keep. Rides in `data` (the server folds it
  // under its own key), so it survives every later destination writing its own result.
  const submitted = our?.submitted && {
    ...our.submitted,
    images: (our.submitted.images ?? []).filter((u) => persistableImage(u) !== undefined),
    design_data: persistableImage(our.submitted.design_data),
  }
  return api<{ ok?: boolean; error?: string }>(`/api/spydeck/uploads`, {
    method: "POST",
    body: JSON.stringify({
      listing_id: String(listing.listing_id), data,
      our_listing_id: our?.listing_id != null ? String(our.listing_id) : undefined,
      url: our?.url,
      published, submitted,
    }),
  })
}
/**
 * Keep a photo we published — the bytes to object storage, a URL back.
 *
 * The one thing standing between the upload history and its pictures: a photo picked off
 * the seller's machine is a multi-megabyte data: URL that must never go in the row. Sent
 * here it becomes an /api/spydeck/photo/<content-hash> link, which is same-origin (so a
 * canvas can still read it) and cannot expire.
 */
export function keepListingPhoto(data: string, name?: string) {
  return api<{ ok?: boolean; url?: string; bytes?: number; error?: string }>(
    `/api/spydeck/photo`, { method: "POST", body: JSON.stringify({ data, name }) })
}

export function deleteSpydeckUpload(listingId: number | string) {
  return api<{ ok?: boolean }>(`/api/spydeck/uploads/${encodeURIComponent(String(listingId))}`, { method: "DELETE" })
}

export type EtsySearchOpts = { sort?: string; sortOrder?: string; limit?: number
  /** How many pages of `limit` to walk, server-clamped to 5. Etsy pages at `offset`,
   *  and asking for one page is why a search for a broad term reported 'Page 1 / 1'. */
  pages?: number
  /** Where the walk starts, in listings. Used to continue a search rather than repeat it. */
  offset?: number
  taxonomyId?: string | number; minPrice?: number; maxPrice?: number }
export function searchEtsy(q: string, opts?: EtsySearchOpts) {
  const p = new URLSearchParams({ q })
  if (opts?.sort) p.set("sort", opts.sort)
  if (opts?.sortOrder) p.set("sortOrder", opts.sortOrder)
  if (opts?.limit) p.set("limit", String(opts.limit))
  if (opts?.pages) p.set("pages", String(opts.pages))
  if (opts?.offset) p.set("offset", String(opts.offset))
  if (opts?.taxonomyId) p.set("taxonomyId", String(opts.taxonomyId))
  if (opts?.minPrice) p.set("minPrice", String(opts.minPrice))
  if (opts?.maxPrice) p.set("maxPrice", String(opts.maxPrice))
  return api<{
    count: number; query: string; results: EtsyListing[]
    /** How many pages actually came back, and whether the walk stopped early on an Etsy
     *  error. `truncated` is the difference between "that is everything" and "that is what
     *  we could get" — the grid must not present the second as the first. */
    pages?: number; truncated?: boolean
  }>(`/api/etsy/search?${p.toString()}`)
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
/**
 * The connect. The response carries MORE than the shop name and the caller needs it.
 *
 * The exchange registers webhooks and runs the first backfill inline, and both are
 * best-effort — a failure there doesn't fail the connection. This type used to declare only
 * `{shop_name, error}`, so `backfill.error` was dropped on the floor and Stores announced
 * "your orders will start syncing" over a sync that had already failed. A store that connects
 * and imports nothing is the failure people actually hit; it must not be reported as success.
 */
export function exchangeShopify(body: { shop: string; code: string; params: Record<string, string>; backfill_days?: number }) {
  return api<{
    shop_name?: string
    error?: string
    scopes?: string
    webhooks?: { topic: string; ok: boolean; error?: string }[]
    backfill?: { error?: string; synced?: unknown[]; count?: number } | null
  }>(`/api/shopify/exchange`, { method: "POST", body: JSON.stringify(body) })
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
  /** TRIAL state — display only. These never feed the upgrade/downgrade maths, which still
   *  reads paid_plan/paid_addon exactly as before. A trial ends by LOCKING, never by
   *  charging, so there is no amount here to price. */
  on_trial?: boolean
  trial_ends_at?: string | null
  trial_used?: boolean
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

/** Admin: grant a free trial. Ends by locking to Starter — it never charges. */
export function grantTrial(body: { userId: string; plan?: string; days?: number }) {
  return api<{ ok?: boolean; plan?: string; days?: number; trial_ends_at?: string; error?: string }>(
    `/api/billing/trial`, { method: "POST", body: JSON.stringify(body) })
}

/** One rung of the volume ladder: ship `minUnits` in a month, earn `pct` the next. */
/** The subscription price list. Admin-editable; the server keeps the constants as defaults. */
export type PlanPrices = { plans: Record<string, number>; spydeck_addon: number }
export function getPlanPrices() {
  return api<PlanPrices>(`/api/billing/prices`)
}
/** How many ACTIVE sellers sit on each plan, and how many carry the SpyDeck add-on — so a
 *  price can be read against what it bills rather than on its own. Deactivated accounts and
 *  staff are excluded server-side: neither is ever renewed. */
export function getPlanCounts() {
  return api<{ plans: Record<string, number>; spydeck: number }>(`/api/billing/plan-counts`)
}
/**
 * `confirm` is the second press on a price CUT. The server answers 409 with `drops` — the
 * changes named one by one — until it arrives, so the guard holds for a stray API call and
 * not only for this dialog.
 */
export function savePlanPrices(body: PlanPrices & { confirm?: boolean }) {
  return api<PlanPrices & { ok?: boolean; error?: string; drops?: string[]; needsConfirm?: boolean }>(`/api/billing/prices`, {
    method: "PUT", body: JSON.stringify(body),
  })
}

export type VolumeTier = {
  minUnits: number
  pct: number
  /** What this rung is CALLED. Optional — blank falls back to its position ("Tier 2"), which
   *  is what every ladder saved before names existed uses. A position renumbers itself when a
   *  rung is inserted below it; a name does not. */
  name?: string | null
}
/** A resolved position on the ladder — what a period earned and what is still winnable. */
export type VolumeStanding = {
  period: string
  /** The month this rate applies TO. Volume is earned in one month and spent in the next. */
  appliesTo: string
  units: number
  pct: number
  /** 1-based for display; 0 means no tier reached yet. */
  index: number
  minUnits: number
  next: VolumeTier | null
  unitsToNext: number | null
}
export type PlanUsage = {
  seller: string | null
  tiers: VolumeTier[]
  /** FALSE while tiers are measured but not yet charged. The UI must say so rather than
   *  implying a discount is already being applied — see /api/plan/usage. */
  applied: boolean
  earned?: VolumeStanding
  running?: VolumeStanding
}
/** `sellerId` is honoured for STAFF only and ignored otherwise, so an admin previewing a
 *  seller reads the exact same route — and therefore the exact same numbers — the seller does. */
export function getPlanUsage(sellerId?: string) {
  return api<PlanUsage>(`/api/plan/usage${sellerId ? `?sellerId=${encodeURIComponent(sellerId)}` : ""}`)
}
export function getVolumeTiers() {
  return api<{ tiers: VolumeTier[] }>(`/api/plan/tiers`)
}
/** Admin only. The server re-normalises whatever it's sent, so it is the one authority on
 *  what a saved ladder means — the client never cleans tiers itself. */
export function saveVolumeTiers(tiers: VolumeTier[]) {
  return api<{ ok?: boolean; tiers: VolumeTier[]; dropped?: number; error?: string }>(
    `/api/plan/tiers`, { method: "POST", body: JSON.stringify({ tiers }) })
}
export type VolumeSeller = VolumeStanding & { sellerId: string; orders: number }
export function getVolumeReport(period?: string) {
  return api<{ period: string; tiers: VolumeTier[]; sellers: VolumeSeller[] }>(
    `/api/plan/volume${period ? `?period=${encodeURIComponent(period)}` : ""}`)
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
  /** The short, readable number shown on the card — `TPL-12`, not the base36 primary key.
   *  Null only on a row written before the column existed and not yet re-read. */
  seq: number | null
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
  /** True when the caller is a team member whose leader has NOT granted 'order_fees'.
   *  The server withholds the amounts rather than the client hiding them, so everything
   *  above arrives empty — treat this as "not allowed to see", never as "nothing was
   *  charged". Those two look identical in the data and mean opposite things. */
  gated?: boolean
}
export function getOrderCharges(id: string) {
  return api<OrderCharges>(`/api/orders/${encodeURIComponent(id)}/charges`)
}
/**
 * Charge a later price adjustment against an order — the other direction of the same money.
 *
 * Admin and warehouse only, enforced server-side. The reason is REQUIRED: it is written onto
 * the ledger row and is what the seller reads on their statement. Refusals worth handling by
 * name: an empty wallet comes back with `shortfall`, which is the number they must top up by.
 */
export function chargeOrderFee(
  id: string,
  body: { amount: number; note: string; clientId?: string }
) {
  return api<OrderCharges & { ok?: boolean; charged?: number; error?: string; shortfall?: number; balance?: number | null }>(
    `/api/orders/${encodeURIComponent(id)}/fee`,
    { method: "POST", body: JSON.stringify(body) }
  )
}
/** `full` refunds everything left; `select` names parts to refund whole; `amount` is
 *  either a figure (spent top-down) or a per-part map. `clientId` makes a double-click
 *  idempotent — the server dedupes on it.
 *
 *  `fee` keeps an amount back: the refund goes out in full and the adjustment is charged
 *  separately, so the seller's statement carries both with their own reasons rather than one
 *  netted figure that matches nothing they were told. It can fail on its own (an empty
 *  wallet) WITHOUT failing the refund — read `fee.error`, never assume both legs landed. */
export function refundOrder(
  id: string,
  body: {
    full?: boolean; select?: string[]; amount?: number | Record<string, number>
    note?: string; clientId?: string
    fee?: { amount: number; note?: string }
  }
) {
  return api<OrderCharges & {
    ok?: boolean
    /** Everything this order has EVER refunded. */
    refunded?: number
    /** What THIS press sent back, and where it went. `refunded` is the running total and is
     *  the wrong number to report after a second refund. */
    refundedNow?: number
    alloc?: { part: string; amount: number }[]
    fee?: { charged?: number; error?: string; shortfall?: number } | null
    error?: string; balance?: number | null
  }>(
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
  return api<{ bySku: Record<string, {
    api: "ss" | "otto" | null; supplier: string | null; source: string
    image?: string | null; variant?: string | null
    /** The supplier catalogue's LAST SYNCED price per unit, or null when it has none.
     *  Never 0 as a stand-in — free and unknown are different facts. It is a reference
     *  figure, not a quote: both suppliers price an order at placement. */
    price?: number | null
  }> }>(
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
  /** One-line destination — street, city, state zip. A loose label has no street, so it
   *  carries city/state/zip only. Null when the order has no address at all. */
  address: string | null
  tracking: string; carrier: string | null; labelUrl: string | null
  /** Shipping service (e.g. "USPS Ground Advantage"), and what the label cost. */
  method: string | null; price: number | null
  /** Postage credited back by a void, as an amount. Null/0 = never voided. */
  refunded: number | null
  /** Bought on a TEST key: real-shaped tracking and price, never actually charged. */
  test: boolean
  /** The number this label carried before it was refunded. `tracking` is cleared on a
   *  refund because it is what asserts the order shipped; this keeps the digits. */
  voidedTracking: string | null
  /** Can the removed tracking be put BACK on this order, and how sure is it?
   *  `"snapshot"` — unlinked since the label is kept in full; restores verbatim.
   *  `"carrier"`  — unlinked by the older code, which kept only the digits; the label has
   *                 to be looked up at the carrier and may not be found.
   *  `null`       — nothing to put back (live, refunded, or never labelled). */
  restorable: "snapshot" | "carrier" | null
  /** THE PROVIDER'S own word — QUEUED / PENDING / SUCCESS / ERROR. Accepting a refund is
   *  not receiving one: Shippo settles up to 14 days later and can still refuse, so a flat
   *  "Refunded" the moment the request lands overstates it. */
  refundStatus: string | null
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
  return api<{
    shipments: ShipmentRow[]
    /** All-time, straight off the ledger — NOT a sum of the rows on screen, which are
     *  capped and search-filtered. Gross: the test slice is reported beside it, not
     *  deducted, because those ledger rows are settled and still say what they say. */
    labelSpend?: number; labelRefunded?: number; labelSpendTest?: number
    labelsBought?: number; labelsVoided?: number; labelsTest?: number
  }>(`/api/shipments?${s.toString()}`)
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
  /** Recipients struck off by hand on the confirm screen. Narrows only — like every other
   *  filter, no combination can widen past role='seller'. */
  excludeIds?: string[]
  /** Addresses typed in that aren't sellers. They get an unsubscribe signed over the
   *  address rather than a user id, which lands in the email suppression list — so the
   *  opt-out is real for someone who has no account. */
  extraEmails?: string[]
}

/**
 * Where a broadcast lands. Two independent places, not two formats of one thing:
 *   "email" — the seller's mailbox: branding, greeting, unsubscribe footer, the lot.
 *   "inapp" — the bell inside the app: title and body only, to someone already signed in.
 * An in-app announcement ignores marketing opt-out, because opting out of marketing EMAIL
 * is not a request to stop being told things by the factory you fulfil through.
 */
export type BroadcastChannel = "email" | "inapp"

/** One resolved recipient. `extra` marks an address typed in rather than a seller. */
export type BroadcastRecipient = { id: string | null; email: string; name: string | null; extra?: boolean }

export type Broadcast = {
  id: string | number
  subject: string
  body: string
  audience: BroadcastAudience
  /** Older rows predate the column and come back as ["email"], which is what they were. */
  channels: BroadcastChannel[]
  status: "draft" | "sending" | "sent" | "failed"
  /** Null until it sends — the count is resolved AT SEND, so a draft honestly has none. */
  recipient_count: number | null
  sent_count: number
  failed_count: number
  /** Bells rung. Kept apart from sent_count so a mixed send can report both honestly. */
  posted_count: number
  /** WHY the send failed, in the transport's own words (an unverified sender, a rejected
   *  key, a rate limit). Null on a clean send. Without it the screen says "failed" and the
   *  one fact that makes it fixable lives only in the server log. */
  last_error: string | null
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
  return api<{
    count: number
    /** The in-app audience — a different number: it includes sellers who opted out of
     *  marketing email and sellers with no usable address, both of whom still have a bell. */
    inAppCount?: number
    optedOut: number
    sample: string[]
    /** Everyone who will be mailed — the confirm screen shows the list, not "first few". */
    recipients?: BroadcastRecipient[]
    /** Addresses that cannot be delivered to. Shown while they're still cheap to fix. */
    invalid?: { id: string | null; email: string }[]
  }>(`/api/broadcasts/preview`, {
    method: "POST", body: JSON.stringify({ audience }),
  })
}
export function createBroadcast(b: { subject: string; body: string; audience?: BroadcastAudience; channels?: BroadcastChannel[] }) {
  return api<Broadcast>(`/api/broadcasts`, { method: "POST", body: JSON.stringify(b) })
}
export function updateBroadcast(id: string | number, b: { subject?: string; body?: string; audience?: BroadcastAudience; channels?: BroadcastChannel[] }) {
  return api<Broadcast>(`/api/broadcasts/${id}`, { method: "PATCH", body: JSON.stringify(b) })
}
export function deleteBroadcast(id: string | number) {
  return api<{ ok: boolean }>(`/api/broadcasts/${id}`, { method: "DELETE" })
}
/** Admin or operator. Returns as soon as the audience is resolved — the send continues
 *  server-side, so poll getBroadcasts() for sent_count rather than expecting this to wait. */
export function sendBroadcast(id: string | number) {
  return api<{ id: string; recipientCount: number; postedCount?: number; status?: string; note?: string }>(`/api/broadcasts/${id}/send`, { method: "POST" })
}

/** One address the send actually attempted, with what happened to it. */
export type BroadcastDelivery = {
  email: string
  name: string | null
  status: "sent" | "failed"
  /** Why it failed, in the transport's words. Null on a delivered one. */
  error: string | null
  /** Typed in at send rather than resolved from a seller record. */
  extra: boolean
  created_at: string
}

/**
 * WHO A SENT BROADCAST ACTUALLY REACHED — the list behind "17 of 18 delivered".
 *
 * Written per address as the send runs, so it is a record of what happened rather than a
 * re-resolution of the audience. Re-resolving would answer a different question (who WOULD
 * be mailed today) and would quietly exclude anyone who unsubscribed since.
 *
 * Empty for broadcasts sent before this was added — their addresses were never recorded and
 * cannot be recovered, which the UI says outright rather than showing an empty list.
 */
export function getBroadcastDeliveries(id: string | number) {
  return api<{ deliveries: BroadcastDelivery[]; sent: number; failed: number }>(`/api/broadcasts/${id}/deliveries`)
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
/** Buyer-PII retention. `due` is how many shipped orders are already past the window —
 *  i.e. exactly what a purge would redact right now. Redaction is irreversible. */
export type PiiRetention = {
  enabled: boolean
  days: number
  due: number
  oldest: string | null
  stamped?: number
  error?: string
}
export function getPiiRetention() {
  return api<PiiRetention>(`/api/pii-retention`)
}
export function setPiiRetention(c: { enabled: boolean; days: number }) {
  return api<{ enabled?: boolean; days?: number; error?: string }>(`/api/pii-retention`, {
    method: "PUT", body: JSON.stringify(c),
  })
}
export function runPiiPurge() {
  return api<{ purged?: number; error?: string }>(`/api/pii-retention/run`, { method: "POST" })
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

// ── Sourcing (admin) — the saved cost book behind Purchasing › Sourcing ──────────────────
// Backed by `manual_suppliers`, which already existed with a full backend (SSRF-guarded URL
// fetching, structured-data price reading, audit trail) and no UI at all. Extended rather
// than replaced: MOQ, inbound freight, lead time and an internal supplier reference are what
// make two quotes actually comparable.
export type SourcingRow = {
  id: string
  title: string
  url?: string | null
  shop?: string | null
  cost?: number | null
  markupPct?: number | null
  sellPrice?: number | null
  productId?: string | null
  note?: string | null
  createdAt?: string
  moq?: number | null
  shipTotal?: number | null
  leadDays?: number | null
  /** internal supplier style, e.g. "sanmar:PC61" — distinguishes an in-app source from a pasted link */
  supplierRef?: string | null
  currency?: string | null
  decorationCost?: number | null
  /** absolute http(s) only — this renders straight into an <img src> */
  image?: string | null
  /** Pipeline stage, DERIVED server-side from sample orders — read-only. A sample placed
   *  makes it 'sampling', a sample received makes it 'rotation'. Sending it back has no
   *  effect except for 'archived', which is a decision rather than an event. */
  stage?: SourcingStage
  /** What was AGREED, as distinct from what the listing quoted. */
  sampleCost?: number | null
  paymentTerms?: string | null
  /** When the supplier last stood behind all of it. A quote from March is not a quote. */
  termsConfirmedAt?: string | null
  archived?: boolean
}
export type SourcingStage = "prospect" | "talking" | "sampling" | "rotation" | "archived"

/** One pasted exchange with a supplier. Kept verbatim — Alibaba's API exposes no messages,
 *  so this is the only copy, and a parser guessing at a price would be confidently wrong
 *  about the one number it exists to remember. */
export type SupplierMessage = {
  id: string
  body: string
  /** YYYY-MM-DD. The day it was said, not the day it was pasted. */
  saidAt?: string | null
  direction: "them" | "us"
  createdAt?: string
}
export function getSupplierMessages(supplierId: string) {
  return api<{ items?: SupplierMessage[]; error?: string }>(
    `/api/manual-suppliers/${encodeURIComponent(supplierId)}/messages`)
}
export function addSupplierMessage(supplierId: string, p: { body: string; saidAt?: string; direction?: "them" | "us" }) {
  return api<{ ok?: boolean; id?: string; error?: string }>(
    `/api/manual-suppliers/${encodeURIComponent(supplierId)}/messages`,
    { method: "POST", body: JSON.stringify(p) })
}
export function deleteSupplierMessage(supplierId: string, msgId: string) {
  return api<{ ok?: boolean; error?: string }>(
    `/api/manual-suppliers/${encodeURIComponent(supplierId)}/messages/${encodeURIComponent(msgId)}`,
    { method: "DELETE" })
}
export const SOURCING_STAGES: { id: SourcingStage; label: string; hint: string }[] = [
  // Every hint names the FACT that puts a row here, because the stage is derived and not
  // chosen — see stageSql in server/src/routes/manual_suppliers.js.
  //
  // THE ids AND THE labels DELIBERATELY DIVERGE. The id is what the database and the
  // derivation speak ('prospect', 'rotation'), and one of them — 'archived' — is a value
  // actually stored on rows today; renaming ids would be a migration bought for nothing.
  // The label is what a person reads, and each one now describes the ACT rather than a
  // sales-funnel position: you saved it, you got in touch, you sampled it, you approved it.
  // "Prospect" was the worst of them — jargon for "nothing has happened yet".
  //
  // "Quoted" was considered for the first stage and rejected: a row can be saved with no
  // unit price at all, and most are, so it would be false on exactly the rows it labels.
  { id: "prospect", label: "Saved", hint: "saved to compare — nothing has happened yet" },
  { id: "talking", label: "In touch", hint: "an exchange recorded, no sample yet" },
  { id: "sampling", label: "Sampling", hint: "a sample is placed and not yet received" },
  { id: "rotation", label: "Approved", hint: "a sample was received" },
]
/** Ask the AI what this product is and how to search for it on a B2B marketplace. Admin-only,
 *  charged per call, and cached server-side against the listing id — so re-opening a product
 *  you already looked at is free. */
export function suggestSuppliers(p: { listingId?: string; title: string; image?: string | null }) {
  return api<{ productType?: string | null; material?: string | null; attributes?: string[]
               queries?: string[]; podBlank?: boolean; note?: string | null; cached?: boolean
               error?: string }>(
    `/api/manual-suppliers/suggest`, { method: "POST", body: JSON.stringify(p) })
}
/**
 * A sample order placed against a sourcing prospect.
 *
 * `amount` is what it cost, in USD, and it is already booked to the FACTORY wallet — this
 * record is the paperwork around that ledger row, not a second copy of the money.
 */
export type SampleOrder = {
  id: string
  supplierId?: string | null
  supplierTitle?: string | null
  /** The SUPPLIER's own order number — the handle you quote back at them. */
  orderNo?: string | null
  amount?: number | null
  qty?: number | null
  note?: string | null
  status: "placed" | "received" | "cancelled"
  /** 'alibaba' when imported from a real order, 'manual' when typed in. */
  source?: string
  tradeId?: string | null
  sellerEid?: string | null
  sellerName?: string | null
  placedAt?: string
  receivedAt?: string | null
  cancelledAt?: string | null
}
/** One of OUR buyer orders on Alibaba, as the picker lists them. Thin by their design —
 *  the list call returns only these four facts; everything else is in the detail call. */
export type AlibabaOrderSummary = {
  tradeId: string
  status: string
  statusLabel: string
  createdAt?: string | null
  updatedAt?: string | null
}
export type AlibabaOrderItem = {
  name?: string | null
  productId?: string | null
  skuId?: string | null
  modelNumber?: string | null
  image?: string | null
  qty?: number | null
  unitPrice?: number | null
  variant?: string | null
}
export type AlibabaOrderDetail = AlibabaOrderSummary & {
  /** The buyer's own note on the order — often what tells you it was a sample. */
  remark?: string | null
  sellerName?: string | null
  /** Alibaba's encrypted supplier id. The ONLY supplier identity their API gives us, and
   *  what a link straight to the supplier's chat is built from. */
  sellerEid?: string | null
  currency?: string
  productTotal?: number | null
  shipmentFee?: number | null
  total?: number | null
  tradeTerm?: string | null
  items: AlibabaOrderItem[]
}
export function getAlibabaOrders() {
  return api<{ total?: number; orders?: AlibabaOrderSummary[]; error?: string }>(`/api/alibaba/orders`)
}
export function getAlibabaOrder(tradeId: string) {
  return api<AlibabaOrderDetail & { error?: string }>(`/api/alibaba/orders/${encodeURIComponent(tradeId)}`)
}
/**
 * Place an order on Alibaba. DRY RUN unless the server's ALIBABA_ORDER_LIVE=1 AND
 * `confirm: true` is sent — two gates, because unlike S&S and Otto, Alibaba has no sandbox
 * and the first call that succeeds is a real purchase.
 *
 * `logisticsDetail` is required by them and refused rather than defaulted here: there is no
 * delivery address this code could pick that would be right by accident.
 */
export function createAlibabaOrder(p: {
  productId: string; quantity: number; skuId?: string; message?: string
  logisticsDetail: Record<string, unknown>; confirm?: boolean
}) {
  return api<{ ok?: boolean; dryRun?: boolean; note?: string; payload?: unknown
               alibabaResponse?: unknown; error?: string; code?: string }>(
    `/api/alibaba/order/create`, { method: "POST", body: JSON.stringify(p) })
}

export function getSampleOrders(supplierId?: string) {
  const qs = supplierId ? `?supplierId=${encodeURIComponent(supplierId)}` : ""
  return api<{ items: SampleOrder[] }>(`/api/sample-orders${qs}`)
}
/** Records the order AND books its cost to the factory wallet, at place time. `booked`
 *  reports whether the ledger write actually landed — costs.js is best-effort by design,
 *  and a sample recorded with its cost silently unbooked is the failure to catch. */
export function placeSampleOrder(p: { supplierId?: string; orderNo: string; amount: number; qty?: number; note?: string
                                     tradeId?: string; sellerEid?: string; sellerName?: string }) {
  return api<{ ok?: boolean; id?: string; booked?: boolean; items?: SampleOrder[]; error?: string }>(
    `/api/sample-orders`, { method: "POST", body: JSON.stringify(p) })
}
/** `received` moves no money — it already moved when the sample was placed. `cancel`
 *  appends a credit rather than erasing the debit. */
export function setSampleOrderStatus(id: string, action: "received" | "cancel") {
  return api<{ ok?: boolean; credited?: boolean; items?: SampleOrder[]; error?: string }>(
    `/api/sample-orders/${encodeURIComponent(id)}/${action}`, { method: "POST" })
}
export function getSourcing() {
  return api<{ items: SourcingRow[] }>(`/api/manual-suppliers`)
}
/** `confirmTerms` stamps terms_confirmed_at with today. Deliberately separate from the
 *  fields themselves — fixing a typo in the payment terms must not claim the supplier
 *  re-confirmed anything. */
export function saveSourcing(row: Partial<SourcingRow> & { title: string; confirmTerms?: boolean }) {
  return api<{ ok?: boolean; id?: string; error?: string }>(
    `/api/manual-suppliers`, { method: "POST", body: JSON.stringify(row) })
}
/** Archives by default — a saved source is often the only record of where a blank came from. */
export function deleteSourcing(id: string, hard = false) {
  return api<{ ok?: boolean; error?: string }>(
    `/api/manual-suppliers/${encodeURIComponent(id)}${hard ? "?hard=1" : ""}`, { method: "DELETE" })
}
/**
 * Read a listing page: price, title and image, in one safe server-side fetch.
 * Never writes — the caller decides what to keep. `ok:false` still carries title/image when
 * only the PRICE was unreadable, which is the common case on shops that render it in JS.
 */
export function fetchSourcingPrice(url: string) {
  return api<{ ok?: boolean; price?: number; found?: number; title?: string | null
               image?: string | null; why?: string; error?: string }>(
    `/api/manual-suppliers/price`, { method: "POST", body: JSON.stringify({ url }) })
}
