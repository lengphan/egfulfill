"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "@phosphor-icons/react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/30 duration-100 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

// A dialog taller than the viewport used to run off the bottom of the screen with no way
// to reach its buttons — it's centred with translate(-50%,-50%), so the overflow goes both
// directions and the page behind can't scroll to it either. Capped to the viewport (dvh,
// so mobile browser chrome is accounted for) and scrolls internally.
//
// `*:min-w-0` is the horizontal half of the same problem, and it belongs HERE rather than
// on any one dialog. This popup is a GRID, so every child is a grid item with the default
// `min-width: auto` — it refuses to shrink below its own min-content width. A child holding
// anything unbreakable (a `truncate` title, which is `white-space: nowrap`, or a long SKU)
// therefore reports the WHOLE string as its minimum and blows the track past the popup's
// max-width. And because `overflow-y-auto` forces `overflow-x` to `auto` too, the result is
// a horizontal scrollbar inside the dialog with the right-hand column clipped off — the
// title truncating not at the dialog edge but somewhere past it.
//
// Measured on a 835px viewport with a real product title: content width 1035px inside an
// 818px popup, and 816px once these children are allowed to shrink.
//
// Per-dialog `max-w-*` patches never fixed this because max-width was never what was
// breaking; the automatic minimum size overrides it.
/**
 * A DIALOG CAN ALSO BE A SIDE PANEL — `side="right"`.
 *
 * On the PRIMITIVE, not as a second component, because a sheet and a modal differ in exactly
 * one thing: where they are anchored. Everything else — the portal, the overlay, the close
 * button, the escape and outside-press behaviour, the shadow — is identical, and a fork would
 * be a second copy of all of it that drifts (§4: extend the primitive rather than fork it).
 *
 * WHEN TO REACH FOR IT. A centred modal is for a question. A side panel is for WORK done
 * against a list — you keep the rows in view, the panel is tall rather than wide, and its
 * content reads top to bottom in the order it happens. Full height also means a long result
 * list has somewhere to go, which is the thing a centred dialog cannot give without either
 * growing sideways or hiding its own footer.
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  side = "center",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  side?: "center" | "right"
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        /**
         * A DIALOG CASTS A SHADOW. This had a hairline ring and nothing else, so a panel
         * floating over a white page was held off it by one pixel of near-transparent
         * border — on a light screen it reads as a card that failed to lift rather than one
         * in front of the page. The chat launcher and the board tour already carry this
         * exact shadow; they are the same object at a different size, and only the two of
         * them had it.
         * On the shared primitive, not on one caller: every dialog in the app was flat.
         */
        className={cn(
          "fixed z-50 grid gap-6 overflow-y-auto overscroll-contain *:min-w-0 bg-popover p-6 text-sm text-popover-foreground shadow-[0_28px_70px_-14px_rgb(0_0_0/0.45)] ring-1 ring-foreground/5 duration-100 outline-none dark:ring-foreground/10 data-open:animate-in data-closed:animate-out",
          side === "right"
            /* Flush to the edge and full height. It slides rather than zooms — a panel that
               scaled up from its own centre would read as a modal that landed off-centre.
               Rounded on the LEFT only: the other three sides meet the viewport, and a corner
               radius against a screen edge is a gap, not a curve. */
            ? "inset-y-0 right-0 h-dvh w-full max-w-[calc(100%-3rem)] rounded-l-[min(var(--radius-4xl),24px)] sm:max-w-lg data-open:slide-in-from-right data-open:fade-in-0 data-closed:slide-out-to-right data-closed:fade-out-0"
            : "top-1/2 left-1/2 max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-[min(var(--radius-4xl),24px)] sm:max-w-md data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4 bg-secondary"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
