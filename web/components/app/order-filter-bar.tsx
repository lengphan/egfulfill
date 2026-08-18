"use client"

import { MagnifyingGlass, CaretDown, X, Check, FunnelSimple } from "@phosphor-icons/react"

import { Input } from "@/components/ui/input"
import { useLabelT } from "@/lib/i18n"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import {
  DATE_RANGES, dateRangeLabel, orderFacets, isOrderQueryActive, activeFilterCount,
  statusLabel, READY_OPTIONS, readyLabel, EMPTY_ORDER_QUERY,
  type OrderQuery, type FilterContext,
} from "@/lib/order-filter"
import { methodByKey } from "@/lib/print-method"
import { type OrderRow, type CatalogProduct } from "@/lib/api"

/** One dropdown in the bar.
 *
 *  h-8 / 13px / rounded-md. It went to h-9/text-sm originally (a size up from every word
 *  beneath it — the heaviest type on a screen whose job is the rows), then over-corrected to
 *  h-7/text-xs, which read as small print you had to lean in for. 13px sits between: clearly
 *  a control, still quieter than the order numbers it narrows.
 *
 *  Selected state is carried by weight and foreground colour, not a second accent — the
 *  stage pills beside it are the only violet in this row. */
function FilterMenu({ label, anyLabel, value, options, onPick }: {
  /** The facet's name. Now only for assistive tech — the row beside the trigger says it
   *  in print, and having the trigger repeat it was the bug this signature fixes. */
  label: string
  /** What "not filtering by this" is called: "All platforms", "Any time". Used BOTH as the
   *  trigger's resting text and as the first row of the menu, so the control always names a
   *  state rather than a category. */
  anyLabel: string
  value: string
  options: { value: string; label: string }[]
  onPick: (v: string) => void
}) {
  const current = options.find((o) => o.value === value)
  const on = !!value
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        // Fixed width, not max-width: the triggers sized to their own text, so a column of
        // them down the panel had a ragged right edge that read as misalignment.
        className={
          "inline-flex h-8 w-40 shrink-0 items-center justify-between gap-1 rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
          (on
            ? "border-primary/40 bg-primary/5 text-foreground"
            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
        }
      >
        <span className="truncate">{on ? current?.label ?? value : anyLabel}</span>
        <CaretDown size={11} weight="bold" className="shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-52 overflow-y-auto p-1">
        {/* The unset row names the STATE — "All platforms" — not the facet. It used to be
            the facet's own title, which was fine when this trigger stood alone in a toolbar
            and was the only label there. Inside a labelled row it meant the word "Platform"
            appeared on the line twice and then again as the ticked value inside the menu, so
            the filter looked like it was set to something called Platform.
            It stays an explicit row rather than only a Clear button: a dropdown you can
            enter but not leave is the classic filter trap. */}
        <DropdownMenuItem onClick={() => onPick("")} className="flex items-center gap-2 text-sm">
          <Check size={12} weight="bold" className={value ? "opacity-0" : "text-primary"} />
          <span className={value ? "text-muted-foreground" : "font-medium"}>{anyLabel}</span>
        </DropdownMenuItem>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => onPick(o.value)} className="flex items-center gap-2 text-sm">
            <Check size={12} weight="bold" className={value === o.value ? "text-primary" : "opacity-0"} />
            <span className="truncate">{o.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The search field, ALONE — it lives in the card header beside Import / New order, not in the
 * filter row.
 *
 * Sharing a row with the pills and five dropdowns, it was squeezed to a stub against the
 * right edge and the whole strip read as jammed. Search is also a different kind of control
 * from the rest: the dropdowns narrow by facets the board already knows about, search is
 * "find me this one order", which is a header job on every other screen in the app.
 */
export function OrderSearchInput({ query, onChange, className = "" }: {
  query: OrderQuery
  onChange: (q: OrderQuery) => void
  className?: string
}) {
  const tl = useLabelT()
  return (
    <div className={"relative " + className}>
      <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query.text}
        onChange={(e) => onChange({ ...query, text: e.target.value })}
        // Short: the full "order, customer, tracking or SKU" list truncated to "Search
        // order, customer, t", which reads as a broken field. What it searches is in the
        // title and the label, where it isn't clipped.
        placeholder={tl("ui", "Search orders…")}
        title={tl("ui", "Search order number, customer, tracking, store, SKU or item name")}
        className="h-9 rounded-md pl-8 text-sm"
        aria-label={tl("ui", "Search order number, customer, tracking, store, SKU or item name")}
      />
    </div>
  )
}

/**
 * The narrowing dropdowns for an orders table. Shared by every board, so a filter learned on
 * one is the same control on the next.
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
  /** Whether the board can answer the stock half of List — stock is held against the
   *  resolved BLANK sku, so without a catalog there's nothing to resolve against and those
   *  two options aren't offered. (The lookup itself happens in filterOrders' context.) */
  catalog?: CatalogProduct[]
  className?: string
}) {
  const tl = useLabelT()
  const facets = orderFacets(orders)
  const set = (patch: Partial<OrderQuery>) => onChange({ ...query, ...patch })
  const active = isOrderQueryActive(query)
  const count = activeFilterCount(query)
  const canStock = !!catalog?.length
  const readyOptions = READY_OPTIONS.filter((o) => !o.stock || canStock)
  // What the trigger counts: everything in this panel. The stage pills and the search box
  // are their own visible controls, so counting them here would report a filter the panel
  // can't clear.
  const facetCount = (query.ready ? 1 : 0) + (query.platform ? 1 : 0) + (query.store ? 1 : 0)
    + (query.method ? 1 : 0) + (query.days !== null ? 1 : 0)

  return (
    <Popover>
      {/* ONE button, not five dropdowns in a row.
          Five always-visible triggers plus the pills plus the search made three stacked
          strips of controls above a table — the controls were louder than the data. This is
          the same shape SpyDeck already uses (search, then a single Filters button), so it's
          a pattern in this app rather than a new one to learn.
          The count on the trigger is what keeps it honest: a collapsed filter you've
          forgotten you set is the one real cost of hiding these, so the button says how many
          are on and turns violet while any are. */}
      <PopoverTrigger
        className={
          "eg-tap inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
          (facetCount
            ? "border-primary/40 bg-primary/5 text-foreground"
            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground") +
          " " + className
        }
      >
        <FunnelSimple size={14} weight="bold" />
        {tl("ui", "Filters")}
        {facetCount > 0 && (
          <span className="rounded bg-primary px-1.5 text-2xs font-bold leading-[1.45] text-primary-foreground">{facetCount}</span>
        )}
        <CaretDown size={11} weight="bold" className="opacity-60" />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">{tl("ui", "Filters")}</span>
          {active && (
            <button
              onClick={() => onChange({ ...EMPTY_ORDER_QUERY })}
              className="eg-tap inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <X size={11} weight="bold" /> {tl("ui", "Clear")}{count > 1 ? ` (${count})` : ""}
            </button>
          )}
        </div>

        {/* Labelled rows, not a bare row of triggers: inside a panel there is room to say
            what each one narrows, which is exactly what the cramped toolbar could not. */}
        <div className="space-y-2">
          <FilterRow label={tl("filter", "List")}>
            <FilterMenu label={tl("filter", "List")} anyLabel={tl("filter", "All orders")} value={query.ready} options={readyOptions.map((o) => ({ ...o, label: tl("ready", o.label) }))} onPick={(v) => set({ ready: v })} />
          </FilterRow>
          {facets.platforms.length > 1 && (
            <FilterRow label={tl("filter", "Platform")}>
              <FilterMenu label={tl("filter", "Platform")} anyLabel={tl("filter", "All platforms")} value={query.platform}
                options={facets.platforms.map((p) => ({ value: p, label: p }))}
                onPick={(v) => set({ platform: v })} />
            </FilterRow>
          )}
          {facets.stores.length > 1 && (
            <FilterRow label={tl("filter", "Shop")}>
              <FilterMenu label={tl("filter", "Shop")} anyLabel={tl("filter", "All shops")} value={query.store}
                options={facets.stores.map((x) => ({ value: x, label: x }))}
                onPick={(v) => set({ store: v })} />
            </FilterRow>
          )}
          {facets.methods.length > 1 && (
            <FilterRow label={tl("filter", "Print")}>
              <FilterMenu label={tl("filter", "Print")} anyLabel={tl("filter", "All methods")} value={query.method} options={facets.methods} onPick={(v) => set({ method: v })} />
            </FilterRow>
          )}
          {/* Date is always offered — unlike the others it needs no data to be meaningful,
              and "what came in today" is the question a floor asks most. */}
          <FilterRow label={tl("filter", "Date")}>
            <FilterMenu label={tl("filter", "Date")} anyLabel={tl("filter", "Any time")} value={query.days === null ? "" : String(query.days)}
              options={DATE_RANGES.filter((r) => r.days !== null).map((r) => ({ value: String(r.days), label: tl("daterange", r.label) }))}
              onPick={(v) => set({ days: v === "" ? null : Number(v) })} />
          </FilterRow>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** One labelled line inside the Filters panel. */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/** The sentence an empty table should show, given what's narrowing it. Exported so every
 *  board says the same thing — and so "nothing here" is never confused with "nothing
 *  matches", which is the difference between a quiet day and a filter you forgot about. */
/**
 * Translators are passed IN rather than pulled from a hook, because this is a plain
 * function called from a render body, not a component. `t` builds the composed sentence
 * (it interpolates), `tl` translates the fixed ones and the filter names spliced into it.
 * Both default to the identity, so a caller that hasn't been localised yet still gets
 * English rather than a crash.
 */
type Tx = (key: string, vars?: Record<string, string | number>) => string
type LabelTx = (ns: string, value: string) => string

export function emptyOrdersMessage(
  totalLoaded: number,
  q: OrderQuery,
  ctx: FilterContext = {},
  t: Tx = (k) => k,
  tl: LabelTx = (_ns, v) => v,
) {
  if (totalLoaded === 0) return tl("ui", "No orders are in production yet.")
  if (!isOrderQueryActive(q)) return tl("ui", "No orders match this filter.")
  // Names every narrowing thing, including the stage — which used to be a separate flag and
  // so produced "No orders at this stage." while a search term nobody could see was also on.
  const bits: string[] = []
  if (q.text.trim()) bits.push(`“${q.text.trim()}”`)
  // The stage and List names have catalog entries already (the pills and the filter panel
  // show the same words); platform, shop and print method are proper nouns / codes and are
  // spliced in as they are.
  if (q.status) bits.push(tl("stage", statusLabel(q.status)))
  if (q.ready) bits.push(tl("ready", readyLabel(q.ready)).toLowerCase())
  if (q.platform) bits.push(q.platform)
  if (q.store) bits.push(q.store)
  // methodByKey, not PRODUCT_METHODS: the latter is only what we still OFFER, so a filter
  // pinned to a retired technique would print its bare key back at you.
  if (q.method) bits.push(methodByKey(q.method)?.label ?? q.method.toUpperCase())
  if (q.days !== null) bits.push(tl("daterange", dateRangeLabel(q.days)).toLowerCase())
  // A stock filter with no catalog loaded yet can only return nothing, and "no orders match
  // short on stock" would read as a fact about the orders rather than about the page.
  if (q.ready.startsWith("stock:") && !ctx.catalog?.length) return t("ui.stockNotLoaded")
  return t("ui.noOrdersMatch", { bits: bits.join(" · ") })
}
