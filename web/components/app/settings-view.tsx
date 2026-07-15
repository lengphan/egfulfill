"use client"

import { useCallback, useEffect, useState } from "react"
import { Key, Copy, Check, Trash, Plus, Warning, UserCircle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { IntegrationsPanel } from "@/components/app/integrations-panel"
import { SubscriptionPanel } from "@/components/app/subscription-panel"
import { getUser } from "@/lib/auth"
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getTeam,
  inviteMember,
  removeMember,
  type ApiKey,
  type TeamMember,
} from "@/lib/api"

const fmtDate = (s: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// ─────────────────────────── Profile ───────────────────────────
function ProfilePanel() {
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null)
  useEffect(() => {
    const id = setTimeout(() => setUser(getUser()), 0)
    return () => clearTimeout(id)
  }, [])

  const rows = [
    { label: "Name", value: user?.name || "—" },
    { label: "Email", value: user?.email || "—" },
    { label: "Role", value: user?.role || "seller" },
  ]

  return (
    <SectionCard title="Profile" description="Your account details">
      {!user && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-50 px-5 py-2.5 text-xs font-medium text-amber-700">
          <Warning size={14} weight="fill" /> Sign in to see your account details.
        </div>
      )}
      <div className="flex items-center gap-4 border-b border-border px-5 py-5">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <UserCircle size={30} weight="duotone" />
        </span>
        <div>
          <div className="text-lg font-semibold">{user?.name || "Your account"}</div>
          <div className="text-sm text-muted-foreground">{user?.email || "Not signed in"}</div>
        </div>
      </div>
      <dl className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-5 py-3.5 text-sm">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="font-medium capitalize">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        Profile editing is handled on the account server — coming to this screen soon.
      </div>
    </SectionCard>
  )
}

// ─────────────────────────── API keys ───────────────────────────
function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [label, setLabel] = useState("")
  const [creating, setCreating] = useState(false)
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
      const r = await createApiKey(label.trim() || "Test key")
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
      description="Test keys for the sandbox (/api/test/*) and the API Playground"
    >
      {/* create row */}
      <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Key label (e.g. Local testing)"
          className="sm:max-w-xs"
          onKeyDown={(e) => e.key === "Enter" && onCreate()}
        />
        <Button size="sm" onClick={onCreate} disabled={creating}>
          <Plus size={14} weight="bold" /> {creating ? "Generating…" : "Generate test key"}
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
export function SettingsView() {
  // Integrations is a platform/admin concern (Stripe secret, supplier creds, etc.) —
  // sellers never see it. Reveal only for staff (any non-seller role) after mount.
  const [isStaff, setIsStaff] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => {
      const u = getUser()
      setIsStaff(!!(u?.role && u.role !== "seller"))
    }, 0)
    return () => clearTimeout(id)
  }, [])

  return (
    <Tabs defaultValue="profile" className="space-y-4">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="keys">API keys</TabsTrigger>
        {isStaff && <TabsTrigger value="integrations">Integrations</TabsTrigger>}
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="plan">Plan</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <ProfilePanel />
      </TabsContent>
      <TabsContent value="keys">
        <ApiKeysPanel />
      </TabsContent>
      {isStaff && (
        <TabsContent value="integrations">
          <IntegrationsPanel />
        </TabsContent>
      )}
      <TabsContent value="team">
        <TeamPanel />
      </TabsContent>
      <TabsContent value="plan">
        <SubscriptionPanel />
      </TabsContent>
    </Tabs>
  )
}
