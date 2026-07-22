"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Warning, CheckCircle, DownloadSimple, UploadSimple, PaperPlaneTilt, PenNib, CopySimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { setDesignTier, uploadDesignFile, postOrderDesign, type DesignTier, type OrderItem, type OrderRow } from "@/lib/api"
import { numOf } from "@/lib/order-format"
import { getUser } from "@/lib/auth"

/** Machine-file extensions the embroidery side actually uses. Kept in one place so the
 *  accept attribute, the drop filter and the error message can't drift apart. */
const MACHINE_EXT = [".emb", ".pes", ".dst", ".exp", ".jef", ".vp3", ".xxx", ".hus"]
const isMachineFile = (name: string) => MACHINE_EXT.some((e) => name.toLowerCase().endsWith(e))

/** Artwork the customer's design can be. Anything else is refused BY NAME rather than
 *  ignored — a file that vanishes silently is the worst outcome of a drop target. */
const ART_EXT = [".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"]
const isArtFile = (name: string) => ART_EXT.some((e) => name.toLowerCase().endsWith(e))

const readAsDataUrl = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result))
  r.onerror = () => rej(new Error("unreadable"))
  r.readAsDataURL(f)
})

/**
 * The artwork, big, with the two things you actually need while looking at it.
 *
 * DOWNLOAD, because the person checking a design is often about to open it in embroidery
 * software, and "right-click, save as" on a canvas that may be a signed URL or a data-URL
 * is not a workflow. The customer's file is the reference the machine file gets judged
 * against.
 *
 * DROP A MACHINE FILE, because the common case is that our designer cut it and sent it
 * back out-of-band, and the operator is the one holding it. Uploading it here rather than
 * hunting for a separate screen is the difference between the file being filed and it
 * sitting in someone's inbox.
 *
 * Machine files only — an image dropped here would be stored as `kind: 'image'` and quietly
 * fail to count as a deliverable anywhere, which looks identical to a successful upload.
 */
