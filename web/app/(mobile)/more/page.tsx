"use client"

import Link from "next/link"
import { CaretRight, Package, Storefront, Wallet, ChartBar, Gear, SignOut, PenNib, Truck } from "@phosphor-icons/react"
import { getUser, clearSession } from "@/lib/auth"
import { useMounted } from "@/lib/use-mounted"

/*
 * MORE — the rest of the console, as a list.
 *
 * Five tabs cover what people open a phone to do; everything else lives here rather than
 * being crammed into the bar. These are the FULL console screens, which are responsive but
 * not phone-native — so this is a door to the web app, not a claim that each one is an app
 * screen. Being honest about that is better than five tabs that each open something built
 * for a mouse.
 */
type Item = { href: string; label: string; icon: typeof Package; staffOnly?: boolean }

const GROUPS: { heading: string; items: Item[] }[] = [
  {
    heading: "Work",
    items: [
      { href: "/inventory", label: "Inventory", icon: Package, staffOnly: true },
      { href: "/shipping", label: "Shipping", icon: Truck, staffOnly: true },
      { href: "/design", label: "Design", icon: PenNib, staffOnly: true },
    ],
  },
  {
    heading: "Business",
    items: [
      { href: "/stores", label: "Stores", icon: Storefront },
      { href: "/wallet", label: "Wallet", icon: Wallet },
      { href: "/reports", label: "Reports", icon: ChartBar, staffOnly: true },
    ],
  },
  { heading: "Account", items: [{ href: "/settings", label: "Settings", icon: Gear }] },
]

export default function MorePage() {
  const mounted = useMounted()
  const user = mounted ? getUser() : null
  const isStaff = !!user?.role && user.role !== "seller"

  return (
    <div className="mx-auto max-w-lg">
      <header className="px-5 pb-4 pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <h1 className="text-3xl font-black tracking-tight">More</h1>
        {/* min-h so the header doesn't jump when the name arrives after mount. */}
        <p className="min-h-5 text-sm text-muted-foreground">
          {user ? `${user.name || user.email}${user.role ? ` · ${user.role}` : ""}` : ""}
        </p>
      </header>

      {GROUPS.map((g) => {
        const items = g.items.filter((i) => !i.staffOnly || isStaff)
        if (!items.length) return null
        return (
          <section key={g.heading} className="mb-5 px-5">
            <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.heading}</h2>
            <ul className="overflow-hidden rounded-2xl border border-border">
              {items.map((it, i) => {
                const Ico = it.icon
                return (
                  <li key={it.href} className={i ? "border-t border-border" : ""}>
                    <Link href={it.href} className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-accent/60">
                      <Ico size={18} weight="duotone" className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.label}</span>
                      <CaretRight size={14} weight="bold" className="shrink-0 text-muted-foreground/50" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <div className="px-5 pb-8">
        <button
          onClick={() => { clearSession(); window.location.href = "/login" }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border py-3.5 text-sm font-medium text-muted-foreground transition-colors active:bg-accent"
        >
          <SignOut size={16} /> Sign out
        </button>
      </div>
    </div>
  )
}
