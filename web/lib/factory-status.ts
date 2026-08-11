// Factory production pipeline — the canonical item lifecycle the boards drive, matching
// the old app's CURRENT status vocabulary (egfulfill-store.js SELLER_STATUS factory keys):
//
//   (new) → In review → Awaiting scan → Scanned → Printing → Packing → Shipped
//
// (Queued / QC / Packed were the OLDER model — kept only as normalize() aliases.) Plus
// off-pipeline EXCEPTION states an order can drop into: On hold, Cancelled, Refunded.
// (Flagged + Backorder were retired — normalizeStage collapses any legacy value onto On
// hold, the one remaining stop.) An order's overall stage = its least-advanced item (only
// "Shipped" when every line is), unless any item is in an exception state.

// Only the tones a REAL stage carries. qc / packed / backorder / alert were left behind by
// the retired stage model: nothing can reach them, because every id folds through
// normalizeStage() onto the seven stages below before a tone is looked up. `alert` had
// exactly one mention in the whole codebase — this line. Two of the dead entries were also
// near-identical ambers (qc 700, hold 800) for unrelated meanings, which is the kind of
// thing that only stays harmless while it stays unreachable.
export type FactoryTone = "new" | "review" | "neutral" | "prod" | "shipped" | "hold" | "closed"
export type FactoryStage = { id: string; label: string; tone: FactoryTone }

// The linear production flow (in order) — the warehouse scan flow.
// The pipeline every submitted order follows.
//
// NB on ids vs labels: the seller-submitted stage is LABELLED "Pending" but its id stays
// `in_review` — the id `new` already means "not started / Draft" in normalizeStage, and
// reusing it would make a seller's unsubmitted Draft and a submitted order indistinguishable
// in the DB. Labels are what people read; ids are data. ('printed' was removed — the scan
// walked straight through it; legacy 'printed' rows fold to awaiting_scan.)
export const FACTORY_STAGES: FactoryStage[] = [
  { id: "in_review", label: "Pending", tone: "review" },    // seller submitted + paid; awaiting factory approval; cancellable by them
  { id: "awaiting_scan", label: "Awaiting scan", tone: "neutral" }, // approved; label made; waiting on the scan
  { id: "working", label: "Working", tone: "prod" },        // scanned + combined with the design; being made
  { id: "shipped", label: "Shipped", tone: "shipped" },
]
const ORDER = FACTORY_STAGES.map((s) => s.id)

// Off-pipeline exception states (set manually, not reached by advancing).
export const EXCEPTION_STAGES: FactoryStage[] = [
  { id: "on_hold", label: "On hold", tone: "hold" },
  { id: "cancelled", label: "Cancelled", tone: "closed" },
  { id: "refunded", label: "Refunded", tone: "closed" },
]
const EXCEPTIONS = new Set(EXCEPTION_STAGES.map((s) => s.id))

// Everything a staff member can set. "" and in_review are DIFFERENT states: "" is a Draft —
// arrived/created and nobody has started (a marketplace sync or a factory's own order lands
// here, unpaid); in_review is "Pending" — the seller has submitted AND been charged, awaiting
// factory approval. Confusing them is how a paid order gets treated as untouched.
export const ALL_STATUSES: FactoryStage[] = [{ id: "", label: "Draft", tone: "new" }, ...FACTORY_STAGES, ...EXCEPTION_STAGES]

// Collapse the many raw factory_status values onto a canonical id. "" = not started.
export function normalizeStage(s?: string | null): string {
  const v = String(s || "").toLowerCase().trim()
  if (v === "new" || v === "draft" || v === "none" || v === "pending") return ""
  if (ORDER.includes(v) || EXCEPTIONS.has(v)) return v
  // 'printed' was removed (label made, pre-scan) → folds to awaiting_scan, alongside the
  // other label/queue aliases. Retired make-step ids fold to working.
  if (["approved", "ready_print", "in_queue", "queued", "prescan", "printed", "label", "labelled", "labeled"].includes(v)) return "awaiting_scan"
  if (["scanned", "printing", "qc", "production", "in_production", "in-prod", "prepress",
       "packing", "packed", "ready", "finished"].includes(v)) return "working"
  if (["fulfilled", "delivered", "in_transit"].includes(v)) return "shipped"
  // Flagged + Backorder were retired — collapse them and their aliases onto On hold, the one
  // remaining stop, so an existing order at either keeps a valid, actionable stage.
  if (["flagged", "escalated", "action", "backorder", "replacement"].includes(v)) return "on_hold"
  return "" // unknown → treat as new
}

