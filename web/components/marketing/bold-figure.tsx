"use client"

/**
 * THE FIGURE KIT — the devices the reference boards share, as components.
 *
 * Four boards, three studios, one recurring grammar: a subject cut out and floated on a soft
 * ground, small caps labels tied to it by hairlines, a giant ghost word behind it, numbered
 * cards alternating light and dark, and a band of figures divided by rules.
 *
 * None of that is a departure from CLAUDE.md §4 — it is ink on white, one accent, and type
 * doing the work decoration usually does. What it adds is a way to put a PRODUCT on the page.
 * Until now the only object on the marketing home was a drawing of our own app, which tells a
 * seller what our software looks like and nothing about the thing that arrives in a box.
 *
 * WHY THESE ARE COMPONENTS AND NOT FOURTEEN LINES OF TAILWIND PER PAGE: §4's own method
 * section. The underline-tab rule was violated fourteen times across twelve files purely
 * because there was nothing to import. A figure with a hairline and a caps label is exactly
 * the kind of thing that gets re-derived slightly differently on every page it appears on.
 *
 * Every one of these takes its content from stored site content, so the words and the
 * pictures are an admin edit rather than a deploy.
 */

import { motion, useReducedMotion } from "motion/react"
import { ACCENT, INK, HAIRLINE, EASE } from "@/components/marketing/bold-kit"
import type { Callout, Stat, NumberedItem } from "@/lib/site-content"

/** The caps label these boards use everywhere: small, wide, quiet. One definition, because
 *  four different letter-spacings across a page is what makes labels read as noise. */
export const CAPS = "text-[11px] font-semibold uppercase tracking-[0.18em]"

/**
 * A RULE WITH A WORD AT EACH END.
 *
 * TERRIXA runs one across the top of every board — the brand at the left, who it is for at
 * the right, a hairline between. It does the job a heading would, at a tenth of the weight,
 * and it gives a section a top edge without a box.
 *
 * `right` is optional: one label and a rule running off to the margin is the same device.
 */
export function LabelRule({ left, right, className = "" }: {
  left: string
  right?: string
  className?: string
}) {
  if (!left && !right) return null
  return (
    <div className={`flex items-center gap-4 ${className}`} style={{ color: INK }}>
      {left && <span className={`${CAPS} shrink-0 opacity-70`}>{left}</span>}
      <span className="h-px flex-1" style={{ background: HAIRLINE }} />
      {right && <span className={`${CAPS} shrink-0 text-right opacity-70`}>{right}</span>}
    </div>
  )
}

/**
 * THE GIANT GHOST WORD.
 *
 * Yodiz sets a display numeral behind the subject; TERRIXA sets the brand name. Both are
 * doing one thing — giving the picture a background that is made of TYPE rather than of a
 * photograph, which is the only way to put something behind a subject without competing
 * with it.
 *
 * It is texture, not text. `aria-hidden` because a screen reader announcing the brand name a
 * second time in the middle of a figure is noise, and the opacity is low enough that reading
 * it is a bonus rather than the point — which is also what keeps it from being a contrast
 * question. Nothing is measured against it because nothing is ON it.
 */
