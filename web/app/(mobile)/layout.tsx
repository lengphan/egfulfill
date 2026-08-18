import type { ReactNode } from "react"
import { TabBar } from "@/components/mobile/tab-bar"

/*
 * THE PHONE SHELL — a sibling of (app), not a narrower version of it.
 *
 * The console's layout brings a sidebar, a top bar and a page container built for a mouse
 * and 1600px. Making those survive at 390px is what "responsive" bought us; it is not what
 * an app is. This group starts from the other end: one column, a fixed tab bar, and screens
 * that assume a thumb.
 *
 * It shares everything that matters — lib/api, the role gates, the tokens — so there is no
 * second definition of how anything works, only a second arrangement.
 */
export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* pb clears the 56px bar plus the home indicator, so the last row of a list is
          reachable instead of sitting under the tabs. */}
      <main className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))]">{children}</main>
      <TabBar />
    </div>
  )
}
