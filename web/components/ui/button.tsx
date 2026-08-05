import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // THE BRAND LIME, not --primary. A filled button is the one place the accent gets to
        // be itself: it's a large fill with a foreground we control, so the bright lime works
        // exactly as it does on the marketing plates, with ink text at ~17:1.
        //
        // --primary stays the deeper green because it also inks ~247 pieces of TEXT, where a
        // colour this light is invisible on white. Fill and ink are different jobs; this is
        // the fill.
        //
        // hover dims via brightness rather than an alpha step: /80 on a light fill fades it
        // toward the white page instead of reading as pressed.
        //
        // THE INK OUTLINE IS LOAD-BEARING, not styling. Lime measures 1.19:1 against the
        // white page — far under the 3:1 a UI component boundary needs — so the fill has no
        // findable edge and the primary action dissolves into the page. The LABEL was never
        // the problem (ink on lime is 16.56:1); the SHAPE was.
        //
        // border-brand-foreground is the same token as the label, so the outline can never
        // drift from the text it encloses. It's ink in both modes: on the dark canvas it
        // recedes to a quiet definition line, which is correct there because the lime already
        // carries a 16.64:1 edge of its own.
        //
        // 1px at full ink — the thinnest border available. An alpha step was tried first and
        // read WORSE, not softer: at 1px an 85% line antialiases into the page and comes out
        // as a muddy grey smudge, where full ink at the same width is a crisp hairline. The
        // findability problem is solved by the edge EXISTING, not by weight, so thickness
        // stays at 1px and the colour stays clean.
        default: "border-brand-foreground bg-brand text-brand-foreground hover:brightness-95",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
