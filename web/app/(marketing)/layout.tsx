import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"

const nav = [
  { label: "Products", href: "/catalog" },
  { label: "Features", href: "/features" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "API", href: "/docs" },
]

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // The home hero used to be a black brand plate, so the header inverted to
  // light-on-dark on "/" only. The hero is a themed light surface now, so that special
  // case is gone — one header everywhere, which also means it can't be half-inverted
  // during a theme switch.
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
          <Link href="/" className="font-display text-2xl font-semibold tracking-tight">
            egfulfill
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {nav.map((n) => (
              <Link
                key={n.label}
                href={n.href}
                className="rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/login"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Log in
            </Link>
            <Link href="/login" className={buttonVariants({ size: "sm" })}>
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-display text-xl font-semibold tracking-tight">egfulfill</div>
            <div className="mt-1 text-sm text-muted-foreground">Hands-off print-on-demand fulfillment.</div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/catalog" className="hover:text-foreground">Products</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/how-it-works" className="hover:text-foreground">How it works</Link>
            <Link href="/features" className="hover:text-foreground">Features</Link>
            <Link href="/docs" className="hover:text-foreground">API</Link>
            <Link href="/login" className="hover:text-foreground">Log in</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </nav>
        </div>
        <div className="flex flex-col items-center justify-between gap-2 border-t border-border py-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>© 2026 EGFULFILL. All rights reserved.</span>
          <span className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
