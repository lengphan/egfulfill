"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { EnvelopeSimple, CircleNotch, Warning, Plus, PaperPlaneTilt, Trash, PencilSimple, X } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  getBroadcasts, previewBroadcastAudience, createBroadcast, updateBroadcast, deleteBroadcast,
  sendBroadcast, getEmailBranding, setEmailBranding, uploadHeroImage, getBroadcastDeliveries,
  type Broadcast, type BroadcastAudience, type BroadcastChannel, type BroadcastRecipient,
  type BroadcastDelivery, type EmailBranding,
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
/** Does this broadcast send mail at all? Rows saved before the channel column did. */
const mailsOf = (b: Broadcast) => !b.channels?.length || b.channels.includes("email")

/** "Email + in-app", "In-app only" — said in the reader's words, not the column's. */
function channelLabel(ch: BroadcastChannel[]): string {
  const e = ch.includes("email"), i = ch.includes("inapp")
  if (e && i) return "Email + in-app"
  if (i) return "In-app only"
  return "Email only"
}

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

const EMAIL_PRESETS: { id: string; label: string; hint: string }[] = [
  { id: "branded", label: "Branded", hint: "Accent rule across the top + wordmark" },
  { id: "minimal", label: "Minimal", hint: "No accent bar — clean header" },
  { id: "bold", label: "Bold", hint: "Solid accent header block" },
]

/**
 * Global email branding — one logo / accent / footer for EVERY broadcast, plus a preset.
 *
 * Deliberately light: a preset only changes the header chrome and the accent rule; the body
 * and the required unsubscribe footer never change. Admin-only (the server rejects a
 * non-admin write anyway). The logo reuses the hero-image upload — any public image URL.
 */
