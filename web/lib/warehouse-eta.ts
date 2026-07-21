/**
 * When a warehouse's stock would actually arrive.
 *
 * S&S give days-in-transit and a daily cut-off per warehouse. Both matter: an order placed
 * at 4:30 against a 4:00 cut-off ships TOMORROW, so transit time alone quietly understates
 * delivery by a day — which is the day someone promised a customer.
 *
 * Transit is counted in BUSINESS days. Carriers don't move ground freight at the weekend,
 * and a Friday order that "takes 2 days" arriving Tuesday is the difference between a
 * promise kept and a complaint.
 */
export type WarehouseEta = { shipsToday: boolean; deliveryAt: Date | null }

/** Parse "4:00 CT" / "3:30p.m. PT" into minutes past midnight in that zone, roughly. */
function cutOffMinutes(cutOff?: string | null): number | null {
  if (!cutOff) return null
  const m = String(cutOff).match(/(\d{1,2})(?::(\d{2}))?\s*([ap])?/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  const ap = (m[3] || "").toLowerCase()
  // S&S quote cut-offs in the afternoon; a bare "4:00" means 16:00, not 04:00.
  if (ap === "p" || (!ap && h <= 7)) h = h === 12 ? 12 : h + 12
  return h * 60 + min
}

const addBusinessDays = (from: Date, n: number) => {
  const d = new Date(from)
  let left = n
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) left--
  }
  return d
}

export function warehouseEta(days: number | null, cutOff: string | null, now: Date): WarehouseEta {
  if (days == null) return { shipsToday: false, deliveryAt: null }
  const mins = cutOffMinutes(cutOff)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const isWeekend = now.getDay() === 0 || now.getDay() === 6
  // Made the cut-off AND it's a working day → it leaves today.
  const shipsToday = !isWeekend && mins != null && nowMins < mins
  const shipDay = shipsToday ? new Date(now) : addBusinessDays(now, 1)
  return { shipsToday, deliveryAt: addBusinessDays(shipDay, days) }
}

export const fmtEta = (d: Date | null) =>
  d ? d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" }) : "—"
