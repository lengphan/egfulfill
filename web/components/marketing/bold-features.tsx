"use client"

import { PlugsConnected, PenNib, Printer, Truck, Wallet, ShieldCheck, Check } from "@phosphor-icons/react"
import { ACCENT, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"

/**
 * Features, in the house style. Same six capabilities and the same copy — restated as a
 * numbered run rather than a grid of equal cards.
 *
 * A six-card grid says "here are six things" and gives no reading order, so the eye picks at
 * random and nothing lands. Numbered full-width rows say "here is what happens, in order",
 * which is also what the product actually is: a pipeline.
 */
const features = [
  {
    icon: PlugsConnected,
    title: "Every store, one queue",
    body: "Connect Etsy, Shopify, TikTok Shop and WooCommerce. Orders sync in automatically — no CSV exports, no copy-paste, no missed orders. Tracking is pushed back to each marketplace the moment a label is bought.",
    points: ["OAuth in ~2 minutes", "Real-time order sync", "Tracking pushed back automatically"],
  },
  {
    icon: PenNib,
    title: "Design once, map forever",
    body: "Upload artwork to your library and map it to products a single time. Our mini designer handles placement, sizing and print-ready file generation — including embroidery thread matching.",
    points: ["Reusable design library", "Auto placement & print files", "Embroidery thread matching"],
  },
  {
    icon: Printer,
    title: "Vetted print network",
    body: "Your orders print on a quality-checked partner network with QC at intake, print and pack. Not a black box — you can see each order's stage in real time.",
    points: ["QC at every stage", "Per-order status visibility", "Consistent quality"],
  },
  {
    icon: Truck,
    title: "Cheapest-label shipping",
    body: "We rate-shop across carriers and buy the cheapest available label, billed at cost. Tracking flows back to the buyer automatically — you never touch a shipping screen.",
    points: ["Multi-carrier rate shopping", "Billed at cost", "Automatic tracking"],
  },
  {
    icon: Wallet,
    title: "Transparent wallet",
    body: "A prepaid wallet with clear per-order charges. See exactly what each order costs before it prints — no mystery invoices, no surprise fees.",
    points: ["Per-order cost breakdown", "Prepaid, no monthly fee", "Instant reconciliation"],
  },
  {
    icon: ShieldCheck,
    title: "Quality you can trust",
    body: "Every order is inspected on a vetted network before it ships. Issues are caught early, so your buyers get exactly what they ordered.",
    points: ["Pre-ship inspection", "Early issue detection", "Reprints handled for you"],
  },
]

export function BoldFeatures() {
  return (
    <div className="text-[#0B0B0C]" style={{ background: SURFACE }}>
      <PlateHero
        title="Everything after"
        accent="the sale."
        sub="Six things this platform does so you don't have to. Every one of them runs whether you're watching or not."
      />

      <section className="mx-auto max-w-5xl px-6 py-24">
        <div className="divide-y divide-black/[0.09]">
          {features.map((f, i) => (
            <Rise key={f.title} delay={i * 0.05} className="grid gap-6 py-12 md:grid-cols-[auto_1fr_auto] md:gap-10">
              {/* The number is the ordering cue a card grid can't give. Set big and quiet —
                  it's a position, not a value, so it shouldn't compete with the heading. */}
              <div className="font-black leading-none tracking-tighter text-black/[0.13]" style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)" }}>
                {String(i + 1).padStart(2, "0")}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ background: ACCENT }}>
                    <f.icon size={18} weight="duotone" />
                  </span>
                  <h2 className="text-2xl font-bold tracking-tight">{f.title}</h2>
                </div>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-black/60">{f.body}</p>
              </div>

              <ul className="space-y-2 md:w-56">
                {f.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2 text-[13px] text-black/70">
                    <Check size={13} weight="bold" className="mt-0.5 shrink-0" />
                    {pt}
                  </li>
                ))}
              </ul>
            </Rise>
          ))}
        </div>
      </section>

      <section className="px-6 pb-24">
        <Rise className="mx-auto max-w-5xl rounded-3xl px-8 py-20 text-center" style={{ background: ACCENT }}>
          <h2 className="mx-auto max-w-2xl font-black leading-[0.95] tracking-[-0.035em]" style={{ ...HEADING, color: SURFACE }}>
            All of it, from the first order.
          </h2>
          <div className="mt-8 flex justify-center">
            <Pill href="/login" tone="ink">Start free</Pill>
          </div>
        </Rise>
      </section>
    </div>
  )
}
