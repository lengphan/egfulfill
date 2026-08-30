"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { ACCENT, ACCENT_INK, ACID, CARD, HAIRLINE, INK, SURFACE, EASE } from "@/components/marketing/bold-kit"
import { EditableText } from "@/components/marketing/edit-mode"
import type { FeatureCard } from "@/lib/site-content"

/**
 * ── THE FLOOR RAIL — the four capabilities as objects on a rail, not four bands of prose ──
 *
 * WHAT THIS REPLACED, and why it had to go. The four capabilities rendered as alternating
 * text/window Bands: four blocks of similar length, each a heading over a paragraph over a
 * screenshot, stacked. The code comment beside it said the quiet part out loud — "four boxes
 * of similar length that the eye skims and forgets, and which say nothing a competitor could
 * not also write". That is an accurate description of a section that is not working, and it
 * survived several passes because each pass repainted it instead of changing what it IS.
 *
 * THE DIRECTION. Studied against phantom.com, measured off the live site rather than
 * remembered: the page ground is never white, every section is a CARD THAT IS A FILL — one
 * radius, no border, no shadow, the ground showing through as the gutter — and the media
 * lives INSIDE the card, bleeding to its radius, rather than floating on the page as a
 * screenshot with a drop shadow. Twenty-six muted looping videos, `autoplay:false`, played
 * programmatically when their card comes into view.
 *
 * WHERE WE DELIBERATELY DIVERGE, and this is the whole identity rather than a detail:
 *
 *   PHANTOM RENDERS. WE PHOTOGRAPH.
 *
 * A wallet has no physical object, so Phantom invented one — soft-body 3D ghosts, coins,
 * clouds — and then obeyed it on every surface. We make actual garments on actual machines,
 * so the thing inside our cards is a REAL capture of the real app and REAL footage of the
 * real floor. Nothing here is a render and nothing is a mockup. That is why this cannot be
 * called a copy of the reference: it is the same grammar carrying the opposite content, and
 * the opposite content is the one we happen to own.
 *
 * NOT SCROLL FOR NOTHING. Every card the rail advances to states a different fact and shows
 * a different real screen. The motion is not the point — it is what makes four facts read as
 * one floor with an order moving across it, rather than four boxes. Specifically:
 *
 *   · the media PARALLAXES against its card as the card crosses the viewport centre, which
 *     is what makes the card read as a window onto something rather than a picture stuck to
 *     a coloured rectangle. It is one transform written straight to the node — see below.
 *   · a card carrying film plays only while it is on screen and pauses when it leaves.
 *   · the counter and the arrows track the rail, so the section says how much is left.
 *
 * All of it is skipped under `prefers-reduced-motion`: the rail is still a rail, it still
 * snaps, the arrows still work, and film does not start itself. §4 — motion is opt-out.
 *
 * §2.8 — NOTHING HERE FETCHES. The scroll handler and the IntersectionObserver both only
 * ever read layout and write a transform or call play/pause. No effect in this file can
 * cause a request, so there is no condition a fetch's own result could re-satisfy. The
 * observer is bounded by the card count, which is the array it was handed.
 */

/** The house radius, and it is the SAME 26px the rest of the site already uses — reused
 *  rather than re-picked, because a second radius is how a house style becomes two. */
const R = "rounded-[26px]"

/**
 * HOW FAR THE MEDIA TRAVELS AGAINST ITS CARD, and the overscale that hides the travel.
 *
 * THESE TWO ARE NOT INDEPENDENT, and getting that wrong was a real defect here. Scaling by
 * S gives the media (S-1)/2 of its width as headroom on EACH side; travel beyond that slides
 * the media's own edge into the well and the parallax reveals the ground it sits on, which is
 * the one thing a parallax must never do. At a 416px card, 1.08 buys 16.6px and the travel
 * was 26 — so the first build shipped a 9px sliver at the extremes.
 *
 * Now the headroom is asserted rather than assumed: 1.06 buys 12px against a travel of 7, so
 * there is room to spare at every card width the rail is used at. Keep TRAVEL well under
 * (SCALE - 1) / 2 × the narrowest card if either is touched.
 *
 * THE OVERSCALE IS ALSO A CROP, which is the second reason it is this low. Everything the
 * scale buys as headroom it takes off the sides of the capture — at 1.12 that was 6% a side
 * and it was cutting the first letter off the app's own headings. These are wide captures
 * shown at card width; there is nothing spare to lose.
 *
 * 7px is enough. Parallax reads as depth up to about 30px and as a sliding bug past it, and
 * the small figure is the one that reads as a window rather than as an effect.
 */
