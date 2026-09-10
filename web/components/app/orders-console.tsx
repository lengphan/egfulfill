"use client"

import { Printer } from "@phosphor-icons/react"
import { ConsoleShell } from "@/components/app/console-shell"
import { OrdersHub } from "@/components/app/orders-hub"

/**
 * THE SHELL LIVES ON THIS SIDE OF THE BOUNDARY, and it has to.
 *
 * The obvious version — `<ConsoleShell title="Orders" icon={Printer}>` straight in the route
 * file — throws at runtime: "Functions cannot be passed directly to Client Components". A
 * route is a SERVER component, ConsoleShell is a client one, and an icon prop is a function.
 * It type-checks perfectly and white-screens the page, which is exactly the class of bug a
 * compile pass cannot see.
 *
 * So the shell is configured in a client component and the routes render this. It is also
 * why /shipping works: shipping/page.tsx renders <ShippingView />, which owns its own shell.
 *
 * ONE definition for BOTH routes. /production is canonical and /warehouse is the legacy
 * entrance, and two copies of this config is how the same board ends up looking different
 * depending on which link somebody followed.
 *
 * NOT `bare`: that is for boards with no figures, and this one has four. StatGrid portals
 * them into the header rail by itself, so they travel up with the actions rather than
 * sitting in a grid underneath them.
 */
export function OrdersConsole() {
  return (
    <ConsoleShell title="Orders" icon={Printer}>
      <OrdersHub />
    </ConsoleShell>
  )
}
