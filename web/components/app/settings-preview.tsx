"use client"

import { Gear } from "@phosphor-icons/react"
import { SettingsView } from "@/components/app/settings-view"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * PREVIEW of the console shell, at /settings/preview. The page below is the SAME component
 * doing the same work — only the shell around it differs, and its StatGrid (if it has one)
 * lands in the header rather than in a 122px band of outlined cards above the content.
 * /settings is untouched.
 */
export function SettingsPreview() {
  return (
    <ConsoleShell bare title="Settings" icon={Gear}>
      <SettingsView />
    </ConsoleShell>
  )
}
