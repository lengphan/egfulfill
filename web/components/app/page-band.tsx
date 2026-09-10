"use client"

import { useRef, type ReactNode } from "react"
import { motion } from "motion/react"
import { BandChrome } from "@/components/app/band-chrome"
import { BandVideo } from "@/components/app/band-video"
import { BandWeb } from "@/components/app/band-web"
import { BandArray } from "@/components/app/band-array"
import { BandLiquid } from "@/components/app/band-liquid"
import { BandAura } from "@/components/app/band-aura"

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

/** The family, one framing each — see tools/import-objects.py. */
const O = (n: string) => `/ploy/obj/${n}.webp`

/**
 * WHAT the objects are, held apart from WHERE they sit and HOW they move.
 *
 * An arrangement is five positions and five sizes; a set is what fills them; a motion is what
 * they then do. Keeping the three separate is the difference between "try the garments in an
 * arc, orbiting" being three words and being a rewrite.
 *
 * NO OBJECT APPEARS TWICE IN A SET (owner's call). The first cut used two clouds and two
 * stars at different sizes, on the argument that they read as two objects; they do not. They
 * read as one object the page ran out of ideas for, and at band height the size difference is
 * the only thing telling them apart. Fifteen distinct shapes exist, so a repeat is a choice
 * not to use one of them.
 *
 * There is no wordmark set. Spelling the company name in balloons was tried and dropped: the
 * band already carries the name in the sidebar and the tab title, and a logo that has to be
 * reassembled out of five draggable pieces is a logo you can break.
 */
export const SETS: Record<string, string[]> = {
  /** What we make, inflated: the set that says what this company does. */
  garments: [O("tee"), O("cap"), O("beanie"), O("shorts"), O("varsity"), O("hoodie")],
  /** The abstract family — six forms, one language, nothing repeated. */
  shapes: [O("star"), O("torus"), O("squiggle"), O("cloud"), O("blob-peri"), O("blob-lime")],
  /** A garment and an abstract, alternating — the product with room around it. */
  mixed: [O("tee"), O("torus"), O("cap"), O("squiggle"), O("socks"), O("blob-lime")],
  /**
   * THE RENDERED LIQUIDS — generated, not drawn.
   *
   * The CSS pool could never get here and it was not a tuning problem: gradients merged by a
   * blur cannot produce mirror reflections, dark banding or caustics, and those ARE the
   * substance of liquid chrome. These are renders (Higgsfield nano_banana_pro, backgrounds
   * removed with Recraft) at the family's standard framing, so they drop into the same
   * arrangements, the same drift and the same pointer repulsion as everything else.
   *
   * ONE OR TWO OBJECTS, NOT FIVE. A form this detailed is a subject, and five subjects in a
   * 90px stripe is a crowd — every reference for this look puts ONE on the canvas.
   */
  /* ONE BLOWN-UP BALLOON, big enough that the band crops it — the figure you can grab and
     throw about. Sized past the band's height on purpose: a form contained politely inside a
     90px stripe reads as an icon, and this is meant to be an object in the space. */
  balloon: [O("balloon-chrome")],
  balloonperi: [O("balloon-peri")],
  chrome: [O("liquid-chrome")],
  pearl: [O("liquid-pearl")],
  liquid: [O("liquid-chrome"), O("liquid-pearl")],
  /** Real blanks, photographed and cut off the studio sweep (tools/cut-blank.py). The quiet
   *  option, and the only set that is a product rather than a render. */
  blanks: ["/ploy/cut/cap.webp", "/ploy/cut/bag.webp", "/ploy/cut/beanie.webp"],
}

export const DEFAULT_SET = "balloon"

/**
 * THE ARRANGEMENTS.
 *
 * Positions are percentages of the BAND, not of a slot, because a dragged object does not
 * stay in its slot — the constraint is the whole band. `h` is a percentage of the band's
 * height, so the objects keep their relation to each other whatever the band grows to.
 *
 * These are compositions, not objects placed one at a time. The first attempt spaced them
 * evenly at four sizes across the right third, which is the arrangement with no idea in it:
 * even spacing reads as scatter because nothing in it is a decision the eye can follow. Each
 * of these has one rule — a line, a curve, a mass, a gap, a climb — and where the sizes vary,
 * they vary to serve that rule.
 *
 * FEWER SLOTS THAN THE SET IS FINE. `slots.slice(0, objects.length)` caps a long set to the
 * arrangement, and a short set to itself; nothing wraps, nothing repeats.
 */
