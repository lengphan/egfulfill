"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { TShirt } from "@phosphor-icons/react"
import { ACCENT, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"
import { ShippingFees } from "@/components/shipping-fees"
import type { ShipBands } from "@/lib/api"
import type { PublicProduct } from "@/lib/api"
import { framingStyle } from "@/lib/product-framing"
import { swatchBg, colorFamily, COLOR_FAMILIES } from "@/lib/color-swatch"
import { bySize, isOneSize, sizeRangeLabel } from "@/lib/size-order"

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

/** A colourway's chip. `swatchBg` is the canonical resolver — it already knows the supplier
 *  spellings ("Blk/Dk.Grn", "016 - White") and paints a two-tone name as a split, which the
 *  private eighteen-entry map that used to live here did not. A name it can't place falls
 *  back to a CLOSE CROP of that colourway's photo: bg-cover scaled a whole garment-on-white
 *  shot into a 16px circle, so the chip showed a tiny shirt silhouette — mostly background —
 *  instead of the colour it exists to communicate. 340% centred lands inside the body of the
 *  garment, which is fabric on every product shot we hold. A neutral is the last resort: a
 *  wrong colour chip is worse than a plain one. */
const NEUTRAL_CHIP = "#c7c4bd"
function chipStyle(c: { name: string; image?: string | null }) {
  const bg = swatchBg(c.name)
  if (bg) return { background: bg }
  if (c.image) return { backgroundImage: `url(${c.image})`, backgroundSize: "340%" }
  return { background: NEUTRAL_CHIP }
}

/* ── Facets ──────────────────────────────────────────────────────────────────
   Derived from the products themselves, never a written-out list: a hand-typed set of
   filters goes wrong the moment someone publishes a product that doesn't fit it, and goes
   wrong SILENTLY — the product is still on the page, just unreachable by every control
   beside it. Everything below reads what is actually in the catalogue.                    */

const ONE_SIZE = "One size"

/** Sizes as the filter offers them: the ladder as stored, with every spelling of one-size
 *  ("OSFA", "OSFM - Adult", "One Size") collapsed to a single choice. Three chips that each
 *  select the same caps is three ways to ask one question. */
const sizesOf = (p: PublicProduct) =>
  (p.sizes ?? []).map((s) => String(s || "").trim()).filter(Boolean)
    .map((s) => (isOneSize(s) ? ONE_SIZE : s))

/** Print methods, SPLIT AND NORMALISED. The field is free text and arrives both ways: one
 *  product stores "DTG", the next stores "DTG printing / Embroidery / DTF printing" as a
 *  single string. Taken at face value those are four unrelated options, two of which are the
 *  same method spelled differently, and picking "DTG" would miss the product that offers it
 *  alongside two others. */
const methodsOf = (p: PublicProduct) =>
  (p.methods ?? []).flatMap((m) => String(m || "").split("/"))
    .map((s) => s.trim().replace(/\s+printing$/i, "")).filter(Boolean)

const familiesOf = (p: PublicProduct) => {
  const out = new Set<string>()
  for (const c of p.colors ?? []) { const f = colorFamily(c.name); if (f) out.add(f) }
  return [...out]
}

const categoriesOf = (p: PublicProduct) => (p.category?.trim() ? [p.category.trim()] : [])

type FacetKey = "size" | "color" | "method" | "category"
type Facet = { key: FacetKey; label: string; options: string[]; swatch?: boolean }
const FACET_VALUES: Record<FacetKey, (p: PublicProduct) => string[]> = {
  size: sizesOf, color: familiesOf, method: methodsOf, category: categoriesOf,
}
type Selection = Record<FacetKey, string[]>
const NO_SELECTION: Selection = { size: [], color: [], method: [], category: [] }

/** One filter chip. Defined at module scope — `react-hooks/static-components` forbids
 *  declaring a component inside a render, and a chip redefined every keystroke remounts. */
function Chip({ label, on, swatch, onClick }: {
  label: string; on: boolean; swatch?: string | null; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors " +
        (on
          ? "border-[#0B0B0C] bg-[#0B0B0C] text-[#FAF8F3]"
          : "border-black/[0.14] text-black/70 hover:border-black/40 hover:text-[#0B0B0C]")
      }
    >
      {swatch && (
        <span
          aria-hidden
          className={"size-3 rounded-full border " + (on ? "border-white/40" : "border-black/20")}
          style={{ background: swatch }}
        />
      )}
      {label}
    </button>
  )
}

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
  const all = useMemo(() => products ?? [], [products])
  const [sel, setSel] = useState<Selection>(NO_SELECTION)

  /**
   * The filter controls, built from the WHOLE catalogue and not from what is currently
   * showing. Recomputing options against the filtered result makes them disappear as you
   * pick — you choose Blue, every other colour vanishes, and there is no way back to the
   * catalogue except a Clear you have to find. Options are also state derived from state
   * derived from those options, which is the shape that loops.
   *
   * A facet with fewer than two options is NOT RENDERED: it can only ever select everything
   * or nothing, so it is a control that does not control anything. That is why there is no
   * Category row today — every published product has a null category, and a row of one chip
   * reading "More" would imply a choice the catalogue can't offer.
   */
  const facets = useMemo<Facet[]>(() => {
    const spec: [FacetKey, string, boolean][] = [
      ["size", "Size", false], ["color", "Colour", true],
      ["method", "Print", false], ["category", "Type", false],
    ]
    return spec.flatMap(([key, label, swatch]) => {
      const seen = new Set<string>()
      for (const p of all) for (const v of FACET_VALUES[key](p)) seen.add(v)
      let options = [...seen]
      if (key === "size") options.sort(bySize)
      else if (key === "color") options = COLOR_FAMILIES.filter((f) => seen.has(f))
      else options.sort((a, b) => a.localeCompare(b))
      return options.length >= 2 ? [{ key, label, options, swatch }] : []
    })
  }, [all])

  /** OR inside a facet, AND across them — pick two sizes and you widen, pick a size and a
   *  colour and you narrow. Anything else surprises: selecting a second size should never
   *  return fewer products than the first did. */
  const list = useMemo(() => {
    const active = (Object.keys(sel) as FacetKey[]).filter((k) => sel[k].length)
    if (!active.length) return all
    return all.filter((p) =>
      active.every((k) => {
        const has = new Set(FACET_VALUES[k](p))
        return sel[k].some((v) => has.has(v))
      })
    )
  }, [all, sel])

  const activeCount = (Object.keys(sel) as FacetKey[]).reduce((n, k) => n + sel[k].length, 0)
  const toggle = (key: FacetKey, value: string) =>
    setSel((s) => ({
      ...s,
      [key]: s[key].includes(value) ? s[key].filter((v) => v !== value) : [...s[key], value],
    }))

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
        ) : all.length === 0 ? (
          <Rise className="rounded-2xl border border-black/[0.09] bg-white px-8 py-16 text-center">
            <h2 className="text-xl font-bold tracking-tight">The catalogue isn&apos;t published yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-black/55">
              Products appear here as soon as they&apos;re published. Nothing is hidden — there is
              simply nothing to show yet.
            </p>
          </Rise>
        ) : (
          <>
            {/* NO Rise on the controls. Everything else on these pages enters on scroll, but a
                filter that fades in is a filter that is briefly unclickable, and one whose
                entrance doesn't fire is a page that looks like it has no filters at all. */}
            {facets.length > 0 && (
              <div className="mb-10 border-b border-black/[0.09] pb-8">
                {facets.map((f) => (
                  <div key={f.key} className="mb-3 flex flex-wrap items-center gap-2 last:mb-0">
                    <span className="w-14 shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">
                      {f.label}
                    </span>
                    {f.options.map((o) => (
                      <Chip
                        key={o}
                        label={o}
                        on={sel[f.key].includes(o)}
                        swatch={f.swatch ? swatchBg(o) : null}
                        onClick={() => toggle(f.key, o)}
                      />
                    ))}
                  </div>
                ))}
                {/* The count is the honest part: with filters on, say what was set aside as
                    well as what is showing, so a short grid reads as a narrow filter rather
                    than a small catalogue. */}
                {activeCount > 0 && (
                  <div className="mt-5 flex items-center gap-3 text-[13px] text-black/55">
                    <span className="font-semibold text-[#0B0B0C]">
                      {list.length} of {all.length} products
                    </span>
                    <button
                      type="button"
                      onClick={() => setSel(NO_SELECTION)}
                      className="font-semibold underline underline-offset-4 hover:text-[#0B0B0C]"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            )}

            {list.length === 0 ? (
              /* A filter that matched nothing is NOT an empty catalogue, and must not borrow
                 its words — the products are still there and one click brings them back. */
              <div className="rounded-2xl border border-black/[0.09] bg-white px-8 py-16 text-center">
                <h2 className="text-xl font-bold tracking-tight">Nothing matches those filters</h2>
                <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-black/55">
                  All {all.length} products are still here — no combination of what you picked
                  appears on one of them.
                </p>
                <button
                  type="button"
                  onClick={() => setSel(NO_SELECTION)}
                  className="mt-5 text-[15px] font-semibold underline underline-offset-4"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              sections.map(([cat, items], gi) => (
            <div key={cat || "all"} className={gi ? "mt-16" : ""}>
              {cat && <h2 className="font-display font-black leading-[0.95] tracking-[-0.035em]" style={HEADING}>{cat}</h2>}
              {/* Four across on a desktop, not three. A catalogue is scanned rather than read,
                  and three 355px cards on a 1,400px screen made a browsing page feel like a
                  landing page — you saw six products before scrolling. Four lands each card at
                  ~261px, which still holds a two-line name, a price and five swatches; the
                  ladder gains a step at md so the jump from two to four isn't taken in one go. */}
              <div className={(cat ? "mt-8" : "") + " grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}>
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
                      {/* THE RANGE, beside the price — "does this come in my size" answered in
                          four characters. Eight size chips is what the product page is for; in
                          a grid it is the fact you are scanning past. */}
                      <div className="mt-2 flex items-baseline justify-between gap-2">
                        <span className="text-lg font-black tabular-nums">{usd(p.price)}</span>
                        {sizeRangeLabel(p.sizes) && (
                          <span className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-black/45">
                            {sizeRangeLabel(p.sizes)}
                          </span>
                        )}
                      </div>
                      {/* Colour chips. The count alone ("6 colourways") is a fact you have to
                          imagine; the swatches are the thing a buyer actually shops by, and
                          they were only on the detail page. Capped at five so a 30-colour
                          style doesn't turn the card into a palette, with the remainder
                          stated rather than silently dropped. See chipStyle for how a name
                          becomes a colour. */}
                      {p.colors.length > 0 && (
                        <div className="mt-3 flex items-center gap-1.5">
                          {p.colors.slice(0, 5).map((c) => (
                            <span
                              key={c.name}
                              title={c.name}
                              className="size-4 rounded-full border border-black/15 bg-center"
                              style={chipStyle(c)}
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
          </>
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
