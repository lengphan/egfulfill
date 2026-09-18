import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * THE MULTI-LINE HALF OF `Input`, and it should have existed already.
 *
 * Three screens were hand-rolling a textarea — broadcasts-view twice off a private
 * TEXTAREA_CLS const, api-playground inline — which is the shape §"a rule with no component
 * is a wish" describes: there is nothing to import, so every new one is a fresh line of
 * Tailwind, and fresh Tailwind is where a house style goes to die. Those three already
 * disagreed with `Input` about the radius (`rounded-md` against `rounded-lg`) and about the
 * focus ring's width.
 *
 * The classes here are Input's, minus the ones that mean nothing on a textarea (height,
 * file:*) and plus the two that only matter here: a minimum height so an empty one is
 * obviously typeable, and `resize-y` — horizontal resize breaks whatever grid it sits in,
 * vertical never does.
 *
 * A plain <textarea>, not a Base UI primitive: Base UI ships no Textarea, and wrapping
 * `Input` would give a single-line control with a fake height.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full min-w-0 resize-y rounded-lg border border-input bg-background px-2.5 py-1.5 text-base transition-[color,box-shadow] duration-200 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
