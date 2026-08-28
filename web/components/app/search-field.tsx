"use client"

import { MagnifyingGlass, X } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * ONE SEARCH FIELD.
 *
 * Counted before writing this: 23 inline search fields across 20 files, and between them
 * FOUR icon sizes (14/15/16/17), THREE insets (left-2.5/3/3.5), THREE paddings
 * (pl-8/9/10), THREE heights (h-8/9/11) and FIVE hard-coded widths (w-52/60/64/72/80).
 * Nobody chose any of that. There was simply nothing to import, so every search field was
 * eight lines of fresh markup and every one drifted a little further from the last.
 *
 * NOT `order-search.tsx`. That is the ⌘K topbar OVERLAY — a modal with its own h-12
 * proportions, and it is correct as it is. It has one caller because it is used once, by
 * design, and it was never the primitive this needed.
 *
 * ── THE SPEC, AND WHERE EACH HALF COMES FROM ─────────────────────────────────────────
 *
 * HEIGHT is h-9, from the Orders filter bar — the row the owner named as the one that
 * reads well, and already what 17 of the 23 fields use.
 *
 * RADIUS is the Input default (rounded-lg), NOT the Orders filter bar's `rounded-md`.
 * That override is itself a one-off: CLAUDE.md §4 records that Button, `.eg-control` and
 * Input were deliberately brought onto one `rounded-lg` so a field, a filter and a button
 * finally agree about what a corner is. Copying the deviation to twenty more places would
 * have spread it, which is the opposite of the job.
 *
 * WIDTH IS NOT A PIXEL COUNT. It grows to fill the toolbar it sits in and takes an optional
 * ceiling, because the five fixed widths were the reason toolbars wrapped differently on
 * every board — a `w-80` field in a narrow toolbar pushes the controls onto a second row,
 * and the same field in a wide one leaves a hole.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  onKeyDown,
  onClear,
  autoFocus,
  /** `grow` fills the toolbar · `md` and `sm` cap it. No pixel widths. */
  width = "grow",
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  /** Renders a clear button once there is something to clear. */
  onClear?: () => void
  autoFocus?: boolean
  width?: "grow" | "md" | "sm"
  className?: string
}) {
  const cap = width === "sm" ? "max-w-xs" : width === "md" ? "max-w-md" : ""
  return (
    /*
     * A FLOOR, NOT JUST A CEILING — and this was found by looking rather than by reasoning.
     *
     * `flex-1` alone collapses. On the Shipments toolbar the field sits beside eight filter
     * pills, so it shrank to about 140px and truncated its own placeholder to "Tracking,
     * order" — worse than the hard-coded `w-80` it replaced. 13rem is the width the longest
     * placeholder in the app needs to stay legible; below that a search field stops
     * advertising what it searches, which is most of what a placeholder is for.
     *
     * With a floor the field takes its own row in a wrapping toolbar rather than crushing.
     * That is the correct trade: a second row is legible, a 140px field is not.
     */
    <div className={cn("relative min-w-[13rem] flex-1", cap, className)}>
      {/* 15 at left-2.5 against pl-8: the icon sits in the padding rather than beside it,
          so the placeholder starts at the same x on every board. `pointer-events-none` or
          the glyph eats the click that should focus the field. */}
      <MagnifyingGlass
        size={15}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoFocus={autoFocus}
        className={cn("h-9 pl-8", onClear && value ? "pr-8" : undefined)}
      />
      {onClear && value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="eg-tap absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  )
}
