"use client"

/**
 * THE PICKED PAIR, DRAWN WITH THE REAL COMPONENTS — band 5 (plate + object cluster) and
 * tile B (no icon, a rule). This is a crop check: the band is `PageBand` itself, at true
 * height, in both themes. The cluster no longer varies by role, so the four rows below are
 * now a check on the TYPE at four name lengths. noindex.
 */

import { PageBand } from "@/components/app/page-band"

const ROLES = [
  ["seller", "Good afternoon, uyen"],
  ["operator", "Good afternoon, Trang"],
  ["warehouse", "Good afternoon, Khoa"],
  ["designer", "Good afternoon, Mai"],
] as const

const SHORTCUTS = [
  ["Board", "Artwork board"],
  ["Broadcasts", "Seller email"],
  ["Orders", "Production queue"],
  ["Products", "Catalog + blanks"],
]

function Column({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : ""}>
      <div data-skin="balloon" className="min-h-full space-y-4 bg-background px-6 py-6 text-foreground">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{dark ? "Dark" : "Light"}</p>

        {ROLES.map(([role, greet]) => (
          <div key={role} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{role}</p>
            <PageBand
              title={greet}
              sub={<><span className="font-medium text-[var(--mk-acid)]">5</span> new today</>}
            />
          </div>
        ))}

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">admin — the range control lives here</p>
          <PageBand title="Good afternoon, Linh" sub="Mon 8 Sep">
            <div className="flex gap-1 rounded-lg bg-sidebar-accent p-0.5 text-xs">
              {["Today", "7 days", "30 days", "All"].map((r, i) => (
                <span key={r} className={"rounded px-2.5 py-1 " + (i === 2 ? "bg-sidebar text-sidebar-foreground" : "text-sidebar-foreground/60")}>{r}</span>
              ))}
            </div>
          </PageBand>
        </div>

        <div className="space-y-1.5 pt-2">
          <p className="text-xs font-medium text-muted-foreground">shortcuts — B</p>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-4">
            {SHORTCUTS.map(([label, desc]) => (
              <div key={label} className="group flex min-h-[96px] flex-col items-start justify-center gap-2.5 rounded-lg border border-border p-4 transition-colors hover:border-primary/40 hover:bg-accent">
                <span className="h-1 w-6 rounded-full bg-border transition-colors group-hover:bg-brand" />
                <span>
                  <span className="block text-base font-semibold leading-tight tracking-tight">{label}</span>
                  <span className="mt-1 block text-sm leading-snug text-muted-foreground">{desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DecorLab() {
  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">Band 5 + tiles B — the real components</h1>
      </div>
      <div className="grid md:grid-cols-2">
        <Column dark={false} />
        <Column dark />
      </div>
    </main>
  )
}
