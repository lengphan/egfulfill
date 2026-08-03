"use client"

import { useState } from "react"
import { CircleNotch, DownloadSimple } from "@phosphor-icons/react"
import { getOrderHistory, downloadDesignFile, designForLine, type AuditRow, type OrderRow, type OrderItem, type OrderDesign, type DesignFileRow } from "@/lib/api"
import { orderReadiness } from "@/lib/order-readiness"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { ActivityFeed } from "@/components/app/activity-feed"
import { forTag, EMPTY_HINT, DONE_NO_HISTORY, type TagId } from "@/components/app/tag-history"
import { useLabelT } from "@/lib/i18n"

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
  const tl = useLabelT()
  const [rows, setRows] = useState<AuditRow[] | null>(null)

  // History loads the FIRST time the panel opens — not on render, or a board of 50 rows
  // fires 150 requests for popovers nobody looked at.
  const loadHistory = () => {
    if (rows) return
    getOrderHistory(orderId).then((r) => setRows(r ?? [])).catch(() => setRows([]))
  }

  return (
    // Hover open/close is owned by the PRIMITIVE (Base UI's openOnHover), not by hand-rolled
    // timers. It tracks the real pointer across the trigger→panel gap and closes when the
    // pointer is over NEITHER element — so a fast or diagonal exit can't strand the panel
    // open, which is the failure the old two-timer + mouseleave scheme hit at random (a
    // skipped mouseleave left nothing to fire the close, and the "close others" registry
    // only helped when you moved onto ANOTHER tag, never into empty space). Click, tap and
    // keyboard still toggle it because the trigger is a button, so touch and keyboard users
    // are unaffected. One open at a time falls out for free: hovering shows one, and an
    // outside press / Escape dismisses per the primitive's own logic.
    <Popover onOpenChange={(v: boolean) => { if (v) loadHistory() }}>
      <PopoverTrigger
        title={title}
        openOnHover
        delay={120}
        closeDelay={200}
        // Tight on purpose: four of these plus the Stock chip share ONE table cell, and at
        // px-2.5/text-xs/semibold they were the loudest thing in the row — heavier than the
        // order number they sit beside, for what is supporting detail. Same words, same
        // colours, about a third less width.
        className={"eg-tap inline-flex shrink-0 items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors " + cls}
      >
        {tl("ui", label)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <div className="text-xs font-semibold">{tl("ui", label)}</div>
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
            <ActivityFeed rows={forTag(id, rows)} variant="bare" compact note={false} />
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
  // (A `compact` flag used to select a dot-instead-of-pill variant that Tag never actually
  // implemented — it took a prop it ignored. The one rendering is now the compact one.)
  //
  // The states and their sentences live in lib/order-readiness.ts — the Prep filter
  // reads the SAME function, so a chip and the filter that hides its row can't disagree.
  const ready = orderReadiness(order, { items, designs, files })
  const { withArt, buyerUploads } = ready

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
      href: designForLine(designs, it)?.data,
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
    <span className={"inline-flex items-center gap-1 " + (className ?? "")}>
      {/* Names are fixed. Colour carries progress; the words live in each popover. */}
      <Tag id="label" orderId={order.id} label="Label" state={ready.label.state}
           title={ready.label.status} status={ready.label.status} files={labelFile} />
      <Tag id="scan" orderId={order.id} label="Scan" state={ready.scan.state}
           title={ready.scan.status} status={ready.scan.status} files={labelFile} />
      <Tag id="design" orderId={order.id} label="Design" state={ready.design.state}
           title={ready.design.status} status={ready.design.status} files={designFiles} />
    </span>
  )
}
