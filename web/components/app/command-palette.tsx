"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { MagnifyingGlass, ArrowRight, type Icon } from "@phosphor-icons/react"
import { sellerNav } from "@/lib/nav"
import { STAFF_ITEMS, STAFF_TOOLS } from "@/lib/staff-nav"
import { cn } from "@/lib/utils"

/**
 * ⌘K — ONE LIST FOR 37 SURFACES.
 *
 * There are 24 seller pages and 13 boards, and a rail can only ever show a fraction of them.
 * Past a certain count typing beats hunting, and the rail stops being the way people move.
 *
 * NO FETCH IN HERE, deliberately. A palette that queries on every keystroke is the exact
 * shape §2.8 exists to forbid — and the useful half of "reach a record" needs no server at
 * all: an order number IS its route. Typing 4099 offers the order directly. Searching orders
 * by CUSTOMER is the part that needs an endpoint, and it is not here yet rather than here
 * and firing a request per character.
 */
type Row = { id: string; label: string; hint?: string; icon?: Icon; run: () => void }

export function CommandPalette({ staff = false }: { staff?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Reset by REMOUNTING the field's contents rather than leaving last week's query in it.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { setQ(""); setCursor(0); inputRef.current?.focus() }, 0)
    return () => clearTimeout(t)
  }, [open])

  const go = useCallback((href: string) => { setOpen(false); router.push(href) }, [router])

  const nav: Row[] = useMemo(() => {
    const out: Row[] = []
    if (staff) {
      for (const it of [...STAFF_ITEMS, ...STAFF_TOOLS]) out.push({ id: it.href, label: it.label, icon: it.icon, run: () => go(it.href) })
    } else {
      for (const s of sellerNav) for (const it of s.items) out.push({ id: it.href, label: it.label, hint: s.heading, icon: it.icon, run: () => go(it.href) })
    }
    // Same href can appear in two groups; the first spelling wins.
    const seen = new Set<string>()
    return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  }, [staff, go])

  const term = q.trim()
  const lower = term.toLowerCase()

  /** An order number IS a route, so this needs no server. `#4099`, `FF-1002`, `etsy-abc`. */
  const orderJump: Row[] = useMemo(() => {
    const raw = term.replace(/^#/, "")
    if (raw.length < 3 || !/[0-9]/.test(raw) || /\s/.test(raw)) return []
    return [{ id: "order:" + raw, label: `Open order ${raw}`, hint: "by number", run: () => go(`/orders/${encodeURIComponent(raw)}`) }]
  }, [term, go])

  const matched = useMemo(
    () => (lower ? nav.filter((r) => r.label.toLowerCase().includes(lower)) : nav.slice(0, 8)),
    [nav, lower],
  )
  const rows = useMemo(() => [...orderJump, ...matched], [orderJump, matched])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)) }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    if (e.key === "Enter") { e.preventDefault(); rows[cursor]?.run() }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      {/* The scrim closes it. A palette you can only leave by keyboard is a trap on a tablet. */}
      <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-foreground/35" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <MagnifyingGlass size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            // The cursor resets HERE rather than in an effect keyed on `q` — typing is the
            // event, and an effect that only exists to mirror one is the shape the lint rule
            // refuses for good reason.
            onChange={(e) => { setQ(e.target.value); setCursor(0) }}
            onKeyDown={onKeyDown}
            placeholder="Go to a page, or type an order number…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-2xs font-semibold text-muted-foreground">esc</kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{term}”.</div>
          ) : rows.map((r, i) => {
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
                {r.hint && <span className={cn("shrink-0 text-2xs", i === cursor ? "text-brand-foreground/70" : "text-muted-foreground")}>{r.hint}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
