"use client"

import { Compass } from "@phosphor-icons/react"
import { SourcingView } from "@/components/app/sourcing-view"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * PREVIEW of the console shell, at /sourcing/preview. The page below is the SAME component
 * doing the same work — only the shell around it differs, and its StatGrid (if it has one)
 * lands in the header rather than in a 122px band of outlined cards above the content.
 * /sourcing is untouched.
 */
export function SourcingPreview() {
  return (
    <ConsoleShell title="Sourcing" icon={Compass}>
      <SourcingView embedded />
    </ConsoleShell>
  )
}
