import Link from "next/link"
import { Check } from "@phosphor-icons/react/dist/ssr"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

const included = [
  "Unlimited store connections (Etsy, Shopify, TikTok)",
  "Automatic order sync into one queue",
  "Vetted print network with per-stage QC",
  "Cheapest-label shipping + tracking pushed back",
  "Prepaid wallet with per-order transparency",
  "Design library & mini designer",
]

const examples = [
  { name: "Classic tee", price: "$8.90" },
  { name: "Heavyweight hoodie", price: "$22.00" },
  { name: "Embroidered cap", price: "$12.50" },
  { name: "Ceramic mug 15oz", price: "$6.40" },
]

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center">
        <h1 className="font-display text-5xl font-semibold tracking-tight sm:text-6xl">Simple, pay-as-you-go.</h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          No monthly fee. No minimums. You only pay the per-order fulfillment cost when an order actually
          ships — funded from your wallet.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-4xl gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* What's included */}
        <Card className="gap-0 p-8">
          <div className="text-sm font-semibold uppercase tracking-wide text-primary">Everything, included</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-5xl font-extrabold tracking-tight">$0</span>
            <span className="text-muted-foreground">/ month to start</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            The platform is free. You pay per fulfilled order — that&apos;s it.
          </p>
          <ul className="mt-6 space-y-3">
            {included.map((i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <Check size={18} weight="bold" className="mt-0.5 shrink-0 text-primary" />
                <span>{i}</span>
              </li>
            ))}
          </ul>
          <Link href="/login" className={buttonVariants({ size: "lg", className: "mt-8 w-full" })}>
            Start free
          </Link>
        </Card>

        {/* Example per-order costs */}
        <Card className="gap-0 p-8">
          <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Example base costs
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Blank + print, before shipping. Final price depends on product, placement and method.
          </p>
          <ul className="mt-6 divide-y divide-border">
            {examples.map((e) => (
              <li key={e.name} className="flex items-center justify-between py-3 text-sm">
                <span>{e.name}</span>
                <span className="font-semibold tabular-nums">{e.price}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-muted-foreground">
            Shipping is bought at the cheapest available rate and billed at cost.
          </p>
        </Card>
      </div>
    </div>
  )
}
