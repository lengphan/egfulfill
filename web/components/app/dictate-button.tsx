"use client"

import { useRef } from "react"
import { Microphone } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { useLocale, useLabelT } from "@/lib/i18n"
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
  const tl = useLabelT()
  const { locale } = useLocale()
  /**
   * IT TYPES INTO THE BOX, WORD BY WORD.
   *
   * The words being heard used to float in a bubble above the microphone, which made two
   * places to look: the transcript appeared over here, then jumped over there once it
   * settled. Now the live words go straight into the field, so there is one place the text
   * ever is and you watch it arrive where it will stay.
   *
   * `baseRef` is what has actually been SETTLED. Every interim update rewrites the field as
   * base + the current guess, so a revised guess replaces the last one instead of stacking;
   * a final chunk moves it into the base and the next phrase builds from there. Without
   * that anchor the recogniser's own corrections would each append, and speaking one
   * sentence would leave four half-versions of it in the box.
   */
  const baseRef = useRef(value)
  const join = (a: string, b: string) => (a && !/\s$/.test(a) ? `${a} ${b}` : `${a}${b}`)

  const { supported, listening, error, toggle } = useDictation({
    // The recogniser follows the app's own language switcher. Dictating Vietnamese into an
    // English recogniser does not error — it returns confident nonsense, which is worse.
    lang: recogniserLang(locale),
    onInterim: (live) => { if (live) onChange(join(baseRef.current, live)) },
    onText: (chunk) => {
      baseRef.current = join(baseRef.current, chunk)
      onChange(baseRef.current)
    },
  })

  /* Starting anchors on whatever is in the box right now, so dictation continues a
     half-typed sentence. Stopping drops any unsettled guess rather than leaving it behind
     as though it had been heard properly. */
  const onToggle = () => {
    if (listening) onChange(baseRef.current)
    else baseRef.current = value
    toggle()
  }

  if (!supported) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className ?? "size-9 shrink-0"}
      onClick={onToggle}
      disabled={disabled}
      aria-label={listening ? tl("dictateButton", "Stop dictating") : label}
      aria-pressed={listening}
      /* The reason lives on the control that caused it. A mic that stopped because
         permission was refused has to say so somewhere the eye already is. */
      title={error ?? (listening ? tl("dictateButton", "Listening — press to stop") : label)}
    >
      <Microphone
        size={17}
        weight={listening ? "fill" : "regular"}
        /* Primary, not red. Red is reserved for alert across this app (CLAUDE.md §4) and a
           live microphone is not an alarm — the pulse is what says "running". */
        className={listening ? "animate-pulse text-primary" : error ? "text-muted-foreground" : undefined}
      />
    </Button>
  )
}
