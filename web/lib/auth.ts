// Auth session — reuses the existing static-site localStorage keys so the Next
// app and the current site share one login (JWT issued by /api/auth).
const TOKEN_KEY = "eg_token"
const USER_KEY = "eg_user"

export type User = { id?: string; name?: string; email?: string; role?: string; avatar_emoji?: string | null; avatar_color?: string | null; notify_sound?: boolean; plan?: string; spydeck_addon?: boolean }

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function setSession(token: string, user: User) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* ignore */
  }
}

// Merge fields into the cached user (e.g. after a profile update). Token unchanged.
export function updateUser(patch: Partial<User>) {
  try {
    const cur = getUser() ?? {}
    localStorage.setItem(USER_KEY, JSON.stringify({ ...cur, ...patch }))
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    // Drop any half-finished OAuth handshake too. A verifier left behind by a logged-out
    // session is bound to a code that can no longer be exchanged, and it survives into
    // the next login where it just fails confusingly.
    localStorage.removeItem("eg_etsy_pkce")
    localStorage.removeItem("eg_shopify_oauth")
  } catch {
    /* ignore */
  }
}
