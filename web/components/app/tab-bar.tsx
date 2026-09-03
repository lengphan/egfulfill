"use client"

import type { Icon } from "@phosphor-icons/react"
import { TabLabel } from "@/components/app/tab-label"
import { cn } from "@/lib/utils"

/**
 * THE ONE TAB TREATMENT: a rule under the live word.
 *
 * This exists because the same bar was hand-rolled FOURTEEN times across twelve files, every
 * one of them a capsule group with a solid `bg-primary` pill on the active option. That shape
 * is a primary BUTTON's shape and a primary button's fill, so a row of views read as a row of
 * things you can press, one of which looks pressed — and on pages like Inventory it sat two
 * inches from an actual primary button doing an actual thing.
 *
 * CLAUDE.md already says the underline is the ONLY active treatment and that `rounded-full`
 * is reserved for things that are genuinely round (count badges, avatars). It kept coming
 * back anyway, because there was nothing to import — every new tab bar was fourteen lines of
 * fresh Tailwind, and fresh Tailwind is where a house style goes to die.
 *
 * NOT `Tabs` from components/ui. That is a Base UI root with panels and roving focus, and
 * these are all plain state switches — `useState` plus a conditional render. Wrapping them in
 * a Tabs root to get a border-bottom would be a bigger change than the defect. This matches
 * `tabsListVariants`'s `line` default by hand, the same way design-lab-tabs.tsx and
 * api-playground.tsx do for their link-based bars.
 */
export type TabBarItem<T extends string> = {
  id: T
  label: string
  icon?: Icon
  /** A number beside the label. Genuinely round, so it keeps the pill the tabs gave up. */
  count?: number
}

