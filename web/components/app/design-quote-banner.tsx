"use client"

import { useState } from "react"
import { CircleNotch, Warning, CheckCircle, Sparkle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { answerDesignQuote, type OrderItem, type OrderRow } from "@/lib/api"

const money = (n: number | string | null | undefined) => `$${(Number(n) || 0).toFixed(2)}`

/**
 * A complex-design quote, for the seller to accept or decline.
 *
 * The whole reason this exists rather than a silent charge: the complex fee is several
 * times the standard one, and it applies only because the person paying it said yes. A
 * surprise charge at that multiple is how chargebacks and lost sellers happen.
 *
 * So it states BOTH numbers before either applies — what it costs to have the file made,
 * and what it will cost to download afterwards — because someone deciding whether it's
 * worth it needs the total, not the first instalment.
 *
 * Declining does not cancel the line here. It tells the factory, who cancel through the
 * path that already handles the refund; a second, hastier refund is how the wrong amount
 * gets paid back.
 */
export function DesignQuoteBanner({ order, item, onAnswered }: {
  order: OrderRow
  item: OrderItem
  onAnswered?: () => void
}) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (item.design_quote_status !== "pending" && !done) return null

  const answer = async (decision: "accept" | "decline") => {
    setBusy(decision); setErr(null)
    try {
      const r = await answerDesignQuote(order.id, {
        decision, line_id: item.line_id, sku: item.line_id ? undefined : item.sku,
      })
      if (r?.error) {
        // A balance shortfall is not a failure of the request — it's an answerable
        // condition, and saying "error" would suggest trying the same thing again.
        setErr(r.needsTopup ? `${r.error}` : r.error)
        return
      }
      setDone(decision === "accept"
        ? `Accepted — ${money(r.charged)} charged. We'll start on it.`
        : "Declined. The factory has been told; they'll be in touch about cancelling this line.")
      onAnswered?.()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  if (done) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0" /><span>{done}</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <Sparkle size={16} weight="fill" className="mt-0.5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900">
            This design is intricate — {item.name || item.sku}
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            We&apos;ve looked at your artwork and it needs more work than a standard digitise.
            It&apos;s <strong>{money(item.design_quote_make)}</strong> to make the machine file
            {Number(item.design_quote_download) > 0 && <>, and <strong>{money(item.design_quote_download)}</strong> if you later want to download it</>}.
          </p>
          <p className="mt-1 text-[11px] text-amber-700">
            Nothing has been charged. If you&apos;d rather not, decline and we&apos;ll sort out
            cancelling this line with you — the rest of your order is unaffected.
          </p>

          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => answer("accept")} disabled={!!busy}>
              {busy === "accept" ? <CircleNotch size={14} className="animate-spin" /> : `Accept ${money(item.design_quote_make)}`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => answer("decline")} disabled={!!busy}>
              {busy === "decline" ? <CircleNotch size={14} className="animate-spin" /> : "No thanks"}
            </Button>
          </div>

          {err && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-700">
              <Warning size={12} weight="fill" className="mt-0.5 shrink-0" /> {err}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
