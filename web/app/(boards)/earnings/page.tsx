import { DesignerEarnings } from "@/components/app/designer-earnings"
import { FullBleed } from "@/components/app/full-bleed"

export default function EarningsPage() {
  return (
    <FullBleed reason="Payout table — capping it brings back horizontal scroll.">
      <DesignerEarnings />
    </FullBleed>
  )
}
