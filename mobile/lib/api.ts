import Constants from "expo-constants"
import * as SecureStore from "expo-secure-store"
import { remember } from "@/lib/order-cache"

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

/**
 * WHO IS SIGNED IN. `/api/me` used to answer with the decoded JWT, which carries only
 * sub/role/email — so `name` was always undefined and there was no username at all. It
 * reads the users row now, so these fields are real.
 */
export type User = {
  id?: string
  sub?: string
  name?: string | null
  /** The second way to sign in. Null on an account that only has an email. */
  username?: string | null
  email?: string | null
  role?: string
}
export type OrderItem = {
  id?: string
  qty?: number | null
  /** The marketplace listing SKU — carries a print-method suffix (-EMB, -DTG …). */
  sku?: string | null
  /** The BLANK the stock is held against. Not the same thing as `sku`, and the one that
   *  matters on the floor: stock, purchasing and the supplier all key off this. */
  blank?: string | null
  name?: string | null
  color?: string | null
  size?: string | null
  /** A plain URL when the artwork is stored remotely… */
  img?: string | null
  /** …and a RELATIVE path when it is a data URL the server split out to keep the list
   *  small. Needs the API origin in front of it; see `assetUrl`. */
  img_ref?: string | null
  /** LINE IDENTITY. Two lines of the same SKU are two different jobs, and the server keys
   *  item-status and item-setup on this whenever it is present — keying on sku alone moved
   *  identical-SKU siblings together, which is routine on an Etsy order. */
  line_id?: string | null
  /** The decoration method (EMB / DTG / DTF …). Blank means an undecorated blank, which
   *  needs no artwork — so it must not be shown as a line that is missing its file. */
  print_type?: string | null
  /** The line's OWN stage. Production is per item: one line can be printing while another
   *  waits. The order's stage is a different (and coarser) fact. */
  factory_status?: string | null
  /** Artwork the seller supplied as a URL, rather than bytes we stored. */
  design_src?: string | null
}

/**
 * ONE STORED FILE for one line — what /api/orders/:id/designs hands back.
 *
 * `kind` is 'raster' for the artwork image and 'pes'/'emb'/'dst' for a stitch file, and
 * `side` is front/back/sleeve. Together with line_id they are what makes "which file
 * belongs to which item" answerable — a flat list of an order's files is not, because two
 * lines of the same order routinely carry different artwork on the same side.
 */
export type OrderDesign = {
  sku?: string | null
  line_id?: string | null
  kind?: string | null
  side?: string | null
  name?: string | null
  /** A URL either way: the server mints a same-origin address for stored bytes and passes
   *  a data URL through for rows that predate storage. Both go straight into an <Image>. */
  data?: string | null
  url?: string | null
  /** `D-XXXXXXXX` — the artwork's content hash, short enough to read aloud. The SAME picture
   *  carries the same id on every order it appears on, which is what makes "have we cut this
   *  one before" answerable. Null on rows that predate hashing. */
  design_id?: string | null
}

/** Absolute URL for a path the API returned relative (thumbnails). Bare `img` values are
 *  already absolute and pass through untouched. */
export const assetUrl = (u?: string | null) =>
  !u ? null : /^https?:\/\//i.test(u) ? u : `${API_BASE}${u.startsWith("/") ? "" : "/"}${u}`
export type Order = {
  id: string
  num?: string | null
  seq?: number | null
  factory_status?: string | null
  /** The FACTORY's own order, not a seller's. Decides which stage line applies: `in_review`
   *  ("Pending") means a seller submitted and was charged, so it is not a position a
   *  factory order can occupy. See nextStage in lib/orders.ts. */
  factory_order?: boolean | null
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
  /** The buyer's address. STAFF ONLY in full — the server masks it to city/state/country
   *  for a seller (maskBuyerPII), which is why buying a label is a staff action: the fields
   *  a carrier needs are the ones a seller is never sent. */
  address?: ShipAddress | null
  /** Who the order is for. Masked to a name alone for a seller on a marketplace order. */
  customer?: { name?: string | null; email?: string | null; masked?: boolean } | null
  /** The carrier's label PDF. STAFF ONLY — the server nulls it for a seller, because the
   *  buyer's full address is printed on it and every masked field above would otherwise be
   *  cosmetic. So a missing value here is a permission, not an error. */
  tracking_label_url?: string | null
}

