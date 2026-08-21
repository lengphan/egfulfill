import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * A FIELD HAS AN EDGE, AND A FIELD IS WHITE.
 *
 * This was `border-transparent` over `bg-input/50` — a grey slab with no outline — at
 * rounded-2xl. Two things went wrong with that. A filled field with no edge does not read
 * as somewhere you TYPE; it reads as a disabled chip, which is why a row of price inputs
 * looked like dead beige lozenges rather than an editable table. And on the near-white page
 * the fill was barely distinguishable from the card behind it, so the only thing marking the
 * field was its own slightly-different grey.
 *
 * A hairline on the page's own white is the opposite: the edge does the work, the inside
 * stays paper, and it is legible as "type here" without any fill at all. Same treatment
 * every restrained tool UI uses, and the same rounded-lg the Button and .eg-control now
 * share — so a field, a filter and a button finally agree about what a corner is.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-base transition-[color,box-shadow] duration-200 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
