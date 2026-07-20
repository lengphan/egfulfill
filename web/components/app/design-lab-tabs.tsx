"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { PenNib, Stack, Sparkle } from "@phosphor-icons/react"
import { tabsListVariants, tabsTriggerVariants } from "@/components/ui/tabs"
import { getToken } from "@/lib/auth"
import { cn } from "@/lib/utils"

/**
 * Design Lab's three surfaces as one toggle bar.
 *
 * Links, not shadcn Tabs, because the maker lives on its own route — it's a full-height
 * editor that doesn't fit in a tab panel, and the bar renders there too so it still reads
 * as one of the three. That means these ARE navigation, so they stay anchors with
 * aria-current; role="tab" would promise the ARIA tab pattern (arrow keys, a controlled
 * tabpanel) that links can't honour. Styling comes from tabsTriggerVariants so the bar
 * can't drift from the real tab bars in Settings and Wallet.
 */
const TABS = [
  { key: "library", label: "Library", href: "/design", icon: PenNib },
  { key: "templates", label: "Templates", href: "/design?tab=templates", icon: Stack },
  { key: "maker", label: "Design maker", href: "/design/maker", icon: Sparkle },
] as const

export type DesignLabTab = (typeof TABS)[number]["key"]

/** Which toggle the current URL is on. Kept here so the page and the bar can't disagree. */
export function useDesignLabTab(): DesignLabTab {
  const pathname = usePathname()
  const search = useSearchParams()
  if (pathname?.startsWith("/design/maker")) return "maker"
  return search.get("tab") === "templates" ? "templates" : "library"
}

export function DesignLabTabs({ className }: { className?: string }) {
  const active = useDesignLabTab()
  // Read after mount — getToken() touches localStorage, which the prerender doesn't have.
  // Deferred rather than set inline, matching how every other page here reads the session.
  const [signedOut, setSignedOut] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSignedOut(!getToken()), 0)
    return () => clearTimeout(id)
  }, [])

  return (
    <nav aria-label="Design Lab sections" className={cn(tabsListVariants(), "h-8", className)}>
      {TABS.map(({ key, label, href, icon: Icon }) => {
        const on = key === active
        // The maker is the only surface that needs a session — it loads the catalog and
        // saves. Signed out it renders an empty stage with a Save that 401s, so it's
        // disabled here the way the old "Open maker" button was.
        const disabled = signedOut && key === "maker"
        const body = <><Icon size={14} weight="bold" /> {label}</>
        const classes = cn(tabsTriggerVariants({ active: on }), "px-3")

        // The active toggle is inert on purpose: navigating to a tab's bare href while
        // already on it would strip ?template=/?product= out from under a loaded maker
        // session, leaving the editor holding a template the URL no longer names.
        if (on || disabled) {
          return (
            <span
              key={key}
              aria-current={on ? "page" : undefined}
              aria-disabled={disabled || undefined}
              title={disabled ? "Sign in to use the design maker" : undefined}
              className={cn(classes, disabled && "opacity-50")}
            >
              {body}
            </span>
          )
        }
        return (
          <Link key={key} href={href} className={classes}>
            {body}
          </Link>
        )
      })}
    </nav>
  )
}