/* ── Shipping ─────────────────────────────────────────────────────────────────
 * ALWAYS THROUGH THE AGGREGATOR. `/api/shipping/rates` and `/api/shipping/label` rate-shop
 * across whichever of Shippo/EasyPost is configured; the USPS-direct path is a different
 * route and taking it by accident is where "we can't validate your credit card" comes from
 * (a USPS EPS billing error for an account the aggregator never touches).
 */
export type ShipAddress = {
  name?: string | null; street1?: string | null; street?: string | null; street2?: string | null
  city?: string | null; state?: string | null; zip?: string | null; country?: string | null
  phone?: string | null; email?: string | null
  /** Present when the server redacted it — a seller reading their own order. Never enough
   *  to buy a label with, and the reason this screen is staff-only. */
  masked?: boolean
}
export type ShippingRate = {
  token: string; provider: string; carrier: string; service: string
  amount: number; currency?: string; days?: number | null; carrierAccount?: string
}
/** The parcel. The server defaults to 9×6×2 at 8oz when a field is missing, so the phone
 *  sends what it knows and never blocks on a dimension nobody has measured. */
export type Parcel = { weightOz?: number; length?: number; width?: number; height?: number }

export const getShippingRates = (orderId: string, to: ShipAddress, parcel: Parcel = {}) =>
  request<{ rates?: ShippingRate[]; errors?: string[]; error?: string }>("/api/shipping/rates", {
    method: "POST",
    body: JSON.stringify({ orderId, to, parcel }),
  })

/**
 * Buy ONE rate — through the SAME route the web uses, because of what that route does
 * besides buying.
 *
 * This posted to /api/shipping/label, which buys a label and books NOTHING. The web posts
 * to /api/usps/label, and that one calls recordLabel(): postage lands in wallet_ledger as
 * `label-cost` factory spend, the order's factory stage advances, the marketplace is told,
 * and it is audited. Same aggregator underneath — `rateToken` keeps it off the USPS-direct
 * path — but every consequence of buying was missing, so a label bought on the phone was
 * money spent that no report could see. dispatch.js carries a backfill that sweeps up
 * exactly these orphans, which is evidence this has happened before rather than a reason
 * to rely on it.
 *
 * `street` as well as `street1`: shipping.js reads either, usps.js validates `to.street`,
 * and an address that satisfied one route would have been rejected by the other.
 *
 * `from` is deliberately not sent — usps.js resolves the ship-from for the order itself
 * (blind shipping puts the seller's shop name at our address), and a phone carrying its own
 * copy would print the wrong return address after an office move.
 */
export const buyShippingLabel = (orderId: string, rate: ShippingRate, to: ShipAddress) =>
  request<{ ok?: boolean; error?: string; labelUrl?: string; trackingNumber?: string; carrier?: string; cost?: number }>(
    "/api/usps/label",
    {
      method: "POST",
      body: JSON.stringify({
        orderId,
        to: { ...to, street: to.street || to.street1, street1: to.street1 || to.street },
        rateToken: rate.token,
        rate: { amount: rate.amount, carrier: rate.carrier, service: rate.service, carrierAccount: rate.carrierAccount },
      }),
    },
  )

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
/**
 * Both order fetchers REMEMBER what they returned (lib/order-cache.ts), so the detail screen
 * can paint from memory the instant it slides in instead of showing a spinner for data the
 * list already had. Done here rather than in the screens so a list added later cannot forget.
 */
export const getOrders = async () => {
  const rows = await request<Order[]>("/api/orders")
  remember(rows)
  return rows
}
export const getOrder = async (id: string) => {
  const o = await request<Order>(`/api/orders/${encodeURIComponent(id)}`)
  remember(o)
  return o
}
export const getWallet = () => request<WalletResponse>("/api/wallet")

/*
 * INVENTORY SCAN — the same endpoint the warehouse station on the web posts to.
 *
 * The code on a label carries a SKU: ours, or the internal EG-… one printed at receiving
 * for consigned stock. The server resolves both, so the phone sends the scanned string
 * through untouched rather than deciding what kind of code it is.
 */
export type ScanResult = {
  ok?: boolean
  error?: string
  sku?: string
  in_stock?: number
  name?: string | null
}
export const scanInventory = (sku: string, direction: "in" | "out", qty = 1) =>
  request<ScanResult>("/api/inventory/scan", {
    method: "POST",
    body: JSON.stringify({ sku, direction, qty }),
  })

