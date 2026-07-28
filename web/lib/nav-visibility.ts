// Admin-editable, HIDE-ONLY nav visibility. This layer can only SUBTRACT from what a role
// already sees — never add. Every consumer filters its OWN capability set (seller sidebar
// iterates sellerNav, staff sidebar iterates staffNav), so a hidden entry can only remove a
// surface, never surface a staff/internal page to a seller. Backend requireStaff/requireAdmin
// remain the real access gate; this is purely which menu items get drawn.
import { useEffect, useState } from "react"
import { sellerNav } from "@/lib/nav"
import { STAFF_ITEMS, STAFF_TOOLS } from "@/lib/staff-nav"
import { getNavVisibility } from "@/lib/api"

export type VisRole = "seller" | "operator" | "warehouse" | "designer" | "admin"
export const VIS_ROLES: VisRole[] = ["seller", "operator", "warehouse", "designer", "admin"]
export const VIS_ROLE_LABEL: Record<VisRole, string> = {
  seller: "Seller", operator: "Operator", warehouse: "Warehouse", designer: "Designer", admin: "Admin",
}
const isVisRole = (r: string): r is VisRole => (VIS_ROLES as string[]).includes(r)

// Landing / essential surfaces that must NEVER be hidden — hiding a role's landing page
// would strand it on a blank screen or a redirect loop after login (risk #1). Excluded from
// the toggle registry entirely, so the matrix can't touch them.
const ESSENTIAL = new Set<string>([
  "/dashboard", "/orders", "/settings", "/overview", "/operator", "/designer", "/earnings",
])

export type VisSurface = { key: string; label: string; group: string; roles: VisRole[] }

// Declared TAB surfaces (sub-pages the matrix can toggle). key = "<href>#<tab>".
const TAB_SURFACES: VisSurface[] = [
  { key: "/spydeck#trending", label: "SpyDeck · Trending feed", group: "Tabs", roles: ["seller", "operator", "warehouse", "admin"] },
  { key: "/spydeck#account", label: "SpyDeck · Shop analyzer", group: "Tabs", roles: ["seller", "operator", "warehouse", "admin"] },
  { key: "/spydeck#stores", label: "SpyDeck · Stores", group: "Tabs", roles: ["seller", "operator", "warehouse", "admin"] },
]

// Default-hidden surfaces per role, applied until an admin saves an explicit choice for that
// role. Mirrors the shipped behaviour: Trending is staff-only; operators also lose Analyzer.
export const DEFAULT_HIDDEN: Partial<Record<VisRole, string[]>> = {
  seller: ["/spydeck#trending"],
  operator: ["/spydeck#trending", "/spydeck#account"],
}

// Toggleable surface registry, built from the LIVE nav definitions (so it stays in sync) plus
// the declared tabs. Essentials are excluded so they can never be hidden.
export function visSurfaces(): VisSurface[] {
  const out: VisSurface[] = []
  const seen = new Set<string>()
  const add = (key: string, label: string, group: string, roles: VisRole[]) => {
    if (ESSENTIAL.has(key) || !roles.length) return
    const dedupe = group + "|" + key
    if (seen.has(dedupe)) return
    seen.add(dedupe)
    out.push({ key, label, group, roles })
  }
  for (const section of sellerNav) for (const it of section.items) add(it.href, it.label, "Seller pages", ["seller"])
  for (const it of [...STAFF_ITEMS, ...STAFF_TOOLS]) add(it.href, it.label, "Staff pages", (it.roles || []).filter(isVisRole))
  out.push(...TAB_SURFACES)
  return out
}

// ── stored state (module cache, like the thread palette) ─────────────────────
export type HiddenMap = Partial<Record<VisRole, string[]>>
let ACTIVE: HiddenMap = {}
let loaded = false
let inflight: Promise<void> | null = null

export function loadNavVisibility(): Promise<void> {
  if (inflight) return inflight
  inflight = getNavVisibility()
    .then((r) => { ACTIVE = (r && r.hidden) || {}; loaded = true })
    .catch(() => { loaded = true /* keep defaults */ })
  return inflight
}
export function refreshNavVisibility(): Promise<void> { inflight = null; loaded = false; return loadNavVisibility() }
export function setNavVisibilityCache(m: HiddenMap) { ACTIVE = m || {}; loaded = true }
export function getNavVisibilityCache(): HiddenMap { return ACTIVE }

/**
 * The single predicate. Effective hidden = the role's STORED list if it has one, else the
 * role's DEFAULT list. It only ever answers "should this role hide a surface it can see" —
 * it can never grant one.
 */
export function isSurfaceHidden(role: string | null | undefined, key: string): boolean {
  if (!role || !isVisRole(role)) return false
  const stored = ACTIVE[role]
  const list = stored !== undefined ? stored : (DEFAULT_HIDDEN[role] || [])
  return list.includes(key)
}

/** The effective hidden-map (stored merged over defaults), for seeding the Settings matrix. */
export function effectiveHidden(): Record<VisRole, string[]> {
  const out = {} as Record<VisRole, string[]>
  for (const r of VIS_ROLES) {
    const stored = ACTIVE[r]
    out[r] = stored !== undefined ? [...stored] : [...(DEFAULT_HIDDEN[r] || [])]
  }
  return out
}

// Re-render helper: loads the map on mount and bumps a counter when ready, so render-time
// filters (isSurfaceHidden) pick up the loaded values.
export function useNavVisibility(): number {
  const [v, setV] = useState(loaded ? 1 : 0)
  useEffect(() => {
    let alive = true
    loadNavVisibility().then(() => { if (alive) setV((n) => n + 1) })
    return () => { alive = false }
  }, [])
  return v
}
