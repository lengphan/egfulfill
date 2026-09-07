"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react"

/**
 * ── THE BRAND KIT ────────────────────────────────────────────────────────────────────
 *
 * The marketing site's own primitives. Deliberately LOW-LEVEL: a type engine, a handful of
 * motion mechanics, and one image treatment. Composition lives in the pages, because a
 * marketing page whose sections all come out of the same layout component is exactly the
 * thing that reads as a template — the brief's first requirement was that every major
 * section feel individually art-directed.
 *
 * So: nothing here draws a "section". It draws letters, movement and pictures.
 */

/* ── THE PHOTOGRAPHIC GRADE ──────────────────────────────────────────────────────────
 * ONE filter, applied to every photograph on the marketing site.
 *
 * The complaint about the previous imagery was that it was too saturated, and that is a
 * GRADE problem rather than a subject problem — the colourways were pushed to sell the
 * colour. Fixing it in CSS rather than in the files means it applies to whatever an admin
 * uploads next, including photographs nobody has looked at yet, and it is one value to
 * change rather than 36.
 */
export const GRADE = "saturate(0.82) contrast(1.06)" as const
/** The dark bands want a touch more contrast, since the picture is doing the lighting. */
export const GRADE_DARK = "saturate(0.7) contrast(1.12) brightness(0.94)" as const

/* ── EASING ──────────────────────────────────────────────────────────────────────────
 * One curve. A site whose easings disagree reads as several sites. Hard ease-out: most of
 * the distance in the first third, then it settles, which is what makes an entrance feel
 * like an object arriving rather than a value being interpolated. */
export const EASE = [0.16, 1, 0.3, 1] as const
export const EASE_LONG = [0.22, 0.61, 0.36, 1] as const

/* ─────────────────────────────────────────────────────────────────────────────────────
 * THE TYPE ENGINE
 *
 * Archivo carries a real width axis (62–125). That is the identity: the same family set
 * condensed at 8rem and wide at 11px, so display and functional text are one voice at two
 * extremes rather than two typefaces pretending to be a system. Nothing here needs a second
 * alphabet, and the one-face rule the product runs on survives.
 * ──────────────────────────────────────────────────────────────────────────────────── */

type DisplayProps = {
  children: React.ReactNode
  /** wdth axis, 62 (condensed) → 125 (extended). */
  width?: number
  weight?: number
  /** Any CSS length; use clamp() so it scales with the viewport rather than breaking. */
  size: string
  leading?: number
  tracking?: string
  className?: string
  style?: React.CSSProperties
  as?: "h1" | "h2" | "h3" | "p" | "div" | "span"
}

export function Display({
  children, width = 100, weight = 600, size, leading = 0.88,
  tracking = "-0.04em", className = "", style, as = "div",
}: DisplayProps) {
  const Tag = as
  return (
    <Tag
      className={className}
      style={{
        fontFamily: "var(--font-archivo), system-ui, sans-serif",
        fontVariationSettings: `"wdth" ${width}`,
        fontWeight: weight,
        fontSize: size,
        lineHeight: leading,
        letterSpacing: tracking,
        textWrap: "balance",
        ...style,
      }}
    >
      {children}
    </Tag>
  )
}

/**
 * The small wide label. The width axis inverted — 118 instead of 62 — so a 10px eyebrow is
 * visibly the SAME face as the 8rem headline above it rather than a different one shrunk.
 */
export function Eyebrow({ children, className = "", style }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties
}) {
  return (
    <span
      className={`inline-block text-[11px] uppercase ${className}`}
      style={{
        fontFamily: "var(--font-archivo), system-ui, sans-serif",
        fontVariationSettings: '"wdth" 118',
        fontWeight: 500,
        letterSpacing: "0.18em",
        ...style,
      }}
    >
      {children}
    </span>
  )
}

/**
 * ── CLIP REVEAL ──────────────────────────────────────────────────────────────────────
 * A line rises out of a mask, one line at a time. The mask is the point: the words do not
 * fade in, they arrive from behind an edge, which is what reads as a printed thing being
 * pulled into view rather than a div becoming opaque.
 *
 * SPLIT ON LINES, NOT WORDS. Per-word masks put a separate overflow box around every word,
 * so a long headline reveals as confetti; per line it reads as type being set.
 *
 * ── THE TRAP, AND WHY THE OBSERVER IS ON THE BLOCK ───────────────────────────────────
 * The obvious build puts `whileInView` on each translated line. It renders NOTHING, on every
 * headline, silently.
 *
 * IntersectionObserver clips a target's rect by its ancestors' overflow before computing the
 * ratio. The line starts at translateY(108%) inside an `overflow: hidden` parent, so its
 * visible rect is empty, so the ratio is 0, so it is never "in view", so it never animates
 * out of hiding — a deadlock where the element's hiding mechanism is exactly what prevents
 * it being seen. It fails with no error and no console output, and it looks like a section
 * that simply forgot its heading.
 *
 * So the observer goes on the BLOCK, which is never clipped, and the lines animate off that
 * one boolean. It is also one observer per headline instead of one per line.
 */
