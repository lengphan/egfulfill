"use client"

/**
 * ── THE FLAT OBJECT FAMILY ───────────────────────────────────────────────────────────
 *
 * Eight objects from the factory's own vocabulary, drawn as FLAT SOLIDS rather than line
 * art, each carrying one self-running loop that demonstrates what the object actually does.
 *
 * WHY SOLIDS AND NOT STROKES. The existing family (objects.tsx) is line drawings, and a
 * 1px stroke disappears at 40px and shimmers when it moves. A solid shape holds its read at
 * any size, animates without aliasing, and — the reason that matters here — can carry the
 * accent as a FILL, which is how the palette gets into the light bands at all.
 *
 * WHY CSS AND NOT A LIBRARY. Probing Composer showed 54 keyframe animations driving small
 * self-contained product demos, against 2 IntersectionObservers and 27 rAF calls on the whole
 * page. Almost no JavaScript. These loops run whether or not anything is scrolled, which is
 * also what makes them work on a phone, where every scroll-linked idea is weakest.
 *
 * THE PALETTE RULE: two hues per object, never more. Slate is the body, violet is the one
 * thing that moves. That single constraint is what keeps a flat illustration system from
 * tipping into pop-art novelty.
 *
 * THE PLACEMENT RULE: these live on BONE bands only. The dark bands keep the photography.
 * Drawn objects over a photograph is the one combination that reads as clip-art.
 */

export const OBJ_INK = "#101318"
export const OBJ_VIOLET = "#614EFA"
export const OBJ_PERI = "#C0C4FF"
export const OBJ_PAPER = "#F5F4F1"

/**
 * One <style> element, rendered once per page by React's dedup on `href`. Keyframes cannot
 * be expressed as inline style, and putting them in globals.css would spread this system's
 * internals across a file every other surface also edits.
 */
export function ObjectKeyframes() {
  return (
    <style href="eg-flat-objects" precedence="medium">{`
      @keyframes eg-unspool   { 0%,8% { stroke-dashoffset: 96 } 55%,100% { stroke-dashoffset: 0 } }
      @keyframes eg-stitch    { 0%,10% { transform: translateY(0) } 30% { transform: translateY(9px) } 50%,100% { transform: translateY(0) } }
      @keyframes eg-seam      { 0%,12% { stroke-dashoffset: 64 } 60%,100% { stroke-dashoffset: 0 } }
      @keyframes eg-hoop      { 0%,10% { transform: rotate(0deg) } 60%,100% { transform: rotate(90deg) } }
      @keyframes eg-mark      { 0%,20% { transform: scale(0); opacity: 0 } 55%,100% { transform: scale(1); opacity: 1 } }
      @keyframes eg-foldL     { 0%,15% { transform: rotateY(0deg) } 55%,100% { transform: rotateY(-78deg) } }
      @keyframes eg-foldR     { 0%,25% { transform: rotateY(0deg) } 65%,100% { transform: rotateY(78deg) } }
      @keyframes eg-write     { 0%,10% { stroke-dashoffset: 44 } 55%,100% { stroke-dashoffset: 0 } }
      @keyframes eg-flap      { 0%,15% { transform: rotateX(0deg) } 60%,100% { transform: rotateX(-72deg) } }
      @keyframes eg-scan      { 0%,6% { transform: translateY(0) } 50% { transform: translateY(38px) } 94%,100% { transform: translateY(0) } }
      @keyframes eg-travel    { 0% { transform: translateX(-8%) } 100% { transform: translateX(8%) } }

      .eg-obj * { transform-box: fill-box; }
      .eg-obj [data-a] { animation-duration: 3.2s; animation-iteration-count: infinite; animation-timing-function: cubic-bezier(.16,1,.3,1); }
      .eg-obj [data-a="unspool"] { animation-name: eg-unspool }
      .eg-obj [data-a="stitch"]  { animation-name: eg-stitch; transform-origin: 50% 0% }
      .eg-obj [data-a="seam"]    { animation-name: eg-seam }
      .eg-obj [data-a="hoop"]    { animation-name: eg-hoop; transform-origin: 50% 50% }
      .eg-obj [data-a="mark"]    { animation-name: eg-mark; transform-origin: 50% 50% }
      .eg-obj [data-a="foldL"]   { animation-name: eg-foldL; transform-origin: 100% 50% }
      .eg-obj [data-a="foldR"]   { animation-name: eg-foldR; transform-origin: 0% 50% }
      .eg-obj [data-a="write"]   { animation-name: eg-write }
      .eg-obj [data-a="flap"]    { animation-name: eg-flap; transform-origin: 50% 100% }
      .eg-obj [data-a="scan"]    { animation-name: eg-scan }

      /* THE STILL IS THE FINISHED STATE, not a frozen first frame. Someone with motion off
         should see a stitched seam and a closed box, which is what the loop was saying. */
      @media (prefers-reduced-motion: reduce) {
        .eg-obj [data-a] { animation: none !important }
        .eg-obj [data-a="unspool"], .eg-obj [data-a="seam"], .eg-obj [data-a="write"] { stroke-dashoffset: 0 !important }
        .eg-obj [data-a="hoop"] { transform: rotate(90deg) }
        .eg-obj [data-a="mark"] { transform: scale(1); opacity: 1 }
        .eg-obj [data-a="foldL"] { transform: rotateY(-78deg) }
        .eg-obj [data-a="foldR"] { transform: rotateY(78deg) }
        .eg-obj [data-a="flap"] { transform: rotateX(-72deg) }
      }
    `}</style>
  )
}

