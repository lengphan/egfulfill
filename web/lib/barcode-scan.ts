// Barcode scanning primitives, ported from the battle-tested static app
// (floor.html camera split + warehouse.html beep/parse logic). Keep the behaviour
// here identical to those — it was tuned against real scanner guns and phones.
//
//   • Android/Chromium → native BarcodeDetector (fast, no download).
//   • iOS Safari       → BarcodeDetector does NOT exist, so we lazy-load ZXing
//                        and decode the camera stream in-page.
//   • Scanner gun      → no camera at all; it types the code + Enter.

type DetectedBarcode = { rawValue: string }
type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

const FORMATS = ["qr_code", "code_128", "ean_13", "ean_8", "code_39", "code_93", "upc_a", "upc_e", "itf", "codabar", "data_matrix", "aztec", "pdf417"]

const detectorCtor = (): BarcodeDetectorCtor | null => {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
  return w.BarcodeDetector ?? null
}
export const cameraSupported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia

// ── Audible feedback ────────────────────────────────────────────────────────
// Warehouse staff don't watch the screen — the beep IS the confirmation.
// 880Hz sine chirp for OK, low 200Hz square buzz for error (same as the old app).
let audioCtx: AudioContext | null = null
const playTone = (ctx: AudioContext, ok: boolean) => {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain); gain.connect(ctx.destination)
  osc.type = ok ? "sine" : "square"
  osc.frequency.value = ok ? 880 : 200
  gain.gain.setValueAtTime(ok ? 0.18 : 0.16, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.09 : 0.22))
  osc.start(); osc.stop(ctx.currentTime + (ok ? 0.1 : 0.23))
}
export function scanBeep(ok: boolean) {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = audioCtx || new Ctor()
    const ctx = audioCtx
    // Await resume() so the first beep after load isn't eaten by the autoplay policy.
    if (ctx.state === "suspended") ctx.resume().then(() => playTone(ctx, ok)).catch(() => {})
    else playTone(ctx, ok)
  } catch {}
}
export const buzz = (ok: boolean) => { try { navigator.vibrate?.(ok ? 60 : [40, 40]) } catch {} }

// ── Parsing ─────────────────────────────────────────────────────────────────
// A gun can send a qty suffix: "BLK-GLD-SM x5" or "BLK-GLD-SM 5".
// NB: the old static-app regex (/^([A-Z0-9-]+)\s*[Xx]?\s*(\d+)$/) made the suffix
// optional, so a plain numeric barcode "12345" parsed as sku "1234" qty 5 — silently
// scanning the wrong item. We require an explicit separator (a space or an X), so a
// numeric barcode stays whole.
export function parseScan(raw: string): { sku: string; qty: number } {
  const v = (raw || "").trim().toUpperCase()
  const m = v.match(/^([A-Z0-9-]*[A-Z0-9])(?:\s*X\s*|\s+)(\d+)$/)
  if (m) return { sku: m[1], qty: Math.max(1, parseInt(m[2], 10) || 1) }
  return { sku: v, qty: 1 }
}

// Auto-fire on an EXACT SKU match, but NOT while a longer SKU still starts with it
// (so typing "BLK-GLD-S" toward "BLK-GLD-SM" doesn't commit the wrong item).
export function exactSkuReady(value: string, skus: string[]): boolean {
  const { sku } = parseScan(value)
  if (!sku) return false
  if (!skus.includes(sku)) return false
  return !skus.some((s) => s !== sku && s.startsWith(sku))
}

// ── Camera ──────────────────────────────────────────────────────────────────
// ONE warm stream per session: the permission prompt appears only the first time.
let stream: MediaStream | null = null
let streamP: Promise<MediaStream> | null = null
function getCamera(): Promise<MediaStream> {
  if (stream?.active) return Promise.resolve(stream)
  if (streamP) return streamP
  streamP = navigator.mediaDevices
    .getUserMedia({ video: { facingMode: { ideal: "environment" } } })
    .then((s) => { stream = s; streamP = null; return s })
    .catch((e) => { streamP = null; throw e })
  return streamP
}
export function releaseCamera() {
  try { stream?.getTracks().forEach((t) => t.stop()) } catch {}
  stream = null
}

/**
 * Start decoding into `video`, calling `onScan` with each decoded value.
 * Returns a stop() that halts decoding but keeps the stream warm (no re-prompt
 * on reopen); call releaseCamera() to actually free the camera.
 */
export async function startCameraScan(
  video: HTMLVideoElement,
  onScan: (value: string) => void,
  /** Which decoder actually started. Surfaced in the UI because "a live picture that
   *  decodes nothing" and "a broken camera" look identical, and that ambiguity hid an
   *  iOS-only failure for as long as it existed. */
  onEngine?: (engine: "native" | "zxing") => void,
): Promise<() => void> {
  const s = await getCamera()
  // Attributes only — NOT srcObject, and NOT play(). iOS refuses to autoplay a video
  // inline without playsinline + muted, so those must be set before anything plays; but
  // the stream is attached per-engine below, and doing it here breaks the ZXing path.
  video.setAttribute("playsinline", "true")
  video.playsInline = true
  video.muted = true

  // Same code within 2.5s is the same physical scan, not a second one.
  let lastHit = ""
  let lastAt = 0
  const emit = (v: string) => {
    const now = Date.now()
    if (v === lastHit && now - lastAt < 2500) return
    lastHit = v; lastAt = now
    onScan(v)
  }

  const Ctor = detectorCtor()
  if (Ctor) {
    let detector: BarcodeDetectorLike | null = null
    try { detector = new Ctor({ formats: FORMATS }) } catch { try { detector = new Ctor() } catch { detector = null } }
    if (detector) {
      // The native detector reads frames off a video WE drive, so attach and play here.
      video.srcObject = s
      void video.play().catch(() => {})
      onEngine?.("native")
      let raf = 0
      let alive = true
      const tick = () => {
        if (!alive) return
        detector!.detect(video).then((codes) => { if (codes?.length) emit(codes[0].rawValue) }).catch(() => {})
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => { alive = false; cancelAnimationFrame(raf); try { video.pause() } catch {} }
    }
  }

  // iOS Safari path — no BarcodeDetector in WebKit, so ZXing decodes the stream.
  //
  // decodeFromStream ATTACHES THE STREAM ITSELF and then waits for the video to signal
  // it can play. We used to assign srcObject and call play() above, before this line —
  // so by the time ZXing attached its listener the event had already fired, the promise
  // it awaits never settled, and decodeFromStream never returned. The camera showed a
  // live picture and decoded nothing, with no error to explain it. That is why scanning
  // worked on Chromium (native detector, never reaches here) and silently failed on
  // every iPhone. Leave the attaching to ZXing.
  const { BrowserMultiFormatReader } = await import("@zxing/browser")
  onEngine?.("zxing")
  const reader = new BrowserMultiFormatReader()
  const controls = await reader.decodeFromStream(s, video, (result) => { if (result) emit(result.getText()) })
  return () => { try { controls.stop() } catch {}; try { video.pause() } catch {} }
}
