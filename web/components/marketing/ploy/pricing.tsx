"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, reveal, rise } from "./motion"
import { Straddle } from "./straddle"
import { PLAN_BLANK_DISCOUNT, PLAN_TIERS, type PlanTier } from "@/lib/plans"
import type { Faq } from "@/lib/site-content"

/**
 * PRICING — the three cards, then the row-by-row comparison, then what every plan pays.
 *
 * EVERY FIGURE READS `lib/plans.ts`. The tiers, the limits and the blank discount are the
 * same constants the signed-in billing page and the order charge use, so a price here cannot
 * drift from a price there — which is exactly what a retyped marketing table does the first
 * time someone moves a number in Settings.
 *
 * THERE IS NO MONTHLY/ANNUAL TOGGLE, and its absence is deliberate. We do not sell an annual
 * plan; drawing the toggle would mean inventing a discount that nothing bills, which is the
 * same class of fiction as a fabricated testimonial (§4). If annual billing ships, the
 * numbers come from the server and the toggle follows them.
 */

/** `has` matches against the tier's OWN feature list rather than a second copy of it, and it
 *  matches loosely so a reworded feature does not silently turn a row into a dash. */
const has = (t: PlanTier, re: RegExp) => t.features.some((f) => re.test(f))

type Row = { label: string; note?: string; get: (t: PlanTier) => string | boolean }

const ROWS: Row[] = [
  { label: "Monthly fee", get: (t) => (t.monthlyPrice === 0 ? "Free" : `$${t.monthlyPrice}`) },
  {
    label: "Blank pricing",
    note: "Off the list price, on every garment",
    get: (t) => (PLAN_BLANK_DISCOUNT[t.id] ? `${PLAN_BLANK_DISCOUNT[t.id]}% off` : "Discounted"),
  },
  { label: "Connected stores", get: (t) => t.storeLimitLabel },
  { label: "Orders a month", get: (t) => t.orderLimitLabel },
  { label: "Analytics", get: (t) => (has(t, /advanced/i) ? "Advanced" : "Basic") },
  { label: "SpyDeck research", get: (t) => has(t, /spydeck/i) },
  { label: "Dedicated account manager", get: (t) => has(t, /dedicated/i) },
  // The last three are TRUE on every tier, and printing them is the argument: what a
  // subscription buys is cheaper blanks and more room, never the service itself.
  { label: "Pay per order from a prepaid wallet", get: () => true },
  { label: "Labels rate-shopped and billed at cost", get: () => true },
  { label: "All seven print methods", get: () => true },
]

function Cell({ v }: { v: string | boolean }) {
  if (v === true) return <span className="text-ploy-ink">Yes</span>
  if (v === false) return <span className="text-ploy-ink/35">—</span>
  return <span className="tabular-nums text-ploy-ink">{v}</span>
}

