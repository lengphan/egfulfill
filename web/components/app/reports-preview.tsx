"use client"

import { ChartBar } from "@phosphor-icons/react"
import { ReportsView } from "@/components/app/reports-view"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * PREVIEW of the console shell, at /reports/preview. The page below is the SAME component
 * doing the same work — only the shell around it differs, and its StatGrid (if it has one)
 * lands in the header rather than in a 122px band of outlined cards above the content.
 * /reports is untouched.
 */
export function ReportsPreview() {
  return (
    <ConsoleShell title="Reports" icon={ChartBar}>
      <ReportsView />
    </ConsoleShell>
  )
}
