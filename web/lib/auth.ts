// Auth session — reuses the existing static-site localStorage keys so the Next
// app and the current site share one login (JWT issued by /api/auth).
const TOKEN_KEY = "eg_token"
const USER_KEY = "eg_user"
// The identifier only — never a password. The browser's own password manager is better at
// that than we would be, and it already offers to do it on this form.
const LAST_ID_KEY = "eg_last_identifier"

export type User = { id?: string; name?: string; username?: string | null; email?: string; role?: string; avatar_emoji?: string | null; avatar_color?: string | null; notify_sound?: boolean; plan?: string; spydeck_addon?: boolean }

/**
 * WHERE A SESSION LIVES, and why it is a choice.
 *
 * localStorage outlives the browser closing; sessionStorage does not. Every session used to
 * go to localStorage unconditionally, which on a shared floor terminal means the last person
 * to sign in stays signed in for the next one. "Remember me" is what picks between them, and
 * it defaults to ON so nobody who never touches it is quietly logged out.
 *
 * Reads check sessionStorage FIRST. A machine can hold a stale localStorage token from a
 * previous "remember me" login; the session store is the more recent, more specific answer,
 * and setSession clears the other side anyway so the two cannot disagree for long.
 *
 * The legacy static site reads eg_token from localStorage only, so a session the user asked
 * NOT to persist does not carry across to the old pages. That is the correct reading of the
 * request, but it is a real behaviour difference until those pages are retired.
 */
const stores = (): Storage[] => {
  if (typeof window === "undefined") return []
  try {
    return [window.sessionStorage, window.localStorage]
  } catch {
    return []
  }
}

const read = (key: string): string | null => {
  for (const s of stores()) {
    try {
      const v = s.getItem(key)
      if (v != null) return v
    } catch {
      /* a blocked store must not hide the other one */
    }
  }
  return null
}

export function getToken(): string | null {
  return read(TOKEN_KEY)
}

export function getUser(): User | null {
  try {
    const raw = read(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

/**
 * Replace ONLY the token, leaving the stored user and the remember-me choice alone.
 *
 * For the sliding-session renewal: the server hands back a fresh token on a response, and
 * nothing else about the session has changed. setSession would be wrong here — it needs a
 * User it doesn't have, and its remember flag would MOVE the session between localStorage
 * and sessionStorage, quietly converting "don't remember me" into "remember me".
 */
/**
 * WHO MAY SEE MONEY — prices, costs, what an order earned, what it can refund.
 *
 * Mirrors canSeeMoney() in server/src/auth.js, which is the boundary that actually refuses:
 * the charges route answers a warehouse hand with the withheld shape (`gated: true`), so
 * these figures are not merely hidden here, they never arrive. This exists so the page does
 * not render an empty money panel it will never be able to fill.
 *
 * WAREHOUSE SEES NONE (2026-08-24). The floor prints, packs and scans; what the order was
 * worth informs none of that, and it is the number most likely to be read over a shoulder on
 * a factory floor. Every other staff role is unchanged.
 *
 * ONE PREDICATE, not a role test per panel. There were eight hand-rolled
 * `role === "admin" || role === "warehouse"` checks across the app and they had already
 * drifted — payouts.js spelled its own out and would have kept paying after every other
 * surface moved. Import this; never re-derive it.
 */
export function canSeeMoney(role?: string | null): boolean {
  const r = String(role ?? getUser()?.role ?? "")
  return !!r && r !== "warehouse"
}

export function setToken(token: string) {
  try {
    for (const s of stores()) {
      if (s && s.getItem(TOKEN_KEY) != null) { s.setItem(TOKEN_KEY, token); return }
    }
  } catch {
    /* ignore */
  }
}

export function setSession(token: string, user: User, remember = true) {
  const [session, local] = stores()
  if (!session || !local) return
  const keep = remember ? local : session
  const drop = remember ? session : local
  try {
    keep.setItem(TOKEN_KEY, token)
    keep.setItem(USER_KEY, JSON.stringify(user))
    // Signing in without "remember me" must actually REMOVE the persistent copy, or the
    // old token is still sitting there when the browser reopens — the exact thing the
    // unchecked box was asking us not to do.
    drop.removeItem(TOKEN_KEY)
    drop.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

// Merge fields into the cached user (e.g. after a profile update). Token unchanged.
// Written back to whichever store actually holds the session, so a profile edit in a
// non-persistent session doesn't silently create a persistent one.
export function updateUser(patch: Partial<User>) {
  try {
    const cur = getUser() ?? {}
    const next = JSON.stringify({ ...cur, ...patch })
    for (const s of stores()) {
      if (s.getItem(TOKEN_KEY) != null) { s.setItem(USER_KEY, next); return }
    }
  } catch {
    /* ignore */
  }
}

/** The last identifier signed in with, when the user asked us to keep it. */
export function getRememberedIdentifier(): string {
  try {
    return localStorage.getItem(LAST_ID_KEY) ?? ""
  } catch {
    return ""
  }
}

export function setRememberedIdentifier(value: string | null) {
  try {
    if (value) localStorage.setItem(LAST_ID_KEY, value)
    else localStorage.removeItem(LAST_ID_KEY)
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    for (const s of stores()) {
      s.removeItem(TOKEN_KEY)
      s.removeItem(USER_KEY)
    }
    // The remembered identifier deliberately SURVIVES sign-out — being signed out is the
    // moment it earns its keep, and it is not a credential.
    // Drop any half-finished OAuth handshake too. A verifier left behind by a logged-out
    // session is bound to a code that can no longer be exchanged, and it survives into
    // the next login where it just fails confusingly.
    localStorage.removeItem("eg_etsy_pkce")
    localStorage.removeItem("eg_shopify_oauth")
  } catch {
    /* ignore */
  }
}
