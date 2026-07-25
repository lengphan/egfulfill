import type { ComponentType } from "react"
import {
  X, Plus, LinkSimple, CurrencyDollar, ArrowRight, PencilSimple, Printer,
  Barcode, Truck, PaperPlaneTilt, CheckCircle, File, Tag, ArrowUUpLeft, Stack,
} from "@phosphor-icons/react"
import type { AuditRow } from "@/lib/api"

/**
 * The ONE place an audit action becomes a badge: its wording, its colour, its icon.
 *
 * Every history feed in the app (order page, dispatch board, readiness popover, designer
 * board) reads the same audit_log rows and must render them identically — so the mapping
 * lives here, once, rather than being re-invented per feed. Before this, `sayAction` gave a
 * bare string on three feeds while the designer board carried its own colour+icon map; the
 * two drifted. `sayAction` now delegates here (see tag-history.ts) so labels can't diverge.
 *
 * An unknown action is still shown — humanised and neutral-toned — because an unexplained
 * event is evidence, not noise. It is never hidden.
 */
export type ActionMeta = {
  label: string
  /** Pill classes — light + dark, since the feeds render in both themes. */
  tone: string
  icon: ComponentType<{ size?: number; weight?: "bold" | "fill" | "regular" | "duotone" }>
  /** Optional row emphasis (a deletion is worth a faint tint, so it stands out in a list). */
  rowClass?: string
}

// Shared tone palette. Kept as a handful of named intents rather than per-action colours so
// the feed reads as a small, learnable vocabulary — violet=moved, red=removed, green=done.
const TONE = {
  neutral: "bg-muted text-muted-foreground",
  moved:   "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  removed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  done:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  info:    "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  warn:    "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  created: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
} as const

const REGISTRY: Record<string, ActionMeta> = {
  // Dispatch / labels / scanning
  "label.printed":       { label: "Label printed", tone: TONE.info,    icon: Printer },
  "label.unprinted":     { label: "Print undone",  tone: TONE.warn,    icon: ArrowUUpLeft },
  "label.void":          { label: "Label voided",  tone: TONE.removed, icon: X },
  "order.scan":          { label: "Scanned here",  tone: TONE.done,    icon: Barcode },
  "order.scan.undo":     { label: "Scan undone",   tone: TONE.warn,    icon: ArrowUUpLeft },
  "order.shipped":       { label: "Shipped",       tone: TONE.done,    icon: Truck },
  "order.tracking":      { label: "Tracking added", tone: TONE.info,   icon: Truck },
  "order.manifested":    { label: "Manifested",    tone: TONE.info,    icon: Stack },
  "dispatch.push":       { label: "Sent to byeastside",      tone: TONE.info, icon: PaperPlaneTilt },
  "dispatch.cancel":     { label: "Cancelled with byeastside", tone: TONE.removed, icon: X },
  // Order state
  "item.status":         { label: "Item status changed",  tone: TONE.moved, icon: ArrowRight },
  "order.stage":         { label: "Order stage changed",  tone: TONE.moved, icon: ArrowRight },
  // Design / artwork
  "design.saved":        { label: "Artwork attached", tone: TONE.info, icon: File },
  "design.pushed":       { label: "Sent to the designer board", tone: TONE.info, icon: PaperPlaneTilt },
  "design.approved":     { label: "Design approved", tone: TONE.done, icon: CheckCircle },
  "design_file.uploaded": { label: "Machine file uploaded", tone: TONE.info, icon: File },
  "design_file.removed": { label: "Machine file removed", tone: TONE.removed, icon: X },
  // Designer board (cards + lanes)
  "design_card.deleted": { label: "Deleted",  tone: TONE.removed, icon: X, rowClass: "bg-red-50/40 dark:bg-red-500/[0.06]" },
  "design.card.created": { label: "Created",  tone: TONE.created, icon: Plus },
  "design.card.assigned": { label: "Assigned", tone: TONE.info,   icon: LinkSimple },
  "design.credited":     { label: "Credited", tone: TONE.done,    icon: CurrencyDollar },
  "design.lane":         { label: "Moved",    tone: TONE.moved,   icon: ArrowRight },
}

// Family fallbacks — an action we don't name exactly still gets the right colour from its
// prefix, so a new `label.*` or `design.*` event looks like its siblings, not like an error.
const FAMILY: { test: RegExp; tone: string; icon: ActionMeta["icon"] }[] = [
  { test: /^label\./,       tone: TONE.info,    icon: Tag },
  { test: /\.(deleted|removed|cancel|void|reject)/, tone: TONE.removed, icon: X },
  { test: /\.(created|added)/, tone: TONE.created, icon: Plus },
  { test: /\.(approved|credited|paid|done|shipped)/, tone: TONE.done, icon: CheckCircle },
  { test: /^design/,        tone: TONE.info,    icon: File },
  { test: /^dispatch\./,    tone: TONE.info,    icon: Truck },
  { test: /\.(stage|status|lane|moved)/, tone: TONE.moved, icon: ArrowRight },
]

export function actionMeta(action: string): ActionMeta {
  const exact = REGISTRY[action]
  if (exact) return exact
  const fam = FAMILY.find((f) => f.test.test(action))
  const label = action.replace(/^[a-z_]+\./, "").replace(/[._]/g, " ")
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: fam?.tone ?? TONE.neutral, icon: fam?.icon ?? PencilSimple }
}

/** "Helen · Warehouse" — a team asks "who did this" by name; the role disambiguates when two
 *  people share one. Falls through name → email → role so an entry is never anonymous. */
export function actorOf(r: AuditRow): string {
  const who = r.actor_name || r.actor_email || r.actor || ""
  const role = r.actor_role ? r.actor_role.charAt(0).toUpperCase() + r.actor_role.slice(1) : ""
  if (who && role) return `${who} · ${role}`
  return who || role || "System"
}
