"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle } from "@phosphor-icons/react"
import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { forgotPassword } from "@/lib/api"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const r = await forgotPassword(email.trim())
      if (r.error) throw new Error(r.error)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the reset request.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell subtitle="Reset your password">
      {sent ? (
        <div className="space-y-4 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100 text-success">
            <CheckCircle size={26} weight="fill" />
          </span>
          <div className="text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset link is on its way.
          </div>
          <Link href="/login" className="inline-block text-sm font-medium text-foreground hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Email</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
          </label>
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  )
}
