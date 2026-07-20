"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { PenNib, Stack, Sparkle } from "@phosphor-icons/react"
import { tabsListVariants } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

/**
 * Design Lab's three surfaces as one toggle bar.
 *
 * Links rather than shadcn Tabs because the maker lives on its own route — it's a
 * full-height editor and doesn't fit inside a tab panel. The bar renders on that route
 * too, so the maker still reads as one of the three toggles instead of a page you got
 * navigated away to. Styling reuses `tabsListVariants` so it stays identical to the
 * tab bars in Settings and Wallet.
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

  return (
    <div role="tablist" className={cn(tabsListVariants(), "h-8", className)}>
      {TABS.map(({ key, label, href, icon: Icon }) => {
        const on = key === active
        return (
          <Link
            key={key}
            href={href}
            role="tab"
            aria-selected={on}
            className={cn(
              "relative inline-flex h-full items-center justify-center gap-1.5 rounded-2xl px-3 text-sm font-medium whitespace-nowrap transition-all",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
              on
                ? "bg-background text-foreground dark:border dark:border-input dark:bg-input/30"
                : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground"
            )}
          >
            <Icon size={14} weight="bold" />
            {label}
          </Link>
        )
      })}
    </div>
  )
}
