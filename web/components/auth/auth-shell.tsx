import Link from "next/link"
import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { PLATE_DEEP, ACID, SURFACE } from "@/components/marketing/bold-kit"

/**
 * Shared card shell for auth pages (login/signup/forgot/reset) — one wordmark, one layout.
 *
 * Auth belongs to the MARKETING look, not the app shell (CLAUDE.md §4): signing in is the
 * last page of the marketing site rather than the first page of the product. This sat on a
 * plain `bg-background` — a white card centred on a white page — so it was the one surface
 * the palette never reached, and it read as a different product to anyone arriving from
 * the site.
 *
 * The plate is the same PLATE_DEEP the hero and the header use, so there is exactly one
 * violet in the system and no second value here to drift when that one moves.
 */
export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center p-6"
      style={{ background: PLATE_DEEP }}
    >
      {/* The wordmark sits ON the plate rather than inside the card. It belongs to the site,
          and lifting it out is what stops the card reading as a lone box floating in the
          middle of an empty page. Paper on the plate is 5.68:1, the green 5.07:1. */}
      <Link
        href="/"
        className="font-display text-3xl font-semibold tracking-tight"
        style={{ color: SURFACE }}
      >
        egfulfill
      </Link>
      <p className="mt-2 text-sm" style={{ color: ACID }}>{subtitle}</p>

      <Card className="mt-7 w-full max-w-sm gap-0 p-6 shadow-xl">{children}</Card>

      <Link
        href="/"
        className="mt-6 text-xs opacity-70 transition-opacity hover:opacity-100"
        style={{ color: SURFACE }}
      >
        ← Back to egfulfill
      </Link>
    </div>
  )
}
