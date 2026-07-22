import { ReportsView } from "@/components/app/reports-view"
import { FullBleed } from "@/components/app/full-bleed"

export default function ReportsPage() {
  return (
    <FullBleed reason="Report table plus side-by-side charts.">
      <ReportsView />
    </FullBleed>
  )
}
