import Link from "next/link"
import {
  TShirt,
  Baseball,
  Coffee,
  Handbag,
  PenNib,
  Needle,
  Drop,
  Stack,
  ArrowRight,
} from "@phosphor-icons/react/dist/ssr"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Reveal } from "@/components/motion/reveal"

const categories = [
  {
    icon: TShirt,
    name: "Apparel",
    blurb: "Tees, hoodies, crewnecks & long sleeves from trusted blanks.",
    items: ["Classic tee — from $8.90", "Heavyweight hoodie — from $22.00", "Crewneck — from $18.00"],
  },
  {
    icon: Baseball,
    name: "Headwear",
    blurb: "Dad hats, snapbacks and beanies — embroidered or printed.",
    items: ["Classic dad hat — from $12.50", "Structured snapback — from $14.00", "Cuffed beanie — from $11.00"],
  },
  {
    icon: Coffee,
    name: "Drinkware",
    blurb: "Ceramic mugs and tumblers, full-wrap sublimation.",
    items: ["Ceramic mug 11oz — from $5.40", "Ceramic mug 15oz — from $6.40", "Tumbler 20oz — from $14.00"],
  },
  {
    icon: Handbag,
    name: "Bags & accessories",
    blurb: "Totes, pouches and more — natural and colored canvas.",
    items: ["Canvas tote — from $9.00", "Zip pouch — from $8.50", "Drawstring bag — from $7.50"],
  },
]

const methods = [
  { icon: PenNib, name: "DTG", blurb: "Direct-to-garment — full-color, photographic prints on cotton." },
  { icon: Needle, name: "Embroidery", blurb: "Stitched logos & designs with automatic thread-color matching." },
  { icon: Drop, name: "Sublimation", blurb: "Edge-to-edge, fade-proof color on mugs, polyester & hard goods." },
  { icon: Stack, name: "DTF", blurb: "Direct-to-film transfers — vivid on darks, blends and tri-blends." },
]

export default function CatalogPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <Reveal className="max-w-2xl">
        <div className="text-sm font-semibold uppercase tracking-wide text-primary">Catalog</div>
        <h1 className="mt-3 font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
          Everything you can sell.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground text-pretty">
          Map your artwork to blanks once — apparel, headwear, drinkware and more — and we print, pack and
          ship every order on a vetted network. Prices are per-item base costs, billed at fulfillment.
        </p>
      </Reveal>

      {/* categories */}
      <div className="mt-14 grid gap-5 md:grid-cols-2">
        {categories.map((c, i) => (
          <Reveal key={c.name} delay={(i % 2) * 0.08}>
            <Card className="h-full gap-4 p-7">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <c.icon size={22} weight="duotone" />
                </span>
                <div className="text-lg font-semibold">{c.name}</div>
              </div>
              <p className="text-sm text-muted-foreground">{c.blurb}</p>
              <ul className="mt-1 space-y-1.5">
                {c.items.map((it) => (
                  <li key={it} className="flex items-center justify-between border-b border-border/60 pb-1.5 text-sm last:border-0">
                    <span className="text-foreground/80">{it.split(" — ")[0]}</span>
                    <span className="font-medium tabular-nums text-muted-foreground">{it.split(" — ")[1]}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        ))}
      </div>

      {/* print methods */}
      <Reveal className="mt-20">
        <h2 className="font-display text-3xl font-semibold tracking-tight">Four print methods, one queue.</h2>
        <p className="mt-2 max-w-xl text-muted-foreground">We pick the right method for each product automatically.</p>
      </Reveal>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {methods.map((m, i) => (
          <Reveal key={m.name} delay={(i % 4) * 0.06}>
            <Card className="h-full gap-3 p-6">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <m.icon size={20} weight="duotone" />
              </span>
              <div className="font-semibold">{m.name}</div>
              <p className="text-sm text-muted-foreground">{m.blurb}</p>
            </Card>
          </Reveal>
        ))}
      </div>

      {/* CTA */}
      <Reveal className="mt-20 flex flex-col items-center gap-5 rounded-3xl border border-border bg-muted/40 px-6 py-14 text-center">
        <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight">
          Connect a store and start selling these today.
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            Start for free <ArrowRight size={16} weight="bold" />
          </Link>
          <Link href="/pricing" className={buttonVariants({ variant: "outline", size: "lg" })}>
            See pricing
          </Link>
        </div>
      </Reveal>
    </div>
  )
}
