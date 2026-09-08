"use client"

import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, pop, reveal, rise } from "./motion"
import { Straddle } from "./straddle"
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

/** The channels a seller can actually connect today — the same claim the home page makes. */
const CHANNELS = ["Etsy", "Shopify", "TikTok Shop"]
/** Four of the seven, because four fit a square grid; /catalog's rail carries all of them. */
const METHOD_SHOTS = ["emb", "dtg", "dtf", "apl"]

/** One picture per step, chosen to answer that step rather than to fill the space. */
function Visual({ i }: { i: number }) {
  if (i === 0) {
    return (
      <div className="flex flex-col gap-1">
        {CHANNELS.map((c, n) => (
          <motion.p key={c} {...reveal(0.1 + n * 0.08)} className="ploy-display text-[clamp(2rem,5.5vw,4rem)] leading-[1.05]">
            {c}
          </motion.p>
        ))}
        <motion.p {...reveal(0.34)} className="mt-4 max-w-xs text-[15px] text-ploy-ink/60">
          Sign in once. Existing orders import, new ones stream in.
        </motion.p>
      </div>
    )
  }
  if (i === 1) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {METHOD_SHOTS.map((m, n) => (
          <motion.div key={m} {...reveal(0.08 * n)} className="aspect-square overflow-hidden rounded-2xl bg-ploy-paper">
            <Image src={`/ploy/method-${m}.webp`} alt="" width={500} height={500} loading="lazy" className="h-full w-full object-cover" />
          </motion.div>
        ))}
      </div>
    )
  }
  return (
    <motion.div {...rise(0.05)} className="aspect-[4/5] overflow-hidden rounded-2xl bg-ploy-paper">
      <Image
        src={i === 2 ? "/ploy/blank/tee.webp" : "/ploy/blank/hoodie.webp"}
        alt={`A model wearing a blank ${i === 2 ? "tee" : "heavyweight hoodie"}, framed from the collarbone down`}
        width={960}
        height={1200}
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
              className={"overflow-hidden rounded-[32px] px-8 py-14 md:px-14 md:py-20 " + (FILLS[i % FILLS.length] ?? "bg-ploy-paper")}
            >
              <div className="grid items-center gap-10 md:grid-cols-2 md:gap-14">
                <div className={flip ? "md:order-2" : ""}>
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-ploy-ink text-[13px] font-semibold tabular-nums">
                    {s.n || String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="ploy-display mt-6 text-[clamp(3rem,8.5vw,7rem)] leading-[0.88]">{displayWord(s)}</h2>
                  <p className="mt-6 max-w-md text-[20px] font-semibold leading-tight md:text-[22px]">{s.title}</p>
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

      {/* ── WHAT HAPPENS TO ONE ORDER ──────────────────────────────────────── */}
      <section className={`relative ${GUTTER} ${SECTION}`}>
        <motion.div {...rise(0)} className="overflow-hidden rounded-[32px] bg-ploy-slate px-8 py-16 text-ploy-ground md:px-14 md:py-20">
          <h2 className="ploy-display max-w-[18ch] text-[clamp(2rem,5vw,4rem)]">
            <motion.span {...reveal(0)} className="block">Then one order moves.</motion.span>
          </h2>
          <motion.p {...reveal(0.1)} className="mt-5 max-w-xl text-[17px] leading-relaxed text-ploy-ground/70">
            These are the stages our factory actually writes — the same words a seller sees on
            their own order, not a friendlier set invented for this page.
          </motion.p>

          <ol className="mt-12 flex flex-wrap gap-2">
            {FACTORY_STAGES.map((s, i) => (
              <motion.li
                key={s.id}
                {...reveal(0.04 * i)}
                className="flex items-center gap-2 rounded-full bg-ploy-ground/10 px-4 py-2 text-[14px] font-medium ring-1 ring-ploy-ground/15"
              >
                <span className="text-[12px] tabular-nums text-ploy-ground/45">{String(i + 1).padStart(2, "0")}</span>
                {s.label}
              </motion.li>
            ))}
          </ol>

          <motion.div {...reveal(0.2)} className="mt-12 flex flex-wrap items-center gap-3">
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/signup" className="inline-block rounded-full bg-ploy-ground px-7 py-3 text-[15px] font-medium text-ploy-ink">
                Start free
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/catalog" className="inline-block rounded-full border border-ploy-ground/40 px-7 py-3 text-[15px] font-medium text-ploy-ground">
                See what we make
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
        <Straddle src="/ploy/obj-chrome.webp" side="left" inset="8%" width="clamp(110px,10vw,160px)" drop={50} drift={[-10, 6]} dur={7.5} />
      </section>

    </div>
  )
}
