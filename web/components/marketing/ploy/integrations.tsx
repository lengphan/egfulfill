"use client"

import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, pop, reveal, rise } from "./motion"
import { Straddle } from "./straddle"

/**
 * INTEGRATIONS — what actually connects today, and what honestly does not.
 *
 * THIS PAGE IS A STATUS REPORT, not a wish list, and §4 is the whole reason it is written
 * this way. Every channel below says which of two different things is true — orders coming
 * IN, and listings going OUT — because they ship separately and we have shipped one without
 * the other more than once:
 *
 *   · Etsy, Shopify and TikTok Shop connect and import orders today.
 *   · TikTok PUBLISHING is built but runs as a DRY RUN behind TIKTOK_PUBLISH_LIVE, and has
 *     never been validated against a live shop. Listing it as done would be a lie a seller
 *     discovers at the worst possible moment.
 *   · Amazon is in developer onboarding. Walmart needs a Solution Provider app we have not
 *     built. WooCommerce is not started.
 *
 * A channel that is not built gets a plain "not yet", never a greyed-out logo implying it is
 * nearly here.
 */

type Status = "live" | "partial" | "soon" | "planned"

const STATUS_LABEL: Record<Status, string> = {
  live: "Connected",
  partial: "Partly live",
  soon: "In onboarding",
  planned: "Not built yet",
}

const CHANNELS: {
  name: string
  status: Status
  orders: string
  listings: string
  note?: string
  href?: string
}[] = [
  {
    name: "Etsy",
    status: "live",
    orders: "Sync automatically, with tracking pushed back",
    listings: "Publish from EGFUL, or keep listing on Etsy",
    note: "Buyer addresses arrive blank on some orders — that is Etsy's app-tier privacy gate, not a fault here. The factory still gets what it needs to ship.",
  },
  {
    name: "Shopify",
    status: "live",
    orders: "Sync automatically, with tracking pushed back",
    listings: "Publish from EGFUL, or keep listing on Shopify",
    note: "Reading customer details needs protected-customer-data access approved on your store, and the token expires — both need a reconnect when they lapse.",
  },
  {
    name: "TikTok Shop",
    status: "partial",
    orders: "Sync automatically, with tracking pushed back",
    listings: "Built, but running as a dry run",
    note: "Order import is live. Publishing is written and gated off until it has been validated against a real shop — so nothing you press here can create a listing yet.",
  },
  {
    name: "Amazon",
    status: "soon",
    orders: "Not connected yet",
    listings: "Not connected yet",
    note: "In developer onboarding as a public app, so sellers will connect their own account rather than hand over a key. Buyer addresses need a restricted role on top of that.",
    href: "/integrations/amazon",
  },
  {
    name: "Walmart Marketplace",
    status: "planned",
    orders: "Not connected yet",
    listings: "Not connected yet",
    note: "Needs a Solution Provider app so each seller authorises their own store. Not started.",
  },
  {
    name: "WooCommerce",
    status: "planned",
    orders: "Not connected yet",
    listings: "Not connected yet",
    note: "Not started.",
  },
]

