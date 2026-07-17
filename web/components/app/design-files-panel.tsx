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

/** Seller-side: their .pes deliverables for one order, bought from the wallet. */
export function SellerDesignFiles({ orderId }: { orderId: string }) {
  const [files, setFiles] = useState<DesignFileRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getDesignFiles(orderId).then((r) => setFiles(r ?? [])).catch(() => setFiles([]))
  }, [orderId])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

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
  if (!files.length) return null

  return (
    <div className="space-y-2">
      {err && <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><Warning size={12} weight="fill" /> {err}</div>}
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
    </div>
  )
}
