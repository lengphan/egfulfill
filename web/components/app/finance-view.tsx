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
     * A THIN BAND ABOVE, NOT A COLUMN BESIDE.
     *
     * As a side column it was a sibling of the ENTIRE dashboard, so a short list of accounts
     * squeezed everything: the P&L dropped from four cards across to two, the transaction
     * table lost most of its width, and the space under five accounts was simply dead.
     *
     * The reason it was moved out of the flow in the first place — a tall stack pushing the
     * numbers down — is gone: the cards are half the height now and the unset rails are
     * chips rather than cards, so the whole set is one strip. Above and full width lets the
     * table have the page back.
     */
    <div className="space-y-4">
      <CashAccountsPanel />
      <WalletDashboard partnerHistory />
    </div>
  )
}