export function ArtworkZoom({ order, item, artwork, designs, open, onOpenChange, onUploaded, onSendToDesigner }: {
  order: OrderRow
  item: OrderItem
  /** The customer's artwork — a URL or data-URL, whichever the designs map holds. */
  artwork: string | null
  /** Every design on the order, keyed the same way the server keys them (line first).
   *  Used to say how many lines "apply to all" would overwrite before it does. */
  designs?: Record<string, { data?: string } | undefined> | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onUploaded?: () => void
  /** Offered only when the line has no machine file yet — see the note by the button. */
  onSendToDesigner?: () => void
}) {
  /**
   * Whether the VIEWER is factory staff.
   *
   * This panel is now opened by sellers too, and it carries two things a seller must never
   * see: the design-charge tiers (which set what THEY are billed) and "send to a designer"
   * (which spends factory time). Read from the session here rather than taken as a prop —
   * a caller that forgot to pass one would silently expose both, and the failure would look
   * like a working screen. The server gates these routes as well; this is the UI half.
   *
   * Deferred, like every other session read in the app: localStorage doesn't exist during
   * the prerender.
   */
  const [isStaff, setIsStaff] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      const role = getUser()?.role
      setIsStaff(role === "admin" || role === "operator" || role === "warehouse" || role === "designer")
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [tierBusy, setTierBusy] = useState<DesignTier | null>(null)
  const [tier, setTier] = useState<DesignTier | null>((item.design_tier as DesignTier | null) ?? null)
  const quote = item.design_quote_status ?? null
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { setErr(null); setDone(null); setOver(false) }, 0)
    return () => clearTimeout(t)
  }, [open])

  /**
   * ONE drop target, TWO destinations — routed by extension, never merged.
   *
   * A machine file is a billable deliverable: it goes to /api/design_files, is priced
   * from emb_price and is permission-checked against the order's owner. Artwork is
   * reference input: it goes to /api/orders/:id/designs, is free, and carries the
   * placement and perceptual hash that cross-seller duplicate detection depends on.
   * Sending either down the other's route would bill for artwork or make a deliverable
   * free — so the UI merges and the backends stay apart.
   *
   * Nothing is accepted silently. Every file is reported as artwork, machine file, or
   * refused by name.
   */
  const upload = useCallback(async (files: File[]) => {
    if (!files.length) return
    const machine = files.filter((f) => isMachineFile(f.name))
    const art = files.filter((f) => isArtFile(f.name))
    const rejected = files.filter((f) => !isMachineFile(f.name) && !isArtFile(f.name))

    // REPLACING artwork is destructive and was silent. order_designs upserts on the line
    // key, so a second image overwrites the first — and `artwork` is exactly how we know
    // one is already there, since it is what this panel is displaying. The customer's file
    // is the thing a machine file gets judged against; losing it to a stray drop is not
    // recoverable from this screen.
    if (art.length && artwork) {
      const ok = window.confirm(
        `This line already has artwork, and a line holds only one.\n\nReplace it with ${art.length > 1 ? art[art.length - 1].name : art[0].name}?`
      )
      if (!ok) return
    }

    // A machine file on a line nobody marked embroidery is either a mis-drop or a
    // mislabelled line — and this route CHARGES. Ask before spending someone's money.
    // Embroidery is indicated by print_type, not a flag — same derivation orders-hub uses
    // when it builds a design card (/emb/i.test(print_type)). There is no is_emb on an
    // order item; that field belongs to design_cards.
    const isEmbLine = /emb/i.test(item.print_type || "")
    if (machine.length && !isEmbLine) {
      const ok = window.confirm(
        `This line isn't marked as embroidery, and filing a machine file bills it at the machine-file rate.\n\nAttach ${machine.length} file${machine.length === 1 ? "" : "s"} anyway?`
      )
      if (!ok) return
    }

    setBusy(true); setErr(null); setDone(null)
    const failed: string[] = []
    const saved: string[] = []

    for (const f of machine) {
      try {
        const data = await readAsDataUrl(f)
        // designId is per FILE, and carries the line so two siblings of the same SKU get
        // distinct deliverables rather than one overwriting the other.
        const designId = `EMB-${item.line_id ?? item.sku ?? "line"}-${f.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`
        const r = await uploadDesignFile({
          designId, orderId: order.id, sku: item.sku ?? undefined, name: f.name, mime: f.type || undefined, data,
        })
        if (r?.error) throw new Error(r.error)
      } catch (e) { failed.push(`${f.name}${e instanceof Error ? ` (${e.message})` : ""}`) }
    }
    if (machine.length && machine.length > failed.length) {
      saved.push(`${machine.length - failed.length} machine file${machine.length - failed.length === 1 ? "" : "s"}`)
    }

    // Only the LAST image wins: order_designs is keyed per LINE
    // (order_id, coalesce(line_id, sku), kind), so a line holds ONE artwork and dropping
    // three would leave one row and two silently discarded uploads. Say so rather than
    // appearing to have taken them all. Passing line_id matters — without it the key falls
    // back to sku and two siblings of the same sku would overwrite each other.
    const artToSave = art.slice(-1)
    for (const f of artToSave) {
      try {
        const data = await readAsDataUrl(f)
        const r = await postOrderDesign(order.id, {
          sku: item.sku ?? "", line_id: item.line_id ?? undefined, data, name: f.name, kind: "raster",
        })
        if (r?.error) throw new Error(r.error)
        saved.push("artwork")
      } catch (e) { failed.push(`${f.name}${e instanceof Error ? ` (${e.message})` : ""}`) }
    }

    setBusy(false)
    const notes: string[] = []
    if (saved.length) notes.push(`Saved ${saved.join(" and ")}.`)
    if (art.length > 1) notes.push(`Only the last image was kept — a line holds one artwork.`)
    if (rejected.length) notes.push(`Ignored ${rejected.map((f) => f.name).join(", ")} — not artwork or a machine file.`)
    if (failed.length) setErr(`Couldn't upload: ${failed.join(", ")}`)
    if (notes.length) setDone(notes.join(" "))
    if (saved.length) onUploaded?.()
  }, [order.id, item, onUploaded, artwork])

  const artName = `${numOf(order)}-${item.sku ?? "artwork"}`

  /**
   * Put THIS line's artwork on every other line of the order.
   *
   * Ten shirts from one uploaded file is the common case, and doing it by hand is ten
   * drops into ten panels. The legacy tool had this (applyAll in eg-design-tools) and it
   * was lost in the port.
   *
   * One row PER LINE, because order_designs is keyed on
   * (order_id, coalesce(line_id, sku), kind) — writing once against the sku would collapse
   * identical-sku siblings into a single row and undo the very thing that key exists for.
   *
   * Counts what it would OVERWRITE and says so before doing it: applying to all is one
   * click and can silently replace artwork on lines nobody was looking at.
   */
  const applyToAll = useCallback(async () => {
    if (!artwork) return
    const others = (order.items ?? []).filter((it) =>
      (it.line_id ?? it.sku) !== (item.line_id ?? item.sku))
    if (!others.length) return
    const willReplace = others.filter((it) => !!designs?.[(it.line_id ?? it.sku) as string]?.data).length
    const ok = window.confirm(
      `Use this artwork on all ${others.length} other line${others.length === 1 ? "" : "s"}?` +
      (willReplace ? `\n\n${willReplace} of them already ${willReplace === 1 ? "has" : "have"} artwork and will be replaced.` : "")
    )
    if (!ok) return
    setBusy(true); setErr(null); setDone(null)
    const failed: string[] = []
    for (const it of others) {
      try {
        const r = await postOrderDesign(order.id, {
          sku: it.sku ?? "", line_id: it.line_id ?? undefined, data: artwork,
          name: `${artName}.png`, kind: "raster",
        })
        if (r?.error) throw new Error(r.error)
      } catch (e) { failed.push(`${it.sku ?? "line"}${e instanceof Error ? ` (${e.message})` : ""}`) }
    }
    setBusy(false)
    if (failed.length) setErr(`Couldn't apply to: ${failed.join(", ")}`)
    const done = others.length - failed.length
    if (done > 0) { setDone(`Applied to ${done} other line${done === 1 ? "" : "s"}.`); onUploaded?.() }
  }, [artwork, order, item, designs, artName, onUploaded])


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm: prefix matters. A bare max-w-3xl is 48rem at EVERY width, so on a window
          narrower than that the dialog overflowed its own container and the left edge —
          title included — was clipped behind a horizontal scrollbar. Prefixed, small
          screens keep the primitive's responsive default and only wide ones go to 3xl.
          The height cap plus scroll is the same problem vertically: this dialog carries an
          image, a drop zone and two panels, which is easily taller than a laptop. */}
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        // The WHOLE panel takes a drop, so there is no separate window to open and no
        // hunting for the right rectangle. The zone below stays as the discoverable
        // affordance — drop-anywhere alone is invisible to anyone who wasn't told.
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false) }}
        onDrop={(e) => { e.preventDefault(); setOver(false); void upload(Array.from(e.dataTransfer?.files ?? [])) }}
      >
        {over && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
            <span className="rounded-lg bg-background px-3 py-1.5 text-sm font-medium shadow-sm">
              Drop to attach — images become artwork, {MACHINE_EXT[0]}/{MACHINE_EXT[1]} become the machine file
            </span>
          </div>
        )}
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{item.name ?? item.sku ?? "Artwork"}</DialogTitle>
          <DialogDescription>
            {numOf(order)}
            {item.sku && <> · <span className="font-mono text-xs">{item.sku}</span></>}
            {item.print_type && <> · {item.print_type}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="space-y-2">
            <div className="flex items-center justify-center overflow-hidden rounded-xl border border-border bg-muted p-2">
              {artwork ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={artwork} alt={`Artwork for ${item.name ?? item.sku ?? "this line"}`}
                  className="max-h-[52vh] w-auto max-w-full object-contain" />
              ) : (
                <div className="flex h-56 w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <PenNib size={28} weight="duotone" className="opacity-50" />
                  <span className="text-sm">No artwork attached to this line.</span>
                </div>
              )}
            </div>
            {artwork && (
              // `download` with a filename — without it a signed storage URL opens in a tab
              // and a data-URL saves as "download", neither of which is usable later.
              <div className="flex flex-wrap items-center gap-2">
                <a href={artwork} download={artName}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent">
                  <DownloadSimple size={14} weight="bold" /> Download the customer&apos;s file
                </a>
                {/* Ten shirts, one uploaded file. Only offered when there IS another line,
                    so a single-line order doesn't carry a button that would do nothing. */}
                {(order.items ?? []).some((it) => (it.line_id ?? it.sku) !== (item.line_id ?? item.sku)) && (
                  <button type="button" onClick={() => void applyToAll()} disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50">
                    <CopySimple size={14} weight="bold" /> Use on all lines
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-xs font-medium">
                {/emb/i.test(item.print_type || "") ? "Machine file" : "Attach a file"}
              </span>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); void upload(Array.from(e.dataTransfer?.files ?? [])) }}
                className={"flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-6 text-center text-xs transition-colors " +
                  (over ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-accent")}
              >
                {busy ? <CircleNotch size={18} className="animate-spin" /> : <UploadSimple size={18} weight="duotone" />}
                <span>{busy ? "Uploading…" : "Drop a file here, or click to choose"}</span>
                {/* Both lists, because this one target now takes both — and a person needs
                    to know which of the two a file will become before they let go. */}
                <span className="text-[11px] text-muted-foreground/80">
                  Artwork: {ART_EXT.slice(0, 4).join(" · ")}
                </span>
                <span className="text-[11px] text-muted-foreground/80">
                  Machine: {MACHINE_EXT.slice(0, 5).join(" · ")}
                </span>
              </button>
              <input ref={fileRef} type="file" multiple accept={[...ART_EXT, ...MACHINE_EXT].join(",")} className="hidden"
                onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = "" }} />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                An image is saved as this line&apos;s artwork. A machine file counts the line
                as done and is billable — nobody is credited for it, because a payout follows
                a card someone claimed and this path has no card.
              </p>
            </div>

            {/* WHAT THIS LINE COSTS THE SELLER. Sits here because this is where someone is
                looking at the artwork, which is the only moment the judgement can honestly
                be made — "is this intricate?" is not answerable from a list row.
                STAFF ONLY: this sets what the seller is charged, so the person being
                charged must not be the one setting it. */}
            {isStaff && <div className="border-t border-border pt-3">
              <span className="mb-1.5 block text-xs font-medium">Design charge</span>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ["standard", "Standard", "We cut it — ordinary artwork"],
                  ["complex", "Complex", "We cut it — intricate. Quotes the seller first"],
                  ["supplied", "Their file", "Seller sent a machine file — check fee only"],
                ] as [DesignTier, string, string][]).map(([id, label, why]) => (
                  <button
                    key={id}
                    type="button"
                    title={why}
                    disabled={!!tierBusy || quote === "accepted"}
                    onClick={async () => {
                      setTierBusy(id); setErr(null); setDone(null)
                      try {
                        const r = await setDesignTier(order.id, {
                          tier: id, line_id: item.line_id, sku: item.line_id ? undefined : item.sku,
                        })
                        if (r?.error) throw new Error(r.error)
                        setTier(id)
                        setDone(r.quoted
                          // Says what has NOT happened yet. "Marked complex" would read as
                          // done, and the money hasn't moved and may never.
                          ? "Quoted to the seller. Nothing is charged until they accept, and they may decline."
                          : r.charged?.charged
                            ? `Charged $${Number(r.charged.charged).toFixed(2)} to the seller.`
                            : r.charged?.reason === "already-charged"
                              ? "Re-filed. This line was already charged, so nothing moved."
                              : r.charged?.reason === "no-fee-set"
                                ? "Filed. No fee is set for this tier yet, so nothing was charged."
                                : "Filed.")
                        onUploaded?.()
                      } catch (e) { setErr((e as Error).message) } finally { setTierBusy(null) }
                    }}
                    className={"rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50 " +
                      (tier === id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}
                  >
                    {tierBusy === id ? <CircleNotch size={12} className="mx-auto animate-spin" /> : label}
                  </button>
                ))}
              </div>
              {/* The quote's own state, in words. A "complex" chip alone can't distinguish
                  waiting on the seller from already paid from refused. */}
              {quote === "pending" && (
                <p className="mt-1.5 text-[11px] text-amber-700">Waiting on the seller to accept the quote — don&apos;t start work yet.</p>
              )}
              {quote === "declined" && (
                <p className="mt-1.5 text-[11px] text-rose-700">The seller declined. Cancel the line, or agree something else with them.</p>
              )}
              {quote === "accepted" && (
                <p className="mt-1.5 text-[11px] text-emerald-700">Accepted and paid — cleared to digitise. The tier is locked now.</p>
              )}
              {!tier && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">Not judged yet, so nothing has been charged for the design on this line.</p>
              )}
            </div>}

            {/* Also staff-only: sending a line to a designer spends factory time and opens
                a payable card. A seller asking for one goes through support, not a button
                that silently creates work. */}
            {isStaff && onSendToDesigner && (
              <div className="border-t border-border pt-3">
                {/* The alternative to uploading, not a step after it. Offering both without
                    saying they're alternatives is how a line ends up with a finished file
                    AND an open card nobody closes. */}
                <p className="mb-1.5 text-[11px] text-muted-foreground">Don&apos;t have the file yet?</p>
                <Button size="sm" variant="outline" onClick={onSendToDesigner} disabled={!artwork}>
                  <PaperPlaneTilt size={14} weight="bold" /> Send this line to a designer
                </Button>
                {!artwork && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Needs artwork first — there&apos;s nothing to digitise.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {done && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0" /> {done}
          </div>
        )}
        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
