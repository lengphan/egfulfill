import { CampaignsView } from "@/components/app/campaigns-view"
import { FullBleed } from "@/components/app/full-bleed"

export default function CampaignsPage() {
  return (
    <FullBleed reason="Campaign table — capping it brings back horizontal scroll.">
      <CampaignsView />
    </FullBleed>
  )
}
