import { View, Text } from "react-native"
import Svg, { Rect } from "react-native-svg"
import { F,C, R } from "@/lib/theme"

/**
 * CODE 128-B, drawn natively.
 *
 * The web renders barcodes with JsBarcode, which is a DOM library — it writes into an
 * <svg> element and there is no such thing here. Rather than add a dependency, the
 * encoding is 40 lines and the drawing is react-native-svg, which the app already ships.
 *
 * Why it earns its place on a phone at all: the floor's scanners read a screen perfectly
 * well, so the handset in someone's hand becomes the work ticket for the order they are
 * holding — no ticket to print, and nothing to mis-file. The value is the ORDER NUMBER as
 * a person would read it, so a scan and a spoken number can never disagree.
 *
 * VECTOR, not a bitmap: the bar RATIOS are what a scanner reads, and uniform scaling is
 * the only kind that preserves them. That is the same reason the web version copies its
 * natural size into a viewBox instead of letting CSS stretch the element.
 */

/** The 107 Code-128 symbols as bar/space module widths. Index = the symbol's value. */
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
]
const START_B = 104
const STOP = 106

/** Widths of every bar and space, left to right, starting with a bar. Empty when the value
 *  carries a character Code 128-B cannot express — a barcode that silently drops a
 *  character scans as a DIFFERENT id, which is worse than no barcode. */
function encode(value: string): number[] {
  const codes: number[] = []
  for (const ch of value) {
    const v = ch.charCodeAt(0) - 32
    if (v < 0 || v > 94) return []
    codes.push(v)
  }
  if (!codes.length) return []
  // Checksum is position-weighted from 1, over the start code plus the data.
  let sum = START_B
  codes.forEach((c, i) => { sum += c * (i + 1) })
  const symbols = [START_B, ...codes, sum % 103, STOP]
  return symbols.flatMap((sym) => PATTERNS[sym].split("").map(Number))
}

export function Barcode({ value, height = 64, module = 2, showValue = true, dark = false }: {
  value: string
  height?: number
  /** Width of one module in px. Below ~1.6 a phone screen's own pixels start eating the
   *  narrow bars and a scanner misreads; 2 is comfortable for a 10-digit order number. */
  module?: number
  showValue?: boolean
  dark?: boolean
}) {
  const widths = encode(value)
  const ink = dark ? C.onInk : C.ink

  if (!widths.length) {
    // SAY WHICH. A blank space where a barcode should be is indistinguishable from one that
    // failed to render, and someone would stand there scanning nothing.
    return (
      <Text style={{ fontSize: 13, color: C.muted }}>
        This number can’t be made into a barcode.
      </Text>
    )
  }

  const total = widths.reduce((a, b) => a + b, 0) * module
  let x = 0
  const bars = widths.map((w, i) => {
    const at = x
    x += w * module
    return i % 2 === 0 ? <Rect key={i} x={at} y={0} width={w * module} height={height} fill={ink} /> : null
  })

  return (
    <View style={{ alignItems: "center" }}>
      {/* The quiet zone is part of the symbol, not padding — a scanner needs the clear
          margin to find the start. White under the bars for the same reason: the warm page
          colour costs contrast a cheap scanner does not have to spare. */}
      <View style={{ backgroundColor: "#ffffff", borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 10 }}>
        <Svg width={total} height={height}>{bars}</Svg>
      </View>
      {showValue && (
        <Text style={{
          marginTop: 8, fontSize: 13, letterSpacing: 3, fontFamily: F.semi,
          color: dark ? C.onInk : C.muted,
        }}>
          {value}
        </Text>
      )}
    </View>
  )
}
