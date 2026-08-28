import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// SHAPE IS PART OF THE SYSTEM, and it was `rounded-full` — so every button in the app was
// a lozenge, and read as one more chip among the chips rather than as a control. A softer
// rounded rect is what makes a button set look deliberate: the shape says "control", the
// fill says "primary", and the two stop competing. Fully-round is now reserved for the
// things that genuinely are round — count badges and avatars.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /**
         * THE PRIMARY ACTION IS INK. Near-black on paper, near-white on the dark ground,
         * white/ink label respectively — 18.97:1 and 17.36:1.
         *
         * It was a violet fill with a lime label, and the long note that used to sit here
         * explained at length why the two had to swap jobs between modes. That whole problem
         * is gone with the colour: ink needs no such reasoning, works identically in both
         * directions, and is the same move every restrained tool UI makes, because a
         * borderless fill only needs to clear 3:1 against what is behind it and black
         * clears everything.
         *
         * SHAPE SAYS KIND, WEIGHT SAYS IMPORTANCE. That is the whole hierarchy: `default` is
         * the one thing this screen is for, `outline` is a real but secondary action, `ghost`
         * is a minor one, `destructive` undoes something. A filter or a toggle is NOT a
         * button and should not borrow one of these — see the note in CLAUDE.md.
         *
         * Hover shifts the fill toward the page rather than brightening it: brightness on a
         * near-black surface is almost invisible, which left the old hover doing nothing at
         * all once the violet went.
         */
        /* --primary, NOT --brand. The reasoning above is about INK, and this line pointed at
           a token that merely happened to hold near-black. The moment --brand became the
           violet it was always meant to be, every primary button in the product turned
           violet with it — against the argument written directly above it.
           They are different jobs. --primary is the ink: 17.4:1 on a white card, and it
           INVERTS per theme (near-black on light, near-white on dark), which is exactly what
           a fill needs when the surface behind it flips. --brand is a chromatic accent for
           large fills we control the foreground of — a selected row, a POST pill — and it is
           measured against the eight reserved order statuses precisely because it is
           chromatic. A neutral has no such problem: it is not on the wheel, so it can never
           be mistaken for a state an order is in. */
        default: "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_18%)]",
        // A CONTROL EDGE, NOT A CARD RULE — and they are different tokens for a reason.
        // `--border` is a card's rule: it separates two surfaces and is allowed to be
        // faint. On the page ground it measures 1.23:1, and CLAUDE.md sets a 3:1 FLOOR for a
        // control's edge, because a button you cannot find is not a button. `--input` is
        // that token — the one the fields already use — and it measures 3.13:1 on the page
        // and 3.44:1 on a card. 231 outline buttons stop dissolving into the background.
        outline:
          "border-input bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        // A CONTROL AT REST, NOT A CAPTION. Ghost carried no colour and no chrome at all —
        // it inherited whatever it sat in and only became visible on hover. At 89 uses that
        // is a lot of buttons that do not look like buttons until you touch them, and
        // "Cancel" beside a filled primary was the case that showed it.
        //
        // ON THE HOVER, AND AN EARLIER CLAIM CORRECTED. --muted measures 1.19:1 against a
        // white card, which sounds fatal and is not: between two light surfaces that is a
        // ~16% luminance drop, which is a perfectly legible fill change. The rest state was
        // the real defect, not the hover.
        //
        // --secondary is used here rather than --muted for naming only. They hold the SAME
        // value (oklch(0.9417 0.0052 247.88)), along with --accent — three tokens, one
        // colour — so this changes nothing visually. Worth knowing before anyone edits one
        // expecting the others to follow.
        //
        // Rest is now explicit ink at medium weight: findable by contrast and weight rather
        // than by chrome, which is what keeps it BELOW outline in the hierarchy while still
        // reading as something you can press.
        ghost:
          "text-foreground hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground",
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