export function ClipReveal({ lines, size, width = 100, weight = 600, leading = 0.88, tracking = "-0.04em", delay = 0, className = "", style, as = "h2" }: {
  lines: string[]
  size: string
  width?: number
  weight?: number
  leading?: number
  tracking?: string
  delay?: number
  className?: string
  style?: React.CSSProperties
  as?: "h1" | "h2" | "p" | "div"
}) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLHeadingElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -14% 0px" })
  const Tag = as
  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        fontFamily: "var(--font-archivo), system-ui, sans-serif",
        fontVariationSettings: `"wdth" ${width}`,
        fontWeight: weight,
        fontSize: size,
        lineHeight: leading,
        letterSpacing: tracking,
        ...style,
      }}
    >
      {lines.map((line, i) => (
        <span key={`${line}-${i}`} className="block overflow-hidden">
          <motion.span
            className="block"
            initial={false}
            animate={reduce || inView ? { y: 0 } : { y: "108%" }}
            transition={{ duration: 0.85, delay: delay + i * 0.075, ease: EASE }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  )
}

/**
 * ── STRETCH ──────────────────────────────────────────────────────────────────────────
 * The signature move, and it exists only because the face has a width axis: the headline
 * arrives CONDENSED and opens to its true width. Nothing translates, nothing fades — the
 * letters themselves widen, which is a gesture a static typeface simply cannot make.
 *
 * Used ONCE per page. It is a brand mark, not a transition.
 */
export function Stretch({ children, size, from = 66, to = 100, weight = 700, leading = 0.86, className = "", style, as = "h1" }: {
  children: React.ReactNode
  size: string
  from?: number
  to?: number
  weight?: number
  leading?: number
  className?: string
  style?: React.CSSProperties
  as?: "h1" | "h2" | "div"
}) {
  const reduce = useReducedMotion()
  const Tag = as
  const w = useMotionValue(reduce ? to : from)
  const settings = useTransform(w, (v) => `"wdth" ${v.toFixed(1)}`)

  useEffect(() => {
    if (reduce) return
    /* Driven by hand rather than by an `animate` prop because fontVariationSettings is a
       STRING, and a spring cannot interpolate a string — it has to interpolate the number
       and the string has to be derived from it. */
    const start = performance.now()
    const dur = 1500
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      // the house curve, evaluated directly
      const e = 1 - Math.pow(1 - p, 4)
      w.set(from + (to - from) * e)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from, to, reduce, w])

  return (
    <motion.div
      initial={reduce ? { opacity: 1 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      <Tag
        className={className}
        style={{
          fontFamily: "var(--font-archivo), system-ui, sans-serif",
          fontWeight: weight,
          fontSize: size,
          lineHeight: leading,
          letterSpacing: "-0.045em",
          ...style,
        }}
      >
        <motion.span className="block" style={{ fontVariationSettings: settings }}>
          {children}
        </motion.span>
      </Tag>
    </motion.div>
  )
}

/**
 * ── MARQUEE ──────────────────────────────────────────────────────────────────────────
 * Two identical halves, travelling exactly one of them, so the loop point lands on a frame
 * identical to the start. The half is padded out first: with four items the half is
 * narrower than a wide screen, the strip runs out, and a gap crosses the viewport before it
 * wraps — which reads as a bug rather than as a loop.
 */
export function Marquee({ items, speed = 34, reverse = false, className = "", separator = "—", style }: {
  items: string[]
  speed?: number
  reverse?: boolean
  className?: string
  separator?: string
  style?: React.CSSProperties
}) {
  const reduce = useReducedMotion()
  const half: string[] = []
  if (items.length) while (half.length < Math.max(8, items.length * 2)) half.push(...items)

  return (
    <div className="relative flex overflow-hidden" style={style}>
      <motion.div
        className={`flex shrink-0 items-center ${className}`}
        animate={reduce ? undefined : { x: reverse ? ["-50%", "0%"] : ["0%", "-50%"] }}
        transition={{ duration: speed, ease: "linear", repeat: Infinity }}
      >
        {[...half, ...half].map((item, i) => (
          <span key={`${item}-${i}`} className="flex shrink-0 items-center whitespace-nowrap">
            {item}
            <span aria-hidden className="mx-[0.5em] opacity-40">{separator}</span>
          </span>
        ))}
      </motion.div>
    </div>
  )
}

/**
 * ── PARALLAX FIGURE ──────────────────────────────────────────────────────────────────
 * The picture travels slower than the page. `overflow-hidden` on the frame and a taller
 * image inside it, so the travel never exposes an edge — the failure everyone ships first.
 *
 * The scroll value owns `y` and NOTHING ELSE owns `y`. An element that takes the same
 * property from both an entrance and a MotionValue simply never appears.
 */
export function ParallaxFigure({ src, alt, ratio = "16 / 9", distance = 60, grade = GRADE, priority = false, sizes = "100vw", className = "", drift = false, children }: {
  src: string
  alt: string
  ratio?: string
  /** px of travel across the whole pass. Keep it small; big parallax reads as a broken layer. */
  distance?: number
  grade?: string
  priority?: boolean
  sizes?: string
  className?: string
  /** A very slow scale breath. It is a SEPARATE element from the one carrying `y`, because a
   *  node that takes the same property from an animation and from a MotionValue loses the
   *  fight and simply never appears. Two owners, two elements. */
  drift?: boolean
  children?: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] })
  const y = useTransform(scrollYProgress, [0, 1], [-distance, distance])
  const smooth = useSpring(y, { stiffness: 90, damping: 30, restDelta: 0.5 })

  return (
    <div ref={ref} className={`relative overflow-hidden ${className}`} style={{ aspectRatio: ratio }}>
      <motion.div className="absolute inset-x-0 -top-[8%] h-[116%]" style={reduce ? undefined : { y: smooth }}>
        <motion.div
          className="relative h-full w-full"
          animate={drift && !reduce ? { scale: [1, 1.055] } : undefined}
          transition={{ duration: 22, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
        >
          <Image
            src={src}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            className="object-cover"
            style={{ filter: grade }}
          />
        </motion.div>
      </motion.div>
      {children}
    </div>
  )
}

/** A picture that does not move. Same grade, same frame discipline. */
export function Figure({ src, alt, ratio = "4 / 5", grade = GRADE, sizes = "50vw", priority = false, className = "", position = "center" }: {
  src: string; alt: string; ratio?: string; grade?: string; sizes?: string
  priority?: boolean; className?: string; position?: string
}) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ aspectRatio: ratio }}>
      <Image src={src} alt={alt} fill sizes={sizes} priority={priority}
        className="object-cover" style={{ filter: grade, objectPosition: position }} />
    </div>
  )
}

