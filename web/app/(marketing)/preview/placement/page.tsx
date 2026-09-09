/**
 * A FIXTURE FOR THE PLACEMENT PICKER, because the thing it prices cannot be seen otherwise.
 *
 * The picker only appears for a product carrying more than one face, and `sides`/`sideFee`
 * are new on the public shape — so until the API is deployed, every real product on the
 * live catalogue answers with neither and the block is invisible by design. This renders
 * the same component against a product that HAS them, which is the only way to look at the
 * arithmetic before it ships (CLAUDE.md §7: run the real module on real input).
 *
 * Sits beside /preview/heaps, which exists for the same reason. Delete it once the picker
 * has been read on a live product.
 */
import { BoldProduct } from "@/components/marketing/bold-product"
import type { PublicProduct } from "@/lib/api"

const FIXTURE: PublicProduct = {
  slug: "placement-fixture",
  name: "Unisex Heavy Cotton T-Shirt",
  image: null,
  category: "Apparel",
  description: "A fixture, not a product. 6.1 oz./yd², 100% ring-spun cotton.",
  brand: "Gildan",
  price: 7,
  priceFrom: 7,
  priceVaries: true,
  sizePrices: [
    { size: "S", price: 7 },
    { size: "M", price: 7 },
    { size: "L", price: 7 },
    { size: "2XL", price: 9.5 },
  ],
  ship: 6.99,
  methods: ["DTG printing / Embroidery"],
  colors: [
    { name: "Black", image: null },
    { name: "White", image: null },
  ],
  sizes: ["S", "M", "L", "2XL"],
  methodPrices: { emb: 3.5 },
  // The two new fields — a four-face garment at $2.00 per additional face.
  sides: ["front", "back", "left", "right"],
  sideFee: 2,
}

export default function PlacementPreview() {
  return <BoldProduct product={FIXTURE} shipping={{ extra: 2 }} />
}
