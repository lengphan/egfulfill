import Link from "next/link"
import { PlugsConnected, Printer, Truck, Wallet } from "@phosphor-icons/react/dist/ssr"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

const features = [
  {
    icon: PlugsConnected,
    title: "Every store, one queue",
    body: "Orders from Etsy, Shopify & TikTok Shop sync in automatically — no CSV exports, no copy-paste.",
  },
  {
    icon: Printer,
    title: "Vetted print network",
    body: "Your artwork prints on quality-checked partners with QC at every stage — not a black box.",
  },
  {
    icon: Truck,
    title: "Tracking, automatic",
    body: "We buy the cheapest label and push tracking back to the marketplace for you.",
  },
  {
    icon: Wallet,
    title: "Transparent wallet",
    body: "A prepaid wallet with clear per-order charges and instant payouts. No surprises.",
  },
]

const steps = [
  { n: "01", title: "Connect your stores", body: "OAuth into Etsy, Shopify or TikTok Shop in about two minutes." },
  { n: "02", title: "Upload your designs", body: "Map artwork to products once — we handle placement and print files." },
  { n: "03", title: "We fulfill, hands-off", body: "Print, pack, ship, and track. You just watch orders go out." },
]

export default function MarketingHome() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-20 text-center sm:pt-28">
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Print-on-demand fulfillment
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-extrabold tracking-tight text-balance sm:text-6xl">
          Every order, <span className="text-primary">shipped for you.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground text-pretty">
          Etsy, Shopify & TikTok orders sync into one queue, print on a vetted network, and ship with
          tracking pushed back — completely hands off.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            Start free
          </Link>
          <Link href="/#how" className={buttonVariants({ variant: "outline", size: "lg" })}>
            See how it works
          </Link>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">Syncs with Etsy · Shopify · TikTok Shop</p>

        {/* App preview placeholder */}
        <div className="mx-auto mt-16 max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex h-9 items-center gap-1.5 border-b border-border px-4">
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          </div>
          <div className="aspect-[16/9] bg-gradient-to-br from-muted to-background" />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight">Everything after the sale, handled.</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            From the moment an order lands to the tracking number your buyer sees.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => {
              const Icon = f.icon
              return (
                <Card key={f.title} className="gap-3 p-6">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon size={20} weight="duotone" />
                  </span>
                  <div className="text-base font-semibold">{f.title}</div>
                  <p className="text-sm text-muted-foreground">{f.body}</p>
                </Card>
              )
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-3xl font-bold tracking-tight">Live in three steps.</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n}>
              <div className="text-sm font-bold text-primary">{s.n}</div>
              <div className="mt-2 text-lg font-semibold">{s.title}</div>
              <p className="mt-1.5 text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-20 text-center">
          <h2 className="max-w-2xl text-4xl font-extrabold tracking-tight">
            Ready to put fulfillment on autopilot?
          </h2>
          <p className="max-w-xl text-muted-foreground">
            Connect a store and send your first hands-off order today.
          </p>
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            Start free
          </Link>
        </div>
      </section>
    </>
  )
}
