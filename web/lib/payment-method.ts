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
