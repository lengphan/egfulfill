/**
 * ORDER RULES — one copy, imported by every surface.
 *
 * These lived in three places: web/lib/factory-status.ts, web/lib/order-filter.ts and a
 * hand-kept mirror in mobile/lib/orders.ts, all mirroring PIPELINE and normalizeStage in
 * server/src/routes/orders.js. In one day that produced three silent divergences — the
 * phone folded `awaiting_scan` onto a stage the server had retired, called shipped orders
 * late forever, and counted on-hold orders as open. None failed loudly. Each was found by
 * diffing, not by anyone noticing a wrong number, which is exactly how a copy fails: it
 * disagrees quietly and both sides look right.
 *
 * The server is still authoritative — it is the only one that can refuse a move — and this
 * file mirrors it deliberately. Changing the ladder still means changing orders.js too.
 * What it removes is the SECOND and THIRD copy on the client side.
 */

/** The production line, in order. A stage move goes one step along it, never a jump. */
export const PIPELINE = ["in_review", "approved", "working", "shipped"] as const
export type Stage = (typeof PIPELINE)[number] | "" | "on_hold" | "cancelled" | "refunded"

/** Off-pipeline states: reached by a decision, not by advancing. */
export const EXCEPTIONS = ["on_hold", "cancelled", "refunded"] as const

/** Retired ids that all meant "accepted and being made", whatever step they were named
 *  after. `awaiting_scan` is among them: label state is read from label_scanned_at. */
const RETIRED_WORKING = [
  "ready_print", "in_queue", "queued", "prescan", "printed", "label", "labelled", "labeled",
  "awaiting_scan", "awaiting-scan", "scanned", "printing", "qc", "production", "in_production",
  "in-prod", "prepress", "packing", "packed", "ready", "finished",
]

/** Mirrors normalizeStage() in server/src/routes/orders.js. "" means nobody has started. */
export function normalizeStage(s?: string | null): string {
  const v = String(s ?? "").toLowerCase().trim()
  if (["new", "draft", "none", "pending", ""].includes(v)) return ""
  if ((PIPELINE as readonly string[]).includes(v) || (EXCEPTIONS as readonly string[]).includes(v)) return v
  if (RETIRED_WORKING.includes(v)) return "working"
  if (["fulfilled", "delivered", "in_transit"].includes(v)) return "shipped"
  if (["flagged", "escalated", "action", "backorder", "replacement"].includes(v)) return "on_hold"
  return ""
}

/** The FACTORY's words. A seller sees collapsed stages and different words — see
 *  web/lib/order-status.ts. Two vocabularies on purpose; mixing them is the mistake. */
export const STAGE_LABEL: Record<string, string> = {
  "": "New",
  in_review: "Pending",
  approved: "Approved",
  working: "Working",
  shipped: "Shipped",
  on_hold: "On hold",
  cancelled: "Cancelled",
  refunded: "Refunded",
}

/** NORMALISES FIRST, deliberately. Callers pass a raw `factory_status` straight off a row as
 *  often as they pass a canonical id, and a legacy value like `backorder` IS an exception —
 *  it just isn't spelled like one until normalizeStage folds it onto on_hold. Idempotent, so
 *  the internal callers below that already hold a normalised id are unaffected. */
export const isException = (stage?: string | null) =>
  (EXCEPTIONS as readonly string[]).includes(normalizeStage(stage))

/** OPEN = still ours to do. Not shipped, and not parked in an exception. */
export function isOpenStage(stage: string): boolean {
  return !isException(stage) && stage !== "shipped"
}

/* ── THE LADDER, AND WHO MAY CLIMB IT ─────────────────────────────────────────
 *
 * Everything to the end of this section was three copies until now: web/lib/factory-status.ts
 * (canonical), a port in mobile/lib/orders.ts, and stageDenial() in server/src/routes/orders.js.
 * The server one STAYS — it is the only one that can actually refuse a move, and a client
 * copy exists so a control can be greyed WITH ITS REASON instead of being pressed and failing.
 * What is gone is the second client copy. The two that remain are checked against each other
 * by tools/stage-gate-diff.mjs, which executes both over the whole role × stage matrix.
 */

/**
 * TWO LINES, because "Pending" is a SELLER stage and not a step of making anything.
 * Mirrors SELLER_LINE / FACTORY_LINE in server/src/routes/orders.js.
 */
