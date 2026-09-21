"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { CircleNotch, PencilSimple, Check, X } from "@phosphor-icons/react"
import { getDesignFees, setDesignTier, type DesignFees, type DesignTier, type OrderDesignFee } from "@/lib/api"

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

/**
 * THE AMOUNT CELL OF A DESIGN-FEE ROW, and nothing else.
 *
 * This file used to export a whole panel: three buttons per line — Standard / Complex /
 * Their file, each with a price — sitting under the total. That was a classification control
 * wearing the clothes of a charge. It also duplicated a row that already existed a few lines
 * above it in the same card, where the design fee is listed beside Shipping and the volume
 * discount like every other cost on the order.
 *
 * So the panel is gone and this is what replaced it: the `<dd>` of that existing row, with a
 * pencil on it. The row keeps its label and the items it covers; only the figure gained an
 * editor.
 *
 * WHY THERE IS A SUGGESTION AT ALL. The old panel deliberately pre-selected nothing —
 * "picking a tier is a decision, not a confirmation of ours". The tier still is a decision,
 * and staff can still change it. But the server already KNOWS which fee applies in the
 * ordinary case: `tierOf()` in routes/orders.js reads an attached machine file as `supplied`
 * (the seller sent their own file, so we only check it) and artwork as `standard` (we digitise
 * it), and an explicit staff classification still overrules the inference. Showing a blank
 * where the files already answer the question is not neutrality, it is withholding.
 *
 * WHAT EDITING MEANS. A fee list cannot know that one particular file took twenty minutes to
 * clean up. Typing a figure overrides the list price for that job; clearing the box returns it
 * to the list price. The server charges — and quotes — whatever this resolves to, so the
 * number on screen is the number billed.
 *
 * STAFF ONLY, and the server agrees: the person being charged must not set the charge.
 */
/**
 * `show` PRINTS A DIFFERENT FIGURE FROM THE ONE IT EDITS, and that is deliberate.
 *
 * A fee covering three designs on three faces is ONE job at one price, and the summary lists
 * it under each face at that face's share. The share is what the reader needs; the JOB's price
 * is what staff set, because the server prices a job and charges it once. So the row can print
 * $2.00 while the editor opens on $6.00 — the button's own title says which, per §4's rule that
 * a control explains itself in its label or its title rather than in a sentence underneath.
 */
export function DesignFeeAmount({ orderId, fee, onChanged, show, whole }: {
  orderId: string
  fee: OrderDesignFee
  onChanged?: () => void
  /** The figure to PRINT. Defaults to the fee's own amount. */
  show?: number | null
  /** What the pencil is pricing, said in full, when `show` is only a part of it. */
  whole?: string
}) {
  const tl = useLabelT()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [list, setList] = useState<DesignFees | null>(null)

  useEffect(() => {
    if (!editing || list) return
    // Deferred: a straight setState in an effect body cascades a render, which this
    // codebase's lint rule rejects. Fetched on the first EDIT, not on mount — the list price
    // is only needed by someone about to depart from it.
    const t = setTimeout(() => { getDesignFees().then(setList).catch(() => setList(null)) }, 0)
    return () => clearTimeout(t)
  }, [editing, list])

  /** The tier's own list price, for the hint under the box. */
  const listed = list
    ? (fee.tier === "supplied" ? list.check : fee.tier === "complex" ? list.complex : list.standard)
    : null

  const save = async (amount: number | null) => {
    setBusy(true); setErr(null)
    try {
      const r = await setDesignTier(orderId, {
        // The tier travels with the price because the row IS a tier — the server needs to
        // know which kind of work is being priced, and a fee with no classification is a
        // number with no reason.
        tier: fee.tier as DesignTier,
        amount,
        line_id: fee.line_id || undefined,
        sku: fee.line_id ? undefined : (fee.sku || undefined),
      })
      if (r?.error) throw new Error(r.error)
      setEditing(false)
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't set that amount.")
    } finally { setBusy(false) }
  }

  const commit = useCallback(() => {
    const t = draft.trim()
    // An empty box CLEARS the override rather than charging zero — "I didn't mean to change
    // it" and "this job is free" are different instructions and must not share a gesture.
    void save(t === "" ? null : Number(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // Charged is settled: the seller has paid this, and editing it afterwards would rewrite a
  // record rather than price a job.
  const locked = fee.status === "charged"

  if (editing) {
    return (
      <dd className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">$</span>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit()
              if (e.key === "Escape") setEditing(false)
            }}
            inputMode="decimal"
            aria-label={`${fee.label} amount`}
            className="h-7 w-20 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <button type="button" aria-label={tl("designCharge", "Save this amount")} title={tl("designCharge", "Save — this is what gets charged")}
            disabled={busy} onClick={commit}
            className="rounded p-1 text-primary hover:bg-accent disabled:opacity-50">
            {busy ? <CircleNotch size={13} className="animate-spin" /> : <Check size={13} weight="bold" />}
          </button>
          <button type="button" aria-label={tl("designCharge", "Cancel")} onClick={() => setEditing(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X size={13} weight="bold" />
          </button>
        </span>
        {/* The baseline it is departing from, so an override is made against a known number
            rather than from memory. Only while editing — it is noise the rest of the time. */}
        {listed != null && <span className="text-xs font-normal text-muted-foreground">list {usd(listed)} · empty = list price</span>}
        {err && <span className="text-2xs font-normal text-destructive">{err}</span>}
      </dd>
    )
  }

  /**
   * THE FIGURE KEEPS THE COLUMN; THE PENCIL SITS PAST IT (owner, 2026-09-21: "put the pen but
   * don't push the numbers inside").
   *
   * This was a flex row — figure, then "edited", then the button — so every editable fee's
   * amount ended one glyph further left than the plain figures above and below it, and a
   * column of money that should read straight down stepped sideways at every fee.
   *
   * It is the same rule the reverse ↩ on the charged rows already follows: a mark belongs
   * PAST the end of the money column, not inside it. The button is taken out of flow and
   * lands in the gutter the summary's own padding provides, so it costs the figure no width
   * at all. `edited` moves to the LEFT of the amount for the same reason — it is an
   * annotation, and the number is what the eye is tracking.
   */
  return (
    <dd className="relative shrink-0 tabular-nums">
      {/* Said only when true. An unusual figure beside a familiar label otherwise reads as a
          pricing bug rather than as a decision somebody made. */}
      {fee.overridden && <span className="mr-1.5 text-2xs font-normal text-muted-foreground">edited</span>}
      {/* To Be Determined is a real answer, not a missing one: a complex fee is quoted, and
          no figure exists until somebody names one — which typing here does. */}
      {fee.amount == null
        ? <span className="italic text-muted-foreground">{tl("designCharge", "To Be Determined")}</span>
        : usd(show ?? fee.amount)}
      <button
        type="button"
        disabled={locked}
        title={locked
          ? tl("designCharge", "Already charged — this is settled")
          : whole || tl("designCharge", "Change what this costs")}
        aria-label={`Edit ${fee.label}`}
        onClick={() => { setEditing(true); setDraft(fee.amount == null ? "" : String(fee.amount)) }}
        className="absolute left-full top-1/2 ml-0.5 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <PencilSimple size={12} weight="bold" />
      </button>
    </dd>
  )
}
