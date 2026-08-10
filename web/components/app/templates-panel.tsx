"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Stack, Trash, PenNib, CircleNotch, Plus } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { getTemplates, deleteTemplate, getCatalogProducts, type ProductTemplate, type CatalogProduct } from "@/lib/api"
import { productImage } from "@/components/app/product-picker-dialog"

/**
 * Saved product templates — a blank + artwork setup you can reopen instead of rebuilding.
 *
 * These have been written to the database for a long time and never read back: the list
 * and delete endpoints filtered on a `seller_id` column that never existed, so both threw
 * on every call, and the only caller in the codebase (the old HTML maker) never listed
 * them. This is the first surface that actually shows them.
 */
export function TemplatesPanel() {
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
      title="Product templates"
      actions={
        <Button size="sm" onClick={() => router.push("/design/maker")}>
          <Plus size={14} weight="bold" /> Make a template
        </Button>
      }
    >
      {items === null ? (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <CircleNotch size={15} className="animate-spin" /> Loading…
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Stack size={26} weight="duotone" className="text-muted-foreground/50" />
          <div className="text-sm font-medium">No templates yet</div>
          <div className="max-w-xs text-sm text-muted-foreground">
            Build a blank + artwork setup in the design maker and save it — it&apos;ll appear here, ready to reopen.
          </div>
          <Button size="sm" className="mt-1" onClick={() => router.push("/design/maker")}>
            <Plus size={14} weight="bold" /> Make a template
          </Button>
        </div>
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
                    alt={t.name ?? "Template"}
                    fill
                    unoptimized
                    className={blankImg ? "object-contain p-[18%]" : "object-cover"}
                  />
                ) : !blankImg ? (
                  <div className="flex size-full items-center justify-center text-muted-foreground/40">
                    <Stack size={26} weight="duotone" />
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-1 p-2">
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1 truncate text-sm font-medium">{t.name || "Untitled"}</div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Open ${t.name || "template"} in the maker`}
                    onClick={() => router.push(`/design/maker?template=${encodeURIComponent(t.id)}`)}
                  >
                    <PenNib size={14} weight="bold" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${t.name || "template"}`}
                    disabled={busy === t.id}
                    onClick={() => remove(t.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash size={14} weight="bold" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Which blank this was built on — the other half of "blank + artwork",
                      and previously nowhere on the card. */}
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{blankName || "No blank saved"}</span>
                  {/* The template's ID, copyable — and not decoration: this is exactly what
                      goes in the import sheet's Template ID column, which fills the blank,
                      artwork, placement and method for a line in one field. Same treatment
                      as a design's DSN badge, because it does the same job. */}
                  {/* TPL-12, not TPL-ms04ehic3elu. The base36 key is unique and unreadable;
                      nobody copies that off a card into a spreadsheet by eye. Sized to be
                      read rather than tucked away — same reason the design badge is. */}
                  <button
                    onClick={() => { navigator.clipboard?.writeText(ref).catch(() => {}); setCopied(t.id); setTimeout(() => setCopied(null), 1400) }}
                    title="Copy this template's reference"
                    className="eg-tap ml-auto shrink-0 rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {copied === t.id ? "Copied" : ref}
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
