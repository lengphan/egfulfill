"use client"

import { Binoculars } from "@phosphor-icons/react"
import { SpyDeckView } from "@/components/app/spydeck-view"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * PREVIEW of the console shell, at /spydeck/preview. The page below is the SAME component
 * doing the same work — only the shell around it differs, and its StatGrid (if it has one)
 * lands in the header rather than in a 122px band of outlined cards above the content.
 * /spydeck is untouched.
 */
export function SpyDeckPreview() {
  return (
    <ConsoleShell title="SpyDeck" icon={Binoculars}>
      <SpyDeckView />
    </ConsoleShell>
  )
}
