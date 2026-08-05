"use client"

import { PlugsConnected, PenNib, RocketLaunch } from "@phosphor-icons/react"
import { ACCENT, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"

/**
 * How it works. Three steps, then the seller-facing status flow.
 *
 * The journey strip keeps the REAL status labels and their real tones (mirroring sellerStatus
 * in lib/order-status.ts) rather than restyling them into the marketing palette. A prospect
 * should recognise these words on their first order — a marketing page that invents a
 * prettier pipeline is a page that lies about the product.
 */
const steps = [
  {
    icon: PlugsConnected,
    title: "Connect your stores",
    body: "Sign in to Etsy, Shopify, TikTok Shop or WooCommerce in about two minutes. Existing orders import right away, and new ones stream into one queue from then on.",
    detail: ["No CSV exports", "Every store, one login", "Existing orders backfilled"],
  },
  {
    icon: PenNib,
    title: "Upload your designs",
    body: "Add artwork once and map it to a product. The mini designer sets placement and size, generates the print files, and matches embroidery thread — so every order comes out right.",
    detail: ["Reusable design library", "Print files made for you", "Placement handled"],
  },
  {
    icon: RocketLaunch,
    title: "We make and ship it",
    body: "You submit an order; we accept it, produce it on a vetted network, buy the cheapest label, and push tracking back to your shop. You watch orders go out.",
    detail: ["Reviewed before production", "Cheapest-label shipping", "Tracking pushed back"],
  },
]

const journey = [
  { label: "Draft", tone: "bg-black/[0.06] text-black/60", body: "Lands in your queue the moment it syncs. Edit it, add items — nothing is charged yet." },
  { label: "Pending", tone: "bg-indigo-100 text-indigo-700", body: "You submit it and we accept it into production. Still cancellable, for a full refund." },
  { label: "In process", tone: "bg-violet-100 text-violet-700", body: "Being made — printed or stitched, scanned, checked, packed. Nothing for you to do." },
  { label: "Fulfilled", tone: "bg-emerald-100 text-emerald-700", body: "Out the door on the cheapest label, with tracking pushed back to your shop." },
]

export function BoldHow() {
  return (
    <div className="text-[#0B0B0C]" style={{ background: SURFACE }}>
      <PlateHero
        title="Three steps."
        accent="Then it runs."
        sub="Connect, upload, submit. Everything after that happens without you opening a shipping screen."
      />

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <Rise key={s.title} delay={i * 0.07} className="rounded-2xl border border-black/[0.09] bg-white p-8">
              <div className="font-display font-black leading-none tracking-tighter text-black/[0.13]" style={{ fontSize: "clamp(3rem, 6vw, 4.5rem)" }}>
                {String(i + 1).padStart(2, "0")}
              </div>
              <span className="mt-6 flex size-10 items-center justify-center rounded-xl" style={{ background: ACCENT }}>
                <s.icon size={20} weight="duotone" />
              </span>
              <h2 className="mt-5 text-xl font-bold tracking-tight">{s.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-black/60">{s.body}</p>
              <ul className="mt-5 space-y-1.5">
                {s.detail.map((d) => (
                  <li key={d} className="text-[13px] text-black/50">— {d}</li>
                ))}
              </ul>
            </Rise>
          ))}
        </div>
      </section>

      {/* The real status flow. Tones are the product's own, deliberately not re-tinted. */}
      <section className="py-16" style={{ background: "rgba(0,0,0,0.03)" }}>
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="font-display font-black leading-[0.95] tracking-[-0.035em]" style={HEADING}>
            What you&apos;ll actually see.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-black/55">
            These are the exact statuses on your orders — not a simplified version for this page.
          </p>
          <div className="mt-12 space-y-3">
            {journey.map((j, i) => (
              <Rise key={j.label} delay={i * 0.06} className="flex flex-col gap-2 rounded-xl border border-black/[0.09] bg-white p-5 sm:flex-row sm:items-center sm:gap-6">
                <span className={"inline-flex w-fit shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold sm:w-28 sm:justify-center " + j.tone}>
                  {j.label}
                </span>
                <span className="text-[15px] leading-relaxed text-black/65">{j.body}</span>
              </Rise>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <Rise className="mx-auto max-w-5xl rounded-3xl px-8 py-14 text-center" style={{ background: ACCENT }}>
          <h2 className="mx-auto max-w-2xl font-display font-black leading-[0.95] tracking-[-0.035em]" style={{ ...HEADING, color: SURFACE }}>
            Connect a store and watch it work.
          </h2>
          <div className="mt-8 flex justify-center">
            <Pill href="/login" tone="ink">Start free</Pill>
          </div>
        </Rise>
      </section>
    </div>
  )
}
