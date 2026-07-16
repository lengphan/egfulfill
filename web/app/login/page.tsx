"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { setSession } from "@/lib/auth"
import { API_BASE } from "@/lib/api"
import { GoogleSignIn } from "@/components/auth/google-signin"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
      setSession(token, user)
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm gap-0 p-0">
        <div className="border-b border-border px-6 py-5 text-center">
          <div className="font-display text-2xl font-semibold tracking-tight">egfulfill</div>
          <div className="mt-1 text-sm text-muted-foreground">Sign in to your account</div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 p-6">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Email/Username</span>
            <Input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
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
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-card px-2 text-xs text-muted-foreground">or</span>
            </div>
          </div>

          <GoogleSignIn onSuccess={() => router.push("/dashboard")} onError={setError} />

          <div className="flex items-center justify-between text-xs">
            <Link href="/forgot-password" className="font-medium text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
            <Link href="/signup" className="font-medium text-foreground hover:underline">
              Create account
            </Link>
          </div>
        </form>
      </Card>
    </div>
  )
}
