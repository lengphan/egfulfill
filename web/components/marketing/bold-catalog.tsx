"use client"

import Image from "next/image"
import Link from "next/link"
import { TShirt } from "@phosphor-icons/react"
import { ACCENT, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"
import { ShippingFees } from "@/components/shipping-fees"
import type { ShipBands } from "@/lib/api"
import type { PublicProduct } from "@/lib/api"
import { framingStyle } from "@/lib/product-framing"

/**
 * Products, showing the REAL catalogue rather than a written-out list of categories.
 *
 * The old page listed four categories with hand-typed example prices, which drift the moment
 * anyone edits the catalogue — and quietly become wrong rather than visibly missing. These
 * cards come from the published products themselves, so the page is right by construction and
 * an admin publishing a product IS the act of putting it on the marketing site.
 *
 * When nothing is published the page says so plainly instead of rendering an empty grid that
 * looks like a broken query. That distinction is the house rule: a thing that can't be read
 * must not look like a thing that doesn't exist.
 */
/** A colour name to a swatch, for colourways with no photo of their own. Unknown names get
 *  a neutral rather than a guess — a wrong colour chip is worse than a plain one. */
const SWATCH: Record<string, string> = {
  black: "#191918", white: "#f4f2ef", navy: "#25314d", grey: "#9ca3af", gray: "#9ca3af",
  "sport grey": "#b7b7b3", heather: "#b9b6b0", sand: "#d8cbb4", natural: "#e8e0cf",
  maroon: "#6d2233", red: "#c0392b", royal: "#2f4bf0", blue: "#3457d5", green: "#3f7d4e",
  forest: "#2f5540", pink: "#e59bb4", khaki: "#c3b091", gold: "#d4a017", purple: "#6d4aec",
  charcoal: "#36454f", cream: "#fffdd0", olive: "#708238", tan: "#d2b48c",
}
const swatchOf = (name: string) => SWATCH[name.toLowerCase().trim()] ?? "#c7c4bd"

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function BoldCatalog({ products, shipping }: {
  products: PublicProduct[] | null
  /** What a seller pays to send a parcel — first unit, then each extra in the same box.
   *  Shown once for the whole grid rather than on every card: it is one platform fee, and
   *  repeating it 24 times would read as a per-product charge. */
  shipping?: { bands: ShipBands; extra: number } | null
}) {
  // null = the catalogue could not be READ; [] = it is genuinely empty. The house rule is
  // that those two must never look the same, so the caller distinguishes them and this
  // renders each honestly.
  const failed = products === null
  const list = products ?? []
  // Group by category so a long list reads as a catalogue rather than a wall. Anything
  // without one collects under "More" instead of being dropped.
  const groups = new Map<string, PublicProduct[]>()
  for (const p of list) {
    const k = p.category?.trim() || "More"
    groups.set(k, [...(groups.get(k) ?? []), p])
  }
  // GROUPING HAS TO EARN ITS KEEP. Each heading is display-sized, so a category holding one
  // product produced a giant title above a single card with three empty cells beside it —
  // four of those in a row made a young catalogue look broken rather than small. Below the
  // threshold everything renders as one dense grid, which reads as deliberate at four
  // products and still scales, because the headings return the moment there is enough to
  // sort. Category is not lost: it stays on the card.
  const grouped = list.length >= 8 && [...groups.values()].filter((g) => g.length > 1).length >= 2
  const sections: [string, PublicProduct[]][] = grouped ? [...groups.entries()] : [["", list]]

  return (
    <div className="text-[#0B0B0C]" style={{ background: SURFACE }}>
      <PlateHero
        title="What we"
        accent="can make."
        sub="Live from our catalogue — every product here is one you can order today, at the price shown."
      />

      <section className="mx-auto max-w-6xl px-6 py-16">
        {failed ? (
          <Rise className="rounded-2xl border border-black/[0.09] bg-white px-8 py-16 text-center">
            <h2 className="text-xl font-bold tracking-tight">We couldn&apos;t load the catalogue</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-black/55">
              This is a problem on our side, not an empty catalogue — please try again shortly.
            </p>
          </Rise>
        ) : list.length === 0 ? (
          <Rise className="rounded-2xl border border-black/[0.09] bg-white px-8 py-16 text-center">
            <h2 className="text-xl font-bold tracking-tight">The catalogue isn&apos;t published yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-black/55">
              Products appear here as soon as they&apos;re published. Nothing is hidden — there is
              simply nothing to show yet.
            </p>
          </Rise>
        ) : (
          sections.map(([cat, items], gi) => (
            <div key={cat || "all"} className={gi ? "mt-16" : ""}>
              {cat && <h2 className="font-display font-black leading-[0.95] tracking-[-0.035em]" style={HEADING}>{cat}</h2>}
              <div className={(cat ? "mt-8" : "") + " grid gap-5 sm:grid-cols-2 lg:grid-cols-3"}>
                {items.map((p, i) => (
                  /* Keyed by SLUG, not name. The server already disambiguated duplicate names
                     with an index suffix, so the slug is the unique one — two products sharing
                     a name collided on this key and React reconciled them as one card. */
                  <Rise key={p.slug} preset="bloom" index={Math.min(i, 6)}
                        className="group overflow-hidden rounded-2xl border border-black/[0.09] bg-white transition-colors hover:border-black/30">
                  <Link href={`/catalog/${p.slug}`} className="block">
                    {/* Square well, so a mixed catalogue (tees, mugs, caps) lines up. The
                        placeholder is the accent rather than a grey box — a product without a
                        photo should look unfinished, not broken. */}
                    <div className="relative aspect-square overflow-hidden" style={{ background: ACCENT }}>
                      {p.image ? (
                        /* The crop set in the product editor, on a WRAPPER rather than on the
                           image: the hover lift is a class-based transform and an inline one
                           would win against it, killing the lift on every framed product.
                           Same arrangement the staff grid uses. */
                        <div className="absolute inset-0" style={framingStyle(p)}>
                          <Image
                            src={p.image}
                            alt={p.name}
                            fill
                            unoptimized
                            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                        </div>
                      ) : (
                        <div className="flex size-full items-center justify-center text-[#FAF8F3]/45">
                          <TShirt size={40} weight="duotone" />
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      {/* When the page ISN'T split into category sections, the category
                          moves onto the card — so a single grid still tells you what each
                          thing is, and nothing is lost by dropping the headings. */}
                      {!grouped && p.category && (
                        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">{p.category}</div>
                      )}
                      <div className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.name}</div>
                      <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-lg font-black tabular-nums">{usd(p.price)}</span>
                      </div>
                      {/* Colour chips. The count alone ("6 colourways") is a fact you have to
                          imagine; the swatches are the thing a buyer actually shops by, and
                          they were only on the detail page. Capped at five so a 30-colour
                          style doesn't turn the card into a palette, with the remainder
                          stated rather than silently dropped. */}
                      {p.colors.length > 0 && (
                        <div className="mt-3 flex items-center gap-1.5">
                          {p.colors.slice(0, 5).map((c) => (
                            <span
                              key={c.name}
                              title={c.name}
                              className="size-4 rounded-full border border-black/15 bg-center"
                              /* A CLOSE CROP, not the whole photo. bg-cover scaled an entire
                                 garment-on-white shot into a 16px circle, so the chip showed a
                                 tiny shirt silhouette — mostly background — instead of the
                                 colour it exists to communicate. 340% centred lands inside the
                                 body of the garment, which is fabric on every product shot we
                                 hold, so the chip reads as a colour. A named colour still wins
                                 where we know the hex: it is exact, while a crop is a sample. */
                              style={
                                SWATCH[c.name.toLowerCase().trim()]
                                  ? { background: swatchOf(c.name) }
                                  : c.image
                                    ? { backgroundImage: `url(${c.image})`, backgroundSize: "340%" }
                                    : { background: swatchOf(c.name) }
                              }
                            />
                          ))}
                          {p.colors.length > 5 && (
                            <span className="text-[12px] font-medium text-black/45">+{p.colors.length - 5}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </Link>
                  </Rise>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* THE PARCEL, once, under the grid. Every price above is a garment; this is what
          it costs to send one, and leaving it to the checkout is how a quoted price stops
          matching a bill. Once for the page, not on every card — it is one platform fee,
          and 24 copies of it would read as a per-product charge. */}
      {shipping && (
        <section className="px-6 pb-14">
          <div className="mx-auto max-w-5xl">
            <ShippingFees bands={shipping.bands} extra={shipping.extra} tone="marketing" className="max-w-md" />
          </div>
        </section>
      )}

      <section className="px-6 pb-16">
        <Rise preset="settle" className="mx-auto max-w-5xl rounded-3xl px-8 py-14 text-center" style={{ background: ACCENT }}>
          <h2 className="mx-auto max-w-2xl font-display font-black leading-[0.95] tracking-[-0.035em]" style={{ ...HEADING, color: SURFACE }}>
            Pick a blank, upload art, ship it.
          </h2>
          <div className="mt-8 flex justify-center">
            <Pill href="/signup" tone="ink">Start free</Pill>
          </div>
        </Rise>
      </section>
    </div>
  )
}
