import type { AuditRow } from "@/lib/api"

/**
 * Which audit actions belong to which tag, and how to say them in words.
 *
 * A tag answers "is this done?"; its history answers "how did it get that way, and who
 * did it". The mapping lives here rather than in the popover so the tag, its history and
 * its empty state can never drift apart — a tag that says done with a history that
 * disagrees is worse than no history at all.
 */
export type TagId = "label" | "scan" | "design"

const MATCH: Record<TagId, RegExp> = {
  label: /^label\.|^order\.(shipped|tracking)/,
  // Everything that moves a parcel through scanning: the stage change, the hand-off to
  // the partner, a pull-back, and the scan itself. It matched only item.status and
  // order.stage, so an in-house scan and both partner events were recorded and then
  // never shown — the history looked empty for exactly the steps someone opens it to check.
  scan: /^item\.status|^order\.stage|^order\.scan|^dispatch\./,
  design: /^design\.|^design_file\./,
}

/** Human wording for an action. Unknown actions fall back to the raw key rather than
 *  being hidden — an unexplained event is still evidence. */
const SAID: Record<string, string> = {
  "label.printed": "Label printed",
  "label.unprinted": "Label print undone",
  "design.saved": "Artwork attached",
  "design.pushed": "Sent to the designer board",
  "design.approved": "Design approved",
  "design_file.uploaded": "Machine file uploaded",
  "item.status": "Item status changed",
  "order.stage": "Order stage changed",
  // The scanning steps. Without these the fallback prints the raw action with the dots
  // swapped for spaces ("dispatch push"), which reads like a debug log rather than a
  // record of what someone did.
  "order.scan": "Scanned here",
  "order.scan.undo": "Scan undone",
  "dispatch.push": "Sent to byeastside",
  "dispatch.cancel": "Cancelled with byeastside",
}

export function sayAction(a: string): string {
  return SAID[a] ?? a.replace(/[._]/g, " ")
}

export function forTag(tag: TagId, rows: AuditRow[]): AuditRow[] {
  return rows.filter((r) => MATCH[tag].test(r.action))
}

/** What to show when a tag has no history — a next step, not a dead end. */
export const EMPTY_HINT: Record<TagId, string> = {
  label: "No label yet — create one from the order's ⋯ menu.",
  scan: "Not scanned yet — it moves here once dispatch scans the batch.",
  design: "No design yet — attach artwork or send it to the board.",
}

/**
 * What to say when a tag reads DONE but no history was recorded for it.
 *
 * These two can legitimately disagree: the tag reads the order's current state, history
 * reads events, and an action taken before auditing covered it — or by a path that
 * doesn't audit — leaves state without a trail. The tag is the truth; the popover must
 * never contradict it, or a board that says "scanned" and "not scanned yet" at once
 * teaches people to distrust both.
 */
export const DONE_NO_HISTORY: Record<TagId, string> = {
  label: "Label exists, but no recorded history for how it was created.",
  scan: "Already past the scan, but no recorded history for that step.",
  // This one used to fire constantly on ordinary marketplace orders, because the tag
  // counted the buyer's personalization upload as a design — so it announced a design
  // that had never existed and then couldn't explain it. The tag no longer makes that
  // claim (see readiness-dots.tsx), so reaching this text now means a genuine gap.
  design: "Artwork is attached, but no recorded history for how it got here.",
}
