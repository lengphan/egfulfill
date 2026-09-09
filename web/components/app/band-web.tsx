/**
 * THE CHROME, STARTING WHERE THE GREETING ENDS.
 *
 * The first version ran the web edge to edge and dissolved it under the type with a gradient.
 * That is a workaround wearing a technique: the shape was still there, still competing, and a
 * mask was apologising for it. This places the form instead — it begins just past the name,
 * close enough to belong to it, and every strand of it survives.
 *
 * WHICH MEANS THE ASSET IS CROPPED, NOT THE LAYOUT. The band is a 10:1 stripe and the render
 * is 2.4:1, so something has to give: `contain` would shrink the sculpture to a stamp and
 * `cover` would keep a quarter of it. So the SOURCE is cut to a band-shaped strip first —
 * chosen by ink coverage rather than from the middle by habit, so the strip that ships is the
 * one carrying the most of the sculpture — and that strip then fills its box whole.
 *
 * AND IT BREATHES. A still render in a header reads as a picture stuck to the page; the same
 * render sliding a few percent and swelling very slightly reads as a thing that is alive in
 * there. Two clocks again — 23s across, 17s on the swell — because equal periods return the
 * frame to where it started on a beat, and a beat is what gives ambient motion away.
 *
 * IT MOVES AS ONE PIECE. The strands cannot drift independently: they are one photograph, and
 * anything that pulls them apart would have to be a second render.
 *
 * WHERE IT STARTS is the one number that matters here. Too far right and it is a decoration
 * parked in the corner; overlapping the name and we are back to masking. It begins at 42% —
 * a little after the greeting ends, near enough to read as one object with it.
 */
export function BandWeb({ src = "/ploy/obj/round-c-band.webp" }: { src?: string }) {
  return (
    /* The frame clips; the picture inside it is wider than the frame, and that slack is what
       the drift moves through. Animate the image at its own size and the crop edge walks into
       view — the motion would advertise exactly the seam it should hide. */
    <span aria-hidden className="eg-web-frame">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="eg-web" />
    </span>
  )
}
