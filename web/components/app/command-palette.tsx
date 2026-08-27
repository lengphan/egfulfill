"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { MagnifyingGlass, ArrowRight, CircleNotch, type Icon } from "@phosphor-icons/react"
import { sellerNav } from "@/lib/nav"
import { STAFF_ITEMS, STAFF_TOOLS } from "@/lib/staff-nav"
import { getOrders, getCatalogProducts, getInventory } from "@/lib/api"
import { numOf } from "@/lib/order-format"
import { cn } from "@/lib/utils"

/**
 * ⌘K — SEARCH THE WHOLE PRODUCT FROM ANYWHERE.
 *
 * Not a nav jumper. The point is that you should never have to travel to a screen in order
 * to search the thing that screen lists: an order, a product, a sku, a page — one field,
 * results grouped underneath it.
 *
 * ONE FETCH, NOT ONE PER KEYSTROKE. This is the §2.8 shape done safely. The three sources
 * are `cachedList` fetchers, so opening the palette warms them ONCE and every subsequent
 * character filters an array already in memory. A palette that queried the server per
 * keystroke would be the exact runaway this codebase has been burned by; there is no
 * endpoint that searches orders or inventory anyway, so local filtering is both the safe
 * answer and the only one.
 *
 * Loading is gated on OPEN, which is an event a person causes and cannot repeat by itself.
 */
type Row = { id: string; label: string; hint?: string; icon?: Icon; run: () => void }
type Group = { heading: string; rows: Row[]; total: number }

const CAP = 5

export function CommandPalette({ staff = false }: { staff?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [cursor, setCursor] = useState(0)
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([])
  const [products, setProducts] = useState<Array<Record<string, unknown>>>([])
  const [stock, setStock] = useState<Array<Record<string, unknown>>>([])
  const loaded = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v) }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { setQ(""); setCursor(0); inputRef.current?.focus() }, 0)
    // ONCE PER SESSION. `loaded` is a ref, so a re-open cannot re-enter this, and the
    // fetchers are cached besides — two independent reasons the network stays quiet.
    if (!loaded.current) {
      loaded.current = true
      setLoading(true)
      // allSettled: a seller has no inventory endpoint and will 403. One refusal must not
      // take the other two lists — or the palette — down with it.
      void Promise.allSettled([getOrders(), getCatalogProducts(), staff ? getInventory() : Promise.resolve([])])
        .then(([o, p, s]) => {
          if (o.status === "fulfilled") setOrders(o.value as never)
          if (p.status === "fulfilled") setProducts(p.value as never)
          if (s.status === "fulfilled") setStock(s.value as never)
        })
        .finally(() => setLoading(false))
    }
    return () => clearTimeout(t)
  }, [open, staff])

  const go = useCallback((href: string) => { setOpen(false); router.push(href) }, [router])

  const pages: Row[] = useMemo(() => {
    const out: Row[] = []
    if (staff) for (const it of [...STAFF_ITEMS, ...STAFF_TOOLS]) out.push({ id: it.href, label: it.label, icon: it.icon, run: () => go(it.href) })
    else for (const s of sellerNav) for (const it of s.items) out.push({ id: it.href, label: it.label, hint: s.heading, icon: it.icon, run: () => go(it.href) })
    const seen = new Set<string>()
    return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  }, [staff, go])

  const term = q.trim()
  const lower = term.toLowerCase()

  const groups: Group[] = useMemo(() => {
    const hit = (...vals: unknown[]) => vals.some((v) => String(v ?? "").toLowerCase().includes(lower))
    const build = (heading: string, all: Row[]): Group => ({ heading, rows: all.slice(0, CAP), total: all.length })
    const out: Group[] = []

    if (!lower) return [build("Pages", pages.slice(0, 8))]

    // An order number IS a route, so this works before any list arrives.
    const raw = term.replace(/^#/, "")
    if (raw.length >= 3 && /[0-9]/.test(raw) && !/\s/.test(raw)) {
      out.push({ heading: "Jump", total: 1, rows: [{ id: "jump:" + raw, label: `Open order ${raw}`, hint: "by number", run: () => go(`/orders/${encodeURIComponent(raw)}`) }] })
    }

    const pg = pages.filter((r) => r.label.toLowerCase().includes(lower))
    if (pg.length) out.push(build("Pages", pg))

    const ord = orders.filter((o) => hit(numOf(o as never), o.id, o.customer_name, (o.customer as { name?: string } | null)?.name, o.store))
      .map((o) => {
        const n = numOf(o as never)
        return { id: "o:" + String(o.id), label: n, hint: String((o.customer as { name?: string } | null)?.name ?? o.customer_name ?? o.store ?? ""), run: () => go(`/orders/${encodeURIComponent(String(o.id))}`) }
      })
    if (ord.length) out.push(build("Orders", ord))

    const prod = products.filter((p) => hit(p.name, p.sku, p.type))
      .map((p) => ({ id: "p:" + String(p.id ?? p.sku), label: String(p.name ?? p.sku ?? ""), hint: String(p.sku ?? ""), run: () => go(`/products/${encodeURIComponent(String(p.id ?? p.sku))}`) }))
    if (prod.length) out.push(build("Products", prod))

    const inv = stock.filter((s) => hit(s.sku, s.name, s.variant))
      .map((s) => ({ id: "s:" + String(s.sku), label: String(s.sku), hint: String(s.name ?? s.variant ?? ""), run: () => go(`/inventory?q=${encodeURIComponent(String(s.sku))}`) }))
    if (inv.length) out.push(build("Stock", inv))

    return out
  }, [lower, term, pages, orders, products, stock, go])

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)) }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    if (e.key === "Enter") { e.preventDefault(); flat[cursor]?.run() }
  }

  let idx = -1
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-foreground/35" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          {loading
            ? <CircleNotch size={16} className="shrink-0 animate-spin text-muted-foreground" />
            : <MagnifyingGlass size={16} className="shrink-0 text-muted-foreground" />}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0) }}
            onKeyDown={onKeyDown}
            placeholder="Search orders, products, stock and pages…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-2xs font-semibold text-muted-foreground">esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {flat.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : term ? `Nothing matches “${term}”.` : "Type to search."}
            </div>
          ) : groups.map((g) => (
            <div key={g.heading} className="mb-1">
              <div className="flex items-baseline gap-2 px-3 pb-1 pt-2">
                <span className="eg-label text-muted-foreground">{g.heading}</span>
                {/* WHAT IS NOT SHOWN, SAID. A capped list that stays silent about the cap
                    reads as "there are four", which is a different claim from "here are the
                    first four of sixty". */}
                {g.total > g.rows.length && (
                  <span className="text-2xs text-muted-foreground">{g.rows.length} of {g.total}</span>
                )}
              </div>
              {g.rows.map((r) => {
                idx += 1
                const i = idx
                const RowIcon = r.icon
                return (
                  <button
                    key={r.id}
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => r.run()}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      i === cursor ? "bg-brand font-semibold text-brand-foreground" : "text-foreground",
                    )}
                  >
                    {RowIcon ? <RowIcon size={16} className="shrink-0" /> : <ArrowRight size={16} className="shrink-0" />}
                    <span className="flex-1 truncate">{r.label}</span>
                    {r.hint && <span className={cn("shrink-0 truncate text-2xs", i === cursor ? "text-brand-foreground/70" : "text-muted-foreground")}>{r.hint}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
