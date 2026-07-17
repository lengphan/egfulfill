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
} from "@phosphor-icons/react"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { navTitle } from "@/lib/nav"
import { staffNavTitle } from "@/lib/staff-nav"
import { getWallet } from "@/lib/api"
import { getUser, clearSession, type User } from "@/lib/auth"
import { UserAvatar } from "@/components/app/user-avatar"
import { NotificationBell } from "@/components/app/notification-bell"

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

  // Real balance (server-authoritative); silently keeps the fallback if no session/API.
  useEffect(() => {
    let cancelled = false
    getWallet()
      .then((w) => {
        if (!cancelled) setBalance(w.balance)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const isStaff = !!role && role !== "seller"
  const title = isStaff ? staffNavTitle(pathname) : navTitle(pathname)
  // Balance only for accounts with a selling wallet — sellers, admin, warehouse. Not operator/designer.
  const showBalance = !isStaff || role === "admin" || role === "warehouse"
  const money = balance == null ? "—" : balance.toLocaleString("en-US", { style: "currency", currency: "USD" })

  return (
    <header className="sticky top-0 z-20 hidden h-16 items-center gap-3 border-b border-border bg-card px-6 md:flex">
      <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>

      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Search">
          <MagnifyingGlass size={18} />
        </IconButton>
        <NotificationBell />
        <IconButton
          label="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {mounted && resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>

        <Separator orientation="vertical" className="mx-2 !h-6" />

        {showBalance && (
          <button
            onClick={() => router.push("/wallet")}
            className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-accent"
          >
            <span className="text-muted-foreground">Balance</span>
            <span className="font-semibold tabular-nums">{money}</span>
          </button>
        )}

        {!isStaff && (
          <DropdownMenu>
            <DropdownMenuTrigger className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <Plus size={16} weight="bold" />
              New
              <CaretDown size={12} className="opacity-80" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => router.push("/orders/new")}>Manual order</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/stores")}>Sync from platforms</DropdownMenuItem>
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
            title="Your profile"
            className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <UserAvatar user={user ?? { name }} size={32} />
            <span className="text-sm font-semibold">{name.split(" ")[0]}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Account menu"
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <CaretDown size={12} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>Profile &amp; settings</DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
