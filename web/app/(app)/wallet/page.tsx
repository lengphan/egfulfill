import { WalletDashboard } from "@/components/app/wallet-dashboard"
import { FullBleed } from "@/components/app/full-bleed"

export default function WalletPage() {
  return (
    <FullBleed reason="Ledger table, 7 columns — capping it brings back horizontal scroll.">
      <WalletDashboard />
    </FullBleed>
  )
}
