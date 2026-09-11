/**
 * THE MOMENT ICONS — one stroke, periwinkle→lime, drawn in.
 *
 * Four marks: `done`, `working`, `sent`, `empty`. Each is a single rounded stroke on a ring
 * whose tail fades out, and each draws itself the first time it appears.
 *
 * THE RULE THEY REPLACE. An empty region needs a MARK (CLAUDE.md §4, THE FOUR PARTS) and the
 * mark is the single biggest difference between a region that reads as a place and one that
 * reads as a gap. The old kit solved that with a glyph on a filled tile, which works and is
 * anonymous. This is the same job done in the brand's own hand.
 *
 * ONCE PER SCREEN, AND NEVER IN A LIST ROW. It is a moment — a success, a wait, a shipment,
 * an absence. Twenty of them down a queue is a pattern, not a moment, and the drawing
 * animation would fire twenty times on every scroll.
 *
 * REDUCED MOTION DRAWS IT ALREADY COMPLETE. No stroke animation, no spin — the mark is the
 * information and the drawing is the flourish.
 */
import { useEffect, useRef } from "react"
import { Animated, Easing } from "react-native"
import Svg, { Path, Defs, LinearGradient, Stop } from "react-native-svg"
import { hue, lime, MOMENT_RAMP } from "@/lib/theme"
import { useReducedMotion } from "@/lib/motion"

const APath = Animated.createAnimatedComponent(Path)

export type Moment = "done" | "working" | "sent" | "empty"

/** The ring and the mark for each moment. The ring is the arc that fades; the mark is the
 *  thing you actually read. `working` is the exception — it has no mark, it spins. */
const ART: Record<Moment, { ring: string; mark?: string }> = {
  done: { ring: "M96 42 A42 42 0 1 0 100 62", mark: "M44 62 l14 14 32 -34" },
  sent: { ring: "M26 78 A40 40 0 1 1 94 78", mark: "M60 92 V38 M42 56 l18 -18 18 18" },
  empty: { ring: "M100 62 A40 40 0 1 1 60 20", mark: "M60 42 V78 M42 60 H78" },
  working: { ring: "M100 60 A40 40 0 1 1 60 20" },
}

/** Long enough to cover the longest path in the set, so one value dashes them all. */
const DASH = 1000

export function MomentIcon({ kind, size = 120 }: { kind: Moment; size?: number }) {
  const reduced = useReducedMotion()
  /* The stroke offsets. `dash` is what makes a path draw: the dash array is the whole length
     of the path, so an offset of DASH hides it entirely and 0 reveals all of it. */
  const ring = useRef(new Animated.Value(reduced ? 0 : DASH)).current
  const mark = useRef(new Animated.Value(reduced ? 0 : DASH)).current
  const spin = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (reduced) { ring.setValue(0); mark.setValue(0); spin.setValue(0); return }
    ring.setValue(DASH); mark.setValue(DASH)
    /* NOT the native driver. `strokeDashoffset` is an SVG attribute rather than a transform
       or an opacity, so it cannot be driven on the UI thread — react-native-svg would warn
       and then simply not animate. This is one 1.1s tween on mount, not a loop, so the JS
       cost is paid once and never again. */
    const draw = Animated.parallel([
      Animated.timing(ring, { toValue: 0, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(mark, { toValue: 0, duration: 900, delay: 350, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ])
    draw.start()
    /* The spinner is a TRANSFORM, so this one does run natively and costs nothing to loop. */
    const loop = kind === "working"
      ? Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }))
      : null
    loop?.start()
    return () => { draw.stop(); loop?.stop() }
  }, [kind, reduced, ring, mark, spin])

  const art = ART[kind]
  const stroke = {
    fill: "none" as const,
    strokeWidth: 9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeDasharray: `${DASH}`,
  }
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] })

  const body = (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Defs>
        {/* THE MARK's gradient — the full periwinkle→lime run. */}
        <LinearGradient id="mi-mark" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={hue.base} />
          <Stop offset="0.55" stopColor={MOMENT_RAMP.mid} />
          <Stop offset="1" stopColor={lime.base} />
        </LinearGradient>
        {/* THE RING's, which starts at zero opacity so the arc has no visible beginning —
            that fade is what stops the ring reading as an unfinished circle. */}
        <LinearGradient id="mi-ring" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={hue.base} stopOpacity="0" />
          <Stop offset="0.45" stopColor={MOMENT_RAMP.ring} stopOpacity="0.9" />
          <Stop offset="1" stopColor={lime.base} />
        </LinearGradient>
      </Defs>

      {kind === "working" ? (
        <>
          <Path {...stroke} strokeDasharray={undefined} stroke="url(#mi-ring)" d={art.ring} />
          {/* The dotted lead — a second, lighter pass that makes the spin readable at a
              glance instead of looking like a static arc. */}
          <Path {...stroke} strokeWidth={7} strokeDasharray="1 16" stroke={lime.base} d="M60 20 A40 40 0 0 1 100 60" />
        </>
      ) : (
        <>
          <APath {...stroke} stroke="url(#mi-ring)" d={art.ring} strokeDashoffset={ring as never} />
          {art.mark ? (
            <APath {...stroke} stroke="url(#mi-mark)" d={art.mark} strokeDashoffset={mark as never} />
          ) : null}
        </>
      )}
    </Svg>
  )

  /* THE SPIN ROTATES THE WHOLE SVG rather than a <G> inside it. Same picture — the arc is
     centred — and it is a view transform, so it runs on the UI thread. An animated <G> would
     have to be driven from JS and react-native-svg's typings do not accept one anyway. */
  return kind === "working"
    ? <Animated.View style={{ width: size, height: size, transform: [{ rotate }] }}>{body}</Animated.View>
    : body
}
