"use client"

import { Wallet } from "@phosphor-icons/react"
import { FinanceView } from "@/components/app/finance-view"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * PREVIEW of the console shell, at /finance/preview. The page below is the SAME component
 * doing the same work — only the shell around it differs, and its StatGrid (if it has one)
 * lands in the header rather than in a 122px band of outlined cards above the content.
 * /finance is untouched.
 */
export function FinancePreview() {
  return (
    <ConsoleShell title="Finance" icon={Wallet}>
      <FinanceView />
    </ConsoleShell>
  )
}
