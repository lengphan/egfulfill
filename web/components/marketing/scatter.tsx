"use client"

import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { X } from "@phosphor-icons/react"
import { CARD, INK, SURFACE } from "@/components/marketing/bold-kit"

/**
 * ── THE SCATTER — best-sellers as objects on a canvas ────────────────────────────────────
 *
 * Products laid out as cut-outs floating on the page's own colour, at varied sizes. A click
 * expands one, and the object itself TRAVELS into the expanded view rather than being
 * replaced by a bigger copy of itself.
 *
 * THERE IS NO CARD. The tile is transparent — no border, no fill, no radius, no shadow — so
 * the object sits directly on the canvas rather than inside a box on it. That is the whole
 * device: a card makes a grid of thumbnails, the absence of one makes a table of objects.
 *
 * THE SHADOW IS IN THE PNG, NOT IN CSS, and that is what keeps §4 intact. "No shadow at any
 * level" governs interface chrome; a shadow inside a photograph is part of the photograph. It
 * also has to be baked, because removing a cut-out's background removes its shadow with it and
 * the object then lands weightless.
 *
 * SIZE CARRIES DEPTH, NOT IMPORTANCE. The scale differences read as near and far, which is
 * what stops a scatter looking like a grid knocked askew. A bigger object does not mean a
 * better seller, and using it that way would be an invented signal.
 *
 * POSITIONS ARE PLACED, NEVER RANDOM — random overlaps the type, collides, and changes on
 * every render, so a layout could never be judged.
 *
 * Below `lg` it is a grid. A scatter needs room it does not have on a phone; the objects and
 * their destinations are identical, only the arrangement changes.
 */

export type ScatterItem = {
  /** Cut-out with real alpha AND a baked shadow — see above. */
  src: string
  /** What the product IS. The accessible name, so it can never be decorative. */
  alt: string
  href: string
  /** Percent of the container, to the object's CENTRE. Placed by hand. */
  x: number
  y: number
  /** Width as a percent of the container — the depth cue, and the only size knob. */
  w: number
}

/**
 * THE OBJECT TRAVELS — it is not swapped for a copy.
 *
 * Both the scattered object and the expanded one carry the same `layoutId`, so Motion animates
 * ONE element between the two positions and sizes. That is the whole difference between "the
 * product zooms" and "a picture fades out while a bigger one fades in": the eye keeps hold of
 * the same thing, which is what makes it read as picking an object up.
 *
 * The id is the SRC, not an index — indices are reassigned when the list changes, and the wrong
 * object would then fly to the wrong place.
 *
 * `still` drops the id entirely rather than setting the duration to zero. A shared-layout
 * transition is a large object flying across the viewport, which is exactly what
 * prefers-reduced-motion is asking us not to do — a zero-duration one still teleports.
 *
 * DEFINED AT MODULE LEVEL, not inside Scatter: a component declared in a render body is a new
 * type on every pass, so React unmounts and remounts it — which would throw away the very
 * layout node this whole device depends on (and `react-hooks/static-components` catches it).
 */
function Obj({ src, className, still }: { src: string; className?: string; still: boolean }) {
  /* Not next/image: a cut-out is placed by percentage against a container of unknown pixel
     size, and its intrinsic ratio is the layout. `no-img-element` does not fire on motion.img. */
  return <motion.img layoutId={still ? undefined : src} src={src} alt="" className={className} />
}

export function Scatter({ items, className = "", minH = "clamp(30rem, 82vh, 52rem)" }: {
  items: ScatterItem[]
  className?: string
  minH?: string
}) {
  const [open, setOpen] = useState<ScatterItem | null>(null)
  const reduce = useReducedMotion()
  const close = useCallback(() => setOpen(null), [])

  /* ESCAPE CLOSES IT. An overlay a keyboard cannot dismiss is a trap, and this one covers the
     whole viewport. Bound only while something is open. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close])

  return (
    <section
      className={"relative w-full overflow-hidden " + className}
      style={{ background: SURFACE, minHeight: minH }}
    >
      <div className="absolute inset-0 hidden lg:block">
        {items.map((it) => (
          <button
            key={it.src}
            type="button"
            onClick={() => setOpen(it)}
            aria-label={it.alt}
            className="group absolute block cursor-zoom-in focus-visible:outline-none"
            style={{ left: `${it.x}%`, top: `${it.y}%`, width: `${it.w}%`, transform: "translate(-50%, -50%)" }}
          >
            <Obj src={it.src} still={!!reduce} className="block w-full origin-center transition-transform duration-500 ease-out will-change-transform motion-safe:group-hover:scale-[1.07] motion-safe:group-focus-visible:scale-[1.07]" />
          </button>
        ))}
      </div>

      {/* Below lg: the same objects, arranged rather than scattered. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 px-6 py-14 sm:grid-cols-3 lg:hidden">
        {items.map((it) => (
          <button key={it.src} type="button" onClick={() => setOpen(it)} aria-label={it.alt} className="block cursor-zoom-in">
            <Obj src={it.src} still={!!reduce} className="block w-full" />
          </button>
        ))}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-7 px-6"
            style={{ background: SURFACE }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22 }}
            onClick={close}
            role="dialog"
            aria-modal="true"
            aria-label={open.alt}
          >
            <Obj src={open.src} still={!!reduce} className="max-h-[58vh] w-auto max-w-[min(44rem,84vw)] object-contain" />
            {/* The name and the way through. Not a subtitle explaining the picture (§4) — the
                name is what the object IS, and the link is the only thing to do next. */}
            <div className="flex flex-col items-center gap-4 text-center">
              <p className="text-[15px] font-medium" style={{ color: INK }}>{open.alt}</p>
              <a
                href={open.href}
                onClick={(e) => e.stopPropagation()}
                className="rounded-lg px-4 py-2 text-[13px] font-medium"
                style={{ background: INK, color: CARD }}
              >
                See it in the catalogue
              </a>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-5 top-5 rounded-full p-2 transition-colors hover:bg-[color-mix(in_oklch,var(--mk-ink)_8%,transparent)]"
              style={{ color: INK }}
            >
              <X size={20} weight="bold" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
