"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Barcode as BarcodeIcon, X, ArrowUp, ArrowDown, ArrowCounterClockwise, CircleNotch, Warning, CheckCircle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getInventory, getScanHistory, scanInventory, undoScan, type InventoryItem } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { parseScan, exactSkuReady, scanBeep, buzz, cameraSupported, startCameraScan, releaseCamera } from "@/lib/barcode-scan"
import { PageTitle } from "@/components/app/page-title"
import { EmptyState } from "@/components/app/empty-state"

type Entry = { key: string; sku: string; qty: number; dir: "in" | "out"; ok: boolean; label: string; sub: string; scanId?: string }

const nowKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const timeNow = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })

// Scan station — one screen for a scanner gun (desktop) and a phone camera (PWA).
// A gun is just a keyboard: it types the SKU then Enter. So the input stays focused
// and refocuses on blur, and an exact SKU match auto-commits — no clicking, ever.
// `embedded` hides the mobile hero when this sits inside the Inventory tab shell.
export function ScanStation({ embedded = false }: { embedded?: boolean }) {
  const tl = useLabelT()
  // Operator gets a READ-ONLY station: they need to look up what's on hand, but moving
  // stock is a claim about physical custody that belongs to the warehouse. Enforced here
  // AND by leaving the commit path unreachable, not just by hiding the input.
 const [readOnly, setReadOnly] = useState(false)
 useEffect(() => {
 const t = setTimeout(() => setReadOnly(getUser()?.role === "operator"), 0)
 return () => clearTimeout(t)
  }, [])
 const [items, setItems] = useState<InventoryItem[] | null>(null)
 const [mode, setMode] = useState<"in" | "out">("in")
 const [value, setValue] = useState("")
 const [log, setLog] = useState<Entry[]>([])
 const [busy, setBusy] = useState(false)
 const [camOpen, setCamOpen] = useState(false)
 const [camErr, setCamErr] = useState<string | null>(null)
  // Which decoder started, and whether anything has decoded yet. A live picture that
  // reads nothing looks exactly like a broken camera — that ambiguity hid an iOS-only
  // failure, so the overlay now says which engine is running and speaks up if a while
  // passes with no read.
 const [engine, setEngine] = useState<"native" | "zxing" | null>(null)
 const [sawScan, setSawScan] = useState(false)
 const [stale, setStale] = useState(false)
 const [flash, setFlash] = useState<"ok" | "err" | null>(null)
  // Resolved after mount: `navigator` doesn't exist during prerender, so testing
  // for camera support inline would render a different tree on server vs client.
 const [hasCam, setHasCam] = useState(false)

 const inputRef = useRef<HTMLInputElement>(null)
 const videoRef = useRef<HTMLVideoElement>(null)
 const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null)
 const busyRef = useRef(false)

 const skus = useMemo(() => (items ?? []).map((i) => i.sku), [items])

  /**
   * Load what has ALREADY been scanned, by anyone, anywhere.
   *
   * This log was session-local: it only ever held what this tab had scanned since it
   * opened. Every scan is persisted to scan_history server-side, and the phone writes to
   * the same table — but the web station never read it, so six items scanned on a phone
   * showed here as an empty list, and a refresh wiped the desktop's own work too. It
   * looked like scans weren't syncing when they were simply never being asked for.
   */
 const loadHistory = useCallback(() => {
 if (!getToken()) return
 getScanHistory(undefined, 40)
      .then((rows) => setLog((prev) => {
        // Anything committed in THIS tab wins its own row — it already carries an
        // optimistic label and an undo handle. Server rows fill in around them.
 const mine = new Set(prev.filter((e) => e.scanId).map((e) => e.scanId))
 const fromServer: Entry[] = (rows ?? [])
          .filter((r) => !mine.has(r.id))
          .map((r) => ({
 key: `srv-${r.id}`, sku: r.sku, qty: Number(r.qty) || 0,
 dir: r.direction === "out" ? "out" : "in", ok: true,
 label: r.item_name || r.sku,
            // created_at is optional on the type, so a missing one says so rather than
            // rendering "Invalid Date" beside a scan that really happened.
 sub: `${r.created_at ? new Date(r.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "earlier"}${r.by_name ? ` · ${r.by_name}` : ""}`,
 scanId: r.id,
          }))
 return [...prev.filter((e) => !e.key.startsWith("srv-")), ...fromServer].slice(0, 60)
      }))
      .catch(() => {})
  }, [])

 useEffect(() => {
 const id = setTimeout(() => {
 setHasCam(cameraSupported())
 if (!getToken()) { setItems([]); return }
 getInventory().then((r) => setItems(r ?? [])).catch(() => setItems([]))
 loadHistory()
    }, 0)
 return () => clearTimeout(id)
  }, [])

  // Keep the live mode in a ref so the camera effect doesn't tear down and
  // re-init the decoder (slow on the iOS/ZXing path) every time IN/OUT flips.
 const modeRef = useRef(mode)
 useEffect(() => { modeRef.current = mode }, [mode])

 const flashNow = (ok: boolean) => {
 setFlash(ok ? "ok" : "err")
 setTimeout(() => setFlash(null), 320)
  }

  // Commit one scan as an atomic server-side delta.
 const doCommit = useCallback(async (raw: string, dir: "in" | "out") => {
 if (readOnly) return
 const { sku, qty } = parseScan(raw)
 if (!sku) return
 busyRef.current = true
 setBusy(true)
 setValue("")
 try {
 const r = await scanInventory({ sku, direction: dir, qty })
 const stock = r.item?.in_stock ?? 0
 setItems((prev) => (prev ?? []).map((i) => (i.sku === sku ? r.item : i)))
 setLog((prev) => [{
 key: nowKey(), sku, qty, dir, ok: true, scanId: r.scan?.id,
 label: `${dir === "in" ? "+" : "−"}${qty} · ${r.item?.name || sku}`,
 sub: `${sku} · now ${stock} on hand · ${timeNow()}`,
      }, ...prev].slice(0, 50))
 scanBeep(true); buzz(true); flashNow(true)
    } catch (e) {
 const msg = e instanceof Error ? e.message : "Scan failed"
 setLog((prev) => [{
 key: nowKey(), sku, qty, dir, ok: false,
 label: msg.includes("Unknown SKU") ? `Not in inventory: ${sku}` : msg,
 sub: `${sku} · nothing changed · ${timeNow()}`,
      }, ...prev].slice(0, 50))
 scanBeep(false); buzz(false); flashNow(false)
    } finally {
 busyRef.current = false
 setBusy(false)
 inputRef.current?.focus()
    }
  }, [readOnly])

  // Serialize scans through a promise chain instead of dropping the ones that
  // land mid-request. A gun fired down a pallet can easily out-run a 300ms POST,
  // and a silently discarded scan means the count is short with nobody the wiser.
 const queueRef = useRef<Promise<void>>(Promise.resolve())
 const commit = useCallback((raw: string, dir: "in" | "out") => {
 queueRef.current = queueRef.current.then(() => doCommit(raw, dir)).catch(() => {})
 return queueRef.current
  }, [doCommit])

  // Auto-fire once the typed/scanned value is an exact SKU (and no longer SKU
  // extends it). Debounced so a gun's character burst can't trip mid-burst.
 const onChange = (v: string) => {
 setValue(v)
 if (autoRef.current) clearTimeout(autoRef.current)
 if (exactSkuReady(v, skus)) autoRef.current = setTimeout(() => commit(v, mode), 70)
  }

 const undo = async (e: Entry) => {
 if (!e.scanId) return
 try {
 const r = await undoScan(e.scanId)
 if (r.item) setItems((prev) => (prev ?? []).map((i) => (i.sku === r.item!.sku ? r.item! : i)))
 setLog((prev) => prev.filter((x) => x.key !== e.key))
    } catch {}
  }

  // ── Camera (phones). Desktop guns never open this. ──
 const stopRef = useRef<(() => void) | null>(null)
 useEffect(() => {
 if (!camOpen) return
 let cancelled = false
 const v = videoRef.current
 if (!v) return
 setCamErr(null); setEngine(null); setSawScan(false); setStale(false)
 const nudge = setTimeout(() => setStale(true), 12000)
 startCameraScan(v, (code) => { clearTimeout(nudge); setSawScan(true); setStale(false); commit(code, modeRef.current) }, (e) => setEngine(e))
      .then((stop) => { if (cancelled) stop(); else stopRef.current = stop })
      .catch(() => { if (!cancelled) setCamErr("Could not start the camera — check permissions, or use the input below.") })
 return () => {
 cancelled = true
 clearTimeout(nudge)
 stopRef.current?.(); stopRef.current = null
    }
  }, [camOpen, commit])
  // Free the camera when the app is backgrounded so it doesn't stay on.
 useEffect(() => {
 const onHide = () => { if (document.hidden) { setCamOpen(false); releaseCamera() } }
 document.addEventListener("visibilitychange", onHide)
 window.addEventListener("pagehide", releaseCamera)
 return () => {
 document.removeEventListener("visibilitychange", onHide)
 window.removeEventListener("pagehide", releaseCamera)
 releaseCamera()
    }
  }, [])

 const isIn = mode === "in"
 const netToday = log.filter((e) => e.ok).reduce((n, e) => n + (e.dir === "in" ? e.qty : -e.qty), 0)

 return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex items-center gap-3 md:hidden">
          <BarcodeIcon size={18} weight="regular" className="shrink-0 text-primary" />
          <div className="min-w-0">
            <PageTitle>{tl("scan", "Scan")}</PageTitle>
            <p className="truncate text-sm text-muted-foreground">{tl("scan", "Scan stock in and out. Works with a scanner gun or your phone camera.")}</p>
          </div>
        </div>
      )}

      {/* Mode — big targets; stays put so you can rapid-fire a whole pallet */}
      <div className="grid grid-cols-2 gap-2">
        {([["in", tl("scan", "Stock In"), ArrowDown], ["out", tl("scan", "Stock Out"), ArrowUp]] as const).map(([m, label, Icon]) => {
 const on = mode === m
 const tone = m === "in" ? "border-shipped/30 bg-shipped text-white" : "border-alert/30 bg-alert text-white"
 return (
            <button
 key={m}
 onClick={() => { setMode(m); inputRef.current?.focus() }}
 className={"flex items-center justify-center gap-2 rounded-xl border py-4 text-base font-semibold transition-colors " + (on ? tone : "border-border bg-card text-muted-foreground hover:text-foreground")}
            >
              <Icon size={18} weight="bold" /> {label}
            </button>
          )
        })}
      </div>

      <SectionCard
 title={readOnly ? "Stock levels — view only" : isIn ? "Scanning IN — adds to stock" : "Scanning OUT — removes from stock"}
 actions={hasCam ? (
          <Button size="sm" variant="outline" onClick={() => setCamOpen(true)}>{tl("scan", "Camera")}</Button>
        ) : undefined}
      >
        <div className="space-y-3 p-5">
          {/* Say WHY rather than presenting a box that does nothing. A disabled input with
 no explanation reads as broken. */}
          {readOnly && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              {tl("scan", "You can look up stock here, but moving it is the warehouse’s call — scanning in and out records physical custody.")}
            </div>
          )}
          <Input
 ref={inputRef}
 disabled={readOnly}
 value={value}
 autoFocus={!readOnly}
 onChange={(e) => onChange(e.target.value)}
 onKeyDown={(e) => { if (e.key === "Enter") { if (autoRef.current) clearTimeout(autoRef.current); commit(value, mode) } }}
 onBlur={() => { if (!camOpen && !readOnly) setTimeout(() => inputRef.current?.focus(), 0) }}
 placeholder={tl("scan", "Scan or type a SKU…  (try SKU x5 for qty)")}
 spellCheck={false}
 autoComplete="off"
 className={"h-16 text-center tabular-nums text-lg transition-colors " + (flash === "ok" ? "border-shipped/30 bg-shipped/12" : flash === "err" ? "border-alert/30 bg-alert/12" : "")}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{busy ? <span className="inline-flex items-center gap-1"><CircleNotch size={12} className="animate-spin" /> {tl("scan", "saving…")}</span> : tl("scan", "Ready — the input stays focused for the gun.")}</span>
            {log.length > 0 && <span>Session net <b className={netToday >= 0 ? "text-success" : "text-alert"}>{netToday >= 0 ? "+" : ""}{netToday}</b> · {log.length} scan{log.length === 1 ? "" : "s"}</span>}
          </div>
        </div>
      </SectionCard>

      {/* Session log — mis-scans happen constantly, so undo is one tap */}
      <SectionCard title={tl("scan", "This session")}>
        {log.length === 0 ? (
          <EmptyState icon={BarcodeIcon} size="sm" title={tl("scan", "Scans show up here as you go")} />
        ) : (
          <div className="divide-y divide-border">
            {log.map((e) => (
              <div key={e.key} className="flex items-center gap-3 px-5 py-2.5">
                <span className={"flex size-7 shrink-0 items-center justify-center rounded-lg " + (!e.ok ? "bg-alert/12 text-alert" : e.dir === "in" ? "bg-shipped/12 text-success" : "bg-hold/15 text-hold")}>
                  {!e.ok ? <Warning size={13} weight="fill" /> : e.dir === "in" ? <ArrowDown size={13} weight="bold" /> : <ArrowUp size={13} weight="bold" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={"truncate text-sm font-medium " + (e.ok ? "" : "text-destructive")}>{e.label}</div>
                  <div className="truncate tabular-nums text-xs text-muted-foreground">{e.sub}</div>
                </div>
                {e.ok && e.scanId && (
                  <Button size="sm" variant="ghost" onClick={() => undo(e)} title={tl("scan", "Undo this scan")} className="shrink-0 text-muted-foreground hover:text-destructive">
                    <ArrowCounterClockwise size={14} weight="bold" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Camera overlay — Android uses native BarcodeDetector, iOS falls back to ZXing */}
      {camOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-sm font-semibold">{isIn ? tl("scan", "Scanning IN") : tl("scan", "Scanning OUT")}</span>
            <button onClick={() => setCamOpen(false)} aria-label={tl("scan", "Close scanner")} className="rounded-lg p-1.5 hover:bg-white/10"><X size={20} weight="bold" /></button>
          </div>
          <div className="relative flex-1 overflow-hidden">
            <video ref={videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />
            {/* Aim box */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {/* SQUARE, not a letterbox. It was 288×160, which is the shape of a 1D
 barcode — aiming a QR inside it meant holding the phone far enough back
 that the code was too small to decode, or cropping it and decoding
 nothing. A square fits both: a barcode sits across the middle of it
 quite happily, a QR fills it. */}
              <div className={"aspect-square w-56 max-w-[70%] rounded-2xl border-4 transition-colors " + (flash === "ok" ? "border-shipped/30" : flash === "err" ? "border-alert/30" : "border-white/70")} />
            </div>
            {camErr && <div className="absolute inset-x-4 top-4 rounded-lg bg-alert px-3 py-2 text-sm text-white">{camErr}</div>}
            {/* Reading, and with what. Says nothing once a scan has landed — by then the
 log below is the feedback and this would just be noise. */}
            {!camErr && !sawScan && (
              <div className="absolute inset-x-4 bottom-4 rounded-lg bg-black/70 px-3 py-2 text-xs text-white">
                {engine === null
                  ? tl("scan", "Starting the camera…")
 : stale
                    ? `Reading (${engine === "native" ? "built-in" : "fallback"}) but nothing decoded yet. Fill the frame with the barcode, tap an inventory code to enlarge it first, and keep 15–25cm away.`
 : `Reading (${engine === "native" ? "built-in" : "fallback"} decoder) — point at a barcode.`}
              </div>
            )}
            {log[0] && (
              <div className={"absolute inset-x-4 bottom-4 rounded-xl px-4 py-3 text-white " + (log[0].ok ? "bg-shipped" : "bg-alert")}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {log[0].ok ? <CheckCircle size={15} weight="fill" /> : <Warning size={15} weight="fill" />} {log[0].label}
                </div>
                <div className="mt-0.5 tabular-nums text-xs opacity-90">{log[0].sub}</div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
            {([["in", tl("scan", "Stock In")], ["out", tl("scan", "Stock Out")]] as const).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} className={"rounded-xl py-3 text-sm font-semibold " + (mode === m ? (m === "in" ? "bg-shipped text-white" : "bg-alert text-white") : "bg-white/10 text-white/70")}>{label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
