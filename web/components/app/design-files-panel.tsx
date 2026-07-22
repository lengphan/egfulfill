"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { UploadSimple, FileArrowDown, CircleNotch, Warning, CurrencyDollar, Image as ImageIcon, FileZip, Sparkle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getDesignFiles, uploadDesignFile, setDesignFilePrice, downloadDesignFile, type DesignFileRow } from "@/lib/api"
import { getUser } from "@/lib/auth"

// A file id that's stable per (order, sku, filename) so re-dropping the same file
// REPLACES it rather than piling up duplicates on the card.
const idFor = (orderId: string, sku: string | undefined, name: string) =>
  `DF-${orderId}-${sku || "x"}-${name}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120)

// What counts as a machine file, in one place — the seller drop zone tests names against
// the regex and offers the same list in its accept attribute, so the picker can never
// suggest a type the handler then refuses.
const MACHINE_RE = /\.(emb|pes|dst|exp|jef|vp3|xxx|hus)$/i
const MACHINE_ACCEPT = ".emb,.pes,.dst,.exp,.jef,.vp3,.xxx,.hus"

const KIND_META: Record<string, { label: string; hint: string; cls: string; icon: React.ReactNode }> = {
  pes: { label: "PES", hint: "seller deliverable · paid", cls: "bg-violet-100 text-violet-700", icon: <FileArrowDown size={12} weight="fill" /> },
  emb: { label: "EMB", hint: "factory working file", cls: "bg-amber-100 text-amber-700", icon: <FileZip size={12} weight="fill" /> },
  image: { label: "IMG", hint: "artwork / mockup", cls: "bg-sky-100 text-sky-700", icon: <ImageIcon size={12} weight="fill" /> },
  other: { label: "FILE", hint: "", cls: "bg-muted text-muted-foreground", icon: <FileZip size={12} weight="fill" /> },
}

/**
 * Drag-and-drop files onto an order (optionally a specific line item), and manage
 * them. Every type is stored; the SERVER decides who sees what by `kind`:
 *   .pes → the seller's deliverable, behind the wallet paywall
 *   .emb → factory working file (all factory boards)
 *   image/* → artwork + mockups (factory)
 * Pricing is admin/warehouse only — enforced server-side too, not just hidden here.
 */
export function DesignFilesPanel({ orderId, sku, compact }: { orderId: string; sku?: string; compact?: boolean }) {
  const [files, setFiles] = useState<DesignFileRow[] | null>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [role, setRole] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const canPrice = role === "admin" || role === "warehouse"

  const load = useCallback(() => {
    getDesignFiles(orderId).then((r) => setFiles(r ?? [])).catch(() => setFiles([]))
  }, [orderId])
  useEffect(() => {
    const id = setTimeout(() => { setRole(getUser()?.role || ""); load() }, 0)
    return () => clearTimeout(id)
  }, [load])

  const upload = async (list: FileList | File[]) => {
    const arr = Array.from(list)
    if (!arr.length) return
    setErr(null)
    for (const f of arr) {
      // 50MB: the API body limit is 60MB and base64 inflates ~33%, so anything
      // bigger would be rejected by the server with a confusing error.
      if (f.size > 50 * 1024 * 1024) { setErr(`${f.name} is too large (max 50 MB).`); continue }
      setBusy(f.name)
      try {
        const data = await new Promise<string>((res, rej) => {
          const fr = new FileReader()
          fr.onload = () => res(String(fr.result))
          fr.onerror = () => rej(new Error("Could not read the file"))
          fr.readAsDataURL(f)
        })
        await uploadDesignFile({ designId: idFor(orderId, sku, f.name), orderId, sku, name: f.name, mime: f.type || undefined, data })
      } catch (e) {
        setErr(e instanceof Error ? e.message : `Could not upload ${f.name}`)
      } finally {
        setBusy(null)
      }
    }
    load()
  }

  const price = async (f: DesignFileRow, v: string) => {
    const n = Math.max(0, Number(v) || 0)
    setFiles((prev) => (prev ?? []).map((x) => (x.designId === f.designId ? { ...x, price: n } : x)))
    try { await setDesignFilePrice(f.designId, n) } catch { load() }
  }

  const get = async (f: DesignFileRow) => {
    setBusy(f.designId)
    try {
      const r = await downloadDesignFile(f.designId)
      if (!r.data) throw new Error("File has no data")
      const a = document.createElement("a")
      a.href = r.data
      a.download = r.name || f.name || "design"
      a.click()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not download the file")
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-2">
      {/* Drop zone — the thing that didn't exist before. */}
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition-colors " +
          (over ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/40")
        }
      >
        {busy ? <CircleNotch size={18} className="animate-spin text-muted-foreground" /> : <UploadSimple size={18} weight="bold" className="text-muted-foreground" />}
        <span className="text-xs font-medium">{busy ? `Uploading ${busy}…` : "Drop files here or click to browse"}</span>
        {!compact && <span className="text-[10px] text-muted-foreground">.pes goes to the seller · .emb + images stay on the factory boards</span>}
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = "" }} />
      </div>

      {err && <div className="flex items-center gap-1.5 text-xs text-destructive"><Warning size={12} weight="fill" /> {err}</div>}

      {files === null ? (
        <div className="flex justify-center py-3 text-muted-foreground"><CircleNotch size={14} className="animate-spin" /></div>
      ) : files.length === 0 ? (
        <div className="py-2 text-center text-[11px] text-muted-foreground">No files yet.</div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {files.map((f) => {
            const k = KIND_META[f.kind || "other"] ?? KIND_META.other
            return (
              <div key={f.designId} className="flex items-center gap-2 p-2">
                <span className={"flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold " + k.cls}>{k.icon} {k.label}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{f.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{f.sku ? `${f.sku} · ` : ""}{k.hint}</div>
                </div>

                {/* Only .pes is sold, so only .pes gets a price — and only admin/warehouse
                    may set it (the server rejects anyone else regardless). */}
                {f.kind === "pes" && (
                  canPrice ? (
                    <label className="flex shrink-0 items-center gap-1" title="What the seller pays to download this">
                      <CurrencyDollar size={11} className="text-muted-foreground" />
                      <Input
                        defaultValue={String(f.price ?? 0)}
                        onBlur={(e) => price(f, e.target.value)}
                        inputMode="decimal"
                        aria-label={`Price for ${f.name}`}
                        className="h-7 w-16 text-center text-xs"
                      />
                    </label>
                  ) : (
                    <span className="shrink-0 text-[11px] font-medium tabular-nums">{f.price ? `$${f.price}` : "Free"}</span>
                  )
                )}

                <Button size="sm" variant="ghost" className="shrink-0" disabled={busy === f.designId} onClick={() => get(f)} title="Download">
                  {busy === f.designId ? <CircleNotch size={12} className="animate-spin" /> : <FileArrowDown size={13} weight="bold" />}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Seller-side: their .pes deliverables for one order, bought from the wallet — and, now,
 * the place they can hand US a machine file.
 *
 * It used to be read-only and `return null` when empty, which left the "Design files" card
 * on the order page rendering a heading, the words "download once purchased", and nothing
 * at all. A seller could not tell that apart from a broken fetch. It now always says which
 * of the two it is, and the empty state does something useful instead of looking faulty.
 *
 * Taking uploads here is safe on the money side, and that is worth stating because it very
 * nearly isn't: a seller's own .pes is classified `kind: 'pes'` — the PAYWALLED kind — so
 * the obvious fear is that they'd have to buy back the file they just sent. They don't.
 * `price` defaults to 0, the download route only charges when `price > 0`, and only
 * admin/warehouse can ever set a price. Verified against design_files.js, not assumed.
 */
export function SellerDesignFiles({ orderId }: { orderId: string }) {
  const [files, setFiles] = useState<DesignFileRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    getDesignFiles(orderId).then((r) => setFiles(r ?? [])).catch(() => setFiles([]))
  }, [orderId])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  /**
   * Send us a machine file. Refused BY NAME if it isn't one — this panel sits under a
   * heading about machine files, so an image dropped here is a mistake worth naming rather
   * than storing as a mockup the seller will never see again.
   */
  const send = async (list: FileList | File[]) => {
    const arr = Array.from(list)
    if (!arr.length) return
    setErr(null); setSent(null)
    const wrong = arr.filter((f) => !MACHINE_RE.test(f.name))
    const ok = arr.filter((f) => MACHINE_RE.test(f.name))
    if (wrong.length) {
      setErr(`${wrong.map((f) => f.name).join(", ")} — not a machine file. Artwork goes on the item itself, through Customize.`)
    }
    for (const f of ok) {
      // 50MB: the body limit is 60MB and base64 inflates by about a third, so a bigger
      // file returns a server error that says nothing useful.
      if (f.size > 50 * 1024 * 1024) { setErr(`${f.name} is too large — 50 MB is the limit.`); continue }
      setBusy(f.name)
      try {
        const data = await new Promise<string>((res, rej) => {
          const fr = new FileReader()
          fr.onload = () => res(String(fr.result))
          fr.onerror = () => rej(new Error("Could not read the file"))
          fr.readAsDataURL(f)
        })
        const r = await uploadDesignFile({ designId: idFor(orderId, undefined, f.name), orderId, name: f.name, mime: f.type || undefined, data })
        if (r?.error) throw new Error(r.error)
        // Says what happens NEXT. The file landing is not the outcome the seller cares
        // about — being checked before production is.
        setSent(`${f.name} sent. We'll check it before production and come back to you if anything's wrong.`)
      } catch (e) {
        setErr(e instanceof Error ? e.message : `Could not send ${f.name}`)
      } finally { setBusy(null) }
    }
    load()
  }

  const dropZone = (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void send(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
      className={
        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition-colors " +
        (over ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/40")
      }
    >
      {busy ? <CircleNotch size={18} className="animate-spin text-muted-foreground" /> : <UploadSimple size={18} weight="bold" className="text-muted-foreground" />}
      <span className="text-xs font-medium">{busy ? `Sending ${busy}…` : "Already have a machine file? Drop it here"}</span>
      <span className="text-[10px] text-muted-foreground">.pes · .dst · .emb · .exp · .jef — we check it, and charge the check fee instead of digitising</span>
      <input ref={inputRef} type="file" multiple accept={MACHINE_ACCEPT} className="hidden"
        onChange={(e) => { if (e.target.files) void send(e.target.files); e.target.value = "" }} />
    </div>
  )

  const notices = (
    <>
      {err && <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><Warning size={12} weight="fill" className="mt-0.5 shrink-0" /> {err}</div>}
      {sent && <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><Sparkle size={12} weight="fill" className="mt-0.5 shrink-0" /> {sent}</div>}
    </>
  )

  const buyAndGet = async (f: DesignFileRow) => {
    setBusy(f.designId); setErr(null)
    try {
      if (!f.paid) {
        const { purchaseDesignFile } = await import("@/lib/api")
        const r = await purchaseDesignFile(f.designId)
        if (r.error) throw new Error(r.error)
      }
      const r = await downloadDesignFile(f.designId)
      if (!r.data) throw new Error("File has no data")
      const a = document.createElement("a")
      a.href = r.data
      a.download = r.name || f.name || "design"
      a.click()
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not get the file")
    } finally { setBusy(null) }
  }

  if (files === null) return <div className="flex justify-center py-4 text-muted-foreground"><CircleNotch size={16} className="animate-spin" /></div>

  // NOTHING TO BUY is a real state and it now says so. Returning null here left the card
  // above it showing a title and blank space — a promise of files with no files and no
  // explanation, which reads exactly like a fetch that failed.
  if (!files.length) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          No machine files on this order yet. They appear here once we&apos;ve cut them — or send us your own.
        </p>
        {dropZone}
        {notices}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {notices}
      {files.map((f) => (
        <div key={f.designId} className="flex items-center gap-3 rounded-xl border border-border p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><Sparkle size={14} weight="fill" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{f.name}</div>
            <div className="text-xs text-muted-foreground">{f.paid ? "Purchased" : f.price ? `$${f.price} — pays from your wallet` : "Free"}</div>
          </div>
          <Button size="sm" variant={f.paid ? "outline" : "default"} disabled={busy === f.designId} onClick={() => buyAndGet(f)}>
            {busy === f.designId ? <CircleNotch size={13} className="animate-spin" />
              : f.paid ? <><FileArrowDown size={13} weight="bold" /> Download</>
              : <>Buy ${f.price} &amp; download</>}
          </Button>
        </div>
      ))}
      {/* Offered alongside existing files too, not only when the list is empty — a seller
          may send a corrected file after we've already delivered one. */}
      {dropZone}
    </div>
  )
}
