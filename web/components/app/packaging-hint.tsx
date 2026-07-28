import { Warning, Package } from "@phosphor-icons/react"
import { packagingHint } from "@/lib/dim-weight"

/**
 * The dim-weight packaging suggestion shown under a parcel's dimensions. Visible as soon as
 * there's a weight — a neutral "keep it under X" while actual weight still wins, an amber
 * warning once dimensional weight has overtaken it (the upcharge zone). This is the box
 * suggestion; it lives next to the fields it reasons about so it's actually findable.
 */
export function PackagingHint({
  weightOz, length, width, height,
}: {
  weightOz: number | string
  length: number | string
  width: number | string
  height: number | string
}) {
  const h = packagingHint(weightOz, length, width, height)
  if (!h) return null
  if (h.billedOnSize)
    return (
      <div className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
        <span>Rated on size: dim weight {h.dimLb!.toFixed(2)} lb &gt; {h.actualLb.toFixed(2)} lb actual. Use a box under {Math.round(h.maxVolumeIn3)} in³ (≈{h.suggestedCube.toFixed(1)}″ cube) to be rated on weight instead.</span>
      </div>
    )
  return (
    <div className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
      <Package size={13} weight="fill" className="mt-0.5 shrink-0" />
      <span>Rated on weight ({h.actualLb.toFixed(2)} lb). Keep the box under {Math.round(h.maxVolumeIn3)} in³ (≈{h.suggestedCube.toFixed(1)}″ cube) so it stays that way and isn&apos;t re-rated on size.</span>
    </div>
  )
}
