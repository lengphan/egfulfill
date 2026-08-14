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
    /**
     * BESIDE, not above.
     *
     * Stacked, the accounts took a full band — and with the rails offered, two bands — of
     * white space before the numbers anyone opens this page for. They are a narrow column
     * now, so the whole set is one glance and the P&L keeps the width it needs.
     *
     * One column on small screens, where side-by-side would squeeze both. The accounts come
     * first there: on a phone you are far more likely to be checking a balance than reading
     * a P&L.
     */
    <div className="grid gap-4 lg:grid-cols-[minmax(190px,230px)_1fr] lg:items-start">
      <CashAccountsPanel />
      <WalletDashboard partnerHistory />
    </div>
  )
}
