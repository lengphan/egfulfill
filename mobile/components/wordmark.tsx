import Svg, { Path } from "react-native-svg"
import {
  WORDMARK_VIEWBOX, WORDMARK_ASPECT, WORDMARK_PATH, MARK_E_VIEWBOX, MARK_E_PATH,
} from "@shared/wordmark-art"

/**
 * THE WORDMARK, ON THE PHONE.
 *
 * The app had no mark at all. Its sign-in screen set the word EGFUL in Inter Bold — so the
 * one place a person meets the brand carried no brand, just the product name typed out in
 * the body face, while the web has had a drawn wordmark on its header, its sidebar, its auth
 * pages and its favicon. That is not a small omission on a screen whose whole job is to say
 * whose app this is.
 *
 * THE OUTLINES COME FROM shared/wordmark-art.ts, which the web imports too. What differs
 * between the platforms is only the renderer: web uses `currentColor` and Tailwind classes,
 * React Native has neither, so the colour is an explicit prop here. The SHAPE cannot differ.
 *
 * SIZED BY HEIGHT. The aspect is 2.28:1 and it is honoured from the shared constant rather
 * than restated, so a caller that sets only a height can never squeeze the letterforms — the
 * failure a width-sized logo has on a narrow phone.
 */
export function Wordmark({ height = 26, color }: { height?: number; color: string }) {
  return (
    <Svg width={height * WORDMARK_ASPECT} height={height} viewBox={WORDMARK_VIEWBOX}>
      <Path fill={color} fillRule="evenodd" clipRule="evenodd" d={WORDMARK_PATH} />
    </Svg>
  )
}

/**
 * THE SINGLE-GLYPH MARK — the `e`, for a square.
 *
 * Used on the launch screen, where the mark sits alone in the middle of the page and a
 * 2.28:1 wordmark would either be tiny or run edge to edge. See the note beside MARK_E_PATH
 * for why this is the e's own outline rather than the wordmark cropped.
 */
export function MarkE({ size = 44, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox={MARK_E_VIEWBOX}>
      <Path fill={color} fillRule="evenodd" clipRule="evenodd" d={MARK_E_PATH} />
    </Svg>
  )
}
