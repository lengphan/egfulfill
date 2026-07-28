"use client"

import { WalletDashboard } from "@/components/app/wallet-dashboard"

/**
 * Finance (factory) = the P&L cards on top, then the two lenses on the SAME ledger as tabs
 * BELOW: Transaction history (the wallet ledger) and Partner history (what we owe vendors —
 * byeastside, carriers, suppliers). Both now live inside WalletDashboard so the headline
 * P&L is always in view regardless of which history you're reading; `partnerHistory` turns
 * on the vendor tab, which is factory-only.
 */
export function FinanceView() {
  return <WalletDashboard partnerHistory />
}
