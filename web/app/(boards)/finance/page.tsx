"use client"

import { Wallet } from "@phosphor-icons/react"
import { FinanceView } from "@/components/app/finance-view"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * ADOPTED FROM /finance/preview, which had been built and then left switched off.
 *
 * The page underneath is the same component doing the same work — only the shell around it
 * differs, and it is the shell that was the "cheap, undone" part:
 *
 *   · the four P&L figures were a 122px band of outlined cards; in the shell they are a
 *     figure rail in the page band, which is where every other board's numbers already are.
 *   · "Add Funds" and "Withdraw" already wrapped themselves in ActionsPortal, so they had
 *     been WAITING for this shell. Without one the portal renders in place — which is why
 *     they sat alone on their own row of bare canvas, belonging to nothing.
 *
 * Measured on the page: everything above the transaction table went from ~340px to ~90px.
 *
 * "use client" is not incidental. ConsoleShell takes `icon` as a COMPONENT, and a component
 * cannot cross the server→client boundary — a server page hands it over as a plain object
 * and React refuses it ("Only plain objects can be passed to Client Components"). Nothing
 * below this is server-rendered anyway; FinanceView and everything under it are client
 * components already. This is also why /finance/preview worked: it was a client component
 * all along.
 */
export default function FinancePage() {
  return (
    <ConsoleShell title="Finance" icon={Wallet}>
      <FinanceView />
    </ConsoleShell>
  )
}