const TRAVEL = 7
const SCALE = 1.06

/**
 * ALTERNATING FILLS — the slate plate, then the periwinkle.
 *
 * THE PALE CARD IS NOT WHITE, and that correction is the whole reason this section reads.
 * The first build alternated ACCENT with CARD, and `--mk-card` is #FFFFFF: an app capture is
 * also mostly white, so on every other card the media and the card it sat in were the same
 * colour and the well vanished. No amount of insetting or radius fixes two identical whites.
 *
 * The reference has the same structure and does not have the problem, because ITS pale card
 * is lavender — the card is a COLOUR and the screen inside it is dark, so each frames the
 * other. ACID is our equivalent and it is already the vetted one: §4 pins it as a fill that
 * ink sits on at 11.22:1, and it is explicitly never type. A card is the largest fill on the
 * page, so this is the token being used for exactly what it is for.
 *
 * The 1.03:1 figure recorded against ACID is ink-on-page and is about LETTERING. A periwinkle
 * block on the near-white ground separates by hue rather than by luminance, which is what the
 * gutter is for and what the reference relies on.
 *
 * Both values come from the kit, so a skin change carries the rail and no colour is written
 * in this file.
 */
const FILLS = [
  { bg: ACCENT, ink: ACCENT_INK, dark: true },
  { bg: ACID, ink: INK, dark: false },
] as const

function isFilm(src: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(src)
}