type P = { size?: number; className?: string; ink?: string; accent?: string }
const box = (size: number) => ({ width: size, height: size, display: "block" as const })

/** 01 — the raw material. A violet thread unspools and leaves the frame to the right. */
export function FlatCone({ size = 96, className = "", ink = OBJ_INK, accent = OBJ_VIOLET }: P) {
  return (
    <svg viewBox="0 0 96 96" style={box(size)} className={`eg-obj ${className}`} aria-hidden focusable="false">
      <path d="M40 22h16l10 50H30z" fill={ink} />
      <rect x="26" y="72" width="44" height="7" fill={ink} />
      <rect x="45" y="12" width="6" height="12" fill={ink} />
      <path d="M51 18h44" stroke={accent} strokeWidth="4" fill="none" strokeDasharray="96" data-a="unspool" />
    </svg>
  )
}

/** 02 — decoration. The bar descends and a violet seam appears under it. */
export function FlatNeedle({ size = 96, className = "", ink = OBJ_INK, accent = OBJ_VIOLET }: P) {
  return (
    <svg viewBox="0 0 96 96" style={box(size)} className={`eg-obj ${className}`} aria-hidden focusable="false">
      <g data-a="stitch">
        <rect x="34" y="8" width="28" height="26" fill={ink} />
        <rect x="46" y="34" width="4" height="24" fill={ink} />
      </g>
      <rect x="12" y="70" width="72" height="10" fill={ink} opacity="0.14" />
      <path d="M14 66h68" stroke={accent} strokeWidth="4" fill="none" strokeDasharray="64" data-a="seam" />
    </svg>
  )
}

/** 03 — the hoop, quarter-turning as the work is set. */
export function FlatHoop({ size = 96, className = "", ink = OBJ_INK, accent = OBJ_VIOLET }: P) {
  return (
    <svg viewBox="0 0 96 96" style={box(size)} className={`eg-obj ${className}`} aria-hidden focusable="false">
      <g data-a="hoop">
        <circle cx="48" cy="48" r="30" fill="none" stroke={ink} strokeWidth="9" />
        <rect x="42" y="8" width="12" height="12" fill={ink} />
      </g>
      <circle cx="48" cy="48" r="16" fill={accent} data-a="mark" />
    </svg>
  )
}

