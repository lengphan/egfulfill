import type { ComponentType } from "react"
import {
  X, Plus, LinkSimple, CurrencyDollar, ArrowRight, PencilSimple, Printer,
  Barcode, Truck, PaperPlaneTilt, CheckCircle, File, ArrowUUpLeft, Stack,
  Storefront, ShieldCheck,
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
  // Channels — what we did inside someone's marketplace account.
  "etsy.publish":             { label: "Listing published", verb: "published a listing to Etsy",        icon: Storefront },
  "etsy.import_addresses":    { label: "Addresses imported", verb: "imported buyer addresses from Etsy", icon: File },
  "etsy.address_sheet":       { label: "Address sheet set", verb: "set the Etsy address sheet",         icon: File },
  // Buying postage, as distinct from printing the label that was already bought.
  "shipping.label_bought":    { label: "Label bought",      verb: "bought a shipping label",            icon: Truck },
  // Buyer-data retention — who changed the policy, and when.
  "pii.retention.configured": { label: "Retention changed", verb: "changed the buyer-data retention policy", icon: ShieldCheck },
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
  "item.setup":          { label: "Variant set",   verb: "set",                      icon: PencilSimple },
  "shipping.label_detached": { label: "Tracking unlinked", verb: "unlinked the tracking", icon: X },
  "shipping.label_restored": { label: "Tracking restored", verb: "put the tracking back", icon: ArrowUUpLeft },
  "design_file.reused":  { label: "File reused",   verb: "reused a machine file",     icon: File },
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

// Coarse buckets for the Activity page's filter toggles. Each bucket is a set of action
// PREFIXES (matched with `like prefix%` server-side), so the ~40 raw action types fold into
// a handful of human categories without listing every one. Kept here, beside the per-action
// wording, so the vocabulary lives in one place.
export type ActionCategory = { key: string; label: string; prefixes: string[] }
export const ACTION_CATEGORIES: ActionCategory[] = [
  { key: "orders",     label: "Orders",      prefixes: ["order.", "item."] },
  // "shipping." covers buying postage. It was missing, so every label PURCHASE was
  // invisible to this filter while label PRINTS ("label.") showed — two halves of the same
  // job, one of them unfindable.
  { key: "fulfilment", label: "Fulfilment",  prefixes: ["label.", "shipping.", "dispatch.", "manifest", "consignment."] },
  { key: "design",     label: "Design",      prefixes: ["design"] },
  { key: "money",      label: "Money",       prefixes: ["wallet.", "billing.", "topup"] },
  { key: "users",      label: "Users & team", prefixes: ["user.", "seller.", "team"] },
  { key: "catalog",    label: "Catalog",     prefixes: ["catalog"] },
  { key: "email",      label: "Email",       prefixes: ["broadcast.", "email_branding"] },
  { key: "suppliers",  label: "Suppliers",   prefixes: ["purchase", "manual_supplier", "ss.", "otto"] },
  { key: "system",     label: "System",      prefixes: ["backup.", "capacity.", "factory", "nav", "pii."] },
  // Anything done to a connected marketplace on a seller's behalf. These actions existed
  // with no category at all, so publishing a listing — the thing most likely to be asked
  // about after a shop is actioned — could not be filtered for.
  { key: "channels",   label: "Channels",    prefixes: ["etsy.", "tiktok.", "shopify."] },
]

export function actionMeta(action: string): ActionMeta {
  const exact = REGISTRY[action]
  if (exact) return exact
  // Unknown action: humanise the key ("foo.bar_baz" → "bar baz") and reuse it for both forms.
  const human = action.replace(/^[a-z_]+\./, "").replace(/[._]/g, " ")
  const label = human.charAt(0).toUpperCase() + human.slice(1)
  return { label, verb: human, icon: PencilSimple }
}

/**
 * The OBJECT of the verb, built from what the row recorded. "haianhseller setup" five times
 * over says nothing; "haianhseller set Colour Navy · dc21" is the line someone came to read.
 * Empty string when the action carries nothing worth naming.
 */
const FIELD_WORD: Record<string, string> = {
  blank: "Blank", color: "Colour", size: "Size", printType: "Method", variant: "Variant",
}
export function actionDetail(r: AuditRow, resolveLine?: (key: string) => string | null): string {
  const a = (r.after ?? {}) as Record<string, unknown>
  const b = (r.before ?? {}) as Record<string, unknown>
  const str = (k: string) => (a[k] == null ? "" : String(a[k]))
  // A LINE ID IS NOT A NAME. "FFL-mssfifwo0l05v" tells a reader nothing; the caller can
  // turn it into "Item 1 · dc21", and without a resolver it is dropped rather than printed.
  const rawOn = str("line_id") || str("sku")
  const on = rawOn ? (resolveLine ? resolveLine(rawOn) || "" : "") : ""
  switch (r.action) {
    case "item.setup": {
      const set = Object.keys(FIELD_WORD)
        .filter((k) => a[k] !== undefined && String(a[k] ?? "") !== "")
        .map((k) => `${FIELD_WORD[k]} ${str(k)}`)
      return [set.join(" · "), on].filter(Boolean).join(" · ")
    }
    case "design_file.uploaded":
    case "design_file.removed":
      return [str("name"), on].filter(Boolean).join(" · ")
    case "design.saved":
      return [str("name") || str("kind"), on].filter(Boolean).join(" · ")
    case "shipping.label_bought":
    case "order.tracking":
      return str("tracking")
    case "shipping.label_detached":
    case "shipping.label_restored":
      return str("tracking") || String((r.before as Record<string, unknown> | null)?.tracking ?? "")
    case "order.stage":
      return str("to") || str("stage")
    case "order.updated": {
      // WHICH FIELDS. "updated" on its own is the least useful entry in the log.
      const WORD: Record<string, string> = {
        factory_status: "stage", status: "status", tracking: "tracking", carrier: "carrier",
        total: "customer paid", address: "address", customer: "customer",
        internal_note: "factory note", notes: "notes", meta: "details",
      }
      const keys = Object.keys(a).filter((k) => WORD[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      return keys.map((k) => WORD[k]).join(" · ")
    }
    default:
      return ""
  }
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
