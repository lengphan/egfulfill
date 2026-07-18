"use client"

import { useCallback, useEffect, useState } from "react"
import { Key, Copy, Check, Trash, Plus, Warning, CurrencyDollar, CircleNotch, UserPlus, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IntegrationsPanel } from "@/components/app/integrations-panel"
import { SubscriptionPanel } from "@/components/app/subscription-panel"
import { getUser, updateUser } from "@/lib/auth"
import { UserAvatar, AVATAR_COLORS, AVATAR_EMOJIS } from "@/components/app/user-avatar"
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getTeam,
  inviteMember,
  removeMember,
  updateProfile,
  getFactorySettings,
  setFactorySettings,
  getUsers,
  updateUserAdmin,
  createUserAdmin,
  getAudit,
  type ApiKey,
  type TeamMember,
  type FactorySettings,
  type AdminUser,
  type AuditRow,
} from "@/lib/api"

const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// ─────────────────────────── Profile ───────────────────────────
function ProfilePanel() {
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null)
  const [name, setName] = useState("")
  const [emoji, setEmoji] = useState<string>("")
  const [color, setColor] = useState<string>(AVATAR_COLORS[0])
  const [sound, setSound] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const id = setTimeout(() => {
      const u = getUser()
      setUser(u)
      setName(u?.name ?? "")
      setEmoji(u?.avatar_emoji ?? "")
      setColor(u?.avatar_color ?? AVATAR_COLORS[0])
      setSound(u?.notify_sound !== false)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const nameDirty = !!name.trim() && name.trim() !== (user?.name ?? "")
  const avatarDirty = emoji !== (user?.avatar_emoji ?? "") || color !== (user?.avatar_color ?? AVATAR_COLORS[0])
  const soundDirty = sound !== (user?.notify_sound !== false)
  const dirty = !!user && (nameDirty || avatarDirty || soundDirty)

  const save = async () => {
    if (!dirty) return
    setSaving(true); setErr(null); setSaved(false)
    try {
      // Send null (not "") to clear — the server treats null as "back to the initial".
      const r = await updateProfile({
        name: name.trim(),
        avatar_emoji: emoji || null,
        avatar_color: color || null,
        notify_sound: sound,
      })
      if (r.error) throw new Error(r.error)
      const next = { name: r.name ?? name.trim(), avatar_emoji: emoji || null, avatar_color: color || null, notify_sound: sound }
      updateUser(next)
      setUser((u) => (u ? { ...u, ...next } : u))
      setSaved(true)
      // Let the topbar/sidebar pick up the new name + avatar.
      window.dispatchEvent(new CustomEvent("eg-user-changed"))
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save your profile.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard title="Profile" description="Your account details">
      {!user && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-50 px-5 py-2.5 text-xs font-medium text-amber-700">
          <Warning size={14} weight="fill" /> Sign in to see your account details.
        </div>
      )}
      <div className="flex items-center gap-4 border-b border-border px-5 py-5">
        {/* Live preview — this is exactly what the topbar will show. */}
        <UserAvatar user={{ name: name || user?.name, avatar_emoji: emoji, avatar_color: color }} size={56} className="rounded-2xl" />
        <div>
          <div className="text-lg font-semibold">{user?.name || "Your account"}</div>
          <div className="text-sm text-muted-foreground">{user?.email || "Not signed in"}</div>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Display name</span>
          <Input
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false) }}
            onKeyDown={(e) => { if (e.key === "Enter") save() }}
            placeholder="Your name"
            disabled={!user}
            className="max-w-sm"
          />
        </label>

        {/* Avatar — an emoji + a colour. Deliberately not an image upload: no file
            storage, no extra request per page, nothing to slow the app down. */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Avatar</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => { setEmoji(""); setSaved(false) }}
              disabled={!user}
              title="Use your initial"
              className={"flex size-8 items-center justify-center rounded-lg border text-xs font-bold transition-colors " + (emoji === "" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent")}
            >
              {(name || user?.name || "?").charAt(0).toUpperCase()}
            </button>
            {AVATAR_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => { setEmoji(e); setSaved(false) }}
                disabled={!user}
                className={"flex size-8 items-center justify-center rounded-lg border text-base transition-colors " + (emoji === e ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setColor(c); setSaved(false) }}
                disabled={!user}
                aria-label={`Avatar colour ${c}`}
                style={{ background: c }}
                className={"size-7 rounded-full transition-transform hover:scale-110 " + (color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-card" : "")}
              />
            ))}
          </div>
        </div>
        {/* Notification sound — per user, so a quiet floor can mute without
            affecting anyone else's board. */}
        <label className="flex max-w-md cursor-pointer items-center justify-between gap-4 rounded-xl border border-border p-3">
          <span className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {sound ? <SpeakerHigh size={15} weight="fill" /> : <SpeakerSlash size={15} weight="fill" />}
            </span>
            <span>
              <span className="block text-sm font-medium">Notification sound</span>
              <span className="block text-xs text-muted-foreground">Play a chime when something needs you</span>
            </span>
          </span>
          <Switch checked={sound} onCheckedChange={(v) => { setSound(v); setSaved(false) }} disabled={!user} />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">Email</span>
          <div className="text-sm">{user?.email || "—"}</div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">Role</span>
          <div className="text-sm capitalize">{user?.role || "seller"}</div>
        </div>
        {err && <div className="text-sm text-destructive">{err}</div>}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {saved && <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check size={14} weight="bold" /> Saved</span>}
        </div>
      </div>
    </SectionCard>
  )
}

