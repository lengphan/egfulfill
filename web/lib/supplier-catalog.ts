import { getSsStyle, getOttoStyle, type CatalogProduct } from "@/lib/api"

// Otto's Product Data stores images as Google Drive links, which don't render in an <img>
// (Drive blocks hotlinking). Rewrite to Drive's embeddable thumbnail URL.
export function driveImg(url?: string | null): string {
  if (!url) return ""
  const s = String(url)
  const m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/) || s.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800` : s
}
export const driveMap = (m?: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, driveImg(v)]))

type SsFb = { title?: string | null; price?: number | string | null; image?: string | null; colors?: string[] | null }
type OttoFb = { name?: string | null; price?: number | string | null; image?: string | null; colors?: string[] | null }

// Build a catalog product from a supplier style (fetches its full detail on demand). One
// place, reused by every "Add to catalog" button so the shape never drifts.
export async function ssCatalogProduct(styleID: string, fb: SsFb): Promise<CatalogProduct> {
  const d = await getSsStyle(styleID)
  if (d.error) throw new Error(d.error)
  return {
    id: "SS-" + styleID, name: d.title || fb.title || styleID, type: "Apparel", method: "DTG", status: "Active",
    price: d.price ?? fb.price ?? 0, basePrice: d.price ?? fb.price ?? 0,
    sizes: d.sizes ?? [], colorImages: d.colorImages ?? {}, mainColor: (d.colors ?? fb.colors ?? [])[0],
    img: d.image ?? fb.image ?? undefined, images: d.extraImages ?? [], sku: styleID,
    description: d.description ?? undefined, supplier: "S&S",
  }
}
export async function ottoCatalogProduct(style: string, fb: OttoFb): Promise<CatalogProduct> {
  const d = await getOttoStyle(style).catch(() => null)
  const colorImages = d && !d.error ? driveMap(d.colorImages) : {}
  if (Object.keys(colorImages).length === 0) for (const c of fb.colors ?? []) colorImages[c] = driveImg(fb.image)
  return {
    id: "OTTO-" + style, name: d?.name || fb.name || style, type: "Headwear", method: "Embroidery", status: "Active",
    price: Number(d?.price ?? fb.price) || 0, basePrice: Number(d?.price ?? fb.price) || 0,
    sizes: d?.sizes ?? [], colorImages, mainColor: Object.keys(colorImages)[0] || (fb.colors ?? [])[0],
    img: driveImg(d?.image ?? fb.image) || undefined, sku: d?.skus?.[0] || style,
    description: d?.description ?? undefined, supplier: "Otto Cap",
  }
}
