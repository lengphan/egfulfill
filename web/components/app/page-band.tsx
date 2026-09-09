"use client"

import { useRef, type ReactNode } from "react"
import { motion } from "motion/react"

/**
 * THE HEADER BAND, AND THE THINGS FLOATING IN IT.
 *
 * WHY A FIGURE AND NOT A COLOUR. The app's palette has almost no lime or periwinkle in it,
 * and that is not an oversight — measured, lime on white is 1.19:1 and periwinkle 1.67:1, so
 * neither can be text, a rule, an icon or a border here. And the one place a bright fill would
 * fit — a chip beside a row — is exactly where the floor's reserved status colours live, so a
 * brand hue there starts meaning something, and the thing it means is wrong.
 *
 * An object collides with no token, crowds no status, and needs no contrast ratio.
 *
 * WHY OBJECTS AND NOT THE PHOTOGRAPH (owner's call, 2026-09-09). A band-height crop of three
 * people laughing on a periwinkle seamless is the shape of stock photography whether or not
 * the shoot was ours, and it arrived with a second problem: the photo brought its own bright
 * ground, so 40% of every page header was a pastel plank butted against the slate on a hard
 * vertical edge. The balloons have no ground. They sit ON the rail's own colour, which means
 * the band is ONE surface again, and the only bright things in it are the objects themselves.
 *
 * WHY THE GROUND IS THE RAIL'S SLATE AND NOT `bg-brand`. The band used to be a full brand
 * fill, which in dark mode is `oklch(0.91 0.12 282)` — deliberately BRIGHTER than the light
 * value, because every darker periwinkle the skin swept landed inside a status colour (see
 * globals.css). A pastel plank across the top of a dark page was the result. `--sidebar` is
 * already dark, already the app's one bounded block of colour, and moves one honest step
 * between the themes — so the band and the rail read as the same surface in both.
 *
 * ONE PER PAGE, IN THE HEADER, AND NOWHERE ELSE. The reason these work is that they are rare;
 * three on a queue is wallpaper. The cluster sits in the band's right half, which is dead
 * space on these pages, and the band reserves that half in padding so a control in it (the
 * admin's date range) is laid out beside the objects rather than underneath them.
 */

/**
 * THE ARRANGEMENTS.
 *
 * Positions are percentages of the BAND, not of a slot, because a dragged object does not
 * stay in its slot — the constraint is the whole band. `h` is a percentage of the band's
 * height, so the objects keep their relation to each other whatever the band grows to.
 *
 * These are compositions, not seven objects placed one at a time. The first attempt spaced
 * them evenly across the right third at four sizes, which is the arrangement with no idea in
 * it: even spacing reads as scatter, because nothing in it is a decision the eye can follow.
 * Each of these has one rule instead — a line, a curve, a mass, a gap, a climb — and the
 * sizes serve that rule rather than varying for the sake of it.
 *
 * A few objects are cropped by the right edge on purpose: an object that ends before the
 * frame does reads as a sticker, and one that runs off it reads as a thing that carried on.
 */
type BandSlot = { x: number; y: number; h: number; dur: number; delay: number }
type BandObject = BandSlot & { src: string }

const STAR = "/ploy/obj-star.webp"
const CLOUD = "/ploy/obj-cloud.webp"
const CUBE = "/ploy/obj-green.webp"
const CHROME = "/ploy/obj-chrome.webp"

/**
 * WHAT the objects are, held apart from WHERE they sit.
 *
 * An arrangement is six positions and six sizes; a set is what fills them. Keeping the two
 * separate is the difference between "try the balloons in an arc" being a one-word change and
 * being six lines of coordinates retyped — and it is the same reason the arrangements are
 * named at all.
 *
 * Order matters inside a set: position 1 is the biggest slot in most arrangements, so a set
 * leads with whatever can carry it. A set shorter than the arrangement repeats, which is on
 * purpose — two clouds at different sizes read as two clouds, not as a shortage.
 */
export const SETS: Record<string, string[]> = {
  /** The inflated abstract family. Loud, brand-coloured, reads at any size. */
  balloons: [STAR, CLOUD, CUBE, CHROME, CLOUD, STAR],
  /** The name, inflated — E G F U L. The one set that says something. */
  letters: ["/ploy/letter-e.webp", "/ploy/letter-g.webp", "/ploy/letter-f.webp",
            "/ploy/letter-u.webp", "/ploy/letter-l.webp"],
  /** What we actually make: real blanks, shot on the seamless and cut off it (tools/cut-blank.py).
   *  Quiet, and the only set that is a photograph of a product rather than a render. */
  blanks: ["/ploy/cut/cap.webp", "/ploy/cut/bag.webp", "/ploy/cut/beanie.webp"],
  /** A garment in the balloon language, with the abstract family around it. */
  mixed: ["/ploy/obj-hoodie.webp", CLOUD, STAR, CHROME, CUBE, CLOUD],
}