export function FloorRail({ cards }: { cards: FeatureCard[] }) {
  const reduce = useReducedMotion()
  const railRef = useRef<HTMLDivElement>(null)
  const mediaRefs = useRef<(HTMLDivElement | null)[]>([])
  const filmRefs = useRef<(HTMLVideoElement | null)[]>([])
  const progressRef = useRef<HTMLSpanElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const items = cards.slice(0, 4)

  /**
   * ONE HANDLER, rAF-coalesced, that both tracks the rail and writes the parallax.
   *
   * The transform is written STRAIGHT TO THE NODE rather than held in React state. A
   * scroll-linked value in state re-renders the whole section on every frame of a drag,
   * which is the difference between this being smooth and this being the reason the page
   * feels heavy. Only `active` and the two end flags go through state, and those change a
   * handful of times per rail rather than per frame.
   */
  const sync = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const { left, width } = rail.getBoundingClientRect()
    const mid = left + width / 2

    /* PROGRESS IS A RULE, NOT A COUNTER — and it took three wrong answers to arrive at that,
       each one exposed by a boundary the one before it had not been tested at.

       A counter reading the card nearest the CENTRE said "02 — 04" at rest, before anyone had
       touched the rail, because a start-snapped rail showing two-and-a-bit cards has its
       SECOND card in the middle. Reading the card at the LEADING EDGE fixed that end and broke
       the other: the rail only scrolls about 600px, so cards three and four never reach the
       lead and it still read "02" at maximum scroll. Deriving the index from scroll progress
       was honest at both ends and wrong in between — one press of an arrow moves the rail by
       one card but 70% of its total travel, so the counter jumped 01 to 03 on a single click.

       None of those is a bug in the arithmetic. They are the same category error three times:
       at this width most of the set is ALREADY ON SCREEN, so "which card am I on" has no
       answer, and every integer the label could show is wrong somewhere. A rule has no such
       problem — it is continuous, it is exact at both ends, and it claims nothing it cannot
       deliver.

       It is written STRAIGHT TO THE NODE like the parallax, so the rail no longer sets React
       state on any frame of a scroll: only the two arrow flags remain, and those change a
       handful of times per rail rather than per frame.

       The parallax still keys off the centre. That one genuinely is about geometry — depth is
       measured from where the eye is. */
    const span = rail.scrollWidth - rail.clientWidth
    const progress = span > 0 ? Math.min(1, Math.max(0, rail.scrollLeft / span)) : 1
    if (progressRef.current) {
      progressRef.current.style.transform = `scaleX(${progress.toFixed(4)})`
    }

    mediaRefs.current.forEach((node) => {
      const card = node?.closest("article")
      if (!card) return
      const box = card.getBoundingClientRect()
      const centre = box.left + box.width / 2
      const dist = centre - mid
      if (node && !reduce) {
        // Normalised to [-1, 1] across one viewport width, so the travel is the same on a
        // laptop and an ultrawide instead of being a fraction of whatever fits.
        const t = Math.max(-1, Math.min(1, dist / width))
        node.style.transform = `translate3d(${(-t * TRAVEL).toFixed(2)}px,0,0) scale(${SCALE})`
      }
    })

    setAtStart(rail.scrollLeft <= 2)
    setAtEnd(rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2)
  }, [reduce])

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        sync()
      })
    }
    sync()
    rail.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      rail.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [sync])

  /**
   * FILM PLAYS ONLY WHILE IT IS ON SCREEN — the reference's exact behaviour, and the reason
   * its videos carry `autoplay:false`. A rail of autoplaying films decodes all of them at
   * once for the sake of the one you are looking at.
   *
   * Under reduced motion nothing is observed and nothing plays: the poster frame stands,
   * which is a still picture of the real floor and therefore still true.
   */
  useEffect(() => {
    if (reduce) return
    const films = filmRefs.current.filter(Boolean) as HTMLVideoElement[]
    if (!films.length) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement
          if (e.isIntersecting) {
            // A rejected play() is normal — a tab in the background refuses, and that is not
            // an error worth surfacing. Swallowed rather than left to become an unhandled
            // rejection in the console.
            void v.play().catch(() => {})
          } else {
            v.pause()
          }
        }
      },
      { threshold: 0.5 },
    )
    films.forEach((v) => io.observe(v))
    return () => io.disconnect()
  }, [reduce])

  /** A CLICK, never an effect. §2.8 — incremental movement through a list is an event. */
  const step = useCallback((dir: 1 | -1) => {
    const rail = railRef.current
    if (!rail) return
    const first = rail.firstElementChild as HTMLElement | null
    const by = first ? first.getBoundingClientRect().width + 20 : rail.clientWidth * 0.8
    rail.scrollBy({ left: dir * by, behavior: reduce ? "auto" : "smooth" })
  }, [reduce])

  if (!items.length) return null

  return (
    <section className="py-16 sm:py-24">
      {/* THE STICKY HEAD — the rule says how much rail is left, the arrows move it. No label
          and no sentence: the cards carry the words, and a line of prose over a control is the
          defect §4 names. */}
      <div className="sticky top-[76px] z-20 mx-auto mb-8 flex max-w-[88rem] items-center justify-between px-6 sm:px-10">
        <span
          className="h-[2px] w-24 overflow-hidden rounded-full"
          style={{ background: HAIRLINE }}
          aria-hidden
        >
          <span
            ref={progressRef}
            className="block h-full w-full origin-left"
            style={{ background: INK, transform: "scaleX(0)" }}
          />
        </span>
        <div className="flex gap-2">
          <RailArrow dir={-1} disabled={atStart} onClick={() => step(-1)} />
          <RailArrow dir={1} disabled={atEnd} onClick={() => step(1)} />
        </div>
      </div>

      {/* THE RAIL. Padded by the page gutter on both ends via scroll-padding so the first
          card lands on the same left edge as every other section's type.

          THE SCROLL PADDING MUST TRACK THE PAGE PADDING AT EVERY BREAKPOINT. It was a flat
          1.5rem against a gutter that is 1.5rem below `sm` and 2.5rem above it, so at desktop
          width snap parked the rail at scrollLeft 16 and never let it reach 0 — which meant
          the "previous" arrow could not disable and the rail looked scrollable in a direction
          it could not go. Two paddings describing the same edge have to move together.

          Snap is mandatory: a rail that stops between two cards reads as broken, not free. */}
      <div
        ref={railRef}
        className="flex snap-x snap-mandatory scroll-pl-6 gap-5 overflow-x-auto overscroll-x-contain px-6 pb-4 sm:scroll-pl-10 sm:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((c, i) => {
          const fill = FILLS[i % FILLS.length]
          const src = c.shot
          return (
            <motion.article
              key={`${c.title}-${i}`}
              className={`${R} relative flex h-[clamp(30rem,64vh,40rem)] w-[min(88vw,26rem)] shrink-0 snap-start flex-col overflow-hidden`}
              style={{ background: fill.bg, color: fill.ink }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: Math.min(i, 3) * 0.06, ease: EASE }}
            >
              {/* THE NUMERAL — the one bright thing, and it is a FILL carrying ink, on the
                  plate and never on white. §4 pins ACID to exactly that. It only appears on
                  the dark cards for the same reason: on the pale card it measures 1.03:1. */}
              <div className="flex items-start justify-between p-7 pb-0">
                <h3
                  className="max-w-[13ch] font-display text-[clamp(1.6rem,2.6vw,2.05rem)] font-semibold leading-[1.03] tracking-[-0.025em]"
                >
                  <EditableText path={`features.cards.${i}.title`}>{c.title}</EditableText>
                </h3>
                {fill.dark ? (
                  <span
                    className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums"
                    style={{ background: ACID, color: INK }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                ) : null}
              </div>

              <p
                className="px-7 pt-3 text-[15px] leading-relaxed"
                style={{ opacity: 0.66 }}
              >
                <EditableText path={`features.cards.${i}.body`}>{c.body}</EditableText>
              </p>

              {/* THE MEDIA WELL — bleeds to the card's own radius at the bottom and to both
                  sides, which is the reference's single most copied move and the one that
                  stops a card reading as a screenshot pasted onto a colour.

                  NO CAPTURE MEANS NOTHING IS DRAWN. §4 and the note in site-content are
                  explicit: an empty slot must read as "no screenshot yet", never as a
                  plausible screen, so the honest answer is the card's own fill. */}
              <div className="relative mt-auto min-h-0 flex-1 px-5 pt-6">
                {src ? (
                  /* INSET AT THE SIDES, BLEEDING OFF THE BOTTOM — the reference's actual
                     geometry, and it is load-bearing rather than decorative. A capture that
                     bled on all four sides had nothing holding it: on the pale card, `--mk-card`
                     is #FFFFFF and an app screenshot is mostly white too, so the media and the
                     card it sat in were the same colour and the well simply disappeared. The
                     card's own fill running down both sides is what frames it.

                     Running off the BOTTOM is what stops it becoming a picture in a box: the
                     card's 26px radius clips it, so the screen reads as continuing past the
                     card rather than ending inside it. That is the difference between a window
                     and a thumbnail.

                     The ground is SURFACE, so where a capture does not cover the well the gap
                     reads as the page showing through a recess — never as a hole. */
                  <div
                    className="relative h-full overflow-hidden rounded-t-[16px]"
                    style={{ background: SURFACE }}
                  >
                  <div
                    ref={(n) => { mediaRefs.current[i] = n }}
                    className="absolute inset-0 will-change-transform"
                    style={{ transform: `scale(${SCALE})` }}
                  >
                    {isFilm(src) ? (
                      <video
                        ref={(n) => { filmRefs.current[i] = n }}
                        className="h-full w-full object-cover"
                        src={src}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        aria-label={c.shotAlt || c.title}
                      />
                    ) : (
                      /* The rail sizes this by CSS against a clipped, transformed well, and
                         next/image's own wrapper fights the parallax transform for ownership
                         of the node. These are already-optimised .webp captures at card
                         width, so the loader would have nothing left to do. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="h-full w-full object-cover object-left-top"
                        src={src}
                        alt={c.shotAlt || ""}
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </div>
                  </div>
                ) : null}
              </div>
            </motion.article>
          )
        })}
      </div>
    </section>
  )
}

/**
 * The rail's two controls. Round because they are genuinely round — §4 reserves
 * `rounded-full` for exactly that, and an arrow in a box is a button pretending to be a
 * field. Disabled at the ends rather than hidden, so the row does not reflow mid-scroll.
 */
function RailArrow({ dir, disabled, onClick }: { dir: 1 | -1; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 1 ? "Next" : "Previous"}
      className="grid h-10 w-10 place-items-center rounded-full transition-opacity disabled:pointer-events-none disabled:opacity-30"
      style={{ background: CARD, color: INK }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d={dir === 1 ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
