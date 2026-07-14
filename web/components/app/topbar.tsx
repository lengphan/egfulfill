"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import {
  MagnifyingGlass,
  Bell,
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

export function TopBar({ balance = 12480 }: { balance?: number }) {
  const pathname = usePathname()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const title = navTitle(pathname)
  const money = balance.toLocaleString("en-US", { style: "currency", currency: "USD" })

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card px-6">
      <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>

      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Search">
          <MagnifyingGlass size={18} />
        </IconButton>
        <IconButton label="Notifications">
          <Bell size={18} />
          <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full border-2 border-card bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
            8
          </span>
        </IconButton>
        <IconButton
          label="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {mounted && resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>

        <Separator orientation="vertical" className="mx-2 !h-6" />

        <div className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm">
          <span className="text-muted-foreground">Balance</span>
          <span className="font-semibold tabular-nums">{money}</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <Plus size={16} weight="bold" />
            New
            <CaretDown size={12} className="opacity-80" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem>Manual order</DropdownMenuItem>
            <DropdownMenuItem>Sync from platforms</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-2 !h-6" />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-accent focus-visible:outline-none">
            <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
              P
            </span>
            <span className="text-sm font-semibold">Phan</span>
            <CaretDown size={12} className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Phan</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive">
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