export const SELLER_LINE: readonly string[] = ["", ...PIPELINE]
export const FACTORY_LINE: readonly string[] = SELLER_LINE.filter((s) => s !== "in_review")
export const lineFor = (isFactory?: boolean) => (isFactory ? FACTORY_LINE : SELLER_LINE)

/** -1 for anything off this order's line — a stop, or a legacy in_review row on a factory
 *  order. Off-line is not a position, so it is never a skip in either direction. */
export const posOf = (s: string | null | undefined, isFactory?: boolean) =>
  lineFor(isFactory).indexOf(normalizeStage(s))

/** The factory's own order rather than a seller's. It chooses which line the adjacency
 *  rules read; omitting it holds the caller to the stricter, seller-shaped one. */
export const isFactoryOrder = (o?: { factory_order?: boolean | null } | null) => !!o?.factory_order

/**
 * The ONE stage this may move to next, or null at the end of the line. Exceptions have no
 * next step: clearing a hold is a decision with a reason, not an advance.
 *
 * IT WALKS THIS ORDER'S OWN LINE, which is the only way it stays correct when a stage is
 * added. It used to hard-code `isFactory && !v -> "working"`, written when FACTORY_LINE was
 * ['', 'working', 'shipped'] and that really was one step. Inserting `approved` into
 * PIPELINE turned the same hop into a SKIP — so Start on the factory's own Draft orders
 * targeted a stage the server refuses for every role, admin included.
 *
 * A legacy factory row sitting AT in_review is OFF this order's line (posOf = -1). It
 * rejoins at Approved — the first real step of making, and the stage the warehouse starts
 * from — rather than jumping to Working, which the warehouse may no longer set from there.
 */
export function nextStage(current?: string | null, isFactory?: boolean): string | null {
  const at = normalizeStage(current)
  if (isException(at)) return null
  const line = lineFor(isFactory)
  const i = line.indexOf(at)
  if (i < 0) return "approved"
  return i < line.length - 1 ? line[i + 1] : null
}

/** An operator's reach: up to and including Approved. The zone ends there because a stage
 *  past it is a claim about PHYSICAL CUSTODY, which an operator cannot observe. */
const OP_ZONE = new Set(["", "in_review", "approved"])
/** The andon cord. A stop is not a custody claim, so it may be pulled from any stage. */
const OP_STOPS = new Set(["on_hold"])
/** The two stages that MOVE MONEY — admin only, and order-level, never per line. */
const MONEY_STAGES = new Set(["cancelled", "refunded"])
const LABEL_OF = (id: string) => (id === "" ? "Draft" : STAGE_LABEL[id] ?? id)

/**
 * WHY a move is refused, or null if it's allowed.
 *
 * Mirrors `stageDenial` in server/src/routes/orders.js — the server is what enforces this;
 * this exists so a UI can grey an option and say why, instead of silently dropping it from
 * the menu and leaving the rule unlearnable.
 */
