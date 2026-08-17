/**
 * ONE PRODUCT THUMBNAIL, for every catalogue surface.
 *
 * The same tile appears on each tab of the catalogue — the products you publish, the
 * supplier styles you pick from — and it was written out separately in each, so the two
 * disagreed the moment one of them was touched: 96px white on one tab, 56px grey on the
 * next, on screens whose whole job is choosing between products by eye. A thumbnail is not
 * decoration here; it is the control.
 *
 * WHITE, WITH A BORDER. Supplier photography is a garment cut out on white, so a white tile
 * lets the product sit on the card rather than in a visible box, and the edge the eye needs
 * comes from the border instead of from a tinted panel behind the picture.
 *
 * The PRINTED lookbook deliberately does NOT share this — its wells have no border, so a
 * white plate there would leave a white shirt with nothing at all to define it, which is
 * why catalog-print keeps its warm grey. Same photographs, two surfaces, and the plate is
 * only load-bearing on the one without a frame.
 *
 * object-contain, never cover: these are whole garments, and cropping one to fill a square
 * cuts the sleeves off the thing you are trying to recognise.
 */
export function ProductThumb({ src, alt = "", className = "" }: {
  src?: string | null
  alt?: string
  /** Size override only — `size-16` for a denser table. Everything else is the house tile. */
  className?: string
}) {
  return (
    <div className={"size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-white p-1 " + className}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="size-full object-contain" />
      ) : (
        /* "no image" rather than an icon: a product with no photograph is a thing someone
           has to go and fix, and it should read as missing rather than as styling. */
        <div className="flex size-full items-center justify-center text-center text-3xs text-muted-foreground">
          no image
        </div>
      )}
    </div>
  )
}
