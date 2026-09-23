"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "@/lib/utils"

/**
 * Anchored panel for read-only detail — the shape a history list wants.
 *
 * Distinct from DropdownMenu on purpose: a menu's children are actions and get menu
 * semantics (arrow-key roving, activate-and-close). A list of things that already
 * happened is neither, and announcing it as a menu misleads a screen reader.
 */
function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" className={className} {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> & {
  align?: "start" | "center" | "end"
  sideOffset?: number
}) {
  return (
    <PopoverPrimitive.Portal>
      {/* DOWNWARD, AND SHORTER — see the same note in dropdown-menu.tsx. Base UI flips a
          popup above its trigger when the full height does not fit below, so a popover's
          direction depended on its content length. `shift` keeps the side and lets the
          max-height below do the fitting. */}
      <PopoverPrimitive.Positioner
        align={align}
        sideOffset={sideOffset}
        collisionAvoidance={{ side: 'shift' }}
        className="z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            /* overflow-y-AUTO, not hidden: the height is now clamped to what is available below
             rather than the popup being flipped, so anything past that has to be reachable.
             `overflow-hidden` would simply cut it off. */
            "max-h-[var(--available-height)] overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground  outline-none",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
