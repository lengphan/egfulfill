"use client"

/**
 * ONE BALLOON OBJECT IN A PAGE'S HEADER BAND.
 *
 * WHY AN OBJECT AND NOT A COLOUR. The app's palette has almost no lime or periwinkle in it,
 * and that is not an oversight — measured, lime on white is 1.19:1 and periwinkle 1.67:1, so
 * neither can be text, a rule, an icon or a border here; they can only ever be a ground
 * carrying ink. And the one place a bright fill would fit — a chip beside a row — is exactly
 * where the floor's reserved status colours live (§4: amber is hold, violet is working), so a
 * brand hue there starts meaning something, and the thing it means is wrong.
 *
 * An object is an IMAGE. It collides with no token, crowds no status, and needs no contrast
 * ratio. It is how the marketing site carries the brand and it is the one device that can
 * cross into the app unchanged.
 *
 * ONE PER PAGE, IN THE HEADER, AND NOWHERE ELSE. The reason the marketing objects work is
 * that they are rare; three on a queue is wallpaper. It sits in the header band's right side,
 * which is dead space on these pages, so it costs no room a control was using.
 *
 * A DIFFERENT ONE PER SURFACE, so a person recognises where they are before they read the
 * title — which is the whole return on this, and it is free.
 */

/** `alt=""` and aria-hidden: the heading beside it already names the page. */
export function PageObject({ src, className = "" }: { src: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a decorative cut-out, already
    // encoded and sized; next/image would re-encode it at q75 for no gain (see ploy/hero.tsx).
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={"pointer-events-none hidden h-auto w-[72px] shrink-0 select-none sm:block " + className}
    />
  )
}

/** The object each surface carries. A role that is not listed simply has none — better than
 *  every page wearing the same one, which would say nothing at all. */
export const ROLE_OBJECT: Record<string, string> = {
  seller: "/ploy/obj-chrome.webp",
  operator: "/ploy/obj-star.webp",
  warehouse: "/ploy/obj-cloud.webp",
  designer: "/ploy/obj-green.webp",
  admin: "/ploy/obj-chrome.webp",
}
