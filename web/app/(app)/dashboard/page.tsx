import { DashboardView } from "@/components/app/dashboard-view"
import { FullBleed } from "@/components/app/full-bleed"

export default function DashboardPage() {
  return (
    <FullBleed reason="Recent-orders table, 6 columns — capping it brings back horizontal scroll.">
      <DashboardView />
    </FullBleed>
  )
}
