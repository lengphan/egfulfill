/**
 * MOTION, IN ONE PLACE.
 *
 * The app shipped with none of it — not a count, not a press, not a transition — which is
 * what "it doesn't feel smooth" turned out to literally mean. What it needs is small and
 * repeatable, so it lives here rather than being re-typed per screen: two screens already
 * wanted the same counting figure, and a second copy is how a house style stops being one.
 *
 * EVERY HOOK HERE HAS TO HONOUR REDUCED MOTION, and honour it by DOING NOTHING rather than
 * by doing something slower. The setting asks for no movement; a gentler animation is still
 * an animation, and the people who turn it on are not asking for a tasteful version.
 */
import { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated } from "react-native"

/** The device setting, live — it can be changed while the app is open. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduced(!!v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduced(!!v))
    return () => { alive = false; sub?.remove?.() }
  }, [])
  return reduced
}

/**
 * A FIGURE THAT ARRIVES.
 *
 * A number that counts up says it was fetched rather than always sat there, and it puts the
 * eye on the one thing worth reading. Ease-out rather than linear: a linear count reads like
 * a slot machine instead of a value settling.
 *
 * Counts from the PREVIOUS value, not from zero, on anything but the first run — a balance
 * going 120 -> 130 should tick up ten, not fall to nothing and climb back.
 */
export function useCountUp(to: number, reduced: boolean, ms = 650) {
  const [n, setN] = useState(reduced ? to : 0)
  const from = useRef(0)
  useEffect(() => {
    if (reduced) { setN(to); from.current = to; return }
    const start = from.current, t0 = Date.now()
    let raf = 0
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / ms)
      setN(start + (to - start) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, reduced, ms])
  return n
}

/**
 * A PRESS THAT GIVES.
 *
 * Returns the scale value and the two handlers. 0.96 is enough to feel and not enough to
 * look like the tile is being swallowed; the spring is what stops it reading as a flicker.
 */
export function usePressScale(reduced: boolean, to = 0.96) {
  const scale = useRef(new Animated.Value(1)).current
  const spring = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start()
  return {
    scale,
    onPressIn: () => { if (!reduced) spring(to) },
    onPressOut: () => { if (!reduced) spring(1) },
  }
}