/**
 * Move an order's factory stage.
 *
 * The SERVER decides whether the move is allowed — stageDenial() refuses a skip for
 * everyone including admin, and refuses a stage outside a role's reach. The phone offers
 * only the next step and reports whatever comes back; re-deciding any of that here is how
 * the floor and the phone would come to disagree about who may do what.
 */
export const setOrderStage = (id: string, factoryStatus: string) =>
  request<{ ok?: boolean; error?: string }>(`/api/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ factoryStatus }),
  })

/**
 * Move ONE LINE's stage — the per-item flag the whole floor works from.
 *
 * This, not the order-level PATCH, is what "start" means on a phone: production is per
 * item, so a three-line order is three jobs and the person holding one of them should not
 * have to move the other two to record what they did.
 *
 * Addressed by line_id when the line has one, exactly as the server prefers: a marketplace
 * line with a NULL sku matches nothing, and identical-SKU siblings move together.
 */
export const setItemStatus = (
  id: string,
  line: { line_id?: string | null; sku?: string | null },
  status: string,
) =>
  request<{ ok?: boolean; error?: string; blockers?: string[] }>(
    `/api/orders/${encodeURIComponent(id)}/item-status`,
    { method: "POST", body: JSON.stringify({ line_id: line.line_id ?? undefined, sku: line.sku ?? undefined, status }) },
  )

/** Every stored file on the order, addressed by line. See OrderDesign. */
export const getOrderDesigns = (id: string) =>
  request<OrderDesign[]>(`/api/orders/${encodeURIComponent(id)}/designs`)

/**
 * TOP-UPS — a seller says they have sent money; staff confirm it actually arrived.
 *
 * Staff get everyone's, newest first; a seller gets only their own. The statuses are
 * `pending` (waiting on a human), `received` (confirmed — the wallet is credited at that
 * moment, append-only and idempotent on the top-up id, so confirming twice cannot
 * double-credit), `rejected` (money never came) and `abandoned` (an unpaid window aged out).
 */
export type Topup = {
  id: string
  seller_id?: string | null
  seller_name?: string | null
  seller_email?: string | null
  amount_usd?: number | string | null
  amount_vnd?: number | string | null
  method?: string | null
  status?: "pending" | "received" | "rejected" | "abandoned" | string
  note?: string | null
  ref?: string | null
  created_at?: string
  confirmed_at?: string | null
}
export const getTopups = (status?: string) =>
  request<Topup[]>(`/api/topups${status ? `?status=${encodeURIComponent(status)}` : ""}`)

/**
 * CONFIRM — the money arrived. This CREDITS THE SELLER, so it is the single most
 * consequential button in the phone app.
 *
 * `fee` is the transfer cost, and it is optional because it is only knowable now, by the
 * person looking at what actually landed — the corridor, the bank and the day's FX decide
 * it. It books as its OWN debit rather than being netted off, because crediting $980 for a
 * $1,000 transfer shows the seller a number they cannot reconcile against what they sent.
 */
export const confirmTopup = (id: string, fee?: number) =>
  request<Topup>(`/api/topups/${encodeURIComponent(id)}/confirm`, {
    method: "POST", body: JSON.stringify(fee && fee > 0 ? { fee } : {}),
  })

/** REJECT — the money never came. No credit, and the seller's wallet shows it as rejected. */
export const rejectTopup = (id: string) =>
  request<Topup>(`/api/topups/${encodeURIComponent(id)}/reject`, { method: "POST" })

/**
 * THE STITCH FILE, RENDERED — Wilcom TrueView of what the machine will actually sew.
 *
 * This is the right-hand pane of the check: the mockup says what it should look like, this
 * says what the file will produce. They are different claims and the whole point is seeing
 * them together before a garment is hooped.
 *
 * `unavailable` is a NORMAL outcome, not an error — Wilcom unconfigured, the file not a
 * stitch format, or EWA refusing a protected .EMB. The caller says which of those it is
 * rather than showing a broken image, because "cannot be read" and "does not exist" are
 * different problems on the floor.
 *
 * Server-side it is cached by design and content hash, so re-opening an order costs nothing.
 */
export type EmbPreview = {
  ok: boolean
  /** Base64 PNG, no data: prefix. */
  png?: string
  stitches?: number | null
  colours?: number | null
  /** Millimetres — the number that answers "does it fit the hoop". */
  width?: number | null
  height?: number | null
  /** The machine the format is native to, as EWA reports it ("Tajima", "Melco"). */
  machine?: string | null
  /** Extension of the file that was rendered, e.g. "DST". */
  format?: string | null
  unavailable?: boolean
  reason?: string
  error?: string
}
export const getEmbPreview = (body: { orderId?: string | null; sku?: string | null; designId?: string }) =>
  request<EmbPreview>("/api/wilcom/design-preview", { method: "POST", body: JSON.stringify(body) })

/**
 * THE LABEL PDF, THROUGH US — the address to hand a printer.
 *
 * NOT `order.tracking_label_url`. That is the carrier's or the aggregator's own CDN and it
 * is not always a fetchable address at all: the USPS-direct path stores the bytes as a
 * `data:` URL, which no opener and no print module can resolve. `/api/shipments/:id/label`
 * normalises both — it decodes an inline label and streams a remote one back same-origin,
 * with the real content-type, so the caller gets a file either way.
 *
 * Staff only (the PDF carries the buyer's full address), so it needs the Bearer token —
 * see printOrderLabel in lib/print-label.ts, which is the only caller.
 */
export const labelFileUrl = (id: string) =>
  `${API_BASE}/api/shipments/${encodeURIComponent(id)}/label`

/**
 * Stamp the label as printed — a custody claim, so WAREHOUSE OR ADMIN only.
 *
 * The 403 is the server's and is worth showing rather than hiding the button: an operator
 * who opened the label did a real thing, and telling them who may stamp it is more use
 * than a control that silently is not there.
 */
export const markLabelPrinted = (id: string, undo = false) =>
  request<{ ok?: boolean; error?: string; label_printed_at?: string | null }>(
    `/api/orders/${encodeURIComponent(id)}/label-printed`,
    { method: "POST", body: JSON.stringify({ undo }) },
  )

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
/**
 * TOP-UP REQUESTS — the thing the ledger cannot tell you.
 *
 * The phone showed top-up history off wallet_ledger, and a ledger row is only written when
 * the money LANDS. So a request that has been created and not yet paid — the seller saved
 * the QR, left for their banking app, came back — was structurally invisible: no row, no
 * trace, nothing to say a payment was in flight.
 *
 * The server already keeps these and already answers correctly for both sides: staff see a
 * VietQR row only once it is PAID, because an unpaid one is nothing for them to act on,
 * while the seller keeps ALL of theirs including abandoned ones. Nothing was removed from
 * the seller — the phone simply never asked.
 *
 * `abandoned` is a real status here even though the type above does not name it: closing
 * the QR marks the request abandoned so it leaves the admin queue, and the seller still
 * sees it because the virtual account is live and the reference still settles. It is an
 * unpaid payment they can still make, not rubbish.
 */
export type TopupRequest = {
  id: string
  amount_usd: number | string
  vnd?: number | string | null
  method?: string | null
  ref?: string | null
  status: "pending" | "received" | "rejected" | "abandoned" | string
  created_at: string
  /* The QR, kept on the row so an unpaid request can be OPENED AGAIN rather than replaced.
     A VietQR request is a virtual account minted for one payment — creating another mints a
     second account for the same money, which is how one transfer ends up unmatched. */
  qr_code?: string | null
  qr_content?: string | null
  bank_code?: string | null
  va_account?: string | null
  receiver_name?: string | null
}
export const getMyTopups = () => request<TopupRequest[]>("/api/topups")

export const getTopupConfig = () => request<TopupConfig>("/api/vietqr/rate")
export const createVietqrPayment = (amount: number, amountUsd?: number) =>
  request<VietqrPayment>("/api/vietqr/create-payment", {
    method: "POST",
    body: JSON.stringify({ amount, amountUsd }),
  })
/** Tell the server nobody is going to pay this one, so it stops sitting in the admin queue
 *  and the seller's history. The virtual account stays live and a late payment still
 *  reconciles — this only hides a request nobody acted on. */
export const abandonVietqr = (ref: string) =>
  request<{ ok?: boolean; abandoned?: number }>("/api/vietqr/abandon", {
    method: "POST",
    body: JSON.stringify({ ref }),
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