export function GhostWord({ children, className = "" }: { children: string; className?: string }) {
  if (!children) return null
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none text-center font-display font-semibold leading-none tracking-[-0.04em] ${className}`}
      style={{ fontSize: "clamp(4rem, 18vw, 13rem)", color: INK, opacity: 0.05 }}
    >
      {children}
    </span>
  )
}

/**
 * THE SUBJECT, CUT OUT, ON A SOFT GROUND — the device all three boards are built on.
 *
 * THIS IS WHY THE BACKDROP FIELD EXISTS. The picture has to have no background of its own,
 * or it arrives as a rectangle sitting on the page instead of an object floating above it.
 * The route to one is the Studio: generate with Backdrop set to a cut-out-ready sweep, press
 * Remove background, upload the PNG here. No stock library, no photographer, and the person
 * who wants the picture changed is the person who can change it.
 *
 * `src` empty renders NOTHING — not a placeholder, not a grey box. An unset image on a live
 * marketing page must not look like a broken one (§4), and the caller decides what stands in.
 */
export function CutoutFigure({ src, alt, ghost, callouts = [], className = "" }: {
  src: string
  /** What the picture IS. Never "hero image" — it is a garment, and the alt text is the only
   *  version of it some people get. */
  alt: string
  ghost?: string
  callouts?: Callout[]
  className?: string
}) {
  const reduce = useReducedMotion()
  if (!src) return null

  return (
    /*
     * A GRID, NOT AN ABSOLUTE OVERLAY.
     *
     * The callouts were absolutely positioned against the whole figure, which put them on top
     * of the ghost word and left a gap between the subject and the rules that pointed at it.
     * Two columns instead — subject, then labels — so the rules start where the picture ends
     * however wide the picture turns out to be, and the ghost word keeps the subject's column
     * to itself. Below lg it collapses to one column and the labels sit under the figure
     * rather than vanishing: three facts about the product are worth more on a phone than a
     * decorative arrangement is.
     */
    <div className={`grid items-center gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_auto] ${className}`}>
      <div className="relative">
        {/*
          * THE GROUND. A soft radial wash, not a filled card.
          *
          * A hard-edged panel behind a cut-out puts the object back in a box, which is the one
          * thing cutting it out was for. The wash has no edge to find, so the subject reads as
          * standing in front of the page rather than inside a frame.
          */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse 62% 58% at 50% 48%, color-mix(in oklch, ${INK} 8%, transparent), transparent 72%)` }}
        />
        {ghost && <GhostWord>{ghost}</GhostWord>}

        <motion.div
          className="relative flex items-center justify-center py-6"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-[24rem] w-auto max-w-full object-contain" />
        </motion.div>
      </div>

      {/*
        * THE CALLOUTS — a caps label, a hairline running to a dot.
        *
        * AUREL points its lines at specific joints of the arm. That precision needs the label
        * to know where the subject's shoulder IS, which nothing here can know: the picture is
        * whatever was uploaded this morning. Labels tied to the figure by rules of equal
        * length say the same thing and cannot end up pointing at empty air — which is what
        * fake precision looks like the first time the image is replaced.
        */}
      {callouts.length > 0 && (
        <div className="flex flex-col justify-center gap-7 lg:max-w-xs">
          {callouts.slice(0, 4).map((c, i) => (
            <motion.div
              key={`${c.label}-${i}`}
              className="flex items-start gap-3"
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: 18 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.35 + i * 0.1, ease: EASE }}
            >
              {/* mt-[0.4rem] lands the dot on the CAP HEIGHT of the label beside it rather
                  than on its line box, which is what makes a row of them look aligned. */}
              <span className="mt-[0.4rem] size-1.5 shrink-0 rounded-full" style={{ background: ACCENT }} />
              <span className="mt-[0.45rem] hidden h-px w-8 shrink-0 lg:block" style={{ background: HAIRLINE }} />
              <span className="min-w-0">
                <span className={`${CAPS} block`} style={{ color: INK }}>{c.label}</span>
                {c.note && <span className="mt-1 block text-xs leading-snug" style={{ color: INK, opacity: 0.55 }}>{c.note}</span>}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * THE SPEC STRIP — a band of figures divided by rules.
 *
 * AUREL's is five across under the hero: a value, what it measures, and a rule between each.
 * It is the same data a row of cards would carry, minus four borders and four shadows — and
 * that is the point, because a figure inside a box reads as a claim someone made, while a
 * figure in a band reads as a specification.
 *
 * The vertical rules are on the ITEM, not between items, so the strip wraps at any count
 * without a divider ending up dangling at the start of a row.
 */
export function SpecStrip({ items, className = "" }: { items: Stat[]; className?: string }) {
  const reduce = useReducedMotion()
  if (!items.length) return null
  return (
    <div className={`grid gap-y-8 sm:grid-cols-2 lg:grid-cols-5 ${className}`}>
      {items.slice(0, 5).map((s, i) => (
        <motion.div
          key={`${s.label}-${i}`}
          className="px-6 first:pl-0 lg:border-l lg:first:border-l-0"
          style={{ borderColor: HAIRLINE }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, delay: i * 0.07, ease: EASE }}
        >
          {/* tabular-nums so a row of figures lines up on the decimal — the thing that makes
              a strip read as a spec sheet rather than as five separate sentences. */}
          <div className="font-title text-2xl font-semibold tabular-nums tracking-tight" style={{ color: INK }}>{s.value}</div>
          <div className={`${CAPS} mt-2`} style={{ color: INK, opacity: 0.5 }}>{s.label}</div>
          {s.note && <div className="mt-1.5 text-sm leading-snug" style={{ color: INK, opacity: 0.6 }}>{s.note}</div>}
        </motion.div>
      ))}
    </div>
  )
}

/**
 * NUMBERED CARDS, ALTERNATING LIGHT AND DARK.
 *
 * TERRIXA's problem grid: 01 light, 02 dark, 03 dark, 04 light. The alternation is doing real
 * work — four identical cards read as a list you skim and forget, while a checker of light
 * and dark reads as four distinct things and gives the eye somewhere to rest between them.
 *
 * `dark` comes from the INDEX, not from the data. An admin adding a fifth item should not
 * have to know which colour keeps the pattern honest, and a stored boolean is a stored
 * mistake waiting for someone to reorder the list.
 */
export function NumberedCards({ items, className = "" }: { items: NumberedItem[]; className?: string }) {
  const reduce = useReducedMotion()
  if (!items.length) return null
  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${className}`}>
      {items.map((it, i) => {
        const dark = i % 4 === 1 || i % 4 === 2
        return (
          <motion.div
            key={`${it.title}-${i}`}
            className="rounded-2xl p-7"
            style={dark
              ? { background: ACCENT, color: "var(--mk-accent-ink)" }
              : { border: `1px solid ${HAIRLINE}`, color: INK }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, delay: i * 0.07, ease: EASE }}
          >
            {/* The numeral is the card's mark. Big, tabular, and followed by a rule, because
                a number floating above a paragraph reads as a page number. */}
            <div className="font-title text-3xl font-semibold tabular-nums tracking-tight">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="my-4 h-px" style={{ background: dark ? "rgba(255,255,255,0.18)" : HAIRLINE }} />
            <div className="text-lg font-semibold leading-snug tracking-[-0.01em]">{it.title}</div>
            {it.body && <p className="mt-2 text-sm leading-relaxed opacity-70">{it.body}</p>}
          </motion.div>
        )
      })}
    </div>
  )
}
