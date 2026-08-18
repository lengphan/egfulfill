"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { House, Package, Barcode, ChatCircleDots, DotsThreeCircle, type Icon } from "@phosphor-icons/react"
import { getUser } from "@/lib/auth"
import { useMounted } from "@/lib/use-mounted"

type Tab = { href: string; label: string; icon: Icon; staffOnly?: boolean }

/*
 * FIVE DESTINATIONS, thumb-height. Not the sidebar shrunk into a drawer.
 *
 * A hamburger hides every destination behind a tap and a wait, which is fine for a console
 * you drive with a mouse and wrong for something held in one hand on a factory floor. These
 * are the jobs people actually open a phone to do; everything else lives under More, and
 * the full console is still a browser away.
 */
const TABS: Tab[] = [
  { href: "/today", label: "Today", icon: House },
  { href: "/orders", label: "Orders", icon: Package },
  { href: "/inventory?tab=scan", label: "Scan", icon: Barcode, staffOnly: true },
  { href: "/chat", label: "Chat", icon: ChatCircleDots },
  { href: "/more", label: "More", icon: DotsThreeCircle },
]

export function TabBar() {
  const pathname = usePathname()
  /* The role lives in localStorage, so the server cannot know it. Rendering the staff tab
     during SSR and not on the client (or the reverse) is a hydration mismatch — and a tab
     bar that changes length on hydration visibly jumps. Assume no staff tabs until mounted. */
  const mounted = useMounted()
  const isStaff = mounted && (() => { const r = getUser()?.role; return !!r && r !== "seller" })()
  const tabs = TABS.filter((t) => !t.staffOnly || isStaff)

  return (
    <nav
      aria-label="Main"
      /* The bar floats over content, so it needs its own ground — a translucent white with
         blur, not a hard block, so the list underneath reads as continuing beneath it.
         pb accounts for the home indicator; without it the labels sit under the gesture bar. */
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.map((t) => {
          const base = t.href.split("?")[0]
          const active = pathname === base || (base !== "/today" && pathname.startsWith(base))
          const Ico = t.icon
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                /* 56px tall: comfortably past the 44pt floor, and the whole cell is the
                   target rather than just the glyph. */
                className={
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors " +
                  (active ? "text-primary" : "text-muted-foreground active:text-foreground")
                }
              >
                <Ico size={21} weight={active ? "fill" : "regular"} />
                <span>{t.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
