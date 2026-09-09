"use client"

import type { ReactNode } from "react"

/**
 * THE HEADER BAND, AND THE ONE PHOTOGRAPH ON IT.
 *
 * WHY A PHOTOGRAPH AND NOT A COLOUR. The app's palette has almost no lime or periwinkle in
 * it, and that is not an oversight — measured, lime on white is 1.19:1 and periwinkle 1.67:1,
 * so neither can be text, a rule, an icon or a border here. And the one place a bright fill
 * would fit — a chip beside a row — is exactly where the floor's reserved status colours live
 * (§4: amber is hold, violet is working), so a brand hue there starts meaning something, and
 * the thing it means is wrong.
 *
 * An image collides with no token, crowds no status, and needs no contrast ratio. It is a
 * PHOTOGRAPH rather than a render because that is the house identity — we photograph what we
 * actually make — and because the balloon renders that sat here before were the one device on
 * these pages that could not also appear on a product.
 *
 * WHY THE GROUND IS THE RAIL'S SLATE AND NOT `bg-brand`. The band used to be a full brand
 * fill, which in dark mode is `oklch(0.91 0.12 282)` — deliberately BRIGHTER than the light
 * value, because every darker periwinkle the skin swept landed inside a status colour (see
 * globals.css). A pastel plank across the top of a dark page was the result. `--sidebar` is
 * already dark, already the app's one bounded block of colour, and moves one honest step
 * between the themes — so the band and the rail read as the same surface in both.
 *
 * ONE PER PAGE, IN THE HEADER, AND NOWHERE ELSE. The reason these work is that they are rare;
 * three on a queue is wallpaper. The photo sits in the band's right half, which is dead space
 * on these pages, and the band reserves that half in padding so a control in it (the admin's
 * date range) is laid out beside the people rather than underneath them.
 */
export function PageBand({
  photo,
  title,
  sub,
  children,
}: {
  /** A head-and-shoulders crop on the periwinkle seamless. Omit and the band is plain plate. */
  photo?: string
  title: ReactNode
  sub?: ReactNode
  /** Controls that belong in the band — they sit left of the photo, never under it. */
  children?: ReactNode
}) {
  return (
    <div
      className={
        "relative isolate flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl bg-sidebar px-5 py-5 text-sidebar-foreground " +
        /* THE BAND STAYS SHORT (owner's call, 2026-09-09) — the height is not the knob.
           The padding is: the photo is a 40% block with a hard edge, so the type needs the
           other 60% reserved or a long Vietnamese name runs into a face. Mobile hides the
           photo, so it reserves nothing. */
        (photo ? "sm:pr-[42%]" : "")
      }
    >
      <div className="min-w-0">
        <h1 className="font-title text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-sidebar-foreground/60">{sub}</p>}
      </div>
      {children}
      {photo && (
        // A decorative asset, already encoded and sized; next/image would re-encode it at
        // q75 for no gain (see ploy/hero.tsx, which made the same call).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          aria-hidden
          draggable={false}
          /* NO FADE. A linear mask dissolving the periwinkle into the plate was the first
           * thing to go: a gradient is what you reach for to apologise for a join, and the
           * join reads better stated than blurred. The photo keeps its own ground and meets
           * the slate on a hard vertical edge.
           *
           * THE FRAMING IS IN THE FILE, NOT IN object-position. At 92px tall and 40% wide
           * the band is a 4.7:1 window, so a square group shot cover-cropped into it is a
           * horizontal slice — of foreheads, at almost any offset you pick. `band-crew.webp`
           * is cut to the head-and-shoulders band already (3.98:1), so the window lands on
           * faces and the 40% offset is a nudge rather than a rescue.
           *
           * -z-10 under `isolate`: the photo is behind the type, so a long name runs over it
           * rather than being pushed into it. */
          className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden h-full w-[40%] select-none object-cover object-[50%_40%] sm:block"
        />
      )}
    </div>
  )
}

/**
 * ONE PHOTOGRAPH, ON EVERY ROLE'S BAND (owner's call, 2026-09-09).
 *
 * This was four single blanks — a cap, a bag, a beanie — one per role, on the argument that
 * a worn shot at band height is a slice of a chest and reads as stock photography. The
 * argument was about FRAMING, not about people: three of them laughing on the periwinkle
 * seamless, cut to the head-and-shoulders band, is faces at this height rather than a chest.
 *
 * It is the same image for every role deliberately. A per-role shot means four sessions of
 * models, and four groups that have to look like one company; the blanks could differ
 * because an object is anonymous, and people are not.
 *
 * ADMIN IS NO LONGER ABSENT. It was left out because its band carries the date-range
 * control and there was nowhere for that to go but under the photo — the 42% reserve above
 * lays that control out beside the photo instead.
 */
const CREW = "/ploy/band-crew.webp"
export const ROLE_PHOTO: Record<string, string> = {
  seller: CREW,
  operator: CREW,
  warehouse: CREW,
  designer: CREW,
  admin: CREW,
}
