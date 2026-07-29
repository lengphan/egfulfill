import { Fragment } from "react"
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
    body: "Sign in to Etsy, Shopify, TikTok Shop or WooCommerce in about two minutes. Existing orders import right away, and new ones stream into one queue from then on.",
    detail: ["No CSV exports", "Every store, one login", "Existing orders backfilled"],
  },
  {
    n: "02",
    icon: PenNib,
    title: "Upload your designs",
    body: "Add artwork once and map it to a product. The mini designer sets placement and size, generates the print files, and matches embroidery thread — so every order comes out right.",
    detail: ["Reusable design library", "Print files made for you", "Placement handled"],
  },
  {
    n: "03",
    icon: RocketLaunch,
    title: "We make and ship it",
    body: "You submit an order; we accept it, produce it on a vetted network, buy the cheapest label, and push tracking back to your shop. You watch orders go out.",
    detail: ["Reviewed before production", "Cheapest-label shipping", "Tracking pushed back"],
  },
]

// The REAL seller-facing status flow (mirrors sellerStatus in lib/order-status.ts) — same
// labels and colours a seller sees on their orders, so this previews the actual product
// instead of inventing a pipeline.
const journey = [
  {
    label: "Draft",
    tone: "bg-muted text-muted-foreground",
    body: "Lands in your queue the moment it syncs. Edit it, add items — nothing is charged yet.",
  },
  {
    label: "Pending",
    tone: "bg-indigo-100 text-indigo-700",
    body: "You submit it and we accept it into production. Still cancellable, for a full refund.",
  },
  {
    label: "In process",
    tone: "bg-violet-100 text-violet-700",
    body: "Being made — printed or stitched, scanned, checked, packed. Nothing for you to do.",
  },
  {
    label: "Fulfilled",
    tone: "bg-emerald-100 text-emerald-700",
    body: "Out the door on the cheapest label, with tracking pushed back to your shop.",
  },
]

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <Reveal className="max-w-2xl">
        <div className="text-sm font-semibold uppercase tracking-wide text-primary">How it works</div>
        <h1 className="mt-3 font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
          From your store to <span className="italic text-primary">their door</span>.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground text-pretty">
          Connect a shop, map your art once, and every order runs itself — reviewed, made, shipped,
          and tracked. Your job is to watch them go out.
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

      {/* The order journey — the real four statuses a seller watches, in the app's own colours. */}
      <Reveal className="mt-20">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          The journey of one order
        </div>
        <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-tight text-balance">
          Four calm stages on your side.
        </h2>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-0">
          {journey.map((j, i) => (
            <Fragment key={j.label}>
              <Card className="flex-1 p-5">
                <span className={"inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold " + j.tone}>
                  {j.label}
                </span>
                <p className="mt-3 text-sm text-muted-foreground text-pretty">{j.body}</p>
              </Card>
              {i < journey.length - 1 && (
                <div className="hidden shrink-0 items-center px-3 sm:flex" aria-hidden>
                  <ArrowRight size={16} weight="bold" className="text-muted-foreground/40" />
                </div>
              )}
            </Fragment>
          ))}
        </div>

        <p className="mt-6 max-w-2xl text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Four stages, all you have to know.</span>{" "}
          Behind &ldquo;In process&rdquo; we approve it, buy the label, scan it in, make it, check it and
          pack it — none of which lands on you.
        </p>
      </Reveal>

      <Reveal className="mt-20 flex flex-col items-center gap-5 rounded-3xl border border-border bg-muted/40 px-6 py-14 text-center">
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