export function PloyIntegrations({ headline, accent, lead }: { headline: string; accent: string; lead: string }) {
  return (
    <div className="bg-ploy-ground text-ploy-ink">
      <section className="px-6 pt-24 md:px-8 md:pt-28">
        <h1 className="ploy-display text-[clamp(2.6rem,7vw,6rem)]">
          <motion.span {...reveal(0)} className="block">{headline}</motion.span>
          <motion.span {...reveal(0.1)} className="flex items-center gap-3">
            <span>{accent}</span>
            <motion.span {...pop(0.25)} className="inline-block">
              <Image src="/ploy/obj-cloud.webp" alt="" width={160} height={104} unoptimized className="h-[0.62em] w-auto" />
            </motion.span>
          </motion.span>
        </h1>
        <motion.p {...reveal(0.2)} className="mt-6 max-w-xl text-[17px] leading-relaxed text-ploy-ink/70">
          {lead}
        </motion.p>
      </section>

      {/* ── THE ONE DIAGRAM THAT EARNS ITS PLACE ───────────────────────────── */}
      <section className="px-6 pt-16 md:px-8 md:pt-20">
        <motion.div {...rise(0)} className="overflow-hidden rounded-[32px] bg-ploy-acid px-8 py-14 md:px-14 md:py-16">
          <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-ploy-ink/50">What syncs</p>
          <div className="mt-8 grid gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
            {[
              ["Your store", "A sale happens where it always did"],
              ["One queue", "The order lands here, with its artwork attached"],
              ["Back to the buyer", "Tracking is written to the original order"],
            ].map(([h, b], i) => (
              <motion.div key={h} {...reveal(0.1 + i * 0.1)} className="contents">
                <div className="rounded-2xl bg-ploy-paper p-6">
                  <p className="text-[19px] font-semibold">{h}</p>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ploy-ink/65">{b}</p>
                </div>
                {i < 2 && (
                  <span aria-hidden className="hidden text-[26px] text-ploy-ink/40 md:block">→</span>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── CHANNEL BY CHANNEL ─────────────────────────────────────────────── */}
      {/* The bottom padding is the straddle's landing ground — without it this section ends
          flush with the last card and the star came up onto WooCommerce's copy. */}
      <section className="relative px-6 pb-28 pt-24 md:px-8 md:pb-32 md:pt-32">
        <h2 className="ploy-display text-[clamp(2.2rem,5.4vw,4.4rem)]">
          <motion.span {...reveal(0)} className="block">Channel by channel.</motion.span>
        </h2>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {CHANNELS.map((c, i) => (
            <motion.article key={c.name} {...reveal(0.05 * i)} className="flex flex-col rounded-[24px] bg-ploy-paper p-7 md:p-8">
              <div className="flex items-start justify-between gap-4">
                <p className="ploy-display text-[clamp(1.6rem,3vw,2.2rem)]">{c.name}</p>
                {/* A PILL THAT CARRIES MEANING — the one thing §4 allows a pill to be. It is
                    the channel's live status and it is the whole point of the page. */}
                <span
                  className={
                    "shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold " +
                    (c.status === "live"
                      ? "bg-ploy-acid text-ploy-ink"
                      : c.status === "partial"
                        ? "bg-ploy-peri text-ploy-ink"
                        : "bg-ploy-ground text-ploy-ink/60")
                  }
                >
                  {STATUS_LABEL[c.status]}
                </span>
              </div>

              {/* IN and OUT are separate rows because they ship separately. */}
              <dl className="mt-6 grid gap-3 border-t border-ploy-ink/10 pt-5 text-[15px]">
                <div className="grid grid-cols-[5.5rem_1fr] gap-3">
                  <dt className="text-ploy-ink/45">Orders in</dt>
                  <dd className="text-ploy-ink/85">{c.orders}</dd>
                </div>
                <div className="grid grid-cols-[5.5rem_1fr] gap-3">
                  <dt className="text-ploy-ink/45">Listings out</dt>
                  <dd className="text-ploy-ink/85">{c.listings}</dd>
                </div>
              </dl>

              {c.note && <p className="mt-5 text-[14px] leading-relaxed text-ploy-ink/60">{c.note}</p>}

              {c.href && (
                <Link href={c.href} className="mt-5 inline-block text-[14px] font-medium underline underline-offset-4">
                  Read the detail
                </Link>
              )}
            </motion.article>
          ))}
        </div>
        <Straddle src="/ploy/obj-star.webp" side="right" inset="8%" width="clamp(110px,10vw,160px)" drop={54} drift={[12, -8]} dur={6.5} />
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="px-6 pb-8 pt-24 md:px-8 md:pt-32">
        <motion.div {...rise(0)} className="flex flex-col items-center rounded-[32px] bg-ploy-sky px-8 py-16 text-center md:py-20">
          <h2 className="ploy-display max-w-[14ch] text-[clamp(2rem,5vw,4rem)]">
            <motion.span {...reveal(0)} className="block">Connect the one you already run.</motion.span>
          </h2>
          <motion.div {...reveal(0.15)} className="mt-8 flex flex-wrap justify-center gap-3">
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/signup" className="inline-block rounded-full bg-ploy-ink px-7 py-3 text-[15px] font-medium text-ploy-ground">
                Start free
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/contact" className="inline-block rounded-full border border-ploy-ink/30 px-7 py-3 text-[15px] font-medium text-ploy-ink">
                Ask about a channel
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>
    </div>
  )
}
