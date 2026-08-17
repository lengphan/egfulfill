"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, ChatText, Trash, Handshake } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupplierMessages, addSupplierMessage, deleteSupplierMessage, saveSourcing,
         type SourcingRow, type SupplierMessage } from "@/lib/api"

/**
 * WHAT WAS AGREED, AND WHERE THEY SAID IT.
 *
 * Two halves of the same question, side by side on purpose: the terms are the summary, and
 * the pasted exchange is the evidence. Split across two screens they drift, and the summary
 * is the half that gets trusted.
 *
 * Both halves already had database columns and nothing read them — `sample_cost`,
 * `payment_terms`, `terms_confirmed_at` and the whole `supplier_messages` table shipped
 * with the sourcing tab and stayed empty. So the terms lived in a chat window and got
 * re-asked, which is how a supplier learns you aren't keeping track.
 *
 * The log is PASTED, not synced. Alibaba's open API exposes no messages at all (probed
 * 2026-08-10) and their product search carries no seller identity, so there is no thread to
 * read and nothing to link to. Text is kept verbatim rather than parsed: what gets pasted
 * is whatever the supplier typed, in whatever language, and a parser guessing at a price
 * would be confidently wrong about the one number this exists to remember.
 */

/** How stale is a confirmation? A quote nobody has re-checked since March is not a quote,
 *  and the number of days is the honest way to say so — "confirmed" with no date reads as
 *  current forever. */
const staleness = (iso?: string | null) => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  return { days, label: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) }
}

