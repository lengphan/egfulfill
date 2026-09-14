"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Plus, Package, Sparkle, DotsThree, Warning, Tag } from "@phosphor-icons/react"
import { motion, useReducedMotion } from "motion/react"
import { Button } from "@/components/ui/button"
import { TabBar } from "@/components/app/tab-bar"
import { SearchField } from "@/components/app/search-field"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { ProductEditorDialog } from "@/components/app/product-editor-dialog"
import { BrandSplitDialog } from "@/components/app/brand-split-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { isArchived } from "@/lib/product-status"
import { planBrandSplit } from "@/lib/brand-split"
import { nextEgSku } from "@/lib/sku"
import { usePaged, Pagination } from "@/components/app/pagination"
import { getCatalogProducts, saveCatalogProducts, type CatalogProduct } from "@/lib/api"
import { discounted } from "@/lib/plans"
import { getUser } from "@/lib/auth"
import { clickableProps } from "@/lib/a11y"

// ── helpers ───────────────────────────────────────────────────
const priceOf = (p: CatalogProduct) =>
  Number(p.price ?? p.basePrice ?? p.base_price ?? 0) || 0

/**
 * THE PUBLIC PRICE — mirrors publicShape in server/src/routes/catalog.js, in the same order:
 * `price`, then `basePrice`. That is what a seller pays us to make one (pricing.js), which is
 * the figure the marketing page quotes.
 *
 * catalogPrice is deliberately NOT consulted. It is the lookbook's price — a trade rate for
 * partners and wholesale buyers — and putting it on the open web quotes those terms to
 * everyone.
 *
 * An Active product with no usable price at all is still dropped by the public route, so this
 * exists to let the page SAY so rather than leave it invisible and unexplained.
 */
