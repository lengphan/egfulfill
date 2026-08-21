"use client"

import { useEffect, useState } from "react"
import { Check } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { getUser, setSession, getRememberedIdentifier, setRememberedIdentifier } from "@/lib/auth"
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

  /**
   * THIS PAGE ALWAYS SHOWS THE FORM. It never walks anyone into the app on its own.
   *
   * It used to: a token in storage meant an immediate router.replace to that role's landing
   * board, with no form and no server check. A leftover `eg_token` is not a signed-in
   * person — it is left by the previous user of the machine, by a session that has since
   * expired or been revoked, or by the legacy static site, which writes the same key. So
   * pressing "Start free" on the marketing site and then "Log in" dropped a visitor who has
   * never signed up onto somebody's staff board, and nothing on the way asked the server
   * whether that token was still worth anything.
   *
   * What survives from that shortcut is the useful half: the identifier is remembered and
   * filled in, so the only thing left to type is the secret. Deferred because localStorage
   * doesn't exist during the prerender, and reading it at useState-init would make the
   * server and client markup disagree.
   */
  useEffect(() => {
    const id = setTimeout(() => {
      setNext(safeNext(new URLSearchParams(window.location.search).get("next")))
      // `?id=` wins: it is carried by signup's "Log in as <name>" link, and it is the same
      // machine's remembered identifier anyway — but honouring it explicitly means the link
      // keeps its promise even if the two ever disagree.
      const asked = new URLSearchParams(window.location.search).get("id")
      const last = asked || getRememberedIdentifier()
      if (last) setEmail(last)
    }, 0)
    return () => clearTimeout(id)
  }, [])

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
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>
          {/**
            * ONE CONTROL, ONE LABEL — and the label is the sentence that used to sit beside it.
            *
            * It was "Remember me" with `{remember ? "Stay signed in on this device" : "Sign out
            * when the browser closes"}` in grey alongside: a caption explaining a control that
            * is already on screen, which §4 calls a defect and which the owner spends real time
            * deleting. Worse, it explained the WRONG half — "Remember me" reads as "fill my
            * email in next time", and the thing this box actually decides is whether the
            * session survives the browser closing (localStorage vs sessionStorage, which is
            * what you want off on the shared floor terminal, where the previous person
            * otherwise stays signed in for you). Naming that in the label makes the caption
            * redundant rather than merely shorter.
            *
            * And the checkbox is the app's, not the browser's. A raw `<input type="checkbox">`
            * was the one unstyled control on the page.
            */}
          <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
            <span className="relative flex size-4 items-center justify-center">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="peer size-4 cursor-pointer appearance-none rounded-[5px] border border-(--auth-edge) bg-(--auth-field) outline-none transition-colors checked:border-foreground checked:bg-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <Check
                size={11} weight="bold" aria-hidden
                className="pointer-events-none absolute text-background opacity-0 peer-checked:opacity-100"
              />
            </span>
            Stay signed in on this device
          </label>
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
