"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, CircleNotch, LockSimple } from "@phosphor-icons/react"
import {
  visSurfaces, effectiveHidden, refreshNavVisibility, setNavVisibilityCache,
  VIS_ROLES, VIS_ROLE_LABEL, type VisRole,
} from "@/lib/nav-visibility"
import { putNavVisibility } from "@/lib/api"

/**
 * Admin-only matrix: hide pages and tabs per role. A checkbox means VISIBLE. Un-checking
 * HIDES that surface for that role — it can never REVEAL a page a role can't already reach
 * (a cell only exists where the role has the capability), and the backend guards are
 * untouched. So the worst a wrong click does is hide something.
 */
export function PermissionsMatrix() {
  const surfaces = useMemo(() => visSurfaces(), [])
  const groups = useMemo(() => {
    const g: Record<string, typeof surfaces> = {}
    for (const s of surfaces) (g[s.group] ||= []).push(s)
    return g
  }, [surfaces])

  const [hidden, setHidden] = useState<Record<VisRole, string[]> | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    refreshNavVisibility().then(() => { if (alive) setHidden(effectiveHidden()) })
    return () => { alive = false }
  }, [])

  const isVisible = (role: VisRole, key: string) => !(hidden?.[role] || []).includes(key)
  const toggle = (role: VisRole, key: string) => {
    setHidden((h) => {
      if (!h) return h
      const list = new Set(h[role] || [])
      if (list.has(key)) list.delete(key)
      else list.add(key)
      return { ...h, [role]: [...list] }
    })
    setMsg(null)
  }

  const save = async () => {
    if (!hidden) return
    setSaving(true); setMsg(null)
    try {
      const r = await putNavVisibility(hidden)
      if (r && r.ok) { setNavVisibilityCache(hidden); setMsg("Saved — users pick it up on their next page load.") }
      else setMsg(r?.error || "Could not save.")
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save.")
    } finally { setSaving(false) }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Permissions</h2>
      <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
        <LockSimple size={14} weight="fill" className="mt-0.5 shrink-0" />
        <span>A check means <strong>visible</strong>. Un-checking <strong>hides</strong> that page or tab for the role. This only ever hides — it can never expose a staff/internal page to a role that isn&apos;t already allowed it, and backend access controls are unchanged.</span>
      </p>

      {!hidden ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="mt-4 space-y-6">
          {Object.entries(groups).map(([group, list]) => (
            <div key={group}>
              <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Surface</th>
                      {VIS_ROLES.map((r) => <th key={r} className="px-3 py-2 text-center font-medium">{VIS_ROLE_LABEL[r]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.key} className="border-b border-border/60">
                        <td className="py-2 pr-4">{s.label}</td>
                        {VIS_ROLES.map((r) => (
                          <td key={r} className="px-3 py-2 text-center">
                            {s.roles.includes(r) ? (
                              <button
                                type="button"
                                onClick={() => toggle(r, s.key)}
                                aria-pressed={isVisible(r, s.key)}
                                title={isVisible(r, s.key) ? "Visible — click to hide" : "Hidden — click to show"}
                                className={"inline-flex size-6 items-center justify-center rounded-md border transition-colors " + (isVisible(r, s.key) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-transparent hover:text-muted-foreground")}
                              >
                                <Check size={14} weight="bold" />
                              </button>
                            ) : (
                              <span className="text-muted-foreground/30" title="Role can't access this — nothing to hide">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-3">
            <button
              type="button" onClick={save} disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors disabled:opacity-50"
            >
              {saving ? <CircleNotch size={16} className="animate-spin" /> : null} Save
            </button>
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
