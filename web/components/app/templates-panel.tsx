"use client"

import { useLabelT, useDateFormat } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Stack, X, PencilSimple, CircleNotch, Plus } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { getTemplates, deleteTemplate, getCatalogProducts, type ProductTemplate, type CatalogProduct } from "@/lib/api"
import { bestMockup } from "@/lib/variant-resolve"
import { EmptyState } from "@/components/app/empty-state"

/**
 * Saved product templates — a blank + artwork setup you can reopen instead of rebuilding.
 *
 * These have been written to the database for a long time and never read back: the list
 * and delete endpoints filtered on a `seller_id` column that never existed, so both threw
 * on every call, and the only caller in the codebase (the old HTML maker) never listed
 * them. This is the first surface that actually shows them.
 */
export function TemplatesPanel() {
  const tl = useLabelT()
  /**
   * NO SIXTH `useFmtDate`. Five files already define their own copy of that hook
   * (settings-view, stores-manager, consignment-panel, subscription-panel, design/page) and
   * adding another is how a helper becomes five helpers that quietly disagree about a format.
   * `useDateFormat` is the shared one they all wrap; this card wraps it inline and in one
   * place. Extracting the five is worth doing — it is just not worth doing from here.
   */
  const fmtDate = useDateFormat()
  const shortDate = useCallback((s?: string | null) => {
    if (!s) return ""
    const d = new Date(s)
    return isNaN(d.getTime()) ? "" : fmtDate(d, { month: "short", day: "numeric" })
  }, [fmtDate])
  const router = useRouter()
  const [items, setItems] = useState<ProductTemplate[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // The catalogue, to put the BLANK under the artwork. A template's composite is
  // composeDesign(artwork + text) with no garment in it at all, and `data` keeps the blank
  // as a name and sku rather than a picture — so a card showed artwork floating on nothing,
  // which is why a small design read as an empty tile. Resolving the sku here is what makes
  // "a blank + artwork setup" actually look like one.
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])

  const load = () => { getTemplates().then((r) => setItems(r ?? [])).catch(() => setItems([])) }
  useEffect(() => {
    const id = setTimeout(() => {
      load()
      getCatalogProducts().then((rows) => setCatalog(rows ?? [])).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [])

  /**
   * The blank a template was built on, matched on the sku it saved — then the name, for a
   * template written before blankSku existed. Same order the maker restores in: a sku is
   * the identity, a name is a label somebody edits.
   */
  const blankOf = (t: ProductTemplate) => {
    const d = (t.data ?? {}) as { blankSku?: string | null; blank?: string | null }
    const sku = String(d.blankSku ?? "").trim()
    const name = String(d.blank ?? "").trim()
    const found = (sku ? catalog.find((p) => String(p.sku ?? "").trim() === sku) : undefined)
      ?? (name ? catalog.find((p) => String(p.name ?? "").trim() === name) : undefined)
    return { product: found, name: found?.name ?? d.blank ?? null }
  }

  const remove = async (id: string) => {
    setBusy(id)
    // Optimistic — the row is gone from view immediately; a failure reloads the truth.
    setItems((prev) => (prev ?? []).filter((t) => t.id !== id))
    try { await deleteTemplate(id) } catch { load() } finally { setBusy(null) }
  }

  const list = items ?? []

  return (
    <SectionCard
      title={tl("templates", "Product templates")}
      actions={
        <Button size="sm" onClick={() => router.push("/design/maker")}>
          <Plus size={14} weight="bold" /> {tl("templates", "Make a template")}
        </Button>
      }
    >
      {items === null ? (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <CircleNotch size={15} className="animate-spin" /> {tl("templates", "Loading…")}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Stack}
          title={tl("templates", "No templates yet")}
          note={tl("templates", "Build a blank + artwork setup in the design maker and save it — it’ll appear here, ready to reopen.")}
          action={
            <Button size="sm" onClick={() => router.push("/design/maker")}>
              <Plus size={14} weight="bold" /> {tl("templates", "Make a template")}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((t) => {
            const { product, name: blankName } = blankOf(t)
            /*
             * bestMockup, NOT the listing photo.
             *
             * `productImage` is the hero shot and stops at the product's own imagery, so a
             * blank that has none — which is most of them, including every cap — resolved
             * to "" and the card drew the artwork on nothing while still printing the
             * garment's name underneath. bestMockup falls through to the CATEGORY outline,
             * which is the same picture the maker put under the design when it was placed.
             */
            const blankImg = product ? bestMockup(product, null) : null
            // Fall back to the key only for a row saved before `seq` existed and not yet
            // re-listed — better an ugly reference than a blank one.
            const ref = t.seq != null ? `TPL-${t.seq}` : t.id
            return (
            <div key={t.id} className="group overflow-hidden rounded-xl border border-border">
              <div className="relative aspect-square bg-muted/40">
                {/*
                  * THE STAGE, REBUILT — the full blank underneath, the design over it.
                  *
                  * A template's composite is composeDesign(artwork + text): the layers
                  * painted at their percentages of the SQUARE STAGE, with no garment in it
                  * at all. So the two are not independent pictures to be arranged nicely,
                  * they are the two halves of one frame, and the card only tells the truth
                  * about a placement if it reproduces that frame exactly:
                  *
                  *   the blank      object-contain p-[1%]   — as design-canvas draws it
                  *   the composite  object-contain, edge to edge, NO padding
                  *
                  * It was object-cover under object-contain p-[18%], which is two different
                  * frames: the garment was cropped to fill and the design was shrunk into
                  * the middle, so a chest print rendered somewhere around the navel and a
                  * portrait blank lost its shoulders. The 18% was doing the job the blank
                  * was supposed to do — standing in for a garment that never loaded.
                  */}
                {blankImg && (
                  // data/remote urls from the catalogue; next/image adds nothing over a
                  // 4-up thumbnail grid. (The directive must sit on the line IMMEDIATELY
                  // before the element — above an explanation it disables nothing.)
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={blankImg} alt="" aria-hidden className="absolute inset-0 size-full object-contain p-[1%]" />
                )}
                {t.composite ? (
                  <Image
                    src={t.composite}
                    alt={t.name ?? tl("templates", "Template")}
                    fill
                    unoptimized
                    // Square composite, square tile: contain is 1:1 with the stage.
                    className="object-contain"
                  />
                ) : !blankImg ? (
                  <div className="flex size-full items-center justify-center text-muted-foreground/40">
                    <Stack size={26} weight="duotone" />
                  </div>
                ) : null}
                {/* THE SAME REMOVE AS THE IMAGES CARD: an X on the thumbnail, revealed on
                    hover, rather than a trash can parked in the footer beside the title.
                    A card's destructive action should not sit in the row you read — and the
                    two grids are the same object at different sizes, so they get the same
                    gesture. */}
                <button
                  type="button"
                  disabled={busy === t.id}
                  onClick={() => remove(t.id)}
                  aria-label={`Remove ${t.name || "template"}`}
                  title={`Remove ${t.name || "template"}`}
                  className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity hover:bg-alert group-hover:opacity-100"
                >
                  <X size={13} weight="bold" />
                </button>
              </div>
              <div className="flex flex-col gap-1 p-2">
                <div className="flex items-center gap-1">
                  {/* SEMIBOLD, like a library image's title. These two grids are read the
                      same way and sat at different weights for no reason anyone chose. */}
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold">{t.name || tl("templates", "Untitled")}</div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Open ${t.name || "template"} in the maker`}
                    onClick={() => router.push(`/design/maker?template=${encodeURIComponent(t.id)}`)}
                  >
                    <PencilSimple size={14} weight="bold" />
                  </Button>
                </div>
                <div className="mt-auto flex items-center gap-1.5 pt-1.5">
                  {/* WHEN, THEN WHAT IT IS BUILT ON — the same left-hand meta the artwork
                      library card carries, so a person moving between the two grids reads
                      them the same way instead of learning each one. */}
                  {shortDate(t.updated_at) && (
                    <span className="shrink-0 text-xs text-muted-foreground">{shortDate(t.updated_at)}</span>
                  )}
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{blankName || tl("templates", "No blank saved")}</span>
                  {/* The template's ID, copyable — and not decoration: this is exactly what
                      goes in the import sheet's Template ID column, which fills the blank,
                      artwork, placement and method for a line in one field. Same treatment
                      as a design's DSN badge, because it does the same job. */}
                  {/* TPL-12, not TPL-ms04ehic3elu. The base36 key is unique and unreadable;
                      nobody copies that off a card into a spreadsheet by eye. Sized to be
                      read rather than tucked away — same reason the design badge is. */}
                  <button
                    onClick={() => { navigator.clipboard?.writeText(ref).catch(() => {}); setCopied(t.id); setTimeout(() => setCopied(null), 1400) }}
                    title={tl("templates", "Copy this template's reference")}
                    /* AN IDENTIFIER, SO text-sm. §4: a VALUE is at least 14px — something
                       read, copied or transcribed — and 12px was the size of the caption
                       beside it. This is the string that goes in the import sheet's Template
                       ID column; the artwork library's IMG badge has been at this weight all
                       along and the two are the same job. */
                    className="eg-tap ml-auto shrink-0 rounded-md bg-muted px-2 py-1 tabular-nums text-sm font-semibold text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    {copied === t.id ? tl("templates", "Copied") : ref}
                  </button>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}
