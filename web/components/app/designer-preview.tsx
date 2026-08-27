"use client"

import { PenNib } from "@phosphor-icons/react"
import { DesignerBoard } from "@/components/app/designer-board"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * PREVIEW of the console shell, at /designer/preview. The page below is the SAME component
 * doing the same work — only the shell around it differs, and its StatGrid (if it has one)
 * lands in the header rather than in a 122px band of outlined cards above the content.
 * /designer is untouched.
 */
export function BoardPreview() {
  return (
    <ConsoleShell title="Board" icon={PenNib}>
      <DesignerBoard />
    </ConsoleShell>
  )
}
