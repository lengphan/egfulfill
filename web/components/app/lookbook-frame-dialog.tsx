"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Thumb } from "@/components/app/thumb"
import { framingStyle, FOCUS_MIN, FOCUS_MAX, ZOOM_MIN, ZOOM_MAX } from "@/lib/product-framing"

export type ColorFix = { zoom?: number; focusY?: number; image?: string }

/**
 * FIX ONE COLOURWAY'S PICTURE.
 *
 * A supplier's swatch range is not shot to one standard: on the same style, half the colours
 * arrive as a photograph of the garment and half as a flat crop of the fabric, sitting side by
 * side in a grid whose entire job is "which colour do you want". Nothing upstream fixes that,
 * so the page needs a way to say it here — scale the picture up, nudge it into frame, or
 * replace it outright.
 *
 * THE SAME TWO NUMBERS THE PRODUCT EDITOR USES, from lib/product-framing. Not a second framing
 * model: `framingStyle` already encodes what a zoom and a vertical nudge mean, including the
 * hard-won part — that panning is a translate and never touches the zoom (a slider that grows
 * the picture while you drag it up is two things under one control, and the one you asked for
 * is the one that stops working).
 *
 * The preview is the SWATCH, at swatch proportions, framed by the same function the sheet
 * frames it with. A preview that is not the thing cannot show what you are deciding.
 */
export function LookbookFrameDialog({
  open, onOpenChange, colorName, styleName, source, fix, onSave, busy, maxImageMB = 8,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  colorName: string
  styleName: string
  /** The colourway's own photo, before any replacement. */
  source: string
  fix: ColorFix | undefined
  /** The next value for THIS colour — undefined removes it from the map (back to default). */
  onSave: (next: ColorFix | undefined) => void
  busy?: boolean
  maxImageMB?: number
}) {
  const tl = useLabelT()
  const [zoom, setZoom] = useState(100)
  const [focusY, setFocusY] = useState(50)
  const [image, setImage] = useState<string | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  // Seeded on OPEN only — this is a draft of the framing and must not be rewritten under
  // someone mid-drag by a re-render of the row it came from.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      setZoom(fix?.zoom ?? 100)
      setFocusY(fix?.focusY ?? 50)
      setImage(fix?.image)
      setErr(null)
    }, 0)
    return () => clearTimeout(id)
  }, [open, fix])

  const shown = image || source
  const touched = zoom !== 100 || focusY !== 50 || !!image

  const takeFile = async (f: File | null) => {
    if (!f) return
    if (!/^image\//.test(f.type)) { setErr("That isn't an image file."); return }
    if (f.size > maxImageMB * 1024 * 1024) {
      setErr(`That photo is ${(f.size / 1024 / 1024).toFixed(1)}MB — ${maxImageMB}MB is the limit for a catalogue image.`)
      return
    }
    setErr(null)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(new Error("Couldn't read that file."))
      fr.readAsDataURL(f)
    }).catch((e: Error) => { setErr(e.message); return "" })
    if (dataUrl) setImage(dataUrl)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="text-sm leading-snug">{colorName} — {styleName}</DialogTitle></DialogHeader>

        <div className="space-y-3">
          {/* The swatch's own well: same square, same warm plate, same object-contain. */}
          <div className="relative mx-auto aspect-square w-48 overflow-hidden rounded-lg bg-neutral-100">
            {/* framingStyle goes on a WRAPPER, not the img: Thumb owns the img's className,
                and a transform passed through there would be a second author of it. ONE
                image inside it — an unframed copy underneath would show through wherever the
                framed one did not cover, which is a preview of two pictures at once. */}
            <div className="absolute inset-0" style={framingStyle({ imgZoom: zoom, imgFocusY: focusY })}>
              <Thumb src={shown} alt="" fit="contain" className="size-full bg-transparent p-1" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 eg-label text-muted-foreground">{tl("lookbookFrame", "Zoom")}</span>
              <input
                type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={5} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="h-1 flex-1 accent-primary" aria-label={`${colorName} zoom`}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 eg-label text-muted-foreground">{tl("lookbookFrame", "Up/dn")}</span>
              <input
                type="range" min={FOCUS_MIN} max={FOCUS_MAX} step={1} value={focusY}
                onChange={(e) => setFocusY(Number(e.target.value))}
                className="h-1 flex-1 accent-primary" aria-label={`${colorName} vertical position`}
              />
            </label>
          </div>

          {err && <p className="text-xs text-destructive">{err}</p>}

          <div className="flex items-center gap-2">
            <input
              ref={fileInput} type="file" accept="image/*" className="hidden"
              onChange={(e) => { void takeFile(e.target.files?.[0] ?? null); e.target.value = "" }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
              {image ? tl("lookbookFrame", "Replace again") : tl("lookbookFrame", "Replace photo")}
            </Button>
            {touched && (
              <button
                type="button"
                onClick={() => { setZoom(100); setFocusY(50); setImage(undefined) }}
                className="text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {tl("lookbookFrame", "Reset")}
              </button>
            )}
            <Button
              size="sm" className="ml-auto" disabled={busy}
              onClick={() => {
                // Untouched saves as UNDEFINED, which takes the key out of the map entirely —
                // so a reset leaves no entry behind and the column cannot fill with defaults.
                onSave(touched ? { ...(zoom !== 100 && { zoom }), ...(focusY !== 50 && { focusY }), ...(image && { image }) } : undefined)
                onOpenChange(false)
              }}
            >
              {tl("lookbookFrame", "Done")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
