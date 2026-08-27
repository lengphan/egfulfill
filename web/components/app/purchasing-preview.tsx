"use client"

import { ShoppingCart } from "@phosphor-icons/react"
import { PurchasingView } from "@/components/app/purchasing-view"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * PREVIEW of the console shell, at /purchasing/preview. The page below is the SAME component
 * doing the same work — only the shell around it differs, and its StatGrid (if it has one)
 * lands in the header rather than in a 122px band of outlined cards above the content.
 * /purchasing is untouched.
 */
export function PurchasingPreview() {
  return (
    <ConsoleShell title="Purchasing" icon={ShoppingCart}>
      <PurchasingView />
    </ConsoleShell>
  )
}
