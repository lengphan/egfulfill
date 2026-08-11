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
export const DISPATCH_GRID =
  "grid items-center gap-3 px-5 grid-cols-[1rem_8rem_minmax(6.5rem,1fr)_6.5rem_3.5rem_minmax(8.5rem,1.4fr)_10.5rem_12rem_4rem]"

/** Header strip shared by both lists — same type, same rule, same rhythm. */
export const DISPATCH_HEAD =
  "border-b border-border py-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
