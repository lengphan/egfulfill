"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Stack, X, PencilSimple, CircleNotch, Plus } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { getTemplates, deleteTemplate, getCatalogProducts, type ProductTemplate, type CatalogProduct } from "@/lib/api"
import { productImage } from "@/components/app/product-picker-dialog"
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

  /** The blank a template was built on, matched on the sku it saved. */
  const blankOf = (t: ProductTemplate) => {
    const d = (t.data ?? {}) as { blankSku?: string | null; blank?: string | null }
    const sku = String(d.blankSku ?? "").trim()
    const found = sku ? catalog.find((p) => String(p.sku ?? "").trim() === sku) : undefined
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
            const blankImg = product ? productImage(product) : null
            // Fall back to the key only for a row saved before `seq` existed and not yet
            // re-listed — better an ugly reference than a blank one.
            const ref = t.seq != null ? `TPL-${t.seq}` : t.id
            return (
            <div key={t.id} className="group overflow-hidden rounded-xl border border-border">
              <div className="relative aspect-square bg-muted/40">
                {/* THE BLANK UNDERNEATH. Two layers, deliberately: the garment fills the
                    frame (cover) so every tile is uniform, and the artwork sits over it
                    CONTAINED so it keeps its own proportions and its placement reads. A
                    single flattened image can't do both, and the composite has no garment
                    in it to flatten with. */}
                {blankImg && (
                  // data/remote urls from the catalogue; next/image adds nothing over a
                  // 4-up thumbnail grid. (The directive must sit on the line IMMEDIATELY
                  // before the element — above an explanation it disables nothing.)
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={blankImg} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
                )}
                {t.composite ? (
                  <Image
                    src={t.composite}
                    alt={t.name ?? tl("templates", "Template")}
                    fill
                    unoptimized
                    className={blankImg ? "object-contain p-[18%]" : "object-cover"}
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
                  <div className="min-w-0 flex-1 truncate text-sm font-medium">{t.name || tl("templates", "Untitled")}</div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Open ${t.name || "template"} in the maker`}
                    onClick={() => router.push(`/design/maker?template=${encodeURIComponent(t.id)}`)}
                  >
                    <PencilSimple size={14} weight="bold" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Which blank this was built on — the other half of "blank + artwork",
                      and previously nowhere on the card. */}
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
                    className="eg-tap ml-auto shrink-0 rounded-md bg-muted px-2 py-1 tabular-nums text-xs text-muted-foreground transition-colors hover:text-foreground"
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
