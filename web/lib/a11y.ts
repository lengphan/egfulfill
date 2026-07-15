import type { KeyboardEvent } from "react"

/**
 * Makes a non-<button>/<a> element (table row, card) keyboard-accessible:
 * spreads role="button" + tabIndex + click + Enter/Space activation.
 * Add a focus-visible style at the call site.
 */
export function clickableProps(onActivate: () => void, label?: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onActivate()
      }
    },
  }
}