export function stageMeta(id: string): FactoryStage | null {
  return ALL_STATUSES.find((s) => s.id === id) ?? null
}
export function isException(id?: string | null): boolean {
  return EXCEPTIONS.has(normalizeStage(id))
}

/**
 * The next linear stage to advance an item to (null once shipped or in an exception).
 *
 * `isFactory` matters at exactly one point, and it's the first: a factory order leaves
 * Draft for Awaiting scan, because Pending is a seller stage it can never occupy. A legacy
 * factory row sitting AT in_review also advances to Awaiting scan, which is how those get
 * out. See FACTORY_LINE below.
 */
export function nextStage(current?: string | null, isFactory?: boolean): string | null {
  const v = normalizeStage(current)
  if (EXCEPTIONS.has(v)) return null
  if (isFactory && (!v || v === "in_review")) return "awaiting_scan"
  if (!v) return "in_review"
  const i = ORDER.indexOf(v)
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null
}

// An order's overall stage from its items: any exception wins; else the least-advanced
// line. Empty items → "".
export function orderStage(items: { factory_status?: string | null }[]): string {
  if (!items || !items.length) return ""
  const exc = items.map((it) => normalizeStage(it.factory_status)).find((v) => EXCEPTIONS.has(v))
  if (exc) return exc
  let minIdx = ORDER.length
  let anyUnstarted = false
  for (const it of items) {
    const v = normalizeStage(it.factory_status)
    if (!v) { anyUnstarted = true; continue }
    minIdx = Math.min(minIdx, ORDER.indexOf(v))
  }
  if (anyUnstarted) return ""
  return minIdx < ORDER.length ? ORDER[minIdx] : ""
}

// ── Who may set which stage ────────────────────────────────────────────────────
// MIRRORS stageDenial() in server/src/routes/orders.js — keep the two in sync. The
// server is what enforces this; these helpers exist only so a user isn't offered an
// option that would come back 403.
//
// The operator's zone ends at the scan: a stage is a claim about PHYSICAL CUSTODY, and
// once the warehouse holds the goods only they (or admin) can report where it is.
// Carve-outs: flagged/on_hold are a STOP signal rather than a custody claim, so artwork
// review can pull the andon cord at any stage; cancelled/refunded are admin money calls
// and backorder is a warehouse/admin stock call.
const OP_ZONE = new Set(["", "in_review", "awaiting_scan"])
const OP_STOPS = new Set(["on_hold"])
const MONEY_STAGES = new Set(["cancelled", "refunded"])

// The linear order, '' (Received) first, for adjacency. Exceptions are deliberately absent:
// a stop is not a position on this line, which is why it can be entered from anywhere and
// never counts as a skip. MIRRORS `LINE`/`skipsPipeline` in server/src/routes/orders.js.
//
// TWO LINES, BECAUSE "Pending" IS A SELLER STAGE AND NOT A STEP OF MAKING ANYTHING.
//
// in_review means: the seller submitted, we charged them, and we haven't accepted the job
// yet. A factory-owned order has no seller and is never charged, so the stage can say
// nothing true about one — it was only ever passed through to satisfy the one-step rule,
// and any that stopped there sat in the seller queue looking like work someone was waiting
// on us for. For those orders the stage is simply not on the line, so Draft → Awaiting scan
// is one move. The skip rule is untouched otherwise: it exists so nobody can assert
// physical work that didn't happen, and in_review isn't work.
const SELLER_LINE = ["", ...FACTORY_STAGES.map((s) => s.id)]
const FACTORY_LINE = SELLER_LINE.filter((s) => s !== "in_review")
const lineFor = (isFactory?: boolean) => (isFactory ? FACTORY_LINE : SELLER_LINE)
// -1 for anything off this order's line — a stop, or a legacy in_review row on a factory
// order. Off-line is not a position, so it is never a skip in either direction, which is
// what lets those existing rows be moved straight on.
const posOf = (s: string | null | undefined, isFactory?: boolean) => lineFor(isFactory).indexOf(normalizeStage(s))

/**
 * Is this the factory's own order rather than a seller's?
 *
 * One reading of one server-derived column (orders.factory_order, derived from the owner's
 * role), so every caller asks the same question the same way. An order the client hasn't
 * been told about defaults to false — the stricter line.
 */
export const isFactoryOrder = (o?: { factory_order?: boolean | null } | null) => !!o?.factory_order
const LABEL_OF = (id: string) => (id === "" ? "Draft" : FACTORY_STAGES.find((s) => s.id === id)?.label ?? id)