export function stageDenialReason(
  role: string, current: string | null | undefined, target: string, isFactory?: boolean,
): string | null {
  const at = normalizeStage(current)
  const to = normalizeStage(target)

  // Skipping is denied for EVERYONE, admin included. It isn't a permission, it's what the
  // pipeline means. Nobody has the authority to make an order have been printed when it
  // wasn't. Backwards is not a skip: it claims LESS has happened, which is always safe.
  const ai = posOf(at, isFactory), ti = posOf(to, isFactory)
  if (ai >= 0 && ti >= 0 && ti > ai + 1) {
    return `That would skip ${lineFor(isFactory).slice(ai + 1, ti).map(LABEL_OF).join(", ")}. Move it one stage at a time.`
  }

  // A shipped order is done — the only change left is a Refund. Un-shipping would claim the
  // buyer's tracking reversed (it can't), and it's too late to cancel. Applies to EVERY role;
  // Refund itself is still admin-gated below (MONEY_STAGES).
  if (at === "shipped" && to !== "shipped" && to !== "refunded") {
    return "This order has shipped — the only change left is a refund."
  }

  /**
   * CANCELLED AND REFUNDED ARE THE END — every role, admin included.
   *
   * Neither was terminal: a cancelled order could be put ON HOLD, a production state meaning
   * "this work is paused", on an order where there is no work. And because a hold remembers
   * where it came from in order to resume, cancel → hold → clear offered "Back to Cancelled" —
   * a control that undid a stop by returning the order to a stop.
   *
   * A cancelled order may still be REFUNDED: the money is a separate fact from the work and
   * frequently settles later. A refunded one is finished outright.
   */
  if (at === "cancelled" && to !== "cancelled" && to !== "refunded") {
    return "This order was cancelled — the only change left is a refund."
  }
  if (at === "refunded" && to !== "refunded") {
    return "This order was refunded. That is the end of it."
  }

  /**
   * A PAID ORDER CANNOT BE DRAFT. Every role, admin included.
   *
   * Draft is not a stage — it is a statement about money: nobody submitted this and nobody
   * was charged. An order sitting at Draft with a charge against it is a contradiction the
   * rest of the system then acts on: the seller's Submit unlocks, the order reads untouched
   * and editable, and the money stays taken.
   *
   * Nothing is lost. A mis-click steps back one stage inside production, a pause is On hold,
   * and an order that should not be made is Cancelled — which refunds. Only the WORD Draft is
   * refused, because it is the one of the four that says something untrue.
   *
   * Never for a factory order: nothing was charged, so "this has been paid for" would be
   * false about the floor's own work.
   */
  if (!isFactory && (to === "" || to === "new" || to === "draft") && posOf(at, isFactory) > posOf("", isFactory)) {
    return "This order has been paid for, so it cannot go back to Draft. Step it back one stage, put it on hold, or cancel it to refund."
  }

  if (role === "admin") return null
  if (role === "warehouse") {
    if (MONEY_STAGES.has(to)) return "Cancelling or refunding is an admin decision."
    /**
     * PRODUCTION STARTS FROM APPROVED, and only from there.
     *
     * Approved means an operator has confirmed the blank on every line — the whole reason the
     * stage exists. Starting from Pending would be the warehouse making that judgement itself,
     * on an order whose variants may still be unset, which is the case Approved was added to
     * catch. Admin is past this check already.
     *
     * Coming off a HOLD is not starting production — it is putting the order back where the
     * stop found it, which may well be Working. Gating that on Approved would strand every
     * held order that was already being made.
     */
    if (to === "working" && at !== "approved" && at !== "on_hold") {
      return "Start it from Approved — an operator confirms the blank first."
    }
    return null
  }
  if (role === "operator") {
    if (MONEY_STAGES.has(to)) return "Cancelling or refunding is an admin decision — put the order on hold instead."
    if (OP_STOPS.has(to)) return null                       // andon cord: any stage
    /**
     * AND THE CORD LETS GO. Raising a stop is an operator's right from any stage; releasing it
     * has to be the same right, or the andon cord is a trap — the one who pulled it cannot undo
     * a false alarm, and has to find a warehouse to say "never mind".
     */
    if (at === "on_hold") return null
    /**
     * AN OPERATOR APPROVES; THE WAREHOUSE STARTS.
     *
     * The operator's job on this line is the BLANK — confirming it is theirs, and Approved is
     * where that judgement is recorded. Committing the order to production is the warehouse's
     * call, made by whoever is going to make the thing. So Working is out of reach here even
     * though Approved is not: the handover is the point of having two stages rather than one.
     */
    if (to === "working") return "Approving is yours — the warehouse starts production from there."
    if (!OP_ZONE.has(at)) return "The warehouse has this item — only warehouse or admin can change its status now."
    if (!OP_ZONE.has(to)) return "Operators can move an item as far as Approved."
    return null
  }
  return "Your role cannot change production status."        // designer, and anything new
}

export const canSetStage = (
  role: string, current: string | null | undefined, target: string, isFactory?: boolean,
): boolean => stageDenialReason(role, current, target, isFactory) === null

/**
 * Cancelled and Refunded — the two stages that MOVE MONEY.
 *
 * Exported because they are order-level moves, not line-level ones, and a control that offers
 * them per line cannot keep that promise: the refund is worked out by the order's PATCH, while
 * a per-line write only sets order_items.factory_status. Setting one line to Cancelled
 * therefore reverses nothing, charges nothing back, and — because orderStage() lets any
 * exception win — makes the WHOLE order read Cancelled.
 */
export const isMoneyStage = (id?: string | null): boolean => MONEY_STAGES.has(normalizeStage(id))

/** Default when factory settings haven't loaded. Matches SETTING_DEFAULTS.overdue_days. */
export const DEFAULT_OVERDUE_DAYS = 10

/**
 * Late against the PROMISE where there is one, and only then against age.
 *
 * A closed order is never late — that check has to come first, or shipped work keeps
 * counting against its ship-by date forever and the tally climbs over finished orders.
 */
