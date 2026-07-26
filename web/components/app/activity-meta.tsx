import type { ComponentType } from "react"
import {
  X, Plus, LinkSimple, CurrencyDollar, ArrowRight, PencilSimple, Printer,
  Barcode, Truck, PaperPlaneTilt, CheckCircle, File, ArrowUUpLeft, Stack,
} from "@phosphor-icons/react"
import type { AuditRow } from "@/lib/api"

/**
 * The ONE place an audit action becomes words + an icon, so every history feed (order page,
 * dispatch board, readiness popover, designer board) reads identically. Before this the
 * wording lived in `sayAction` while the designer board carried its own colour+icon map
 * alongside; the two drifted.
 *
 * The feed reads as a sentence — "**Helen** moved Card 13" — so each action carries a `verb`
 * (the predicate) as well as a `label` (the noun form `sayAction` still returns for older
 * callers). A board action ("moved", "deleted") takes the card as its object; an order/
 * dispatch action ("scanned here", "printed the label") is self-contained. The icon is
 * rendered NEUTRAL — no colour — the type is carried by the icon and the words, not a pill.
 *
 * An unknown action is still shown, humanised, never hidden — an unexplained event is
 * evidence.
 */
export type ActionMeta = {
  /** Noun form for legacy callers / column labels: "Moved", "Label printed". */
  label: string
  /** Predicate for the sentence feed: "moved", "printed the label". */
  verb: string
  icon: ComponentType<{ size?: number; weight?: "bold" | "fill" | "regular" | "duotone"; className?: string }>
}

const REGISTRY: Record<string, { label: string; verb: string; icon: ActionMeta["icon"] }> = {
  // Dispatch / labels / scanning
  "label.printed":       { label: "Label printed", verb: "printed the label",        icon: Printer },
  "label.unprinted":     { label: "Print undone",  verb: "reverted the label print", icon: ArrowUUpLeft },
  "label.void":          { label: "Label voided",  verb: "voided the label",         icon: X },
  "order.scan":          { label: "Scanned here",  verb: "scanned here",             icon: Barcode },
  "order.scan.undo":     { label: "Scan undone",   verb: "undid the scan",           icon: ArrowUUpLeft },
  "order.shipped":       { label: "Shipped",       verb: "shipped it",               icon: Truck },
  "order.tracking":      { label: "Tracking added", verb: "added tracking",          icon: Truck },
  "order.manifested":    { label: "Manifested",    verb: "added it to a manifest",   icon: Stack },
  "dispatch.push":       { label: "Sent to byeastside",      verb: "sent it to byeastside",      icon: PaperPlaneTilt },
  "dispatch.cancel":     { label: "Cancelled with byeastside", verb: "cancelled it with byeastside", icon: X },
  // Order state
  "item.status":         { label: "Item status changed", verb: "changed an item's status", icon: ArrowRight },
  "order.stage":         { label: "Order stage changed",  verb: "changed the stage",        icon: ArrowRight },
  // Design / artwork
  "design.saved":        { label: "Artwork attached", verb: "attached artwork",              icon: File },
  "design.pushed":       { label: "Sent to the designer board", verb: "sent it to the designer board", icon: PaperPlaneTilt },
  "design.approved":     { label: "Design approved", verb: "approved the design",            icon: CheckCircle },
  "design_file.uploaded": { label: "Machine file uploaded", verb: "uploaded a machine file", icon: File },
  "design_file.removed": { label: "Machine file removed", verb: "removed a machine file",    icon: X },
  // Designer board (cards + lanes) — the card is the object of the verb
  "design_card.deleted": { label: "Deleted",  verb: "deleted",       icon: X },
  "design.card.created": { label: "Created",  verb: "created",       icon: Plus },
  "design.card.assigned": { label: "Assigned", verb: "assigned",     icon: LinkSimple },
  "design.credited":     { label: "Credited", verb: "credited",      icon: CurrencyDollar },
  "design.lane":         { label: "Moved",    verb: "moved",         icon: ArrowRight },
}

export function actionMeta(action: string): ActionMeta {
  const exact = REGISTRY[action]
  if (exact) return exact
  // Unknown action: humanise the key ("foo.bar_baz" → "bar baz") and reuse it for both forms.
  const human = action.replace(/^[a-z_]+\./, "").replace(/[._]/g, " ")
  const label = human.charAt(0).toUpperCase() + human.slice(1)
  return { label, verb: human, icon: PencilSimple }
}

/** Who did it, as the bold subject of the sentence — the name, then email, then role, so an
 *  entry is never anonymous. Role isn't spelled out inline (it would clutter the sentence);
 *  the name carries it. */
export function actorName(r: AuditRow): string {
  const role = r.actor_role ? r.actor_role.charAt(0).toUpperCase() + r.actor_role.slice(1) : ""
  // `actor` is the global audit log's field (settings ActivityPanel); the per-entity feeds
  // carry actor_name/actor_email. Check all three so a person is named, not reduced to a role.
  return r.actor_name || r.actor_email || r.actor || role || "System"
}
