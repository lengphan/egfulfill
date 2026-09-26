"use client"

import { useState } from "react"
import { ArrowRight, Lock } from "@phosphor-icons/react"
import { useLabelT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { StageBadge } from "@/components/app/stage-badge"
import { numOf } from "@/lib/order-format"
import type { LibraryFace, LibraryCopy } from "@/lib/api"

/**
 * THE TWO QUESTIONS A LIBRARY FILE ASKS BEFORE IT TOUCHES AN ORDER.
 *
 * Filing a stitch file against artwork puts it onto every order carrying that picture — any
 * seller's — and until these existed it did so without asking, reporting "3 orders now have
 * it" only afterwards. And a corrected file reached new orders only: the attach fills gaps
 * and never overwrites, so a wrong .EMB stayed wherever it had already landed.
 *
 * ONE CONFIRMATION PER UPLOAD, not one per order (owner, 2026-09-25). Confirming that two
 * identical pictures are identical, twelve times, is a click with one possible answer; what
 * can actually be wrong is the FILE, and that is judged once. So the dialog lists every face
 * with what will change on it — method, stage, the design tag, the fee — ticked, and a person
 * unticks the odd one.
 *
 * The rows come from the server's libraryCandidates, and the confirm posts back the keys, so
 * the list read here is the list written (§5).
 */

const sideLabel = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "")
const orderLabel = (f: { order_id: string; ref_no?: number | string | null; seq?: number | null; ref_label?: string | null }) =>
  numOf({ id: f.order_id, ref_no: f.ref_no, seq: f.seq, ref_label: f.ref_label } as Parameters<typeof numOf>[0])

/** Order · face · item — the identity of one row, at value size (§4: a value is not a caption). */
function FaceTitle({ f, muted }: { f: { order_id: string; ref_no?: number | string | null; seq?: number | null; ref_label?: string | null; side: string | null; item: string | null }; muted?: boolean }) {
  return (
    <span className={"min-w-0 truncate text-sm tabular-nums " + (muted ? "text-muted-foreground" : "font-medium")}>
      {[orderLabel(f), sideLabel(f.side), f.item].filter(Boolean).join(" · ")}
    </span>
  )
}

export type AttachTarget = { key: string; setMethod?: boolean }

