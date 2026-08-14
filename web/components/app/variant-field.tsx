"use client"

import { Check, CaretDown, LockSimple } from "@phosphor-icons/react"
import { prettyColorName } from "@/lib/color-name"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useLabelT } from "@/lib/i18n"

// Common garment colour names → a hex dot. Unknown names fall back to neutral; the dot
// is a hint next to the label, never the only way to tell colours apart.
const SWATCH: Record<string, string> = {
  black: "#191918", white: "#f4f2ef", navy: "#25314d", "sport grey": "#b7b7b3", grey: "#9ca3af",
  gray: "#9ca3af", heather: "#b9b6b0", sand: "#d8cbb4", natural: "#e8e0cf", maroon: "#6d2233",
  red: "#c0392b", royal: "#2f4bf0", blue: "#3457d5", green: "#3f7d4e", forest: "#2f5540",
  pink: "#e59bb4", khaki: "#c3b091", gold: "#d4a017", purple: "#6d4aec", "camo green": "#4b5320",
  charcoal: "#36454f", cream: "#fffdd0", olive: "#708238", tan: "#d2b48c",
}
const swatchHex = (name: string) => SWATCH[name.toLowerCase().trim()] ?? "#c7c4bd"

/**
 * One variant control (Blank / Colour / Size / Method).
 *
 * Replaces the native <select> these used to be. A native select can't be themed — it
 * renders the OS widget, so it sat visibly outside the app's own input styling, and its
 * intrinsic width made a row of them ragged. This is the app's DropdownMenu with a
 * trigger styled like our inputs, so it matches every other control on the page.
 */