export const DEFAULT_SET = "balloons"

export const LAYOUTS: Record<string, BandSlot[]> = {
  /** SHELF — every object standing on one line. The sizes do the varying, not the baseline. */
  shelf: [
    { x: 60.0, y: 34, h: 62, dur: 5.2, delay: -0.5 },
    { x: 67.0, y: 44, h: 52, dur: 6.4, delay: -3.0 },
    { x: 75.0, y: 22, h: 74, dur: 4.6, delay: -1.8 },
    { x: 82.0, y: 50, h: 46, dur: 5.8, delay: -4.2 },
    { x: 86.5, y: 16, h: 80, dur: 4.9, delay: -2.2 },
    { x: 95.5, y: 38, h: 58, dur: 4.9, delay: -5.5 },
  ],
  /** ARC — a curve lifting toward the edge, the last of it already out of the frame. */
  arc: [
    { x: 60.0, y: 54, h: 42, dur: 5.8, delay: -4.2 },
    { x: 65.5, y: 36, h: 56, dur: 5.2, delay: -0.5 },
    { x: 72.0, y: 20, h: 64, dur: 6.4, delay: -3.0 },
    { x: 81.0, y: 6,  h: 70, dur: 4.6, delay: -1.8 },
    { x: 87.5, y: -10, h: 76, dur: 4.9, delay: -2.2 },
    { x: 96.0, y: -22, h: 58, dur: 4.9, delay: -5.5 },
  ],
  /** BUNCH — one mass in the corner, overlapping, the way balloons are actually held. */
  bunch: [
    { x: 75.0, y: 18, h: 72, dur: 6.4, delay: -3.0 },
    { x: 82.5, y: -6, h: 60, dur: 5.2, delay: -0.5 },
    { x: 81.5, y: 46, h: 56, dur: 4.6, delay: -1.8 },
    { x: 88.0, y: 38, h: 44, dur: 5.8, delay: -4.2 },
    { x: 89.5, y: 2,  h: 66, dur: 4.9, delay: -2.2 },
    { x: 95.5, y: 48, h: 50, dur: 4.9, delay: -5.5 },
  ],
  /** PAIRS — a trio and a pair with real air between them. Rhythm instead of a queue. */
  pairs: [
    { x: 61.0, y: 30, h: 58, dur: 5.2, delay: -0.5 },
    { x: 67.0, y: 10, h: 62, dur: 6.4, delay: -3.0 },
    { x: 69.5, y: 52, h: 40, dur: 5.8, delay: -4.2 },
    { x: 85.0, y: 20, h: 60, dur: 4.6, delay: -1.8 },
    { x: 90.5, y: 0,  h: 70, dur: 4.9, delay: -2.2 },
    { x: 94.0, y: 48, h: 46, dur: 4.9, delay: -5.5 },
  ],
  /** HERO — one object big enough to be the subject, three small ones in orbit. */
  hero: [
    { x: 71.0, y: -4, h: 106, dur: 6.4, delay: -3.0 },
    { x: 63.0, y: 40, h: 50, dur: 5.2, delay: -0.5 },
    { x: 88.5, y: 6,  h: 46, dur: 4.6, delay: -1.8 },
    { x: 92.5, y: 52, h: 38, dur: 5.8, delay: -4.2 },
  ],
  /** WORD — for a set that spells something: one size, even spacing, and only enough vertical
   *  play to keep it from looking typeset. A word whose letters are six different heights is
   *  a ransom note. */
  word: [
    { x: 60.0, y: 26, h: 56, dur: 5.2, delay: -0.5 },
    { x: 67.5, y: 34, h: 56, dur: 6.4, delay: -3.0 },
    { x: 75.0, y: 24, h: 56, dur: 4.6, delay: -1.8 },
    { x: 82.5, y: 33, h: 56, dur: 5.8, delay: -4.2 },
    { x: 90.0, y: 25, h: 56, dur: 4.9, delay: -2.2 },
    { x: 97.0, y: 34, h: 56, dur: 6.1, delay: -5.5 },
  ],
  /** SCATTER — what shipped first, at the same weight, so a comparison is a comparison. */
  scatter: [
    { x: 59.0, y: 8,  h: 60, dur: 5.2, delay: -0.5 },
    { x: 65.5, y: 40, h: 54, dur: 6.4, delay: -3.0 },
    { x: 72.5, y: 0,  h: 48, dur: 4.6, delay: -1.8 },
    { x: 78.0, y: 48, h: 44, dur: 5.8, delay: -4.2 },
    { x: 83.5, y: 4,  h: 68, dur: 4.9, delay: -2.2 },
    { x: 91.0, y: 42, h: 52, dur: 4.9, delay: -5.5 },
    { x: 94.5, y: -4, h: 54, dur: 6.1, delay: -0.9 },
  ],
}

