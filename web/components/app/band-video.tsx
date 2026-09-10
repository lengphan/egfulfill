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
 * NO SEAM TO HIDE. The video's ground was rendered at the band's own colour and shifted onto
 * it exactly, so where the video begins is simply where the tubes begin — there is no edge,
 * which is why this needs no fade and gets none.
 *
 * WHAT IT COSTS TO RUN. A looping video decodes frames forever, so it stops when the band
 * leaves the viewport and when the tab is hidden — the same discipline the shader had, for
 * the same reason: a header that keeps a decoder busy behind another tab deserves deleting.
 * Under prefers-reduced-motion it never plays at all and the poster stands in, which is the
 * still we were already shipping.
 */
export function BandVideo({
  src = "/ploy/obj/peri-flow.mp4",
  poster = "/ploy/obj/peri-still.webp",
}: { src?: string; poster?: string }) {
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