export function VariantField({
  label,
  value,
  options,
  onChange,
  placeholder,
  emptyLabel,
  disabled,
  required,
  swatches,
  compact,
  className,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder?: string
  emptyLabel?: string
  disabled?: boolean
  required?: boolean
  /** Render a colour dot beside each option (Colour field). */
  swatches?: boolean
  /** Row variant: no label above, smaller — used inline on order item rows. */
  compact?: boolean
  /** Extra classes merged into the trigger (e.g. a height override for a form row). */
  className?: string
}) {
  // A product that declares no options for this attribute is a free choice, not a bug —
  // the field says "Any" and there's nothing to open.
  const hasOptions = options.length > 0
  // Colour values are supplier codes ("031753A - Blk/Dk.Grn/Dk.Kha"). Store the code,
  // show the name — nobody should have to decode a warehouse SKU to pick a colour.
  const tl = useLabelT()
  const pretty = (v: string) => (swatches ? prettyColorName(v) : v)
  /**
   * THE LABEL LIVES IN THE FIELD, not on a row above it.
   *
   * Four controls each carried an uppercase caption, so the strip cost a line of chrome to
   * say "Colour" over a control whose empty state already said "Choose…" — two rows to
   * communicate one thing, on every line of every expanded order. An empty field now names
   * itself, which is the same information in no vertical space at all.
   *
   * The caption is not simply deleted: it moves to aria-label, so the control keeps an
   * accessible name once a value replaces the placeholder text, and to the dropdown's own
   * clear row — picking it returns the field to the state where the label is visible again.
   */
  const ph = tl("field", placeholder ?? label)
  /**
   * AN EMPTY FIELD MUST SAY WHICH FIELD IT IS — and nothing more than that.
   *
   * The no-options state rendered `emptyLabel` alone ("Any"), which was fine under a caption
   * and became three identical "Any" controls without one. Naming the field fixed that and
   * then made the note redundant: "Colour · Any" says "Colour" twice over, once as identity
   * and once as filler, and three of those in a row is the same visual noise the caption row
   * was removed to stop.
   *
   * So the note appears ONLY when a caller supplies one, which is the case where it carries
   * information the label cannot — orders/new says "None on this blank", a real fact about
   * the chosen product rather than a synonym for empty. The default is now no note at all.
   */
  const note = emptyLabel ? tl("field", emptyLabel) : ""
  const shown = value
    ? pretty(value)
    : hasOptions || !note ? ph : `${ph} · ${note}`
  const unset = !value

  const trigger = (
    <DropdownMenuTrigger
      disabled={disabled || !hasOptions}
      // The visible text becomes the VALUE once one is picked, and "Navy" does not say which
      // field it belongs to. The caption that used to sit above survives here.
      aria-label={tl("field", label)}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded-2xl border bg-card text-left font-medium transition-colors",
        "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border",
        compact ? "h-7 px-2 text-2xs" : "h-9 px-2.5 text-xs",
        // Only the required-but-empty field draws attention; the rest stay quiet.
        // --primary, NOT amber. Amber is a RESERVED floor status (warning / on hold), and
        // borrowing it for form validation put "this field is blank" in the same colour as
        // "this order is held" — on the order boards those sit inches apart. The app's own
        // accent is the right way to say "look here", and it measures 6.03:1 on white
        // against amber-600's 3.13:1, which was below AA for the label below anyway.
        required && unset ? "border-primary/60" : "border-border",
        className
      )}
    >
      {swatches && value && (
        <span className="size-3 shrink-0 rounded-full border border-black/10" style={{ background: swatchHex(value) }} />
      )}
      <span className={cn("min-w-0 flex-1 truncate", unset && "text-muted-foreground")}>{shown}</span>
      {/* The required flag came off the caption row with everything else. It sits in the
          control now, so the one field that blocks the line still says so — the tinted
          border alone reads as decoration next to three untinted neighbours. */}
      {required && unset && (
        <span className="shrink-0 text-3xs font-medium text-primary">{tl("field", "Required")}</span>
      )}
      {hasOptions && <CaretDown size={11} className="shrink-0 text-muted-foreground" />}
    </DropdownMenuTrigger>
  )

  const control = (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent align="start" className="max-h-64 w-[--anchor-width] min-w-44 overflow-y-auto">
        {/* Clearing is a real choice — a line can legitimately go back to unset. */}
        <DropdownMenuItem onClick={() => onChange("")} className="text-muted-foreground">
          {ph}
        </DropdownMenuItem>
        {options.map((o) => (
          <DropdownMenuItem key={o} onClick={() => onChange(o)} className="gap-2">
            {swatches && <span className="size-3 shrink-0 rounded-full border border-black/10" style={{ background: swatchHex(o) }} />}
            <span className="min-w-0 flex-1 truncate">{pretty(o)}</span>
            {o === value && <Check size={12} weight="bold" className="shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  // Compact and full are the same control now — the caption row was the only thing that
  // separated them, and it lives inside the trigger. `compact` still differs in height and
  // type size, which is the part that was ever about density.
  return control
}

/**
 * Read-only variant strip — the same Colour · Size · Method vocabulary as the editable
 * fields, rendered as chips. Used where a line is shown but not edited (order list rows,
 * locked orders), so variants read the same everywhere instead of appearing as a plain
 * dot-joined string in one place and labelled controls in another.
 */
export function VariantStrip({
  color, size, method, blank, sku, className, locked, marketplace,
}: {
  color?: string | null
  size?: string | null
  method?: string | null
  blank?: string | null
  /** The BLANK / inventory SKU stock is held against (resolveProduct(it)?.sku || it.blank),
   *  NOT the marketplace listing SKU — the id the floor picks against and inventory tracks.
   *  Shown as a leading mono chip so it reads as an id, not a variant word. */
  sku?: string | null
  className?: string
  /** Submitted order — variants are frozen (the server rejects changes once the cost is
   *  locked). Shown greyed with a lock so it reads as "settled", not "broken". */
  locked?: boolean
  /** The marketplace's own variant text, verbatim. What the BUYER chose and what support
   *  will quote back — a different thing from the production spec beside it, which is
   *  what the floor makes. Shown when it exists and differs. */
  marketplace?: string | null
}) {
  const tl = useLabelT()
  const chips = [
    sku ? { key: "sku", label: sku, mono: true } : null,
    blank ? { key: "blank", label: blank } : null,
    color ? { key: "color", label: color, swatch: true } : null,
    size ? { key: "size", label: size } : null,
    method ? { key: "method", label: method } : null,
  ].filter(Boolean) as { key: string; label: string; swatch?: boolean; mono?: boolean }[]

  // Nothing chosen yet is worth saying plainly — a blank row reads as a rendering bug.
  const buyerText = (marketplace || "").trim()
  // Only worth showing when it adds something the chips don't already say.
  const showBuyer = !!buyerText && !chips.some((c) => c.label.toLowerCase() === buyerText.toLowerCase())

  if (!chips.length) {
    return (
      <div className={cn("flex flex-wrap items-center gap-1", className)}>
        {showBuyer && <BuyerChip text={buyerText} />}
        <span className="text-xs text-muted-foreground">{showBuyer ? tl("field", "Not set up for production yet") : tl("field", "No variant set")}</span>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)} title={locked ? "Locked — variants can't change after an order is submitted" : undefined}>
      {chips.map((c) => (
        <span
          key={c.key}
          className={cn(
            "inline-flex max-w-[12rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium",
            c.mono && "font-mono",
            locked
              ? "border-border/60 bg-muted/30 text-muted-foreground"
              : "border-border bg-muted/50 text-foreground/80"
          )}
        >
          {c.swatch && (
            <span
              className={cn("size-2.5 shrink-0 rounded-full border border-black/10", locked && "opacity-60")}
              style={{ background: swatchHex(c.label) }}
            />
          )}
          <span className="truncate">{c.label}</span>
        </span>
      ))}
      {showBuyer && <BuyerChip text={buyerText} />}
      {locked && <LockSimple size={11} weight="fill" className="shrink-0 text-muted-foreground/70" />}
    </div>
  )
}

/** What the buyer picked on the marketplace, verbatim. Visually distinct from the
 *  production chips so nobody mistakes a listing label for a blank spec. */
function BuyerChip({ text }: { text: string }) {
  const tl = useLabelT()
  return (
    <span
      title={`Buyer chose "${text}" on the marketplace`}
      className="inline-flex max-w-[14rem] items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-2xs text-muted-foreground"
    >
      <span className="text-3xs font-semibold uppercase tracking-wide opacity-70">{tl("field", "Buyer")}</span>
      <span className="truncate">{text}</span>
    </span>
  )
}
