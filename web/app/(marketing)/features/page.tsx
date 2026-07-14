import Link from "next/link"
import {
  PlugsConnected,
  Printer,
  Truck,
  Wallet,
  PenNib,
  ShieldCheck,
  ArrowRight,
} from "@phosphor-icons/react/dist/ssr"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Reveal } from "@/components/motion/reveal"

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

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <Reveal className="max-w-2xl">
        <div className="text-sm font-semibold uppercase tracking-wide text-primary">Features</div>
        <h1 className="mt-3 font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
          Everything after the sale, handled.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground text-pretty">
          From the moment an order lands to the tracking number your buyer sees — egfulfill runs the whole
          back half of your business so you don&apos;t have to.
        </p>
      </Reveal>

      <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {features.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 0.08}>
            <Card className="h-full gap-3 p-7">
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon size={22} weight="duotone" />
              </span>
              <div className="text-lg font-semibold">{f.title}</div>
              <p className="text-sm text-muted-foreground">{f.body}</p>
              <ul className="mt-2 space-y-1.5">
                {f.points.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm text-foreground/80">
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                    {p}
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-16 flex flex-col items-center gap-5 rounded-3xl border border-border bg-muted/40 px-6 py-14 text-center">
        <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight">
          See the whole flow in three steps.
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/how-it-works" className={buttonVariants({ size: "lg" })}>
            How it works <ArrowRight size={16} weight="bold" />
          </Link>
          <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
            Start for free
          </Link>
        </div>
      </Reveal>
    </div>
  )
}