function EmailBrandingCard() {
  const [open, setOpen] = useState(false)
  const [b, setB] = useState<EmailBranding | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = setTimeout(() => {
      getEmailBranding()
        .then((r) => setB(r.branding))
        .catch(() => setB({ preset: "branded", accent: "#604cfa", logoUrl: "", heading: "egful", footerNote: "" }))
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const patch = (p: Partial<EmailBranding>) => setB((prev) => (prev ? { ...prev, ...p } : prev))

  const onLogo = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) { setErr("The logo must be an image."); return }
    if (file.size > 4 * 1024 * 1024) { setErr("Logo is over 4MB — export a smaller PNG."); return }
    setUploading(true); setErr(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("Couldn't read the file")); fr.readAsDataURL(file)
      })
      const r = await uploadHeroImage(dataUrl)
      if (r.error || !r.url) throw new Error(r.error || "Upload failed")
      patch({ logoUrl: r.url })
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed") }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = "" }
  }

  const save = async () => {
    if (!b) return
    setBusy(true); setErr(null); setSaved(false)
    try {
      const r = await setEmailBranding(b)
      if (r.error) throw new Error(r.error)
      if (r.branding) setB(r.branding)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save — admin only.") }
    finally { setBusy(false) }
  }

  if (!b) return null
  const preset = EMAIL_PRESETS.find((p) => p.id === b.preset) ?? EMAIL_PRESETS[0]

  return (
    <>
      {/* Compact trigger in the Broadcasts header — a one-time setup you open only to
          adjust, not a panel that dominates the page. (The accent-colour chip was dropped
          for a cleaner button; a set logo still shows that branding is configured.) */}
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        {b.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logoUrl} alt="" className="h-4 max-w-[4.5rem] object-contain" />
        ) : null}
        Branding
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Email branding</DialogTitle>
            <DialogDescription>Logo, colour and footer — applied to every broadcast email.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Theme</label>
            <select value={b.preset} onChange={(e) => patch({ preset: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
              {EMAIL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">{preset.hint}</span>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Accent colour</label>
            <div className="flex items-center gap-2">
              <input type="color" value={b.accent} onChange={(e) => patch({ accent: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-1" aria-label="Accent colour" />
              <Input value={b.accent} onChange={(e) => patch({ accent: e.target.value })} className="h-9 tabular-nums" placeholder="#604cfa" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Logo</label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
            {b.logoUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.logoUrl} alt="Email logo" className="h-8 max-w-[10rem] rounded border border-border bg-white object-contain px-1" />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <CircleNotch size={13} className="animate-spin" /> : null}Replace</Button>
                <Button variant="ghost" size="sm" onClick={() => patch({ logoUrl: "" })} disabled={uploading}>Remove</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <CircleNotch size={13} className="animate-spin" /> : null}Upload logo</Button>
                <span className="text-xs text-muted-foreground">Optional — falls back to the wordmark.</span>
              </div>
            )}
          </div>
          {!b.logoUrl && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Wordmark</label>
              <Input value={b.heading} onChange={(e) => patch({ heading: e.target.value })} placeholder="egful" />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Footer note (optional)</label>
            <textarea className={TEXTAREA_CLS + " min-h-16"} value={b.footerNote} onChange={(e) => patch({ footerNote: e.target.value })}
              placeholder="A tagline or seasonal note. Shown above the required unsubscribe line." />
          </div>
        </div>

        {/* Chrome-only preview — the body copy is per-broadcast. Light-only, like the mail. */}
        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Preview</span>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            {b.preset === "branded" && <div className="h-1" style={{ background: b.accent }} />}
            <div className="px-5 py-4" style={b.preset === "bold" ? { background: b.accent } : undefined}>
              {b.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.logoUrl} alt="" className="h-8 max-w-[11rem] object-contain" />
              ) : (
                <span className="text-2xl font-semibold tracking-tight"
                  style={{ color: b.preset === "bold" ? "#ffffff" : "#0b0b0c", fontFamily: "Georgia, 'Times New Roman', serif" }}>
                  {b.heading || "egful"}
                </span>
              )}
            </div>
            <div className="px-5 pb-4 text-sm text-zinc-700">
              <p className="mb-2">Hi Alex,</p>
              <p className="text-zinc-400">Your broadcast copy appears here…</p>
            </div>
            <div className="border-t border-zinc-200 px-5 py-3 text-2xs leading-relaxed text-zinc-400">
              {b.footerNote && <p className="mb-1.5 text-zinc-500">{b.footerNote}</p>}
              <p>You&apos;re receiving this because you have an EGFUL seller account. <span className="underline">Unsubscribe from updates like this</span>.</p>
            </div>
          </div>
        </div>
      </div>
          <DialogFooter className="mt-2 flex-wrap items-center gap-3">
            {saved && <span className="mr-auto text-xs text-success dark:text-emerald-400">Saved — applies to the next send.</span>}
            {err && <span className="mr-auto text-xs text-destructive">{err}</span>}
            <Button size="sm" onClick={save} disabled={busy}>{busy ? <CircleNotch size={14} className="animate-spin" /> : null}Save branding</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// The email as a seller will actually receive it: the saved branding chrome (accent, logo/
// wordmark, footer) wrapped around the draft's body. Same chrome as the branding preview,
// but populated with the real copy so you compose against the finished layout — not a bare
// textarea. `branding` may be null while it loads; a sane default keeps the preview stable.
function BrandedEmailPreview({ branding, body }: { branding: EmailBranding | null; body: string }) {
  const b = branding ?? { preset: "branded", accent: "#604cfa", logoUrl: "", heading: "egful", footerNote: "" }
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      {b.preset === "branded" && <div className="h-1" style={{ background: b.accent }} />}
      <div className="px-5 py-4" style={b.preset === "bold" ? { background: b.accent } : undefined}>
        {b.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logoUrl} alt="" className="h-8 max-w-[11rem] object-contain" />
        ) : (
          <span className="text-2xl font-semibold tracking-tight"
            style={{ color: b.preset === "bold" ? "#ffffff" : "#0b0b0c", fontFamily: "Georgia, 'Times New Roman', serif" }}>
            {b.heading || "egful"}
          </span>
        )}
      </div>
      <div className="px-5 pb-4 text-sm text-zinc-700">
        <p className="mb-2">Hi Alex,</p>
        {paras.length
          ? paras.map((p, i) => <p key={i} className="mb-2 whitespace-pre-line">{p}</p>)
          : <p className="text-zinc-400">Your message appears here…</p>}
      </div>
      <div className="border-t border-zinc-200 px-5 py-3 text-2xs leading-relaxed text-zinc-400">
        {b.footerNote && <p className="mb-1.5 text-zinc-500">{b.footerNote}</p>}
        <p>You&apos;re receiving this because you have an EGFUL seller account. <span className="underline">Unsubscribe from updates like this</span>.</p>
      </div>
    </div>
  )
}

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
  const [branding, setBranding] = useState<EmailBranding | null>(null) // saved branding, for the editor preview
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [role, setRole] = useState("")

  // Editor
  const [editing, setEditing] = useState<Broadcast | null>(null)
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [aud, setAud] = useState<BroadcastAudience>({})
  const [channels, setChannels] = useState<BroadcastChannel[]>(["email", "inapp"])
  const [saving, setSaving] = useState(false)
  // THE RECIPIENTS, IN THE COMPOSER. Resolved live from the audience being edited, so the
  // addresses are on the same screen as the message rather than a click away. Safe as an
  // effect because the fetch writes `cCount` and never `aud` — its own result cannot
  // re-satisfy the condition that triggered it (CLAUDE.md §2.8).
  const [cCount, setCCount] = useState<Awaited<ReturnType<typeof previewBroadcastAudience>> | null>(null)
  const [cCounting, setCCounting] = useState(false)
  const [cAddr, setCAddr] = useState("")

  // Send confirmation. Held separately from the editor because it asks a different
  // question — not "is this right?" but "are you sure?".
  // A sent broadcast, reopened to read. Separate from `editing`: a sent one cannot be
  // changed — it is a record of what went out — so this is deliberately read-only.
  const [viewing, setViewing] = useState<Broadcast | null>(null)
  // WHO IT REACHED. Fetched when the record is opened rather than carried on the row: it is
  // one list per broadcast and the board renders every row.
  const [deliveries, setDeliveries] = useState<BroadcastDelivery[] | null>(null)
  const [delLoading, setDelLoading] = useState(false)
  const [confirming, setConfirming] = useState<Broadcast | null>(null)
  const [count, setCount] = useState<Awaited<ReturnType<typeof previewBroadcastAudience>> | null>(null)
  // The audience AS EDITED on the CONFIRM screen — distinct from `aud` above, which belongs
  // to the composer. The draft's stored audience is the starting point; striking someone off
  // or typing an address in changes this, and it is written back to the draft before the
  // send, because the server resolves recipients from what is stored, not from anything this
  // dialog passes.
  const [sendAud, setSendAud] = useState<BroadcastAudience>({})
  const [addr, setAddr] = useState("")
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
    const id = setTimeout(() => {
      setRole(getUser()?.role || ""); load()
      // Load the saved branding so the editor can preview the finished email.
      getEmailBranding().then((r) => setBranding(r.branding)).catch(() => {})
    }, 0)
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
  // Sending is admin OR operator — operators are the people who actually send
  // announcements. Mirrors requireBroadcaster on the server; the server is the boundary,
  // this only decides whether the button is worth showing.
  const canSend = role === "admin" || role === "operator"

  const openEditor = (b: Broadcast | null) => {
    setEditing(b)
    setSubject(b?.subject ?? "")
    setBody(b?.body ?? "")
    // A new broadcast goes BOTH places by default. An announcement that only reached the
    // people who happen to open their mail is the failure mode this exists to fix, and the
    // in-app copy costs one insert. Older drafts keep whatever they were saved with.
    setChannels(b?.channels?.length ? b.channels : ["email", "inapp"])
    setAud(b?.audience ?? {})
    setCCount(null); setCAddr("")
    setErr(null)
    setOpen(true)
  }

  /** Persist the composer. Returns the stored row, which the send path needs — the server
   *  resolves recipients from what is STORED, never from what a dialog passes. */
  const persist = async () => (
    editing
      ? await updateBroadcast(editing.id, { subject, body, audience: aud, channels })
      : await createBroadcast({ subject, body, audience: aud, channels })
  )

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      await persist()
      setOpen(false); load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save")
    } finally { setSaving(false) }
  }

  /**
   * Send from the composer, in one action.
   *
   * The draft row is still written first and is still what the server reads — that is the
   * storage model, not a step in the task. The addresses are already on this screen and the
   * button already names the count, so there is nothing a second confirm dialog would add
   * that isn't in front of you. There is no unsend, which is why the count is in the button
   * rather than in a sentence someone can skip.
   */
  const saveAndSend = async () => {
    setSaving(true); setErr(null)
    try {
      const b = await persist()
      await sendBroadcast(b.id)
      setOpen(false); load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send")
    } finally { setSaving(false) }
  }

  /**
   * Resolve the composer's audience into actual addresses, as it is edited.
   *
   * Debounced, and deliberately keyed on the audience only: the fetch writes `cCount`, which
   * is not part of the condition, so it cannot re-trigger itself. A ticked box or a struck-off
   * address re-resolves; nothing else does.
   */
  useEffect(() => {
    if (!open || !channels.includes("email")) { return }
    let live = true
    const t = setTimeout(() => {
      setCCounting(true)
      previewBroadcastAudience(aud)
        .then((r) => { if (live) setCCount(r) })
        .catch(() => { if (live) setCCount(null) })
        .finally(() => { if (live) setCCounting(false) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [open, aud, channels])

  /** Strike someone off — an extra by address, a seller by id. Writes to the audience, which
   *  is what the server resolves from, so the removal survives the send. */
  const cDrop = (r: BroadcastRecipient) => {
    if (r.extra) {
      const keep = (aud.extraEmails ?? []).filter((e) => e.trim().toLowerCase() !== r.email.trim().toLowerCase())
      return setAud({ ...aud, extraEmails: keep })
    }
    if (!r.id) return
    setAud({ ...aud, excludeIds: [...new Set([...(aud.excludeIds ?? []), r.id])] })
  }

  const cAdd = () => {
    const e = cAddr.trim()
    if (!e) return
    const have = new Set([...(cCount?.recipients ?? []).map((r) => r.email.toLowerCase()), ...(aud.extraEmails ?? []).map((x) => x.toLowerCase())])
    setCAddr("")
    if (have.has(e.toLowerCase())) return          // already on the list
    setAud({ ...aud, extraEmails: [...(aud.extraEmails ?? []), e] })
  }

  /**
   * Open the record of a sent broadcast, and load the addresses it actually went to.
   *
   * Driven by the click rather than an effect on `viewing`: an effect would have to clear
   * the previous list synchronously on open, which is the set-state-in-effect the lint rule
   * forbids, and would re-fetch on every unrelated re-render of a dialog that is already up.
   */
  const openViewer = (b: Broadcast) => {
    setViewing(b); setDeliveries(null); setDelLoading(true)
    getBroadcastDeliveries(b.id)
      .then((r) => setDeliveries(r.deliveries ?? []))
      .catch(() => setDeliveries([]))
      .finally(() => setDelLoading(false))
  }

  const remove = async (b: Broadcast) => {
    try { await deleteBroadcast(b.id); load() }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not delete") }
  }

  // Resolve the audience for the confirm step. This is a live count against the same
  // resolver the send uses — NOT a number stored on the draft, which would be stale the
  // moment anyone signed up or unsubscribed.
  const startSend = async (b: Broadcast) => {
    const a = b.audience ?? {}
    setConfirming(b); setCount(null); setCounting(true); setErr(null); setSendAud(a); setAddr("")
    try { setCount(await previewBroadcastAudience(a)) }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not count the audience") }
    finally { setCounting(false) }
  }

  // Re-resolve after every edit. The list shown is always the list the send will use —
  // computing it locally would be a second implementation of the audience rules, and the
  // two would drift.
  const reprice = async (next: BroadcastAudience) => {
    setSendAud(next); setCounting(true); setErr(null)
    try { setCount(await previewBroadcastAudience(next)) }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not count the audience") }
    finally { setCounting(false) }
  }

  const dropRecipient = (r: BroadcastRecipient) => {
    if (r.extra) {
      const keep = (sendAud.extraEmails ?? []).filter((e) => e.trim().toLowerCase() !== r.email.trim().toLowerCase())
      return reprice({ ...sendAud, extraEmails: keep })
    }
    if (!r.id) return
    return reprice({ ...sendAud, excludeIds: [...new Set([...(sendAud.excludeIds ?? []), r.id])] })
  }

  const addRecipient = () => {
    const e = addr.trim()
    if (!e) return
    const have = new Set([...(count?.recipients ?? []).map((r) => r.email.toLowerCase()), ...(sendAud.extraEmails ?? []).map((x) => x.toLowerCase())])
    if (have.has(e.toLowerCase())) { setAddr(""); return }   // already on the list
    setAddr("")
    return reprice({ ...sendAud, extraEmails: [...(sendAud.extraEmails ?? []), e] })
  }

  const doSend = async () => {
    if (!confirming) return
    setSending(true); setErr(null)
    try {
      // Persist the edits FIRST. The send resolves recipients from the draft's stored
      // audience, so an unsaved exclusion would be silently ignored and the person struck
      // off would get the mail anyway — the worst possible outcome for this screen.
      await updateBroadcast(confirming.id, { audience: sendAud })
      await sendBroadcast(confirming.id); setConfirming(null); load()
    }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not send") }
    finally { setSending(false) }
  }

  // What the broadcast being confirmed is actually set to do. A draft saved before the
  // channel column existed has none, and was email — same fallback as the server's.
  const confirmChannels = confirming?.channels?.length ? confirming.channels : (["email"] as BroadcastChannel[])
  const sendsEmail = confirmChannels.includes("email")
  const sendsInApp = confirmChannels.includes("inapp")

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
        actions={
          <div className="flex items-center gap-2">
            {/* Branding is a one-time setup behind this button (admin-only), not a panel. */}
            {isAdmin && <EmailBrandingCard />}
            <Button size="sm" onClick={() => openEditor(null)}><Plus size={14} weight="bold" />New broadcast</Button>
          </div>
        }
        bodyClassName="p-5"
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
                <tr className="border-b border-border text-left eg-label text-muted-foreground">
                  <th className="py-2 pr-3">Subject</th>
                  <th className="py-2 pr-3">Audience</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Sent</th>
                  <th className="py-2 pr-3">Sent by</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((b) => {
                  const st = STATUS[b.status] ?? STATUS.draft
                  return (
                    <tr key={String(b.id)} className="align-top">
                      <td className="max-w-72 py-2.5 pr-3">
                        {/* READ IT BACK. A sent broadcast is a record, and the record was a
                            truncated first line — you could see that you mailed everyone and
                            not what you said. Click the subject to reopen the whole thing.
                            A draft opens the editor instead, which is the useful action
                            there. */}
                        <button
                          type="button"
                          onClick={() => (b.status === "draft" ? openEditor(b) : openViewer(b))}
                          className="eg-tap block max-w-full truncate text-left font-medium transition-colors hover:text-primary"
                          title={b.status === "draft" ? "Open this draft" : "Read what was sent"}
                        >
                          {b.subject}
                        </button>
                        <div className="truncate text-xs text-muted-foreground">{b.body}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                        {audienceLabel(b.audience)}
                        {/* WHERE it went, not just to whom. Rows predating the channel column
                            were email, and say nothing rather than claiming a channel they
                            never had. */}
                        {b.channels?.length ? (
                          <div className="text-2xs opacity-80">{channelLabel(b.channels)}</div>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge className={st.cls}>{st.label}</Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {/* A draft has no count and says so, rather than showing 0 — which
                            would read as "sent to nobody". */}
                        {b.status === "draft" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : !mailsOf(b) ? (
                          /* Announcement-only. "0 / 0" here read as a send to nobody, when
                             in fact every one of these people was told. */
                          <span title="Posted in-app; no email was sent">{(b.posted_count ?? 0).toLocaleString("en-US")} posted</span>
                        ) : (
                          <>
                            <span>{b.sent_count.toLocaleString("en-US")}</span>
                            <span className="text-muted-foreground">{" / "}{(b.recipient_count ?? 0).toLocaleString("en-US")}</span>
                            {/* THE COUNT ONLY. The reason used to be spelled out here too,
                                which put a failing address on the board at all times — a
                                stray line of red under a row that is otherwise a tidy
                                counter. Open the broadcast and every address is listed with
                                its own reason; that is the place to read it. */}
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
                            {canSend && (
                              <Button size="sm" disabled={!mailOk && mailsOf(b)} onClick={() => startSend(b)}>
                                Send
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
        {!canSend && rows.some((b) => b.status === "draft") && (
          <p className="mt-3 text-xs text-muted-foreground">
            Drafts are open to the team; sending is admin and operator only. There is no unsend.
          </p>
        )}
      </SectionCard>

      {/* ── Editor ────────────────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit draft" : "New broadcast"}</DialogTitle>
            <DialogDescription>
              Written as plain text. An unsubscribe footer is added automatically — it is required, so it is not optional here.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 lg:grid-cols-2">
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
              {/* WHERE IT GOES. Two places, chosen independently — this is not a format
                  switch. Mail reaches someone who isn't in the app; the bell reaches
                  someone who is, and reaches sellers with no deliverable address at all.
                  Most announcements want both, which is why both start ticked. */}
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Send to</label>
              <div className="mb-3 space-y-1.5 rounded-lg border border-border p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 accent-primary" checked={channels.includes("email")}
                    onChange={(e) => setChannels((p) => e.target.checked ? [...new Set([...p, "email" as BroadcastChannel])] : p.filter((c) => c !== "email"))} />
                  <span>Email<span className="block text-xs text-muted-foreground">Full message with your branding and the unsubscribe footer.</span></span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 accent-primary" checked={channels.includes("inapp")}
                    onChange={(e) => setChannels((p) => e.target.checked ? [...new Set([...p, "inapp" as BroadcastChannel])] : p.filter((c) => c !== "inapp"))} />
                  <span>In-app announcement<span className="block text-xs text-muted-foreground">Subject and body only, to the seller&apos;s notifications. Goes to everyone in the audience — including anyone who opted out of marketing email, since that isn&apos;t an opt-out from the app.</span></span>
                </label>
                {channels.length === 0 && (
                  <p className="pt-1 text-xs text-amber-700 dark:text-amber-400">Pick at least one — otherwise this goes nowhere.</p>
                )}
              </div>
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
                  Anyone who has unsubscribed is excluded automatically, and the list is resolved again when
                  you send, so an unsubscribe between now and then is still honoured.
                </p>
              </div>
            </div>

          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Preview</span>
              <span className="text-2xs text-muted-foreground">Your saved branding</span>
            </div>
            <div className="mb-2 truncate text-xs text-muted-foreground">Subject: <span className="font-medium text-foreground">{subject || "…"}</span></div>
            <div className="max-h-[38vh] overflow-y-auto">
              <BrandedEmailPreview branding={branding} body={body} />
            </div>
            {/* WHO THIS GOES TO, on the same screen as the message. It was behind a second
                dialog, which meant writing a broadcast and picking its audience without ever
                seeing an address. Every edit re-resolves server-side, so the list here is the
                list that will be mailed — not a local guess at the audience rules. */}
            {channels.includes("email") && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-medium text-muted-foreground">
                    Recipients{cCount ? <span className="ml-1 font-normal">({cCount.count.toLocaleString("en-US")})</span> : null}
                  </label>
                  {cCounting && <CircleNotch size={12} className="animate-spin text-muted-foreground" />}
                </div>
                <div className="rounded-lg border border-border">
                  {cCount?.recipients?.length ? (
                    <div className="max-h-40 overflow-y-auto">
                      {cCount.recipients.map((r) => (
                        <div key={r.id ?? r.email} className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-xs last:border-b-0">
                          <span className="min-w-0 flex-1 truncate">
                            {r.email}
                            {r.name && <span className="ml-1.5 text-muted-foreground">{r.name}</span>}
                          </span>
                          {r.extra && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">added</span>}
                          <button type="button" onClick={() => cDrop(r)} aria-label={`Remove ${r.email}`}
                                  className="eg-tap shrink-0 text-muted-foreground transition-colors hover:text-destructive">
                            <X size={12} weight="bold" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-2.5 py-3 text-xs text-muted-foreground">
                      {cCounting ? "Resolving…" : "Nobody matches this audience yet."}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 border-t border-border p-2">
                    <Input value={cAddr} onChange={(e) => setCAddr(e.target.value)}
                           onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); cAdd() } }}
                           placeholder="Add an address…" className="h-7 text-xs" />
                    <Button size="sm" variant="outline" disabled={!cAddr.trim()} onClick={cAdd}>Add</Button>
                  </div>
                </div>
                {/* Addresses that cannot be delivered to, while fixing them is still cheap. */}
                {!!cCount?.invalid?.length && (
                  <p className="mt-1.5 text-2xs leading-snug text-amber-700 dark:text-amber-400">
                    {cCount.invalid.length} address{cCount.invalid.length === 1 ? "" : "es"} can&apos;t be delivered to and will fail:{" "}
                    <span className="tabular-nums">{cCount.invalid.map((x) => x.email || "(blank)").join(", ")}</span>.
                  </p>
                )}
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  Added addresses get a real unsubscribe link — opting out suppresses that address for good, account or not.
                </p>
              </div>
            )}
          </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            {/* Saving without sending stays available, but only for the people who have no
                other option — a team member who can draft and cannot send. Offering it to a
                sender is what created the two-step nobody wanted. */}
            {!canSend && (
              <Button variant="outline" onClick={save} disabled={saving || !subject.trim() || !body.trim() || channels.length === 0}>
                {saving ? <CircleNotch size={14} className="animate-spin" /> : null}Save draft
              </Button>
            )}
            {canSend && (
              /* The count is IN the button. There is no unsend and no second confirm screen
                 any more, so the number has to be on the thing you press. */
              <Button onClick={saveAndSend}
                      disabled={saving || cCounting || !subject.trim() || !body.trim() || channels.length === 0
                                || (channels.includes("email") && !channels.includes("inapp") && !cCount?.count)}>
                {saving ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} />}
                {channels.includes("email") && cCount ? `Send to ${cCount.count.toLocaleString("en-US")}` : "Send now"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Send confirmation ─────────────────────────────────────────────── */}
      {/* READ-ONLY record of a sent broadcast. Deliberately not the editor: a sent
          broadcast is history, and the module already refuses to edit one server-side. */}
      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="pr-6">{viewing?.subject}</DialogTitle>
            <DialogDescription>
              {viewing
                ? `${audienceLabel(viewing.audience)} · ${
                    mailsOf(viewing)
                      ? `${viewing.sent_count.toLocaleString("en-US")} of ${(viewing.recipient_count ?? 0).toLocaleString("en-US")} delivered`
                      : `posted in-app to ${(viewing.posted_count ?? 0).toLocaleString("en-US")}`
                  }${viewing.channels?.includes("inapp") && mailsOf(viewing) ? ` · also posted in-app to ${(viewing.posted_count ?? 0).toLocaleString("en-US")}` : ""}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* The body as it was authored — plain text, whitespace kept, because that is
                how it was written and how it was rendered into the mail. */}
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
              {viewing?.body}
            </div>
            {viewing?.last_error && (
              /* The transport's OWN words, kept verbatim. The row shows a short human line;
                 this is where the raw text belongs — you came here to look for it. */
              <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs leading-snug text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                <div className="font-medium">{viewing.failed_count.toLocaleString("en-US")} didn&apos;t get it</div>
                <div className="mt-0.5 tabular-nums opacity-90">{viewing.last_error}</div>
              </div>
            )}
            {/* WHERE IT LANDED, address by address. The counts above answer "how many"; this
                is the only thing that answers "did it reach this person?" — which is the
                question anyone actually opens this screen with. Failures sort first. */}
            {viewing && mailsOf(viewing) && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Sent to
                  {deliveries?.length ? <span className="ml-1 font-normal">({deliveries.length.toLocaleString("en-US")})</span> : null}
                </div>
                {delLoading ? (
                  <div className="flex items-center justify-center py-5 text-muted-foreground"><CircleNotch size={16} className="animate-spin" /></div>
                ) : deliveries?.length ? (
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                    {deliveries.map((d, i) => (
                      <div key={`${d.email}-${i}`} className="flex items-start gap-2 border-b border-border/60 px-2.5 py-1.5 text-xs last:border-b-0">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {d.email}
                            {d.name && <span className="ml-1.5 text-muted-foreground">{d.name}</span>}
                          </span>
                          {/* The reason sits under the address it belongs to — a failure list
                              that doesn't say why is just a shorter list. */}
                          {d.status === "failed" && d.error && (
                            <span className="mt-0.5 block tabular-nums text-2xs leading-snug text-red-700 dark:text-red-300">{d.error}</span>
                          )}
                        </span>
                        {d.extra && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">added</span>}
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-2xs ${
                          d.status === "sent"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                        }`}>
                          {d.status === "sent" ? "delivered" : "failed"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* An empty list and an unrecorded one are different facts, and a screen that
                     showed nothing for both would read as "it went to nobody". */
                  <p className="rounded-lg border border-dashed border-border px-2.5 py-3 text-xs text-muted-foreground">
                    No per-address record for this one — it was sent before addresses were kept.
                    The counts above are what was logged at the time.
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Sent {viewing?.sent_at ? dt(viewing.sent_at) : dt(viewing?.created_at ?? "")}
              {viewing?.created_by_name || viewing?.created_by ? ` by ${viewing.created_by_name || viewing.created_by}` : ""}.
              A sent broadcast can&apos;t be edited — it&apos;s the record of what went out.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                {/* Say each destination with its OWN number. They genuinely differ — the
                    in-app list includes sellers who opted out of marketing email and
                    sellers with no usable address — and one blended figure would be wrong
                    for both. */}
                {sendsEmail && (
                  <p className="text-sm">
                    This will email{" "}
                    <strong>{inWords(count.count)}</strong>{" "}
                    seller{count.count === 1 ? "" : "s"}{" "}
                    <span className="text-muted-foreground">({count.count.toLocaleString("en-US")})</span>.
                  </p>
                )}
                {sendsInApp && (
                  <p className={sendsEmail ? "mt-1 text-sm" : "text-sm"}>
                    {sendsEmail ? "It also posts" : "This will post"} an announcement to{" "}
                    <strong>{inWords(count.inAppCount ?? count.count)}</strong>{" "}
                    seller{(count.inAppCount ?? count.count) === 1 ? "" : "s"}{" "}
                    <span className="text-muted-foreground">({(count.inAppCount ?? count.count).toLocaleString("en-US")})</span> in the app.
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">{audienceLabel(confirming?.audience)}</p>
              </div>
              <p className={sendsEmail ? "text-xs text-muted-foreground" : "hidden"}>
                {count.optedOut > 0
                  ? `${count.optedOut.toLocaleString("en-US")} seller${count.optedOut === 1 ? " has" : "s have"} unsubscribed and ${count.optedOut === 1 ? "is" : "are"} excluded.`
                  : "No seller has unsubscribed yet."}
              </p>

              {/* ADDRESSES THAT CANNOT BE DELIVERED TO. Shown here because this is the last
                  moment fixing them is cheap — after the send they are a red line on a row. */}
              {sendsEmail && !!count.invalid?.length && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  {count.invalid.length} address{count.invalid.length === 1 ? "" : "es"} can&apos;t be delivered to and will fail:{" "}
                  <span className="tabular-nums">{count.invalid.map((x) => x.email || "(blank)").join(", ")}</span>. Fix the seller record, or remove them below.
                </div>
              )}

              {/* THE LIST, EDITABLE. It used to say "First few: a, b, c" — enough to make you
                  wonder who else was on it and nothing you could do about it. Removing writes
                  to the draft's audience before the send; the count re-resolves server-side
                  after every change, so what is shown is always what will be mailed. */}
              {sendsEmail && !!count.recipients?.length && (
                <div className="rounded-lg border border-border">
                  <div className="max-h-44 overflow-y-auto">
                    {count.recipients.map((r) => (
                      <div key={r.id ?? r.email} className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-xs last:border-b-0">
                        <span className="min-w-0 flex-1 truncate">
                          {r.email}
                          {r.name && <span className="ml-1.5 text-muted-foreground">{r.name}</span>}
                        </span>
                        {r.extra && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">added</span>}
                        <button
                          type="button"
                          onClick={() => void dropRecipient(r)}
                          disabled={counting}
                          aria-label={`Remove ${r.email}`}
                          className="eg-tap shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <X size={12} weight="bold" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 border-t border-border p-2">
                    <Input
                      value={addr}
                      onChange={(e) => setAddr(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addRecipient() } }}
                      placeholder="Add an address…"
                      className="h-7 text-xs"
                    />
                    <Button size="sm" variant="outline" disabled={!addr.trim() || counting} onClick={() => void addRecipient()}>Add</Button>
                  </div>
                  {/* Said plainly, because it is the part people assume doesn't work. */}
                  <p className="border-t border-border px-2.5 py-1.5 text-2xs text-muted-foreground">
                    Added addresses get a real unsubscribe link — opting out suppresses that address for good, account or not.
                  </p>
                </div>
              )}
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
