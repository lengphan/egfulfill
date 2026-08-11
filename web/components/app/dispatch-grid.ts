/**
 * ONE COLUMN TEMPLATE FOR EVERYTHING ON THE DISPATCH SCREEN.
 *
 * The queue and the external-label list are two cards that answer the same question —
 * "what is going out, and where has it got to" — so they read as one screen only if their
 * columns line up. They didn't: the queue crammed channel, units, address and status into a
 * single wrapping line under the order number, while external labels were a four-column
 * table with different widths, so the eye had to re-learn the layout halfway down the page.
 *
 * Both now render the same nine tracks. Where a row has nothing for a column it says so
 * (or spans, in the case of a file name, which is an identity and not an order number);
 * neither invents a value to fill the gap.
 *
 *   ☐ · Order/File · Customer · Channel · Units · Ship-to/Sent · Status · Tracking · actions
 *
 * Fixed widths rather than fractions for everything except the two that hold free text, so
 * the two cards align even though they never share a scroll container. Wider than a phone
 * on purpose — each card scrolls horizontally inside itself, the same way the history
 * table already does, rather than reflowing into the pile this replaced.
 */
export const DISPATCH_GRID =
  "grid items-center gap-3 px-5 grid-cols-[1rem_8rem_minmax(6.5rem,1fr)_6.5rem_3.5rem_minmax(8.5rem,1.4fr)_8rem_9rem_4rem]"

/** Header strip shared by both lists — same type, same rule, same rhythm. */
export const DISPATCH_HEAD =
  "border-b border-border py-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