const publicPriceOf = (p: CatalogProduct) => {
 const v = Number(p.price ?? p.basePrice ?? p.base_price ?? NaN)
 return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * Who sees this product — read off `status`, the one flag that decides it.
 *
 * Mirrors the visibility vocabulary in server/src/routes/catalog.js. Anything unrecognised
 * is treated as staff-only here for the same reason the server withholds it: a status nobody
 * has taught this function about must not be described to the reader as public.
 *
 * "Not on the site" and "Active but priceless" are DIFFERENT FACTS with different fixes, and
 * collapsing them into one "not live" is what makes a person set the same field twice and
 * conclude the feature is broken.
 */
type PublicState = { live: boolean; label: string; why: string | null }
const publicStateOf = (p: CatalogProduct): PublicState => {
  /**
   * THE BADGE SAYS THE PRODUCT'S OWN STATUS, in the words the editor sets it in.
   *
   * It used to describe the marketing site instead — "On the site", "Not on the site" — so
   * the chip on the card and the dropdown in the editor were two vocabularies for one field,
   * and neither told you what the other would say. Active / Sellers only / Staff only are
   * the three the editor writes; those are the three that show.
   *
   * "No price" survives as a SUFFIX rather than a status, because it never was one: it is a
   * reason an otherwise-Active product is missing from the site, and dropping it would make
   * a silently-absent product look correct on the card.
   */
 const raw = (p.status ?? "Active").trim()
 const status = raw.toLowerCase()
 const label = status === "active" ? "Active"
    : status === "sellers only" ? "Sellers only"
    : status === "staff only" ? "Staff only"
    : raw || "Active"

 if (status !== "active") {
 return {
 live: false,
 label,
 why: status === "sellers only"
        ? "Orderable by sellers in the app. Set it Active to put it on the marketing site."
 : "Not on the public site. Set it Active to publish it.",
    }
  }
 if (publicPriceOf(p) === null) {
 return {
 live: false,
 label: "Active · no price",
 why: "Active, but the site skips it until it has a price. Set a base price on the product.",
    }
  }
 return { live: true, label, why: null }
}

import { sizesOf } from "@/lib/variant-resolve"
import { framingStyle } from "@/lib/product-framing"
import { FilterMenu } from "@/components/app/filter-menu"

const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const imageOf = (p: CatalogProduct) =>
 p.img || p.image || p.hero || p.images?.[0] || (p.colorImages ? Object.values(p.colorImages)[0] : "") || ""

export const colorsOf = (p: CatalogProduct) => (p.colorImages ? Object.keys(p.colorImages) : [])

// Common garment/thread colour names → a swatch hex (best-effort; unknown = neutral).
const SWATCH: Record<string, string> = {
 black: "#191918", white: "#f4f2ef", navy: "#25314d", "sport grey": "#b7b7b3",
 grey: "#9ca3af", gray: "#9ca3af", heather: "#b9b6b0", sand: "#d8cbb4", natural: "#e8e0cf",
 maroon: "#6d2233", red: "#c0392b", royal: "#2f4bf0", blue: "#3457d5", green: "#3f7d4e",
 forest: "#2f5540", pink: "#e59bb4", khaki: "#c3b091", gold: "#d4a017", purple: "#6d4aec",
}
export const swatchHex = (name: string) => SWATCH[name.toLowerCase().trim()] ?? "#c7c4bd"

// Placeholder for a product with no photo. Deliberately NEUTRAL: this used to rotate
// through five pastel gradients, so a catalog without images rendered as a grid of
// lavender/amber/emerald/sky/pink tiles — a different visual language from every other
// page, which reads as two apps rather than one. The image is the interesting thing on a
// product card; its absence shouldn't be the loudest element on the page.
const PLACEHOLDER = "bg-muted text-muted-foreground/60"

// ── demo fallback (no session / API) ──────────────────────────
const DEMO: CatalogProduct[] = [
  { id: 1, name: "Heavyweight Hoodie", sku: "HOOD-HW", type: "Apparel", method: "DTG", price: 42, status: "Active", sizes: ["S", "M", "L", "XL", "2XL"], colorImages: { Black: "", Navy: "", Maroon: "" } },
  { id: 2, name: "Classic Tee", sku: "TEE-CL", type: "Apparel", method: "DTG", price: 18, status: "Active", sizes: ["S", "M", "L", "XL"], colorImages: { Black: "", White: "", "Sport Grey": "" } },
  { id: 3, name: "Embroidered Cap", sku: "CAP-EMB", type: "Headwear", method: "Embroidery", price: 24, status: "Active", sizes: ["OS"], colorImages: { Black: "", Khaki: "", Navy: "" } },
  { id: 4, name: "Canvas Tote", sku: "TOTE-CV", type: "Bags", method: "DTG", price: 14, status: "Draft", sizes: ["OS"], colorImages: { Natural: "" } },
  { id: 5, name: "Ceramic Mug 15oz", sku: "MUG-15", type: "Drinkware", method: "Sublimation", price: 12.8, status: "Active", sizes: ["15oz"], colorImages: { White: "" } },
  { id: 6, name: "Crewneck Sweatshirt", sku: "CREW-STD", type: "Apparel", method: "DTG", price: 34, status: "Active", sizes: ["S", "M", "L", "XL"], colorImages: { Sand: "", Black: "", Forest: "" } },
]

export function ProductsCatalog() {
  const tl = useLabelT()
 const router = useRouter()
 const reduce = useReducedMotion()
 const [products, setProducts] = useState<CatalogProduct[] | null>(null)
 const [isDemo, setIsDemo] = useState(false)
 const [query, setQuery] = useState("")
 const [cat, setCat] = useState<string>("All")
  /**
   * THE STATUS FILTER, IN THE WORDS THE EDITOR WRITES AND THE CARD SHOWS.
   *
   * It offered a vocabulary of its own — "Live on site" / "Not showing on site" / "Internal
   * only" — describing the marketing site rather than the product. That is the SAME mistake
   * `publicStateOf` was written to fix one control to the left: the badge on the card used
   * to say "On the site" / "Not on the site" and was changed to say Active / Sellers only /
   * Staff only, because a chip and a dropdown naming one field in two vocabularies leave you
   * unable to predict either from the other. The badge was fixed, and then this filter was
   * added in the vocabulary the badge had just abandoned — so the screen went straight back
   * to having two. Owner: "status for products here are not similar to product status we
   * currently have".
   *
   * Every option is now a label the card prints verbatim:
   *
   *   Active             Active AND priced — exactly when the badge reads "Active"
   *   Active · no price  Active but the public route drops it: the banner's own set, in the
   *                      badge's own words. Kept separate from Active, which is what keeps
   *                      the drift the stranded count exists to catch off the happy option.
   *   Sellers only       as stored
   *   Staff only         as stored
   *   Draft              as stored
   *   Archived           as stored
   *
   * TWO DEFECTS BEYOND THE WORDS, both found by writing them out.
   *
   * ARCHIVED WAS INVISIBLE. There was no option for it, and the "draft" predicate was
   * `!isActive && !isInternal` — true for Archived — so archived products were silently
   * returned under Draft and neither set could be asked for alone.
   *
   * "INTERNAL ONLY" MERGED TWO STATUSES AND MISNAMED ONE. It matched "Sellers only" OR
   * "Staff only", so the two could not be told apart; and a Sellers-only product is not
   * internal at all — sellers are the customers. Two options now, named as stored.
   */
  const [status, setStatus] = useState<string>("")
 const [isStaff, setIsStaff] = useState(false)
 const [editing, setEditing] = useState<CatalogProduct | null>(null)
 const [editorOpen, setEditorOpen] = useState(false)
 const [splitOpen, setSplitOpen] = useState(false)
  // The shipping-fee fetch went with the table it fed. It was a request on every visit to
  // this page for a block that is no longer rendered — the detail page loads its own.

 useEffect(() => {
 const id = setTimeout(() => { const r = getUser()?.role; setIsStaff(!!r && r !== "seller") }, 0)
 return () => clearTimeout(id)
  }, [])

  // Whole-catalog persist on any staff add/edit/delete.
  /**
   * The optimistic write is kept — the grid should move under your hand — but the failure is
   * no longer thrown away. `.catch(() => {})` meant a save the server REFUSED looked exactly
   * like one it accepted: the row sat there looking right until a reload removed it. The
   * previous list goes back and the reason is re-thrown, so the editor dialog that asked for
   * the save is the thing that reports it.
   */
 const persist = async (next: CatalogProduct[]) => {
 const prev = products
 setProducts(next)
 try {
 await saveCatalogProducts(next)
    } catch (e) {
 setProducts(prev)
 throw e instanceof Error ? e : new Error("Couldn't save the catalogue.")
    }
  }
 const saveProduct = (p: CatalogProduct) => {
 const list = products ?? []
 return persist(list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list])
  }
  /**
   * RETIRED, NOT REMOVED (owner, 2026-09-14).
   *
   * This was `persist(products.filter(x => x.id !== id))` behind a 28px trash icon four
   * pixels from Edit, with no confirmation: one misclick dropped a product out of the
   * catalogue permanently. And "permanently" was worse than it looked — quoteOrder prices an
   * order by looking its blank up in this catalogue, so deleting a product leaves every
   * finished order that used it unpriceable, and the row is gone from the only place that
   * could put it back.
   *
   * Archiving does the job that was actually wanted: the server's status ladder already
   * treats Archived as staff-only, so it leaves the public site and every seller's catalogue
   * the moment it is set — and lib/product-status.ts takes it out of the pickers, so nobody
   * puts it on a new order. Everything that already names it still resolves.
   */
 const setProductStatus = (p: CatalogProduct, status: string) =>
    persist((products ?? []).map((x) => (x.id === p.id ? { ...x, status } : x)))

  /** How many products still carry their make on the front of the name. Counted here so the
   *  button can say the number and stay away when there is nothing to do. */
 const splitCount = useMemo(() => (isDemo ? 0 : planBrandSplit(products ?? []).length), [products, isDemo])

 useEffect(() => {
 let alive = true
 getCatalogProducts()
      .then((rows) => {
 if (!alive) return
 if (rows && rows.length) {
 setProducts(rows)
        } else {
 setProducts(DEMO)
 setIsDemo(true)
        }
      })
      .catch(() => {
 if (!alive) return
 setProducts(DEMO)
 setIsDemo(true)
      })
 return () => {
 alive = false
    }
  }, [])

 const categories = useMemo(() => {
 const set = new Set<string>()
    ;(products ?? []).forEach((p) => p.type && set.add(p.type))
 return ["All", ...Array.from(set)]
  }, [products])

 const filtered = useMemo(() => {
 return (products ?? []).filter((p) => {
 if (cat !== "All" && p.type !== cat) return false
 if (status) {
        const raw = (p.status ?? "Active").trim().toLowerCase()
        const priced = publicPriceOf(p) !== null
        // Each arm matches ONE stored status, so no product answers to two options and none
        // falls through to an option that was never about it — which is what put Archived
        // under Draft. Active is the one split, by price, because that split is exactly what
        // the card's own badge already shows.
        if (status === "active" && !(raw === "active" && priced)) return false
        if (status === "unpriced" && !(raw === "active" && !priced)) return false
        if (status === "sellers" && raw !== "sellers only") return false
        if (status === "staff" && raw !== "staff only") return false
        if (status === "draft" && raw !== "draft") return false
        if (status === "archived" && raw !== "archived") return false
      }
 if (!query) return true
      // The supplier's code is searchable too — it is how a blank is referred to on a spec
      // sheet or a purchase order, and it is the only identifier a product has until ours is
      // assigned. Only ever PRESENT for staff: sellerSafe strips supplierSku server-side, so
      // a seller's copy has nothing here to match on.
      /* BRAND IS SEARCHABLE. The split lifts "Gildan" out of the NAME and into its own field,
         so without it here the one thing the split just made explicit becomes the one thing
         you can no longer type into the box — the split would have made search worse. */
 const hay = `${p.name ?? ""} ${p.brand ?? ""} ${p.sku ?? ""} ${p.supplierSku ?? ""} ${p.type ?? ""}`.toLowerCase()
 return hay.includes(query.toLowerCase())
    })
  }, [products, cat, query, status])

 const paged = usePaged(filtered, 24)

 const stats = useMemo(() => {
 const list = products ?? []
    // Active IS "on the marketing site" now — one flag, so this tile and the public route
    // cannot drift apart. What can still differ is a product Active with no price: the public
    // route drops it, so counting Active alone would again report items the site isn't showing.
 const active = list.filter((p) => (p.status ?? "Active") === "Active").length
 const stranded = list.filter((p) => (p.status ?? "Active") === "Active" && publicPriceOf(p) === null).length
 const internal = list.filter((p) => {
 const s = (p.status ?? "Active").trim().toLowerCase()
 return s === "sellers only" || s === "staff only"
    }).length
 return {
 total: list.length,
 cats: Math.max(0, new Set(list.map((p) => p.type).filter(Boolean)).size),
 active, live: active - stranded, stranded, internal,
    }
  }, [products])

  // ── loading skeleton ──
 if (products === null) {
 return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[280px] animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }

 return (
    <div className="space-y-5">
      <StatGrid>
        <StatCard label={tl("products", "Products")} value={String(stats.total)} sub={tl("products", "in your catalog")} />
        <StatCard label={tl("products", "Categories")} value={String(stats.cats)} sub={tl("products", "product types")} />
        <StatCard label={tl("products", "Internal")} value={String(stats.internal)} sub={tl("products", "sellers or staff only")} />
        {/* Counts what the site actually SHOWS, not how many are Active. The two differ only
 when a product has no price, and when they do this tile says so rather than
 quietly reporting the larger, friendlier number. */}
        <StatCard
 label={tl("products", "On the public site")}
 value={String(stats.live)}
 sub={stats.stranded > 0
            ? `${stats.stranded} Active but held back`
 : stats.live === stats.total ? tl("products", "all products") : `of ${stats.total} products`}
 tone={stats.stranded > 0 ? "neg" : stats.live ? "pos" : undefined}
        />
      </StatGrid>

      {/* The shipping-band table used to sit here, between the stats and the grid. It is
 still on the product DETAIL page, where you are looking at one garment and its band
 is the one that applies — on the all-products page it was a block of four rates
 above every product, answering a question nobody had asked yet. */}

      {/* The explanation, where the problem is — not in a tooltip on one card. Active but
 priceless is invisible AND silent, which is how the same field gets set twice. */}
      {isStaff && stats.stranded > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-hold/30/60 bg-hold/10 px-4 py-3 text-sm text-hold">
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
          <div>
            <strong>{stats.stranded} Active product{stats.stranded === 1 ? " is" : tl("products", "s are")} not showing on the site.</strong>{" "}
            {stats.stranded === 1 ? tl("products", "It has") : tl("products", "They have")} no price, and the public catalogue
 skips anything without one. Set a base price on the product and it appears.{" "}
            {/* THE BANNER NAMES A SET; THIS SHOWS IT. It counted them and then left you to
                find them by eye among everything else — which on a full catalogue is the
                whole cost of the warning. One click now narrows the grid to exactly the
                products the sentence is about. A link, not a button: it changes what you are
                LOOKING at, and §4 keeps a filled control for the thing a screen is for. */}
            <button
              type="button"
              onClick={() => { setStatus("unpriced"); setCat("All"); setQuery("") }}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              {tl("products", "Show them")}
            </button>
          </div>
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabBar
          look="segmented"
          spacing="none"
          ariaLabel={tl("products", "Category")}
          items={categories.map((c) => ({ id: c, label: c }))}
          value={cat}
          onChange={setCat}
        />
        <div className="flex items-center gap-2">
          {/* FilterMenu, not a second TabBar. The category bar is a segmented row because a
              category is one of a handful of known values you switch between; status is a
              FACET you set and leave, and filter-menu.tsx exists precisely so every page
              stops rolling its own (§4 — grep for the primitive). It also names the current
              STATE rather than the facet, so the trigger reads "Active · no price" and you
              never have to open it to find out what you are looking at. */}
          <FilterMenu
            label={tl("products", "Status")}
            anyLabel={tl("products", "All statuses")}
            value={status}
            options={[
              { value: "active", label: tl("products", "Active") },
              { value: "unpriced", label: tl("products", "Active · no price") },
              { value: "sellers", label: tl("products", "Sellers only") },
              { value: "staff", label: tl("products", "Staff only") },
              { value: "draft", label: tl("products", "Draft") },
              { value: "archived", label: tl("products", "Archived") },
            ]}
            onPick={setStatus}
          />
          <SearchField
            value={query}
            onChange={setQuery}
            width="sm"
            placeholder={tl("products", "Search products…")}
          />
          {/* SECONDARY, because adding a product is what this screen is for. Only offered
 when there is something to split — a button that always opens onto "nothing to
 do" teaches you to stop pressing it. */}
          {isStaff && splitCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => setSplitOpen(true)}>
              <Tag size={14} weight="bold" /> Split brand · {splitCount}
            </Button>
          )}
          {isStaff && (
            <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true) }}>
              <Plus size={14} weight="bold" /> {tl("products", "Add product")}
            </Button>
          )}
        </div>
      </div>

      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-hold/20 bg-hold/10 px-3.5 py-2 text-xs font-medium text-hold">
          <Sparkle size={14} weight="fill" />
          {tl("products", "Showing sample products — sign in to load your live catalog.")}
        </div>
      )}

      {/* grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-20 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Package size={26} weight="duotone" />
          </span>
          <div className="font-medium">{tl("products", "No products match that.")}</div>
          <div className="text-sm text-muted-foreground">{tl("products", "Try a different search or category.")}</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {paged.pageItems.map((p, i) => {
 const img = imageOf(p)
 const colors = colorsOf(p)
 const sizes = sizesOf(p)
 return (
              <motion.div
 key={String(p.id ?? p.sku ?? i)}
                {...clickableProps(
                  () => router.push(`/products/${encodeURIComponent(String(p.id ?? p.sku ?? ""))}`),
                  `View ${p.name ?? "product"}`
                )}
 initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.4, delay: Math.min(i, 8) * 0.04, ease: [0.21, 0.5, 0.28, 1] }}
 whileHover={reduce ? undefined : { y: -4 }}
                /* NO SHADOW. A drop shadow under a white card on a white canvas is a grey
 smudge doing the job a hairline already does — twelve of them in a grid
 read as haze. The border separates; hover raises the CARD, not a blur
 under it. */
 className="group cursor-pointer overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                {/* image / placeholder */}
                <div className="relative aspect-square overflow-hidden bg-white">
                  {/* Card actions — Design (everyone) + Edit/Delete (staff). */}
                  {/*
                    * ONE TARGET, NOT THREE (owner, 2026-09-14: "too small too close to each other very
                    * easy to misclick").
                    *
                    * Three 28px circles four pixels apart, on a photo, with Delete adjacent to Edit — and
                    * the glyphs were a pen-nib and a pencil, two similar squiggles at 13px. A menu is one
                    * 28px target with nothing to misclick BETWEEN, and its items carry words instead of
                    * shapes you have to decode. `rounded-md` because a control is not round: §4 keeps
                    * fully-round for count badges and avatars.
                    */}
                  <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={tl("products", "Actions for this product")}
                        onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
                        className="grid size-7 place-items-center rounded-md bg-background text-foreground shadow transition-colors hover:bg-accent"
                      >
                        <DotsThree size={16} weight="bold" />
                      </DropdownMenuTrigger>
                      {/*
                        * EVERY ITEM STOPS THE CLICK. The whole card is a target — clickableProps
                        * pushes /products/<id> — and the TRIGGER already called stopPropagation,
                        * which made this look handled. The items did not, so pressing Edit opened
                        * the dialog AND bubbled to the card, the card navigated, and the dialog you
                        * had just opened was gone: "clicking edit redirected to the product detail
                        * page". Same for Design and for archive/restore.
                        */}
                      {/* WORDS ONLY, AND ONE WORD EACH (owner, 2026-09-14: "simple buttons
                          Design, Edit, Archive no more emojis").

                          THE ICONS ARE GONE. A three-item menu of plain verbs does not need
                          them: a pen nib, a pencil and an archive box beside Design, Edit and
                          Archive are three pictures of what the word already says, and at
                          14px they read as decoration on a list that is meant to be scanned
                          and dismissed. They also made the row's real target ambiguous —
                          nothing here is icon-only, so nothing here needed an icon.

                          `text-sm`, not `text-xs`. These are CONTROLS, and 12px is the
                          caption step (§4 — a label may be 12px, a thing you act on is not a
                          caption). The menu is four words wide; there was never a density
                          problem to solve by shrinking them.

                          "Design this product" → "Design". The menu hangs off one product's
                          own card, so "this product" was the card saying its own name back. */}
                      <DropdownMenuContent align="end" className="min-w-40">
                        <DropdownMenuItem
                          className="text-sm"
                          onClick={(e) => { e.stopPropagation(); router.push(`/design/maker?product=${encodeURIComponent(String(p.id ?? p.sku ?? ""))}`) }}
                        >
                          {tl("products", "Design")}
                        </DropdownMenuItem>
                        {isStaff && (
                          <DropdownMenuItem className="text-sm" onClick={(e) => { e.stopPropagation(); setEditing(p); setEditorOpen(true) }}>
                            {tl("products", "Edit")}
                          </DropdownMenuItem>
                        )}
                        {isStaff && (isArchived(p)
                          ? (
                            <DropdownMenuItem className="text-sm" onClick={(e) => { e.stopPropagation(); setProductStatus(p, "Active") }}>
                              {tl("products", "Restore")}
                            </DropdownMenuItem>
                          ) : (
                            /* Destructive in tone but not in effect — it is reversible by the item above,
                               which is exactly why it can sit in a menu without a confirmation. */
                            <DropdownMenuItem variant="destructive" className="text-sm" onClick={(e) => { e.stopPropagation(); setProductStatus(p, "Archived") }}>
                              {tl("products", "Archive")}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {img ? (
                    /**
                     * THE FRAMING SET IN THE EDITOR.
                     *
                     * Supplier photos carry their own whitespace, so a cap ends up small in
                     * the middle of a square that is already cropped as far as object-cover
                     * can crop it. Zoom lives on a WRAPPER rather than on the image, so it
                     * composes with the hover scale instead of overwriting it — an inline
                     * transform on the <Image> would win against the group-hover class and
                     * kill the lift on every product somebody had framed.
                     *
                     * Absent values are 100 / 50, which is exactly the previous behaviour.
                     */
                    <div className="absolute inset-0" style={framingStyle(p)}>
                      <Image
 src={img}
 alt={p.name ?? tl("products", "Product")}
 fill
 unoptimized
 className="object-contain transition-transform duration-300 group-hover:scale-[1.04]"
                      />
                    </div>
                  ) : (
                    <div className={"flex size-full items-center justify-center " + PLACEHOLDER}>
                      <span className="font-title text-4xl font-semibold">
                        {(p.name ?? "?").trim().charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  {/* THE STATUS, ON THE PICTURE — FACTORY ONLY. Owner's call, and it
 reinstates something this file removed on purpose, so both readings
 are on the record.

                      It came off because a coloured chip on every tile sat on the one part
 of the card that is meant to be the product, and the grid's job is
 comparing pictures. That still holds for a SELLER, who has one
 question here ("what can I order") and gets a clean grid.

                      It does not hold for the floor: staff maintain this catalogue, and
 "which of these is actually on the site" was answerable only by
 opening each product's editor one at a time. So the chip is back,
 gated to staff, and it yields the corner the moment the card's own
 actions appear rather than stacking under them.

                      Reserved status colours (globals.css): shipped = live, hold = active
 but unpublishable, draft = deliberately not published. */}
                  {isStaff && (() => {
 const st = publicStateOf(p)
 const tone = st.live ? "text-shipped" : st.label.includes("no price") ? "text-hold" : "text-draft"
 return (
                      <span
 title={st.why ?? tl("products", "On the public site.")}
 className="pointer-events-none absolute right-2 top-2 z-[5] inline-flex items-center gap-1.5 rounded-lg bg-background/90 px-2 py-0.5 text-xs font-medium ring-1 ring-border backdrop-blur-sm transition-opacity group-hover:opacity-0"
                      >
                        {/* A DOT, not a filled chip. Over a photo the fill is what turns a
 grid into bunting; the dot carries the colour and the word carries
 the meaning, so it reads on a black hoodie and a white mug alike. */}
                        <span className={"size-1.5 shrink-0 rounded-full bg-current " + tone} />
                        <span className={tone}>{tl("products", st.label)}</span>
                      </span>
                    )
                  })()}
                </div>

                {/* body */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{p.name ?? tl("products", "Untitled")}</div>
                      {/* Ours, else theirs. A product should always have ours — but the ones
 that don't are exactly the ones you need to find, and a row reading
                          "—" tells you nothing about which blank it is. sellerSafe strips
 supplierSku, so a seller sees "—" here, never a supplier's code. */}
                      {/* THE MAKER, on the line that already exists. The brand split pulls
                          "Gildan" off the front of the name and files it — and then nothing
                          on this card said it, so the split read as deleting the word. It
                          rides beside the sku rather than on a line of its own: an eyebrow
                          would leave an empty slot on every product that has no brand, and
                          the cards would stop lining up.
                          Never the SUPPLIER (§2.9) — `brand` is what is on the garment's own
                          label, and brandOfSupplierStyle refuses a supplier's name on the way
                          in precisely so this line is safe to print. */}
                      <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
                        <span className="shrink-0 tabular-nums">{p.sku || p.supplierSku || "—"}</span>
                        {p.brand && <span className="truncate">· {p.brand}</span>}
                      </div>
                    </div>
                    {/* WHAT YOU PAY, AND WHAT IT LISTS AT. A plan that promises "20% off all
                        blanks" is unprovable while every price on the screen is the list one
                        — the seller has to place an order and read the summary to find out
                        whether the thing they are paying $29 a month for is real. Struck
                        through, so the discount is visible where the decision is made.
                        The SERVER computes the charge (pricing.js); this mirrors it. */}
                    {(() => {
 const list = priceOf(p)
 const net = discounted(list)
 if (net == null) return <div className="shrink-0 font-semibold tabular-nums">{usd(list)}</div>
 return (
                        <div className="shrink-0 text-right">
                          <div className="text-xs tabular-nums text-muted-foreground line-through">{usd(list)}</div>
                          <div className="font-semibold tabular-nums">{usd(net)}</div>
                        </div>
                      )
                    })()}
                  </div>

                  {/* Colours + type share one fixed-height row. Both slots always render
                      (with a muted placeholder when empty) so cards line up instead of
 each being as tall as whatever data it happens to carry. */}
                  <div className="mt-3 flex min-h-6 items-center justify-between gap-2">
                    {/* flex-1 + overflow-hidden, and BOTH are the fix. Every swatch is
                        shrink-0, so `min-w-0` alone let the row keep its full natural width
                        and simply paint over the type on a narrow card — the colours and
                        "Headwear" sat on top of each other. Clipping a swatch at the edge is
                        the honest degradation; two things sharing one set of pixels is not. */}
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                      {colors.slice(0, 8).map((c) => {
 const img = p.colorImages?.[c]
 return (
                          <span
 key={c}
 title={c}
 className="size-4 shrink-0 rounded-full border border-black/10 bg-muted"
 style={
 img
                                ? { backgroundImage: `url("${img}")`, backgroundSize: "260%", backgroundPosition: "center 42%" }
 : { background: swatchHex(c) }
                            }
                          />
                        )
                      })}
                      {colors.length > 8 && (
                        <span className="shrink-0 text-2xs text-muted-foreground">+{colors.length - 8}</span>
                      )}
                      {colors.length === 0 && <span className="text-2xs text-muted-foreground">{tl("products", "No colours set")}</span>}
                    </div>
                    {/* TEXT, NOT A PILL. Every card carried a beige type chip and three
 beige size chips — four boxes per tile, forty-eight in a grid of
 twelve, and not one of them was a control. The words say the same
 thing; the boxes were the "lots of shaded beige". */}
                    <span className="shrink-0 text-2xs font-medium text-muted-foreground">
                      {p.type || tl("products", "Uncategorised")}
                    </span>
                  </div>

                  {/* Sizes — ALWAYS rendered, on one non-wrapping line. Two bugs lived
 here: the row was conditional, so a product without sizes was a
 shorter card than its neighbours; and it read p.sizes directly,
 which is empty on the many catalog rows that carry sizes only as
 per-size price tiers (sizesOf unions both). */}
                  <div className="mt-3 flex min-h-6 items-center gap-2 overflow-hidden">
                    {sizes.length === 0 ? (
                      <span className="text-2xs text-muted-foreground">{tl("products", "No sizes set")}</span>
                    ) : (
                      <>
                        {sizes.slice(0, 7).map((s) => (
                          <span
 key={s}
                            /* One line of sizes, not seven outlined boxes. They are a
 reading, not seven controls — the border made each one look
 pressable and turned a run of sizes into a keyboard. */
 className="shrink-0 text-2xs font-medium tabular-nums text-muted-foreground"
                          >
                            {s}
                          </span>
                        ))}
                        {sizes.length > 7 && (
                          <span className="shrink-0 text-2xs text-muted-foreground">+{sizes.length - 7}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
      {filtered.length > 0 && (
        <div className="rounded-2xl border border-border">
          <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage} total={paged.total} start={paged.start} onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[24, 48, 96]} className="border-t-0" />
        </div>
      )}

      {isStaff && (
        <ProductEditorDialog open={editorOpen} onOpenChange={setEditorOpen} product={editing} onSave={saveProduct} newIdSeed={(products?.length ?? 0) + 1000} nextSku={nextEgSku(products ?? [])}
 takenSkus={(products ?? []).filter((p) => p.id !== editing?.id).map((p) => String(p.sku ?? "")).filter(Boolean)} />
      )}
      {isStaff && (
        <BrandSplitDialog open={splitOpen} onOpenChange={setSplitOpen} products={products ?? []} onApply={persist} />
      )}
    </div>
  )
}
