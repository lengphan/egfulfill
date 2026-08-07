"use client"

import { useCallback, useEffect, useState, useContext, createContext, isValidElement, Children } from "react"
import { setActivePalette } from "@/lib/thread-match"
import { nearestColorName } from "@/lib/color-name"
import { useConfirm } from "@/components/app/confirm-dialog"
import { Key, Copy, Check, Trash, Plus, Warning, CurrencyDollar, CircleNotch, UserPlus, SpeakerHigh, SpeakerSlash, MagnifyingGlass, DotsThree, CaretRight, X, DownloadSimple, Database } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { SectionCard } from "@/components/app/section-card"
import { PermissionsMatrix } from "@/components/app/permissions-matrix"
import { usePaged, Pagination } from "@/components/app/pagination"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ActivityFeed } from "@/components/app/activity-feed"
import { ACTION_CATEGORIES } from "@/components/app/activity-meta"
import { IntegrationsPanel } from "@/components/app/integrations-panel"
import { UsagePanel } from "@/components/app/usage-panel"
import { SubscriptionPanel } from "@/components/app/subscription-panel"
import { VolumeBoard } from "@/components/app/volume-board"
import { VolumeTiersPanel } from "@/components/app/volume-tiers-panel"
import { SiteContentPanel } from "@/components/app/site-content-panel"
import { SupplierOrderingSettings } from "@/components/app/supplier-ordering-settings"
import { getUser, updateUser } from "@/lib/auth"
import { UserAvatar, AVATAR_COLORS, AVATAR_EMOJIS } from "@/components/app/user-avatar"
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getTeam,
  getMyInvites,
  ApiError,
  getMyAccess,
  acceptInvite,
  type MyInvite,
  type MyAccess,
  inviteMember,
  removeMember,
  updateTeamMember,
  updateProfile,
  getFactorySettings,
  getVietqrRate,
  setVietqrRate,
  deleteUserAdmin,
  adjustBalance,
  type ShipFromAddress,
  type ProductType,
  type ThreadColor,
  ALL_SIDES,
  setFactorySettings,
  getPinkStatus,
  getUsers,
  updateUserAdmin,
  createUserAdmin,
  getAudit,
  type ApiKey,
  type TeamMember,
  type FactorySettings,
  type AdminUser,
  type AuditRow,
  getPiiRetention,
  setPiiRetention,
  runPiiPurge,
  type PiiRetention,
  listBackups,
  runBackup,
  backupDownloadUrl,
  deleteBackup,
  setBackupConfig,
  type DbBackup,
  type BackupsState,
} from "@/lib/api"

const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
// Compact "how long ago" for the last-active column — a date alone makes you do the
// subtraction; "3d ago" reads at a glance which accounts have gone quiet.
const fmtAgo = (s?: string | null) => {
  if (!s) return null
  const t = new Date(s).getTime()
  if (isNaN(t)) return null
  const secs = Math.max(0, (Date.now() - t) / 1000)
  if (secs < 60) return "just now"
  const mins = secs / 60
  if (mins < 60) return `${Math.floor(mins)}m ago`
  const hrs = mins / 60
  if (hrs < 24) return `${Math.floor(hrs)}h ago`
  const days = hrs / 24
  if (days < 30) return `${Math.floor(days)}d ago`
  const months = days / 30
  if (months < 12) return `${Math.floor(months)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// ─────────────────────────── Profile ───────────────────────────
function ProfilePanel() {
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null)
  const [name, setName] = useState("")
  const [uname, setUname] = useState("")
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
      setUname(u?.username ?? "")
      setEmoji(u?.avatar_emoji ?? "")
      setColor(u?.avatar_color ?? AVATAR_COLORS[0])
      setSound(u?.notify_sound !== false)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const usernameDirty = uname.trim().toLowerCase() !== (user?.username ?? "")
  const nameDirty = !!name.trim() && name.trim() !== (user?.name ?? "")
  const avatarDirty = emoji !== (user?.avatar_emoji ?? "") || color !== (user?.avatar_color ?? AVATAR_COLORS[0])
  const soundDirty = sound !== (user?.notify_sound !== false)
  const dirty = !!user && (nameDirty || usernameDirty || avatarDirty || soundDirty)

  const save = async () => {
    if (!dirty) return
    setSaving(true); setErr(null); setSaved(false)
    try {
      // Send null (not "") to clear — the server treats null as "back to the initial".
      const r = await updateProfile({
        name: name.trim(),
        username: uname.trim() ? uname.trim().toLowerCase() : null,
        avatar_emoji: emoji || null,
        avatar_color: color || null,
        notify_sound: sound,
      })
      if (r.error) throw new Error(r.error)
      const next = { name: r.name ?? name.trim(), username: r.username ?? null, avatar_emoji: emoji || null, avatar_color: color || null, notify_sound: sound }
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

        {/* Username — the SECOND way to sign in (email still works). No '@' allowed,
            which is what stops a username ever colliding with someone's email. */}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Username <span className="font-normal text-muted-foreground">— optional, for signing in</span></span>
          <Input
            value={uname}
            onChange={(e) => { setUname(e.target.value); setSaved(false) }}
            onKeyDown={(e) => { if (e.key === "Enter") save() }}
            placeholder="yourname"
            disabled={!user}
            className="max-w-sm"
          />
          <span className="text-xs text-muted-foreground">3–30 characters: letters, numbers, dot, dash or underscore. Sign in with this or your email.</span>
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
          {saved && <span className="inline-flex items-center gap-1 text-sm text-success"><Check size={14} weight="bold" /> Saved</span>}
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
  // Active keys are all most people need to see; revoked ones pile up and used to push the
  // whole Integrations page down. Tuck them behind a History tab so the panel stays short.
  const [view, setView] = useState<"active" | "history">("active")

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
  const revoked = (keys ?? []).filter((k) => k.revoked_at)
  const shown = view === "active" ? active : revoked

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

      {/* Active / History tabs — keep the panel short by hiding revoked keys by default. */}
      <div className="flex items-center gap-1 border-b border-border px-5 py-2">
        {(["active", "history"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={"eg-tap rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " + (view === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {v === "active" ? `Active${active.length ? ` (${active.length})` : ""}` : `History${revoked.length ? ` (${revoked.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* list */}
      {keys === null ? (
        <div className="space-y-3 p-5">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Key size={22} weight="duotone" />
          </span>
          <div className="font-medium">{view === "active" ? "No active keys" : "No revoked keys"}</div>
          <div className="max-w-xs text-sm text-muted-foreground">
            {view === "active" ? "Generate a test key to call the sandbox endpoints." : "Keys you revoke will show up here."}
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {shown.map((k) => (
            <div key={String(k.id)} className={"flex items-center justify-between gap-4 px-5 py-3.5 " + (k.revoked_at ? "opacity-50" : "")}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{k.label || "Test key"}</span>
                  <Badge variant="secondary" className="text-3xs uppercase">{k.mode}</Badge>
                  {k.revoked_at && <span className="text-2xs font-medium text-red-600">revoked</span>}
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {/* prefix••••last4 — the SAME shape the API Explorer shows, so a key can be
                      matched by its first + last chars. Older keys (no stored last4) show prefix-only. */}
                  {k.last4 ? `${k.prefix.replace(/…$/, "")}••••••••${k.last4}` : k.prefix} · created {fmtDate(k.created_at)} · last used {fmtDate(k.last_used_at)}
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
/** Surfaces an owner can share with a member. Deliberately short — each one hands over
 *  something private, so the list should stay a decision rather than a checklist. */
// Everything a team leader can hand to a member, mirroring the seller sidebar so the
// toggles read as "which of my pages does this person get". Ids are the surface keys the
// server checks (orders/wallet/files are enforced in the API too — see canSurface below;
// the rest gate the nav + pages).
//
// Settings is deliberately NOT shareable: it's where team permissions and billing live,
// so sharing it would let a member grant themselves everything. Help is always open.
const SHAREABLE = [
  { id: "dashboard", label: "Dashboard" },
  { id: "orders", label: "Orders" },
  { id: "products", label: "Products" },
  { id: "stores", label: "Stores" },
  { id: "spydeck", label: "SpyDeck" },
  { id: "reports", label: "Reports" },
  { id: "wallet", label: "Wallet" },
  // Not a page — a figure. Separate from Wallet on purpose: someone running the order
  // queue often needs to see what a job cost without being shown the account balance,
  // and the two were one toggle only because no one had needed to split them. Enforced
  // in the API (GET /api/orders/:id/charges returns `gated` with no amounts), so turning
  // it off withholds the numbers rather than merely hiding the panel.
  { id: "order_fees", label: "Order fees" },
  { id: "design", label: "Design Lab" },
  { id: "files", label: "Design files" },
  { id: "chat", label: "Chat" },
  { id: "developers", label: "Developers" },
]

const usd2 = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function TeamPanel() {
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("editor")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // My OWN side of teams: invites waiting on me, and whether I'm already someone's
  // member. Without this the panel only ever showed the team I lead, so an invited
  // teammate saw "No team members yet" and had no way to accept — which left them
  // 'invited' forever, and an un-accepted membership applies NO permission limits.
  const [invites, setInvites] = useState<MyInvite[]>([])
  const [access, setAccess] = useState<MyAccess | null>(null)
  const [acceptBusy, setAcceptBusy] = useState<string | null>(null)
  // Why the invite list is empty. Swallowing this made an expired session, a network
  // failure and "you have no invites" render as the same blank panel — so a notification
  // saying "you were invited" sat next to a page showing nothing, with no way to tell
  // which of the three was happening.
  const [inviteErr, setInviteErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getTeam()
      .then((rows) => setMembers(rows ?? []))
      .catch(() => setMembers([]))
    getMyInvites()
      .then((r) => { setInvites(r ?? []); setInviteErr(null) })
      .catch((e) => {
        setInvites([])
        // ApiError carries the real status — read it rather than pattern-matching a
        // message, which changes whenever the server's wording does.
        const status = e instanceof ApiError ? e.status : 0
        setInviteErr(
          status === 401
            ? "Your session has expired — sign out and back in to see invites."
            : `Couldn't load invites${status ? ` (${status})` : ""}: ${e instanceof Error ? e.message : String(e)}`
        )
      })
    getMyAccess().then(setAccess).catch(() => setAccess(null))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const onAccept = async (inv: MyInvite) => {
    setAcceptBusy(inv.id); setErr(null)
    try {
      const r = await acceptInvite(inv.invite_token)
      if (r.error) throw new Error(r.error)
      load()
      // The nav is permission-filtered — re-read it now that limits actually apply.
      window.dispatchEvent(new CustomEvent("eg-perms-changed"))
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Couldn't accept that invite.")
    } finally { setAcceptBusy(null) }
  }

  /** Decline a pending invite, or leave a team you've joined. Same row either way. */
  const onDropMembership = async (id: string, label: string) => {
    setAcceptBusy(id); setErr(null)
    try {
      await removeMember(id)
      load()
      window.dispatchEvent(new CustomEvent("eg-perms-changed"))
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : `Couldn't ${label}.`)
    } finally { setAcceptBusy(null) }
  }

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

  // Optimistic: the pill flips instantly, and only reloads from the server if the write
  // failed — a toggle that lags behind the click feels broken.
  const onPerms = async (id: TeamMember["id"], permissions: string[]) => {
    setMembers((prev) => (prev ?? []).map((m) => (m.id === id ? { ...m, permissions } : m)))
    try {
      await updateTeamMember(id, { permissions })
      // Tell any open session (incl. the member's own tab) to re-read its access so the
      // sidebar reflects the change without a reload.
      window.dispatchEvent(new CustomEvent("eg-perms-changed"))
    } catch { load() }
  }

  // Removing is one click and irreversible (they'd need re-inviting), so it asks first —
  // and the dialog spells out that it does NOT delete their account, which is the thing a
  // leader would otherwise be afraid of.
  const [removing, setRemoving] = useState<TeamMember | null>(null)
  const onRemove = async (id: TeamMember["id"]) => {
    setMembers((prev) => (prev ?? []).filter((m) => m.id !== id))
    setRemoving(null)
    try {
      await removeMember(id)
      // Their access is resolved per-request from team_members, so it's already revoked;
      // this just refreshes any open view.
      window.dispatchEvent(new CustomEvent("eg-perms-changed"))
    } catch {
      load()
    }
  }

  return (
    <SectionCard title="Team" description="Members and their access">
      {/* MY side of things. An invite has to be accepted before any sharing limits take
          effect — until then the membership is 'invited' and the member sees everything,
          which looked exactly like "the toggles don't work". */}
      {inviteErr && (
        <div className="border-b border-border bg-destructive/10 px-5 py-3 text-sm text-destructive">{inviteErr}</div>
      )}
      {invites.map((inv) => (
        <div key={inv.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-primary/5 px-5 py-3">
          <div className="min-w-0 flex-1">
            {/* One line, not three. The identity and the consequence are what matter;
                the previous card spent four lines saying it and pushed everything else
                down the panel. The email is always shown because "Leng" is a display
                name anyone can set — accepting shares your data, so identify them by
                the thing they had to prove they own. */}
            <div className="truncate text-sm">
              <span className="font-medium">{inv.owner_name}</span>
              {inv.owner_email && inv.owner_email !== inv.owner_name && (
                <span className="text-muted-foreground"> ({inv.owner_email})</span>
              )}
              <span className="text-muted-foreground"> invited you as {inv.role}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              Accepting limits your menu to the pages they shared.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => onDropMembership(inv.id, "decline")} disabled={acceptBusy === inv.id}>
              Decline
            </Button>
            <Button size="sm" onClick={() => onAccept(inv)} disabled={acceptBusy === inv.id}>
              {acceptBusy === inv.id ? "Accepting…" : "Accept invite"}
            </Button>
          </div>
        </div>
      ))}

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
          className="eg-select h-9 rounded-2xl border border-border bg-card px-3 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
              <div className="flex items-start gap-2">
                {/* Every surface, off by default — a teammate added to help with orders
                    shouldn't inherit the wallet or paid design files by accident. On =
                    filled, off = plain; the label alone says which page, and the colour
                    says whether they get it. Seeing is not spending: buying and
                    withdrawing stay the owner's regardless of these. */}
                <div className="flex flex-wrap justify-end gap-1.5">
                  {SHAREABLE.map((s) => {
                    const perms = Array.isArray(m.permissions) ? m.permissions : []
                    const on = perms.includes(s.id)
                    return (
                      <button
                        key={s.id}
                        aria-pressed={on}
                        onClick={() => onPerms(m.id, on ? perms.filter((x) => x !== s.id) : [...perms, s.id])}
                        title={on ? `${s.label} — shared, click to stop sharing` : `${s.label} — not shared, click to share`}
                        className={"eg-tap rounded-full px-2.5 py-1 text-xs font-medium transition-colors " +
                          (on
                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                            : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground")}
                      >
                        {s.label}
                      </button>
                    )
                  })}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-red-600"
                  onClick={() => setRemoving(m)}
                >
                  <Trash size={14} weight="bold" /> Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Your membership of SOMEONE ELSE'S team. Below the table on purpose: the table
          above is the team you LEAD, this is a team you're IN, and stacking it on top
          pushed the invite form and the member list down behind information that isn't
          about them. */}
      {access?.member && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-5 py-3 text-sm">
          <span className="min-w-0">
            <span className="font-medium">You&apos;re on {access.ownerName}&apos;s team</span>
            <span className="text-muted-foreground">
              {" "}· {access.role ?? "member"} · {(access.permissions?.length ?? 0)} page
              {(access.permissions?.length ?? 0) === 1 ? "" : "s"} shared with you
            </span>
          </span>
          {access.membershipId && (
            <Button
              size="sm" variant="outline" className="ml-auto"
              onClick={() => onDropMembership(String(access.membershipId), "leave the team")}
              disabled={acceptBusy === String(access.membershipId)}
            >
              Leave team
            </Button>
          )}
        </div>
      )}

      {/* Remove = revoke access, NOT delete the person. Their login and their own seller
          account survive; they simply stop resolving to this team and land back on their
          own (empty) board. Saying so plainly matters — otherwise "Remove" reads like it
          deletes a human being's account. */}
      <Dialog open={!!removing} onOpenChange={(v) => { if (!v) setRemoving(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removing?.email} from your team?</DialogTitle>
            <DialogDescription>They lose access to your account immediately.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />Your orders, wallet, stores and design files are hidden from them right away.</li>
            <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />Work they did stays on your account — nothing of yours is deleted.</li>
            <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500/60" />Their account is <span className="font-medium text-foreground">not</span> deleted. They keep the same login and go back to their own empty seller board.</li>
            <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />To bring them back later, invite the same email again.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => removing && onRemove(removing.id)}>Remove from team</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

/**
 * The base-cost formula, shown as the equation it actually is.
 *
 * As a plain "Base cost markup" money box, nothing on screen said what it did to a
 * price — you had to already know that pricing reads it. Rendering the formula makes
 * the default legible too: leave it at 0 and base cost simply equals product cost.
 */
function MarkupFormula({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const x = Number(value) || 0
  const example = 12.5
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <span className="text-sm font-medium">Base cost formula</span>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <span className="text-sm font-medium">Base cost</span>
        <span className="text-muted-foreground">=</span>
        <span className="rounded-md bg-background px-2 py-1 text-sm font-medium">Product cost</span>
        <span className="text-muted-foreground">+</span>
        <div className="relative w-28">
          <CurrencyDollar size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00" inputMode="decimal" className="h-9 pl-7"
            aria-label="Base cost markup"
          />
        </div>
      </div>
      <span className="text-xs text-muted-foreground">
        {x > 0
          ? `A blank costing $${example.toFixed(2)} from your supplier sells at $${(example + x).toFixed(2)} before the print-method surcharge.`
          : "Leave it at 0 and base cost simply copies the product cost — set a number here to add a default margin to every synced product."}
        {" "}A base cost typed on a product always wins, and print-method surcharges are added on top.
      </span>
    </div>
  )
}

/** Plain text counterpart to MoneyField, so the address rows match the money rows. */
function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </label>
  )
}