/** 04 — the blank, gaining its mark. */
export function FlatBlank({ size = 96, className = "", ink = OBJ_INK, accent = OBJ_VIOLET }: P) {
  return (
    <svg viewBox="0 0 96 96" style={box(size)} className={`eg-obj ${className}`} aria-hidden focusable="false">
      <path d="M34 18h28l16 10-8 14-6-4v40H32V38l-6 4-8-14z" fill={ink} />
      <rect x="40" y="48" width="16" height="16" fill={accent} data-a="mark" />
    </svg>
  )
}

/** 05 — finished. Two flaps fold in and it becomes a square. */
export function FlatFold({ size = 96, className = "", ink = OBJ_INK, accent = OBJ_PERI }: P) {
  return (
    <svg viewBox="0 0 96 96" style={box(size)} className={`eg-obj ${className}`} aria-hidden focusable="false">
      <rect x="32" y="24" width="32" height="48" fill={ink} />
      <rect x="12" y="24" width="20" height="48" fill={accent} data-a="foldL" />
      <rect x="64" y="24" width="20" height="48" fill={accent} data-a="foldR" />
    </svg>
  )
}

/** 06 — identity. A violet line writes itself across the woven label. */
export function FlatLabel({ size = 96, className = "", ink = OBJ_INK, accent = OBJ_VIOLET }: P) {
  return (
    <svg viewBox="0 0 96 96" style={box(size)} className={`eg-obj ${className}`} aria-hidden focusable="false">
      <rect x="18" y="34" width="60" height="28" fill={ink} />
      <rect x="18" y="26" width="6" height="44" fill={ink} opacity="0.35" />
      <rect x="72" y="26" width="6" height="44" fill={ink} opacity="0.35" />
      <path d="M28 48h40" stroke={accent} strokeWidth="4" fill="none" strokeDasharray="44" data-a="write" />
    </svg>
  )
}

/** 07 — packed. The flap closes. */
export function FlatBox({ size = 96, className = "", ink = OBJ_INK, accent = OBJ_PERI }: P) {
  return (
    <svg viewBox="0 0 96 96" style={box(size)} className={`eg-obj ${className}`} aria-hidden focusable="false">
      <rect x="20" y="40" width="56" height="38" fill={ink} />
      <rect x="20" y="26" width="56" height="16" fill={accent} data-a="flap" />
    </svg>
  )
}

/** 08 — out. A violet line sweeps the code and the parcel leaves. */
export function FlatScan({ size = 96, className = "", ink = OBJ_INK, accent = OBJ_VIOLET }: P) {
  return (
    <svg viewBox="0 0 96 96" style={box(size)} className={`eg-obj ${className}`} aria-hidden focusable="false">
      {[22, 30, 35, 43, 51, 56, 64, 69].map((x, i) => (
        <rect key={x} x={x} y="24" width={i % 3 === 0 ? 5 : 3} height="48" fill={ink} />
      ))}
      <rect x="14" y="28" width="68" height="4" fill={accent} data-a="scan" />
    </svg>
  )
}

/** The family, in factory order — every object appears once, at its station. */
export const FLAT_FAMILY = [
  { key: "cone", label: "Thread", station: "Raw material", Obj: FlatCone },
  { key: "needle", label: "Needle", station: "Decoration", Obj: FlatNeedle },
  { key: "hoop", label: "Hoop", station: "Set the work", Obj: FlatHoop },
  { key: "blank", label: "Blank", station: "The garment", Obj: FlatBlank },
  { key: "fold", label: "Fold", station: "Finished", Obj: FlatFold },
  { key: "label", label: "Label", station: "Identity", Obj: FlatLabel },
  { key: "box", label: "Mailer", station: "Packed", Obj: FlatBox },
  { key: "scan", label: "Scan", station: "Out the door", Obj: FlatScan },
] as const