type BandSlot = { x: number; y: number; h: number }
type BandObject = BandSlot & { src: string; swim: SwimPath }

export const LAYOUTS: Record<string, BandSlot[]> = {
  /** EVEN — one size for every object, evenly spaced (owner's call). Sized to sit INSIDE the
   *  band: 91% of its height, sat 5% down. That is as large as they go AND STILL SWIM — at
   *  98% they fitted the band exactly at rest, so the first 12px of the vertical drift put
   *  their shoulders through the top edge. The size has to leave room for the motion, or the
   *  motion crops the thing it is moving — a garment cropped by the band is not a bigger garment, it is a broken one.
   *  The objects sit on a SQUARE canvas (tools/import-objects.py), so a wide one like the cap
   *  fills that square's width and leaves air above and below; that is the shape of the cap,
   *  not the box being too small. Five rather than six,
   *  because six at this size have to overlap to fit and a row of garments piled on each
   *  other is a rack, not a set. */
  even: [
    { x: 58.5, y: 5, h: 91 },
    { x: 67.5, y: 5, h: 91 },
    { x: 76.5, y: 5, h: 91 },
    { x: 85.5, y: 5, h: 91 },
    { x: 92.0, y: 5, h: 91 },
  ],
  /** SHELF — every object standing on one line. Here the sizes do the varying. */
  shelf: [
    { x: 60.0, y: 34, h: 62 },
    { x: 67.0, y: 44, h: 52 },
    { x: 75.0, y: 22, h: 74 },
    { x: 82.0, y: 50, h: 46 },
    { x: 86.5, y: 16, h: 80 },
    { x: 95.5, y: 38, h: 58 },
  ],
  /** ARC — a curve lifting toward the edge, the last of it already out of the frame. */
  arc: [
    { x: 60.0, y: 54, h: 42 },
    { x: 65.5, y: 36, h: 56 },
    { x: 72.0, y: 20, h: 64 },
    { x: 81.0, y: 6, h: 70 },
    { x: 87.5, y: -10, h: 76 },
    { x: 96.0, y: -22, h: 58 },
  ],
  /** BUNCH — one mass in the corner, overlapping, the way balloons are actually held. */
  bunch: [
    { x: 75.0, y: 18, h: 72 },
    { x: 82.5, y: -6, h: 60 },
    { x: 81.5, y: 46, h: 56 },
    { x: 88.0, y: 38, h: 44 },
    { x: 89.5, y: 2, h: 66 },
    { x: 95.5, y: 48, h: 50 },
  ],
  /** PAIRS — a trio and a pair with real air between them. Rhythm instead of a queue. */
  pairs: [
    { x: 61.0, y: 30, h: 58 },
    { x: 67.0, y: 10, h: 62 },
    { x: 69.5, y: 52, h: 40 },
    { x: 85.0, y: 20, h: 60 },
    { x: 90.5, y: 0, h: 70 },
    { x: 94.0, y: 48, h: 46 },
  ],
  /** SUBJECT — for the rendered liquids. One form big enough that the band CROPS it, which is
   *  what makes a render read as a thing in a space rather than an icon dropped on a bar; a
   *  second, smaller one sits back and left so there is depth rather than a mascot. Sized well
   *  past 100% on purpose: a detailed object contained politely inside a 90px stripe just
   *  looks small. */
  subject: [
    { x: 76, y: -58, h: 216 },
    { x: 62, y: 2, h: 96 },
  ],
  /** HERO — one object big enough to be the subject, three small ones in orbit. */
  hero: [
    { x: 71.0, y: -4, h: 106 },
    { x: 63.0, y: 40, h: 50 },
    { x: 88.5, y: 6, h: 46 },
    { x: 92.5, y: 52, h: 38 },
  ],
}

/** The arrangement every band uses unless it is being compared against another. */
export const DEFAULT_LAYOUT = "subject"

/**
 * HOW THE OBJECTS MOVE. Each is a pair of CSS rules in globals.css.
 *
 *   swim      two axes on unequal periods — suspended in water, never repeating
 *   bob       one axis, in place, out of phase
 *   orbit     a true circle, the picture counter-rotating so it never tips
 *   sway      a pendulum hung from the top edge, the way a garment on a rail moves
 *   breathe   inflating and letting go, no travel at all
 */
