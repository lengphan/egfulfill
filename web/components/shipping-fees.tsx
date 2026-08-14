"use client"

/**
 * WHAT SHIPPING COSTS, next to what the garment costs.
 *
 * Every price on this platform was quoted alone — "$13.50 per item" — while the seller is
 * actually charged the garment PLUS a parcel: one fee for the first unit, a smaller one for
 * every additional unit in the same box. So the number people were reading and planning
 * their retail price against was never the number they would be billed, and the difference
 * only appeared at submit.
 *
 * Two lines, because there are exactly two facts. It is not a pricing table with bands and
 * exceptions — bands exist in pricing.js and are chosen by weight at quote time, which is
 * not something anyone can act on while looking at a product.
 *
 * ONE COMPONENT, TWO SKINS. The app and the marketing site have different type and colour
 * systems (shadcn tokens vs the bold kit's ink-on-paper), and a component that renders app
 * tokens on the marketing page reads as a stray widget. What must NOT differ is the
 * numbers or the wording, which is why this is one file and not two.
 */
export function ShippingFees({
  first, extra, tone = "app", className = "",
}: {
  first: number
  extra: number
  /** "app" — shadcn tokens on a card. "marketing" — ink on paper, bold kit. */
  tone?: "app" | "marketing"
  className?: string
}) {
  // Nothing to say rather than "$0.00 shipping", which reads as free postage and isn't —
  // it means nobody has set the platform's shipping fees yet.
  if (!(first > 0) && !(extra > 0)) return null
  const usd = (n: number) => `$${n.toFixed(2)}`
  const marketing = tone === "marketing"

  const rows = [
    { label: "First item", value: usd(first), note: "one order is one parcel" },
    { label: "Each item after", value: usd(extra), note: "in the same parcel" },
  ]

  return (
    <div
      className={
        (marketing
          ? "rounded-2xl border border-black/[0.09] px-5 py-4"
          : "rounded-xl border border-border bg-card px-4 py-3") + " " + className
      }
    >
      <div
        className={
          marketing
            ? "text-xs font-bold uppercase tracking-[0.18em] text-black/45"
            : "text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
        }
      >
        Shipping
      </div>
      <dl className={marketing ? "mt-3 space-y-2" : "mt-2 space-y-1.5"}>
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4">
            <dt className={marketing ? "text-sm text-black/70" : "text-xs text-muted-foreground"}>
              {r.label}
              {/* The qualifier earns its place: "each item after" is meaningless without
                  "in the same parcel", and that is the whole reason the second number is
                  smaller than the first. */}
              <span className={marketing ? " text-black/40" : " text-muted-foreground/70"}> · {r.note}</span>
            </dt>
            <dd className={marketing ? "text-sm font-black tabular-nums" : "text-sm font-semibold tabular-nums"}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
