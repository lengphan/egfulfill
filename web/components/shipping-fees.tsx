"use client"

import type { ShipBands } from "@/lib/api"

/**
 * WHAT SHIPPING COSTS, next to what the garment costs.
 *
 * Every price on this platform was quoted alone — "$13.50 per item" — while the seller is
 * actually charged the garment PLUS a parcel: one fee for the first unit, a smaller one for
 * every additional unit in the same box. So the number people were reading and planning
 * their retail price against was never the number they would be billed, and the difference
 * only appeared at submit.
 *
 * THE FIRST ITEM'S FEE DEPENDS ON THE GARMENT. This used to print one flat platform figure
 * for every product on every screen, which was wrong twice over: a cap and a hoodie do not
 * ship for the same money, and the number being printed was a setting pricing.js could not
 * even reach — one of the three garment bands always applied, so no invoice ever contained
 * it. The comment here previously said bands were "not something anyone can act on while
 * looking at a product". On a product it is exactly what you can act on; on a whole
 * catalogue it is the three-row answer. Hence two modes:
 *
 *   `first`  — one resolved fee. Use where the product is known: its own fee if it carries
 *              one, otherwise its band. This is what the order will charge.
 *   `bands`  — the three classes. Use where many products are in view and no single number
 *              is true for all of them.
 *
 * ONE COMPONENT, TWO SKINS. The app and the marketing site have different type and colour
 * systems (shadcn tokens vs the bold kit's ink-on-paper), and a component that renders app
 * tokens on the marketing page reads as a stray widget. What must NOT differ is the
 * numbers or the wording, which is why this is one file and not two.
 */
export function ShippingFees({
  first, bands, extra, tone = "app", className = "",
}: {
  /** A single resolved first-item fee — when the product is known. */
  first?: number | null
  /** The three garment bands — when it isn't. Ignored if `first` is given. */
  bands?: ShipBands | null
  extra: number
  /** "app" — shadcn tokens on a card. "marketing" — ink on paper, bold kit. */
  tone?: "app" | "marketing"
  className?: string
}) {
  const usd = (n: number) => `$${n.toFixed(2)}`
  const marketing = tone === "marketing"

  // The first-item rows. `first` wins: a known product's own number beats a table of
  // classes it belongs to one of. Zero-value bands are dropped rather than shown as
  // "$0.00", which reads as free postage for that class and isn't — it means unset.
  const firstRows =
    first != null && first > 0
      ? [{ label: "First item", value: usd(first) }]
      : bands
        ? ([
            ["Caps & hats", bands.cap],
            ["Sweatshirts, hoodies, jackets", bands.heavy],
            ["All other garments", bands.garment],
          ] as const)
            .filter(([, v]) => v > 0)
            .map(([label, v]) => ({ label, value: usd(v) }))
        : []

  const rows = [...firstRows, ...(extra > 0 ? [{ label: "Additional item", value: usd(extra) }] : [])]

  // Nothing to say rather than "$0.00 shipping", which reads as free postage and isn't —
  // it means nobody has set the platform's shipping fees yet.
  if (!rows.length) return null

  return (
    <div
      className={
        (marketing
          /* THE MARKETING BLOCK IS A SURFACE, NOT AN OUTLINE. It was a bordered box with
             black-literal ink — one more of the outlined cards §4 is removing, and a colour
             the runtime skin could not reach. White on the product page's paper separates by
             VALUE, which is the whole depth model on that side of the product. */
          ? "rounded-[26px] bg-[var(--mk-card)] px-5 py-4"
          : "rounded-xl border border-border bg-card px-4 py-3") + " " + className
      }
    >
      <div
        className={
          marketing
            ? "text-xs font-bold uppercase tracking-[0.18em] text-[var(--mk-ink)]/50"
            : "text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
        }
      >
        Shipping
      </div>
      <dl className={marketing ? "mt-3 space-y-2" : "mt-2 space-y-1.5"}>
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4">
            <dt className={marketing ? "text-sm text-[var(--mk-ink)]/70" : "text-xs text-muted-foreground"}>
              {r.label}
            </dt>
            <dd className={/* semibold, not black — §4: display weight is semibold, and a fee is not a headline. */
              marketing ? "text-sm font-semibold tabular-nums" : "text-sm font-semibold tabular-nums"}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      {/* Only when the rows ARE the bands. Beside one product the label already says which
          number applies; beside three it does not, and "why is my hoodie dearer" is the
          question this sentence exists to answer before it is asked. */}
      {firstRows.length > 1 && (
        <p className={marketing ? "mt-3 text-xs text-[var(--mk-ink)]/50" : "mt-2 text-2xs text-muted-foreground"}>
          The first item is charged at its garment&rsquo;s rate. A product with its own
          shipping fee uses that instead.
        </p>
      )}
    </div>
  )
}
