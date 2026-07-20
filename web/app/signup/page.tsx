"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GoogleSignIn } from "@/components/auth/google-signin"
import { signupUser } from "@/lib/api"
import { setSession } from "@/lib/auth"

export default function SignupPage() {
  const router = useRouter()
  const [store, setStore] = useState("")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    setLoading(true)
    try {
      const r = await signupUser({ email: email.trim(), username: username.trim() || undefined, password, store_name: store.trim(), name: store.trim() })
      if (r.error) throw new Error(r.error)
      if (r.token) {
        setSession(r.token, r.user ?? {})
        router.push("/dashboard")
      } else {
        router.push("/login")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account.")
    } finally {
      setLoading(false)
    }
  }

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
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required />
        </label>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </Button>

        {/* No divider here — GoogleSignIn renders its own, so this page was showing
            two "or" separators stacked. */}
        <GoogleSignIn onSuccess={() => router.push("/dashboard")} onError={setError} />

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