export const MOTIONS = ["swim", "bob", "orbit", "sway", "breathe"] as const
export const DEFAULT_MOTION = "swim"

/**
 * WHAT OCCUPIES THE BAND'S EMPTY HALF.
 *
 *   pool     liquid chrome and lime in a few large lobes
 *   beads    the same liquid at a finer grain — many small drops
 *   objects  the garment family, floating and draggable
 *   field    a rim-lit array of soft modules with a diagonal wave through it
 *   chromefield  a raymarched field of liquid chrome. Built, and rejected on sight: the
 *                procedural environment renders muddy brown at band size and the forms read
 *                small and cheap next to the generated stills. Kept behind the prop, not the
 *                default — a live shader is only worth it if it beats a picture, and it does
 *                not yet.
 *   pool     liquid chrome and lime in CSS — superseded by chromefield
 *
 * The two abstract ones exist because five objects at arm's length from each other read as
 * five items and a lot of gap, however they were sized, spaced or moved — the eye reads the
 * distance between things. A field and a pool are each ONE body: one composition, one motion,
 * and the whole half of the band is used rather than dotted.
 */
export const FIGURES = ["video", "web", "chromefield", "pool", "beads", "objects", "field", "aura"] as const
export const DEFAULT_FIGURE = "video"

/**
 * HOW ONE OBJECT SWIMS — an X period, a Y period, and how far it goes on each.
 *
 * `sx` is in `cqw`, a percentage of the BAND, so an object crosses the stripe rather than
 * fidgeting around its own spot; `sy` is a percentage of the OBJECT, because the band has no
 * vertical room to give and a fish crossing a tank barely changes depth.
 *
 * THE SIGNS ARE CHOSEN AGAINST EACH SLOT'S POSITION, not alternated for variety. The two
 * objects nearest the type swim RIGHT and the three beyond them swim LEFT, so they cross
 * through each other in the empty half and nothing ever heads for the greeting: slot 1 at
 * 58.5% + 30cqw lands at 88.5%, slot 5 at 92% − 34cqw lands at 58%. The shoal breathes about
 * the middle of the stripe instead of migrating to an edge.
 *
 * The two periods are never a simple ratio of each other. 2:1 or 3:2 closes the figure
 * quickly and visibly; 17 against 11 takes 187 seconds to repeat, which is longer than
 * anyone looks at a header. That is the whole difference between a wander and a bounce, and
 * the previous version — one track carrying both axes — could only ever be the second.
 *
 * The SIGNS alternate down the row. An object on the left swims right, one on the right
 * swims left, so the cluster breathes about its own centre instead of migrating toward one
 * edge — and nothing ever heads for the greeting.
 */
type SwimPath = { sx: string; sy: string; r: string; dx: number; dy: number; ex: number; ey: number }
/**
 * A BIG SUBJECT BARELY MOVES, and it must not use the paths above.
 *
 * The swim travels ~30cqw — a third of the band — which is right for a shoal of small objects
 * and catastrophic for one large one: the rendered chrome spent half its cycle entirely past
 * the right edge, so the band looked EMPTY at random and full at random, which reads as a
 * broken image rather than as motion. Mass should move less, not more.
 */
const SWIM_CALM: SwimPath[] = [
  { sx: "4cqw", sy: "-7%", r: "2.5deg", dx: 14, dy: 9, ex: -2, ey: -5 },
  { sx: "-6cqw", sy: "-10%", r: "-3deg", dx: 11, dy: 7.5, ex: -6, ey: -1 },
]

const SWIM: SwimPath[] = [
  { sx: "30cqw", sy: "-9%", r: "6deg", dx: 9.0, dy: 5.0, ex: -3, ey: -4 },
  { sx: "23cqw", sy: "-11%", r: "-5deg", dx: 11.0, dy: 6.5, ex: -7, ey: -1.5 },
  { sx: "-19cqw", sy: "-8%", r: "7deg", dx: 8.0, dy: 4.5, ex: -5, ey: -6 },
  { sx: "-27cqw", sy: "-10%", r: "-6deg", dx: 10.0, dy: 5.5, ex: -9, ey: -3 },
  { sx: "-34cqw", sy: "-9%", r: "5deg", dx: 12.0, dy: 7.0, ex: -1, ey: -5 },
]

