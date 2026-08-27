"use client"

import Link from "next/link"
import { SURFACE } from "@/components/marketing/bold-kit"

/**
 * ── THE SCATTER — best-sellers as objects on a canvas ────────────────────────────────────
 *
 * Products laid out as cut-outs floating on the page's own colour, at varied sizes, with
 * generous space between them. Hover brings one forward; a click opens it.
 *
 * THERE IS NO CARD. The tile is transparent — no border, no fill, no radius, no shadow — so
 * the object sits directly on the canvas rather than inside a box on it. That is the whole
 * device: a card makes a grid of thumbnails, and the absence of one makes a table of objects.
 *
 * THE SHADOW IS IN THE PNG, NOT IN CSS, and that is what keeps §4 intact. "No shadow at any
 * level — elevation is a change of background value" governs interface chrome; a shadow inside
 * a photograph is part of the photograph. `tools/bake-shadow` composites it into the alpha,
 * because removing a cut-out's background removes its shadow too and the object lands
 * weightless.
 *
 * SIZE CARRIES DEPTH, NOT IMPORTANCE. The scale differences read as near and far, which is
 * what stops a scatter looking like a grid someone knocked askew. It is NOT a hierarchy — a
 * bigger object here does not mean a better seller, and using it that way would be the kind of
 * invented signal §4's honesty rule is about.
 *
 * POSITIONS ARE PLACED, NEVER RANDOM. Random overlaps, collides with the type, and changes on
 * every render so a layout can never be judged. These are hand-set percentages.
 *
 * BELOW `lg` IT IS A GRID. A scatter depends onthe space it does not have on a phone; at 375px
 * absolute placement becomes a pile. The objects and their links stay identical — only the
 * arrangement changes.
 */

export type ScatterItem = {
  /** Cut-out with real alpha AND a baked shadow — see the note above. */
  src: string
  /** What the product IS. This is the link's accessible name, so it cannot be decorative. */
  alt: string
  href: string
  /** Percent of the container. Placed by hand; see above. */
  x: number
  y: number
  /** Width as a percent of the container — the depth cue. */
  w: number
}

export function Scatter({ items, className = "", minH = "clamp(34rem, 82vh, 54rem)" }: {
  items: ScatterItem[]
  className?: string
  minH?: string
}) {
  return (
    <section
      className={"relative w-full overflow-hidden " + className}
      style={{ background: SURFACE, minHeight: minH }}
    >
      {/* THE SCATTER, lg and up. `hidden lg:block` rather than a media query in JS: the
          arrangement is a layout decision and belongs in CSS, and a JS breakpoint would flash
          the wrong one on first paint. */}
      <div className="absolute inset-0 hidden lg:block">
        {items.map((it) => (
          <Link
            key={it.href + it.x}
            href={it.href}
            aria-label={it.alt}
            className="group absolute block focus-visible:outline-none"
            style={{ left: `${it.x}%`, top: `${it.y}%`, width: `${it.w}%`, transform: "translate(-50%, -50%)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={it.src}
              alt=""
              className="block w-full origin-center transition-transform duration-500 ease-out will-change-transform motion-safe:group-hover:scale-[1.12] motion-safe:group-focus-visible:scale-[1.12]"
            />
          </Link>
        ))}
      </div>

      {/* Below lg: the same objects, arranged rather than scattered. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 px-6 py-14 sm:grid-cols-3 lg:hidden">
        {items.map((it) => (
          <Link key={it.href + it.x} href={it.href} aria-label={it.alt} className="group block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.src} alt="" className="block w-full" />
          </Link>
        ))}
      </div>
    </section>
  )
}
