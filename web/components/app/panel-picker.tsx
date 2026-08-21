"use client"

import { Warning } from "@phosphor-icons/react"

export type PickerOption = {
 value: string
 label: string
  /**
   * The option's state — "connected", "test", "reconnect", "not set".
   *
   * NOT rendered in the option text. Every row carrying its own state turned the open
   * list into a wall of qualifiers, and the two states that actually need chasing are
   * already on the chips below. The panel shows this for whichever option is selected.
   */
 status?: string
  /** Optgroup heading. Options without one render above the first group. */
 group?: string
  /** Also surfaces the option as a chip above the panel. Use sparingly — a list
   * where everything is flagged flags nothing. */
 attention?: boolean
}

/**
 * One select, one panel.
 *
 * Settings › Integrations and Settings › Platform were the only two screens built as a
 * stack of collapsed rows — 18 `<details>` and 9 folds — which meant the answer to "is
 * Shippo on test keys?" cost a scroll and a click, and the answer to "is anything
 * broken?" cost 23 of them. The state lives in the option label instead, so the closed
 * control already carries it.
 *
 * Deliberately a native <select>: it is the house pattern (`.eg-select`), it collapses
 * to a platform picker on a phone, and it is the one listbox that never renders 23 rows
 * of custom markup to say one word.
 */
export function PanelPicker({
 value,
 onChange,
 options,
 label,
 attentionNote,
}: {
 value: string
 onChange: (v: string) => void
 options: PickerOption[]
  /** aria-label for the select — it has no visible <label>. */
 label: string
  /** Overrides the "N need attention" wording. */
 attentionNote?: string
}) {
 const groups: string[] = []
 for (const o of options) if (o.group && !groups.includes(o.group)) groups.push(o.group)
 const ungrouped = options.filter((o) => !o.group)
 const needs = options.filter((o) => o.attention)

 return (
    <div className="space-y-2">
      {/* Full width only on a phone. A picker stretched across a desktop card is a very
 large control for a list of short names, and the distance between the caret and
 the name it belongs to is the tell. */}
      <select
 aria-label={label}
 value={value}
 onChange={(e) => onChange(e.target.value)}
 className="eg-select h-9 w-full rounded-2xl border border-border bg-card px-3 text-sm font-medium outline-none transition-colors hover:border-primary/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:w-auto sm:min-w-64 sm:max-w-sm"
      >
        {ungrouped.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {options.filter((o) => o.group === g).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {needs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Warning size={13} weight="fill" className="shrink-0 text-hold" />
          <span className="text-muted-foreground">
            {attentionNote ?? `${needs.length} need${needs.length === 1 ? "s" : ""} attention:`}
          </span>
          {needs.map((o) => (
            <button
 key={o.value}
 onClick={() => onChange(o.value)}
 className={
                "rounded-md px-1.5 py-0.5 font-medium transition-colors " +
                (o.value === value
                  ? "bg-hold/20 text-hold"
 : "bg-hold/15 text-hold hover:bg-hold/20 dark:hover:bg-hold/50")
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