/**
 * WHY a move is refused, or null if it's allowed.
 *
 * Mirrors `stageDenial` in server/src/routes/orders.js — the server is what enforces this;
 * this exists so the UI can grey an option and say why, instead of silently dropping it
 * from the menu and leaving the rule unlearnable.
 *
 * `isFactory` — the factory's own order rather than a seller's (see isFactoryOrder). It
 * chooses which line the adjacency rules read; omitting it holds the caller to the
 * stricter, seller-shaped one.
 */
export function stageDenialReason(role: string, current: string | null | undefined, target: string, isFactory?: boolean): string | null {
  const at = normalizeStage(current)
  const to = normalizeStage(target)

  // Skipping is denied for EVERYONE, admin included — it isn't a permission, it's what the
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

  if (role === "admin") return null
  if (role === "warehouse") {
    return MONEY_STAGES.has(to) ? "Cancelling or refunding is an admin decision." : null
  }
  if (role === "operator") {
    if (MONEY_STAGES.has(to)) return "Cancelling or refunding is an admin decision — put the order on hold instead."
    if (OP_STOPS.has(to)) return null                       // andon cord: any stage
    // Tested on the DESTINATION, not the origin. As `at === "in_review"` it blocked only
    // the direct hop, and OP_ZONE also holds awaiting_scan — so the same move went through
    // in two clicks via Awaiting scan. Anything past Received has been PAID for.
    // The justification is the CHARGE, so it can't apply to a factory order — nothing was
    // taken, and saying "this order has been paid for" about the floor's own order would
    // be untrue. Custody is still covered by the OP_ZONE tests below.
    if (!isFactory && (to === "" || to === "new" || to === "draft") && ai > 0) {
      return "This order has been paid for — only warehouse or admin can send it back."
    }
    if (!OP_ZONE.has(at)) return "The warehouse has this item — only warehouse or admin can change its status now."
    if (!OP_ZONE.has(to)) return "Operators can move an item as far as Awaiting scan."
    return null
  }
  return "Your role cannot change production status."
}

export function canSetStage(role: string, current: string | null | undefined, target: string, isFactory?: boolean): boolean {
  return stageDenialReason(role, current, target, isFactory) === null
}

/**
 * The stages to WRITE, in order, to get from here to there one step at a time.
 *
 * null when the move isn't a forward walk along the line — either end being a stop, or the
 * target being backwards or the current stage. Those are single moves, not catch-ups.
 */
export function stagePath(current: string | null | undefined, target: string, isFactory?: boolean): string[] | null {
  const ai = posOf(current, isFactory), ti = posOf(target, isFactory)
  if (ai < 0 || ti < 0 || ti <= ai) return null
  return lineFor(isFactory).slice(ai + 1, ti + 1)
}

/**
 * Could this role reach `target` by walking, recording every stage on the way?
 *
 * This is the test behind the catch-up offer, and it is deliberately stricter than "is the
 * destination allowed": EVERY intermediate step must be permitted too. An operator cannot
 * catch an order up to Shipped by pretending the steps they may not make are incidental —
 * if any single hop is refused, so is the walk.
 *
 * Only true for a genuine SKIP (two or more steps). One step is an ordinary move and
 * doesn't need a confirmation.
 */
export function canWalk(role: string, current: string | null | undefined, target: string, isFactory?: boolean): boolean {
  const path = stagePath(current, target, isFactory)
  if (!path || path.length < 2) return false
  let at = normalizeStage(current)
  for (const s of path) {
    if (stageDenialReason(role, at, s, isFactory) !== null) return false
    at = s
  }
  return true
}

// Does this role get a status CONTROL for an item at this stage, or a read-only badge?
// An operator past Awaiting scan keeps only the stop options, never the pipeline.
//
// Pending is dropped outright for a factory order rather than offered-and-disabled, which
// is the one place this file breaks its own "never hide, explain" rule — and deliberately.
// A greyed row is for a move this role may not make; this stage doesn't EXIST for this
// order, and listing it would put the seller queue's name in the menu of an order that can
// never belong there. Every other stage still shows with its reason.
export function stageOptionsFor(role: string, current: string | null | undefined, isFactory?: boolean): FactoryStage[] {
  return ALL_STATUSES
    .filter((s) => !(isFactory && s.id === "in_review"))
    .filter((s) => canSetStage(role, current, s.id, isFactory))
}

export const TONE_CLASS: Record<FactoryTone, string> = {
  new: "bg-muted text-muted-foreground",
  review: "bg-indigo-100 text-indigo-700",
  neutral: "bg-slate-100 text-slate-700",
  prod: "bg-violet-100 text-violet-700",
  shipped: "bg-emerald-100 text-emerald-700",
  hold: "bg-amber-100 text-amber-800",
  closed: "bg-muted text-muted-foreground line-through",
}
