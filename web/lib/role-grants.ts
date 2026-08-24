// The GRANT half of Settings › Permissions — the mirror image of nav-visibility.ts.
//
// That file can only SUBTRACT: it hides surfaces a role already reaches, so the worst a wrong
// click does is hide something. This one WIDENS what a role may do, which is the opposite
// risk, so it is a separate module with a stricter shape and a different default:
//
//   * OFF is the default and the fallback. An unknown key, a failed load, a cache that has
//     not arrived yet — all answer false, so the UI matches the shipped rule until the server
//     says otherwise. A client that guessed "on" would draw a control the API then refuses.
//   * The client is never the gate. The server re-checks every grant on the route that acts
//     (server/src/routes/role_grants.js). This exists so a permitted control is DRAWN, not so
//     it is allowed.
import { useEffect, useState } from "react"
import { getRoleGrants, type RoleGrantDef, type RoleGrants } from "@/lib/api"

/** The one grant key the app reads by name today. Keeps the string out of call sites. */
export const GRANT_OPERATOR_EDIT_AFTER_APPROVAL = "operator.editAfterApproval"

let ACTIVE: RoleGrants = {}
let REGISTRY: RoleGrantDef[] = []
let loaded = false
let inflight: Promise<void> | null = null

export function loadRoleGrants(): Promise<void> {
  if (inflight) return inflight
  inflight = getRoleGrants()
    .then((r) => { ACTIVE = (r && r.grants) || {}; REGISTRY = (r && r.registry) || []; loaded = true })
    .catch(() => { loaded = true /* keep everything OFF */ })
  return inflight
}
export function refreshRoleGrants(): Promise<void> { inflight = null; loaded = false; return loadRoleGrants() }
export function setRoleGrantsCache(g: RoleGrants) { ACTIVE = g || {}; loaded = true }
export function getRoleGrantsCache(): RoleGrants { return ACTIVE }
export function roleGrantRegistry(): RoleGrantDef[] { return REGISTRY }

/** Is a grant on. False for anything unknown, unloaded or unset — see the header. */
export function isGrantOn(key: string): boolean { return ACTIVE[key] === true }

/** Re-render helper, exactly like useNavVisibility: load on mount, bump when ready. */
export function useRoleGrants(): number {
  const [v, setV] = useState(loaded ? 1 : 0)
  useEffect(() => {
    let alive = true
    loadRoleGrants().then(() => { if (alive) setV((n) => n + 1) })
    return () => { alive = false }
  }, [])
  return v
}
