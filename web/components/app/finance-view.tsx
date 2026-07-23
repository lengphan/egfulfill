"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WalletDashboard } from "@/components/app/wallet-dashboard"
import { BillingView } from "@/components/app/billing-view"

/**
 * Finance = the two lenses on the SAME ledger, kept as tabs rather than merged (the way
 * Stripe/Shopify keep "balance" and "bills" separate). Wallet is account balances +
 * transactions; Partner costs is what we owe vendors (byeastside, carriers, suppliers…).
 */
export function FinanceView() {
  const [tab, setTab] = useState("wallet")
  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="wallet">Wallet</TabsTrigger>
        <TabsTrigger value="partners">Partner costs</TabsTrigger>
      </TabsList>
      <TabsContent value="wallet"><WalletDashboard /></TabsContent>
      <TabsContent value="partners"><BillingView /></TabsContent>
    </Tabs>
  )
}
