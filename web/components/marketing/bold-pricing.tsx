"use client"

import { Check } from "@phosphor-icons/react"
import { ACCENT, ACCENT_INK, ACID, HAIRLINE, INK, SURFACE, Pill, Band, Rise } from "@/components/marketing/bold-kit"
import { PageBanner } from "@/components/marketing/page-banner"
import type { PageHead } from "@/lib/site-content"

/**
 * Pricing, in the ink + lime direction (2026-08-26).
 *
 * WHAT CHANGED, AND WHY IT IS NOT A RESTYLE. The page was two bordered white cards side by
 * side on one flat ground — `border border-black/[0.09]`, `bg-black/[0.03]`, `text-black/45`
 * — which is three problems at once. The hexes were literals, so the runtime skin could not
 * reach them and this page stayed press-coloured while the home page moved. The boxes were
 * two of the 490 outlined cards §4 is trying to remove. And the closing band was a rounded
 * box inside a max-w-5xl, which the home page had already established reads as an advert
 * pasted onto the page rather than as the page ending.
 *
 * So: Bands. Ground changes carry the division — paper → white → ink → paper → plate — and
 * there is no border anywhere on the page. Every colour is a kit constant, so a skin change
 * reaches this page like any other.
 *
 * THE COPY IS UNCHANGED except for the wallet band, and that band states behaviour the
 * server actually implements (charge on submit, refund on cancel — server/src/routes/wallet.js,
 * idempotent by (account, type, ref)). Nothing here is a claim invented to fill a surface;
 * the features page dropped a whole comparison table for exactly that reason.
 *
 * The one deliberate emphasis, kept from the old page: $0 is set at display size. On a
 * pay-as-you-go page the single fact a visitor is looking for is whether there is a monthly
 * fee, and a card header buried it.
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

/** How the money actually moves. Each line is a behaviour of the wallet ledger, not a promise. */
const wallet = [
  { k: "Charged on submit", v: "An order draws from your wallet when you send it to the floor — not when it syncs, and not on a monthly cycle." },
  { k: "Refunded on cancel", v: "Cancel before production and the charge reverses to the same balance. The ledger is append-only, so both entries stay visible." },
  { k: "Shipping at cost", v: "We rate-shop the label and bill exactly what it cost. There is no markup line between the carrier and your balance." },
]

const CAPS = "text-[11px] font-semibold uppercase tracking-[0.2em]"

export function BoldPricing({ head }: { head: PageHead }) {
  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      {/* The three strings moved to stored content unchanged, so the page's opening copy is
          editable where it is read — and so it has somewhere to put a picture. With none set
          this still draws the plate exactly as it did. */}
      <PageBanner head={head} pathPrefix="pricingPage" />

      {/* ── THE ANSWER ───────────────────────────────────────────────────────────
          $0 at display size, and the list beside it as rule-divided rows rather than
          inside a box. A price in a card is a plan you have to choose between; a price
          set as type is the page saying the number out loud. There is only one plan, so
          there is nothing to compare and no card to compare it in. */}
      <Band tone="card">
        <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Rise preset="bloom">
            <div className={CAPS} style={{ color: INK, opacity: 0.45 }}>Everything, included</div>
            <div className="mt-5 flex items-baseline gap-4">
              <span className="font-display font-semibold leading-none tracking-[-0.032em]" style={{ fontSize: "clamp(4rem, 11vw, 8.5rem)" }}>$0</span>
              <span className="text-[15px]" style={{ color: INK, opacity: 0.5 }}>/ month to start</span>
            </div>
            <p className="mt-5 max-w-sm text-[16px] leading-relaxed" style={{ color: INK, opacity: 0.62 }}>
              The platform is free. You pay per fulfilled order — that&apos;s it.
            </p>
            <Pill href="/signup" tone="primary" className="mt-9">Start free</Pill>
          </Rise>

          <ul className="lg:pt-3">
            {included.map((i, n) => (
              /* The row is the <li> and the animation is inside it: Rise renders a div, and a
                 div is not a legal child of a ul. */
              <li key={i} className={n > 0 ? "border-t" : undefined} style={n > 0 ? { borderColor: HAIRLINE } : undefined}>
                <Rise preset="cut" index={n} className="flex items-start gap-4 py-4">
                {/* The tick sits in a lime chip rather than being a lime glyph: the accent is
                    a ground carrying ink in this system and never lettering — at 12px on white
                    it measures 1.03:1 and is simply not there. */}
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full" style={{ background: ACID, color: INK }}>
                  <Check size={12} weight="bold" />
                </span>
                  <span className="text-[16px] leading-snug" style={{ color: INK, opacity: 0.8 }}>{i}</span>
                </Rise>
              </li>
            ))}
          </ul>
        </div>
      </Band>

      {/* ── THE WALLET — the dark block ──────────────────────────────────────────
          The question a pay-as-you-go page always leaves open is WHEN, and the old page
          never answered it. Three facts, on the third surface. */}
      <Band tone="dark">
        <div>
          <h2 className="max-w-2xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
            When the money moves.
          </h2>
          <div className="mt-14 grid gap-12 md:grid-cols-3">
            {wallet.map((w, i) => (
              <Rise key={w.k} preset="rise" index={i}>
                {/* Lime as type is legal HERE and only here — 14.86:1 on ink, against 1.03:1
                    on the page. The rule is the ground, not the role. */}
                <div className={CAPS} style={{ color: ACID }}>{w.k}</div>
                <p className="mt-3 text-[15px] leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.7 }}>{w.v}</p>
              </Rise>
            ))}
          </div>
        </div>
      </Band>

      {/* ── WHAT AN ORDER COSTS ──────────────────────────────────────────────────
          A divided band, not a card: rules between the rows say "these are one list" for
          free, and the price column is right-aligned, which globals.css already gives
          tabular figures — never add tabular-nums beside text-right again (§4). */}
      <Band tone="paper">
        <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            <h2 className="font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
              Example base costs.
            </h2>
            <p className="mt-5 max-w-sm text-[16px] leading-relaxed" style={{ color: INK, opacity: 0.62 }}>
              Blank + print, before shipping. The final price depends on product, placement and method.
            </p>
          </div>
          <ul className="lg:pt-4">
            {examples.map((e, i) => (
              <li key={e.name} className={i > 0 ? "border-t" : undefined} style={i > 0 ? { borderColor: HAIRLINE } : undefined}>
                <Rise preset="cut" index={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-6 py-5">
                  <span className="text-[17px]" style={{ color: INK, opacity: 0.8 }}>{e.name}</span>
                  <span className="text-right font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-none tracking-[-0.025em]">{e.price}</span>
                </Rise>
              </li>
            ))}
          </ul>
        </div>
      </Band>

      {/* ── CTA — edge to edge, the only full-bleed plate on the page ────────────
          Paper lettering, lime button: the accent fires once, and it fires on the action. */}
      <section className="px-6 py-24 sm:px-10" style={{ background: ACCENT }}>
        <div className="mx-auto max-w-[88rem]">
          <h2 className="max-w-[48rem] font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 5.4vw, 4.4rem)", color: ACCENT_INK }}>
            Only pay when it ships.
          </h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.72 }}>
            Connect a store, send one order, and watch what it costs before you send a hundred.
          </p>
          <div className="mt-10">
            <Pill href="/signup" tone="invert" ring>Start free</Pill>
          </div>
        </div>
      </section>
    </div>
  )
}
