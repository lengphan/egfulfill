/**
 * WHAT A PAYMENT RAIL IS CALLED ON SCREEN.
 *
 * The stored value is the RAIL — `vietqr` — because that is what issues the virtual account,
 * what the payment poll reconciles against, and what `wallet_ledger` rows are keyed on. None
 * of that may change: renaming the data would break the match between a payment and the row
 * it settles, on an append-only ledger where that match is the only link there is.
 *
 * But nobody transferring money recognises "VietQR". They see BIDV in their banking app and
 * on their statement, so BIDV is what a person reading their own money should see. A display
 * map, never a migration.
 *
 * DELIBERATELY NOT APPLIED IN SETTINGS › INTEGRATIONS. That row names the SERVICE whose API
 * keys you paste in, and the keys say VietQR on them — calling it BIDV there would send
 * someone looking for credentials a bank does not issue. Money-facing surfaces read BIDV;
 * the setup surface keeps the vendor's own name.
 */
const LABEL: Record<string, string> = { vietqr: "BIDV" }

/** BIDV for a VietQR rail, otherwise the value unchanged (capitalised for bare type keys). */
export function methodLabel(m?: string | null): string {
  const raw = String(m ?? "").trim()
  if (!raw) return ""
  return LABEL[raw.toLowerCase()] ?? raw
}

/** For a ledger `type` that may carry the rail inside it ("vietqr", "payout-vietqr"). */
export function labelRail(type?: string | null): string {
  const raw = String(type ?? "").trim()
  if (!raw) return ""
  return raw.replace(/vietqr/gi, "BIDV")
}

/**
 * THE PAYOUT RAILS — one list, because two screens choose from it and they must agree.
 *
 * A designer NOMINATES one of these; an admin RECORDS the one money actually went out on,
 * and they are often different (see the note on paid_method in payouts.js). Both pickers
 * read this, so a rail cannot exist on one screen and not the other.
 *
 * `id` is stored and never renamed — it ends up in `wallet_ledger` notes and in the
 * `method` / `paid_method` snapshots, and those are append-only.
 *
 * REMITLY IS HERE AS A MANUAL RAIL, NOT AN INTEGRATION. Remitly does have a developer
 * offering — "Remitly for Developers" / Remitly Access — but it is a GATED enterprise
 * partner API aimed at banks, payroll apps and wallets; there is no self-serve signup, no
 * key you can fetch, and nothing to test against. Building a client for an API we cannot
 * call is how the supplier-ordering payloads ended up written, gated off and never once
 * validated. So it is a rail an admin selects and evidences with a screenshot, exactly like
 * the others — and if Remitly ever approves a partnership, the API slots in behind this same
 * id without the data model moving.
 */
export type PayoutRail = { id: string; label: string; account: "id" | "number" | "none"; hint?: string }

export const PAYOUT_RAILS: PayoutRail[] = [
  { id: "bank", label: "Bank transfer", account: "number" },
  { id: "paypal", label: "PayPal", account: "id", hint: "PayPal email" },
  { id: "pingpong", label: "PingPong", account: "id", hint: "PingPong email or ID" },
  { id: "lianlian", label: "LianLian", account: "id", hint: "LianLian email or ID" },
  { id: "remitly", label: "Remitly", account: "id", hint: "Phone or account the transfer went to" },
  { id: "cash", label: "Cash", account: "none" },
]

const RAIL_BY_ID = new Map(PAYOUT_RAILS.map((r) => [r.id, r]))

/** The display name for a stored payout rail id — falls back to the id for anything older. */
export function railLabel(id?: string | null): string {
  const raw = String(id ?? "").trim()
  if (!raw) return ""
  return RAIL_BY_ID.get(raw.toLowerCase())?.label ?? methodLabel(raw)
}
