"use client"

import { useCallback, useEffect, useState } from "react"
import { EnvelopeSimple, CircleNotch, Warning, Plus, PaperPlaneTilt, Trash, PencilSimple } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  getBroadcasts, previewBroadcastAudience, createBroadcast, updateBroadcast, deleteBroadcast,
  sendBroadcast, type Broadcast, type BroadcastAudience,
} from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"

/**
 * Spell a count out.
 *
 * The confirm step shows both "1,204" and "one thousand two hundred and four" because they
 * fail differently: a digit slipped by a stray keystroke reads as a plausible number, while
 * the same mistake in words is glaring. This is the last screen before mail that cannot be
 * recalled, so it is worth reading twice.
 */
function inWords(n: number): string {
  if (n === 0) return "nobody"
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
  const under100 = (x: number): string =>
    x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? "-" + ones[x % 10] : "")
  const under1000 = (x: number): string =>
    x < 100 ? under100(x)
      : ones[Math.floor(x / 100)] + " hundred" + (x % 100 ? " and " + under100(x % 100) : "")
  if (n < 1000) return under1000(n)
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000)
    return under1000(th) + " thousand" + (n % 1000 ? " " + under1000(n % 1000) : "")
  }
  return n.toLocaleString("en-US") // past a million, words stop helping
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  sending: { label: "Sending", cls: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  sent: { label: "Sent", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
}

/** The audience, said as a sentence rather than as a filter object. */
function audienceLabel(a: BroadcastAudience | null | undefined): string {
  const aud = a ?? {}
  if (Array.isArray(aud.sellerIds) && aud.sellerIds.length) return `${aud.sellerIds.length} hand-picked`
  const bits: string[] = []
  if (aud.hasOrders === true) bits.push("with orders")
  if (aud.hasOrders === false) bits.push("never ordered")
  if (aud.includeInactive) bits.push("incl. deactivated")
  return bits.length ? `Sellers ${bits.join(", ")}` : "All sellers"
}

const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"

const TEXTAREA_CLS =
  "flex min-h-40 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none " +
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
  "disabled:cursor-not-allowed disabled:opacity-50"

/**
 * Seller email broadcasts.
 *
 * Anyone on the team can draft one; only an admin can send. That split is deliberate and
 * mirrors the backend — drafting is reversible, and a send to the whole seller base is the
 * least reversible thing in the product.
 */
export function BroadcastsView() {
  const [rows, setRows] = useState<Broadcast[]>([])
  const [mailOk, setMailOk] = useState(true)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [role, setRole] = useState("")

  // Editor
  const [editing, setEditing] = useState<Broadcast | null>(null)
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [aud, setAud] = useState<BroadcastAudience>({})
  const [saving, setSaving] = useState(false)

  // Send confirmation. Held separately from the editor because it asks a different
  // question — not "is this right?" but "are you sure?".
  const [confirming, setConfirming] = useState<Broadcast | null>(null)
  const [count, setCount] = useState<{ count: number; optedOut: number; sample: string[] } | null>(null)
  const [counting, setCounting] = useState(false)
  const [sending, setSending] = useState(false)

  const load = useCallback(() => {
    if (!getToken()) { setLoading(false); return }
    getBroadcasts()
      .then((r) => { setRows(r.broadcasts ?? []); setMailOk(r.mailConfigured) })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load broadcasts"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const id = setTimeout(() => { setRole(getUser()?.role || ""); load() }, 0)
    return () => clearTimeout(id)
  }, [load])

  // While anything is mid-send the counters move server-side, so poll — but only then.
  // A board that polls forever is a board that keeps a laptop awake for nothing.
  useEffect(() => {
    if (!rows.some((r) => r.status === "sending")) return
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [rows, load])

  const isAdmin = role === "admin"

  const openEditor = (b: Broadcast | null) => {
    setEditing(b)
    setSubject(b?.subject ?? "")
    setBody(b?.body ?? "")
    setAud(b?.audience ?? {})
    setErr(null)
    setOpen(true)
  }

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      if (editing) await updateBroadcast(editing.id, { subject, body, audience: aud })
      else await createBroadcast({ subject, body, audience: aud })
      setOpen(false); load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save")
    } finally { setSaving(false) }
  }

  const remove = async (b: Broadcast) => {
    try { await deleteBroadcast(b.id); load() }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not delete") }
  }

  // Resolve the audience for the confirm step. This is a live count against the same
  // resolver the send uses — NOT a number stored on the draft, which would be stale the
  // moment anyone signed up or unsubscribed.
  const startSend = async (b: Broadcast) => {
    setConfirming(b); setCount(null); setCounting(true); setErr(null)
    try { setCount(await previewBroadcastAudience(b.audience ?? {})) }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not count the audience") }
    finally { setCounting(false) }
  }

  const doSend = async () => {
    if (!confirming) return
    setSending(true); setErr(null)
    try { await sendBroadcast(confirming.id); setConfirming(null); load() }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not send") }
    finally { setSending(false) }
  }

  if (loading) {
    return (
      <SectionCard title="Broadcasts">
        <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
      </SectionCard>
    )
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Broadcasts"
        description="Email every seller, or a filtered set. Separate from Campaigns, which is ad spend."
        actions={<Button size="sm" onClick={() => openEditor(null)}><Plus size={14} weight="bold" />New broadcast</Button>}
      >
        {!mailOk && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
            No mail transport is configured, so nothing can be sent. Set <code>BREVO_API_KEY</code> on the server.
          </div>
        )}
        {err && <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{err}</div>}

        {rows.length === 0 ? (
          <div className="py-14 text-center">
            <EnvelopeSimple size={26} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No broadcasts yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Nothing has been sent — this isn&apos;t a load failure.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 pr-3 font-medium">Audience</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">Sent</th>
                  <th className="py-2 pr-3 font-medium">Sent by</th>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((b) => {
                  const st = STATUS[b.status] ?? STATUS.draft
                  return (
                    <tr key={String(b.id)} className="align-top">
                      <td className="max-w-72 py-2.5 pr-3">
                        <div className="truncate font-medium">{b.subject}</div>
                        <div className="truncate text-xs text-muted-foreground">{b.body}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">{audienceLabel(b.audience)}</td>
                      <td className="py-2.5 pr-3">
                        <Badge className={st.cls}>{st.label}</Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {/* A draft has no count and says so, rather than showing 0 — which
                            would read as "sent to nobody". */}
                        {b.status === "draft" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <span>{b.sent_count.toLocaleString("en-US")}</span>
                            <span className="text-muted-foreground">{" / "}{(b.recipient_count ?? 0).toLocaleString("en-US")}</span>
                            {b.failed_count > 0 && (
                              <div className="text-xs text-red-600 dark:text-red-400">{b.failed_count} failed</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">{b.created_by_name || b.created_by || "—"}</td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">{dt(b.sent_at ?? b.created_at)}</td>
                      <td className="py-2.5">
                        {b.status === "draft" && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openEditor(b)} aria-label="Edit"><PencilSimple size={14} /></Button>
                            <Button size="sm" variant="ghost" onClick={() => remove(b)} aria-label="Delete"><Trash size={14} /></Button>
                            {isAdmin && (
                              <Button size="sm" disabled={!mailOk} onClick={() => startSend(b)}>
                                <PaperPlaneTilt size={14} />Send
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isAdmin && rows.some((b) => b.status === "draft") && (
          <p className="mt-3 text-xs text-muted-foreground">
            Drafts are open to the team; sending is admin-only. There is no unsend.
          </p>
        )}
      </SectionCard>

      {/* ── Editor ────────────────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit draft" : "New broadcast"}</DialogTitle>
            <DialogDescription>
              Written as plain text. An unsubscribe footer is added automatically — it is required, so it is not optional here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Subject</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's new this month" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Body</label>
              <textarea className={TEXTAREA_CLS} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder={"Blank lines start a new paragraph.\n\nSellers are greeted by name automatically."} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Audience</label>
              <div className="space-y-1.5 rounded-lg border border-border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="aud" className="accent-primary" checked={aud.hasOrders === undefined}
                    onChange={() => setAud((p) => ({ ...p, hasOrders: undefined }))} />
                  All sellers
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="aud" className="accent-primary" checked={aud.hasOrders === true}
                    onChange={() => setAud((p) => ({ ...p, hasOrders: true }))} />
                  Only sellers who have ordered
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="aud" className="accent-primary" checked={aud.hasOrders === false}
                    onChange={() => setAud((p) => ({ ...p, hasOrders: false }))} />
                  Only sellers who never have
                </label>
                <label className="mt-1 flex items-center gap-2 border-t border-border pt-2 text-sm">
                  <input type="checkbox" className="accent-primary" checked={!!aud.includeInactive}
                    onChange={(e) => setAud((p) => ({ ...p, includeInactive: e.target.checked }))} />
                  Include deactivated accounts
                </label>
                <p className="pt-1 text-xs text-muted-foreground">
                  Anyone who has unsubscribed is excluded automatically, and the list is resolved when you
                  send — not now — so an unsubscribe between today and then is still honoured.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !subject.trim() || !body.trim()}>
              {saving ? <CircleNotch size={14} className="animate-spin" /> : null}Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Send confirmation ─────────────────────────────────────────────── */}
      <Dialog open={!!confirming} onOpenChange={(v) => !v && setConfirming(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send this broadcast?</DialogTitle>
            <DialogDescription>There is no unsend. Read the number below before you confirm.</DialogDescription>
          </DialogHeader>
          {counting ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
          ) : count ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3.5">
                <p className="text-sm">
                  This will email{" "}
                  <strong>{inWords(count.count)}</strong>{" "}
                  seller{count.count === 1 ? "" : "s"}{" "}
                  <span className="text-muted-foreground">({count.count.toLocaleString("en-US")})</span>.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{audienceLabel(confirming?.audience)}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {count.optedOut > 0
                  ? `${count.optedOut.toLocaleString("en-US")} seller${count.optedOut === 1 ? " has" : "s have"} unsubscribed and ${count.optedOut === 1 ? "is" : "are"} excluded.`
                  : "No seller has unsubscribed yet."}
                {count.sample.length > 0 && <> First few: {count.sample.join(", ")}.</>}
              </p>
              <p className="text-xs text-muted-foreground">
                Subject: <strong className="text-foreground">{confirming?.subject}</strong>
              </p>
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">Could not resolve the audience.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
            <Button onClick={doSend} disabled={sending || counting || !count || count.count === 0}>
              {sending ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} />}
              {count ? `Send to ${count.count.toLocaleString("en-US")}` : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
