"use client"

import { useCallback, useEffect, useState } from "react"
import { Megaphone, CircleNotch, Warning, Plus, Play, Pause, ArrowSquareOut } from "@phosphor-icons/react"
import Link from "next/link"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getAdsConfig, getAdConnections, getAdCampaigns, createAdCampaign, setAdCampaignStatus, type AdsConfig, type AdConnection, type AdsResponse } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { PageTitle } from "@/components/app/page-title"

const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const int = (n: number) => (n ?? 0).toLocaleString("en-US")
const DAYS = [7, 14, 30, 90]

const CHANNEL: Record<string, { label: string; cls: string }> = {
 meta: { label: "Meta", cls: "bg-sky-100 text-sky-700" },
 google: { label: "Google", cls: "bg-hold/15 text-hold" },
}

// Meta + Google campaign performance for the team. Read is the point; create makes
// the campaign shell (paused) — targeting/creative stay in the providers' tools.
export function CampaignsView() {
 const [cfg, setCfg] = useState<AdsConfig | null>(null)
 const [conns, setConns] = useState<AdConnection[]>([])
 const [data, setData] = useState<AdsResponse | null>(null)
 const [days, setDays] = useState(7)
 const [loading, setLoading] = useState(true)
 const [err, setErr] = useState<string | null>(null)
 const [newOpen, setNewOpen] = useState(false)
 const [busy, setBusy] = useState<string | null>(null)
 const [role, setRole] = useState("")

 const load = useCallback((d: number) => {
 if (!getToken()) { setLoading(false); return }
 setLoading(true); setErr(null)
    Promise.all([
 getAdsConfig().catch(() => null),
 getAdConnections().catch(() => []),
 getAdCampaigns(d).catch((e) => { setErr(e instanceof Error ? e.message : "Could not load campaigns"); return null }),
    ])
      .then(([c, cn, camp]) => { setCfg(c); setConns(cn ?? []); setData(camp) })
      .finally(() => setLoading(false))
  }, [])
 useEffect(() => {
 const id = setTimeout(() => { setRole(getUser()?.role || ""); load(days) }, 0)
 return () => clearTimeout(id)
  }, [days, load])

 const toggle = async (channel: string, id: string, status: string) => {
 const next = status === "active" ? "PAUSED" : "ACTIVE"
 setBusy(id)
 try { await setAdCampaignStatus(channel, id, next); load(days) }
 catch (e) { setErr(e instanceof Error ? e.message : "Could not update the campaign") }
 finally { setBusy(null) }
  }

 const connected = conns.length > 0
  // Optional-chain the NESTED keys too: `cfg?.meta.enabled` only guards cfg, so a config
  // response without a `meta` block took the whole page down.
 const anyEnabled = !!(cfg?.meta?.enabled || cfg?.google?.enabled)

 return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 md:hidden">
          <Megaphone size={18} weight="regular" className="shrink-0 text-primary" />
          <div>
            <PageTitle>Campaigns</PageTitle>
            <p className="text-sm text-muted-foreground">Facebook &amp; Google ad performance{data ? ` · ${data.since} → ${data.until}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {DAYS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className={"eg-tap rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " + (days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{d}d</button>
            ))}
          </div>
          {connected && <Button size="sm" onClick={() => setNewOpen(true)}><Plus size={14} weight="bold" /> New campaign</Button>}
        </div>
      </div>

      {/* Not configured → this is an admin/keys problem, say so plainly. */}
      {!loading && !anyEnabled && (
        <SectionCard title="Ads are not configured">
          <div className="space-y-3 p-5 text-sm">
            <p className="text-muted-foreground">No ad platform keys are set yet, so there is nothing to read.</p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li>· <b className="text-foreground">Meta</b> — needs META_APP_ID + META_APP_SECRET. Listing spend needs <code className="rounded bg-muted px-1 text-xs">ads_read</code>; creating campaigns needs <code className="rounded bg-muted px-1 text-xs">ads_management</code>, which requires Business Verification + App Review.</li>
              <li>· <b className="text-foreground">Google Ads</b> — needs a client id/secret <i>and</i> a developer token from a Google Ads Manager (MCC) account.</li>
            </ul>
            {role === "admin" ? (
              <Link href="/settings"><Button size="sm" variant="outline">Add keys in Settings › Integrations</Button></Link>
            ) : (
              <p className="text-xs text-muted-foreground">An admin can add these in Settings › Integrations.</p>
            )}
          </div>
        </SectionCard>
      )}

      {!loading && anyEnabled && !connected && (
        <SectionCard title="Connect an ad account">
          <div className="space-y-3 p-5 text-sm">
            <p className="text-muted-foreground">Keys are set. Connect an ad account to pull its campaigns.</p>
            <div className="flex flex-wrap gap-2">
              {cfg?.meta?.enabled && <Button size="sm" variant="outline" disabled title="Meta OAuth — connect from Settings once App Review is granted">Connect Meta</Button>}
              {cfg?.google?.enabled && <Button size="sm" variant="outline" disabled title="Google OAuth — connect once your developer token is approved">Connect Google Ads</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Connect buttons activate once the provider approvals land — the OAuth exchange is wired and waiting.</p>
          </div>
        </SectionCard>
      )}

      {/* Only surface a fetch error once ads are actually configured — otherwise the
          "not configured" card above already explains it, and a raw error next to it
 reads as a second, unrelated fault. */}
      {err && anyEnabled && <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><Warning size={14} weight="fill" /> {err}</div>}

      {/* Per-channel failures — one channel down must not look like zero spend. */}
      {data?.errors?.map((e, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-lg border border-hold/20 bg-hold/10 px-3 py-2 text-xs text-hold">
          <Warning size={13} weight="fill" /> <b className="capitalize">{e.channel}</b> ({e.account}): {e.error}
        </div>
      ))}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
      ) : data && data.campaigns.length > 0 ? (
        <>
          <StatGrid>
            <StatCard label="Spend" value={usd(data.totals.spend)} sub={`last ${data.days}d`} />
            <StatCard label="Revenue" value={usd(data.totals.revenue)} sub="attributed" tone={data.totals.revenue ? "pos" : undefined} />
            <StatCard label="ROAS" value={data.totals.roas != null ? `${data.totals.roas}x` : "—"} sub="revenue / spend" tone={(data.totals.roas ?? 0) >= 1 ? "pos" : "neg"} />
            <StatCard label="Clicks" value={int(data.totals.clicks)} sub={`${int(data.totals.impressions)} impressions`} />
          </StatGrid>

          <SectionCard title="Campaigns">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left eg-label text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Campaign</th>
                    <th className="px-4 py-2.5">Channel</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Budget/day</th>
                    <th className="px-4 py-2.5 text-right">Spend</th>
                    <th className="px-4 py-2.5 text-right">Clicks</th>
                    <th className="px-4 py-2.5 text-right">Conv.</th>
                    <th className="px-4 py-2.5 text-right">ROAS</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <tr key={`${c.channel}-${c.id}`} className="border-t border-border">
                      <td className="px-4 py-2.5"><div className="max-w-[260px] truncate font-medium">{c.name}</div><div className="truncate text-xs text-muted-foreground">{c.account}</div></td>
                      <td className="px-4 py-2.5"><span className={"rounded-full px-2 py-0.5 text-xs font-semibold uppercase " + (CHANNEL[c.channel]?.cls ?? "bg-muted")}>{CHANNEL[c.channel]?.label ?? c.channel}</span></td>
                      <td className="px-4 py-2.5">
                        <span className={"rounded-full px-2 py-0.5 text-xs font-medium capitalize " + (c.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>{c.status || "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{c.dailyBudget != null ? usd(c.dailyBudget) : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{usd(c.spend)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{int(c.clicks)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{int(c.conversions)}</td>
                      <td className={"px-4 py-2.5 text-right font-semibold tabular-nums " + ((c.roas ?? 0) >= 1 ? "text-success" : c.roas != null ? "text-red-600" : "text-muted-foreground")}>{c.roas != null ? `${c.roas}x` : "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => toggle(c.channel, c.id, c.status)} title={c.status === "active" ? "Pause" : "Resume"}>
                          {busy === c.id ? <CircleNotch size={13} className="animate-spin" /> : c.status === "active" ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      ) : !loading && connected ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Megaphone size={22} weight="duotone" />
          <div className="text-sm">No campaigns in this window.</div>
        </div>
      ) : null}

      <NewCampaignDialog open={newOpen} onOpenChange={setNewOpen} cfg={cfg} onCreated={() => load(days)} />
    </div>
  )
}

function NewCampaignDialog({ open, onOpenChange, cfg, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; cfg: AdsConfig | null; onCreated: () => void }) {
 const [channel, setChannel] = useState<"meta" | "google">("meta")
 const [name, setName] = useState("")
 const [budget, setBudget] = useState("25")
 const [saving, setSaving] = useState(false)
 const [err, setErr] = useState<string | null>(null)
 const [done, setDone] = useState<string | null>(null)

 const submit = async () => {
 setErr(null); setSaving(true); setDone(null)
 try {
 const r = await createAdCampaign({ channel, name: name.trim(), dailyBudget: Number(budget) })
 if (r.error) throw new Error(r.error)
 setDone(r.id ? `Created (paused) · id ${r.id}` : "Created (paused)")
 setName("")
 onCreated()
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Could not create the campaign")
    } finally { setSaving(false) }
  }

 return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New campaign</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex rounded-lg border border-border p-0.5">
            {(["meta", "google"] as const).map((c) => (
              <button key={c} onClick={() => setChannel(c)} disabled={c === "meta" ? !cfg?.meta?.enabled : !cfg?.google?.enabled}
 className={"flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-40 " + (channel === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {CHANNEL[c].label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Campaign name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pet portrait — US" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Daily budget (USD)</span>
            <Input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="max-w-[120px]" />
          </label>

          <div className="rounded-lg border border-hold/20 bg-hold/10 px-3 py-2 text-xs text-hold">
            Creates the campaign <b>paused</b>. Add targeting and creative in {CHANNEL[channel].label} Ads Manager, then resume it here or there — nothing spends until you do.
          </div>

          {err && <div className="flex items-center gap-1.5 text-sm text-destructive"><Warning size={14} weight="fill" /> {err}</div>}
          {done && <div className="flex items-center gap-1.5 text-sm text-success"><ArrowSquareOut size={14} weight="bold" /> {done}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
            <Button size="sm" onClick={submit} disabled={saving || !name.trim() || !(Number(budget) > 0)}>
              {saving ? <CircleNotch size={14} className="animate-spin" /> : <Plus size={14} weight="bold" />} Create paused
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
