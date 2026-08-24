"use client"

import { useEffect, useState } from "react"
import { CircleNotch, ShieldWarning } from "@phosphor-icons/react"
import { Switch } from "@/components/ui/switch"
import { putRoleGrants, type RoleGrantDef, type RoleGrants } from "@/lib/api"
import { refreshRoleGrants, getRoleGrantsCache, roleGrantRegistry, setRoleGrantsCache } from "@/lib/role-grants"
import { VIS_ROLE_LABEL, type VisRole } from "@/lib/nav-visibility"

/**
 * THE GRANT HALF OF PERMISSIONS — a SEPARATE card from PermissionsMatrix on purpose.
 *
 * The matrix above can only hide, so the worst a wrong click there does is remove a page from
 * a menu. Everything here WIDENS what a role may do, which is the opposite risk, and putting
 * the two in one grid would have made them look like one kind of switch. They are not: a tick
 * in the matrix is a preference, a switch here is an access decision, and the server records
 * every change to one with both sides (`permissions.grants` in the audit log).
 *
 * The registry comes from the SERVER, not a copy here — role_grants.js is the closed list of
 * what may be granted, and a second list in the client is how the two come to disagree about
 * what exists.
 */
export function RoleGrantsPanel() {
  const [registry, setRegistry] = useState<RoleGrantDef[]>([])
  const [grants, setGrants] = useState<RoleGrants | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    refreshRoleGrants().then(() => {
      if (!alive) return
      setRegistry(roleGrantRegistry())
      setGrants({ ...getRoleGrantsCache() })
    })
    return () => { alive = false }
  }, [])

  const save = async (next: RoleGrants) => {
    setSaving(true); setMsg(null)
    try {
      const r = await putRoleGrants(next)
      if (r && r.ok) { setRoleGrantsCache(r.grants || next); setMsg("Saved — staff pick it up on their next page load.") }
      else { setMsg(r?.error || "Could not save."); setGrants({ ...getRoleGrantsCache() }) }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save.")
      setGrants({ ...getRoleGrantsCache() })
    } finally { setSaving(false) }
  }

  /* SAVED ON THE FLIP, unlike the matrix's explicit Save. A grant is one switch and one
     consequence, so there is no set of related edits to commit together — and a permission
     that looks on but was never saved is the failure mode worth designing out. A refusal
     puts the switch back where the server has it. */
  const flip = (key: string, on: boolean) => {
    if (!grants) return
    const next = { ...grants, [key]: on }
    setGrants(next)
    void save(next)
  }

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Extra permissions</h2>
      <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldWarning size={14} weight="fill" className="mt-0.5 shrink-0" />
        <span>These <strong>widen</strong> what a role may do, unlike the list above. Every change is recorded in the audit log with who made it.</span>
      </p>

      {!grants ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !registry.length ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No extra permissions are available.</div>
      ) : (
        <div className="mt-4 divide-y divide-border/60">
          {registry.map((g) => (
            <div key={g.key} className="flex items-start justify-between gap-6 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {VIS_ROLE_LABEL[g.role as VisRole] ?? g.role} · {g.label}
                </div>
                {/* THE CONSEQUENCE, not a caption. §4 forbids explaining a control that
                    explains itself — but "Edit an order after approval" does not say where
                    the reach still STOPS, and an admin widening access is entitled to the
                    edge before they press. Same standing as a refusal carrying its reason. */}
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{g.note}</p>
              </div>
              <Switch
                checked={grants[g.key] === true}
                onCheckedChange={(on: boolean) => flip(g.key, on)}
                disabled={saving}
                aria-label={g.label}
              />
            </div>
          ))}
          <div className="flex items-center gap-3 pt-3">
            {saving && <CircleNotch size={14} className="animate-spin text-muted-foreground" />}
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
