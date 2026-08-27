"use client"

import { CurrencyDollar } from "@phosphor-icons/react"
import { DesignerEarnings } from "@/components/app/designer-earnings"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * PREVIEW of the console shell, at /earnings/preview. The page below is the SAME component
 * doing the same work — only the shell around it differs, and its StatGrid (if it has one)
 * lands in the header rather than in a 122px band of outlined cards above the content.
 * /earnings is untouched.
 */
export function EarningsPreview() {
  return (
    <ConsoleShell title="Earnings" icon={CurrencyDollar}>
      <DesignerEarnings />
    </ConsoleShell>
  )
}
