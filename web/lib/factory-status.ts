// Factory production pipeline — the canonical item lifecycle the boards drive, matching
// the old app's CURRENT status vocabulary (egfulfill-store.js SELLER_STATUS factory keys):
//
//   (new) → Pending → Working → Shipped
//
// The line describes PRODUCTION only. Where the label has got to — bought, queued, scanned —
// is carried by facts beside it (tracking, label_scanned_at) and shown by the Label/Scan
// chips, because a label's journey runs alongside the making rather than through it.
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
import {
  normalizeStage, isException, isFactoryOrder, nextStage, stageDenialReason, canSetStage,
  isMoneyStage, lineFor, posOf,
} from "@/shared/order-rules"

/**
 * THE LADDER AND THE ROLE GATE LIVE IN shared/order-rules.ts.
 *
 * This file was the canonical copy and mobile/lib/orders.ts was a hand-kept port of it. Both
 * now import the same module, so there is one definition of what a stage is and who may set
 * it, and the phone cannot quietly permit something the boards forbid.
 *
 * What stays HERE is presentation: the tone each stage carries on a board, and the
 * order-level readings (orderStage, lineProgress) that are about a list of items rather than
 * about the ladder itself.
 *
 * stageDenial() in server/src/routes/orders.js is still a separate implementation, on
 * purpose — it is the one that ENFORCES. tools/stage-gate-diff.mjs executes both over the
 * whole role x stage matrix and fails if they ever disagree.
 */
export {
  normalizeStage, isException, isFactoryOrder, nextStage, stageDenialReason, canSetStage,
  isMoneyStage,
}

export type FactoryTone = "new" | "review" | "neutral" | "prod" | "shipped" | "hold" | "closed"
export type FactoryStage = { id: string; label: string; tone: FactoryTone }

// The linear production flow (in order) — the warehouse scan flow.
// The pipeline every submitted order follows.
//
// NB on ids vs labels: the seller-submitted stage is LABELLED "Pending" but its id stays
// `in_review` — the id `new` already means "not started / Draft" in normalizeStage, and
// reusing it would make a seller's unsubmitted Draft and a submitted order indistinguishable
// in the DB. Labels are what people read; ids are data. ('printed' was removed — the scan
// walked straight through it; legacy 'printed' rows fold to working.)
/**
 * THE LINE DESCRIBES PRODUCTION. NOTHING ELSE.
 *
 * 'awaiting_scan' was removed for the same reason 'printed' was before it: it is not a state
 * of the GOODS. It described where the LABEL had got to, and a label's journey runs BESIDE
 * production rather than through it — bought, queued, handed to the scan service, picked —
 * all while the thing is being made. One column holds one value, so the label kept winning:
 * a cap on the machine read "Awaiting scan", and an order byeastside had already picked read
 * "Awaiting scan" too, because their sync writes label_scanned_at and never touches a stage.
 *
 * That fact already had a home: `label_scanned_at`, and the Label/Scan chips the row has
 * always carried (lib/order-readiness.ts). The dispatch queue is read from those now —
 * a tracking number, not yet scanned. Legacy rows fold to "working" in normalizeStage,
 * exactly as 'printed'/'scanned'/'packing' already do.
 */
export const FACTORY_STAGES: FactoryStage[] = [
  { id: "in_review", label: "Pending", tone: "review" },    // seller submitted + paid; awaiting factory approval; cancellable by them
  /**
   * APPROVED — a person has looked at the blank.
   *
   * The pipeline went straight from a seller's submission to "being made", so nothing on
   * the board could say the thing the floor actually needs to know before cutting: that an
   * operator has SELECTED OR CONFIRMED THE BLANK on every line. A marketplace order arrives
   * with its variants unset (CLAUDE.md §5); "Working" on one of those meant production had
   * accepted an order nobody had finished setting up.
   *
   * It is a real stage rather than a stamp because it gates: Working is one step past it,
   * so an order cannot be made until someone has stood behind its blanks — and the moment
   * of approval, and who did it, is in the history like every other stage change.
   *
   * The id was already in normalizeStage's retired list, folding onto working. It is out of
   * that list now; no live row carried it (checked against production: 0 orders, 0 items),
   * so nothing reclassifies.
   */
  { id: "approved", label: "Approved", tone: "neutral" },   // an operator has confirmed the blank on every line
  { id: "working", label: "Working", tone: "prod" },        // accepted into production; being made
  { id: "shipped", label: "Shipped", tone: "shipped" },
]
const ORDER = FACTORY_STAGES.map((s) => s.id)

