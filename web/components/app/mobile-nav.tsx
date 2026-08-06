"use client"

import Link from "next/link"
import { useState } from "react"
import { usePathname } from "next/navigation"
import { List, X, SignOut, LockSimple, type Icon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { useLabelT } from "@/lib/i18n"

export type MobileNavItem = { label: string; href: string; icon: Icon; locked?: boolean }
export type MobileNavSection = { heading?: string; items: MobileNavItem[] }

// The phone navigation: a sticky top bar with a hamburger (both shells lack a sidebar on
// mobile) + a slide-in drawer. Rendered md:hidden alongside the desktop sidebars.
export function MobileNav({ sections, onLogout, role }: { sections: MobileNavSection[]; onLogout: () => void; role?: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const nl = useLabelT()

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
        <button onClick={() => setOpen(true)} aria-label={nl("nav", "Open menu")} className="flex size-9 items-center justify-center rounded-lg text-foreground hover:bg-accent">
          <List size={20} weight="bold" />
        </button>
        <span className="font-display text-xl font-semibold tracking-tight">egful</span>
        {role && <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-medium capitalize tracking-normal text-primary">{role}</span>}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col border-r border-border bg-card shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="font-display text-xl font-semibold tracking-tight">egful</span>
              <button onClick={() => setOpen(false)} aria-label={nl("nav", "Close menu")} className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent">
                <X size={18} weight="bold" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3">
              {sections.map((section, i) => (
                <div key={i} className="mb-1">
                  {section.heading && <div className="px-3 pb-2 pt-5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{nl("nav", section.heading)}</div>}
                  {section.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + "/")
                    const Icon = item.icon
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors", active ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-accent hover:text-foreground")}>
                        <Icon size={20} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                        <span className="flex-1">{nl("nav", item.label)}</span>
                        {item.locked && <LockSimple size={13} weight="fill" className="shrink-0 text-muted-foreground/60" />}
                      </Link>
                    )
                  })}
                </div>
              ))}
            </nav>
            <div className="shrink-0 border-t border-border p-3">
              <button onClick={() => { setOpen(false); onLogout() }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground/70 hover:bg-accent hover:text-foreground">
                <SignOut size={20} className="text-muted-foreground" /> {nl("nav", "Log out")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
