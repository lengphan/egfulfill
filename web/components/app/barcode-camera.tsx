"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, X, Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"

/** The browser's native barcode reader. Not in the DOM types yet, so declared narrowly —
 *  only what's used, so a wrong guess about the rest can't compile. */
type DetectedBarcode = { rawValue: string }
type BarcodeDetectorLike = { detect: (s: CanvasImageSource) => Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}
const getCtor = (): BarcodeDetectorCtor | null =>
  (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null

/**
 * Read a carton barcode with the device camera.
 *
 * Uses the browser's built-in BarcodeDetector rather than a scanning library: no
 * dependency to install, nothing loaded from a CDN (which the CSP would block anyway),
 * and it's hardware-accelerated. It isn't in every browser, so an unsupported one says so
 * and leaves typing available — a scanner that silently does nothing is worse than none.
 *
 * The camera is released on every exit path — unmount, close, successful scan. A receiving
 * bench tablet left with the torch-adjacent camera stream open is both a battery and a
 * trust problem.
 */
export function BarcodeCamera({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stopped = useRef(false)
  const [err, setErr] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  /** Release the camera. Safe to call repeatedly — every exit path calls it. */
  const stop = useCallback(() => {
    stopped.current = true
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    const Ctor = getCtor()
    if (!Ctor) {
      // Deferred, like every other setState in an effect here — a synchronous one
      // cascades a second render.
      const t = setTimeout(() => setErr("This browser can't scan with the camera. Chrome or Edge on Android, or Safari on iOS 17+, can — or use a handheld scanner, or type the code."), 0)
      return () => clearTimeout(t)
    }
    let detector: BarcodeDetectorLike
    try {
      // The formats S&S labels actually use. Narrowing the list makes detection faster
      // and stops a stray QR code on the carton being read as the barcode.
      detector = new Ctor({ formats: ["code_128", "code_39", "itf", "codabar"] })
    } catch {
      const t = setTimeout(() => setErr("Couldn't start the barcode reader on this device."), 0)
      return () => clearTimeout(t)
    }

    let raf = 0
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // Rear camera on a phone or tablet; falls back to whatever exists on a laptop.
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        })
        if (stopped.current) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
          // Deferred: setting state straight from an effect cascades a second render.
          setTimeout(() => { if (!stopped.current) setReady(true) }, 0)
        }

        const tick = async () => {
          if (stopped.current || !videoRef.current) return
          try {
            const hits = await detector.detect(videoRef.current)
            const hit = hits.find((h) => h.rawValue && /\d{6,}[.\-]\d/.test(h.rawValue))
            if (hit) {
              // Stop BEFORE handing the value up: the parent closes this, and a detect
              // loop still running against a torn-down video throws on every frame.
              stop()
              onScan(hit.rawValue.trim())
              return
            }
          } catch { /* a frame that won't decode is normal — keep looking */ }
          raf = requestAnimationFrame(() => { void tick() })
        }
        void tick()
      } catch (e) {
        const name = (e as { name?: string })?.name
        const msg = (name === "NotAllowedError"
          ? "Camera access was blocked. Allow it in the browser's site settings, then try again."
          : name === "NotFoundError"
            ? "No camera on this device."
            : "Couldn't open the camera.")
        setTimeout(() => { if (!stopped.current) setErr(msg) }, 0)
      }
    })()

    return () => { cancelAnimationFrame(raf); stop() }
  }, [onScan, stop])

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border border-border bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="aspect-video w-full object-cover" />
        {/* A guide box: people aim at the middle, and a barcode filling the frame edge-to-
            edge decodes far more reliably than one held at arm's length. */}
        {ready && !err && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-16 w-3/4 rounded border-2 border-white/70" />
          </div>
        )}
        <button onClick={() => { stop(); onClose() }}
          className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
          aria-label="Close camera">
          <X size={14} weight="bold" />
        </button>
      </div>

      {err ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /><span>{err}</span>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Camera size={13} weight="fill" />
          Hold the carton label inside the box. It reads automatically.
        </p>
      )}

      {err && <Button size="sm" variant="outline" onClick={() => { stop(); onClose() }}>Type it instead</Button>}
    </div>
  )
}
