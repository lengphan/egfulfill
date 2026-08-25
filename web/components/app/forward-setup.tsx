"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { EnvelopeSimple, Copy, Check, CircleNotch, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { getIngestAddress } from "@/lib/api"
import { TabBar } from "@/components/app/tab-bar"

/**
 * One-time forwarding setup, per seller.
 *
 * Etsy withholds buyer addresses from its API but includes them in the seller's sale
 * email, so a forwarding rule is how the address reaches us. That rule can only be
 * created by the mailbox owner: Gmail's settings API needs a Google RESTRICTED scope
 * (annual CASA security assessment), and Yahoo retired third-party Mail API access
 * entirely. So the step is manual for every provider — the job here is to make it take
 * thirty seconds rather than to pretend it can be automated.
 */

type Provider = {
 id: string; label: string
  /** Deep link to the exact settings page. We can't create the rule for them — that needs
   * mailbox access — but we can land them on the right screen with the address already
   * copied, which is the difference between "go find it" and "paste this here". */
 deepLink?: string
 steps: string[]
}

// Written as click-paths rather than prose: someone doing this once, quickly, needs the
// menu names, not an explanation.
const PROVIDERS: Provider[] = [
  {
 id: "gmail",
 label: "Gmail",
 deepLink: "https://mail.google.com/mail/u/0/#settings/fwdandpop",
 steps: [
      "Forwarding and POP/IMAP → Add a forwarding address → paste → Next → Proceed",
      "Gmail sends a confirmation link to that address — we confirm it automatically, so just wait a few seconds and reload",
      "Leave the radio on “Disable forwarding” — do NOT turn on forward-a-copy, or Gmail sends us every email you receive",
      "Now go to Filters and Blocked Addresses → Create a new filter",
      "In From type: etsy.com → Create filter",
      "Tick “Forward it to” → pick the address → Create filter",
    ],
  },
  {
 id: "outlook",
 label: "Outlook / Hotmail",
 deepLink: "https://outlook.live.com/mail/0/options/mail/rules",
 steps: [
      "Settings (gear) → Mail → Rules → Add new rule",
      "Name it “Etsy sales”",
      "Condition: From → contains → etsy.com",
      "Action: Forward to → paste the address above",
      "Save",
    ],
  },
  {
 id: "yahoo",
 label: "Yahoo Mail",
 deepLink: "https://mail.yahoo.com/d/settings/1",
 steps: [
      "Settings → More Settings → Filters → Add new filters",
      "Name it “Etsy sales”",
      "Set From contains → etsy.com",
      "Yahoo has no per-filter forwarding, so also set: Settings → Mailboxes → your address → Forwarding → paste the address above → Verify",
      "Yahoo sends a verification code to that address — we auto-confirm it",
    ],
  },
  {
 id: "other",
 label: "Other",
 steps: [
      "Find Forwarding, Filters or Rules in your mail settings",
      "Create a rule: when the sender contains etsy.com, forward to the address above",
      "If asked to verify the forwarding address, we auto-confirm it",
    ],
  },
]

export function ForwardSetup() {
  const tl = useLabelT()
 const [address, setAddress] = useState<string | null>(null)
 const [configured, setConfigured] = useState(true)
 const [loading, setLoading] = useState(true)
 const [copied, setCopied] = useState(false)
 const [provider, setProvider] = useState<string>("gmail")

 useEffect(() => {
 const id = setTimeout(() => {
 getIngestAddress()
        .then((r) => { setAddress(r.address); setConfigured(r.configured); setLoading(false) })
        .catch(() => setLoading(false))
    }, 0)
 return () => clearTimeout(id)
  }, [])

 const copy = () => {
 if (!address) return
 navigator.clipboard?.writeText(address).then(() => {
 setCopied(true)
 setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

 const active = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]

  /** Copy the address, THEN open their mail settings — so the address is on the clipboard
   * by the time the page loads and the whole thing is paste-and-save. */
 const openProvider = () => {
 if (address) navigator.clipboard?.writeText(address).catch(() => {})
 setCopied(true)
 setTimeout(() => setCopied(false), 2500)
 if (active.deepLink) window.open(active.deepLink, "_blank", "noopener,noreferrer")
  }

 return (
    <SectionCard
 title={tl("forwardSetup", "Get buyer addresses automatically")}
    >
      <div className="space-y-4 p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleNotch size={15} className="animate-spin" /> {tl("forwardSetup", "Loading…")}
          </div>
        ) : !configured ? (
          <div className="flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 p-3 text-sm text-hold">
            <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
            {tl("forwardSetup", "Email forwarding isn’t set up on this server yet. Ask an admin to set MAIL_INGEST_DOMAIN.")}
          </div>
        ) : (
          <>
            <div>
              <div className="mb-1.5 text-sm font-medium">{tl("forwardSetup", "1. Your forwarding address")}</div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted/50 px-3 py-2 tabular-nums text-sm">
                  {address}
                </code>
                <button
 onClick={copy}
 className="eg-tap inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
                >
                  {copied ? <><Check size={14} weight="bold" className="text-success" /> {tl("forwardSetup", "Copied")}</> : <><Copy size={14} weight="bold" /> {tl("forwardSetup", "Copy")}</>}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {tl("forwardSetup", "Unique to your account — it’s how we know which orders the addresses belong to.")}
              </p>
            </div>

            <div>
              <div className="mb-1.5 text-sm font-medium">{tl("forwardSetup", "2. Forward Etsy’s sale emails to it")}</div>
              <TabBar
                size="sm"
                ariaLabel="Email provider"
                className="mb-2"
                items={PROVIDERS.map((p) => ({ id: p.id, label: p.label }))}
                value={provider}
                onChange={setProvider}
              />
              {active.deepLink && (
                <button
 onClick={openProvider}
 className="eg-tap mb-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Copy address &amp; open {tl("forwardSetup", active.label)} settings
                </button>
              )}
              <ol className="space-y-1.5 text-sm text-muted-foreground">
                {active.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 font-medium text-foreground">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <EnvelopeSimple size={15} className="mt-0.5 shrink-0" />
              <span>
                {tl("forwardSetup", "One rule, once — then every sale email fills its order’s address automatically, with nothing to export or upload. Use a")} <strong className="font-medium text-foreground">filter</strong>{tl("forwardSetup", ", not blanket forwarding: a filter sends us only Etsy’s emails, and we never see anything else in your inbox.")}
              </span>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}
