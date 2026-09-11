/**
 * THE AURA — the drifting wash that marks a MOMENT.
 *
 * Three soft blobs of low-saturation colour that move very slowly behind content. It is the
 * one decorative element in this app and it is rationed: a welcome, a hero card, an empty
 * state, a success. Lists and forms stay on the plain page. A wash behind a 700-row queue is
 * a sheet you read *through* all day, which is the same mistake as a tinted canvas.
 *
 * NOT SKIA, and that is a deployment decision rather than a visual one. The kit this came
 * from drew it with `@shopify/react-native-skia` and a real gaussian blur. Skia is a NATIVE
 * module: adding it means a new EAS binary, which means this entire redesign could not reach
 * a phone over OTA. `react-native-svg` is already in the app, and a radial gradient that
 * fades to transparent IS the blur — there is no hard edge anywhere in the result to give it
 * away. Three gradients cost nothing next to a 195MB native dependency.
 *
 * THE DRIFT IS NATIVE-DRIVEN. Each blob is an `Animated.View` moved by `translate`, so the
 * animation runs on the UI thread and never touches JS per frame. Animating the circle's own
 * `cx`/`cy` would be a JS-driven property and would tie an 18-second tween to the JS
 * thread — on the queue screen that is a frame budget spent on decoration.
 *
 * REDUCED MOTION STOPS IT COMPLETELY. Not slower — still. The wash is still drawn, because
 * the colour is the point and the movement is the flourish.
 */
import { useEffect, useRef } from "react"
import { Animated, Easing, StyleSheet, View, useWindowDimensions, ViewStyle, StyleProp } from "react-native"
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg"
import { C } from "@/lib/theme"
import { useReducedMotion } from "@/lib/motion"

/** One blob: a radial gradient from its colour to fully transparent. */
function Blob({ color, size, x, y, drift, delay, reduced }: {
  color: string; size: number; x: number; y: number
  /** How far it wanders, in points. 0 with reduced motion. */
  drift: number; delay: number; reduced: boolean
}) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reduced || !drift) { t.setValue(0.5); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 11000, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 11000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [t, drift, delay, reduced])

  const range = (a: number, b: number) => t.interpolate({ inputRange: [0, 1], outputRange: [a, b] })

  return (
    <Animated.View
      style={{
        pointerEvents: "none",
        position: "absolute",
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        transform: [{ translateX: range(-drift, drift) }, { translateY: range(drift, -drift) }],
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          {/* The id must be unique per blob or every gradient in the tree resolves to the
              first one — SVG ids are global to the document, and three blobs sharing "g"
              is why a wash like this comes out one flat colour. */}
          <RadialGradient id={`a${color.replace("#", "")}${Math.round(x)}${Math.round(y)}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity="0.85" />
            <Stop offset="0.55" stopColor={color} stopOpacity="0.38" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="50" cy="50" r="50" fill={`url(#a${color.replace("#", "")}${Math.round(x)}${Math.round(y)})`} />
      </Svg>
    </Animated.View>
  )
}

export function Aura({ height, palette, intensity = 1, style }: {
  /** Defaults to the full window. Pass a height to sit inside a card. */
  height?: number
  /** Override the three wash colours. Only `C.aura*` values belong here — these are the only
   *  colours in the palette allowed to sit UNDER content. */
  palette?: [string, string, string]
  /** 0–1. Dials the whole wash down where content has to stay readable on top of it. */
  intensity?: number
  style?: StyleProp<ViewStyle>
}) {
  const { width, height: winH } = useWindowDimensions()
  const reduced = useReducedMotion()
  const H = height ?? winH
  const [a, b, c] = palette ?? [C.auraPeri, C.auraLime, C.auraSky]
  /* Sized off the larger dimension so a short, wide card still reads as three overlapping
     blobs rather than one flat field — at 0.9 of the HEIGHT alone a 168pt card gets discs
     small enough to look like spots. */
  const r = Math.max(width, H) * 0.9

  return (
    <View
      style={[StyleSheet.absoluteFill, { pointerEvents: "none", height: H, overflow: "hidden", opacity: intensity }, style]}
    >
      <Blob color={a} size={r} x={width * 0.22} y={H * 0.24} drift={22} delay={0} reduced={reduced} />
      <Blob color={b} size={r * 0.95} x={width * 0.86} y={H * 0.44} drift={26} delay={1800} reduced={reduced} />
      <Blob color={c} size={r * 0.8} x={width * 0.52} y={H * 0.82} drift={18} delay={3400} reduced={reduced} />
    </View>
  )
}
