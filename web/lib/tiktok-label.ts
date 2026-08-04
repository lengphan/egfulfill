// The label TIKTOK generated for a platform-shipped order.
//
// Distinct from a label WE bought: that one is ours, stored, reprintable and batchable. This
// one lives in TikTok's system and is fetched on demand — so it belongs beside the tracking
// number, which is the other thing about a parcel that came from TikTok rather than from us.
//
// Shared because the staff row, the order detail and the ⋯ menu all offer it, and "which
// orders even have one" must be the same answer in all three.

import { getTiktokLabel, type OrderRow } from "@/lib/api"

/**
 * Can this order have a TikTok-made label at all?
 *
 * Three states, and the middle one is the reason this isn't a one-liner:
 *   · not a TikTok order          → no
 *   · shipping type SELLER        → no. We bought the label; TikTok has nothing.
 *   · shipping type TIKTOK        → yes
 *   · shipping type UNKNOWN (null) → YES, offer it. Orders imported before the type was
 *     recorded have no value stored, and hiding the action on those would silently strand
 *     exactly the oldest orders. The server answers with the real reason ("no package on
 *     TikTok yet") if it turns out there's nothing there, which beats a missing button.
 */
export function canFetchTiktokLabel(o: OrderRow): boolean {
  if (!/^tiktok-/i.test(String(o.id))) return false
  const t = (o.meta as { tiktok_shipping_type?: string | null } | null | undefined)?.tiktok_shipping_type
  if (t == null || t === "") return true
  return String(t).toUpperCase() === "TIKTOK"
}

/**
 * WHO is producing the label for this TikTok order — the single fact that decides whether
 * the floor owes this order a label at all.
 *
 * It changes what everyone does: on TikTok shipping the label already exists and must be
 * fetched, not bought; on seller shipping there is no label anywhere until we buy one, and
 * treating it as "waiting for TikTok" would strand the parcel indefinitely.
 *
 * Returns null for non-TikTok orders, and an explicit "unknown" for TikTok orders imported
 * before the type was recorded — because guessing which side owes a label is exactly the
 * kind of confident-and-wrong the boards must not do.
 */
export type TiktokShipping = { key: "tiktok" | "seller" | "unknown"; label: string; hint: string }

export function tiktokShippingOf(o: OrderRow): TiktokShipping | null {
  if (!/^tiktok-/i.test(String(o.id))) return null
  const raw = (o.meta as { tiktok_shipping_type?: string | null } | null | undefined)?.tiktok_shipping_type
  const t = raw == null ? "" : String(raw).toUpperCase()
  if (t === "TIKTOK") return { key: "tiktok", label: "TikTok shipping", hint: "TikTok made the label — fetch it rather than buying one." }
  if (t === "SELLER") return { key: "seller", label: "Seller shipping", hint: "No label from TikTok — we buy and push the tracking back." }
  return { key: "unknown", label: "Shipping type unknown", hint: "Imported before this was recorded. Re-sync the shop to fill it in." }
}

/** Fetch it and open it. Resolves to an error STRING to show, or null on success — callers
 *  render the message in whatever banner they already have rather than each inventing one. */
export async function openTiktokLabelFor(o: OrderRow): Promise<string | null> {
  try {
    const d = await getTiktokLabel(String(o.id))
    if (d.error) return d.error
    const url = d.documents?.[0]?.url
    if (!url) return "TikTok returned no document URL for this order."
    window.open(url, "_blank", "noopener")
    return null
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't fetch the TikTok label."
  }
}
