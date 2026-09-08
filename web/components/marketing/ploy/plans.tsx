"use client"

import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, reveal, rise } from "./motion"
import { Straddle } from "./straddle"
import { GUTTER, SECTION } from "./rhythm"
import { PLAN_TIERS } from "@/lib/plans"

/**
 * PLANS — read from `lib/plans.ts` (PLAN_TIERS), never retyped.
 *
 * The prototype carried its own copy of the three tiers, which is the exact shape CLAUDE.md
 * §5 warns about: a private copy that disagrees quietly the first time a price or a limit
 * moves. The server is still the truth (billing.js holds PLAN_PRICE_DEFAULTS and an admin can
 * move them in Settings); this is the card, and it and the signed-in billing page now read
 * one list.
 *
 * The TONE is positional, not stored on the tier: first card acid, second periwinkle, the
 * rest plain. A tier does not know what colour it is, and adding a fourth should not need a
 * colour decision baked into pricing data.
 */
const TONES = ["bg-ploy-acid", "bg-ploy-peri"]

export function PloyPlans() {
  return (
    /* THE BOTTOM PADDING IS THE STRADDLE'S LANDING GROUND. Without it the section ends flush
       with the cards, and the cloud — which is centred on that edge — came up onto the first
       card's "Start free" button. A straddle is never over text, so the edge it straddles has
       to be empty ground on both sides of it. */
    <section id="plans" className={`relative ${GUTTER} ${SECTION}`}>
      <div className="md:px-6">
        <h2 className="ploy-display text-[clamp(2.5rem,7vw,6rem)]">
          <motion.span {...reveal(0)} className="block">
            Three plans.
          </motion.span>
        </h2>
        <motion.p {...reveal(0.15)} className="mt-5 max-w-md text-[17px] leading-relaxed text-ploy-ink/70">
          Every plan pays per order from a prepaid wallet. The subscription buys cheaper blanks and
          more room.
        </motion.p>

        <motion.div {...rise(0.1)} className="mt-14 grid gap-4 md:grid-cols-3">
          {PLAN_TIERS.map((p, i) => (
            <div key={p.id} className="flex flex-col rounded-[24px] bg-ploy-paper p-8">
              <span
                className={
                  "inline-flex w-fit rounded-full px-3 py-1 text-[12px] font-semibold text-ploy-ink " +
                  (TONES[i] ?? "bg-ploy-ground")
                }
              >
                {p.name}
              </span>
              <p className="mt-7 flex items-baseline gap-1.5">
                <span className="ploy-display text-[clamp(3rem,5.5vw,4.5rem)]">${p.monthlyPrice}</span>
                <span className="text-[15px] text-ploy-ink/55">/ month</span>
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-ploy-ink/65">{p.tagline}</p>
              <ul className="mt-7 flex flex-col gap-3">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[15px]">
                    <span
                      aria-hidden
                      className={"mt-2 h-1.5 w-1.5 shrink-0 rounded-full " + (i === 0 ? "bg-ploy-acid" : "bg-ploy-peri")}
                    />
                    <span className="text-ploy-ink/80">{f}</span>
                  </li>
                ))}
              </ul>
              {/* The action sits at the CARD's foot, not after the list — three lists of
                  different lengths otherwise leave three buttons at three heights. */}
              <motion.div whileHover={{ scale: 1.02 }} transition={HOVER} className="mt-auto pt-9">
                <Link
                  href={p.id === "starter" ? "/signup" : `/signup?plan=${p.id}`}
                  className={
                    "block rounded-full px-6 py-3 text-center text-[15px] font-medium " +
                    (i === 0
                      ? "bg-ploy-ink text-ploy-ground"
                      : "border border-ploy-ink/25 text-ploy-ink hover:bg-ploy-ground")
                  }
                >
                  {p.monthlyPrice === 0 ? "Start free" : `Start with ${p.shortName}`}
                </Link>
              </motion.div>
            </div>
          ))}
        </motion.div>
      </div>
      <Straddle src="/ploy/obj-cloud.webp" side="left" inset="8%" width="clamp(140px,13vw,200px)" drop={60} drift={[8, 3]} dur={9} />
    </section>
  )
}
