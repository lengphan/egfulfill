import Link from "next/link"
import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"

/** Shared card shell for auth pages (login/signup/forgot/reset) — one wordmark, one layout. */
export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm gap-0 p-0">
        <div className="border-b border-border px-6 py-5 text-center">
          <Link href="/" className="font-display text-2xl font-semibold tracking-tight">
            egfulfill
          </Link>
          <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
        </div>
        <div className="p-6">{children}</div>
      </Card>
    </div>
  )
}