export function LibraryAttachDialog({ fileName, designNo, attach, needsMethod, notAttached, admin, busy, onCancel, onConfirm }: {
  fileName: string
  designNo: number | null
  attach: LibraryFace[]
  needsMethod: LibraryFace[]
  notAttached: LibraryFace[]
  admin: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: (targets: AttachTarget[]) => void
}) {
  const tl = useLabelT()
  /* Seeded once — the parent remounts this with a new key for every upload, so there is no
     reset effect to render a frame of the previous file's ticks (§5). */
  const [picked, setPicked] = useState<Set<string>>(() => new Set(attach.map((f) => f.key)))
  const [withMethod, setWithMethod] = useState<Set<string>>(() => new Set())
  const flip = (set: Set<string>, key: string) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n }

  const chosen = [...attach, ...needsMethod].filter((f) => picked.has(f.key))
  const orders = new Set(chosen.map((f) => f.order_id)).size
  const sellers = new Set(chosen.map((f) => f.seller).filter(Boolean)).size
  const lines = chosen.length

  const fee = (f: LibraryFace) => f.charged
    ? tl("libraryFile", "Fee already charged — unchanged")
    : tl("libraryFile", "Fee: digitising → check")

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onCancel() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {tl("libraryFile", "Attach")} {fileName} {tl("libraryFile", "to")} {lines} {lines === 1 ? tl("libraryFile", "line") : tl("libraryFile", "lines")}?
          </DialogTitle>
          <DialogDescription className="tabular-nums">
            {designNo != null ? `DSN-${designNo} · ` : ""}{tl("libraryFile", "Exact match")}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6">
          {attach.length > 0 && (
            <section>
              <h3 className="pb-1 pt-2 text-xs font-medium text-muted-foreground">{tl("libraryFile", "Attach")}</h3>
              {attach.map((f) => (
                <label key={f.key} className="grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_6.5rem] items-start gap-3 border-b border-border/60 py-3 last:border-0">
                  <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={picked.has(f.key)}
                    onChange={() => setPicked((s) => flip(s, f.key))} disabled={busy} />
                  <div className="min-w-0 space-y-1">
                    <FaceTitle f={f} />
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{tl("libraryFile", "Method")} <b className="font-medium text-foreground">{f.method}</b></span>
                      <span>{tl("libraryFile", "Design: waiting → ready")}</span>
                      <span>{fee(f)}</span>
                    </div>
                    {f.seller_draft && (
                      <div className="text-xs text-muted-foreground">{tl("libraryFile", "Seller's draft — file only")}</div>
                    )}
                  </div>
                  <span className="justify-self-end"><StageBadge status={f.stage} /></span>
                </label>
              ))}
            </section>
          )}

          {needsMethod.length > 0 && (
            <section>
              <h3 className="pb-1 pt-4 text-xs font-medium text-muted-foreground">{tl("libraryFile", "Needs a method")}</h3>
              {needsMethod.map((f) => {
                /* WHAT THE SELLER ORDERED IS THEIRS. On their own draft the file may go on —
                   it is ours to supply — but deciding the face is embroidery is not. */
                const lockMethod = f.seller_draft && !admin
                return (
                  <div key={f.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_6.5rem] items-start gap-3 border-b border-border/60 py-3 last:border-0">
                    <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={picked.has(f.key)}
                      aria-label={`${tl("libraryFile", "Attach to")} ${orderLabel(f)}`}
                      onChange={() => setPicked((s) => flip(s, f.key))} disabled={busy} />
                    <div className="min-w-0 space-y-1.5">
                      <FaceTitle f={f} />
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{tl("libraryFile", "Method")} <b className="font-medium text-amber-700 dark:text-amber-400">{tl("libraryFile", "not set")}</b></span>
                        <label className={"eg-control flex h-7 items-center gap-2 px-2 text-xs text-foreground " + (lockMethod ? "opacity-50" : "cursor-pointer")}
                          title={lockMethod ? tl("libraryFile", "The seller's draft — the method is theirs to set") : undefined}>
                          <input type="checkbox" className="size-3.5 accent-primary" disabled={busy || lockMethod || !picked.has(f.key)}
                            checked={withMethod.has(f.key) && picked.has(f.key)}
                            onChange={() => setWithMethod((s) => flip(s, f.key))} />
                          {tl("libraryFile", "Set to Embroidery")}
                        </label>
                        <span>{fee(f)}</span>
                      </div>
                    </div>
                    <span className="justify-self-end"><StageBadge status={f.stage} /></span>
                  </div>
                )
              })}
            </section>
          )}

          {notAttached.length > 0 && (
            <section>
              <h3 className="pb-1 pt-4 text-xs font-medium text-muted-foreground">{tl("libraryFile", "Not attached")}</h3>
              {notAttached.map((f) => (
                <div key={f.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 border-b border-border/60 py-2.5 last:border-0">
                  <span className="text-center text-sm text-muted-foreground" aria-hidden>–</span>
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                    <FaceTitle f={f} muted />
                    <span className="text-xs text-muted-foreground">
                      {f.reason === "method"
                        ? `${f.method} — ${tl("libraryFile", "a stitch file can't run here")}`
                        : tl("libraryFile", "Finished — left as it is")}
                    </span>
                  </div>
                  <span className="justify-self-end">
                    {f.reason === "method"
                      ? <a href={`/orders/${encodeURIComponent(f.order_id)}`} className="text-xs font-medium underline-offset-2 hover:underline">{tl("libraryFile", "Open order")}</a>
                      : <StageBadge status={f.stage} />}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm tabular-nums text-muted-foreground">
            <b className="font-semibold text-foreground">{lines} {lines === 1 ? tl("libraryFile", "line") : tl("libraryFile", "lines")}</b>
            {" · "}{orders} {orders === 1 ? tl("libraryFile", "order") : tl("libraryFile", "orders")}
            {sellers > 1 ? ` · ${sellers} ${tl("libraryFile", "sellers")}` : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={busy}>{tl("libraryFile", "Cancel")}</Button>
            <Button disabled={busy}
              onClick={() => onConfirm(chosen.map((f) => ({ key: f.key, setMethod: withMethod.has(f.key) || undefined })))}>
              {lines
                ? `${tl("libraryFile", "Attach to")} ${lines} ${lines === 1 ? tl("libraryFile", "line") : tl("libraryFile", "lines")}`
                : tl("libraryFile", "File without attaching")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * REPLACE — two words, not two paragraphs (owner: "either Unshipped Orders or All Orders").
 *
 * "Unshipped" means NOTHING HAS BEEN STITCHED yet — new, pending, approved. An order already
 * being made is unshipped too, but swapping its file would make the record claim a file the
 * machine never ran, so it keeps the old one unless "All orders" is chosen. The list shows
 * which rows each choice reaches: the ones it leaves are drawn locked.
 */
export function LibraryReplaceDialog({ designNo, oldName, newName, copies, busy, onCancel, onConfirm }: {
  designNo: number | null
  oldName: string
  newName: string
  copies: LibraryCopy[]
  busy: boolean
  onCancel: () => void
  onConfirm: (scope: "unshipped" | "all") => void
}) {
  const tl = useLabelT()
  const [scope, setScope] = useState<"unshipped" | "all">("unshipped")
  /* ORDERS, not copies — a cap embroidered front and back is two copies on one order, and
     "Replace on 2 orders" would be counting faces under the name of orders. */
  const ordersIn = (list: LibraryCopy[]) => new Set(list.map((c) => c.order_id)).size
  const unshipped = ordersIn(copies.filter((c) => c.unshipped))
  const all = ordersIn(copies)
  const count = scope === "all" ? all : unshipped

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onCancel() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="tabular-nums">
            {tl("libraryFile", "Replace the file for")} {designNo != null ? `DSN-${designNo}` : tl("libraryFile", "this design")}
          </DialogTitle>
          <DialogDescription className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate line-through">{oldName}</span>
            <ArrowRight size={14} className="shrink-0" />
            <span className="truncate font-medium text-foreground">{newName}</span>
          </DialogDescription>
        </DialogHeader>

        {copies.length > 0 ? (
          <>
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{tl("libraryFile", "Swap it on")}</div>
              <div className="grid grid-cols-2 gap-2">
                {([["unshipped", tl("libraryFile", "Unshipped orders"), unshipped], ["all", tl("libraryFile", "All orders"), all]] as const).map(([v, label, n]) => (
                  <label key={v} className={"flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-3 "
                    + (scope === v ? "border-foreground" : "border-border")}>
                    <input type="radio" name="replace-scope" className="accent-primary" checked={scope === v}
                      onChange={() => setScope(v)} disabled={busy} />
                    <span className="flex-1 text-sm font-medium">{label}</span>
                    <span className="text-sm tabular-nums text-muted-foreground">{n}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="-mx-6 max-h-[45vh] overflow-y-auto px-6">
              {copies.map((c) => {
                const reached = scope === "all" || c.unshipped
                return (
                  <div key={c.design_id} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-3 border-b border-border/60 py-2.5 last:border-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {!reached && <Lock size={12} className="shrink-0 text-muted-foreground" aria-label={tl("libraryFile", "Keeps the old file")} />}
                      <FaceTitle f={c} muted={!reached} />
                    </div>
                    <span className="justify-self-end"><StageBadge status={c.stage} /></span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{tl("libraryFile", "No order has this file yet — only new orders will get the new one.")}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>{tl("libraryFile", "Cancel")}</Button>
          <Button onClick={() => onConfirm(scope)} disabled={busy}>
            {count
              ? `${tl("libraryFile", "Replace on")} ${count} ${count === 1 ? tl("libraryFile", "order") : tl("libraryFile", "orders")}`
              : tl("libraryFile", "Replace for new orders")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
