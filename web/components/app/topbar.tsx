"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import {
  MagnifyingGlass,
  Moon,
  Sun,
  Plus,
  CaretDown,
  ShoppingCart,
} from "@phosphor-icons/react"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { navTitle } from "@/lib/nav"
import { staffNavTitle } from "@/lib/staff-nav"
import { getWallet, getFactoryList, getOrderLimitStatus, getFactoryCapacity } from "@/lib/api"
import { onLive } from "@/lib/live"
import { getUser, clearSession, type User } from "@/lib/auth"
import { UserAvatar } from "@/components/app/user-avatar"
import { NotificationBell } from "@/components/app/notification-bell"
import { OrderSearch } from "@/components/app/order-search"
import { LanguageSwitcher } from "@/components/app/language-switcher"
import { ZoomControl } from "@/components/app/zoom-control"
import { useT, useLabelT } from "@/lib/i18n"

/**
 * Peak-season capacity readout in the header. A SELLER sees their own uploads-today vs their
 * limit ("Orders 3/10"); STAFF see the whole-floor total ("Factory 45/200"). Shows only when
 * peak-season mode is on, and re-fetches on the live "orders" ping so it ticks up as orders
 * are uploaded. Amber once the limit is reached.
 */
function CapacityBadge({ staff }: { staff: boolean }) {
  const [s, setS] = useState<{ mode: boolean; limit: number; usedToday: number; over?: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      ;(staff ? getFactoryCapacity() : getOrderLimitStatus())
        .then((r) => { if (alive) setS(r) })
        .catch(() => {})
    }
    const t = setTimeout(load, 0)
    const off = onLive("orders", load)
    return () => { alive = false; clearTimeout(t); off() }
  }, [staff])
  if (!s || !s.mode) return null
  // A seller needs a limit to show anything; staff show the count even with no ceiling.
  if (!staff && (!s.limit || s.limit <= 0)) return null
  const over = staff ? (s.limit > 0 && s.usedToday >= s.limit) : !!s.over
  const cap = s.limit > 0 ? `${s.usedToday}/${s.limit}` : String(s.usedToday)
  return (
    <span
      title={staff ? "Orders taken in today across the floor" : "Orders you've uploaded today vs your daily limit"}
      className={"hidden items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums sm:inline-flex " + (over ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground")}
    >
      {staff ? "Factory" : "Orders"} {cap}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

export function TopBar({ balance: initialBalance }: { balance?: number }) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useT()
  const nl = useLabelT()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  // null until the real balance loads — never show a fake default (that made the
  // topbar disagree with the Wallet page).
  const [balance, setBalance] = useState<number | null>(initialBalance ?? null)
  const [name, setName] = useState("Account")
  const [role, setRole] = useState<string | undefined>(undefined)
  const [user, setUser] = useState<User | null>(null) // carries the avatar emoji/colour
  useEffect(() => {
    const sync = () => {
      const u = getUser()
      if (u?.name) setName(u.name)
      setRole(u?.role)
      setUser(u)
    }
    const id = setTimeout(() => {
      setMounted(true)
      sync()
    }, 0)
    // Reflect a profile name change made in Settings without a reload.
    window.addEventListener("eg-user-changed", sync)
    return () => {
      clearTimeout(id)
      window.removeEventListener("eg-user-changed", sync)
    }
  }, [])

  const logout = () => {
    clearSession()
    router.push("/login")
  }

  // ⌘K / Ctrl-K opens order search from anywhere.
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Real balance (server-authoritative); silently keeps the fallback if no session/API.
  // Re-reads on "eg-wallet-changed" — anything that moves money (a plan purchase, a
  // top-up) fires it. Without that this ran once on mount, so the header still showed
  // the pre-purchase balance until a full reload.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      getWallet()
        .then((w) => { if (!cancelled) setBalance(w.balance) })
        .catch(() => {})
    }
    load()
    window.addEventListener("eg-wallet-changed", load)
    return () => {
      cancelled = true
      window.removeEventListener("eg-wallet-changed", load)
    }
  }, [])

  const isStaff = !!role && role !== "seller"
  // The purchasing cart lives at the top bar so the to-order pool is reachable from any
  // page — the whole point of merging Suppliers + Purchase. Same roles that can reach the
  // Purchasing section. Count is the number of saved to-order lines (`po_saved`).
  const showCart = isStaff && (role === "operator" || role === "warehouse" || role === "admin")
  const [cartCount, setCartCount] = useState(0)
  useEffect(() => {
    if (!showCart) return
    let cancelled = false
    const load = () => getFactoryList<unknown[]>("po_saved")
      .then((r) => { if (!cancelled) setCartCount(Array.isArray(r) ? r.length : 0) })
      .catch(() => {})
    load()
    // Refresh when anything changes the pool, and on navigation (e.g. leaving the cart).
    window.addEventListener("eg-cart-changed", load)
    return () => { cancelled = true; window.removeEventListener("eg-cart-changed", load) }
  }, [showCart, pathname])

  const title = nl("nav", isStaff ? staffNavTitle(pathname) : navTitle(pathname))
  // Balance only for accounts with a selling wallet — sellers, admin, warehouse. Not operator/designer.
  // Sellers see their own balance (it is their money and they need it to submit orders).
  // Among staff, ADMIN only: the factory balance is company revenue, and warehouse no
  // longer has any wallet surface to click through to. Matches canAccess in wallet.js —
  // the chip would otherwise 403 on load and render an empty box.
  const showBalance = !isStaff || role === "admin"
  const money = balance == null ? "—" : balance.toLocaleString("en-US", { style: "currency", currency: "USD" })

  return (
    <header className="sticky top-0 z-20 hidden h-16 items-center gap-3 border-b border-border bg-background px-6 md:flex">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>

      <div className="ml-auto flex items-center gap-1">
        <IconButton label={t("topbar.searchOrders")} onClick={() => setSearchOpen(true)}>
          <MagnifyingGlass size={18} />
        </IconButton>
        <OrderSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
        <CapacityBadge staff={isStaff} />
        <NotificationBell />
        <LanguageSwitcher />
        <ZoomControl />
        <IconButton
          label={t("topbar.toggleTheme")}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {mounted && resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>

        {showCart && (
          <IconButton label="Purchasing cart" onClick={() => router.push("/purchasing?tab=purchase")}>
            <ShoppingCart size={18} />
            {cartCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold leading-none text-primary-foreground">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </IconButton>
        )}

        <Separator orientation="vertical" className="mx-2 !h-6" />

        {showBalance && (
          <button
            onClick={() => router.push("/wallet")}
            className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-accent"
          >
            <span className="text-muted-foreground">{t("topbar.balance")}</span>
            <span className="font-semibold tabular-nums">{money}</span>
          </button>
        )}

        {!isStaff && (
          <DropdownMenu>
            <DropdownMenuTrigger className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <Plus size={16} weight="bold" />
              {t("topbar.new")}
              <CaretDown size={12} className="opacity-80" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => router.push("/orders/new")}>{t("topbar.new.manualOrder")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/stores")}>{t("topbar.new.syncPlatforms")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Separator orientation="vertical" className="mx-2 !h-6" />

        {/* Split control: the name itself is a shortcut straight to the profile, and
            the caret opens the menu — clicking your own name to go anywhere but your
            profile is a surprise. */}
        <div className="flex items-center">
          <button
            onClick={() => router.push("/settings")}
            title={t("topbar.yourProfile")}
            className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <UserAvatar user={user ?? { name }} size={32} />
            <span className="text-sm font-semibold">{name.split(" ")[0]}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("topbar.accountMenu")}
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <CaretDown size={12} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* Grouped: Base UI's GroupLabel throws outside a Group, taking the whole
                  menu down with it. */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{name}</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>{t("topbar.profileSettings")}</DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                {t("topbar.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
