"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { signupUser } from "@/lib/api"
import { setSession } from "@/lib/auth"

export default function SignupPage() {
  const router = useRouter()
  const [store, setStore] = useState("")
  const [email, setEmail] = useState("")
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
      const r = await signupUser({ email: email.trim(), password, store_name: store.trim(), name: store.trim() })
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
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required />
        </label>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </Button>
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
