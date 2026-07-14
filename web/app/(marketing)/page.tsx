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
import { Reveal } from "@/components/motion/reveal"

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
      <section className="relative isolate overflow-hidden">
        {/* soft drifting aura — on-theme, slowly moving, clean */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div
            className="eg-drift-1 absolute left-[10%] top-[-14%] h-[460px] w-[580px] rounded-full blur-[120px]"
            style={{ background: "radial-gradient(circle at center, oklch(0.62 0.2 285 / 0.30), transparent 68%)" }}
          />
          <div
            className="eg-drift-2 absolute right-[6%] top-[-8%] h-[420px] w-[520px] rounded-full blur-[120px]"
            style={{ background: "radial-gradient(circle at center, oklch(0.68 0.16 305 / 0.22), transparent 68%)" }}
          />
          <div
            className="eg-drift-3 absolute left-[36%] top-[12%] h-[400px] w-[500px] rounded-full blur-[130px]"
            style={{ background: "radial-gradient(circle at center, oklch(0.7 0.12 245 / 0.18), transparent 70%)" }}
          />
        </div>

        <div className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center sm:pt-28">
          <Reveal delay={0}>
            <h1 className="mx-auto max-w-4xl font-display text-6xl font-semibold leading-[1.02] tracking-tight text-balance sm:text-7xl">
              What if every order <span className="text-primary italic">printed itself?</span>
            </h1>
          </Reveal>

          <Reveal delay={0.08}>
            <p className="mx-auto mt-7 max-w-2xl text-lg text-muted-foreground text-pretty">
              Etsy, Shopify & TikTok orders sync into one queue, print on a vetted network, and ship with
              tracking pushed back — completely hands off.
            </p>
          </Reveal>

          <Reveal delay={0.16}>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/login" className={buttonVariants({ size: "lg" })}>
                Start for free <ArrowRight size={16} weight="bold" />
              </Link>
              <Link href="/how-it-works" className={buttonVariants({ variant: "outline", size: "lg" })}>
                See how it works
              </Link>
            </div>
          </Reveal>

          {/* avatar-stack social proof */}
          <Reveal delay={0.24}>
            <div className="mt-8 flex items-center justify-center gap-3">
              <div className="flex -space-x-2.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="size-8 rounded-full bg-muted ring-2 ring-background"
                    aria-hidden
                  />
                ))}
              </div>
              <div className="text-left">
                <div className="text-sm text-amber-500">★★★★★</div>
                <div className="text-xs text-muted-foreground">2,400+ sellers shipping hands-off</div>
              </div>
            </div>
          </Reveal>

          {/* integration row */}
          <Reveal delay={0.32}>
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
          </Reveal>
        </div>
      </section>

      {/* ── Stats band ── */}
      <section className="border-y border-border bg-muted/30">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 md:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.08} className="text-center">
              <div className="font-display text-4xl font-semibold tracking-tight">{s.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Bento features ── */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <Reveal>
          <h2 className="max-w-2xl font-display text-4xl font-semibold tracking-tight">
            Everything after the sale, handled.
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            From the moment an order lands to the tracking number your buyer sees.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {/* wide */}
          <Reveal delay={0} className="md:col-span-2">
          <Card className="gap-3 p-7">
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
          </Reveal>
          {/* narrow */}
          <Reveal delay={0.08}>
          <Card className="gap-3 p-7">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Printer size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">Vetted print network</div>
            <p className="text-sm text-muted-foreground">
              Quality-checked partners with QC at every stage — not a black box.
            </p>
          </Card>
          </Reveal>
          {/* narrow */}
          <Reveal delay={0.16}>
          <Card className="gap-3 p-7">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Truck size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">Tracking, automatic</div>
            <p className="text-sm text-muted-foreground">
              Cheapest label bought and tracking pushed back to the marketplace for you.
            </p>
          </Card>
          </Reveal>
          {/* wide */}
          <Reveal delay={0.24} className="md:col-span-2">
          <Card className="gap-3 p-7">
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
          </Reveal>
        </div>
      </section>

      {/* ── Pipeline / how it works ── */}
      <section id="how" className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <h2 className="font-display text-4xl font-semibold tracking-tight">Live in three steps.</h2>
          </Reveal>
          <div className="relative mt-12 grid gap-10 md:grid-cols-3">
            {/* connector line */}
            <div
              aria-hidden
              className="absolute left-0 right-0 top-5 hidden h-px bg-border md:block"
            />
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.1} className="relative">
                <div className="flex size-10 items-center justify-center rounded-full border border-primary/30 bg-background font-display text-sm font-semibold text-primary">
                  {s.n}
                </div>
                <div className="mt-4 text-lg font-semibold">{s.title}</div>
                <p className="mt-1.5 text-muted-foreground">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <Reveal>
          <h2 className="max-w-2xl font-display text-4xl font-semibold tracking-tight">
            Sellers who stopped touching orders.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {testimonials.map((t, i) => (
            <Reveal key={t.name} delay={i * 0.1}>
            <Card className="gap-4 p-7">
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
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <Reveal>
            <h2 className="text-center font-display text-4xl font-semibold tracking-tight">Questions, answered.</h2>
          </Reveal>
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
        <Reveal className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-24 text-center">
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
        </Reveal>
      </section>
    </>
  )
}
