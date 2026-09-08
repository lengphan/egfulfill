"use client"

import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, pop, reveal, rise } from "./motion"
import { GUTTER, SECTION, STACK, TOP } from "./rhythm"
import { displayWord } from "./step-word"
import { FACTORY_STAGES } from "@/lib/factory-status"
import type { Step } from "@/lib/site-content"

/**
 * HOW IT WORKS — one band per step, each a fill, each carrying its own picture.
 *
 * IT WAS A THIN RULE AND A COLUMN OF TEXT on the page ground, which left the right half of
 * every screen empty and made the steps read as a list of sentences rather than as a process.
 * The site's grammar everywhere else is a BAND THAT IS A FILL with media inset in it — the
 * home's acid block, the methods rail, the plans — so this page uses it: alternating grounds,
 * the step's word set as large as the page allows, and a real picture opposite. Alternating
 * which SIDE the picture sits on is what stops four bands reading as one repeated slide.
 *
 * THE PICTURES ARE REAL AND EACH ANSWERS ITS OWN STEP: the channels we actually connect, the
 * methods the machines actually run, and blanks we actually keep. Nothing here is a mockup of
 * a screen — the fake app panel was deleted from the home page on purpose (§4) and must not
 * come back through another door.
 *
 * The stage names at the bottom read FACTORY_STAGES, the list the production board writes and
 * the order gate walks. A friendlier set invented for a marketing page would be a vocabulary
 * no part of the product uses.
 */

/** Alternating grounds, in the order the bands appear. */
const FILLS = ["bg-ploy-acid", "bg-ploy-sky", "bg-ploy-peri", "bg-ploy-paper"]

/** Four of the seven, because four fit a square grid; /catalog's rail carries all of them. */

/**
 * ONE PHOTOGRAPH PER STEP, shot to the same direction as everything else on the site —
 * periwinkle seamless, one soft key, blank goods, no branding.
 *
 * They are OBJECTS, not screens. A picture of our own interface would be a mockup, and §4
 * deleted the fake app panel from the home page for exactly that reason; a stack of blanks, a
 * hoop and thread, a tagged garment and a sealed box are the real things each step is about,
 * and none of them can go out of date the way a screenshot does.
 *
 * Indexed by position with the last as the fallback, so a fifth step added in Settings gets a
 * picture rather than a hole.
 */
const STEP_SHOTS = [
  { img: "step-connect", alt: "A stack of folded blank t-shirts" },
  { img: "step-design", alt: "Thread cones beside an embroidery hoop holding blank fabric" },
  { img: "step-publish", alt: "A blank t-shirt on a hanger with a plain swing tag" },
  { img: "step-ship", alt: "A plain shipping box and a poly mailer" },
]

function Visual({ i }: { i: number }) {
  const shot = STEP_SHOTS[i] ?? STEP_SHOTS[STEP_SHOTS.length - 1]
  return (
    <motion.div {...rise(0.05)} className="aspect-[4/3] overflow-hidden rounded-2xl bg-ploy-paper">
      <Image
        src={`/ploy/${shot.img}.webp`}
        alt={shot.alt}
        width={1200}
        height={900}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    </motion.div>
  )
}

export function PloyHow({
  headline,
  accent,
  lead,
  steps,
}: {
  headline: string
  accent: string
  lead: string
  steps: Step[]
}) {
  return (
    <div className="bg-ploy-ground text-ploy-ink">
      <section className={`${GUTTER} ${TOP}`}>
        <h1 className="ploy-display text-[clamp(2.4rem,6vw,5rem)]">
          <motion.span {...reveal(0)} className="block">{headline}</motion.span>
          <motion.span {...reveal(0.1)} className="flex items-center gap-3">
            <span>{accent}</span>
            <motion.span {...pop(0.25)} className="inline-block">
              <Image src="/ploy/obj-star.webp" alt="" width={140} height={134} unoptimized className="h-[0.8em] w-auto" />
            </motion.span>
          </motion.span>
        </h1>
        <motion.p {...reveal(0.2)} className="mt-6 max-w-lg text-[17px] leading-relaxed text-ploy-ink/70">
          {lead}
        </motion.p>
      </section>

      {/* ── ONE BAND PER STEP ──────────────────────────────────────────────── */}
      {steps.map((s, i) => {
        const flip = i % 2 === 1
        return (
          <section key={s.n || i} className={`${GUTTER} ${STACK}`}>
            <motion.div
              {...rise(0)}
              className={"overflow-hidden rounded-[32px] px-8 py-10 md:px-12 md:py-12 " + (FILLS[i % FILLS.length] ?? "bg-ploy-paper")}
            >
              <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
                <div className={flip ? "md:order-2" : ""}>
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-ploy-ink text-[13px] font-semibold tabular-nums">
                    {s.n || String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="ploy-display mt-5 text-[clamp(2.3rem,5.6vw,4.4rem)] leading-[0.9]">{displayWord(s)}</h2>
                  <p className="mt-4 max-w-md text-[18px] font-semibold leading-tight md:text-[20px]">{s.title}</p>
                  <p className="mt-3 max-w-md text-[16px] leading-relaxed text-ploy-ink/65">{s.body}</p>
                </div>
                <div className={flip ? "md:order-1" : ""}>
                  <Visual i={i} />
                </div>
              </div>
            </motion.div>
          </section>
        )
      })}

      {/* THE DARK "THEN ONE ORDER MOVES" CARD IS GONE (owner's call). It was a whole
          section — a heading, a paragraph and a CTA — to introduce a list of four words, and
          it made the page a step longer than the process it describes.

          The words themselves stay, because they are the honest part: FACTORY_STAGES is the
          list the production board writes and the order gate walks, so what a visitor reads
          here is what a seller will see on their own order. They ride under the last step,
          which is the step they belong to, as a row rather than a section. */}
      <section className={`${GUTTER} ${SECTION}`}>
        <motion.div {...reveal(0)} className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/45">
              What you will see on the order
            </p>
            <ol className="mt-4 flex flex-wrap gap-2">
              {FACTORY_STAGES.map((st, n) => (
                <li key={st.id} className="flex items-center gap-2 rounded-full bg-ploy-paper px-3.5 py-1.5 text-[14px] font-medium">
                  <span className="text-[12px] tabular-nums text-ploy-ink/40">{String(n + 1).padStart(2, "0")}</span>
                  {st.label}
                </li>
              ))}
            </ol>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/signup" className="inline-block rounded-full bg-ploy-ink px-7 py-3 text-[15px] font-medium text-ploy-ground">
                Start free
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/catalog" className="inline-block rounded-full border border-ploy-ink/30 px-7 py-3 text-[15px] font-medium text-ploy-ink">
                See what we make
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </section>

    </div>
  )
}
