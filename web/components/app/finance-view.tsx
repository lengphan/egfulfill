"use client"

import { WalletDashboard } from "@/components/app/wallet-dashboard"
import { CashAccountsPanel } from "@/components/app/cash-accounts-panel"

/**
 * Finance (factory) = the P&L cards on top, then the two lenses on the SAME ledger as tabs
 * BELOW: Transaction history (the wallet ledger) and Partner history (what we owe vendors —
 * byeastside, carriers, suppliers). Both now live inside WalletDashboard so the headline
 * P&L is always in view regardless of which history you're reading; `partnerHistory` turns
 * on the vendor tab, which is factory-only.
 */
export function FinanceView() {
  return (
    <div className="space-y-4">
      {/* WHERE the money is, above WHAT it did. The ledger below is the record of movement;
          this is the answer to "how much is in PingPong, and what is on the Shippo card" —
          the question that otherwise needs three browser tabs. */}
      <CashAccountsPanel />
      <WalletDashboard partnerHistory />
    </div>
  )
}
