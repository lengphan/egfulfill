/**
 * Preparing a dropped or picked file for a chat message — ONE copy, for every chat.
 *
 * It lived inside the chat page while the order thread had no attachments at all. The
 * moment the order thread gained them this was the thing that would have been pasted into
 * a second file, and a second copy of "how big is too big, and what do we re-encode" is how
 * two chats in the same product start disagreeing about what they accept. CLAUDE.md §5
 * records three files that already grew private copies of shared logic.
 */

/** The ceiling the composer enforces before anything is read — the server's own limit is
 *  higher, but a 40MB video read into a data URL locks the tab up long before it refuses. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * DOWNSIZE IMAGES IN THE BROWSER FIRST — longest edge capped, re-encoded JPEG — so a phone
 * photo doesn't eat storage or hit the proxy body limit. Non-images (PDF) pass through
 * untouched: re-encoding a document is either lossy or pointless.
 *
 * Every failure path returns the ORIGINAL rather than throwing. A picture that cannot be
 * decoded for resizing is still a picture worth sending, and losing the attachment to an
 * optimisation is a worse outcome than sending it at full size.
 */
export async function fileToUploadUrl(file: File, maxEdge = 1800, quality = 0.82): Promise<string> {
  const original = await new Promise<string>((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(new Error("Couldn't read the file"))
    fr.readAsDataURL(file)
  })
  if (!file.type.startsWith("image/")) return original
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = original
    })
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    // Already small enough AND already light — re-encoding would only cost quality.
    if (scale === 1 && file.size < 500_000) return original
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext("2d"); if (!ctx) return original
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL("image/jpeg", quality)
  } catch { return original }
}

/** The first file off a drop, or undefined. Kept here so every chat agrees that a drop of
 *  several files attaches ONE — the composer holds a single attachment, and silently
 *  dropping the rest is better done in one place than discovered per screen. */
export const firstDroppedFile = (dt: DataTransfer | null) => dt?.files?.[0]
