"use client"

import type { CSSProperties } from "react"

/**
 * A few stickers on the picture — the one bit of play on an otherwise straight page.
 *
 * WHY THEY SAY NOTHING PARTICULAR. A sticker reading "48H DISPATCH" or "10,000 SELLERS" is
 * a CLAIM, and a claim on a sign-in page is one nobody has checked and everybody will quote
 * back. These carry the mark and words that are true of any print-on-demand run, plus one
 * shape that is just a shape.
 *
 * MOTION IS OPT-OUT (§4). Each drifts on its own slow loop with its own delay, so they never
 * pulse together; under `prefers-reduced-motion` the animation is dropped and they simply
 * sit where they are — the layout never depends on it.
 *
 * They ride the IMAGE, never the form. Nothing here overlaps a control, and nothing here IS
 * a control: aria-hidden, no focus, no pointer events.
 */
type Sticker = {
  kind: "word" | "blob"
  text?: string
  /** % of the panel, from the top-left. */
  x: number
  y: number
  rotate: number
  /** seconds — all different, so the group never beats in time */
  dur: number
  delay: number
  ground: string
  ink: string
}

const STICKERS: Sticker[] = [
  { kind: "word", text: "egful", x: 7, y: 11, rotate: -8, dur: 11, delay: 0, ground: "#0A0A0A", ink: "#FFFFFF" },
  { kind: "word", text: "made to order", x: 58, y: 24, rotate: 7, dur: 14, delay: 1.6, ground: "#D4F897", ink: "#0A0A0A" },
  { kind: "blob", x: 76, y: 68, rotate: 14, dur: 9, delay: 0.8, ground: "#D4F897", ink: "#0A0A0A" },
  { kind: "word", text: "one at a time", x: 9, y: 80, rotate: 5, dur: 13, delay: 2.4, ground: "#FFFFFF", ink: "#0A0A0A" },
]

export function Stickers() {
  return (
    <>
      <style>{`
        @keyframes eg-sticker-drift {
          0%,100% { transform: translate3d(0,0,0) rotate(var(--r)); }
          50%     { transform: translate3d(0,-11px,0) rotate(calc(var(--r) + 2deg)); }
        }
        .eg-sticker { animation: eg-sticker-drift var(--d) ease-in-out var(--delay) infinite; }
        @media (prefers-reduced-motion: reduce) { .eg-sticker { animation: none; } }
      `}</style>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
        {STICKERS.map((s, i) => (
          <span
            key={i}
            className="eg-sticker absolute block"
            style={
              {
                left: `${s.x}%`,
                top: `${s.y}%`,
                "--r": `${s.rotate}deg`,
                "--d": `${s.dur}s`,
                "--delay": `${s.delay}s`,
                transform: `rotate(${s.rotate}deg)`,
                filter: "drop-shadow(0 6px 14px rgba(10,10,10,.16))",
              } as CSSProperties
            }
          >
            {s.kind === "blob" ? (
              <svg width="58" height="58" viewBox="0 0 58 58" fill="none">
                {/* The appliqué shape the garments in these frames actually carry, so even
                    the abstract sticker comes from the product. */}
                <path
                  d="M29 3c5 0 7 6 11 8s10-1 13 3-2 9-2 14 5 10 2 14-9 1-13 3-6 8-11 8-7-6-11-8-10 1-13-3 2-9 2-14-5-10-2-14 9-1 13-3 6-8 11-8Z"
                  fill={s.ground}
                />
              </svg>
            ) : (
              <span
                className="block whitespace-nowrap rounded-full px-3.5 py-1.5 text-[11px] font-semibold tracking-tight"
                style={{ background: s.ground, color: s.ink }}
              >
                {s.text}
              </span>
            )}
          </span>
        ))}
      </div>
    </>
  )
}