export function isOverdueBy(
  o: { factory_status?: string | null; ship_by?: string | null; created_at?: string | null },
  days = DEFAULT_OVERDUE_DAYS,
  now = Date.now(),
): boolean {
  if (!isOpenStage(normalizeStage(o.factory_status))) return false
  const promised = o.ship_by ? new Date(o.ship_by).getTime() : NaN
  if (Number.isFinite(promised)) return now > promised
  const created = o.created_at ? new Date(o.created_at).getTime() : NaN
  if (!Number.isFinite(created)) return false      // no date is not evidence of lateness
  return now - created > days * 86_400_000
}

/* ── How an order is NAMED ──────────────────────────────────────────────────── */

/** `etsy-4148231554` is a ROUTING id. The buyer, the marketplace and the packing slip all
 *  say 4148231554; the prefix is ours, and belongs on a second line, not on the number. */
const SOURCE_PREFIX = /^(etsy|shopify|amazon|ebay|tiktok|woo|walmart)-/i
const PLATFORM_NAMES: Record<string, string> = {
  etsy: "Etsy", shopify: "Shopify", tiktok: "TikTok", amazon: "Amazon",
  ebay: "eBay", woo: "WooCommerce", walmart: "Walmart", manual: "Manual",
}
export const plainNum = (id: string) => String(id ?? "").replace(SOURCE_PREFIX, "")

/**
 * Mirrors numOf() in web/lib/order-format.ts, which is canonical.
 *
 * THE HASH MARKS A NUMBER. It was missing here — this returned a bare `4148231554` where
 * both real front-ends print `#4148231554`. Written in the same sitting as the rest of this
 * file and never executed, which is precisely the failure the file exists to prevent;
 * tools/check-order-rules.mjs caught it the first time it was actually run.
 *
 * Our own `FF-…` references already read as references and do not take one.
 */
export const numOfIds = (seq: number | null | undefined, id: string) => {
  if (seq) return `#${seq}`
  const p = plainNum(String(id))
  return /^\d+$/.test(p) ? `#${p}` : p
}
/**
 * A BARE PLATFORM KEY, as the platform writes itself — "etsy" → "Etsy", "tiktok" → "TikTok".
 *
 * platformFromId reads the key off an ORDER ID, which is the common case and the reason this
 * table exists. It is not the only case: a store connection carries its platform as a plain
 * column, and calling platformFromId("etsy") returns "Manual" because the regex wants a
 * trailing dash. Two of these brands are title-cased wrong by the obvious fallback, which is
 * exactly why the table is not something a call site should re-derive.
 */
export const platformName = (raw: string | null | undefined) => {
  const k = String(raw ?? "").toLowerCase()
  if (!k) return ""
  return PLATFORM_NAMES[k] ?? (k.charAt(0).toUpperCase() + k.slice(1))
}
export const platformFromId = (id: string) => {
  const raw = (String(id ?? "").match(SOURCE_PREFIX)?.[1] ?? "manual").toLowerCase()
  return platformName(raw)
}

/**
 * THE NUMBER, THEN WHO IT CAME FROM — the label for a reference standing on its own.
 *
 * `numOfIds` is for a row that has a seq to fall back on. This is for the places that hold
 * nothing but the id — an artwork tile, a thumbnail caption, a digitiser's library card —
 * where the raw value was being printed verbatim. That is the worst of both: `etsy-4152219958`
 * is not the number the buyer or the seller's own Etsy dashboard shows, so it matches nothing
 * anyone could look up, and because every card in a grid starts with the same six characters
 * a column of them reads as one repeated string rather than as six different orders.
 *
 * The prefix is not dropped and not truncated — truncation turned `etsy-4149084185` into
 * `etsy-414908418`, a real order number with its last digit silently removed. It is
 * TRANSLATED: the number stands alone, and the marketplace is named the way the marketplace
 * names itself, after it.
 *
 * Anything with no marketplace prefix passes through untouched — our own `#123` and `FF-…`,
 * and non-order references like `IMG-12`. Appending "Manual" to those would be noise.
 */
export const orderRefLabel = (id: string) => {
  const raw = String(id ?? "")
  if (!raw) return ""
  const plain = plainNum(raw)
  return plain === raw ? raw : `${plain} · ${platformFromId(raw)}`
}

/** Pieces on an order. A line with no qty is one piece, not zero. */
export const unitsOfItems = (items?: ({ qty?: number | null } | null)[] | null) =>
  (items ?? []).reduce((n, it) => n + (Number(it?.qty) || 1), 0)
