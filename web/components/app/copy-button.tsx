"use client"

/**
 * COPY — the primitive, because there were five of them and no component.
 *
 * `navigator.clipboard` was called by hand in five separate files (order-grid, spydeck-view,
 * templates-panel, api-playground, settings-view), each with its own idea of whether to
 * confirm, how, and for how long. That is the shape CLAUDE.md §4 describes: a rule with no
 * component is a wish, and fresh Tailwind is where a house style goes to die. This is the
 * component, so the sixth caller imports instead of re-deriving.
 *
 * WHY A CONFIRMATION AT ALL. Copying is the one action with no visible result — the page
 * does not move, nothing opens, and the only feedback is in a clipboard you cannot see. A
 * button that appears to do nothing gets pressed again, and then a third time. The check
 * mark is the whole point of the component.
 *
 * It returns to its resting state on its own. A permanently ticked button is a lie the next
 * time you look at the card.
 */
import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CopyButton({ value, label, copiedLabel, className }: {
  /** The text that lands on the clipboard. */
  value: string
  /** Accessible name — the button is an icon, so this is the only thing a screen reader has. */
  label: string
  copiedLabel: string
  className?: string
}) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* Clear on unmount: a card that closes mid-timeout would otherwise set state on a
     component that is gone, which React warns about and which is a real leak in a list. */
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value)
      setDone(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setDone(false), 1600)
    } catch {
      /* A denied clipboard permission is not worth an error banner — the person can still
         select the text. Staying silent is the honest response to a failure with an obvious
         manual fallback. */
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={done ? copiedLabel : label}
      title={done ? copiedLabel : label}
      onClick={copy}
      className={cn("size-7 shrink-0 p-0 text-muted-foreground hover:text-foreground", className)}
    >
      {done ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </Button>
  )
}