/**
 * A collapsible block inside Platform.
 *
 * The page stacked five independent settings — fees, product types with an outline grid
 * per category, the ship-from address, shipping bands, method surcharges — so reaching
 * any one meant scrolling past the rest. They share a page, not a purpose; folded, the
 * page becomes a menu instead of a wall.
 */
/**
 * A named group inside a Fold, with its fields two-across.
 *
 * Nine money fields in one column read as nine separate decisions to get right. They are
 * really three: what a seller pays us for design work, what they pay for the file, and what
 * we pay a designer. Grouping says which is which; the two-column grid stops the list
 * looking longer than it is.
 */
function FeeGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const q = useContext(SettingsSearch)
  // Filter the ROWS, not just the group. Opening a fold because one field matched and then
  // showing all fourteen of its fields is the same "where is it" problem one level down.
  // A group whose own title matches keeps all its rows — you asked for the group.
  const groupItself = !!q && [title, hint].join(" ").toLowerCase().includes(q)
  const rows = !q || groupItself
    ? children
    : Children.toArray(children).filter((c) => matches(c, q))
  if (q && !groupItself && Children.count(rows) === 0) return null
  return (
    <section className="mt-5 first:mt-0">
      <h4 className="text-sm font-semibold uppercase tracking-widest text-primary">{title}</h4>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">{rows}</div>
    </section>
  )
}

/**
 * SETTINGS SEARCH.
 *
 * This page is ~10 folds deep and every one of them is a legitimate factory setting, so it
 * can't be shortened by deleting things — the answer to "I can't find anything" has to be
 * filtering, not fewer settings.
 *
 * The searchable text is read straight off the JSX: every control here is a declarative
 * <Fold>/<FeeGroup>/<MoneyField> with its label, title and hint in props, so walking the
 * element tree gives the same words the person is looking at. That's deliberately not a
 * hand-maintained keyword index — an index drifts the first time someone renames a field,
 * and the failure is silent (the setting simply stops being findable).
 */
const SettingsSearch = createContext("")

/** Every word rendered by a node, gathered from the props that actually become text. */
function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join(" ")
  if (isValidElement(node)) {
    const p = (node.props ?? {}) as Record<string, unknown>
    const own = [p.label, p.title, p.hint, p.description]
      .filter((t): t is string => typeof t === "string").join(" ")
    return own + " " + nodeText(p.children as React.ReactNode)
  }
  return ""
}

const matches = (node: React.ReactNode, q: string) =>
  !q || nodeText(node).toLowerCase().includes(q)