export function TabBar<T extends string>({
  items, value, onChange, size = "md", spacing = "default", className, ariaLabel, look = "line",
}: {
  items: readonly TabBarItem<T>[]
  value: T
  onChange: (id: T) => void
  /** `sm` for a bar inside a dialog or a card header; `md` for a page's own tabs. */
  size?: "sm" | "md"
  /**
   * AIR UNDER THE RULE — and the reason there was none.
   *
   * Every call site drops this bar into a `space-y-4` column and expects the 16px that
   * gives. It never arrived: Tailwind v4's `space-y-*` sets `margin-bottom` on each child
   * that is not the last, through a zero-specificity `:where()`, so the bar's own `-mb-px`
   * WON — and the gap under the rule was not 16px, it was minus one. Measured: -mb-px → -1,
   * mb-4 → 16, mb-6 → 24. Twelve pages had their tabs sitting directly on their content and
   * no caller could fix it by adding spacing to the column, because the column was never
   * what set it.
   *
   * -1px was never the intent. It was added so a bar sitting flush on a container's own
   * border draws one line rather than two, which is a real job on exactly two call sites —
   * the ones passing `border-b-0`. Everywhere else it silently cancelled the layout.
   *
   * 24px, not 16: a rule is a DIVIDER, and it needs more beneath it than two paragraphs need
   * between them. That difference is what says the tabs are above the content, not part of it.
   */
  spacing?: "default" | "none"
  className?: string
  ariaLabel?: string
  /**
   * SHAPE SAYS LEVEL.
   *
   * `line` is a PAGE's tabs — which section of this page am I on. `segmented` is a level
   * BELOW that: a lens on the section already chosen.
   *
   * Purchasing stacked two `line` bars 60px apart — All suppliers/Favorites/Cart/Sample over
   * Cart/Ongoing/History — drawn identically, so nothing on screen said which of the two you
   * were reading. §4 already says shape must carry kind; this is the same rule one level
   * down. Never put two `line` bars on one screen.
   */
  look?: "line" | "segmented"
}) {
  /**
   * `size` IS DENSITY, NOT TYPE SIZE — and that is the whole change here.
   *
   * `sm` used to drop the label to text-xs (12px). The app runs a deliberate six-step scale
   * — 11 · 12 · 14 · 18 · 24 · 36 — chosen because "a pair that close is not a level of
   * hierarchy: the eye cannot resolve it as a decision" (globals.css). 12px is a caption
   * step, and a tab is not a caption: it is the way INTO a panel, and it was routinely
   * ending up smaller than the body text it led to.
   *
   * There is no legal step between 12 and 14, so a compromise size would have to invent one
   * and break the rule the scale exists to enforce. 14 it is, for both.
   *
   * What still separates the two is what always should have: a tight bar gets tighter
   * padding, a smaller gap and a smaller icon. That is what "small" means on a filter strip
   * — more of them in the same rail — not letters the reader has to lean in for.
   *
   * Safe on every bar: the row is overflow-x-auto with shrink-0 items, so labels that no
   * longer fit scroll rather than fold or clip.
   */
  const text = "text-sm"
  const pad = size === "sm" ? "pb-1.5" : "pb-2"
  const gap = size === "sm" ? "gap-4" : "gap-5"
  return (
    // `none` keeps -mb-px, so the bar's own rule sits ON the container's rather than one
    // pixel below it. Otherwise the bar owns the space under its own line.
    // overflow-x-auto is the other half of shrink-0 below: labels that refuse to fold have
    // to go SOMEWHERE when the column is too narrow, and scrolling the bar is the only
    // answer that leaves every tab readable. Spilling out of a card is not.
    //
    // eg-scroll-none is not cosmetic. `overflow-x: auto` makes the OTHER axis auto as well,
    // and the active tab's ::after sits at -bottom-px — one pixel of vertical overflow, which
    // is all macOS needs to park a full-height scrollbar between the last tab and whatever is
    // beside it. That bar appeared in the library picker, next to Templates.
    //
    // min-h-fit, AND IT IS THE SAME `overflow-x: auto` THAT MAKES IT NECESSARY.
    //
    // A flex item is normally protected from being squeezed below its own content by the
    // automatic minimum size — `min-height: auto`. That rule is switched OFF for an item
    // whose overflow is not `visible`, and the line above is the reason this one's is not.
    // So in a flex COLUMN, where flex-shrink acts on HEIGHT, this bar is infinitely
    // shrinkable: put it above anything tall enough to overflow and it collapses.
    //
    // Measured in the mini designer, where the panel is `flex flex-col ... overflow-y-auto`:
    // the nav went to 4px — exactly its own padding-top, content height zero — while the
    // tab labels went on painting outside it. The dropzone below then appeared to sit ON
    // TOP of the tabs and slice them in half, which is what gets reported. It reads as a
    // z-index fight and it is not one; the bar simply has no height left.
    //
    // min-h-fit restores that floor on the block axis only. NOT shrink-0: that would also
    // stop the bar shrinking on the INLINE axis in a flex row, and its ability to narrow
    // and scroll is exactly what the overflow-x above is for.
    <nav
      aria-label={ariaLabel}
      className={cn(
        "eg-scroll-none flex min-h-fit overflow-x-auto",
        look === "segmented"
          ? cn("w-fit gap-0.5 rounded-lg bg-muted p-0.5", spacing === "none" ? "" : "mb-6")
          : cn("border-b border-border", spacing === "none" ? "-mb-px" : "mb-6", gap),
        className,
      )}
    >
      {items.map((t) => {
        const on = value === t.id
        const I = t.icon
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-current={on ? "page" : undefined}
            className={cn(
              // shrink-0 + nowrap: a tab LABEL never wraps. In a narrow column the flex
              // children were compressing instead, so "From orders" broke onto two lines
              // and the ::after rule — which spans the button — was drawn under the second
              // line, half the width of the word above it. A bar that does not fit should
              // overflow, not fold.
              "eg-tap relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap transition-colors", text,
              look === "segmented" ? "rounded-md px-2.5 py-1" : pad,
              look === "segmented"
                ? (on
                    ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground")
                : (on
                    // The rule is drawn by ::after rather than a border, so switching tabs never
                    // moves the text by a pixel — a border-bottom on the active one only would.
                    ? "font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground"
                    : "text-muted-foreground hover:text-foreground"),
            )}
          >
            {I && <I size={size === "sm" ? 14 : 15} />}
            <TabLabel>{t.label}</TabLabel>
            {t.count != null && (
              <span className={cn(
                "ml-0.5 rounded-lg px-1.5 py-0.5 text-2xs font-semibold tabular-nums",
                on ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
              )}>
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
