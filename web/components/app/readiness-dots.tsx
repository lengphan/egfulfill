"use client"

import { useState } from "react"
import { CircleNotch, DownloadSimple } from "@phosphor-icons/react"
import { getOrderHistory, downloadDesignFile, type AuditRow, type OrderRow, type OrderItem, type OrderDesign, type DesignFileRow } from "@/lib/api"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { forTag, sayAction, EMPTY_HINT, DONE_NO_HISTORY, type TagId } from "@/components/app/tag-history"

/**
 * Three tags, always the same three, always in the same place: LABEL · SCAN · DESIGN.
 *
 * Earlier versions rendered only what was WRONG, so the tags moved around and the count
 * changed row to row — you couldn't scan a column, and four amber chips read as four
 * alarms when they meant "not done yet". A production board is scanned vertically; the
 * shape has to be constant for that to work.
 *
 * Grey = not done. Tinted = done. Colour is the app's accent rather than amber, because
 * amber already means "something is wrong" everywhere else (short stock, past due) — a
 * colour that means both "good" and "problem" means neither.
 *
 * The NAMES never change — always "Label", "Design", "Scan". They used to rewrite
 * themselves ("Design sent", "Design approved", "Pre-scanned"), which broke the one
 * property that makes a column scannable: a chip whose text moves can't be compared down
 * a list, and three tags reading three different words per row is four alarms again.
 * Progress is carried by COLOUR, and the words that used to be in the name now live in
 * the popover, next to the history and the files that back them up.
 */

type State = "todo" | "doing" | "done"

/** A file reachable from a tag. `href` opens directly; `designId` goes through the API so
 *  the paywall and the seller/staff checks still apply. */
export type TagFile = { key: string; name: string; note?: string; href?: string; designId?: string }

