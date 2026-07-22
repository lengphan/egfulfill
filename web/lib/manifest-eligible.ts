import type { OrderRow } from "./api"

/**
 * Can this label go on a USPS SCAN form?
 *
 * MIRRORS `plan()` in server/src/routes/manifests.js — same checks, same order. Change
 * both. The server is authoritative and re-runs every check before creating anything;
 * this copy exists so the button can grey out and say why BEFORE the click, instead of
 * opening a dialog that turns out to have nothing to create.
 *
 * The order of the checks is load-bearing: each order reports the FIRST thing wrong with
 * it, so an order with no label isn't also told it's missing a transaction reference.
 * Listing every fault at once reads like a wall of rules rather than one thing to fix.
 */
export type Ineligible =
  | "no-label" | "manifested" | "scanned" | "provider" | "no-ref" | "no-account"

/** Null when the label can go on a form. */
export function manifestBlocker(o: OrderRow): Ineligible | null {
  if (!o.tracking) return "no-label"
  if (o.manifested_at) return "manifested"
  if (o.label_scanned_at) return "scanned"
  if (o.label_provider && o.label_provider !== "shippo") return "provider"
  if (o.label_ref && !o.label_carrier_account) return "no-account"
  if (!o.label_ref) return "no-ref"
  return null
}

/**
 * Why not, in words, pluralised for a count.
 *
 * The two reference gaps say WE didn't record something, not that the order is wrong.
 * They're the ones that will hit every label bought before that shipped, and "not
 * eligible" would read as a rule the user should already know rather than a gap on our
 * side that time fixes on its own.
 */
export function blockerText(b: Ineligible, n: number): string {
  const s = n === 1
  switch (b) {
    case "no-label": return `${n} ${s ? "has" : "have"} no label yet`
    case "manifested": return `${n} ${s ? "is" : "are"} already on a SCAN form`
    case "scanned": return `${n} ${s ? "has" : "have"} already been scanned`
    case "provider": return `${n} ${s ? "wasn't" : "weren't"} bought through Shippo`
    case "no-ref": return `${n} ${s ? "was" : "were"} bought before we recorded the Shippo reference a form needs`
    case "no-account": return `${n} ${s ? "is" : "are"} missing the carrier account a form is scoped to`
  }
}

export type ManifestReadiness = {
  eligible: OrderRow[]
  /** Blockers with counts, commonest first — so the tooltip leads with the real problem
   *  rather than whatever happened to be selected first. */
  blockers: { blocker: Ineligible; count: number }[]
}

export function manifestReadiness(orders: OrderRow[]): ManifestReadiness {
  const eligible: OrderRow[] = []
  const counts = new Map<Ineligible, number>()
  for (const o of orders) {
    const b = manifestBlocker(o)
    if (!b) { eligible.push(o); continue }
    counts.set(b, (counts.get(b) ?? 0) + 1)
  }
  return {
    eligible,
    blockers: [...counts.entries()]
      .map(([blocker, count]) => ({ blocker, count }))
      .sort((a, b) => b.count - a.count),
  }
}

/** The hover text for the SCAN-form button, for any selection including none. */
export function manifestTooltip(orders: OrderRow[]): string {
  if (!orders.length) return "Select the orders you're handing to USPS."
  const { eligible, blockers } = manifestReadiness(orders)
  const why = blockers.map((b) => blockerText(b.blocker, b.count)).join(", ")
  if (!eligible.length) {
    return `Not eligible for a SCAN form — ${why}.`
  }
  // Partial selections still work: the eligible ones go on the form and the rest are
  // listed in the dialog. Saying so up front stops "6 selected, 4 on the form" reading
  // like something went wrong.
  return blockers.length
    ? `${eligible.length} of ${orders.length} can go on a SCAN form — ${why}.`
    : `Print one barcode covering these ${eligible.length} labels — USPS scans it once when they collect.`
}
