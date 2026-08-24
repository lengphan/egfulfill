"use client"

/**
 * PREPARING AN IMAGE FOR UPLOAD — one implementation, two callers.
 *
 * This lived inside components/app/site-content-panel.tsx, which was fine while the Settings
 * form was the only way to put a picture on the marketing site. It no longer is: the inline
 * editor uploads from the page itself, and a second copy of this would be a second chance to
 * get the alpha rule wrong — which is the one thing here that must never be re-derived.
 */

/**
 * Downscale + re-encode an image in the browser BEFORE upload.
 *
 * A phone/DSLR photo is 4–12MB; base64-encoded it blows past Vercel's ~4.5MB proxy body
 * limit, so the upload silently failed on anything but tiny images — which is why "the file
 * is limited". Capping the longest edge and re-encoding keeps the payload small AND stops the
 * homepage shipping a 12MB background. Returns a data URL. Falls back to the original bytes if
 * the canvas isn't available.
 *
 * ── JPEG WOULD HAVE SILENTLY DESTROYED EVERY CUT-OUT ──────────────────────────────────────
 *
 * This re-encoded unconditionally to image/jpeg. JPEG has no alpha channel, so a PNG with a
 * transparent background came back with that transparency flattened — and canvas flattens to
 * BLACK, so a garment cut out of its backdrop would have arrived on the homepage in a black
 * rectangle. There was a guard, `scale === 1 && size < 1.2MB → send as-is`, which is exactly
 * the case that never applies: a 2K render is over both.
 *
 * That is the whole hero figure feature failing as a success, which is the same failure mode
 * as asking the image model for transparency. So the OUTPUT TYPE FOLLOWS THE INPUT: anything
 * that can carry alpha keeps it, everything else still becomes a small JPEG.
 *
 * PNG compresses far worse than JPEG, so its edge cap is lower. A hero figure renders at most
 * 26rem tall — 1600px is already more than twice what any screen asks for, and the ceiling
 * that matters is the ~4.5MB proxy body limit with base64's 33% inflation on top.
 */
export const ALPHA_TYPES = new Set(["image/png", "image/webp", "image/avif"])

/**
 * The same rule for something that is ALREADY a data URL.
 *
 * A generated render arrives as a URL and a browser cut-out comes back as a PNG data URL, and
 * neither is a `File` — so the inline editor was uploading the cut-out at full size. That is
 * how a 4K render meets `MAX_IMG_BYTES` on the upload route (8MB) and the whole generate flow
 * ends in "Image is over 8MB — resize it first": the model was asked for the largest picture
 * it makes, and nothing between there and the server made it smaller.
 *
 * Delegates to the one implementation, so the alpha rule above is not re-derived here — the
 * type comes off the data URL's own prefix, which is what decides whether transparency
 * survives.
 */
export async function downscaleDataUrl(dataUrl: string, maxEdge = 2400, quality = 0.85): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl
  const mime = (dataUrl.slice(5).split(";")[0] || "image/png").toLowerCase()
  // A File wants bytes, and `size` is read by the "already small" shortcut — base64 is 4/3 of
  // the real length, so the payload is estimated rather than decoded twice.
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1)
  const bytes = Math.round((b64.length * 3) / 4)
  return downscaleFrom({ type: mime, size: bytes, read: async () => dataUrl }, maxEdge, quality)
}

export async function downscaleImage(file: File, maxEdge = 2400, quality = 0.85): Promise<string> {
  return downscaleFrom({
    type: file.type,
    size: file.size,
    read: () => new Promise<string>((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(String(fr.result))
      fr.onerror = () => rej(new Error("Couldn't read the file"))
      fr.readAsDataURL(file)
    }),
  }, maxEdge, quality)
}

/** One image, one rule. `read()` supplies the original as a data URL however it was held. */
async function downscaleFrom(
  file: { type: string; size: number; read: () => Promise<string> },
  maxEdge: number,
  quality: number,
): Promise<string> {
  const keepAlpha = ALPHA_TYPES.has(file.type)
  // PNG is the only alpha format canvas can be relied on to WRITE — toDataURL falls back to
  // PNG for an unsupported type anyway, so asking for it explicitly is the honest version.
  const outType = keepAlpha ? "image/png" : "image/jpeg"
  if (keepAlpha) maxEdge = Math.min(maxEdge, 1600)
 const original = await file.read()
 try {
 const img = await new Promise<HTMLImageElement>((res, rej) => {
 const i = new Image()
 i.onload = () => res(i)
 i.onerror = () => rej(new Error("decode failed"))
 i.src = original
    })
 const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    // Already small in both bytes and dimensions — send the original bytes untouched.
 if (scale === 1 && file.size < 1_200_000) return original
 const w = Math.max(1, Math.round(img.width * scale))
 const h = Math.max(1, Math.round(img.height * scale))
 const canvas = document.createElement("canvas")
 canvas.width = w; canvas.height = h
 const ctx = canvas.getContext("2d")
 if (!ctx) return original
 ctx.drawImage(img, 0, 0, w, h)
    // The quality argument is ignored for PNG, which is lossless — passing it is harmless and
    // keeps this one call site rather than two.
 return canvas.toDataURL(outType, quality)
  } catch {
 return original
  }
}
