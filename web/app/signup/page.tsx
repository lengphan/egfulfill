"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { landingFor } from "@/lib/staff-nav"
import { GoogleSignIn } from "@/components/auth/google-signin"
import { signupUser } from "@/lib/api"
import { getToken, getUser, setSession } from "@/lib/auth"

/** Same-origin relative paths only — see the note in app/login/page.tsx. */
function safeNext(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  return raw
}

export default function SignupPage() {
  const router = useRouter()
  const [next, setNext] = useState<string | null>(null)

  // Carry an intended destination through signup too, and don't show a signup form to
  // someone who already has a session.
  /**
   * Has the session check run yet?
   *
   * The redirect below is correct but ORDERED WRONG for the eye: the form renders, then the
   * deferred effect reads localStorage, then it replaces the route — so someone who is
   * already signed in sees a frame of a login form they don't need. There is no server-side
   * fix available: the session lives in localStorage/sessionStorage (that is what makes
   * "remember me" work), so the server cannot see it and middleware cannot gate it.
   *
   * So the form waits. A signed-out visitor loses roughly one frame before it appears; a
   * signed-in one never sees it at all, which is the trade worth making.
   */
  const [sessionChecked, setSessionChecked] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => {
      const want = safeNext(new URLSearchParams(window.location.search).get("next"))
      setNext(want)
      if (getToken()) {
        const role = getUser()?.role
        router.replace(want ?? landingFor(typeof role === "string" ? role : null))
        return
      }
      setSessionChecked(true)
    }, 0)
    return () => clearTimeout(id)
  }, [router])
  const [store, setStore] = useState("")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 12) {
      setError("Password must be at least 12 characters, with upper and lower case, a number and a symbol.")
      return
    }
    setLoading(true)
    try {
      // Display name comes from the USERNAME they chose (their exact identifier), not the
      // store name — copying the store name in made e.g. a shop called "baby" show up as the
      // person's name. Fall back to the store name, then the email local part, so the name is
      // never blank when username is skipped.
      const r = await signupUser({
        email: email.trim(),
        username: username.trim() || undefined,
        password,
        store_name: store.trim(),
        name: username.trim() || store.trim() || email.trim().split("@")[0],
      })
      if (r.error) throw new Error(r.error)
      if (r.token) {
        setSession(r.token, r.user ?? {})
        const role = (r.user as { role?: string } | undefined)?.role
        router.push(next ?? landingFor(typeof role === "string" ? role : null))
      } else {
        router.push(next ? `/login?next=${encodeURIComponent(next)}` : "/login")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account.")
    } finally {
      setLoading(false)
    }
  }

  // Nothing until we know. Rendering the shell but not the form would still flash a
  // heading at someone who is on their way to the app.
  if (!sessionChecked) return null

  return (
    <AuthShell subtitle="Create your seller account">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Store name</span>
          <Input value={store} onChange={(e) => setStore(e.target.value)} placeholder="My Store" autoComplete="organization" />
        </label>
        {/* Email and username are SEPARATE, and email is required.
            The combined "Email/Username" field let someone register as "linh", which
            was stored in the email column — so password reset could never reach them,
            and because sign-in routes an identifier with no '@' to the username column,
            they could never sign in again either. */}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
          <span className="text-xs text-muted-foreground">We only use this for sign-in and password resets.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Username <span className="font-normal text-muted-foreground">— optional</span></span>
          <Input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="yourname" autoComplete="username" />
          <span className="text-xs text-muted-foreground">A shorter way to sign in. Letters, numbers, dot, dash or underscore.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" autoComplete="new-password" required />
        </label>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </Button>

        {/* No divider here — GoogleSignIn renders its own, so this page was showing
            two "or" separators stacked. */}
        {/* Google here is a sign-IN for anyone who already has an account, so it routes
            by role like login does — hardcoding /dashboard dropped staff on the seller
            board. */}
        <GoogleSignIn
          onSuccess={() => {
            const role = getUser()?.role
            router.push(next ?? landingFor(typeof role === "string" ? role : null))
          }}
          onError={setError}
        />

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
