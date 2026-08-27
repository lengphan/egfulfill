"use client"

import { EnvelopeSimple } from "@phosphor-icons/react"
import { BroadcastsView } from "@/components/app/broadcasts-view"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * PREVIEW of the console shell, at /broadcasts/preview. The page below is the SAME component
 * doing the same work — only the shell around it differs, and its StatGrid (if it has one)
 * lands in the header rather than in a 122px band of outlined cards above the content.
 * /broadcasts is untouched.
 */
export function BroadcastsPreview() {
  return (
    <ConsoleShell title="Broadcasts" icon={EnvelopeSimple}>
      <BroadcastsView embedded />
    </ConsoleShell>
  )
}
