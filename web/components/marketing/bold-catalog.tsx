"use client"

import Image from "next/image"
import Link from "next/link"
import { TShirt } from "@phosphor-icons/react"
import { ACCENT, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"
import type { PublicProduct } from "@/lib/api"

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
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function BoldCatalog({ products }: { products: PublicProduct[] | null }) {
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
              <div className={(cat ? "mt-8" : "") + " grid gap-4 sm:grid-cols-2 lg:grid-cols-4"}>
                {items.map((p, i) => (
                  /* Keyed by SLUG, not name. The server already disambiguated duplicate names
                     with an index suffix, so the slug is the unique one — two products sharing
                     a name collided on this key and React reconciled them as one card. */
                  <Rise key={p.slug} delay={Math.min(i, 6) * 0.05}
                        className="group overflow-hidden rounded-2xl border border-black/[0.09] bg-white transition-colors hover:border-black/30">
                  <Link href={`/catalog/${p.slug}`} className="block">
                    {/* Square well, so a mixed catalogue (tees, mugs, caps) lines up. The
                        placeholder is the accent rather than a grey box — a product without a
                        photo should look unfinished, not broken. */}
                    <div className="relative aspect-square overflow-hidden" style={{ background: ACCENT }}>
                      {p.image ? (
                        <Image
                          src={p.image}
                          alt={p.name}
                          fill
                          unoptimized
                          sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
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
                      <div className="mt-1.5 text-[13px] text-black/50">
                        from <span className="font-bold text-[#0B0B0C]">{usd(p.price)}</span>
                      </div>
                    </div>
                  </Link>
                  </Rise>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="px-6 pb-16">
        <Rise className="mx-auto max-w-5xl rounded-3xl px-8 py-14 text-center" style={{ background: ACCENT }}>
          <h2 className="mx-auto max-w-2xl font-display font-black leading-[0.95] tracking-[-0.035em]" style={{ ...HEADING, color: SURFACE }}>
            Pick a blank, upload art, ship it.
          </h2>
          <div className="mt-8 flex justify-center">
            <Pill href="/login" tone="ink">Start free</Pill>
          </div>
        </Rise>
      </section>
    </div>
  )
}
