/**
 * ONE COLUMN TEMPLATE FOR EVERYTHING ON THE DISPATCH SCREEN.
 *
 * The queue and the external-label list are two cards that answer the same question —
 * "what is going out, and where has it got to" — so they read as one screen only if their
 * columns line up. They didn't: the queue crammed channel, units, address and status into a
 * single wrapping line under the order number, while external labels were a four-column
 * table with different widths, so the eye had to re-learn the layout halfway down the page.
 *
 * They are one list now, not two cards, but the template stays shared: the header strip and
 * the rows are separate elements and only a single column definition keeps them lined up.
 * Where a row has nothing for a column it says so; neither kind invents a value to fill
 * the gap.
 *
 *   ☐ · Order/File · Customer · Channel · Units · Ship-to · Status · Tracking · actions
 *
 * Fixed widths rather than fractions for everything except the two that hold free text.
 * Wider than a phone on purpose — the list scrolls horizontally inside itself, the same way
 * the history table does, rather than reflowing into the pile this replaced.
 *
 * TRACKING IS 12rem BECAUSE A TRACKING NUMBER IS 22 DIGITS. It was 9rem, which cut every
 * USPS number to "930012084550000038…" — and the one thing anyone reads a tracking number
 * for is to compare it against a parcel, which a truncated one cannot do. Measured against
 * the real thing rather than eyeballed: 22 digits of Inter tabular at 12px is ~148px, plus
 * the barcode glyph and its gap.
 *
 * STATUS IS 10.5rem for the same reason, found the same way: "Waiting to be scanned" plus
 * its icon is ~9.5rem and the pill does not wrap, so at 8rem it simply printed over the
 * tracking number beside it. A column sized to its shortest label is a column that lies
 * about how much room the longest one needs.
 */
/**
 * CHANNEL IS A VARIABLE, not a constant, and only because it is mid-change.
 *
 * 6.5rem holds "Etsy" but not "Etsy · Wildgrain Co", so with a store name attached it
 * truncated on every row — "Shopify · Northb…". The fix is ~9.5rem, and the fallback here
 * keeps every existing surface exactly where it was while the console shell tries the wider
 * one. When that lands, inline it and delete this note.
 */
export type DispatchColId =
  | "order" | "customer" | "channel" | "units" | "shipto" | "status" | "tracking"

/**
 * THE QUEUE'S COLUMNS, AS DATA.
 *
 * The template was one literal string, which meant nothing could read it — no Columns
 * control, and no way for the History tab to be handed the same registry (§4's archive
 * rule). The widths below are the ones already measured and argued for above; moving them
 * into a registry does not change any of them.
 *
 * `order` is locked: a dispatch row without its number is a parcel nobody can find.
 */
export const DISPATCH_COLS: Record<DispatchColId, { id: DispatchColId; label: string; track: string; locked?: boolean }> = {
  order:    { id: "order",    label: "Order",    track: "8rem", locked: true },
  customer: { id: "customer", label: "Customer", track: "minmax(6.5rem,1fr)" },
  channel:  { id: "channel",  label: "Channel",  track: "var(--disp-ch,6.5rem)" },
  units:    { id: "units",    label: "Units",    track: "3.5rem" },
  shipto:   { id: "shipto",   label: "Ship to",  track: "minmax(8.5rem,1.4fr)" },
  status:   { id: "status",   label: "Status",   track: "10.5rem" },
  tracking: { id: "tracking", label: "Tracking", track: "12rem" },
}

export const DISPATCH_COL_ORDER: DispatchColId[] =
  ["order", "customer", "channel", "units", "shipto", "status", "tracking"]
/** Nothing hidden out of the box — today's board shows all seven. */
export const DISPATCH_HIDDEN_DEFAULT: DispatchColId[] = []

/**
 * The grid template for a given visible set. The 1rem lead (caret/checkbox) and the 4rem
 * tail (row actions) are structural rather than columns anyone can hide.
 *
 * Returned as an inline STYLE, not a class: a Tailwind arbitrary value has to be a literal
 * for the JIT to emit it, so a template built at runtime cannot be one.
 */
export function dispatchTemplate(visible: readonly DispatchColId[]): string {
  return ["1rem", ...visible.map((id) => DISPATCH_COLS[id].track), "4rem"].join(" ")
}

/** Layout only. The column tracks come from `dispatchTemplate` via an inline style. */
export const DISPATCH_GRID = "grid items-center gap-3 px-5"

/** Header strip shared by both lists — same type, same rule, same rhythm. */
export const DISPATCH_HEAD =
  "border-b border-border py-2 eg-label text-muted-foreground"
