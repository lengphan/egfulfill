"use client"

import * as React from "react"
import { Eye, EyeSlash } from "@phosphor-icons/react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * A password field you can look at.
 *
 * Typing a password blind is where the retries come from — most of all on "set a new
 * password", which has no second field to catch a typo and fails minutes later at the login
 * screen instead of immediately.
 *
 * ALWAYS STARTS HIDDEN, and there is no prop to change that. Some of these screens are used
 * on the shared floor terminal, where the person behind you is the threat model; revealing
 * has to be a deliberate act each time, not a setting someone leaves on.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [shown, setShown] = React.useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        // Room for the button, so a long password never runs underneath it.
        className={cn("pr-10", className)}
      />
      <button
        type="button"                       // never "submit" — this sits inside a form
        onClick={() => setShown((v) => !v)}
        // Named for what pressing it DOES, which is what a screen reader should announce;
        // aria-pressed carries the current state so both halves are available.
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        title={shown ? "Hide password" : "Show password"}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {shown ? <EyeSlash size={16} weight="bold" /> : <Eye size={16} weight="bold" />}
      </button>
    </div>
  )
}
