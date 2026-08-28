"use client"

import { Compass } from "@phosphor-icons/react"
import { SourcingView } from "@/components/app/sourcing-view"
import { ConsoleShell } from "@/components/app/console-shell"

/**
 * ADOPTED FROM /sourcing/preview, which had been built and then left switched off.
 *
 * The view underneath is unchanged — only the shell around it. Without one, a view's
 * StatGrid draws a band of outlined cards above the content and anything it hoists through
 * ActionsPortal renders in place, on bare canvas, belonging to nothing. With one, the
 * figures become a rail in the page band and the actions land beside them, which is what
 * every board was supposed to look like.
 *
 * "use client" is required: ConsoleShell takes `icon` as a COMPONENT, and a component
 * cannot cross the server->client boundary. That is why the preview worked and the live
 * page could not have simply imported the shell — the preview was a client component.
 */
export default function SourcingPage() {
  return (
    <ConsoleShell bare title="Sourcing" icon={Compass}>
      <SourcingView embedded />
    </ConsoleShell>
  )
}
