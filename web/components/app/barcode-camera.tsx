"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, X, Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { startCameraScan, releaseCamera, cameraSupported } from "@/lib/barcode-scan"

/**
 * Read a carton barcode with the device camera.
 *
 * Decoding goes through the SHARED startCameraScan, which is the whole point of this
 * change: this component used BarcodeDetector directly, and WebKit has never shipped
 * BarcodeDetector — so every iPhone hit "this browser can't scan" while the Scan station,
 * which already had a ZXing fallback, worked fine on the same handset. Two scanners with
 * two engines meant one of them was quietly iOS-only-broken.
 *
 * startCameraScan uses the native detector on Android/Chromium and lazy-loads ZXing on
 * Safari, so both platforms decode here now.
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
    // startCameraScan keeps ONE warm stream per session so reopening doesn't re-prompt
    // for permission. A receiving bench must not leave it running, so release it here.
    releaseCamera()
  }, [])

  useEffect(() => {
    // getUserMedia itself is the capability that matters now — not BarcodeDetector, which
    // half the phones in a warehouse don't have.
    if (!cameraSupported()) {
      const t = setTimeout(() => setErr("This device has no camera the browser can use. Use a handheld scanner, or type the code."), 0)
      return () => clearTimeout(t)
    }

    let stopFn: (() => void) | null = null
    ;(async () => {
      try {
        const v = videoRef.current
        if (!v) return
        stopFn = await startCameraScan(v, (raw) => {
          // Carton labels only. A stray QR or a price barcode on the same box would
          // otherwise be accepted as the carton id.
          const value = String(raw || "").trim()
          if (!/\d{6,}[.\-]\d/.test(value)) return
          // Stop BEFORE handing the value up: the parent closes this, and a decode loop
          // still running against a torn-down video throws on every frame.
          stop()
          onScan(value)
        })
        if (stopped.current) { stopFn?.(); return }
        setTimeout(() => { if (!stopped.current) setReady(true) }, 0)
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

    return () => { stopFn?.(); stop() }
  }, [onScan, stop])

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border border-border bg-black">
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
