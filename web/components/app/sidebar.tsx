"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { SignOut, LockSimple } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { sellerNav } from "@/lib/nav"
import { hasSpydeck } from "@/lib/plans"

export function Sidebar() {
  const pathname = usePathname()
  // Plan-gated items (SpyDeck) — read entitlement after mount and re-check when the
  // plan/add-on changes (setPlan/setSpydeckAddon fire "eg-plan-changed").
  const [spydeck, setSpydeck] = useState(true)
  useEffect(() => {
    const sync = () => setSpydeck(hasSpydeck())
    const id = setTimeout(sync, 0)
    window.addEventListener("eg-plan-changed", sync)
    return () => {
      clearTimeout(id)
      window.removeEventListener("eg-plan-changed", sync)
    }
  }, [])

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card md:flex">
      {/* Wordmark — clean bold sans (retired the serif logo) */}
      <div className="flex h-16 shrink-0 items-center border-b border-border px-5">
        <Link href="/dashboard" className="font-display text-2xl font-semibold tracking-tight text-foreground">
          egfulfill
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {sellerNav.map((section, i) => (
          <div key={i} className="mb-1">
            {section.heading && (
              <div className="px-3 pb-2 pt-5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.heading}
              </div>
            )}
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/")
              const Icon = item.icon
              const locked = item.gate === "spydeck" && !spydeck
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/70 hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon
                    size={19}
                    weight={active ? "fill" : "regular"}
                    className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}
                  />
                  <span className="flex-1">{item.label}</span>
                  {locked && <LockSimple size={13} weight="fill" className="shrink-0 text-muted-foreground/60" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground">
          <SignOut size={19} className="text-muted-foreground" />
          Log out
        </button>
      </div>
    </aside>
  )
}