/**
 * One object: a draggable FRAME, a span that carries one axis, a picture that carries the
 * other. See the note inside for why it is three elements and not one.
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
      style={{ left: `${o.x}%`, top: `${o.y}%`, height: `${o.h}%`, aspectRatio: "1 / 1" }}
    >
      {/*
        * THREE ELEMENTS, ONE PER PROPERTY. The frame drags (motion writes x/y), this span
        * carries one axis of the ambient motion, the picture carries the other. §4's rule
        * that no element may own the same property twice is why they cannot be collapsed —
        * and it is also what makes the two axes run on different clocks, which is the whole
        * difference between drifting and bouncing.
        */}
      <span
        className="eg-band-swim block size-full"
        style={{
          "--swim-x": o.swim.sx,
          "--swim-x-dur": `${o.swim.dx}s`,
          "--swim-x-delay": `${o.swim.ex}s`,
        } as React.CSSProperties}
      >
        {/* The ambient motion is CSS (globals.css) and it stops while the pointer is on this
            object — reaching for a thing is what selects it, so nothing else has to say so.
            next/image would gain nothing on a fixed-size decorative asset. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={o.src}
          alt=""
          aria-hidden
          draggable={false}
          className="eg-band-float size-full select-none object-contain drop-shadow-[0_10px_16px_rgba(0,0,0,0.32)]"
          style={{
            "--swim-y": o.swim.sy,
            "--swim-r": o.swim.r,
            "--swim-y-dur": `${o.swim.dy}s`,
            "--swim-y-delay": `${o.swim.ey}s`,
          } as React.CSSProperties}
        />
      </span>
    </motion.div>
  )
}

export function PageBand({
  title,
  sub,
  children,
  layout = DEFAULT_LAYOUT,
  set = DEFAULT_SET,
  motionStyle = DEFAULT_MOTION,
  figure = DEFAULT_FIGURE,
  webSrc,
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
  /** How the objects move. Same rule again — the app takes the default. */
  motionStyle?: (typeof MOTIONS)[number]
  /** What fills the empty half: the objects, or one of the two abstract figures. */
  figure?: (typeof FIGURES)[number]
  /** Which chrome web render, when `figure` is "web". Only the lab passes this. */
  webSrc?: string
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
  /* One large form gets the calm paths; a field of small ones gets the wide ones. */
  const paths = layout === "subject" ? SWIM_CALM : SWIM

  return (
    <div
      ref={band}
      className={
        "relative isolate flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl px-5 py-5 " +
        /* The pale liquid-glass figure turns the band into a light surface, so the type has to
           invert with it — white on that material measures as invisible, not merely weak. */
        (figure === "video" ? "bg-[#dfe3f2] text-[#171826] " : "bg-sidebar text-sidebar-foreground ") +
        /* THE BAND STAYS SHORT (owner's call, 2026-09-09) — the height is not the knob. The
           padding is: the cluster occupies the right of the band, so the type needs the other
           58% reserved or a long Vietnamese name runs into an object. Mobile hides the
           cluster, so it reserves nothing. */
        "sm:pr-[42%]"
      }
    >
      <div className="min-w-0">
        <h1 className="font-title text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
        {sub && <p className={"text-sm " + (figure === "video" ? "text-[#171826]/70" : "text-sidebar-foreground/60")}>{sub}</p>}
      </div>
      {children}

      {figure === "video" ? <BandVideo /> : figure === "web" ? <BandWeb src={webSrc} /> : figure === "chromefield" ? <BandChrome /> : figure === "field" ? <BandArray /> : figure === "pool" ? <BandLiquid /> : figure === "beads" ? <BandLiquid dense /> : figure === "aura" ? <BandAura /> : (
      /*
        * THE LAYER IS THE WHOLE BAND, not the right 40%.
        *
        * It used to be a 40% block because it held a picture with its own edges. A dragged
        * object has no such limit — the constraint is the band — so the layer has to be the
        * band too, or the objects would be clipped at an invisible seam two-fifths in.
        *
        * -z-10 under `isolate`: the objects are BEHIND the type. Haul one across the title
        * and it slides under the words rather than over them, which is the difference between
        * a toy in the header and a bug covering the page name.
        */
      <div
        aria-hidden
        data-motion={motionStyle}
        className="pointer-events-none absolute inset-0 -z-10 hidden select-none sm:block"
      >
        {slots.map((slot, i) => (
          <FloatingObject key={i} o={{ ...slot, src: objects[i], swim: paths[i % paths.length] }} bounds={band} />
        ))}
      </div>
      )}
    </div>
  )
}
