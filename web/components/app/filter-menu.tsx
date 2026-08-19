"use client"

import { CaretDown, Check } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"

/**
 * THE FILTER CONTROL — one of these, everywhere.
 *
 * A filter changes what you SEE; a button DOES something. When both are a filled pill in
 * the same row above a table, nothing tells you which is safe to press — and pages had
 * grown rows of solid pills for narrowing a list, sitting beside the primary action and
 * looking exactly like it. Worse on Sourcing, where the stage BADGES in the table are the
 * same rounded pill as the stage FILTER above it: a read-only label and a control, drawn
 * identically.
 *
 * So a filter here is quieter than an action and shaped like a question:
 *   - 13px, not the body size. Clearly a control, still quieter than the rows it narrows.
 *   - a caret, which says "this opens a list" — no action button does.
 *   - NO FILL until something is chosen. A solid accent reads as "this does something".
 *   - it names the CURRENT STATE, not the category: "All stages" resting, "Sampling" once
 *     picked. `Stage ▾` makes you open it to find out what you are looking at.
 *
 * Lived privately inside order-filter-bar.tsx, so every other page rolled its own.
 */
export function FilterMenu({ label, anyLabel, value, options, onPick }: {
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
