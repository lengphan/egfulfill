/**
 * Perceptual hash (dHash) of an image, as 16 hex chars = 64 bits.
 *
 * Computed in the browser because it needs the image decoded to pixels and the API has no
 * image library. That also means it is UNTRUSTED: the server treats it as a hint for
 * "these two look alike", never as proof, and pairs it with its own sha256 for anything
 * that actually decides reuse.
 *
 * dHash rather than aHash: it compares each pixel to its right-hand neighbour, so it keys
 * on structure (edges, layout) instead of overall brightness. That survives the things
 * that genuinely happen to artwork — a re-export, a resize, a recompress, a slight
 * exposure shift — while still separating two different designs.
 */

const W = 9  // 9 wide × 8 tall → 8 comparisons per row → 64 bits
const H = 8

export async function perceptualHash(src: string): Promise<string | null> {
  if (!src || typeof document === "undefined") return null
  try {
    const img = await loadImage(src)
    const canvas = document.createElement("canvas")
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return null
    // White backdrop first: transparent artwork would otherwise sample as black and two
    // unrelated transparent PNGs would hash alike.
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, W, H)
    ctx.drawImage(img, 0, 0, W, H)
    const { data } = ctx.getImageData(0, 0, W, H)

    // Luminance, then compare each pixel to the one on its right.
    const grey: number[] = []
    for (let i = 0; i < data.length; i += 4) {
      grey.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    }
    let bits = ""
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W - 1; x++) {
        bits += grey[y * W + x] > grey[y * W + x + 1] ? "1" : "0"
      }
    }
    // 64 bits → 16 hex chars, in nibbles so the string is stable across engines.
    let hex = ""
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
    return hex
  } catch {
    return null
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Needed for remote artwork, or getImageData throws on a tainted canvas. Data URLs
    // (the common case here) are unaffected either way.
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
