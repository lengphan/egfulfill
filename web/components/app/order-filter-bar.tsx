"use client"

import { MagnifyingGlass, CaretDown, X, Check } from "@phosphor-icons/react"

import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import {
  DATE_RANGES, dateRangeLabel, orderFacets, isOrderQueryActive, activeFilterCount,
  type OrderQuery,
} from "@/lib/order-filter"
import { PRODUCT_METHODS } from "@/lib/print-method"
import { type OrderRow } from "@/lib/api"

/** One dropdown in the bar. Same trigger shape as ColumnsMenu so the toolbar reads as one
 *  row of controls rather than three unrelated widgets. Selected state is carried by weight
 *  and foreground colour, not a second accent — the pills above are the only violet here. */
function FilterMenu({ label, value, options, onPick }: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onPick: (v: string) => void
}) {
  const current = options.find((o) => o.value === value)
  const on = !!value
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          "inline-flex h-9 max-w-[11rem] items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
          (on
            ? "border-primary/40 bg-primary/5 font-medium text-foreground"
            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
        }
      >
        <span className="truncate">{on ? current?.label ?? value : label}</span>
        <CaretDown size={12} weight="bold" className="shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-y-auto p-1.5">
        {/* "Any" is an explicit row, not just the Clear button — a dropdown you can enter
            but not leave is the classic filter trap. */}
        <DropdownMenuItem onClick={() => onPick("")} className="flex items-center gap-2">
          <Check size={13} weight="bold" className={value ? "opacity-0" : "text-primary"} />
          <span className={value ? "text-muted-foreground" : "font-medium"}>{label}: any</span>
        </DropdownMenuItem>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => onPick(o.value)} className="flex items-center gap-2">
            <Check size={13} weight="bold" className={value === o.value ? "text-primary" : "opacity-0"} />
            <span className="truncate">{o.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Search + narrowing for an orders table. Shared by every board, so a filter learned on one
 * is the same control on the next.
 *
 * The dropdown OPTIONS come from the orders actually in hand (`orderFacets`), so a factory
 * with no TikTok orders is never offered a TikTok filter that can only return nothing. A
 * dropdown with a single option is dropped entirely — "Shop: OLVERA-TEES" beside a list where
 * every order is OLVERA-TEES is a control that cannot change anything.
 */
export function OrderFilterBar({ orders, query, onChange, className = "" }: {
  orders: OrderRow[]
  query: OrderQuery
  onChange: (q: OrderQuery) => void
  className?: string
}) {
  const facets = orderFacets(orders)
  const set = (patch: Partial<OrderQuery>) => onChange({ ...query, ...patch })
  const active = isOrderQueryActive(query)
  const count = activeFilterCount(query)

  return (
    <div className={"flex flex-wrap items-center gap-2 " + className}>
      {/* Capped, not free-growing: left to fill the card the input became the widest thing
          on the page and pushed the dropdowns to the far edge, reading as a search page with
          filters bolted on rather than one toolbar. */}
      <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
        <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="Search order, customer, tracking or SKU…"
          className="h-9 pl-8"
          aria-label="Search orders"
        />
      </div>

      {facets.platforms.length > 1 && (
        <FilterMenu
          label="Platform"
          value={query.platform}
          options={facets.platforms.map((p) => ({ value: p, label: p }))}
          onPick={(v) => set({ platform: v })}
        />
      )}
      {facets.stores.length > 1 && (
        <FilterMenu
          label="Shop"
          value={query.store}
          options={facets.stores.map((s) => ({ value: s, label: s }))}
          onPick={(v) => set({ store: v })}
        />
      )}
      {facets.methods.length > 1 && (
        <FilterMenu label="Print" value={query.method} options={facets.methods} onPick={(v) => set({ method: v })} />
      )}

      {/* Date is always offered — unlike the others it needs no data to be meaningful, and
          "what came in today" is the question a floor asks most. */}
      <FilterMenu
        label="Date"
        value={query.days === null ? "" : String(query.days)}
        options={DATE_RANGES.filter((r) => r.days !== null).map((r) => ({ value: String(r.days), label: r.label }))}
        onPick={(v) => set({ days: v === "" ? null : Number(v) })}
      />

      {active && (
        <button
          onClick={() => onChange({ text: "", platform: "", store: "", method: "", days: null })}
          className="eg-tap inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={13} weight="bold" /> Clear{count > 1 ? ` (${count})` : ""}
        </button>
      )}
    </div>
  )
}

/** The sentence an empty table should show, given what's narrowing it. Exported so every
 *  board says the same thing — and so "nothing here" is never confused with "nothing
 *  matches", which is the difference between a quiet day and a filter you forgot about. */
export function emptyOrdersMessage(totalLoaded: number, stageFiltered: boolean, q: OrderQuery) {
  if (totalLoaded === 0) return "No orders are in production yet."
  if (isOrderQueryActive(q)) {
    const bits: string[] = []
    if (q.text.trim()) bits.push(`“${q.text.trim()}”`)
    if (q.platform) bits.push(q.platform)
    if (q.store) bits.push(q.store)
    if (q.method) bits.push(PRODUCT_METHODS.find((m) => m.key === q.method)?.label ?? q.method.toUpperCase())
    if (q.days !== null) bits.push(dateRangeLabel(q.days).toLowerCase())
    return `No orders match ${bits.join(" · ")}.`
  }
  return stageFiltered ? "No orders at this stage." : "No orders match this filter."
}
