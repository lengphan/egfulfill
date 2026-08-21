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
  items, value, onChange, size = "md", className, ariaLabel,
}: {
  items: readonly TabBarItem<T>[]
  value: T
  onChange: (id: T) => void
  /** `sm` for a bar inside a dialog or a card header; `md` for a page's own tabs. */
  size?: "sm" | "md"
  className?: string
  ariaLabel?: string
}) {
  const text = size === "sm" ? "text-xs" : "text-sm"
  const pad = size === "sm" ? "pb-1.5" : "pb-2"
  const gap = size === "sm" ? "gap-4" : "gap-5"
  return (
    // -mb-px so the bar's own rule sits ON the container's, not one pixel below it.
    <nav aria-label={ariaLabel} className={cn("-mb-px flex border-b border-border", gap, className)}>
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
              "eg-tap relative inline-flex items-center gap-1.5 transition-colors", text, pad,
              on
                // The rule is drawn by ::after rather than a border, so switching tabs never
                // moves the text by a pixel — a border-bottom on the active one only would.
                ? "font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {I && <I size={size === "sm" ? 14 : 15} />}
            <TabLabel>{t.label}</TabLabel>
            {t.count != null && (
              <span className={cn(
                "ml-0.5 rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums",
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
