"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "@phosphor-icons/react"

/**
 * CLICK AN IMAGE, SEE IT BIG. One of these, not six.
 *
 * Six surfaces had grown their own: payout-dialog, digitizer-studio, designer-board,
 * listing-photo-studio each with a hand-rolled `cursor-zoom-out` overlay, spydeck-view and
 * purchase-view with a Dialog. Nine `cursor-zoom-*` sites, no two agreeing on whether Escape
 * closes, whether the backdrop closes, or whether the picture is capped — which is the state
 * CLAUDE.md §4 describes: a rule with nothing to import regresses at the speed new files are
 * created.
 *
 * A LIGHTBOX IS NOT A DIALOG. It has no header, no actions and nothing to fill in — it is the
 * picture, bigger, and every way out closes it: the backdrop, Escape, the corner. Wrapping it
 * in the app's Dialog gives it a card, a border and a focus trap around a thing you look at.
 *
 * PORTALLED TO THE BODY, above everything. These open from inside dialogs (the digitizer's
 * modal) and from inside the lookbook's own z-50 print overlay, so anything relying on its
 * parent's stacking context ends up behind the thing that opened it.
 */
export function ImageLightbox({ src, label, onClose }: {
  src: string | null
  label?: string | null
  onClose: () => void
}) {
  const tl = useLabelT()
  const [host, setHost] = useState<HTMLElement | null>(null)
  // The body only exists after mount, and never on the server.
  useEffect(() => { const t = setTimeout(() => setHost(document.body), 0); return () => clearTimeout(t) }, [])

  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [src, onClose])

  if (!src || !host) return null

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={label || tl("imageLightbox", "Image")}
      onClick={onClose}
      // z-[80]: above the lookbook's print overlay (z-50) and the app's dialogs (z-50), both
      // of which can be what you opened this from.
      className="fixed inset-0 z-[80] flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-black/80 p-6 print:hidden"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src} alt={label || ""}
        // Bounded by BOTH axes. A portrait design capped only by width runs off the top and
        // bottom of the viewport, which is the one thing a "see it bigger" cannot do.
        className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      {label && <span className="max-w-full truncate text-sm text-white/80">{label}</span>}
      <button
        type="button" onClick={onClose} aria-label={tl("imageLightbox", "Close")}
        className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X size={16} weight="bold" />
      </button>
    </div>,
    host,
  )
}

/**
 * The lightbox plus the one bit of state every caller was writing by hand.
 *
 * `open(src, label)` from a click; render `node` once anywhere in the surface. Ignores an
 * empty src, so a caller can wire it to a thumbnail that may not have loaded a picture
 * without guarding at every call site.
 */
export function useLightbox() {
  const [shot, setShot] = useState<{ src: string; label?: string } | null>(null)
  const open = useCallback((src?: string | null, label?: string | null) => {
    if (src) setShot({ src, label: label ?? undefined })
  }, [])
  const close = useCallback(() => setShot(null), [])
  const node: ReactNode = <ImageLightbox src={shot?.src ?? null} label={shot?.label} onClose={close} />
  return { open, close, node }
}
