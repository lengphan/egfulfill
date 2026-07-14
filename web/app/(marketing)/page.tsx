import Link from "next/link"
import {
  PlugsConnected,
  Printer,
  Truck,
  Wallet,
  ArrowRight,
} from "@phosphor-icons/react/dist/ssr"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

const stats = [
  { value: "2.4M+", label: "orders shipped" },
  { value: "3", label: "marketplaces synced" },
  { value: "99.2%", label: "on-time fulfillment" },
  { value: "48hrs", label: "avg to doorstep" },
]

const steps = [
  { n: "01", title: "Connect your stores", body: "OAuth into Etsy, Shopify or TikTok Shop in about two minutes." },
  { n: "02", title: "Upload your designs", body: "Map artwork to products once — we handle placement and print files." },
  { n: "03", title: "We fulfill, hands-off", body: "Print, pack, ship, and track. You just watch orders go out." },
]

const testimonials = [
  {
    quote:
      "I went from spending three hours a day on orders to basically zero. They just ship. I check tracking sometimes for fun.",
    name: "Maya R.",
    role: "Etsy · 4k orders/mo",
  },
  {
    quote:
      "The wallet made it click for me — I can see exactly what each order costs before it prints. No mystery invoices.",
    name: "Devon K.",
    role: "Shopify apparel",
  },
  {
    quote:
      "TikTok Shop blew up overnight and egfulfill just absorbed it. Same queue, same flow, tracking pushed back automatically.",
    name: "Priya S.",
    role: "TikTok Shop",
  },
]

const faqs = [
  {
    q: "Which marketplaces do you sync with?",
    a: "Etsy, Shopify, TikTok Shop and WooCommerce today, with more on the way. Orders flow into one queue automatically and tracking is pushed back to each marketplace.",
  },
  {
    q: "Is there a monthly fee?",
    a: "No. The platform is free — you only pay the per-order fulfillment cost when an order ships, funded from your prepaid wallet.",
  },
  {
    q: "How does shipping pricing work?",
    a: "We rate-shop across carriers and buy the cheapest available label, billed at cost. You always see the exact charge on each order.",
  },
  {
    q: "Can I use my own designs?",
    a: "Yes. Upload artwork to your library, map it to products once, and our mini designer handles placement and print-ready files.",
  },
  {
    q: "What about quality control?",
    a: "Every order is quality-checked at each stage on a vetted print network — intake, print, and pack — before it ships.",
  },
]

