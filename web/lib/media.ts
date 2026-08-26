/**
 * WHAT KIND OF MEDIA A URL POINTS AT.
 *
 * ONE SPELLING, because the answer is needed in three places that must agree: the marketing
 * hero that renders it (`MediaHero`), the Settings panel that previews it before save, and
 * the file picker that decides what it will accept. Three private copies of a regex is how
 * an admin comes to upload an `.mov` the panel previews happily and the page renders as a
 * broken image — each surface was right on its own and they disagreed with each other.
 *
 * EXTENSION, NOT MIME. By the time a stored URL is rendered there is no Content-Type to
 * inspect without fetching it, and the only thing on hand is the string. Our own uploads are
 * named by the server from a mime it already validated (`site_content.js`, VID_TYPES), so for
 * anything we wrote the extension IS the checked mime. A hand-pasted third-party URL is the
 * loose case, and it degrades the honest way: a video that doesn't end in one of these
 * renders as an image and visibly fails, rather than silently rendering nothing.
 *
 * The query string is stripped first — a signed or cache-busted URL ends in `?v=2`, not in
 * `.mp4`, and matching the raw string calls it an image.
 */
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i

export function isVideoSrc(url: string | undefined | null): boolean {
  if (!url) return false
  // A data: URL carries its type up front and has no extension at all.
  if (url.startsWith("data:")) return url.startsWith("data:video/")
  const clean = url.split(/[?#]/)[0]
  return VIDEO_EXT.test(clean)
}

/** What a file input should accept where BOTH are allowed. Images only is the default
 *  everywhere else — only the hero renders motion. */
export const MEDIA_ACCEPT = "image/*,video/mp4,video/webm,video/quicktime"