export function SupplierTerms({ row, onSaved }: { row: SourcingRow; onSaved?: () => void }) {
  const [sampleCost, setSampleCost] = useState("")
  const [terms, setTerms] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [msgs, setMsgs] = useState<SupplierMessage[] | null>(null)
  const [body, setBody] = useState("")
  const [saidAt, setSaidAt] = useState("")
  const [direction, setDirection] = useState<"them" | "us">("them")
  const [posting, setPosting] = useState(false)

  // Remounted per row by the caller (key=row.id), so this seeds once rather than fighting
  // an edit in progress every time the parent re-renders.
  useEffect(() => {
    const t = setTimeout(() => {
      setSampleCost(row.sampleCost != null ? String(row.sampleCost) : "")
      setTerms(row.paymentTerms ?? "")
    }, 0)
    return () => clearTimeout(t)
  }, [row.id, row.sampleCost, row.paymentTerms])

  const loadMsgs = useCallback(() => {
    getSupplierMessages(row.id)
      .then((r) => setMsgs(r.items ?? []))
      .catch(() => setMsgs([]))
  }, [row.id])
  useEffect(() => { const t = setTimeout(loadMsgs, 0); return () => clearTimeout(t) }, [loadMsgs])

  /** `confirm` moves terms_confirmed_at to today. Saving a typo shouldn't claim the
   *  supplier re-confirmed anything, so it is a separate, explicit button. */
  const save = async (confirmTerms: boolean) => {
    setSaving(true); setErr(null)
    try {
      const r = await saveSourcing({
        ...row,
        sampleCost: sampleCost.trim() === "" ? null : Number(sampleCost),
        paymentTerms: terms.trim() || null,
        confirmTerms,
      })
      if (r.error) throw new Error(r.error)
      onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save those terms.")
    } finally { setSaving(false) }
  }

  const post = async () => {
    if (!body.trim()) return
    setPosting(true); setErr(null)
    try {
      const r = await addSupplierMessage(row.id, {
        body: body.trim(),
        saidAt: saidAt || undefined,
        direction,
      })
      if (r.error) throw new Error(r.error)
      setBody(""); setSaidAt("")
      loadMsgs()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that.")
    } finally { setPosting(false) }
  }

  const drop = async (m: SupplierMessage) => {
    setMsgs((p) => (p ?? []).filter((x) => x.id !== m.id))   // optimistic
    const r = await deleteSupplierMessage(row.id, m.id).catch(() => null)
    if (!r || r.error) loadMsgs()
  }

  const stale = staleness(row.termsConfirmedAt)

  return (
    <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
      {/* ── AGREED TERMS ───────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <Handshake size={14} weight="bold" className="text-primary" /> Agreed terms
        </h3>
        {/* Unit cost, MOQ and lead time are columns on the row above and stay the single
            source for those. These are the two that had nowhere to live. */}
        <p className="text-2xs text-muted-foreground">
          What they committed to, as opposed to what the listing says. Unit price, MOQ and lead
          time stay on the row above.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">
            <span className="text-muted-foreground">Sample cost</span>
            <Input className="mt-1 h-8" inputMode="decimal" placeholder="—"
                   value={sampleCost} onChange={(e) => setSampleCost(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Payment terms</span>
            <Input className="mt-1 h-8" placeholder="30/70 T/T"
                   value={terms} onChange={(e) => setTerms(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void save(false)} disabled={saving}>
            {saving ? <CircleNotch size={13} className="animate-spin" /> : null} Save
          </Button>
          <Button size="sm" onClick={() => void save(true)} disabled={saving}>
            Save + mark confirmed today
          </Button>
        </div>
        {/* An age, not just a date. "Confirmed 12 Mar" reads as settled; "148 days ago"
            reads as something to re-ask, which is the decision this is for. */}
        <p className="text-2xs text-muted-foreground">
          {stale
            ? <>Last confirmed {stale.label} — <span className={stale.days > 90 ? "font-medium text-amber-600" : ""}>
                {stale.days === 0 ? "today" : `${stale.days} day${stale.days === 1 ? "" : "s"} ago`}
              </span>{stale.days > 90 ? ". Worth re-asking before you commit to a buy." : ""}</>
            : "Never confirmed — these are quoted figures, not agreed ones."}
        </p>
        {err && <p className="text-2xs text-destructive">{err}</p>}
      </div>

      {/* ── THE CONVERSATION ───────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <ChatText size={14} weight="bold" className="text-primary" /> What they said
        </h3>
        <p className="text-2xs text-muted-foreground">
          Paste it. Alibaba&apos;s API exposes no messages, so this is the only copy — kept
          word for word rather than summarised.
        </p>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Paste what they wrote — price, MOQ, lead time, whatever they committed to."
          className="w-full rounded-xl border border-border bg-card p-2 text-xs outline-none focus:border-primary"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select value={direction} onChange={(e) => setDirection(e.target.value as "them" | "us")}
                  className="eg-select h-8 rounded-md border border-border bg-card px-2 text-xs">
            <option value="them">They said</option>
            <option value="us">We said</option>
          </select>
          {/* Their date, not the paste date. A March agreement filed in August is still a
              March agreement, and dating it today is how a stale price looks current. */}
          <Input type="date" value={saidAt} onChange={(e) => setSaidAt(e.target.value)}
                 className="h-8 w-40 text-xs" title="The day it was said — defaults to today" />
          <Button size="sm" onClick={post} disabled={posting || !body.trim()}>
            {posting ? <CircleNotch size={13} className="animate-spin" /> : null} Save
          </Button>
        </div>

        {msgs === null ? (
          <div className="py-3 text-center text-2xs text-muted-foreground">
            <CircleNotch size={13} className="mr-1 inline animate-spin" /> Loading…
          </div>
        ) : msgs.length === 0 ? (
          <p className="py-3 text-center text-2xs text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="max-h-56 space-y-1.5 overflow-y-auto">
            {msgs.map((m) => (
              <li key={m.id} className="group rounded-xl border border-border bg-card p-2">
                <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                  <span className={"rounded px-1.5 py-0.5 font-medium " + (m.direction === "us"
                    ? "bg-primary/10 text-primary" : "bg-muted")}>
                    {m.direction === "us" ? "We said" : "They said"}
                  </span>
                  <span>{m.saidAt ?? "no date"}</span>
                  <button onClick={() => void drop(m)}
                          className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                          title="Delete this entry">
                    <Trash size={12} />
                  </button>
                </div>
                {/* whitespace-pre-wrap: a pasted chat log is lines, and reflowing it into a
                    paragraph loses which price went with which quantity. */}
                <p className="mt-1 whitespace-pre-wrap break-words text-xs">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
