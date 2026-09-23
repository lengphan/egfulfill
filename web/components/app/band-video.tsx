"use client"

import { useEffect, useRef } from "react"

/**
 * THE CHROME, ACTUALLY MOVING.
 *
 * A still render sliding across the band moves the PICTURE; the metal itself never flows.
 * This is the metal flowing — generated from the very render the band was already using
 * (image-to-video), so the tubes, the lighting and the charcoal ground are the same ones,
 * not a second look that has to be matched by eye.
 *
 * OFFSET, NOT FULL-BLEED (owner's call). The video sits to the RIGHT of the greeting and
 * never runs under it. Motion behind type is the one thing type cannot compete with — a
 * still can sit behind a name harmlessly, a moving surface pulls the eye off it every few
 * seconds. So the words keep clean plate and the chrome starts after them.
 *
 * NO SEAM TO HIDE. The clip covers the whole band, so where it begins is simply where the
 * band begins — there is no edge, which is why this needs no fade and gets none. (The
 * `masked` prop below is for the generated stills, which DO carry an internal hard cut.)
 *
 * THE MATERIAL IS THE ONE THAT WAS ALREADY THERE, RE-SHOT (owner, 2026-09-23: "i actually
 * really like the banner we have now — just the motion and quality i dont like, so more like
 * fabric moving motion, more waves and much higher resolution").
 *
 * So nothing about the look changed on purpose: the new frame was generated FROM the old
 * one as an image reference, same periwinkle satin, same palette, same calm left third under
 * the greeting. What changed is the two things that were actually complained about, and both
 * are measured rather than asserted:
 *
 *   resolution  1600×240 → 3808×528, so the band stops upscaling before it decodes
 *   bitrate     98 kbps  → 2.6 Mbps, 27× — the old figure was the whole "blurry" story
 *   motion      mean frame-to-frame 0.203 → 1.972, NINE times: the old clip barely moved,
 *               which is why it read as a still picture sliding rather than as cloth
 *   loop        motion continuity ACROSS the cut +0.29, against +0.41 mid-clip — see below
 *
 * THE LOOP IS CROSSFADED, AND THE REASON IS NOT THE ONE I FIRST MEASURED (owner, 2026-09-23:
 * "theres a start and end ????").
 *
 * The first cut pinned `end_image` to the start frame and then chose the window with the
 * smallest |last - first|. By that number it looked excellent — 1.21 against a typical
 * frame-to-frame step of 2.17, so the cut was SMALLER than an ordinary step — and it was
 * still visibly a loop. The measurement was answering the wrong question.
 *
 * POSITION IS NOT VELOCITY. Correlating each frame's motion with the next gives +0.42 through
 * the middle of the clip: the fabric keeps flowing one way. Across the cut it was NEGATIVE,
 * -0.17 and -0.19 — the cloth reached the starting pose and then flowed BACKWARDS out of it.
 * That is what pinning an end frame asks for: the model decelerates and reverses to land on
 * the pose it was given. The still matched and the motion did not, and the eye reads motion.
 *
 * So the last 24 frames are blended into the first 24 (out[i<N] = lerp(src[M+i], src[i],
 * i/N), length M = L-N), which spreads the reversal across a second instead of landing it in
 * one frame. Measured after: +0.29 and +0.25 — the same positive regime as ordinary motion —
 * and |last - first| 2.46 against a typical step of 2.63.
 *   contrast    ink #171826 on the darkest 5% under the greeting, across ALL 116 frames,
 *               9.82:1 — measured per frame because a moving surface can darken under the
 *               name mid-loop and a figure from frame 0 would never see it
 *
 * WHY 3808 AND NOT THE 5084 IT WAS UPSCALED TO. The clip is generated at 2944 and run
 * through a 4K upscale, which genuinely SHARPENS rather than interpolating: +31% edge
 * density, +24% acutance. But the gain is baked into the pixels, so it survives a Lanczos
 * downsample — measured, 3808 scores 77.1/21.0 against the full 5084's 75.8/21.0, at 40% of
 * the bytes. Four megabytes in a header that decodes forever, for a figure that is no
 * better, is a cost with nothing on the other side of it.
 *
 * AND WHY THIS IS THE CEILING FOR THIS MATERIAL. Rendered at the same band width, the 6048px
 * still and the 2944px video frame measured 62.6/16.0 and 58.9/17.0 — the same. Satin has no
 * hard edges to resolve, so past this point pixels stop buying sharpness: chrome measures an
 * acutance of 52 against this material's 21. If the band should look CRISPER rather than
 * bigger, the material has to change; more resolution will not do it.
 *
 * WHAT IT COSTS TO RUN. A looping video decodes frames forever, so it stops when the band
 * leaves the viewport and when the tab is hidden — the same discipline the shader had, for
 * the same reason: a header that keeps a decoder busy behind another tab deserves deleting.
 * Under prefers-reduced-motion it never plays at all and the poster stands in, which is the
 * still we were already shipping.
 */
/**
 * THE LEFT EDGE IS MASKED WHEN THE CLIP DID NOT RENDER ITS OWN GROUND.
 *
 * `peri-flow.mp4` needed no fade because its ground WAS the band's colour, shifted onto it
 * exactly. A clip generated from a still carries whatever backdrop the render produced, which
 * is only ever approximately #dfe3f2 — so it butts onto the band as a visible step, and it
 * also puts moving pixels under the greeting, which §4 forbids for the reason the offset
 * existed in the first place. The fade does both jobs: no seam at any colour, and flat plate
 * under the name by construction rather than by measuring each clip.
 */
const FADE = "linear-gradient(to right, transparent 0%, transparent 30%, rgba(0,0,0,0.55) 56%, #000 78%)"

export function BandVideo({
  src = "/ploy/obj/peri-flow-2x.mp4",
  poster = "/ploy/obj/peri-still-2x.webp",
  masked = false,
}: { src?: string; poster?: string; masked?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const vid = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = vid.current
    const box = host.current
    if (!el || !box) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    let visible = true
    const sync = () => {
      if (visible && !document.hidden) void el.play().catch(() => {})
      else el.pause()
    }
    const io = new IntersectionObserver((e) => { visible = e[0]?.isIntersecting ?? true; sync() })
    io.observe(box)
    document.addEventListener("visibilitychange", sync)
    sync()
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", sync) }
  }, [])

  return (
    <div ref={host} aria-hidden className="eg-bandvid-frame">
      <video
        ref={vid}
        className="eg-bandvid"
        style={masked ? { maskImage: FADE, WebkitMaskImage: FADE } : undefined}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        // No autoplay attribute: play() is called only once the band is actually on screen,
        // so a dashboard opened in a background tab never starts a decoder.
        preload="metadata"
      />
    </div>
  )
}
