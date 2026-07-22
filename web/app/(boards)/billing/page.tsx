import { BillingView } from "@/components/app/billing-view"
import { FullBleed } from "@/components/app/full-bleed"

export default function BillingPage() {
  return (
    <FullBleed reason="Invoice table — capping it brings back horizontal scroll.">
      <BillingView />
    </FullBleed>
  )
}