export function PloyPricing({
  headline,
  accent,
  lead,
  faq,
}: {
  headline: string
  accent: string
  lead: string
  faq: { heading: string; items: Faq[] }
}) {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <div className="bg-ploy-ground text-ploy-ink">
      {/* ── THE THREE CARDS ────────────────────────────────────────────────── */}
      <section className="relative px-6 pt-24 md:px-8 md:pt-28">
        <h1 className="ploy-display text-[clamp(2.6rem,7vw,6rem)]">
          <motion.span {...reveal(0)} className="block">{headline}</motion.span>
          <motion.span {...reveal(0.1)} className="block">{accent}</motion.span>
        </h1>
        <motion.p {...reveal(0.2)} className="mt-6 max-w-lg text-[17px] leading-relaxed text-ploy-ink/70">
          {lead}
        </motion.p>

        <motion.div {...rise(0.1)} className="mt-14 grid gap-4 md:grid-cols-3">
          {PLAN_TIERS.map((p, i) => (
            <div
              key={p.id}
              className={
                "flex flex-col rounded-[24px] p-8 " +
                (i === 1 ? "bg-ploy-peri" : "bg-ploy-paper")
              }
            >
              <span
                className={
                  "inline-flex w-fit rounded-full px-3 py-1 text-[12px] font-semibold text-ploy-ink " +
                  (i === 1 ? "bg-ploy-paper" : i === 0 ? "bg-ploy-acid" : "bg-ploy-ground")
                }
              >
                {p.name}
              </span>
              <p className="mt-7 flex items-baseline gap-1.5">
                <span className="ploy-display text-[clamp(3rem,5.5vw,4.5rem)]">${p.monthlyPrice}</span>
                <span className="text-[15px] text-ploy-ink/55">/ month</span>
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-ploy-ink/70">{p.tagline}</p>
              <ul className="mt-7 flex flex-col gap-3">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[15px]">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ploy-ink/40" />
                    <span className="text-ploy-ink/80">{f}</span>
                  </li>
                ))}
              </ul>
              <motion.div whileHover={{ scale: 1.02 }} transition={HOVER} className="mt-auto pt-9">
                <Link
                  href={p.id === "starter" ? "/signup" : `/signup?plan=${p.id}`}
                  className={
                    "block rounded-full px-6 py-3 text-center text-[15px] font-medium " +
                    (i === 1
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
      </section>

      {/* ── ROW BY ROW ─────────────────────────────────────────────────────── */}
      <section className="relative px-6 pt-24 md:px-8 md:pt-32">
        <h2 className="ploy-display text-[clamp(2.2rem,5.4vw,4.4rem)]">
          <motion.span {...reveal(0)} className="block">Line by line.</motion.span>
        </h2>

        {/* The table scrolls in ITS OWN container — §4: wide content scrolls inside itself and
            the page body never scrolls sideways. */}
        <motion.div {...rise(0.1)} className="mt-10 overflow-x-auto rounded-[24px] bg-ploy-paper">
          <table className="w-full min-w-[640px] border-collapse text-[15px]">
            {/* THE PLAN NAMES STICK. A comparison table is read by running a finger down one
                column, and by row six you have forgotten which column is Pro. `top-16` clears
                the fixed site header rather than hiding under it. */}
            <thead className="sticky top-16 z-10 bg-ploy-paper">
              <tr className="border-b border-ploy-ink/12">
                <th className="px-6 py-5 text-left text-[13px] font-semibold uppercase tracking-[0.14em] text-ploy-ink/45">
                  Compare
                </th>
                {PLAN_TIERS.map((p) => (
                  <th key={p.id} className="px-6 py-5 text-left">
                    <span className="text-[17px] font-semibold">{p.name}</span>
                    <span className="ml-2 text-[14px] tabular-nums text-ploy-ink/55">
                      {p.monthlyPrice === 0 ? "Free" : `$${p.monthlyPrice}/mo`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label} className="border-b border-ploy-ink/8 last:border-b-0">
                  <th scope="row" className="px-6 py-4 text-left align-top font-medium">
                    {r.label}
                    {r.note && <span className="mt-0.5 block text-[13px] font-normal text-ploy-ink/50">{r.note}</span>}
                  </th>
                  {PLAN_TIERS.map((p) => (
                    <td key={p.id} className="px-6 py-4 align-top">
                      <Cell v={r.get(p)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
        <Straddle src="/ploy/obj-cloud.webp" side="right" inset="7%" width="clamp(120px,11vw,170px)" drop={50} drift={[8, 3]} dur={9} />
      </section>

      {/* ── WHAT EVERY PLAN PAYS ───────────────────────────────────────────── */}
      <section className="px-6 pt-24 md:px-8 md:pt-32">
        <motion.div {...rise(0)} className="overflow-hidden rounded-[32px] bg-ploy-acid px-8 py-16 md:px-14 md:py-20">
          <h2 className="ploy-display max-w-[16ch] text-[clamp(2rem,5vw,4rem)]">
            <motion.span {...reveal(0)} className="block">The subscription is not the price.</motion.span>
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              ["Charged on submit", "An order is billed from your prepaid wallet the moment you send it to the floor — not when you place it, and not on a monthly invoice."],
              ["Refunded on cancel", "Cancel before it is made and the charge comes back to the wallet. The ledger is append-only, so every movement stays visible."],
              ["Labels at cost", "We rate-shop across carriers and buy the cheapest available, billed at what it cost us. There is no shipping margin."],
            ].map(([h, b], i) => (
              <motion.div key={h} {...reveal(0.1 + i * 0.08)}>
                <p className="text-[20px] font-semibold">{h}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ploy-ink/70">{b}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────────── */}
      {faq.items.length > 0 && (
        <section className="px-6 pb-8 pt-24 md:px-8 md:pt-32">
          <h2 className="ploy-display text-[clamp(2.2rem,5.4vw,4.4rem)]">
            <motion.span {...reveal(0)} className="block">{faq.heading}</motion.span>
          </h2>
          <motion.div {...rise(0.1)} className="mt-10 overflow-hidden rounded-[24px] bg-ploy-paper">
            {faq.items.map((f, i) => (
              <div key={f.q} className="border-b border-ploy-ink/8 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpen(open === i ? null : i)}
                  aria-expanded={open === i}
                  className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left text-[17px] font-medium md:px-8"
                >
                  {f.q}
                  <span aria-hidden className={"shrink-0 text-[22px] leading-none transition-transform " + (open === i ? "rotate-45" : "")}>
                    +
                  </span>
                </button>
                {open === i && (
                  <p className="max-w-3xl px-6 pb-6 text-[15px] leading-relaxed text-ploy-ink/70 md:px-8">{f.a}</p>
                )}
              </div>
            ))}
          </motion.div>
        </section>
      )}

      {/* One object closes the page, the way the home does. */}
      <div className="relative">
        <Image
          src="/ploy/obj-chrome.webp"
          alt=""
          width={200}
          height={218}
          unoptimized
          className="mx-auto h-auto w-[clamp(80px,8vw,120px)] opacity-90"
        />
      </div>
    </div>
  )
}