// ─────────────────────────── API keys ───────────────────────────
function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [label, setLabel] = useState("")
  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState<"test" | "live">("test")
  const [fresh, setFresh] = useState<{ key: string; label: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getApiKeys()
      .then((r) => setKeys(r.keys ?? []))
      .catch(() => setKeys([]))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const onCreate = async () => {
    setCreating(true)
    setErr(null)
    try {
      const r = await createApiKey(label.trim() || (mode === "live" ? "Live key" : "Test key"), mode)
      setFresh({ key: r.key, label: r.label })
      setLabel("")
      setCopied(false)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create a key.")
    } finally {
      setCreating(false)
    }
  }

  const onRevoke = async (id: ApiKey["id"]) => {
    setKeys((prev) => (prev ?? []).map((k) => (k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k)))
    try {
      await revokeApiKey(id)
    } catch {
      load()
    }
  }

  const copy = async () => {
    if (!fresh) return
    try {
      await navigator.clipboard.writeText(fresh.key)
      setCopied(true)
    } catch {
      /* clipboard blocked */
    }
  }

  const active = (keys ?? []).filter((k) => !k.revoked_at)

  return (
    <SectionCard
      title="API keys"
      description={mode === "live"
        ? "Live keys hit the real API (/api/v1/*) — calls create real orders"
        : "Test keys hit the sandbox (/api/test/*) — no real orders, labels or charges"}
      actions={
        // Same test/live switch as the API Playground — the two must agree, or you
        // generate a key in one place that the other can't use.
        <div className="flex rounded-lg border border-border p-0.5">
          {(["test", "live"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={"eg-tap rounded-md px-3 py-1 text-xs font-semibold uppercase transition-colors " + (mode === m ? (m === "live" ? "bg-red-500 text-white" : "bg-primary text-primary-foreground") : "text-muted-foreground hover:text-foreground")}
            >
              {m}
            </button>
          ))}
        </div>
      }
    >
      {mode === "live" && (
        <div className="flex items-start gap-2 border-b border-border bg-red-50 px-5 py-2.5 text-xs text-red-700">
          <Warning size={14} weight="fill" className="mt-px shrink-0" />
          <span><b>Live mode</b> — a live key (egk_live_…) makes calls create <b>real</b> orders. Use a test key while building.</span>
        </div>
      )}
      {/* create row */}
      <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={mode === "live" ? "Key label (e.g. Production)" : "Key label (e.g. Local testing)"}
          className="sm:max-w-xs"
          onKeyDown={(e) => e.key === "Enter" && onCreate()}
        />
        <Button size="sm" onClick={onCreate} disabled={creating}>
          <Plus size={14} weight="bold" /> {creating ? "Generating…" : `Generate ${mode} key`}
        </Button>
        {err && <span className="text-xs font-medium text-red-600">{err}</span>}
      </div>

      {/* freshly created key — shown once */}
      {fresh && (
        <div className="border-b border-border bg-emerald-50 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <Check size={15} weight="bold" /> Copy your new key now — it won&apos;t be shown again.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono text-sm">
              {fresh.key}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {/* list */}
      {keys === null ? (
        <div className="space-y-3 p-5">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Key size={22} weight="duotone" />
          </span>
          <div className="font-medium">No active keys</div>
          <div className="max-w-xs text-sm text-muted-foreground">
            Generate a test key to call the sandbox endpoints.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {(keys ?? []).map((k) => (
            <div key={String(k.id)} className={"flex items-center justify-between gap-4 px-5 py-3.5 " + (k.revoked_at ? "opacity-50" : "")}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{k.label || "Test key"}</span>
                  <Badge variant="secondary" className="text-[10px] uppercase">{k.mode}</Badge>
                  {k.revoked_at && <span className="text-[11px] font-medium text-red-600">revoked</span>}
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {k.prefix} · created {fmtDate(k.created_at)} · last used {fmtDate(k.last_used_at)}
                </div>
              </div>
              {!k.revoked_at && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-red-600"
                  onClick={() => onRevoke(k.id)}
                >
                  <Trash size={14} weight="bold" /> Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ─────────────────────────── Team ───────────────────────────
function TeamPanel() {
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("editor")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getTeam()
      .then((rows) => setMembers(rows ?? []))
      .catch(() => setMembers([]))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const onInvite = async () => {
    const e = email.trim()
    if (!e) return
    setBusy(true)
    setErr(null)
    try {
      const r = await inviteMember({ email: e, role })
      if (r.error) throw new Error(r.error)
      setEmail("")
      load()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Couldn't send the invite.")
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async (id: TeamMember["id"]) => {
    setMembers((prev) => (prev ?? []).filter((m) => m.id !== id))
    try {
      await removeMember(id)
    } catch {
      load()
    }
  }

  return (
    <SectionCard title="Team" description="Members and their access">
      <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@email.com"
          type="email"
          className="sm:max-w-xs"
          onKeyDown={(e) => e.key === "Enter" && onInvite()}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
        <Button size="sm" onClick={onInvite} disabled={busy}>
          <Plus size={14} weight="bold" /> {busy ? "Inviting…" : "Invite"}
        </Button>
        {err && <span className="text-xs font-medium text-red-600">{err}</span>}
      </div>

      {members === null ? (
        <div className="space-y-3 p-5">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No team members yet.</div>
      ) : (
        <div className="divide-y divide-border">
          {members.map((m) => (
            <div key={String(m.id)} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground">
                  {m.email.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.email}</div>
                  <div className="text-xs capitalize text-muted-foreground">
                    {m.role} · {m.status}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-red-600"
                onClick={() => onRemove(m.id)}
              >
                <Trash size={14} weight="bold" /> Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ─────────────────────────── Page ───────────────────────────
// ─────────────────────────── Platform (warehouse/admin) ───────────────────────────
function MoneyField({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="relative">
        <CurrencyDollar size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" inputMode="decimal" className="h-9 pl-7" />
      </div>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

function PlatformPanel() {
  const [loaded, setLoaded] = useState<FactorySettings | null>(null)
  const [designFee, setDesignFee] = useState("")
  const [shipFirst, setShipFirst] = useState("")
  const [shipExtra, setShipExtra] = useState("")
  const [embPrice, setEmbPrice] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getFactorySettings().then((r) => {
      setLoaded(r)
      setDesignFee(r.design_fee != null ? String(r.design_fee) : "")
      setShipFirst(r.ship_first != null ? String(r.ship_first) : "")
      setShipExtra(r.ship_extra != null ? String(r.ship_extra) : "")
      setEmbPrice(r.emb_price != null ? String(r.emb_price) : "")
    }).catch(() => setLoaded({}))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  const save = async () => {
    setSaving(true); setErr(null); setSaved(false)
    try {
      const r = await setFactorySettings({
        design_fee: designFee === "" ? undefined : Number(designFee),
        ship_first: shipFirst === "" ? undefined : Number(shipFirst),
        ship_extra: shipExtra === "" ? undefined : Number(shipExtra),
        emb_price: embPrice === "" ? undefined : Number(embPrice),
      })
      if (r.error) throw new Error(r.error)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save — warehouse/admin only.")
    } finally { setSaving(false) }
  }

  if (loaded === null) return <SectionCard title="Platform"><div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div></SectionCard>

  return (
    <SectionCard title="Platform" description="Factory-wide defaults (warehouse & admin)">
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <MoneyField label="Design fee" hint="Default payout credited to a designer per approved design" value={designFee} onChange={setDesignFee} />
        <MoneyField label="Embroidery file price" hint="Charge to download a .pes/.emb file" value={embPrice} onChange={setEmbPrice} />
        <MoneyField label="Default shipping — first item" value={shipFirst} onChange={setShipFirst} />
        <MoneyField label="Default shipping — each additional" value={shipExtra} onChange={setShipExtra} />
      </div>
      <div className="flex items-center gap-3 border-t border-border px-5 py-3">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        {saved && <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check size={14} weight="bold" /> Saved</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </SectionCard>
  )
}

// ─────────────────────────── Users (admin) ───────────────────────────
const ROLES = ["seller", "operator", "warehouse", "designer", "admin"]
// Plans are SERVER state now; this dropdown is the ONLY way to change one.
const PLANS = ["starter", "pro", "enterprise"]
function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [nu, setNu] = useState({ email: "", password: "", role: "operator" })
  const [nuErr, setNuErr] = useState<string | null>(null)

  const loadUsers = useCallback(() => { getUsers().then((r) => { setUsers(r ?? []); setLoaded(true) }).catch(() => setLoaded(true)) }, [])
  useEffect(() => { const id = setTimeout(loadUsers, 0); return () => clearTimeout(id) }, [loadUsers])

  const changeRole = async (u: AdminUser, role: string) => {
    setBusy(u.id); setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)))
    try { await updateUserAdmin(u.id, { role }) } catch { loadUsers() } finally { setBusy(null) }
  }
  const changePlan = async (u: AdminUser, plan: string) => {
    setBusy(u.id)
    setUsers((prev) => (prev ?? []).map((x) => (x.id === u.id ? { ...x, plan } : x)))
    try { await updateUserAdmin(u.id, { plan }) } catch { loadUsers() } finally { setBusy(null) }
  }
  const addUser = async () => {
    if (!nu.email.trim() || nu.password.length < 8) { setNuErr("Email/username and a password of 8+ characters are required."); return }
    setBusy("new"); setNuErr(null)
    try {
      const r = await createUserAdmin({ email: nu.email.trim(), password: nu.password, role: nu.role })
      if (r.error) throw new Error(r.error)
      setNu({ email: "", password: "", role: "operator" }); loadUsers()
    } catch (e) { setNuErr(e instanceof Error ? e.message : "Couldn't create the user.") } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="New staff / user" description="Create an account with a role (username or email login)">
        <div className="flex flex-wrap items-end gap-2 p-5">
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Email / username</span><Input value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} placeholder="ops@egful.store" className="h-9" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Password</span><Input type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="8+ characters" className="h-9" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Role</span>
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm capitalize">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </label>
          <Button size="sm" onClick={addUser} disabled={busy === "new"}>{busy === "new" ? <CircleNotch size={14} className="animate-spin" /> : <><UserPlus size={14} weight="bold" /> Create</>}</Button>
          {nuErr && <span className="w-full text-sm text-destructive">{nuErr}</span>}
        </div>
      </SectionCard>
      <SectionCard title="Users" description="Change a role inline">
        {!loaded ? <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">Joined</TableHead></TableRow></TableHeader>
            <TableBody>
              {users.length === 0 ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">No users</TableCell></TableRow>
                : users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name || u.store_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell><select value={u.role} onChange={(e) => changeRole(u, e.target.value)} disabled={busy === u.id} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm capitalize">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></TableCell>
                    <TableCell>
                      {/* Only meaningful for sellers — staff have no subscription. */}
                      {u.role === "seller" ? (
                        <select value={u.plan ?? "starter"} onChange={(e) => changePlan(u, e.target.value)} disabled={busy === u.id} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm capitalize">
                          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtDate(u.created_at)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  )
}

// ─────────────────────────── Activity (admin) ───────────────────────────
function ActivityPanel() {
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  useEffect(() => { const id = setTimeout(() => { getAudit({ limit: 200 }).then((r) => setAudit(r ?? [])).catch(() => setAudit([])) }, 0); return () => clearTimeout(id) }, [])
  const fmtDT = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }
  return (
    <SectionCard title="Activity log" description="Audited actions across the platform">
      {audit === null ? <div className="flex items-center justify-center py-14 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
        : audit.length === 0 ? <div className="py-14 text-center text-sm text-muted-foreground">No activity recorded yet.</div>
          : (
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead></TableRow></TableHeader>
              <TableBody>
                {audit.map((a) => (
                  <TableRow key={String(a.id)}>
                    <TableCell className="text-muted-foreground">{fmtDT(a.ts)}</TableCell>
                    <TableCell>{a.actor || "—"}{a.actor_role ? <span className="text-xs text-muted-foreground"> · {a.actor_role}</span> : null}</TableCell>
                    <TableCell className="font-mono text-xs">{a.action}</TableCell>
                    <TableCell className="text-muted-foreground">{a.entity_type ? `${a.entity_type} ${a.entity_id ?? ""}` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
    </SectionCard>
  )
}

export function SettingsView() {
  // Integrations is a platform/admin concern (Stripe secret, supplier creds, AI key,
  // etc.) — ADMIN only. Operator/warehouse/designer + sellers never see it.
  const [isAdmin, setIsAdmin] = useState(false)
  const [canPlatform, setCanPlatform] = useState(false)
  const [isSeller, setIsSeller] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => {
      const u = getUser()
      setIsAdmin(u?.role === "admin")
      setCanPlatform(u?.role === "admin" || u?.role === "warehouse")
      // A plan is a seller subscription; staff roles don't have one.
      setIsSeller(!u?.role || u.role === "seller")
    }, 0)
    return () => clearTimeout(id)
  }, [])

  return (
    <Tabs defaultValue="profile" className="space-y-4">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="keys">API keys</TabsTrigger>
        {canPlatform && <TabsTrigger value="platform">Platform</TabsTrigger>}
        {isAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
        {isAdmin && <TabsTrigger value="integrations">Integrations</TabsTrigger>}
        {isAdmin && <TabsTrigger value="activity">Activity</TabsTrigger>}
        <TabsTrigger value="team">Team</TabsTrigger>
        {/* Plan is a SELLER subscription — operator/warehouse/admin have no plan. */}
        {isSeller && <TabsTrigger value="plan">Plan</TabsTrigger>}
      </TabsList>

      <TabsContent value="profile">
        <ProfilePanel />
      </TabsContent>
      <TabsContent value="keys">
        <ApiKeysPanel />
      </TabsContent>
      {canPlatform && (
        <TabsContent value="platform">
          <PlatformPanel />
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="users">
          <UsersPanel />
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="activity">
          <ActivityPanel />
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="integrations">
          <IntegrationsPanel />
        </TabsContent>
      )}
      <TabsContent value="team">
        <TeamPanel />
      </TabsContent>
      {isSeller && (
        <TabsContent value="plan">
          <SubscriptionPanel />
        </TabsContent>
      )}
    </Tabs>
  )
}
