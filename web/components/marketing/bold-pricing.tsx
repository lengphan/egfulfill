"use client"

import { Check } from "@phosphor-icons/react"
import { ACCENT, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"

/**
 * Pricing, in the house style. Same copy and the same two ideas the old page had — what's
 * included, and what a real order actually costs — restated so the numbers are the loudest
 * thing on the page rather than the card chrome around them.
 *
 * The one deliberate emphasis: $0 is set at display size. On a pay-as-you-go page the single
 * fact a visitor is looking for is whether there's a monthly fee, and burying it in a card
 * header made them read a list to find out.
 */
const included = [
  "Unlimited store connections (Etsy, Shopify, TikTok)",
  "Automatic order sync into one queue",
  "Vetted print network with per-stage QC",
  "Cheapest-label shipping + tracking pushed back",
  "Prepaid wallet with per-order transparency",
  "Design library & mini designer",
]

const examples = [
  { name: "Classic tee", price: "$8.90" },
  { name: "Heavyweight hoodie", price: "$22.00" },
  { name: "Embroidered cap", price: "$12.50" },
  { name: "Ceramic mug 15oz", price: "$6.40" },
]

export function BoldPricing() {
  return (
    <div className="text-[#0B0B0C]" style={{ background: SURFACE }}>
      <PlateHero
        title="Simple,"
        accent="pay-as-you-go."
        sub="No monthly fee. No minimums. You pay the per-order fulfilment cost when an order actually ships — funded from your wallet."
      />

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          {/* What you pay to be here — the answer first, at display size. */}
          <Rise preset="bloom" className="rounded-2xl border border-black/[0.09] bg-white p-9">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">Everything, included</div>
            <div className="mt-4 flex items-baseline gap-3">
              <span className="font-display font-black leading-none tracking-[-0.04em]" style={HEADING}>$0</span>
              <span className="text-[15px] text-black/50">/ month to start</span>
            </div>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-black/55">
              The platform is free. You pay per fulfilled order — that&apos;s it.
            </p>
            <ul className="mt-8 space-y-3.5">
              {included.map((i) => (
                <li key={i} className="flex items-start gap-3 text-[15px]">
                  {/* The tick sits in an accent chip rather than being an accent-coloured
                      glyph: at 12px a lime tick on white is nearly invisible, and the accent
                      is a fill in this system, not an ink colour. */}
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[#FAF8F3]" style={{ background: ACCENT }}>
                    <Check size={12} weight="bold" />
                  </span>
                  <span className="text-black/75">{i}</span>
                </li>
              ))}
            </ul>
            <Pill href="/signup" tone="ink" className="mt-9 w-full">Start free</Pill>
          </Rise>

          {/* What an order costs — the second question, and the honest caveat with it. */}
          <Rise preset="bloom" index={1} className="rounded-2xl border border-black/[0.09] bg-black/[0.03] p-9">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">Example base costs</div>
            <p className="mt-3 text-[15px] leading-relaxed text-black/55">
              Blank + print, before shipping. The final price depends on product, placement and method.
            </p>
            <ul className="mt-7 divide-y divide-black/[0.09] border-y border-black/[0.09]">
              {examples.map((e) => (
                <li key={e.name} className="flex items-center justify-between py-4">
                  <span className="text-[15px] text-black/75">{e.name}</span>
                  <span className="text-lg font-display font-black tabular-nums tracking-tight">{e.price}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[13px] leading-relaxed text-black/45">
              Shipping is bought at the cheapest available rate and billed at cost.
            </p>
          </Rise>
        </div>
      </section>

      {/* The band IS the Rise — nesting a padded wrapper around a padded inner div gave it
          two sets of padding and a white gutter inside its own rounded corner. */}
      <section className="px-6 pb-16">
        <Rise preset="settle" className="mx-auto max-w-5xl rounded-3xl px-8 py-14 text-center" style={{ background: ACCENT }}>
          <h2 className="mx-auto max-w-2xl font-display font-black leading-[0.95] tracking-[-0.035em]" style={{ ...HEADING, color: SURFACE }}>
            Only pay when it ships.
          </h2>
          <div className="mt-8 flex justify-center">
            <Pill href="/signup" tone="ink">Start free</Pill>
          </div>
        </Rise>
      </section>
    </div>
  )
}
