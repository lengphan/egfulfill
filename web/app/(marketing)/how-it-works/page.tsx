import Link from "next/link"
import {
  PlugsConnected,
  PenNib,
  RocketLaunch,
  ArrowRight,
} from "@phosphor-icons/react/dist/ssr"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Reveal } from "@/components/motion/reveal"

const steps = [
  {
    n: "01",
    icon: PlugsConnected,
    title: "Connect your stores",
    body: "OAuth into Etsy, Shopify, TikTok Shop or WooCommerce in about two minutes. Your existing orders import immediately and new ones stream into a single queue from then on.",
    detail: ["No CSV exports", "Multi-store from one login", "Existing orders backfilled"],
  },
  {
    n: "02",
    icon: PenNib,
    title: "Upload your designs",
    body: "Add artwork to your library and map it to products once. The mini designer handles placement, sizing, and print-ready files — including embroidery thread matching — so every order prints correctly.",
    detail: ["Reusable design library", "Auto print-file generation", "Placement handled for you"],
  },
  {
    n: "03",
    icon: RocketLaunch,
    title: "We fulfill, hands-off",
    body: "Orders print on a vetted network with QC at every stage, ship on the cheapest available label, and push tracking back to the marketplace. You just watch orders go out.",
    detail: ["QC at intake, print & pack", "Cheapest-label shipping", "Tracking pushed back automatically"],
  },
]

const pipeline = ["Order synced", "Design mapped", "Printed", "QC passed", "Packed", "Shipped"]

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <Reveal className="max-w-2xl">
        <div className="text-sm font-semibold uppercase tracking-wide text-primary">How it works</div>
        <h1 className="mt-3 font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
          Live in three steps.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground text-pretty">
          Connect once, map your art once, and let the platform run the rest — print, pack, ship, and
          track — on autopilot.
        </p>
      </Reveal>

      <div className="mt-14 space-y-5">
        {steps.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.06}>
            <Card className="grid gap-6 p-7 sm:grid-cols-[auto_1fr] sm:p-9">
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/5 font-display text-lg font-semibold text-primary">
                  {s.n}
                </div>
                <span className="mt-1 hidden text-primary sm:block">
                  <s.icon size={26} weight="duotone" />
                </span>
              </div>
              <div>
                <div className="text-xl font-semibold">{s.title}</div>
                <p className="mt-2 max-w-2xl text-muted-foreground">{s.body}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {s.detail.map((d) => (
                    <span
                      key={d}
                      className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          </Reveal>
        ))}
      </div>

      {/* pipeline strip */}
      <Reveal className="mt-16">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          The journey of one order
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-3">
          {pipeline.map((p, i) => (
            <div key={p} className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium">
                <span className="size-1.5 rounded-full bg-primary" />
                {p}
              </span>
              {i < pipeline.length - 1 && <ArrowRight size={14} weight="bold" className="text-muted-foreground/50" />}
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="mt-16 flex flex-col items-center gap-5 rounded-3xl border border-border bg-muted/40 px-6 py-14 text-center">
        <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight">
          Ready to send your first hands-off order?
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            Start for free <ArrowRight size={16} weight="bold" />
          </Link>
          <Link href="/features" className={buttonVariants({ variant: "outline", size: "lg" })}>
            Explore features
          </Link>
        </div>
      </Reveal>
    </div>
  )
}
