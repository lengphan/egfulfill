"use client"

import { MagnifyingGlass, CaretDown, X, Check } from "@phosphor-icons/react"

import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import {
  DATE_RANGES, dateRangeLabel, orderFacets, isOrderQueryActive, activeFilterCount,
  statusLabel, READY_OPTIONS, readyLabel, EMPTY_ORDER_QUERY,
  type OrderQuery, type FilterContext,
} from "@/lib/order-filter"
import { PRODUCT_METHODS } from "@/lib/print-method"
import { type OrderRow, type CatalogProduct } from "@/lib/api"

/** One dropdown in the bar.
 *
 *  Sized to the TABLE, not to a form: h-7 / text-xs / rounded-md is the same metric as the
 *  Label · Scan · Design chips in the Ready column, so the toolbar reads as part of the list
 *  it narrows. At h-9 / text-sm it was visibly a size up from every word beneath it — the
 *  heaviest type on a screen whose job is the rows.
 *
 *  Selected state is carried by weight and foreground colour, not a second accent — the
 *  stage pills beside it are the only violet in this row. */
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
          "inline-flex h-7 max-w-[10rem] items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
          (on
            ? "border-primary/40 bg-primary/5 text-foreground"
            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
        }
      >
        <span className="truncate">{on ? current?.label ?? value : label}</span>
        <CaretDown size={10} weight="bold" className="shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-48 overflow-y-auto p-1">
        {/* The reset row is the filter's own TITLE — "Platform", not "Platform: any". It
            reads as the unfiltered heading the trigger falls back to, which is exactly what
            picking it does. It stays an explicit row rather than only a Clear button: a
            dropdown you can enter but not leave is the classic filter trap. */}
        <DropdownMenuItem onClick={() => onPick("")} className="flex items-center gap-2 text-xs">
          <Check size={12} weight="bold" className={value ? "opacity-0" : "text-primary"} />
          <span className={value ? "text-muted-foreground" : "font-medium"}>{label}</span>
        </DropdownMenuItem>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => onPick(o.value)} className="flex items-center gap-2 text-xs">
            <Check size={12} weight="bold" className={value === o.value ? "text-primary" : "opacity-0"} />
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
 *
 * The production stage is deliberately NOT here: the stage pills beside this bar already own
 * `query.status`.
 */
export function OrderFilterBar({ orders, query, onChange, catalog, className = "" }: {
  orders: OrderRow[]
  query: OrderQuery
  onChange: (q: OrderQuery) => void
  /** Whether the board can answer the stock half of Ready — stock is held against the
   *  resolved BLANK sku, so without a catalog there's nothing to resolve against and those
   *  two options aren't offered. (The lookup itself happens in filterOrders' context.) */
  catalog?: CatalogProduct[]
  className?: string
}) {
  const facets = orderFacets(orders)
  const set = (patch: Partial<OrderQuery>) => onChange({ ...query, ...patch })
  const active = isOrderQueryActive(query)
  const count = activeFilterCount(query)
  const canStock = !!catalog?.length
  const readyOptions = READY_OPTIONS.filter((o) => !o.stock || canStock)

  return (
    <div className={"flex flex-wrap items-center gap-1.5 " + className}>
      {/* Capped, not free-growing: left to fill the card the input became the widest thing
          on the page and pushed the dropdowns to the far edge, reading as a search page with
          filters bolted on rather than one toolbar. */}
      <div className="relative min-w-[9rem] flex-1 sm:max-w-[13rem]">
        <MagnifyingGlass size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query.text}
          onChange={(e) => set({ text: e.target.value })}
          // Short, because the box is now one control in a packed toolbar rather than the
          // widest thing on the page: the full "order, customer, tracking or SKU" list
          // truncated to "Search order, customer, t", which reads as a broken field. What
          // it searches is in the title and the label, where it isn't clipped.
          placeholder="Search orders…"
          title="Search order number, customer, tracking, store, SKU or item name"
          className="h-7 rounded-md pl-7 text-xs"
          aria-label="Search order number, customer, tracking, store, SKU or item name"
        />
      </div>

      {/* NO Status dropdown. `query.status` is written by the stage pills sitting to the
          left of this bar — a second control for the same field, one row apart, is two
          answers to one question. (Cost of that: On hold / Cancelled / Refunded can only be
          selected as the "Issues" pill's bundle, since no pill names them individually.) */}

      {/* The Checklist column, filterable: "which orders still need a label" is the question
          those chips are read for, and reading them was the only way to ask it. */}
      <FilterMenu label="Checklist" value={query.ready} options={readyOptions} onPick={(v) => set({ ready: v })} />

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
          onClick={() => onChange({ ...EMPTY_ORDER_QUERY })}
          className="eg-tap inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={11} weight="bold" /> Clear{count > 1 ? ` (${count})` : ""}
        </button>
      )}
    </div>
  )
}

/** The sentence an empty table should show, given what's narrowing it. Exported so every
 *  board says the same thing — and so "nothing here" is never confused with "nothing
 *  matches", which is the difference between a quiet day and a filter you forgot about. */
export function emptyOrdersMessage(totalLoaded: number, q: OrderQuery, ctx: FilterContext = {}) {
  if (totalLoaded === 0) return "No orders are in production yet."
  if (!isOrderQueryActive(q)) return "No orders match this filter."
  // Names every narrowing thing, including the stage — which used to be a separate flag and
  // so produced "No orders at this stage." while a search term nobody could see was also on.
  const bits: string[] = []
  if (q.text.trim()) bits.push(`“${q.text.trim()}”`)
  if (q.status) bits.push(statusLabel(q.status))
  if (q.ready) bits.push(readyLabel(q.ready).toLowerCase())
  if (q.platform) bits.push(q.platform)
  if (q.store) bits.push(q.store)
  if (q.method) bits.push(PRODUCT_METHODS.find((m) => m.key === q.method)?.label ?? q.method.toUpperCase())
  if (q.days !== null) bits.push(dateRangeLabel(q.days).toLowerCase())
  // A stock filter with no catalog loaded yet can only return nothing, and "no orders match
  // short on stock" would read as a fact about the orders rather than about the page.
  if (q.ready.startsWith("stock:") && !ctx.catalog?.length) return "Blank stock hasn't loaded yet, so this filter can't be answered."
  return `No orders match ${bits.join(" · ")}.`
}
