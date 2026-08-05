"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getToken, getUser, setSession, getRememberedIdentifier, setRememberedIdentifier } from "@/lib/auth"
import { API_BASE } from "@/lib/api"
import { landingFor } from "@/lib/staff-nav"
import { GoogleSignIn } from "@/components/auth/google-signin"
import { AuthShell } from "@/components/auth/auth-shell"

/**
 * Where to go after signing in.
 *
 * Only same-origin relative paths are honoured. A `next` that is a full URL, or
 * protocol-relative ("//evil.example"), is an open redirect: an attacker sends
 * /login?next=//their-site, the victim signs in on the real page, and gets bounced to a
 * copy asking them to "sign in again". Requiring a single leading slash rules both out.
 */
function safeNext(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  return raw
}

export default function LoginPage() {
  const router = useRouter()
  const [next, setNext] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  // Defaults ON, which is exactly today's behaviour — nobody who ignores this box is
  // signed out by its arrival.
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Read the intended destination, and skip the form entirely for someone who already
  // has a session — arriving at a login page you don't need is the failure this fixes.
  // Deferred: localStorage doesn't exist during the prerender.
  useEffect(() => {
    const id = setTimeout(() => {
      const want = safeNext(new URLSearchParams(window.location.search).get("next"))
      setNext(want)
      if (getToken()) {
        const role = getUser()?.role
        router.replace(want ?? landingFor(typeof role === "string" ? role : null))
        return
      }
      // Fill in who you are, so the only thing left to type is the secret. Deferred with
      // the rest: reading localStorage at useState-init time would make the server and
      // client markup disagree.
      const last = getRememberedIdentifier()
      if (last) setEmail(last)
    }, 0)
    return () => clearTimeout(id)
  }, [router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        token?: string
        user?: unknown
        error?: string
        message?: string
        data?: { token?: string; user?: unknown }
        session?: { access_token?: string }
      }
      if (!res.ok) throw new Error(j.error || j.message || "Invalid email or password")
      const token = j.token ?? j.data?.token ?? j.session?.access_token
      const user = (j.user ?? j.data?.user ?? {}) as Record<string, unknown>
      if (!token) throw new Error("No session token returned")
      setSession(token, user, remember)
      // Only after the credentials were accepted. Storing it on submit would leave a
      // typo remembered as though it were the account.
      setRememberedIdentifier(remember ? email.trim() : null)
      router.push(next ?? landingFor(typeof user.role === "string" ? user.role : null))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    // AuthShell, not a private copy of it. This page had its own inline card+wordmark that
    // was a near-duplicate of the shared one, which is why signup picked up the new plate
    // and login didn't.
    <AuthShell subtitle="Sign in to your account">
      <form onSubmit={onSubmit} className="space-y-4">
          <label className="flex flex-col gap-1.5">
            {/* Either identifier. type="text", NOT type="email" — the browser's email
                validation would reject a bare username before the form ever submits.
                The server decides which column to match on by whether it contains '@'. */}
            <span className="text-sm font-medium">Email or username</span>
            <Input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com or yourname"
              autoComplete="username"
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Password</span>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>
          {/* Two jobs in one box, and the second is the one worth naming: it decides
              whether the session survives the browser closing. Unchecked, it lives in
              sessionStorage — which is what you want on the shared floor terminal, where
              the previous person otherwise stays signed in for you. */}
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="size-4 accent-primary"
              />
              Remember me
            </label>
            <span className="text-xs text-muted-foreground">
              {remember ? "Stay signed in on this device" : "Sign out when the browser closes"}
            </span>
          </div>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>

          {/* The divider lives INSIDE GoogleSignIn — when Google isn't configured the
              button renders nothing, and a lone "or" above empty space read as a
              broken button. */}
          {/* Same destination rule as the password path — Google sign-in used to always
              land on /dashboard, which is wrong for staff and ignores `next`. */}
          <GoogleSignIn
            onSuccess={() => {
              const role = getUser()?.role
              router.push(next ?? landingFor(typeof role === "string" ? role : null))
            }}
            onError={setError}
          />

          <div className="flex items-center justify-between text-xs">
            <Link href="/forgot-password" className="font-medium text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
            <Link href="/signup" className="font-medium text-foreground hover:underline">
              Create account
            </Link>
          </div>
      </form>
    </AuthShell>
  )
}