// Off-pipeline exception states (set manually, not reached by advancing).
export const EXCEPTION_STAGES: FactoryStage[] = [
  { id: "on_hold", label: "Hold", tone: "hold" },
  { id: "cancelled", label: "Cancelled", tone: "closed" },
  { id: "refunded", label: "Refunded", tone: "closed" },
]
const EXCEPTIONS = new Set(EXCEPTION_STAGES.map((s) => s.id))

// Everything a staff member can set. "" and in_review are DIFFERENT states: "" is a Draft —
// arrived/created and nobody has started (a marketplace sync or a factory's own order lands
// here, unpaid); in_review is "Pending" — the seller has submitted AND been charged, awaiting
// factory approval. Confusing them is how a paid order gets treated as untouched.
export const ALL_STATUSES: FactoryStage[] = [{ id: "", label: "Draft", tone: "new" }, ...FACTORY_STAGES, ...EXCEPTION_STAGES]

export function stageMeta(id: string): FactoryStage | null {
  return ALL_STATUSES.find((s) => s.id === id) ?? null
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

/**
 * THE ONE ANSWER TO "WHAT STAGE IS THIS ORDER AT".
 *
 * There were two, and they disagreed. The production queue read `orderStage(items)` — the
 * lines only — while the order page read `orders.factory_status` — the row only. Nothing
 * keeps those two in step: cancelling writes the ORDER row and leaves the lines alone, and
 * moving a line on the board writes the LINE and leaves the order row alone. So an order
 * cancelled from its own page went on reading Pending in the queue, and a line pushed to
 * Working on the board left the page still saying Draft.
 *
 * Neither source is wrong; they answer different questions. The order row carries
 * order-level facts — cancelled, refunded, on hold — which are true of the whole thing and
 * can never be deduced from a line. The lines carry production, and the least-advanced one
 * is what "can this ship" means.
 *
 * So: AN ORDER-LEVEL EXCEPTION WINS, and everything else comes from the lines. An order is
 * not half-cancelled, and no arrangement of line stages can make it so.
 */
export function resolvedOrderStage(order: {
  factory_status?: string | null
  items?: { factory_status?: string | null }[] | null
} | null | undefined): string {
  const own = normalizeStage(order?.factory_status)
  if (EXCEPTIONS.has(own)) return own
  const items = order?.items ?? []
  if (items.length) return orderStage(items)
  // No lines to ask — the row is all there is.
  return own
}

/**
 * HOW MANY OF AN ORDER'S LINES ARE UNDER WAY.
 *
 * `orderStage` above answers with the LEAST-ADVANCED line, which is the right answer for
 * "can this ship" and the wrong one for "what is happening". A seven-cap order with six
 * caps stitched and one blank still on order reads Draft — true, and it hides the six.
 *
 * `mixed` is the only case worth drawing: when every line is at the same stage the badge
 * has already said everything, and a bar reading 7/7 beside "Working" is noise.
 */
export function lineProgress(items: { factory_status?: string | null }[]): { total: number; started: number; mixed: boolean } {
  const total = items?.length ?? 0
  const started = (items ?? []).filter((it) => {
    const v = normalizeStage(it.factory_status)
    return v === "working" || v === "shipped"
  }).length
  return { total, started, mixed: total > 1 && started > 0 && started < total }
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
// An operator may accept work INTO production; they still cannot claim it left. The zone
// used to end at "awaiting_scan" — with that stage gone, "working" is the same boundary
// under the name that survived.
/* Approved is IN the operator zone — confirming the blank is the operator's job, and the
   stage exists to record that they did it. Working is NOT: starting production is the
   warehouse's call, tested explicitly above so the refusal can say why. */

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
// An operator past Working keeps only the stop options, never the pipeline.
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
  // No strikethrough. The word already says it — "Cancelled" struck through is the same
  // fact twice, and struck text is harder to read for no gain. Muted carries "settled".
  closed: "bg-muted text-muted-foreground",
}