function Tag({ id, label, state, title, orderId, status, files }: {
  id: TagId; label: string; state: State; title?: string; orderId: string
  /** The sentence that used to be baked into the tag's name. */
  status?: string
  files?: TagFile[]
}) {
  // Three states, three colours — grey → amber → violet. "Doing" was a paler violet,
  // which meant the difference between in-progress and done was a shade of the same hue:
  // legible one row at a time, invisible down a column, which is how a board is actually
  // read. A distinct hue makes "sent but not back yet" scannable.
  //
  // Amber is used here deliberately despite meaning "problem" elsewhere in the app. In
  // THIS column it isn't an alarm — the tags are a progress track, and a middle state is
  // exactly what amber reads as anywhere else it appears on a timeline.
  const cls =
    state === "done"
      ? "bg-primary/10 text-primary hover:bg-primary/15"
      : state === "doing"
        ? "bg-amber-100 text-amber-800 hover:bg-amber-200/70"
        : "bg-muted text-muted-foreground/70 hover:bg-muted/80"
  const [rows, setRows] = useState<AuditRow[] | null>(null)

  // History loads on OPEN, not on render — a board of 50 rows would otherwise fire 150
  // requests for popovers nobody opened.
  const load = (open: boolean) => {
    if (!open || rows) return
    getOrderHistory(orderId).then((r) => setRows(r ?? [])).catch(() => setRows([]))
  }

  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger
        title={title}
        className={"eg-tap rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " + cls}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <div className="text-xs font-semibold">{label}</div>
          {/* Where "Design sent" / "Pre-scanned" went. Saying it here keeps the chip's
              text stable while still answering "what state is this in?" in words. */}
          {status && <div className="mt-0.5 text-[11px] text-muted-foreground">{status}</div>}
        </div>

        {/* Files first: the commonest reason to open a tag is to GET the thing, and making
            that the second stop after a history list is a click tax on the main job. */}
        {files && files.length > 0 && (
          <div className="border-b border-border p-1">
            {files.map((f) => <TagFileRow key={f.key} file={f} />)}
          </div>
        )}

        <div className="max-h-56 overflow-y-auto p-1">
          {rows === null ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>
          ) : forTag(id, rows).length === 0 ? (
            /* The tag's STATE is the truth — it reads what the order actually is. History
               is supporting evidence and can legitimately be missing (an action taken
               before auditing covered it, or by a path that doesn't audit). So the empty
               message FOLLOWS the tag: a done tag never says "not done yet", which is the
               contradiction that teaches people to distrust the board. */
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {state === "todo" ? EMPTY_HINT[id] : DONE_NO_HISTORY[id]}
            </div>
          ) : (
            forTag(id, rows).map((r) => (
              <div key={String(r.id)} className="rounded px-2 py-1.5 hover:bg-accent">
                <div className="text-xs font-medium">{sayAction(r.action)}</div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(r.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {r.actor_email ? ` · ${r.actor_email}` : r.actor_role ? ` · ${r.actor_role}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One downloadable thing inside a tag.
 *
 * A `designId` is fetched through /api/design_files/:id rather than linked directly,
 * because that route is where the paywall and the seller/staff checks live — a raw URL
 * would hand out bytes the caller may not have bought. `href` is for files that are
 * already public to whoever can see the order (the carrier's label PDF, artwork the board
 * is rendering anyway).
 */
function TagFileRow({ file }: { file: TagFile }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const open = async () => {
    if (file.href) { window.open(file.href, "_blank", "noopener"); return }
    if (!file.designId) return
    setBusy(true); setErr(null)
    try {
      const r = await downloadDesignFile(file.designId)
      const url = r.url || r.data
      if (!url) throw new Error("No file returned.")
      window.open(url, "_blank", "noopener")
    } catch (e) {
      // 402 is the paywall, not a fault — say which, rather than a generic failure.
      const m = e instanceof Error ? e.message : "Couldn't open that file."
      setErr(/402|purchase|paid/i.test(m) ? "Not purchased yet." : m)
    } finally { setBusy(false) }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="eg-tap flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-60"
    >
      {busy
        ? <CircleNotch size={13} className="shrink-0 animate-spin text-muted-foreground" />
        : <DownloadSimple size={13} weight="bold" className="shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{file.name}</span>
        {(err || file.note) && (
          <span className={"block truncate text-[11px] " + (err ? "text-destructive" : "text-muted-foreground")}>
            {err ?? file.note}
          </span>
        )}
      </span>
    </button>
  )
}

export function ReadinessStrip({ order, items, designs, files, className }: {
  order: OrderRow
  items?: OrderItem[]
  /** Placed artwork keyed by sku — presence means a design exists to work from. */
  designs?: Record<string, OrderDesign>
  /** Machine files produced for this order — presence means a design was approved. */
  files?: DesignFileRow[]
  className?: string
}) {
  const stage = String(order.factory_status ?? "").toLowerCase()

  // A label needs an address, so its absence covers both — the tooltip names the reason
  // rather than spending a second tag on it.
  const hasLabel = !!order.tracking
  const addr = (order.address ?? {}) as Record<string, string>
  const hasAddr = !!((addr.street || addr.first_line || addr.line1 || addr.address1) && (addr.zip || addr.postal_code))
  const labelTitle = hasLabel
    ? `Label ${order.label_printed_at ? "printed" : "created"} · ${order.tracking}`
    : hasAddr ? "No label bought yet" : "No address yet — a label can't be created without one"

  // SCAN = the label was pre-scanned at dispatch, which is what starts the carrier /
  // marketplace clock. Read from label_scanned_at — the actual recorded fact — rather
  // than inferred from the pipeline stage, which was only ever a proxy and went "done"
  // for orders whose label had never been scanned at all.
  //
  // NO stage fallback. Inferring "scanned" from working/printed/shipped marked orders
  // done that had never been scanned at all — this component's own rule is that a done
  // tag must never contradict itself, because that's what teaches people to distrust the
  // board. An order with no recorded pre-scan reads as not pre-scanned, which is simply
  // true: we have no evidence it was. Orders predating this field read the same way, and
  // that's honest rather than flattering.
  const preScanned = !!order.label_scanned_at
  // Sent to the partner's queue but not yet scanned back — previously indistinguishable
  // from "nothing has happened", which is the state you most want to tell apart when
  // chasing a parcel.
  // AMBER = queued to be scanned, by either route. Two ways in, and they read
  // differently, because "we haven't got to it" and "someone else has it" are different
  // problems with different people to chase.
  const withPartner = !!(order as { dispatch_pdf_id?: string | null }).dispatch_pdf_id
  const queuedHere = String(order.factory_status || "") === "awaiting_scan"
  const scanPending = !preScanned && (withPartner || queuedHere)

  const scanTitle = preScanned
    // VIOLET the moment a scan is actually recorded, whoever did it. The route is a
    // detail; the fact is that the buyer's tracking has started.
    ? `Scanned ${new Date(order.label_scanned_at as string).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${
        (order as { scanned_via?: string | null }).scanned_via === "partner" ? " by the dispatch partner" :
        (order as { scanned_via?: string | null }).scanned_via === "in-house" ? " here" : ""
      } — tracking is live for the buyer. The parcel may still be in production.`
    // AMBER covers both queued cases, and stays amber while the partner holds it. Their
    // receiving it is not their scanning it — the buyer's tracking hasn't moved until
    // they actually scan, so the colour mustn't move either. Where it is goes in the
    // words, and the history below records the hand-off.
    : scanPending
      ? withPartner
        ? "With the dispatch partner — in their queue, not scanned yet."
        : "On the dispatch board, waiting to be scanned."
      : order.tracking
        ? "Label exists but hasn't been scanned — the buyer's tracking has not started."
        : "No label yet, so nothing to scan."

  const list = items ?? order.items ?? []
  const decorated = list.filter((it) => String(it.print_type || "").trim())
  // ONLY artwork actually attached to the order counts as a design.
  //
  // This used to also count `it.design_src`, which is written by marketplace sync from
  // the BUYER's personalization upload (etsy.js reads it off the transaction variations).
  // Nobody attached it and nobody sent it anywhere, so an ordinary Etsy order arrived with
  // the tag already reading "Design sent" and a tooltip claiming it was with a designer —
  // while the order detail, which reads order_designs, correctly showed nothing. The tag
  // was the thing lying. A buyer upload is still real evidence, so it moves into the
  // tag's file list below rather than being thrown away.
  const withArt = decorated.filter((it) => it.sku && designs?.[it.sku]?.data)
  const buyerUploads = list.filter((it) => it.design_src)
  const approved = (files ?? []).some((f) => f.kind === "pes" || f.kind === "emb")

  const designState: State = approved
    ? "done"
    : decorated.length > 0 && withArt.length === decorated.length
      ? "doing"
      : "todo"
  const designStatus = approved
    ? "Approved — a machine file has been produced for this order."
    : designState === "doing"
      ? "Artwork attached and with a designer — no machine file yet."
      : decorated.length === 0
        ? "No decorated lines on this order."
        : `${decorated.length - withArt.length} of ${decorated.length} decorated lines still need artwork.`
  const designTitle = designStatus

  // The label PDF hangs off both Label and Scan: it's the Label tag's own artefact, and
  // the scan is an event ABOUT that label, so someone checking a scan wants the same sheet
  // without hunting for another chip.
  const labelFile: TagFile[] = order.tracking_label_url
    ? [{ key: "label", name: "Shipping label (PDF)", note: order.tracking ? `${order.carrier || "Carrier"} ${order.tracking}` : undefined, href: order.tracking_label_url }]
    : []

  const designFilesAll: TagFile[] = [
    // Artwork the board is already rendering — same source the item avatars composite.
    ...withArt.map((it) => ({
      key: `art-${it.line_id ?? it.sku}`,
      name: `Artwork — ${it.name || it.sku}`,
      href: designs?.[it.sku as string]?.data,
    })),
    // The buyer's own upload. Labelled as theirs so nobody mistakes it for a production
    // file: it's what they sent, not what we made.
    ...buyerUploads.map((it) => ({
      key: `buyer-${it.line_id ?? it.sku}`,
      name: `Buyer upload — ${it.name || it.sku}`,
      note: "Sent by the buyer, not a production file",
      href: it.design_src as string,
    })),
    // Machine files go through the API so the paywall still applies.
    ...(files ?? []).map((f) => ({
      key: `file-${f.designId}`,
      name: f.name || `Machine file (${f.kind || "file"})`,
      note: f.paid === false && (f.price ?? 0) > 0 ? "Not purchased yet" : undefined,
      designId: f.designId,
    })),
  ]
  // Drop anything with nothing behind it — a row that opens nothing is worse than absent.
  const designFiles = designFilesAll.filter((f) => f.href || f.designId)

  return (
    <span className={"inline-flex items-center gap-1.5 " + (className ?? "")}>
      {/* Names are fixed. Colour carries progress; the words live in each popover. */}
      <Tag id="label" orderId={order.id} label="Label" state={hasLabel ? "done" : "todo"}
           title={labelTitle} status={labelTitle} files={labelFile} />
      <Tag id="scan" orderId={order.id} label="Scan" state={preScanned ? "done" : scanPending ? "doing" : "todo"}
           title={scanTitle} status={scanTitle} files={labelFile} />
      <Tag id="design" orderId={order.id} label="Design" state={designState}
           title={designTitle} status={designStatus} files={designFiles} />
    </span>
  )
}
