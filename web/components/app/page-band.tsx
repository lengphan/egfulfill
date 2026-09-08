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
 * three on a queue is wallpaper. The photo sits in the band's right side, which is dead space
 * on these pages, so it costs no room a control was using — and where a control DOES live
 * there (the admin's date range), the role simply carries no photo.
 */
export function PageBand({
  photo,
  title,
  sub,
  children,
}: {
  /** A whole object on the periwinkle seamless. Omit and the band is plain plate. */
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
        (photo ? "sm:pr-[180px]" : "")
      }
    >
      <div className="min-w-0">
        <h1 className="font-title text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-sidebar-foreground/60">{sub}</p>}
      </div>
      {children}
      {photo && (
        // A decorative crop, already encoded and sized; next/image would re-encode it at
        // q75 for no gain (see ploy/hero.tsx, which made the same call).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          aria-hidden
          draggable={false}
          /* -z-10 under `isolate`: the photo is behind the type, so a long name in Vietnamese
             runs over it rather than being pushed into it. */
          className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden h-full w-[200px] select-none object-cover object-[50%_42%] sm:block"
          /* The left edge dissolves into the plate — a hard vertical seam between a slate band
             and a periwinkle photo is two blocks, not one band. */
          style={{
            maskImage: "linear-gradient(to right, transparent, #000 58%)",
            WebkitMaskImage: "linear-gradient(to right, transparent, #000 58%)",
          }}
        />
      )}
    </div>
  )
}

/**
 * The photograph each surface carries — a WHOLE object, never a crop of someone's torso: at
 * band height a worn shot is a slice of a chest and reads as stock photography.
 *
 * ADMIN IS DELIBERATELY ABSENT. Its band carries the date-range control, which is the one
 * thing that would have to sit under the photo — and a role that is not listed simply has
 * none, which is better than every page wearing the same one.
 */
export const ROLE_PHOTO: Record<string, string> = {
  seller: "/ploy/blank/cap.webp",
  operator: "/ploy/blank/other.webp",
  warehouse: "/ploy/blank/bag.webp",
  designer: "/ploy/blank/beanie.webp",
}