/**
 * ── COUNT UP ─────────────────────────────────────────────────────────────────────────
 * Counts once, when it arrives, and then stops. Non-numeric values (a "$0", a "24h") pass
 * straight through — the figure is stored content and an admin can type anything into it,
 * so a component that assumes a number would print NaN on the page the first time one did.
 */
export function CountUp({ value, className = "", style }: {
  value: string; className?: string; style?: React.CSSProperties
}) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -20% 0px" })
  const match = value.match(/^(\D*?)(\d[\d,.]*)(.*)$/)
  const [shown, setShown] = useState(() => (match && !reduce ? 0 : null))

  useEffect(() => {
    if (!match || reduce || !inView) return
    const target = parseFloat(match[2].replace(/,/g, ""))
    if (!Number.isFinite(target)) return
    const start = performance.now()
    const dur = 1100
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const e = 1 - Math.pow(1 - p, 4)
      setShown(target * e)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [inView, match, reduce])

  if (!match) return <span ref={ref} className={className} style={style}>{value}</span>
  const [, pre, num, post] = match
  const decimals = num.includes(".") ? num.split(".")[1].length : 0
  const body = shown === null ? num : shown.toFixed(decimals)
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {pre}{body}{post}
    </span>
  )
}

/** A plain entrance. Direction is a prop because a page where everything rises from below
 *  has one gesture repeated forty times, which is the definition of a preset. */
export function Enter({ children, from = "up", delay = 0, distance = 26, className = "", style }: {
  children: React.ReactNode
  from?: "up" | "down" | "left" | "right" | "none"
  delay?: number
  distance?: number
  className?: string
  style?: React.CSSProperties
}) {
  const reduce = useReducedMotion()
  const off = {
    up: { y: distance, x: 0 }, down: { y: -distance, x: 0 },
    left: { x: -distance, y: 0 }, right: { x: distance, y: 0 }, none: { x: 0, y: 0 },
  }[from]
  return (
    <motion.div
      className={className}
      style={style}
      initial={reduce ? { opacity: 0 } : { opacity: 0, ...off }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/**
 * ── STICKY TRACK ─────────────────────────────────────────────────────────────────────
 * A tall column with a sticky viewport inside it, so a picture holds still while its
 * captions scroll past. This is storytelling, NOT a scrub: the page never pins the scroll
 * and never takes the wheel. You can leave at any moment, which is the difference between a
 * section that tells you something and one that holds you hostage.
 *
 * Returns the progress value so the caller can drive whatever it likes from it.
 */
export function useTrackProgress(ref: React.RefObject<HTMLElement | null>): MotionValue<number> {
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] })
  return useSpring(scrollYProgress, { stiffness: 110, damping: 30, restDelta: 0.001 })
}

/** Full-bleed escape from a centred container, without a horizontal scrollbar. */
export const BLEED = "relative left-1/2 right-1/2 -mx-[50vw] w-screen max-w-[100vw]"
