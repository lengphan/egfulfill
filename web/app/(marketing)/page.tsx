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
import { getSiteContent, DEFAULT_SITE_CONTENT } from "@/lib/site-content"

/* Hover: a soft lift, a brand-tinted border, and a glow the same hue as the accent.
   Kept to one definition so the feature cards can't drift apart, and to transform +
   shadow only — animating those doesn't force layout on every frame the way animating
   size or margin would. */
const CARD_HOVER =
  "group transition-all duration-200 hover:-translate-y-0.5 " +
  "hover:border-primary/40 hover:shadow-[0_14px_40px_-20px_var(--primary)]"

// The bento's four cards each carry bespoke decoration (chips, a wallet figure) and grid
// span, so the layout owns exactly four fixed slots — only the title/body of each is
// editable. Read a slot's copy from stored content, falling back per-slot to the default so
// a short saved array can never leave a card textless.
const featureCard = (cards: { title: string; body: string }[], i: number) =>
  cards[i] ?? DEFAULT_SITE_CONTENT.features.cards[i]

export default async function MarketingHome() {
  const content = await getSiteContent()
  const { hero, stats, features, steps, testimonials, faq, cta } = content
  return (
    <>
      {/* ── Hero ── */}
      <section className="eg-hero relative isolate overflow-hidden">
        {/* Light surface, at the user's request — so it is a THEMED section now, not a
            fixed brand plate. It uses bg-background rather than a hard white so dark mode
            still inverts with the rest of the site instead of staying stuck white. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-background">
          {/* One restrained wash of brand colour, so the section isn't purely monotone.
              Weaker than on the old black plate: the same opacity that read as a glow on
              near-black reads as a smudge on white. */}
          <div
            className="absolute left-1/2 top-[-10%] h-[520px] w-[820px] -translate-x-1/2 rounded-full blur-[130px] opacity-[0.18]"
            style={{ background: "radial-gradient(circle at center, oklch(0.55 0.19 285 / 0.55), transparent 70%)" }}
          />
          {/* Optional admin-set banner image (Settings › Site content). Sits under a scrim so
              the dark hero text stays legible on any photo; absent, only the gradient shows. */}
          {hero.image && (
            <>
              <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${hero.image}")` }} />
              <div className="absolute inset-0 bg-background/72" />
            </>
          )}
        </div>

        <div className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center sm:pt-28">
          <Reveal delay={0}>
            <h1 className="mx-auto max-w-4xl font-display text-6xl font-semibold leading-[1.02] tracking-tight text-balance text-foreground sm:text-7xl">
              {hero.headline} <span className="italic text-primary">{hero.accent}</span>
            </h1>
          </Reveal>

          <Reveal delay={0.08}>
            <p className="mx-auto mt-7 max-w-2xl text-lg text-muted-foreground text-pretty">
              {hero.subhead}
            </p>
          </Reveal>

          <Reveal delay={0.16}>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/login" className={buttonVariants({ size: "lg" })}>
                {hero.ctaPrimary} <ArrowRight size={16} weight="bold" />
              </Link>
              {/* No override any more: the outline variant is themed for a light surface,
                  which is what this now is. */}
              <Link href="/how-it-works" className={buttonVariants({ variant: "outline", size: "lg" })}>
                {hero.ctaSecondary}
              </Link>
            </div>
          </Reveal>

          {/* integration row */}
          <Reveal delay={0.32}>
            <div className="mt-12 flex flex-col items-center gap-3">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {hero.worksWithLabel}
              </span>
              <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-lg font-semibold text-foreground/70">
                {hero.integrations.map((name, i) => (
                  <span key={name} className="contents">
                    {i > 0 && <span className="text-foreground/25">·</span>}
                    <span>{name}</span>
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stats band ── */}
      <section className="border-y border-border bg-muted/30">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 md:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal key={`${s.label}-${i}`} delay={i * 0.08} className="text-center">
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
            {features.heading}
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {features.subhead}
          </p>
        </Reveal>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {/* wide */}
          <Reveal delay={0} className="md:col-span-2">
          <Card className={"gap-3 p-7 " + CARD_HOVER}>
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
              <PlugsConnected size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">{featureCard(features.cards, 0).title}</div>
            <p className="max-w-md text-sm text-muted-foreground">
              {featureCard(features.cards, 0).body}
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
          <Card className={"gap-3 p-7 " + CARD_HOVER}>
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
              <Printer size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">{featureCard(features.cards, 1).title}</div>
            <p className="text-sm text-muted-foreground">
              {featureCard(features.cards, 1).body}
            </p>
          </Card>
          </Reveal>
          {/* narrow */}
          <Reveal delay={0.16}>
          <Card className={"gap-3 p-7 " + CARD_HOVER}>
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
              <Truck size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">{featureCard(features.cards, 2).title}</div>
            <p className="text-sm text-muted-foreground">
              {featureCard(features.cards, 2).body}
            </p>
          </Card>
          </Reveal>
          {/* wide */}
          <Reveal delay={0.24} className="md:col-span-2">
          <Card className={"gap-3 p-7 " + CARD_HOVER}>
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
              <Wallet size={22} weight="duotone" />
            </span>
            <div className="text-lg font-semibold">{featureCard(features.cards, 3).title}</div>
            <p className="max-w-md text-sm text-muted-foreground">
              {featureCard(features.cards, 3).body}
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
            <h2 className="font-display text-4xl font-semibold tracking-tight">{steps.heading}</h2>
          </Reveal>
          <div className="relative mt-12 grid gap-10 md:grid-cols-3">
            {/* connector line */}
            <div
              aria-hidden
              className="absolute left-0 right-0 top-5 hidden h-px bg-border md:block"
            />
            {steps.items.map((s, i) => (
              <Reveal key={`${s.n}-${i}`} delay={i * 0.1} className="relative">
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
            {testimonials.heading}
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {testimonials.items.map((t, i) => (
            <Reveal key={`${t.name}-${i}`} delay={i * 0.1}>
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
            <h2 className="text-center font-display text-4xl font-semibold tracking-tight">{faq.heading}</h2>
          </Reveal>
          <Accordion multiple={false} className="mt-10 w-full">
            {faq.items.map((f, i) => (
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
            {cta.heading}
          </h2>
          <p className="max-w-xl text-background/70">
            {cta.subhead}
          </p>
          <Link
            href="/login"
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {cta.button} <ArrowRight size={16} weight="bold" />
          </Link>
        </Reveal>
      </section>
    </>
  )
}