/** The arrangement every band uses unless it is being compared against another. */
export const DEFAULT_LAYOUT = "shelf"

/**
 * One object: a draggable FRAME with a floating PICTURE inside it.
 *
 * The two halves are not decoration — they are the fix for the one motion bug this codebase
 * has already paid for. Drag writes `x`/`y` on the element it is attached to, and so does a
 * bob loop; give both to one element and they fight over the same transform, which is how an
 * animated thing ends up never appearing at all. So the outer div owns the DRAG and the inner
 * image owns the BOB, and neither can touch the other's property.
 */
function FloatingObject({
  o,
  bounds,
}: {
  o: BandObject
  bounds: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <motion.div
      drag
      dragConstraints={bounds}
      /* Elastic rather than hard: an object hauled past the edge should resist and come back,
         not stop dead against an invisible wall. */
      dragElastic={0.28}
      dragTransition={{ bounceStiffness: 260, bounceDamping: 26 }}
      whileDrag={{ scale: 1.08, zIndex: 1 }}
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      /* pointer-events-auto against the layer's `none`: the objects are grabbable, the space
         between them is not, so a click anywhere else in the band still reaches the band. */
      className="eg-band-object pointer-events-auto absolute cursor-grab touch-none active:cursor-grabbing"
      style={{ left: `${o.x}%`, top: `${o.y}%`, height: `${o.h}%` }}
    >
      {/* The drift is CSS (see globals.css, .eg-band-float) and it stops while the pointer is
          on this object — reaching for a thing is what selects it, so nothing else has to say
          so. next/image would gain nothing on a fixed-size decorative asset.
          eslint-disable-next-line @next/next/no-img-element */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={o.src}
        alt=""
        aria-hidden
        draggable={false}
        className="eg-band-float h-full w-auto max-w-none select-none drop-shadow-[0_10px_16px_rgba(0,0,0,0.32)]"
        style={{ "--float-dur": `${o.dur}s`, "--float-delay": `${o.delay}s` } as React.CSSProperties}
      />
    </motion.div>
  )
}

export function PageBand({
  title,
  sub,
  children,
  layout = DEFAULT_LAYOUT,
  set = DEFAULT_SET,
}: {
  title: ReactNode
  sub?: ReactNode
  /** Controls that belong in the band — they sit left of the cluster, never under it. */
  children?: ReactNode
  /** Which arrangement of the objects. Only /lab/band passes this; every real band takes
   *  the default, because the whole point of one figure per page is that it is the same one. */
  layout?: keyof typeof LAYOUTS
  /** Which objects fill the arrangement. Same rule as `layout`: only /lab/band passes it. */
  set?: keyof typeof SETS
}) {
  const band = useRef<HTMLDivElement>(null)
  /*
   * A SHORT SET TAKES FEWER SLOTS — it does not wrap.
   *
   * Cycling `i % srcs.length` put a sixth object into a five-letter set and the band spelled
   * EGFULE. A set is not always an unordered bag of shapes: `letters` is a WORD, and a word
   * that repeats its first character is not a decoration, it is a spelling mistake on every
   * page of the app. Three blanks in a six-slot arrangement is a sparser band; a misspelt
   * brand name is a defect.
   */
  const objects = SETS[set] ?? SETS[DEFAULT_SET]
  const slots = (LAYOUTS[layout] ?? LAYOUTS[DEFAULT_LAYOUT]).slice(0, objects.length)

  return (
    <div
      ref={band}
      className={
        "relative isolate flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl bg-sidebar px-5 py-5 text-sidebar-foreground " +
        /* THE BAND STAYS SHORT (owner's call, 2026-09-09) — the height is not the knob. The
           padding is: the cluster occupies the right of the band, so the type needs the other
           58% reserved or a long Vietnamese name runs into an object. Mobile hides the
           cluster, so it reserves nothing. */
        "sm:pr-[42%]"
      }
    >
      <div className="min-w-0">
        <h1 className="font-title text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-sidebar-foreground/60">{sub}</p>}
      </div>
      {children}

      {/*
        * THE LAYER IS THE WHOLE BAND, not the right 40%.
        *
        * It used to be a 40% block because it held a picture with its own edges. A dragged
        * object has no such limit — the constraint is the band — so the layer has to be the
        * band too, or the objects would be clipped at an invisible seam two-fifths in.
        *
        * -z-10 under `isolate`: the objects are BEHIND the type. Haul one across the title
        * and it slides under the words rather than over them, which is the difference between
        * a toy in the header and a bug covering the page name.
        */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 hidden select-none sm:block"
      >
        {slots.map((slot, i) => (
          <FloatingObject key={i} o={{ ...slot, src: objects[i] }} bounds={band} />
        ))}
      </div>
    </div>
  )
}
