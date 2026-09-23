"use client"

/**
 * THE BAND'S MATERIAL AS A STILL, AT FULL RESOLUTION.
 *
 * WHY A STILL AND NOT THE VIDEO (2026-09-23). The shipped clip was read as blurry, and it
 * was, for three stacked reasons measured rather than guessed:
 *
 *   - THE MATERIAL HAD NO DETAIL TO LOSE. A defocused satin drape carries a Laplacian
 *     variance of 44 over the half that shows material. These carry 211-321. No bitrate
 *     recovers detail that was never rendered, so the fix had to be a material with edges,
 *     not a bigger file.
 *   - THE CROP CHOSE THE SOFTEST PART ON PURPOSE. The clip's window was picked by scanning
 *     for the LOWEST variance in the left third, so the name would sit on quiet plate. That
 *     is a direct vote for blur. These reserve the left half as EMPTY BACKDROP instead —
 *     quiet because there is nothing there, not because it is out of focus.
 *   - IT WAS 1600px WIDE AT 98kbps. The band is ~1960 device px at a 1040pt window and more
 *     past that, so it was upscaled before it was ever decoded. These are 3024 wide.
 *
 * THE BAND IS A 10.9:1 STRIPE, AND THAT IS THE WHOLE DESIGN CONSTRAINT. A 21:9 frame cropped
 * into it keeps only the middle fifth, which lands on the INTERIOR of a large form — the one
 * place any material is soft. So the composition is made at stripe scale: many small forms
 * with their own edges, so every horizontal slice is full of them.
 *
 * NO DECODER. A still costs nothing to run, cannot stutter, and needs neither the
 * IntersectionObserver nor the visibilitychange discipline BandVideo carries. Under
 * prefers-reduced-motion it is already the right answer rather than a fallback.
 */
/**
 * AND IT IS MASKED AT THE LEFT, WHICH THE CLIP NEVER NEEDED.
 *
 * The shipped clip could butt straight onto the band because its ground WAS the band's
 * colour — rendered that way and shifted onto it exactly, so there was no edge to hide.
 * A generated backdrop is only ever approximately #dfe3f2, and the models also like to end
 * a material on a dead-straight vertical cut, so both together read as a picture PASTED on
 * the band rather than as the band's own surface. Measured on the balloon candidate the step
 * was visible as a hard line a third of the way across.
 *
 * So the image fades out across the left half and the band's own ground takes over. That
 * does two jobs with one rule: there is no seam at any exact colour match, and the greeting
 * is guaranteed flat plate underneath rather than whatever the render happened to put there
 * — which is the contrast floor holding by construction instead of by measurement per image.
 */
const FADE = "linear-gradient(to right, transparent 0%, transparent 30%, rgba(0,0,0,0.55) 56%, #000 78%)"

export function BandStill({ src }: { src: string }) {
  return (
    <div aria-hidden className="eg-bandvid-frame">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        className="eg-bandvid select-none"
        style={{ maskImage: FADE, WebkitMaskImage: FADE }}
      />
    </div>
  )
}