function Fold({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const q = useContext(SettingsSearch)
  // A search that leaves everything collapsed has answered nothing, so a matching fold opens
  // itself — and closes back to whatever the person had chosen once the box is cleared.
  if (!matches([title, hint, children], q)) return null
  const expanded = open || !!q
  return (
    <div className="border-t border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="eg-tap flex w-full items-center gap-2 px-5 py-3.5 text-left transition-colors hover:bg-accent/40"
      >
        <CaretRight size={13} weight="bold" className={"shrink-0 text-muted-foreground transition-transform " + (expanded ? "rotate-90" : "")} />
        <span className="text-sm font-medium">{title}</span>
        {hint && <span className="truncate text-xs text-muted-foreground">· {hint}</span>}
      </button>
      {expanded && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

function PlatformPanel() {
  const [loaded, setLoaded] = useState<FactorySettings | null>(null)
  const [designFee, setDesignFee] = useState("")
  const [designStd, setDesignStd] = useState("")
  const [designCx, setDesignCx] = useState("")
  const [checkFee, setCheckFee] = useState("")
  const [embCx, setEmbCx] = useState("")
  // base cost = supplier product cost + this. Lets a supplier sync fill in only what a
  // blank COSTS us, and the sell price follows from one number instead of a hand-typed
  // price per size per product.
  const [baseMarkup, setBaseMarkup] = useState("")
  // Partner rates. Neither the dispatch partner nor the design partner has a billing API
  // we can query, so what they cost us is a FIXED figure we set here and book per job.
  // Until it's set the rate is 0 — and recordCost skips anything <= 0, so no partner cost
  // is recorded at all and their Billing statement reads as though they did no work.
  const [expediteFee, setExpediteFee] = useState("")
  const [tiktokLabelFee, setTiktokLabelFee] = useState("")
  const [settingsQ, setSettingsQ] = useState("")
  const [expediteCost, setExpediteCost] = useState("")
  const [designPartnerCost, setDesignPartnerCost] = useState("")
  // Default Pink Design product type: the value applied to every push, plus the options to
  // choose it from (pulled live from Pink so a renamed type never goes stale).
  const [pinkProductType, setPinkProductType] = useState("")
  const [pinkTypeOptions, setPinkTypeOptions] = useState<{ value: string; label: string }[]>([])
  const [orderLimitDefault, setOrderLimitDefault] = useState("")
  const [capacityNotice, setCapacityNotice] = useState("")
  const [lookbookTitle, setLookbookTitle] = useState("")
  const [lookbookTagline, setLookbookTagline] = useState("")
  const [lookbookAccent, setLookbookAccent] = useState("")
  const [lookbookContact, setLookbookContact] = useState("")
  const [capacityMode, setCapacityMode] = useState(false)
  const [factoryDailyLimit, setFactoryDailyLimit] = useState("")
  const [shipFirst, setShipFirst] = useState("")
  const [shipExtra, setShipExtra] = useState("")
  const [embPrice, setEmbPrice] = useState("")
  // Seller payout guardrails. Max = 0 means "no fixed ceiling — the seller's balance is the
  // cap", which always applies regardless.
  const [payoutMin, setPayoutMin] = useState("")
  const [payoutMax, setPayoutMax] = useState("")
  // USD→VND rate for VietQR top-ups (separate endpoint; admin-only to change).
  const [vqrRate, setVqrRate] = useState("")
  // Volume tiers: top up ≥ $usd, get the better $1 = rate₫. Held as strings for editing.
  const [vqrTiers, setVqrTiers] = useState<{ usd: string; rate: string }[]>([])
  // Top-up minimum (USD, applies to EVERY method) + the quick-amount presets. Presets held
  // as comma-separated strings for easy editing; parsed to number[] on save.
  const [vqrMin, setVqrMin] = useState("")
  const [vqrSmall, setVqrSmall] = useState("")
  const [vqrBulk, setVqrBulk] = useState("")
  const isAdminUser = (getUser()?.role || "") === "admin"
  const setTier = (i: number, k: "usd" | "rate", v: string) => setVqrTiers((ts) => ts.map((t, j) => (j === i ? { ...t, [k]: v.replace(/[^0-9]/g, "") } : t)))
  const addTier = () => setVqrTiers((ts) => [...ts, { usd: "", rate: "" }])
  const removeTier = (i: number) => setVqrTiers((ts) => ts.filter((_, j) => j !== i))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Flat shipping bands + per-method surcharges. Held as strings so a half-typed "5." is
  // not fought by Number() on every keystroke.
  const [bands, setBands] = useState<Record<string, string>>({})
  // The warehouse's own return address — the origin every shipping label is bought
  // against. Lives here rather than in the ship dialog because it's set once for the
  // whole team, not per shipment.
  const [shipFrom, setShipFrom] = useState<ShipFromAddress>({})
  // Where returns go, when that isn't where we ship from. Blank street = unset, and the
  // carrier falls back to the sender — which is what happened before this field existed.
  const [returnAddr, setReturnAddr] = useState<ShipFromAddress>({})
  // Product types + the mockup that stands in for the whole category.
  const [types, setTypes] = useState<ProductType[]>([])
  const [newType, setNewType] = useState("")
  // The factory's embroidery cone stock. Matching is only ever as good as what's on the
  // shelf — with the built-in 16 a light blue resolves to Grey — so this is floor data,
  // not a code constant.
  const [threads, setThreads] = useState<ThreadColor[]>([])
  const [newThread, setNewThread] = useState<ThreadColor>({ code: "", name: "", hex: "#000000" })
  const setFromField = (k: keyof ShipFromAddress, v: string) => setShipFrom((p) => ({ ...p, [k]: v }))
  const setReturnField = (k: keyof ShipFromAddress, v: string) => setReturnAddr((p) => ({ ...p, [k]: v }))
  const setBand = (k: string, v: string) => setBands((p) => ({ ...p, [k]: v.replace(/[^0-9.]/g, "") }))

  const load = useCallback(() => {
    getFactorySettings().then((r) => {
      setLoaded(r)
      setDesignFee(r.designer_payout != null ? String(r.designer_payout) : "")
      setDesignStd(r.design_fee_standard != null ? String(r.design_fee_standard) : "")
      setDesignCx(r.design_fee_complex != null ? String(r.design_fee_complex) : "")
      setCheckFee(r.check_fee != null ? String(r.check_fee) : "")
      setEmbCx(r.emb_price_complex != null ? String(r.emb_price_complex) : "")
      setBaseMarkup(r.base_markup != null ? String(r.base_markup) : "")
      setExpediteFee(r.expedite_fee != null ? String(r.expedite_fee) : "")
      setTiktokLabelFee(r.tiktok_label_fee != null ? String(r.tiktok_label_fee) : "")
      setExpediteCost(r.expedite_cost != null ? String(r.expedite_cost) : "")
      setDesignPartnerCost(r.design_partner_cost != null ? String(r.design_partner_cost) : "")
      setPinkProductType(r.pink_product_type != null ? String(r.pink_product_type) : "")
      setOrderLimitDefault(r.order_limit_default != null ? String(r.order_limit_default) : "")
      setCapacityNotice(r.capacity_notice != null ? String(r.capacity_notice) : "")
      setLookbookTitle(r.lookbook_title != null ? String(r.lookbook_title) : "")
      setLookbookTagline(r.lookbook_tagline != null ? String(r.lookbook_tagline) : "")
      setLookbookAccent(r.lookbook_accent != null ? String(r.lookbook_accent) : "")
      setLookbookContact(r.lookbook_contact != null ? String(r.lookbook_contact) : "")
      setCapacityMode(!!Number(r.capacity_mode || 0))
      setFactoryDailyLimit(r.factory_daily_limit != null ? String(r.factory_daily_limit) : "")
      setShipFirst(r.ship_first != null ? String(r.ship_first) : "")
      setShipExtra(r.ship_extra != null ? String(r.ship_extra) : "")
      setEmbPrice(r.emb_price != null ? String(r.emb_price) : "")
      setPayoutMin(r.payout_min != null ? String(r.payout_min) : "")
      setPayoutMax(r.payout_max != null ? String(r.payout_max) : "")
      setShipFrom(r.ship_from ?? {})
      setReturnAddr(r.return_address ?? {})
      setReturnAddr(r.return_address ?? {})
      getVietqrRate().then((v) => {
        setVqrRate(v.rate ? String(v.rate) : "")
        setVqrTiers((v.tiers || []).map((t) => ({ usd: String(t.usd), rate: String(t.rate) })))
        setVqrMin(v.minUsd != null ? String(v.minUsd) : "")
        setVqrSmall((v.smallPresets || []).join(", "))
        setVqrBulk((v.bulkPresets || []).join(", "))
      }).catch(() => {})
      setTypes(r.product_types ?? [])
      setThreads(r.thread_palette ?? [])
      setBands(Object.fromEntries(
        ["ship_cap", "ship_heavy", "ship_garment", "method_dtg", "method_dtf", "method_emb", "method_apl", "method_lsr"]
          .map((k) => [k, r[k] != null ? String(r[k]) : ""])
      ))
    }).catch(() => setLoaded({}))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  // Pink Design product types — for the default-type picker. Pulled live so a renamed type on
  // Pink's side never leaves a stale hardcoded option. Best-effort: no options if Pink is off.
  useEffect(() => {
    const id = setTimeout(() => {
      getPinkStatus().then((s) => {
        const raw = s.productTypes
        const arr = Array.isArray(raw) ? raw
          : (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown[] }).data)) ? (raw as { data: unknown[] }).data : []
        setPinkTypeOptions(arr.map((x) => {
          if (typeof x === "string") return { value: x, label: x }
          const o = (x ?? {}) as Record<string, unknown>
          const value = String(o.id ?? o.key ?? o.value ?? o.code ?? o.name ?? "")
          return { value, label: String(o.name ?? o.title ?? o.label ?? value) }
        }).filter((o) => o.value))
      }).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const save = async () => {
    setSaving(true); setErr(null); setSaved(false)
    try {
      const r = await setFactorySettings({
        designer_payout: designFee === "" ? undefined : Number(designFee),
        design_fee_standard: designStd === "" ? undefined : Number(designStd),
        design_fee_complex: designCx === "" ? undefined : Number(designCx),
        check_fee: checkFee === "" ? undefined : Number(checkFee),
        emb_price_complex: embCx === "" ? undefined : Number(embCx),
        base_markup: baseMarkup === "" ? undefined : Number(baseMarkup),
        expedite_fee: expediteFee === "" ? undefined : Number(expediteFee),
        tiktok_label_fee: tiktokLabelFee === "" ? undefined : Number(tiktokLabelFee),
        expedite_cost: expediteCost === "" ? undefined : Number(expediteCost),
        design_partner_cost: designPartnerCost === "" ? undefined : Number(designPartnerCost),
        pink_product_type: pinkProductType,
        order_limit_default: orderLimitDefault === "" ? undefined : Number(orderLimitDefault),
        capacity_notice: capacityNotice,
        lookbook_title: lookbookTitle,
        lookbook_tagline: lookbookTagline,
        lookbook_accent: lookbookAccent,
        lookbook_contact: lookbookContact,
        capacity_mode: capacityMode ? 1 : 0,
        factory_daily_limit: factoryDailyLimit === "" ? undefined : Number(factoryDailyLimit),
        ship_first: shipFirst === "" ? undefined : Number(shipFirst),
        ship_extra: shipExtra === "" ? undefined : Number(shipExtra),
        emb_price: embPrice === "" ? undefined : Number(embPrice),
        payout_min: payoutMin === "" ? undefined : Number(payoutMin),
        payout_max: payoutMax === "" ? undefined : Number(payoutMax),
        ...Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, v === "" ? undefined : Number(v)])),
        ship_from: shipFrom,
        return_address: returnAddr,
        product_types: types,
        thread_palette: threads,
      })
      if (r.error) throw new Error(r.error)
      // The VietQR rate + volume tiers + top-up min/presets live on their own admin-only endpoint.
      if (isAdminUser && vqrRate !== "" && Number(vqrRate) > 0) {
        const cleanTiers = vqrTiers
          .map((t) => ({ usd: Number(t.usd) || 0, rate: Number(t.rate) || 0 }))
          .filter((t) => t.usd > 0 && t.rate > 0)
        const parseList = (s: string) => s.split(/[,\s]+/).map((x) => Math.round(Number(x))).filter((x) => x > 0)
        const rr = await setVietqrRate(Number(vqrRate), cleanTiers, {
          minUsd: vqrMin === "" ? undefined : Math.max(0, Math.round(Number(vqrMin) || 0)),
          smallPresets: vqrSmall.trim() ? parseList(vqrSmall) : undefined,
          bulkPresets: vqrBulk.trim() ? parseList(vqrBulk) : undefined,
        })
        if (rr.error) throw new Error(rr.error)
      }
      // Push the new stock into the matcher so open boards stop matching against the
      // palette that was just replaced.
      setActivePalette(r.thread_palette ?? threads)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save — warehouse/admin only.")
    } finally { setSaving(false) }
  }

  if (loaded === null) return <SectionCard title="Platform"><div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div></SectionCard>

  return (
    <SectionCard title="Platform" description="Factory-wide defaults (warehouse & admin)">
      <SettingsSearch.Provider value={settingsQ.trim().toLowerCase()}>
      {/* Sticky, because the point is to type a word and watch the page below it shrink —
          scrolling away from the box you're filtering with defeats that. */}
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 px-5 py-3 backdrop-blur">
        <div className="relative">
          <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={settingsQ}
            onChange={(e) => setSettingsQ(e.target.value)}
            placeholder="Search settings — try “tiktok”, “shipping”, “payout”…"
            className="h-9 pl-8"
            aria-label="Search settings"
          />
          {!!settingsQ && (
            <button
              onClick={() => setSettingsQ("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X size={12} weight="bold" />
            </button>
          )}
        </div>
      </div>
      <Fold title="Warehouse ship-from address" hint="the sender on every label">

        <p className="mb-3 text-xs text-muted-foreground">
          Where parcels are tendered from. Set once for the whole team. If returns come back
          somewhere else, set that separately below.
        </p>
        {!(shipFrom.street && shipFrom.city && shipFrom.state && shipFrom.zip) && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
            No ship-from address yet — buying a label will fail until street, city, state and ZIP are filled in.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name / company" value={shipFrom.name ?? ""} onChange={(v) => setFromField("name", v)} />
          <TextField label="Phone" value={shipFrom.phone ?? ""} onChange={(v) => setFromField("phone", v)} />
          <TextField label="Street" value={shipFrom.street ?? ""} onChange={(v) => setFromField("street", v)} />
          <TextField label="Suite / unit" value={shipFrom.street2 ?? ""} onChange={(v) => setFromField("street2", v)} />
          <TextField label="City" value={shipFrom.city ?? ""} onChange={(v) => setFromField("city", v)} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="State" value={shipFrom.state ?? ""} onChange={(v) => setFromField("state", v)} />
            <TextField label="ZIP" value={shipFrom.zip ?? ""} onChange={(v) => setFromField("zip", v)} />
          </div>
        </div>

        {/* BLIND SHIPPING. The switch is here rather than buried in the API, because the
            thing it changes — what a buyer reads on the parcel — is exactly the thing
            someone will want to undo in a hurry if it looks wrong. */}
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={shipFrom.blind !== false}
            onChange={(e) => setShipFrom((p) => ({ ...p, blind: e.target.checked }))}
          />
          <span className="text-xs">
            <span className="font-medium">Ship under each seller&rsquo;s shop name</span>
            <span className="block text-muted-foreground">
              The sender name becomes the seller&rsquo;s own shop, at the address above — so a buyer
              sees the shop they bought from, and two parcels from two shops don&rsquo;t advertise a
              shared factory. Only the name changes; carriers route on the address, so returns
              still come here. Turn this off and every label reverts to
              &ldquo;{shipFrom.name || "the name above"}&rdquo;.
            </span>
          </span>
        </label>
      </Fold>

      {/* A SEPARATE return address. Once the sender name is the seller's shop, the sender
          block can no longer double as "send it back to us under our own name" — so this is
          its own address, with its own name, sent to the carrier as address_return
          (Shippo) / return_address (EasyPost). Left blank, the carrier falls back to the
          sender, which is what happened before this field existed. */}
      <Fold title="Return address" hint="where undeliverable parcels come back to">
        <p className="mb-3 text-xs text-muted-foreground">
          Only needed if returns come back to a <b>different address</b> than the one you ship
          from. Leave it blank and returns follow the ship-from address above. The name here is
          yours — it is never replaced by the seller&rsquo;s shop name.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name / company" value={returnAddr.name ?? ""} onChange={(v) => setReturnField("name", v)} />
          <TextField label="Phone" value={returnAddr.phone ?? ""} onChange={(v) => setReturnField("phone", v)} />
          <TextField label="Street" value={returnAddr.street ?? ""} onChange={(v) => setReturnField("street", v)} />
          <TextField label="Suite / unit" value={returnAddr.street2 ?? ""} onChange={(v) => setReturnField("street2", v)} />
          <TextField label="City" value={returnAddr.city ?? ""} onChange={(v) => setReturnField("city", v)} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="State" value={returnAddr.state ?? ""} onChange={(v) => setReturnField("state", v)} />
            <TextField label="ZIP" value={returnAddr.zip ?? ""} onChange={(v) => setReturnField("zip", v)} />
          </div>
        </div>
        {/* Half an address is worse than none: the carrier may accept it and print something
            undeliverable. Say so while it's still being typed. */}
        {!!(returnAddr.street || returnAddr.city || returnAddr.zip)
          && !(returnAddr.street && returnAddr.city && returnAddr.state && returnAddr.zip) && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
            Incomplete return address — street, city, state and ZIP are all needed. Until then
            returns fall back to the ship-from address.
          </div>
        )}
      </Fold>
      <Fold title="Fees" hint="design charges, payout, file price, default shipping">
        {/* MONEY OUT first, then money in, and the direction is written into every hint.
            These sat together unlabelled when the payout was called "design fee", which is
            how a rate paid TO a designer read as a charge made to a seller. */}
        {/* EXACTLY ONE of these three applies to a line, decided by where the machine file
            came from. Said once here rather than three times in three hints, because the
            thing that confuses is not each fee — it is not knowing they are alternatives. */}
        <FeeGroup
          title="Design work — what a seller pays"
          hint="One of these three, never two: it depends on who cut the machine file."
        >
          <MoneyField label="We cut it — standard" hint="Their artwork, ordinary difficulty" value={designStd} onChange={setDesignStd} />
          <MoneyField label="We cut it — complex" hint="Intricate. Quoted first; charged only if they accept" value={designCx} onChange={setDesignCx} />
          <MoneyField label="They sent their own file" hint="We open and check it rather than cut it" value={checkFee} onChange={setCheckFee} />
        </FeeGroup>

        <FeeGroup
          title="The file itself — what a seller pays"
          hint="Charged separately, when they want to download the .pes/.emb. Paying for the work and owning the file are two transactions."
        >
          <MoneyField label="Download — standard" value={embPrice} onChange={setEmbPrice} />
          <MoneyField label="Download — complex" hint="When the design work was complex" value={embCx} onChange={setEmbCx} />
        </FeeGroup>

        <FeeGroup
          title="What we pay out"
          hint="Money leaving us, not a seller charge — the only figure on this page that does."
        >
          <MoneyField label="Designer payout" hint="Per approved design, to the designer who claimed it" value={designFee} onChange={setDesignFee} />
        </FeeGroup>
        <FeeGroup
          title="Seller payouts"
          hint="The limits a seller sees when cashing out their wallet. A payout can never exceed their balance regardless of these."
        >
          <MoneyField label="Minimum payout" hint="Smallest amount a seller can request" value={payoutMin} onChange={setPayoutMin} />
          <MoneyField label="Maximum payout" hint="Largest single request. Set 0 for no cap beyond the seller's balance." value={payoutMax} onChange={setPayoutMax} />
        </FeeGroup>
        {isAdminUser && (
          <FeeGroup
            title="VietQR top-up rate"
            hint="USD→VND. A seller picks a dollar amount to add; this converts it to the VND their QR charges, and that exact USD credits on payment."
          >
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Base rate — VND per $1</span>
              <Input value={vqrRate} onChange={(e) => setVqrRate(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="25400" className="h-9" />
              <span className="text-2xs text-muted-foreground">e.g. 25400 means $50 → 1,270,000₫</span>
            </label>
            {/* Volume discounts — each row: at/above $usd, the seller pays this better $1 = rate₫. */}
            <div className="sm:col-span-2 space-y-2">
              <span className="text-sm font-medium">Volume discounts</span>
              <p className="text-2xs text-muted-foreground">A better rate the more a seller adds. Lower ₫/$1 = a bigger discount. Shown in Add Funds under &ldquo;Top up more for a better rate&rdquo;.</p>
              {vqrTiers.length === 0 && <p className="text-2xs italic text-muted-foreground">No tiers yet — everyone gets the base rate.</p>}
              {vqrTiers.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="relative w-24">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <Input value={t.usd} onChange={(e) => setTier(i, "usd", e.target.value)} inputMode="numeric" placeholder="2000" className="h-9 pl-5" />
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">→ $1 =</span>
                  <Input value={t.rate} onChange={(e) => setTier(i, "rate", e.target.value)} inputMode="numeric" placeholder="26000" className="h-9 flex-1" />
                  <span className="shrink-0 text-xs text-muted-foreground">₫</span>
                  <button type="button" onClick={() => removeTier(i)} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-red-600" aria-label="Remove tier"><X size={15} weight="bold" /></button>
                </div>
              ))}
              <button type="button" onClick={addTier} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Plus size={13} weight="bold" /> Add tier</button>
            </div>
          </FeeGroup>
        )}
        {isAdminUser && (
          <FeeGroup
            title="Top-up amounts"
            hint="Applies to EVERY method (Transfer, QR, Card). The minimum a seller may add, and the quick-amount buttons shown in Add Funds."
          >
            <MoneyField label="Minimum top-up" hint="Smallest amount a seller can add, any method. Currently $200." value={vqrMin} onChange={setVqrMin} />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Quick amounts</span>
              <Input value={vqrSmall} onChange={(e) => setVqrSmall(e.target.value.replace(/[^0-9,\s]/g, ""))} inputMode="numeric" placeholder="50, 100, 200, 500, 1000" className="h-9" />
              <span className="text-2xs text-muted-foreground">Comma-separated. Amounts below the minimum are hidden automatically.</span>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-sm font-medium">Bulk amounts</span>
              <Input value={vqrBulk} onChange={(e) => setVqrBulk(e.target.value.replace(/[^0-9,\s]/g, ""))} inputMode="numeric" placeholder="2000, 5000, 10000, 20000" className="h-9" />
              <span className="text-2xs text-muted-foreground">The larger &ldquo;top up more&rdquo; suggestions. Comma-separated.</span>
            </label>
          </FeeGroup>
        )}
        <FeeGroup
          title="Product & shipping"
          hint="What a blank sells for, and what carriage adds. Unrelated to design — separated so the design decisions above can be read on their own."
        >
          <div className="sm:col-span-2"><MarkupFormula value={baseMarkup} onChange={setBaseMarkup} /></div>
          <MoneyField label="Shipping — first item" value={shipFirst} onChange={setShipFirst} />
          <MoneyField label="Shipping — each additional" value={shipExtra} onChange={setShipExtra} />
          {/* Belongs with the seller's shipping charges, not with partner rates: this is
              money coming IN from a seller, and the two rate blocks read in opposite
              directions. Only TikTok-SHIPPED orders — a seller-shipped TikTok order buys a
              real label through the rates above and must never pay both. */}
          <MoneyField
            label="TikTok label fee"
            hint="Per TikTok-shipped order, charged on import. TikTok made the label, so there's no carriage to buy — this is handling. 0 = off."
            value={tiktokLabelFee} onChange={setTiktokLabelFee}
          />
        </FeeGroup>
      </Fold>

      {/* Product types. The default mockup is the labour-saver: set one 2D outline per
          category and every product in it inherits a blank for the Design Maker, instead
          of an upload per product. A product's own mockup still wins. */}
      <Fold title="Partner rates" hint="what outside partners cost us, per job">

        <p className="mb-3 text-xs text-muted-foreground">
          Neither partner can be billed through an API — byeastside and Pink Design both
          settle by invoice — so what they cost us is a fixed figure set here and booked
          against every job as it happens. <strong>A rate of 0 records nothing</strong>, so
          their statement on the Billing page will be empty until these are set.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField
            label="Dispatch — what byeastside charges us"
            hint="Per label they pick. Booked as expedite-cost when a label is pushed."
            value={expediteCost} onChange={setExpediteCost}
          />
          <MoneyField
            label="Dispatch — what we charge the seller"
            hint="Per expedited order. Charged to the seller's wallet at push time."
            value={expediteFee} onChange={setExpediteFee}
          />
          <MoneyField
            label="Design — what Pink Design charges us"
            hint="Per outsourced task. Booked when the card is approved."
            value={designPartnerCost} onChange={setDesignPartnerCost}
          />
        </div>

        {/* Default product type sent to Pink on every push — set once so the card's send form
            doesn't ask for it. Options come live from Pink; empty = pick per card. */}
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">Default product type for Pink Design</label>
          <p className="mb-1.5 text-xs text-muted-foreground">
            Applied to every design sent to Pink, so the card&apos;s send form won&apos;t ask for it.
            Choose <strong>No default</strong> to pick per card instead.
          </p>
          <select value={pinkProductType} onChange={(e) => setPinkProductType(e.target.value)}
            className="h-9 w-full max-w-sm min-w-0 rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="">— No default (pick per card) —</option>
            {pinkTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            {/* Keep a saved value selectable even if Pink's list didn't load or dropped it. */}
            {pinkProductType && !pinkTypeOptions.some((o) => o.value === pinkProductType) && (
              <option value={pinkProductType}>{pinkProductType}</option>
            )}
          </select>
          {!pinkTypeOptions.length && (
            <p className="mt-1 text-xs text-muted-foreground">Connect Pink Design to load its product types.</p>
          )}
        </div>
      </Fold>

      <Fold title="Peak-season capacity" hint="per-seller order limits + the delay notice">
        {/* Master switch — off = no header counters, no notice, limits ignored. */}
        <label className="mb-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <input type="checkbox" checked={capacityMode} onChange={(e) => setCapacityMode(e.target.checked)} className="size-4 accent-primary" />
          <span className="text-sm font-medium">Peak-season mode {capacityMode ? "on" : "off"}</span>
          <span className="text-xs text-muted-foreground">— turns on the order counters in the header (sellers see their own, staff see the factory total) and the delay notice.</span>
        </label>
        <p className="mb-3 text-xs text-muted-foreground">
          When a seller crosses their daily order limit they see the notice below at submit — a
          heads-up, never a block. Set a limit on an individual seller from the Accounts list;
          this is the <strong>default</strong> for any seller without their own.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Default daily order limit</span>
            <Input
              value={orderLimitDefault}
              onChange={(e) => setOrderLimitDefault(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric" placeholder="0" className="h-9"
            />
            <span className="block text-2xs text-muted-foreground">0 = no default cap. A seller&apos;s own limit always wins.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Factory daily limit (staff only)</span>
            <Input
              value={factoryDailyLimit}
              onChange={(e) => setFactoryDailyLimit(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric" placeholder="0" className="h-9"
            />
            <span className="block text-2xs text-muted-foreground">Total orders/day the whole floor can take — shown in the staff header. 0 = shown as a plain count.</span>
          </label>
        </div>
        <label className="mt-3 block space-y-1">
          <span className="text-sm font-medium">Delay notice (shown only once a seller is over the limit)</span>
          <textarea
            value={capacityNotice}
            onChange={(e) => setCapacityNotice(e.target.value)}
            rows={2}
            placeholder="Due to high order volume, orders submitted now may ship later than usual."
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
          <span className="block text-2xs text-muted-foreground">Leave blank to use the default wording.</span>
        </label>
      </Fold>

      {/* The printed catalogue goes to BUYERS, so its cover is the one surface here that
          someone outside the company reads. Editable without a deploy: a trade show, a
          private-label buyer or a seasonal cover should not need one. Every field falls
          back to the house brand when blank, so an untouched install still prints a
          finished document rather than an empty template. */}
      <Fold title="Lookbook branding" hint="the printed catalogue's cover">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Name on the cover</span>
            <Input value={lookbookTitle} onChange={(e) => setLookbookTitle(e.target.value)}
                   placeholder="EGFULFILL" className="h-9" />
            <span className="block text-2xs text-muted-foreground">Also the wordmark in each page footer.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Accent colour</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(lookbookAccent) ? lookbookAccent : "#6633FF"}
                onChange={(e) => setLookbookAccent(e.target.value)}
                aria-label="Lookbook accent colour"
                className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
              />
              <Input value={lookbookAccent} onChange={(e) => setLookbookAccent(e.target.value)}
                     placeholder="#6633FF" className="h-9 flex-1 font-mono" />
            </div>
            {/* Stated, not left to be discovered at the printer. The covers reverse cream
                type out of this colour, so a light value makes the title vanish. */}
            <span className="block text-2xs text-muted-foreground">
              Prints full-bleed on the covers with the title reversed out — keep it dark.
            </span>
          </label>
        </div>
        <label className="mt-3 block space-y-1">
          <span className="text-sm font-medium">Cover tagline</span>
          <Input value={lookbookTagline} onChange={(e) => setLookbookTagline(e.target.value)}
                 placeholder="Print-on-demand, made to order" className="h-9" />
        </label>
        <label className="mt-3 block space-y-1">
          <span className="text-sm font-medium">Back-cover contact</span>
          <textarea
            value={lookbookContact}
            onChange={(e) => setLookbookContact(e.target.value)}
            rows={2}
            placeholder={"orders@egful.store\negful.store"}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
          <span className="block text-2xs text-muted-foreground">
            Left blank, the block is omitted rather than printed empty.
          </span>
        </label>
      </Fold>

      <Fold title="Embroidery threads" hint="the cones you actually stock">

        <p className="mb-3 text-xs text-muted-foreground">
          Thread matching picks the nearest cone <em>you stock</em>. The built-in starter
          list is 16 colours, which is why a light blue can come back as Grey — add your
          real chart here and matches get proportionally better. Leave it empty to keep
          the starter list.
        </p>

        <div className="mb-3 overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[auto_7rem_1fr_auto] items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="w-6" />
            <span>Code</span>
            <span>Name</span>
            <span className="w-8" />
          </div>
          {threads.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No cones added — matching uses the 16-colour starter list.
            </div>
          ) : (
            <div className="max-h-72 divide-y divide-border overflow-y-auto">
              {threads.map((t, i) => (
                <div key={`${t.code}-${i}`} className="grid grid-cols-[auto_7rem_1fr_auto] items-center gap-2 px-3 py-1.5">
                  {/* The colour is the point — a native picker beats a hex field you
                      have to imagine. The hex is still shown, because a cone chart
                      lists hexes and people copy them across. */}
                  <input
                    type="color"
                    value={t.hex}
                    onChange={(e) => { const hex = e.target.value.toUpperCase(); setThreads((p) => p.map((x, j) => (j === i ? { ...x, hex, name: x.name.trim() ? x.name : nearestColorName(hex) } : x))) }}
                    className="size-6 cursor-pointer rounded border border-border bg-transparent p-0"
                    aria-label={`Colour for ${t.name || t.code}`}
                  />
                  <Input
                    value={t.code}
                    onChange={(e) => setThreads((p) => p.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}
                    className="h-7 font-mono text-xs"
                    placeholder="1801"
                  />
                  <Input
                    value={t.name}
                    onChange={(e) => setThreads((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    className="h-7 text-xs"
                    placeholder="White"
                  />
                  <button
                    type="button"
                    onClick={() => setThreads((p) => p.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-red-600"
                    title={`Remove ${t.name || t.code}`}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <input
            type="color"
            value={newThread.hex}
            onChange={(e) => { const hex = e.target.value.toUpperCase(); setNewThread((p) => ({ ...p, hex, name: p.name.trim() ? p.name : nearestColorName(hex) })) }}
            className="size-9 cursor-pointer rounded border border-border bg-transparent p-0"
            aria-label="New thread colour"
          />
          <Input
            value={newThread.code}
            onChange={(e) => setNewThread((p) => ({ ...p, code: e.target.value }))}
            placeholder="Code"
            className="h-9 w-28 font-mono"
          />
          <Input
            value={newThread.name}
            onChange={(e) => setNewThread((p) => ({ ...p, name: e.target.value }))}
            placeholder="Colour name"
            className="h-9 w-44"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!newThread.code.trim() || !newThread.name.trim()}
            onClick={() => {
              const code = newThread.code.trim(), name = newThread.name.trim()
              // Code is the identity — the number pulled off the shelf. Silently
              // appending a duplicate would make two rows fight over one cone.
              if (threads.some((t) => t.code.toLowerCase() === code.toLowerCase())) {
                setErr(`Thread ${code} is already in the list.`); return
              }
              setErr(null)
              setThreads((p) => [...p, { code, name, hex: newThread.hex }])
              setNewThread({ code: "", name: "", hex: "#000000" })
            }}
          >
            <Plus size={13} weight="bold" /> Add thread
          </Button>
          <span className="text-xs text-muted-foreground">{threads.length} cone{threads.length === 1 ? "" : "s"} — remember to Save</span>
        </div>
      </Fold>

      <Fold title="Positions / Design Surfaces" hint="sides + positioning outlines per category">

        <p className="mb-3 text-xs text-muted-foreground">
          Sides and outlines are set once per category and inherited by every product in it —
          define four faces on Headwear and fifty hats get them without fifty uploads. The
          outlines are positioning aids for the Design Maker only; they never appear as a
          product&apos;s catalog image.
        </p>
        <div className="space-y-2">
          {types.map((t, i) => {
            const sides = t.sides?.length ? t.sides : ["front"]
            const setType = (patch: Partial<ProductType>) =>
              setTypes((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            const toggleSide = (sd: string) => {
              const on = sides.includes(sd)
              // Front is never removable — a product with no front can't be designed on.
              if (on && (sd === "front" || sides.length === 1)) return
              const next = on ? sides.filter((x) => x !== sd) : [...sides, sd]
              // Turning a side OFF drops its outline: an orphaned image would silently
              // reappear if the side were re-enabled, which isn't what "off" means.
              const mockups = { ...(t.mockups ?? {}) }
              if (on) delete mockups[sd]
              setType({ sides: next, mockups })
            }
            return (
              <div key={i} className="space-y-2.5 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Input value={t.name} onChange={(e) => setType({ name: e.target.value })} className="h-9 flex-1" />
                  <Button variant="outline" size="sm" aria-label={`Remove ${t.name}`} onClick={() => setTypes((p) => p.filter((_, j) => j !== i))}>
                    <Trash size={14} />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Sides</span>
                  {ALL_SIDES.map((sd) => {
                    const on = sides.includes(sd)
                    return (
                      <button
                        key={sd}
                        onClick={() => toggleSide(sd)}
                        disabled={on && sd === "front"}
                        title={sd === "front" ? "Every product has a front" : undefined}
                        className={"eg-tap rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors " +
                          (on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}
                      >
                        {sd}
                      </button>
                    )
                  })}
                </div>

                {/* One outline slot per ENABLED side — turn a side off and its slot goes
                    with it, so the grid always matches what this category actually has. */}
                <div className="flex flex-wrap gap-2">
                  {sides.map((sd) => {
                    const url = t.mockups?.[sd] || (sd === "front" ? t.mockup ?? "" : "")
                    return (
                      /* Bigger (64px → 96px) with the side named UNDERNEATH rather than
                         inside the empty state — an outline is a drawing you have to
                         actually recognise, and a 9px label that vanished the moment an
                         image loaded meant a filled row of six was unlabelled. Accepts a
                         dropped file as well as a click, matching the product dialog. */
                      <div key={sd} className="group/tile flex w-24 flex-col gap-1">
                        <label
                          className="relative block size-24 cursor-pointer overflow-hidden rounded-lg border-2 border-border bg-muted transition-colors hover:border-primary/50"
                          title={`${sd} outline — click or drop an image`}
                          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault() }}
                          onDrop={(e) => {
                            const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/"))
                            if (!f) return
                            e.preventDefault()
                            const rd = new FileReader()
                            rd.onload = () => setType({ mockups: { ...(t.mockups ?? {}), [sd]: String(rd.result) } })
                            rd.readAsDataURL(f)
                          }}
                        >
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt="" className="size-full object-contain" />
                          ) : (
                            <span className="flex size-full items-center justify-center text-muted-foreground">
                              <Plus size={18} />
                            </span>
                          )}
                          <input
                            type="file" accept="image/*" className="absolute inset-0 cursor-pointer opacity-0"
                            onChange={(e) => {
                              const f = e.target.files?.[0]; if (!f) return
                              const rd = new FileReader()
                              rd.onload = () => setType({ mockups: { ...(t.mockups ?? {}), [sd]: String(rd.result) } })
                              rd.readAsDataURL(f)
                            }}
                          />
                          {url && (
                            <button
                              onClick={(e) => { e.preventDefault(); const m = { ...(t.mockups ?? {}) }; delete m[sd]; setType({ mockups: m }) }}
                              className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-foreground/75 text-background opacity-0 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100"
                              aria-label={`Clear ${sd} outline`}
                            >
                              <X size={12} weight="bold" />
                            </button>
                          )}
                        </label>
                        <span className="truncate text-xs font-medium capitalize">{sd}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="flex items-center gap-2">
            <Input
              value={newType} onChange={(e) => setNewType(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newType.trim()) { setTypes((p) => [...p, { name: newType.trim(), sides: ["front"], mockups: {} }]); setNewType("") } }}
              placeholder="Add a type…" className="h-9 max-w-xs"
            />
            <Button variant="outline" size="sm" disabled={!newType.trim()} onClick={() => { setTypes((p) => [...p, { name: newType.trim(), sides: ["front"], mockups: {} }]); setNewType("") }}>
              <Plus size={14} weight="bold" /> Add
            </Button>
          </div>
        </div>
      </Fold>

      {/* Ship-from. A label with no origin is rejected by the carrier, so this is the
          one setting on this page that blocks work outright when it's blank — hence the
          warning rather than a silent empty form. */}

      {/* Flat shipping by garment class. A product's own shippingFee still wins; these are
          what a product WITHOUT one falls back to, instead of one flat platform number. */}
      <Fold title="Shipping by product type" hint="flat rate per garment class">

        <p className="mb-3 text-xs text-muted-foreground">Used when a product has no shipping fee of its own.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyField label="Caps & hats" value={bands.ship_cap ?? ""} onChange={(v) => setBand("ship_cap", v)} />
          <MoneyField label="Sweatshirts, hoodies, jackets" value={bands.ship_heavy ?? ""} onChange={(v) => setBand("ship_heavy", v)} />
          <MoneyField label="All other garments" value={bands.ship_garment ?? ""} onChange={(v) => setBand("ship_garment", v)} />
        </div>
      </Fold>

      {/* Per-method surcharge on top of the blank's base cost. */}
      <Fold title="Print method surcharge" hint="added per unit by technique">

        <p className="mb-3 text-xs text-muted-foreground">Added to the base cost per unit. A product can override this for its own methods.</p>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <MoneyField label="DTG printing" value={bands.method_dtg ?? ""} onChange={(v) => setBand("method_dtg", v)} />
          <MoneyField label="DTF printing" value={bands.method_dtf ?? ""} onChange={(v) => setBand("method_dtf", v)} />
          <MoneyField label="Embroidery" value={bands.method_emb ?? ""} onChange={(v) => setBand("method_emb", v)} />
          <MoneyField label="Appliqué" value={bands.method_apl ?? ""} onChange={(v) => setBand("method_apl", v)} />
          <MoneyField label="Laser" value={bands.method_lsr ?? ""} onChange={(v) => setBand("method_lsr", v)} />
        </div>
      </Fold>
      {/* Save stays OUTSIDE the search filter and always visible: a filtered page still
          edits the same form, and hiding Save behind a query is how an edit gets lost. */}
      <div className="flex items-center gap-3 border-t border-border px-5 py-3">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        {saved && <span className="inline-flex items-center gap-1 text-sm text-success"><Check size={14} weight="bold" /> Saved</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
      </SettingsSearch.Provider>
    </SectionCard>
  )
}

// ─────────────────────────── Users (admin) ───────────────────────────
const ROLES = ["seller", "operator", "warehouse", "designer", "admin"]
// Plans are SERVER state now; this dropdown is the ONLY way to change one.
const PLANS = ["starter", "pro", "enterprise"]
// ONE grid template shared by the header and every data row, so columns line up no matter
// which controls a role carries. Every track except the flexible Account column is a FIXED
// width: each row is its own grid, so a variable track (e.g. sizing Access to its contents,
// which a seller widens with a Plan select and staff don't) would let the column edges
// drift row to row — exactly the misalignment this replaces. Tracks appear as the viewport
// widens, and the row cells hidden at each breakpoint drop out of grid flow at the SAME
// breakpoints, so the visible-cell count always equals the track count.
//   base : Account · Access
//   sm   : Account · Balance · Access
//   lg   : Account · Joined · Activity · Balance · Access
const USER_ROW_GRID =
  "grid items-center gap-x-3 gap-y-1 px-5 " +
  "grid-cols-[minmax(0,1fr)_11rem] " +
  "sm:grid-cols-[minmax(0,1fr)_5.5rem_15rem] " +
  "lg:grid-cols-[minmax(0,1fr)_6.5rem_10rem_5.5rem_17rem]"

/**
 * The seller's Activity cell: today's uploads over their daily limit, plus the recent
 * per-day average. The LIMIT is edited right here — click the number, type, Enter (or blur)
 * saves. This is the value "Suggest limits" seeds automatically from the factory + seller
 * volume formula; an admin can then override any one directly. `null` = inherit the platform
 * default (shown faded), `0` = unlimited (∞). Limits never block a submit — they only decide
 * when the "may ship later" notice shows — so an over-allocation is safe, just visible.
 */
function LimitCell({
  user, canEdit, defaultLimit, saving, onSave,
}: {
  user: AdminUser
  canEdit: boolean
  defaultLimit: number
  saving: boolean
  onSave: (val: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const limit = user.order_limit
  const today = user.orders_today ?? 0
  const perDay = Math.round((user.orders_14d ?? 0) / 14)
  const over = limit != null && limit > 0 && today >= limit
  const commit = (raw: string) => {
    setEditing(false)
    const t = raw.trim()
    onSave(t === "" ? null : Math.max(0, parseInt(t, 10) || 0))
  }
  // Just the number — the "/day" lives in the column header now. Falls back to the platform
  // default (muted), or the words Unlimited / No limit. Usage + recent average are in the
  // tooltip rather than crowding the cell. Amber only when today has hit the limit.
  const label = limit == null
    ? (defaultLimit > 0 ? String(defaultLimit) : "No limit")
    : limit === 0 ? "Unlimited" : String(limit)
  const inherited = limit == null
  const title = `${today} uploaded today · ~${perDay}/day recently${inherited ? ` · using platform default ${defaultLimit || "none"}` : limit === 0 ? " · unlimited" : ""}`
  const cls = over ? "font-medium text-primary" : inherited ? "text-muted-foreground" : "font-medium text-foreground"
  if (editing) {
    return (
      <input
        autoFocus type="number" min={0} defaultValue={limit ?? ""}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value) }
          else if (e.key === "Escape") setEditing(false)
        }}
        placeholder={defaultLimit ? String(defaultLimit) : "none"}
        className="w-20 rounded-md border border-primary/50 bg-card px-1.5 py-0.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
    )
  }
  return canEdit ? (
    <button onClick={() => setEditing(true)} disabled={saving} title={`${title} · click to change`}
      className={"text-sm tabular-nums underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground " + cls}>
      {label}
    </button>
  ) : (
    <span title={title} className={"text-sm tabular-nums " + cls}>{label}</span>
  )
}

function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [nu, setNu] = useState({ email: "", password: "", role: "operator" })
  const [nuErr, setNuErr] = useState<string | null>(null)
  // A real directory gets long fast (sellers outnumber staff), so it needs finding, not
  // just listing. Search covers name/email/store; the role chips answer "show me staff".
  const [qStr, setQStr] = useState("")
  const [sortBy, setSortBy] = useState<"recent" | "busy">("recent")
  const [roleFilter, setRoleFilter] = useState("all")
  const [showInactive, setShowInactive] = useState(false)
  // Role changes and deletion are admin-only server-side; mirror that here so warehouse
  // isn't shown controls that will 403.
  const isAdminCaller = (getUser()?.role || "") === "admin"
  const [pwFor, setPwFor] = useState<AdminUser | null>(null)
  const [pwValue, setPwValue] = useState("")
  const [pwErr, setPwErr] = useState<string | null>(null)
  const [pwDone, setPwDone] = useState(false)
  const [removing, setRemoving] = useState<AdminUser | null>(null)
  // Manual balance movement. A reason is required: an unexplained entry in a money
  // ledger is worse than no entry, because nobody can tell later whether it was right.
  const [adjFor, setAdjFor] = useState<AdminUser | null>(null)
  const [adjAmt, setAdjAmt] = useState("")
  const [adjNote, setAdjNote] = useState("")
  const [adjErr, setAdjErr] = useState<string | null>(null)

  const loadUsers = useCallback(() => { getUsers().then((r) => { setUsers(r ?? []); setLoaded(true) }).catch(() => setLoaded(true)) }, [])
  useEffect(() => { const id = setTimeout(loadUsers, 0); return () => clearTimeout(id) }, [loadUsers])
  // The factory cap + platform default, so the row limits read against the master ceiling
  // (set in Platform) and the header can show how much of it is allocated to sellers.
  const [cap, setCap] = useState<{ mode: boolean; limit: number; def: number } | null>(null)
  useEffect(() => {
    const id = setTimeout(() => {
      getFactorySettings().then((s) => setCap({
        mode: !!Number(s?.capacity_mode || 0),
        limit: Number(s?.factory_daily_limit || 0),
        def: Number(s?.order_limit_default || 0),
      })).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [])
  const defaultLimit = cap?.def ?? 0

  const changeRole = async (u: AdminUser, role: string) => {
    setBusy(u.id); setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)))
    try { await updateUserAdmin(u.id, { role }) } catch { loadUsers() } finally { setBusy(null) }
  }
  const changePlan = async (u: AdminUser, plan: string) => {
    setBusy(u.id)
    setUsers((prev) => (prev ?? []).map((x) => (x.id === u.id ? { ...x, plan } : x)))
    try { await updateUserAdmin(u.id, { plan }) } catch { loadUsers() } finally { setBusy(null) }
  }
  const setActive = async (u: AdminUser, active: boolean) => {
    setBusy(u.id)
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, active } : x)))
    try { await updateUserAdmin(u.id, { active }) } catch { loadUsers() } finally { setBusy(null) }
  }
  // Per-seller daily order limit: blank = platform default, 0 = unlimited. Edited inline in
  // each row (no bulk "suggest" button — a seller with no limit set already inherits the
  // platform default, and any row can be hand-tuned). Crossing the limit never blocks a
  // submit; it only shows the delay notice.
  // Direct save from the inline editor in the row. null = platform default · 0 = unlimited.
  // Optimistic so the number sticks the instant you leave the field; reloads only on error.
  const saveOrderLimit = async (u: AdminUser, val: number | null) => {
    if (val === (u.order_limit ?? null)) return
    setBusy(u.id)
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, order_limit: val } : x)))
    try { await updateUserAdmin(u.id, { order_limit: val }) } catch { loadUsers() } finally { setBusy(null) }
  }
  const resetPassword = async () => {
    if (!pwFor) return
    if (pwValue.length < 8) { setPwErr("Password must be at least 8 characters."); return }
    setBusy(pwFor.id); setPwErr(null)
    try {
      const r = await updateUserAdmin(pwFor.id, { password: pwValue })
      if (r?.error) throw new Error(r.error)
      setPwDone(true)
      setTimeout(() => { setPwFor(null); setPwValue(""); setPwDone(false) }, 1400)
    } catch (e) { setPwErr(e instanceof Error ? e.message : "Couldn't set that password.") }
    finally { setBusy(null) }
  }
  const applyAdjust = async (sign: 1 | -1) => {
    if (!adjFor) return
    const amt = Math.abs(Number(adjAmt) || 0)
    if (!amt) { setAdjErr("Enter an amount."); return }
    if (!adjNote.trim()) { setAdjErr("Add a reason — this lands in the ledger permanently."); return }
    setBusy(adjFor.id); setAdjErr(null)
    try {
      const r = await adjustBalance({
        account: String(adjFor.id), delta: sign * amt, note: adjNote.trim(),
        // A ref makes the write idempotent, so a double-click can't double-adjust.
        ref: `manual-${adjFor.id}-${Date.now()}`,
      })
      if (r?.error) throw new Error(r.error)
      setAdjFor(null); setAdjAmt(""); setAdjNote("")
      loadUsers()
    } catch (e) { setAdjErr(e instanceof Error ? e.message : "Couldn't adjust that balance.") }
    finally { setBusy(null) }
  }

  const removeUser = async () => {
    if (!removing) return
    setBusy(removing.id)
    try {
      const r = await deleteUserAdmin(removing.id)
      if (r?.error) throw new Error(r.error)
      setRemoving(null); loadUsers()
    } catch { loadUsers(); setRemoving(null) } finally { setBusy(null) }
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

  const term = qStr.trim().toLowerCase()
  /**
   * Order the list so a team reads as a team: each leader followed by their members,
   * indented. A flat list of "Owner" and "Member" rows tells you nothing about who
   * belongs to whom, which is the first thing you need before changing anything.
   */
  const groupTeams = (list: AdminUser[]) => {
    const byId = new Map(list.map((u) => [String(u.id), u]))
    const members = new Map<string, AdminUser[]>()
    for (const u of list) {
      if (u.owner_id && byId.has(String(u.owner_id))) {
        const k = String(u.owner_id)
        members.set(k, [...(members.get(k) ?? []), u])
      }
    }
    const out: { u: AdminUser; child: boolean }[] = []
    for (const u of list) {
      // Members are emitted under their leader, not again at top level.
      if (u.owner_id && byId.has(String(u.owner_id))) continue
      out.push({ u, child: false })
      for (const m of members.get(String(u.id)) ?? []) out.push({ u: m, child: true })
    }
    return out
  }

  // Everything the active toggle + search let through, BEFORE the role chips narrow it.
  // The chip counts read off this set, so each chip shows exactly how many rows selecting
  // it would reveal — and they react to a search the same way the list does.
  const countBase = users.filter((u) => {
    if (!showInactive && u.active === false) return false
    if (!term) return true
    return [u.name, u.email, u.store_name, u.role].some((f) => String(f ?? "").toLowerCase().includes(term))
  })
  // "Staff" is every non-seller, so operator + warehouse + designer + admin all fall under
  // it — they are factory roles, not a seller's team, so this is a role tally, not a
  // hierarchy. A bare role id counts that one role.
  const roleCount = (id: string) =>
    id === "all" ? countBase.length
      : id === "staff" ? countBase.filter((u) => u.role !== "seller").length
      : id === "seller" ? countBase.filter((u) => u.role === "seller").length
      : countBase.filter((u) => u.role === id).length
  const shown = countBase.filter((u) =>
    roleFilter === "all" ? true : roleFilter === "staff" ? u.role !== "seller" : u.role === roleFilter
  )
  const inactiveCount = users.filter((u) => u.active === false).length
  // How much of the factory cap the seller limits currently claim — a seller with no
  // personal limit is counted at the platform default, an unlimited one (0) can't be summed
  // so it's flagged separately. Lets an admin see head-room before hand-editing a number,
  // without changing anything: the cap stays the master knob (raise it in Platform to take
  // more overall), an edit here only moves that one seller.
  // Everything that eats into the factory cap: sellers, plus any account that has orders of
  // its own (the factory/admin shop). A seller with no limit inherits the platform default;
  // a factory account contributes only its explicit limit (0 = unlimited → counts as 0).
  const hasOwnOrders = (u: AdminUser) => (u.orders_total ?? 0) > 0 || (u.orders_today ?? 0) > 0
  const limitContributors = users.filter((u) => u.active !== false && (u.role === "seller" || hasOwnOrders(u)))
  const unlimitedSellers = limitContributors.filter((u) => u.order_limit === 0).length
  const allocated = limitContributors.reduce((s, u) => s + (u.order_limit != null ? u.order_limit : (u.role === "seller" ? defaultLimit : 0)), 0)
  // "Busiest first" = trailing 14-day volume, descending — so after suggesting limits the
  // heavy hitters float to the top for a quick review. Sorted BEFORE grouping so a team's
  // leader lands by their own volume (members still sit under them).
  const ordered = sortBy === "busy"
    ? [...shown].sort((a, b) => (b.orders_14d ?? 0) - (a.orders_14d ?? 0))
    : shown
  // Teams have to stay whole: paging the flat list could put a leader on one page and
  // their members on the next, which is exactly the relationship the grouping exists to
  // show. So the list is grouped FIRST, then paged as groups.
  const grouped = groupTeams(ordered)
  const paged = usePaged(grouped, 25)

  return (
    <div className="space-y-4">
      <SectionCard title="New staff / user" description="Create an account with a role (username or email login)">
        <div className="flex flex-wrap items-end gap-2 p-5">
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Email / username</span><Input value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} placeholder="ops@egful.store" className="h-9" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Password</span><PasswordInput value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="8+ characters" className="h-9" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Role</span>
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm capitalize transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </label>
          <Button size="sm" onClick={addUser} disabled={busy === "new"}>{busy === "new" ? <CircleNotch size={14} className="animate-spin" /> : <><UserPlus size={14} weight="bold" /> Create</>}</Button>
          {nuErr && <span className="w-full text-sm text-destructive">{nuErr}</span>}
        </div>
      </SectionCard>
      <SectionCard title="Users" description={`${users.length} account${users.length === 1 ? "" : "s"} — search, change a role, reset a password, or deactivate`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative min-w-[220px] flex-1">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={qStr} onChange={(e) => setQStr(e.target.value)} placeholder="Search name, email or store…" className="h-9 pl-8" />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {[["all", "All"], ["staff", "Staff"], ["seller", "Sellers"], ["operator", "Operator"], ["warehouse", "Warehouse"], ["designer", "Designer"], ["admin", "Admin"]].map(([id, label]) => {
              const n = roleCount(id)
              return (
              <button
                key={id}
                onClick={() => setRoleFilter(id)}
                className={"eg-tap rounded-full px-2.5 py-1 text-xs font-medium transition-colors " + (roleFilter === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
              >
                {label}
                <span className={"ml-1 tabular-nums " + (roleFilter === id ? "opacity-80" : "opacity-50")}>{n}</span>
              </button>
            )})}
          </div>
          {/* Sort: newest account first (default) vs busiest by recent volume — so after
              suggesting limits, the heavy hitters are at the top to review. */}
          <div className="flex rounded-full border border-border p-0.5 text-xs">
            {([["recent", "Newest"], ["busy", "Busiest"]] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setSortBy(id)}
                className={"eg-tap rounded-full px-2.5 py-1 font-medium transition-colors " + (sortBy === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Head-room: how much of the factory cap the seller limits claim. The cap is the
              master knob (raise it in Platform to take more overall); editing a seller here
              only moves that one row. Amber when the sum runs past the cap. */}
          {cap?.mode && cap.limit > 0 && (
            <span className="w-full text-xs text-muted-foreground">
              Factory cap <span className="font-medium text-foreground tabular-nums">{cap.limit}</span>/day · allocated <span className="tabular-nums">~{allocated}</span>
              {allocated > cap.limit
                ? <span className="font-medium text-primary"> · over by {allocated - cap.limit} (raise the cap in Platform to take more)</span>
                : <span> · {cap.limit - allocated} free</span>}
              {unlimitedSellers > 0 && <span className="opacity-70"> · {unlimitedSellers} unlimited</span>}
            </span>
          )}
          {/* Deactivated accounts are hidden by default — they're kept so their orders
              stay attached, not because anyone needs to see them daily. */}
          {inactiveCount > 0 && (
            <button
              onClick={() => setShowInactive((v) => !v)}
              className={"eg-tap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " + (showInactive ? "border-border bg-accent" : "border-border text-muted-foreground hover:bg-accent")}
            >
              {showInactive ? "Hide" : "Show"} {inactiveCount} deactivated
            </button>
          )}
        </div>
        {!loaded ? <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div> : (
          /* An aligned grid, not free-flowing rows. Every row is the same USER_ROW_GRID,
             so Joined / Activity / Balance / Access line up under their headers no matter
             the role — a seller (plan + balance) and a staff account (neither) still share
             identical column edges, which the old flex layout did not. Identity is one cell
             (avatar + name + email + badges); a team member sits under its leader with a
             left accent INSIDE that cell, so the indent never shifts the columns beside it. */
          <div className="divide-y divide-border">
            {/* Header — labels the columns the rows carry, so a bare "$0.00" or a date reads
                as a claim, not a loose number. Same grid + same per-cell breakpoints as the
                rows, so each label sits exactly above its values. */}
            {paged.pageItems.length > 0 && (
              <div className={USER_ROW_GRID + " py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"}>
                <span className="min-w-0">Account</span>
                <span className="hidden lg:block">Joined</span>
                <span className="hidden lg:block">Order limit (/day)</span>
                <span className="hidden text-right sm:block">Balance</span>
                {/* Same 3-col sub-grid as the row's Access cell, so Role / Plan sit exactly
                    over their selects. */}
                <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                  <span>Role</span>
                  <span>Plan</span>
                  <span className="w-8" />
                </div>
              </div>
            )}
            {paged.pageItems.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">{users.length ? "No users match that search." : "No users"}</div>
            ) : (
              paged.pageItems.map(({ u, child }) => {
                const isSeller = u.role === "seller"
                const displayName = u.name || u.store_name || (u.username ? `@${u.username}` : "") || u.email || "—"
                const lastActive = fmtAgo(u.last_order_at)
                return (
                <div
                  key={u.id}
                  className={
                    USER_ROW_GRID + " py-3 transition-colors hover:bg-accent/40 " +
                    (child ? "bg-muted/20 " : "") +
                    (u.active === false ? "opacity-55" : "")
                  }
                >
                  {/* Account — avatar + identity + badges, all in the flexible column. */}
                  <div className={"flex min-w-0 items-center gap-3 " + (child ? "border-l-2 border-primary/30 pl-3" : "")}>
                    <UserAvatar user={{ name: displayName, avatar_emoji: u.avatar_emoji, avatar_color: u.avatar_color }} size={child ? 30 : 38} className={child ? "rounded-lg" : "rounded-xl"} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={child ? "truncate text-sm" : "truncate text-sm font-medium"}>{displayName}</span>
                        {!child && (u.team_size ?? 0) > 0 && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Leads {u.team_size}</span>
                        )}
                        {child && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                            Member{u.owner_label ? ` · ${u.owner_label}` : ""}
                          </span>
                        )}
                        {isSeller && u.spydeck_addon && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Spydeck</span>
                        )}
                        {u.active === false && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">Deactivated</span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {u.email || (u.username ? `@${u.username}` : "—")}
                        {u.store_name && u.store_name !== displayName && <span className="opacity-70"> · {u.store_name}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Joined — context, not a control, so it stays quiet. */}
                  <span className="hidden truncate text-sm text-muted-foreground lg:block">{fmtDate(u.created_at)}</span>

                  {/* Order limit — sellers, plus any account that syncs its own orders (the
                      factory/admin shop). Edit inline; amber once today hits the limit. A
                      seller with none set inherits the platform default; a factory account
                      shows "No limit" until you set one. Staff with no orders stay "—". */}
                  <div className="hidden min-w-0 text-xs lg:block">
                    {isSeller || hasOwnOrders(u) ? (
                      <>
                        <LimitCell user={u} canEdit={isAdminCaller} defaultLimit={isSeller ? defaultLimit : 0} saving={busy === u.id} onSave={(v) => saveOrderLimit(u, v)} />
                        {lastActive && (
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">last order {lastActive}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>

                  {/* Balance — sellers only; staff share the factory wallet, so a per-account
                      figure is meaningless for them. Amber at or below zero: that account
                      can't submit work. */}
                  {isSeller ? (
                    <span
                      className={"hidden text-right text-sm tabular-nums sm:block " +
                        ((u.balance ?? 0) <= 0 ? "font-medium text-primary" : "text-muted-foreground")}
                      title={(u.balance ?? 0) <= 0 ? "No funds — this account can't submit orders" : "Wallet balance"}
                    >
                      {usd2(u.balance ?? 0)}
                    </span>
                  ) : (
                    <span className="hidden text-right text-sm text-muted-foreground/50 sm:block">—</span>
                  )}

                  {/* Access — role + plan + the manage menu, right-aligned under the header.
                      A FIXED-width track (see USER_ROW_GRID): a seller's extra Plan select
                      must not widen this cell and drag every other column out of true. */}
                  <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                    {/* Role — borderless, keeps the dropdown arrow (eg-select). */}
                    {!isAdminCaller ? (
                      <span className="truncate text-sm capitalize">{u.role}</span>
                    ) : (
                      <select
                        value={u.role} onChange={(e) => changeRole(u, e.target.value)} disabled={busy === u.id}
                        className="eg-select h-8 rounded-md bg-transparent px-1 text-sm capitalize transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                    {/* Plan — sellers only; an empty cell keeps Role/Plan/menu aligned for staff. */}
                    {u.role === "seller" ? (isAdminCaller ? (
                      <select
                        value={u.plan ?? "starter"} onChange={(e) => changePlan(u, e.target.value)} disabled={busy === u.id}
                        className="eg-select h-8 rounded-md bg-transparent px-1 text-sm capitalize transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : (
                      <span className="truncate text-sm capitalize text-muted-foreground">{u.plan ?? "starter"}</span>
                    )) : (
                      <span />
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Manage ${u.email}`}
                        className="eg-tap inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        <DotsThree size={16} weight="bold" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => { setPwFor(u); setPwValue(""); setPwErr(null); setPwDone(false) }}>
                          Set a new password
                        </DropdownMenuItem>
                        {u.role === "seller" && (
                          <DropdownMenuItem onClick={() => { setAdjFor(u); setAdjAmt(""); setAdjNote(""); setAdjErr(null) }}>
                            Adjust balance…
                          </DropdownMenuItem>
                        )}
                        {u.active === false ? (
                          <DropdownMenuItem onClick={() => setActive(u, true)}>Reactivate account</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => setActive(u, false)}>Deactivate (blocks sign-in)</DropdownMenuItem>
                        )}
                        {isAdminCaller && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setRemoving(u)} className="text-destructive">Delete permanently…</DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )})
            )}
          </div>
        )}
        {loaded && grouped.length > 0 && (
          <Pagination
            page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage}
            total={paged.total} start={paged.start}
            onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[25, 50, 100]}
          />
        )}
      </SectionCard>

      {/* Password reset. We set a password rather than emailing a reset link because a
          lot of these accounts are floor staff with usernames, not real mailboxes — the
          manager hands it over directly. */}
      <Dialog open={!!pwFor} onOpenChange={(v) => { if (!v) { setPwFor(null); setPwValue(""); setPwErr(null) } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Set a new password</DialogTitle></DialogHeader>
          <div className="space-y-3 px-1">
            <p className="text-sm text-muted-foreground">
              For <span className="font-medium text-foreground">{pwFor?.email}</span>. They can sign in with it immediately — give it to them directly and have them change it.
            </p>
            <Input
              type="text" value={pwValue} onChange={(e) => { setPwValue(e.target.value); setPwErr(null) }}
              placeholder="8+ characters" className="h-9" autoFocus
            />
            {pwErr && <p className="text-sm text-destructive">{pwErr}</p>}
            {pwDone && <p className="flex items-center gap-1.5 text-sm text-success"><Check size={14} weight="bold" /> Password updated.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPwFor(null)}>Cancel</Button>
            <Button size="sm" onClick={resetPassword} disabled={busy === pwFor?.id || pwDone}>
              {busy === pwFor?.id ? <CircleNotch size={14} className="animate-spin" /> : "Set password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual top-up / deduction. Two explicit buttons rather than a signed number: a
          minus sign is easy to miss, and this writes to a money ledger that can't be
          edited afterwards — only offset by another entry. */}
      <Dialog open={!!adjFor} onOpenChange={(v) => { if (!v) { setAdjFor(null); setAdjErr(null) } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Adjust balance</DialogTitle></DialogHeader>
          <div className="space-y-3 px-1">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{adjFor?.email}</span> · currently {usd2(adjFor?.balance ?? 0)}
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Amount</span>
              <Input value={adjAmt} onChange={(e) => { setAdjAmt(e.target.value.replace(/[^0-9.]/g, "")); setAdjErr(null) }} placeholder="0.00" inputMode="decimal" className="h-9" autoFocus />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Reason (recorded in the ledger)</span>
              <Input value={adjNote} onChange={(e) => { setAdjNote(e.target.value); setAdjErr(null) }} placeholder="Bank transfer received · ref 4471" className="h-9" />
            </label>
            {adjErr && <p className="text-sm text-destructive">{adjErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAdjFor(null)} disabled={busy === adjFor?.id}>Cancel</Button>
            <Button variant="outline" size="sm" onClick={() => applyAdjust(-1)} disabled={busy === adjFor?.id}>Deduct</Button>
            <Button size="sm" onClick={() => applyAdjust(1)} disabled={busy === adjFor?.id}>
              {busy === adjFor?.id ? <CircleNotch size={14} className="animate-spin" /> : "Top up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(v) => { if (!v) setRemoving(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Delete this account?</DialogTitle></DialogHeader>
          <div className="space-y-3 px-1">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{removing?.email}</span> will be removed permanently. This cannot be undone.
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
              <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
              If they simply left, deactivate instead — that blocks sign-in but keeps their orders attached to a real account.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={removeUser} disabled={busy === removing?.id}>
              {busy === removing?.id ? <CircleNotch size={14} className="animate-spin" /> : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────── Activity (admin) ───────────────────────────
const ACTIVITY_RANGES = [
  { key: "all", label: "All time", days: 0 },
  { key: "1", label: "Last 24 hours", days: 1 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
]

function ActivityPanel() {
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  const [cats, setCats] = useState<string[]>([])   // selected category keys; empty = all
  const [query, setQuery] = useState("")
  const [range, setRange] = useState("all")

  // Refetch (debounced) whenever a filter changes — the server does the filtering, so a rare
  // action still turns up beyond the most recent page. setState sits inside the timer/promise,
  // never synchronously in the effect.
  useEffect(() => {
    const id = setTimeout(() => {
      setAudit(null)
      const prefixes = ACTION_CATEGORIES.filter((c) => cats.includes(c.key)).flatMap((c) => c.prefixes)
      const r = ACTIVITY_RANGES.find((x) => x.key === range)
      const since = r && r.days ? new Date(Date.now() - r.days * 86_400_000).toISOString() : undefined
      getAudit({ limit: 300, cats: prefixes, q: query.trim() || undefined, since })
        .then((rows) => setAudit(rows ?? []))
        .catch(() => setAudit([]))
    }, 250)
    return () => clearTimeout(id)
  }, [cats, query, range])

  const filtered = cats.length > 0 || query.trim() !== "" || range !== "all"

  return (
    <SectionCard title="Activity log" description="Audited actions across the platform" bodyClassName="p-5">
      {/* Filter bar: category toggles + free-text + time range. */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {ACTION_CATEGORIES.map((c) => {
            const on = cats.includes(c.key)
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => setCats(on ? [] : [c.key])}
                className={
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " +
                  (on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card text-muted-foreground hover:text-foreground")
                }
              >
                {c.label}
              </button>
            )
          })}
          {cats.length > 0 && (
            <button type="button" onClick={() => setCats([])} className="ml-0.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search actor, note, id…" className="h-8 w-60 pl-8" />
          </div>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {ACTIVITY_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          {audit && (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {audit.length}{audit.length === 300 ? "+" : ""} event{audit.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* Same feed as everywhere else (activity-feed) — a global log rather than one entity's,
          so the subject is WHICH entity the action touched ("order 4099", "design_card 13"). */}
      <div className="mt-3">
        <ActivityFeed
          rows={audit}
          variant="card"
          empty={filtered ? "No activity matches these filters." : "No activity recorded yet."}
          subject={(a) => (a.entity_type ? <span className="text-muted-foreground">{a.entity_type} {a.entity_id ?? ""}</span> : null)}
        />
      </div>
    </SectionCard>
  )
}

// ─────────────────────── Buyer-PII retention (admin) ───────────────────────
// Amazon's Data Protection Policy requires buyer PII to be deleted within 30 days of
// shipment; Etsy, TikTok and Shopify impose comparable duties. The job is written and
// ships DISABLED, because redaction is irreversible and must never start on a deploy.
//
// So this screen leads with the PREVIEW — how many orders are already past the window and
// how old the oldest is — and only then offers the switch. "Purge now" states the number it
// is about to redact in the confirm, because the number is the whole decision.
function PiiRetentionPanel() {
  const [state, setState] = useState<PiiRetention | null>(null)
  // Age of the oldest still-held order, in days. Computed WHEN THE DATA ARRIVES, not during
  // render: reading the clock while rendering is impure and re-renders would shift it
  // (repo lint rule react-hooks/purity).
  const [oldestDays, setOldestDays] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [days, setDays] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const confirm = useConfirm()

  const load = useCallback(() => {
    getPiiRetention()
      .then((s) => {
        setState(s); setLoaded(true); setDays((p) => p || String(s.days ?? 30))
        setOldestDays(s.oldest ? Math.floor((Date.now() - new Date(s.oldest).getTime()) / 86400000) : null)
      })
      .catch((e) => { setErr(e instanceof Error ? e.message : "Couldn't read the retention policy"); setLoaded(true) })
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const save = async (enabled: boolean) => {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const n = Math.min(30, Math.max(1, parseInt(days, 10) || 30))
      const r = await setPiiRetention({ enabled, days: n })
      if (r.error) throw new Error(r.error)
      setMsg(enabled ? `On — orders are redacted ${n} days after they ship.` : "Off — nothing is redacted automatically.")
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the policy")
    } finally { setBusy(false) }
  }

  const purgeNow = async () => {
    const due = state?.due ?? 0
    const ok = await confirm({
      title: `Redact ${due} ${due === 1 ? "order" : "orders"}?`,
      body: "Buyer name, address, email, phone and the label PDF are permanently removed from these orders. This cannot be undone — the only way back is a database restore. Order id, totals, SKUs, tracking and dates are kept, so reporting is unaffected.",
      confirmLabel: `Redact ${due}`,
      destructive: true,
    })
    if (!ok) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await runPiiPurge()
      if (r.error) throw new Error(r.error)
      setMsg(`Redacted ${r.purged ?? 0} ${r.purged === 1 ? "order" : "orders"}.`)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Purge failed")
    } finally { setBusy(false) }
  }

  if (!loaded) return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>

  const due = state?.due ?? 0

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Buyer data retention</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <b className="text-foreground">Amazon</b> contractually requires buyer data to be deleted
          within 30 days of shipping — that is its Data Protection Policy, not a general privacy
          law, and Etsy, Shopify and TikTok do not impose it. Retaining records to settle a late
          dispute is normal and lawful. Turn this on when Amazon goes live; until then, access
          control does the work.
        </p>
      </div>

      {/* The preview. This is the point of the screen: see the number before deciding. */}
      <div className="grid gap-2 sm:grid-cols-3">
        <BackupStat
          label="Past the window"
          value={String(due)}
          sub={due ? "a purge would redact these" : "none past the window"}
        />
        <BackupStat
          label="Oldest still held"
          value={oldestDays == null ? "—" : `${oldestDays}d`}
          sub={oldestDays == null ? "no shipped orders holding data" : "since it shipped"}
        />
        <BackupStat
          label="Automatic purge"
          value={state?.enabled ? "On" : "Off"}
          sub={state?.enabled ? `${state?.days ?? 30} days after shipping` : "nothing runs by itself"}
        />
      </div>

      {/* NOT a warning. Retaining order records is the deliberate position here — a customer
          who complains at month six has to be checkable — and buyer details are already
          withheld from sellers by maskBuyerPII(). A standing amber alert would nag toward
          deleting exactly what that decision keeps, and an alert you are meant to ignore
          teaches you to ignore alerts. It states the position instead. */}
      {!state?.enabled && due > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <b className="text-foreground">Retained on purpose.</b>{" "}
          {due} shipped {due === 1 ? "order holds" : "orders hold"} buyer name and address beyond
          {" "}{state?.days ?? 30} days
          {oldestDays != null && <> — the oldest for <b className="text-foreground">{oldestDays} days</b></>}.
          Sellers only ever see the buyer&rsquo;s name and city; the street, postcode, phone and email
          are staff-only. Nothing is deleted unless you turn the purge on or run it by hand.
        </div>
      )}

      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Delete after</label>
            <div className="flex items-center gap-1.5">
              <Input
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))}
                className="h-8 w-20 text-sm"
                inputMode="numeric"
              />
              <span className="text-xs text-muted-foreground">days after shipping</span>
            </div>
            {/* The cap is a compliance floor, not a preference — say why it won't go higher. */}
            <p className="text-2xs text-muted-foreground">Max 30 — Amazon&rsquo;s policy ceiling.</p>
          </div>
          <Button size="sm" disabled={busy} onClick={() => save(true)}>
            {state?.enabled ? "Save" : "Turn on"}
          </Button>
          {state?.enabled && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => save(false)}>Turn off</Button>
          )}
          <Button size="sm" variant="outline" disabled={busy || !due} onClick={purgeNow}>
            Purge {due} now
          </Button>
        </div>
        <p className="text-2xs text-muted-foreground">
          What survives a purge: order id, totals, SKUs, tracking number and dates — revenue and
          growth reporting are unaffected. What goes: buyer name, street, city, postcode, email,
          phone and the label PDF. Orders still in production are never purged, whatever their age.
        </p>
      </div>

      {msg && <p className="text-xs text-success">{msg}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </div>
  )
}

// ─────────────────────────── Backups (admin) ───────────────────────────
// Database backups to R2 — on-demand + nightly, download, delete, with a summary strip and
// an editable schedule. The live database is never touched here; these are point-in-time
// copies stored beside the artwork.
function fmtBytes(n: number): string {
  if (!n || n < 0) return "—"
  const u = ["B", "KB", "MB", "GB"]
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}
function fmtRel(iso: string | null): string {
  if (!iso) return "Never"
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return "Just now"
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
function fmtNext(iso: string | null): string {
  if (!iso) return "Soon"
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "Due now"
  const h = Math.round(ms / 3600000); if (h < 24) return `in ${h}h`
  return `in ${Math.round(h / 24)}d`
}
function freqLabel(days: number): string {
  return days === 1 ? "every day" : days === 7 ? "every week" : `every ${days} days`
}
function BackupStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold leading-tight tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

function BackupsPanel() {
  const [state, setState] = useState<BackupsState | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<DbBackup | null>(null)
  // Schedule form — seeded from the server on first load (functional guard below never
  // clobbers an in-progress edit when the list re-polls).
  const [freq, setFreq] = useState("")
  const [keep, setKeep] = useState("")
  const [savingCfg, setSavingCfg] = useState(false)
  const [cfgMsg, setCfgMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    listBackups()
      .then((s) => {
        setState(s); setLoaded(true)
        // Guard: during the brief window where the new UI is live but the API hasn't been
        // rebuilt yet, config/summary are absent — degrade instead of throwing.
        if (s.config) {
          setFreq((p) => p || String(s.config.frequencyDays))
          setKeep((p) => p || String(s.config.keep))
        }
      })
      .catch((e) => { setErr(e instanceof Error ? e.message : "Couldn't load backups"); setLoaded(true) })
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  // Poll while a backup is in flight so its row flips to Done / Failed on its own.
  const anyRunning = !!state?.running || (state?.backups || []).some((b) => b.status === "running")
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [anyRunning, load])

  const startBackup = async () => {
    setErr(null); setBusy(true)
    try { await runBackup(); setTimeout(load, 400) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't start the backup") }
    finally { setBusy(false) }
  }
  const download = async (b: DbBackup) => {
    try { const { url } = await backupDownloadUrl(b.id); window.open(url, "_blank", "noopener") }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't get a download link") }
  }
  const doDelete = async (b: DbBackup) => {
    setConfirmDel(null)
    try { await deleteBackup(b.id); load() }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't delete that backup") }
  }
  const saveConfig = async () => {
    setSavingCfg(true); setCfgMsg(null)
    try {
      await setBackupConfig({ frequencyDays: Number(freq), keep: Number(keep) })
      setCfgMsg("Saved"); load(); setTimeout(() => setCfgMsg(null), 2000)
    } catch (e) { setCfgMsg(e instanceof Error ? e.message : "Couldn't save schedule") }
    finally { setSavingCfg(false) }
  }

  if (!loaded) return (
    <SectionCard title="Backups">
      <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
    </SectionCard>
  )

  const ready = !!state?.storageConfigured && !!state?.pgDumpAvailable
  const rows = state?.backups || []
  const sum = state?.summary
  const cfg = state?.config

  return (
    <SectionCard title="Backups" description="Point-in-time copies of the database, stored in R2 alongside your artwork." bodyClassName="p-5">
      {/* Prerequisite warnings — name what's missing and how to fix it, rather than a dead button. */}
      {!state?.storageConfigured && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <Warning size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <span>Object storage (R2) isn’t configured, so there’s nowhere to keep a backup. Set the <code>SPACES_*</code> keys first.</span>
        </div>
      )}
      {state?.storageConfigured && !state?.pgDumpAvailable && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <Warning size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <span><code>pg_dump</code> isn’t in the running server image yet. Rebuild it on the server (<code>docker compose up -d --build</code>), then reload.</span>
        </div>
      )}

      {/* Summary strip — totals and cadence at a glance. */}
      {sum && cfg && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <BackupStat label="Stored" value={fmtBytes(sum.totalBytes)} sub={`${sum.doneCount} backup${sum.doneCount === 1 ? "" : "s"}${sum.doneCount ? ` · avg ${fmtBytes(Math.round(sum.totalBytes / sum.doneCount))}` : ""}`} />
          <BackupStat label="This week" value={String(sum.weekCount)} sub={`${sum.monthCount} in 30 days`} />
          <BackupStat label="Last backup" value={fmtRel(sum.lastDone)} sub={sum.lastDone ? new Date(sum.lastDone).toLocaleDateString() : "—"} />
          <BackupStat label="Next (auto)" value={fmtNext(sum.nextAuto)} sub={freqLabel(cfg.frequencyDays)} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          A backup runs automatically {freqLabel(cfg?.frequencyDays ?? 1)}. The most recent {cfg?.keep ?? 14} automatic backups are kept; manual ones stay until you remove them.
        </p>
        <Button onClick={startBackup} disabled={!ready || busy || anyRunning}>
          {busy || anyRunning ? <CircleNotch size={16} className="animate-spin" /> : <Database size={16} />}
          {anyRunning ? "Backing up…" : "Back up now"}
        </Button>
      </div>

      {/* Editable schedule — saved to the DB, no redeploy. */}
      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg border bg-muted/20 p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="bk-freq">Automatic frequency</label>
          <select id="bk-freq" value={freq} onChange={(e) => setFreq(e.target.value)}
            className="h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <option value="1">Every day</option>
            <option value="2">Every 2 days</option>
            <option value="7">Every week</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="bk-keep">Keep last</label>
          <Input id="bk-keep" type="number" min={1} max={90} value={keep} onChange={(e) => setKeep(e.target.value)} className="h-8 w-24" />
        </div>
        <Button variant="outline" size="sm" onClick={saveConfig} disabled={savingCfg || !freq || !keep}>
          {savingCfg ? <CircleNotch size={14} className="animate-spin" /> : null}
          Save schedule
        </Button>
        {cfgMsg && <span className="text-xs text-muted-foreground">{cfgMsg}</span>}
      </div>

      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

      <div className="mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Size</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No backups yet. Run one now, or wait for the next automatic backup.</td></tr>
            )}
            {rows.map((b) => (
              <tr key={b.id} className="border-b last:border-0">
                <td className="px-4 py-3 tabular-nums">{new Date(b.created_at).toLocaleString()}</td>
                <td className="px-4 py-3"><Badge variant={b.kind === "auto" ? "secondary" : "outline"}>{b.kind === "auto" ? "Automatic" : "Manual"}</Badge></td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{b.status === "done" ? fmtBytes(Number(b.size_bytes || 0)) : "—"}</td>
                <td className="px-4 py-3">
                  {b.status === "done" && <span className="inline-flex items-center gap-1 text-green-600"><Check size={14} /> Done</span>}
                  {b.status === "running" && <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleNotch size={14} className="animate-spin" /> Running</span>}
                  {b.status === "failed" && <span className="inline-flex items-center gap-1 text-destructive" title={b.error || undefined}><Warning size={14} /> Failed</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {b.status === "done" && (
                      <Button variant="ghost" size="sm" onClick={() => download(b)} title="Download">
                        <DownloadSimple size={16} />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDel(b)} title="Delete">
                      <Trash size={16} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state?.pgDumpVersion && <p className="mt-3 text-xs text-muted-foreground">{state.pgDumpVersion}</p>}

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this backup?</DialogTitle>
            <DialogDescription>
              The dump file is removed from R2 for good. This does not touch your live database — only this saved copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDel && doDelete(confirmDel)}>Delete backup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

export function SettingsView() {
  // Integrations is a platform/admin concern (Stripe secret, supplier creds, AI key,
  // etc.) — ADMIN only. Operator/warehouse/designer + sellers never see it.
  const [isAdmin, setIsAdmin] = useState(false)
  const [canPlatform, setCanPlatform] = useState(false)
  const [isSeller, setIsSeller] = useState(false)
  // API keys are for integrating AGAINST the platform — a seller wiring up their own
  // systems, or an admin. Floor roles have nothing to integrate.
  const [canUseKeys, setCanUseKeys] = useState(false)
  // Anyone with a pending invite must be able to reach Team, whatever their role.
  // The invite notification says "Open Settings -> Team to accept", but the tab was
  // seller-only — so an invited staff account got a notification pointing at a tab that
  // did not exist for them, and sat 'invited' forever. An un-accepted membership applies
  // NO permission limits, so that state is not harmless.
  const [hasInvites, setHasInvites] = useState(false)
  // Which tab to open on. Two sources, in order:
  //   1. ?tab= in the URL — how the notification bell deep-links here
  //   2. a pending invite — so an OLD notification (whose href is bare '/settings')
  //      still lands on the thing it is telling you to do
  // Without this, clicking "X invited you to their team" opened Settings on Profile
  // and the invite was two clicks away with no sign it existed.
  const [tab, setTab] = useState("profile")
  useEffect(() => {
    const id = setTimeout(() => {
      const u = getUser()
      setIsAdmin(u?.role === "admin")
      setCanPlatform(u?.role === "admin" || u?.role === "warehouse")
      // A plan is a seller subscription; staff roles don't have one.
      setIsSeller(!u?.role || u.role === "seller")
      setCanUseKeys(!u?.role || u.role === "seller" || u.role === "admin")
      const wantedRaw = new URLSearchParams(window.location.search).get("tab")
      // "integrations" merged into the "keys" tab — keep old deep links working.
      const wanted = wantedRaw === "integrations" ? "keys" : wantedRaw
      if (wanted) setTab(wanted)
      getMyInvites().then((r) => {
        const any = (r ?? []).length > 0
        setHasInvites(any)
        if (any && !wanted) setTab("team")
      }).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [])
  const showTeam = isSeller || hasInvites

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        {/* API keys are for building AGAINST the platform — a seller integrating their
            own systems, or an admin. An operator works the floor and has nothing to
            integrate, so the tab is noise on their settings. */}
        {/* Merged: your own live/test keys (top) + the platform's connected-service
            credentials (admin-only, below). One tab so keys live in one place. */}
        {canUseKeys && <TabsTrigger value="keys">API keys</TabsTrigger>}
        {canPlatform && <TabsTrigger value="platform">Platform</TabsTrigger>}
        {/* ADMIN ONLY. Warehouse keeps Platform, Suppliers and Usage — this one writes
            users.password_hash, which is account takeover in one call. */}
        {isAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
        {/* Supplier ordering defaults. Warehouse/admin, matching who may spend — these
            decide how a purchase order pays and ships. */}
        {canPlatform && <TabsTrigger value="suppliers">Suppliers</TabsTrigger>}
        {/* Integration usage/spend — a cost concern, so warehouse/admin like Platform. */}
        {canPlatform && <TabsTrigger value="usage">Usage</TabsTrigger>}
        {/* Marketing-home copy — admin only, public-facing brand surface. */}
        {isAdmin && <TabsTrigger value="site">Site content</TabsTrigger>}
        {isAdmin && <TabsTrigger value="activity">Activity</TabsTrigger>}
        {/* Backups — admin-only. Restoring a lost database is the least reversible thing on
            the platform, so who can trigger/delete a backup matches who can touch money. */}
        {isAdmin && <TabsTrigger value="backups">Backups</TabsTrigger>}
        {/* Privacy — buyer-PII retention. Admin-only for the same reason as Backups: the
            purge is irreversible, so it sits with the people who can touch money. */}
        {isAdmin && <TabsTrigger value="privacy">Privacy</TabsTrigger>}
        {/* Permissions — admin-only, HIDE-only nav visibility per role. */}
        {isAdmin && <TabsTrigger value="permissions">Permissions</TabsTrigger>}
        {/* Team is a SELLER's own staff (and their permissions). Factory roles are managed
            in Users by admin/warehouse, so a "Team" tab on an operator's settings invites
            them to invite people into an account that isn't theirs. */}
        {showTeam && <TabsTrigger value="team">Team</TabsTrigger>}
        {/* Plan is a SELLER subscription — operator/warehouse/admin have no plan. */}
        {isSeller && <TabsTrigger value="plan">Plan</TabsTrigger>}
      </TabsList>

      <TabsContent value="profile">
        <ProfilePanel />
      </TabsContent>
      {canUseKeys && (
        <TabsContent value="keys" className="space-y-4">
          {/* Your own keys sit up top; the platform's connected-service credentials
              (admin-only) follow below as collapsible rows. */}
          <ApiKeysPanel />
          {isAdmin && <IntegrationsPanel />}
        </TabsContent>
      )}
      {canPlatform && (
        <TabsContent value="platform">
          {/* The volume ladder sits with the other platform money settings rather than in
              its own tab: it is the same kind of decision as a fee, and the seller-facing
              half of it lives on their Plan tab. */}
          <div className="space-y-4">
            <PlatformPanel />
            <VolumeTiersPanel />
          </div>
        </TabsContent>
      )}
      {canPlatform && (
        <TabsContent value="suppliers">
          <SectionCard
            title="Supplier ordering"
            description="How purchase orders pay and ship, set once instead of on every order."
          >
            <SupplierOrderingSettings />
          </SectionCard>
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="users">
          <UsersPanel />
        </TabsContent>
      )}
      {canPlatform && (
        <TabsContent value="usage">
          <UsagePanel isAdmin={isAdmin} />
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="activity">
          <ActivityPanel />
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="backups">
          <BackupsPanel />
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="privacy">
          <PiiRetentionPanel />
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="permissions">
          <PermissionsMatrix />
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="site">
          <SiteContentPanel />
        </TabsContent>
      )}
      {/* Same condition as the trigger — gating the two differently would render a tab
          that opens onto nothing. */}
      {showTeam && (
        <TabsContent value="team">
          <TeamPanel />
        </TabsContent>
      )}
      {isSeller && (
        <TabsContent value="plan">
          {/* The plan is BOUGHT; the volume rate is EARNED. They sit together because a
              seller asking "what am I paying" means both, but they are separate cards
              because conflating them is what makes a subscription look like a discount. */}
          <div className="space-y-4">
            <SubscriptionPanel />
            <VolumeBoard />
          </div>
        </TabsContent>
      )}
    </Tabs>
  )
}