export default function MarketingHome() {
  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* dot-grid texture */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            maskImage: "radial-gradient(ellipse 70% 55% at 50% 30%, black, transparent)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 55% at 50% 30%, black, transparent)",
          }}
        />
        {/* violet glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-120px] -z-10 h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-primary/20 blur-[130px]"
        />

        <div className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center sm:pt-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-primary" />
            TikTok Shop sync is live
          </span>

          <h1 className="mx-auto mt-7 max-w-4xl font-display text-6xl font-semibold leading-[1.02] tracking-tight text-balance sm:text-7xl">
            What if every order <span className="text-primary italic">printed itself?</span>
          </h1>

          <p className="mx-auto mt-7 max-w-2xl text-lg text-muted-foreground text-pretty">
            Etsy, Shopify & TikTok orders sync into one queue, print on a vetted network, and ship with
            tracking pushed back — completely hands off.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className={buttonVariants({ size: "lg" })}>
              Start for free <ArrowRight size={16} weight="bold" />
            </Link>
            <Link href="/#how" className={buttonVariants({ variant: "outline", size: "lg" })}>
              See how it works
            </Link>
          </div>

          {/* integration row */}
          <div className="mt-12 flex flex-col items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Works with
            </span>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-lg font-semibold text-muted-foreground/70">
              <span>Etsy</span>
              <span className="text-muted-foreground/30">·</span>
              <span>Shopify</span>
              <span className="text-muted-foreground/30">·</span>
              <span>TikTok Shop</span>
              <span className="text-muted-foreground/30">·</span>
              <span>WooCommerce</span>
            </div>
          </div>

          {/* app preview */}
          <div className="mx-auto mt-16 max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-primary/5">
            <div className="flex h-9 items-center gap-1.5 border-b border-border px-4">
              <span className="size-2.5 rounded-full bg-muted-foreground/25" />
              <span className="size-2.5 rounded-full bg-muted-foreground/25" />
              <span className="size-2.5 rounded-full bg-muted-foreground/25" />
            </div>
            <div className="aspect-[16/9] bg-gradient-to-br from-primary/5 via-muted to-background" />
          </div>
        </div>
      </section>

      {/* ── Stats band ── */}
      <section className="border-y border-border bg-muted/30">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-display text-4xl font-semibold tracking-tight">{s.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Bento features ── */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="max-w-2xl font-display text-4xl font-semibold tracking-tight">
          Everything after the sale, handled.
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          From the moment an order lands to the tracking number your buyer sees.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {/* wide */}
          <Card className="gap-3 p-7 md:col-span-2">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <PlugsConnected size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">Every store, one queue</div>
            <p className="max-w-md text-sm text-muted-foreground">
              Orders from Etsy, Shopify & TikTok Shop sync in automatically — no CSV exports, no
              copy-paste, no missed orders.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {["Etsy #4142", "Shopify #8821", "TikTok #2093"].map((t) => (
                <span key={t} className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          </Card>
          {/* narrow */}
          <Card className="gap-3 p-7">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Printer size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">Vetted print network</div>
            <p className="text-sm text-muted-foreground">
              Quality-checked partners with QC at every stage — not a black box.
            </p>
          </Card>
          {/* narrow */}
          <Card className="gap-3 p-7">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Truck size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">Tracking, automatic</div>
            <p className="text-sm text-muted-foreground">
              Cheapest label bought and tracking pushed back to the marketplace for you.
            </p>
          </Card>
          {/* wide */}
          <Card className="gap-3 p-7 md:col-span-2">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Wallet size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">Transparent wallet</div>
            <p className="max-w-md text-sm text-muted-foreground">
              A prepaid wallet with clear per-order charges and instant payouts. Always know exactly what
              you paid and why.
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-3xl font-semibold tracking-tight">$12,480.00</span>
              <span className="text-sm font-medium text-emerald-600">▲ ready to fulfill</span>
            </div>
          </Card>
        </div>
      </section>

      {/* ── Pipeline / how it works ── */}
      <section id="how" className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="font-display text-4xl font-semibold tracking-tight">Live in three steps.</h2>
          <div className="relative mt-12 grid gap-10 md:grid-cols-3">
            {/* connector line */}
            <div
              aria-hidden
              className="absolute left-0 right-0 top-5 hidden h-px bg-border md:block"
            />
            {steps.map((s) => (
              <div key={s.n} className="relative">
                <div className="flex size-10 items-center justify-center rounded-full border border-primary/30 bg-background font-display text-sm font-semibold text-primary">
                  {s.n}
                </div>
                <div className="mt-4 text-lg font-semibold">{s.title}</div>
                <p className="mt-1.5 text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="max-w-2xl font-display text-4xl font-semibold tracking-tight">
          Sellers who stopped touching orders.
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {testimonials.map((t) => (
            <Card key={t.name} className="gap-4 p-7">
              <div className="font-display text-4xl leading-[0.5] text-primary">&ldquo;</div>
              <p className="text-sm leading-relaxed text-foreground/90">{t.quote}</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="size-9 shrink-0 rounded-full bg-muted" aria-hidden />
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <h2 className="text-center font-display text-4xl font-semibold tracking-tight">Questions, answered.</h2>
          <Accordion multiple={false} className="mt-10 w-full">
            {faqs.map((f, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── Inverted dark CTA ── */}
      <section className="bg-foreground text-background">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-24 text-center">
          <h2 className="max-w-2xl font-display text-5xl font-semibold tracking-tight text-balance">
            Ready to put fulfillment on autopilot?
          </h2>
          <p className="max-w-xl text-background/70">
            Connect a store and send your first hands-off order today. No monthly fee.
          </p>
          <Link
            href="/login"
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Start for free <ArrowRight size={16} weight="bold" />
          </Link>
        </div>
      </section>
    </>
  )
}
