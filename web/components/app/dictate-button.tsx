"use client"

import { Microphone } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/lib/i18n"
import { useDictation, recogniserLang } from "@/lib/speech"

/**
 * SPEAK INSTEAD OF TYPING — one control, wired the same way everywhere.
 *
 * It appends finished phrases to whatever text the caller is holding, so it drops into a
 * chat composer and an image-prompt box without either of them knowing anything about
 * speech. Dictating ADDS to what is already there rather than replacing it: half a typed
 * sentence finished out loud is the normal way this gets used, and a control that wiped
 * the box would only be usable as the very first thing you do.
 *
 * It is absent, not disabled, where the browser cannot do it. A disabled mic invites
 * someone to keep pressing it; Firefox simply has no such feature, and the honest UI for a
 * thing that does not exist is nothing at all. Everywhere it IS shown, it works.
 */
export function DictateButton({
  value, onChange, disabled, className, label = "Dictate",
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  className?: string
  label?: string
}) {
  const { locale } = useLocale()
  const { supported, listening, interim, error, toggle } = useDictation({
    // The recogniser follows the app's own language switcher. Dictating Vietnamese into an
    // English recogniser does not error — it returns confident nonsense, which is worse.
    lang: recogniserLang(locale),
    onText: (chunk) => {
      const base = value
      // Join with a space unless the box is empty or already ends in whitespace, so
      // successive phrases read as a sentence rather than runtogetherlikethis.
      onChange(base && !/\s$/.test(base) ? `${base} ${chunk}` : `${base}${chunk}`)
    },
  })

  if (!supported) return null

  return (
    <span className="relative inline-flex">
      {/* WHAT IT THINKS IT IS HEARING, while it is still hearing it.
          A pulsing icon says "running"; it does not say "running and picking up YOU". The
          interim string is the only thing that distinguishes a working microphone from a
          muted one, and it costs a line. It floats so a growing phrase cannot reflow the
          toolbar it sits in. */}
      {listening && interim ? (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 max-w-56 -translate-x-1/2 truncate rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground shadow-sm">
          {interim}
        </span>
      ) : null}
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className ?? "size-9 shrink-0"}
      onClick={toggle}
      disabled={disabled}
      aria-label={listening ? "Stop dictating" : label}
      aria-pressed={listening}
      /* The reason lives on the control that caused it. A mic that stopped because
         permission was refused has to say so somewhere the eye already is. */
      title={error ?? (listening ? "Listening — press to stop" : label)}
    >
      <Microphone
        size={17}
        weight={listening ? "fill" : "regular"}
        /* Primary, not red. Red is reserved for alert across this app (CLAUDE.md §4) and a
           live microphone is not an alarm — the pulse is what says "running". */
        className={listening ? "animate-pulse text-primary" : error ? "text-muted-foreground" : undefined}
      />
    </Button>
    </span>
  )
}
