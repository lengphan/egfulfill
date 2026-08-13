import { numOf, platformOf, customerOf, unitsOf, addrLine } from "@/lib/order-format"
import type { OrderRow } from "@/lib/api"

/**
 * The packing slip, as its own module.
 *
 * It was a closure inside the dispatch board, which is where a packer works through a batch
 * — but it is also the thing wanted one second after buying a single label, and a second
 * implementation would drift from this one the first time a field changed. Same document
 * from both places, or it isn't the same document.
 *
 * Returns null on success, or a message to show — a popup blocker is the one failure this
 * has, and it is worth naming rather than appearing to do nothing.
 */
export function printPackingSlips(chosen: OrderRow[]): string | null {
if (!chosen.length) return null
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
  const slips = chosen.map((o) => {
    const its = o.items ?? []
    const rows = its.length
      ? its.map((it) => `<tr><td>${esc(it.name || it.sku || "Item")}${it.sku && it.name ? `<div class="sku mono">${esc(it.sku)}</div>` : ""}</td><td class="qty">&times;${esc(it.qty ?? 1)}</td></tr>`).join("")
      : `<tr><td colspan="2" class="empty">No items recorded on this order</td></tr>`
    return `<section class="slip">
      <div class="hd"><div class="num mono">${esc(numOf(o))}</div><div class="plat">${esc(platformOf(o))}${o.store ? " &middot; " + esc(o.store) : ""}</div></div>
      <div class="cust">${esc(customerOf(o))}</div>
      ${addrLine(o) ? `<div class="addr">${esc(addrLine(o))}</div>` : ""}
      <table><tbody>${rows}</tbody></table>
      <div class="ft">${esc(unitsOf(o))} unit${unitsOf(o) === 1 ? "" : "s"}${o.tracking ? ` &middot; <span class="mono">${esc(o.tracking)}</span>` : ""}</div>
    </section>`
  }).join("")
  const w = window.open("", "_blank")
if (!w) return "Your popup blocker stopped the packing slips — allow popups for this site."
  w.document.write(`<!doctype html><html><head><title>Packing slips</title><style>
    *{box-sizing:border-box}
    body{font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:0}
    .slip{width:4in;min-height:6in;padding:.25in;page-break-after:always;display:flex;flex-direction:column}
    .hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;border-bottom:2px solid #111;padding-bottom:6px}
    .num{font-size:17px;font-weight:700}
    .plat{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.05em;text-align:right}
    .cust{font-size:14px;font-weight:600;margin-top:8px}
    .addr{font-size:11px;color:#555}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    td{padding:5px 2px;border-bottom:1px solid #eee;vertical-align:top;font-size:12px}
    .sku{font-size:10px;color:#666;margin-top:1px}
    .qty{text-align:right;font-weight:700;width:2.6rem;white-space:nowrap}
    .empty{color:#999;text-align:center}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .ft{margin-top:auto;padding-top:8px;border-top:1px solid #ddd;font-size:9px;color:#888}
    @page{size:4in 6in;margin:0}
  </style></head><body>${slips}</body></html>`)
  w.document.close()
  w.focus()
  w.print()
  return null
}
