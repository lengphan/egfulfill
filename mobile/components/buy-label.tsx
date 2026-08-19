import { useState } from "react"
import { View, Text, Pressable, ActivityIndicator, Alert, TextInput } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { getShippingRates, buyShippingLabel, type Order, type ShipAddress, type ShippingRate } from "@/lib/api"
import { addressLines } from "@/lib/orders"
import { C, R } from "@/lib/theme"

/**
 * BUY THE LABEL HERE, because the parcel is here.
 *
 * The phone could photograph a parcel and ship an order, and the server refuses a ship it
 * has no label for — so the one step that had to happen on a desk was the one step that
 * happens standing at the bench. Someone packed the box, then went to find a computer.
 *
 * RATE-SHOPPED, NEVER USPS-DIRECT. Both calls go through /api/shipping/rates and
 * /api/shipping/label, which fan out across whichever aggregator is configured. The
 * USPS-direct path is a different route and taking it by accident is where "we're having
 * trouble validating your credit card" comes from — an EPS billing error against an
 * account the aggregator never touches.
 *
 * TWO PRESSES, AND THE SECOND ONE NAMES THE PRICE. This spends money and cannot be undone
 * from this screen (a refund is a separate, time-limited carrier action), so the rate list
 * is shown first and the confirm repeats the exact amount, carrier and service. Nothing is
 * bought by a single tap.
 *
 * The SENDER address is never sent from here — the server resolves it from the order
 * (shipFromForOrder). A phone carrying its own copy of where we ship from is a phone that
 * prints the wrong return address after an office move.
 */
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

export function BuyLabel({ order, onDone }: { order: Order; onDone: () => void }) {
  const [rates, setRates] = useState<ShippingRate[] | null>(null)
  const [busy, setBusy] = useState<null | "rates" | string>(null)
  const [err, setErr] = useState<string | null>(null)
  /**
   * THE ADDRESS IS CHECKED BEFORE IT IS PAID FOR, and it is editable here.
   *
   * A label is printed the moment it is bought and a wrong one is money gone plus a parcel
   * that comes back — and marketplace addresses arrive with real defects: a missing unit
   * number, a state the seller typed into the city field, a country the API abbreviated.
   * The one moment anyone will actually read the address is the moment before spending on
   * it, so that is where it is shown.
   *
   * Seeded from the order and held locally: what is typed here goes to the rate call and
   * the buy, and is NOT written back to the order. Editing a stored buyer address is a
   * different decision with an audit trail attached; this only decides where this parcel
   * goes.
   */
  const [edit, setEdit] = useState(false)
  const [form, setFormState] = useState<ShipAddress>(() => ({ ...(order.address ?? {}) }))
  /* Any edit drops quoted rates: a price fetched for the previous ZIP is not this
     parcel's price, and leaving it on screen invites buying it. */
  const setForm = (fn: (f: ShipAddress) => ShipAddress) => { setFormState(fn); setRates(null) }

  const to: ShipAddress | null = order.address ? form : null
  /* A seller's copy of the order carries a masked address — city and state only — which is
     not enough to buy anything with. Saying so is better than a button that always errors:
     it is a permission, not a failure. */
  const masked = !!order.address?.masked
  const enough = !!to && !masked && !!(to.street1 || to.street) && !!to.zip

  const load = async () => {
    if (!to) return
    setBusy("rates"); setErr(null)
    try {
      const r = await getShippingRates(String(order.id), to)
      if (r.error) throw new Error(r.error)
      const list = r.rates ?? []
      if (!list.length) throw new Error(r.errors?.join(" · ") || "No rates came back for this parcel.")
      setRates(list)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't get rates.")
    } finally { setBusy(null) }
  }

  const buy = (rate: ShippingRate) => {
    /* `to` is non-null by the time a rate exists — rates cannot be fetched without one —
       but the compiler cannot see that, and asserting it would be the wrong kind of
       confident about an address a label gets printed with. */
    if (!to) return
    Alert.alert(
      `Buy this label for ${money(rate.amount)}?`,
      `${rate.carrier} ${rate.service}${rate.days ? ` · about ${rate.days} day${rate.days === 1 ? "" : "s"}` : ""}\n\nThis charges the account now.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Buy ${money(rate.amount)}`,
          style: "default",
          onPress: async () => {
            setBusy(rate.token); setErr(null)
            try {
              const r = await buyShippingLabel(String(order.id), rate, to)
              if (r.error) throw new Error(r.error)
              onDone()
            } catch (e) {
              setErr(e instanceof Error ? e.message : "The label was not bought.")
            } finally { setBusy(null) }
          },
        },
      ],
    )
  }

  if (!enough) {
    return (
      <Text style={{ fontSize: 14, color: C.muted }}>
        {masked
          ? "Buying a label needs the full delivery address, which only staff can see."
          : "No delivery address on this order yet, so a label can't be bought."}
      </Text>
    )
  }

  const field = (label: string, k: "name" | "street1" | "street2" | "city" | "state" | "zip" | "country") => (
    <View key={k} style={{ flex: 1, minWidth: 120, gap: 4 }}>
      <Text style={{ fontSize: 11, fontWeight: "800", color: C.muted, letterSpacing: 0.6 }}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        value={String(form[k] ?? "")}
        onChangeText={(t) => setForm((f) => ({ ...f, [k]: t }))}
        autoCapitalize={k === "state" || k === "country" ? "characters" : "words"}
        style={{
          height: 44, borderRadius: R.md, paddingHorizontal: 12,
          borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
          color: C.fg, fontSize: 15,
        }}
      />
    </View>
  )

  return (
    <View style={{ gap: 12 }}>
      {/* DELIVER TO, above the price. Reviewed, then paid for — never the other way. */}
      <View style={{
        borderRadius: R.md, borderWidth: 1, borderColor: C.border,
        backgroundColor: C.card, padding: 14, gap: 10,
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 11, fontWeight: "900", color: C.muted, letterSpacing: 1 }}>
            DELIVER TO
          </Text>
          <Pressable onPress={() => setEdit((v) => !v)} hitSlop={8}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: C.primary }}>
              {edit ? "Done" : "Edit"}
            </Text>
          </Pressable>
        </View>

        {edit ? (
          <View style={{ gap: 10 }}>
            {field("Name", "name")}
            {field("Street", "street1")}
            {field("Apt / unit", "street2")}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {field("City", "city")}
              {field("State", "state")}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {field("ZIP", "zip")}
              {field("Country", "country")}
            </View>
            {/* Rates were quoted for the OLD address, so they cannot stand. Dropping them
                is safer than leaving a price on screen that a new ZIP may have changed. */}
            <Text style={{ fontSize: 12, color: C.muted }}>
              Changing this re-quotes the rates.
            </Text>
          </View>
        ) : (
          <View>
            {addressLines(form).map((l, i) => (
              <Text key={i} style={{ fontSize: 15, color: i === 0 ? C.fg : C.muted, fontWeight: i === 0 ? "700" : "400" }}>
                {l}
              </Text>
            ))}
          </View>
        )}
      </View>

      {rates === null ? (
        <Pressable
          onPress={load}
          disabled={busy === "rates"}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            height: 52, borderRadius: R.md, backgroundColor: C.primary,
            opacity: pressed || busy === "rates" ? 0.8 : 1,
          })}
        >
          {busy === "rates" && <ActivityIndicator color={C.onPrimary} />}
          <Text style={{ fontSize: 16, fontWeight: "800", color: C.onPrimary }}>
            {busy === "rates" ? "Getting rates…" : "Buy shipping label"}
          </Text>
        </Pressable>
      ) : (
        <>
          {/* Cheapest first — the server sorts, and re-sorting here would be a second
              opinion about price that could disagree with what was quoted. */}
          {rates.map((r) => (
            <Pressable
              key={r.token}
              onPress={() => buy(r)}
              disabled={!!busy}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 12,
                paddingVertical: 12, paddingHorizontal: 14,
                borderRadius: R.md, borderWidth: 1, borderColor: C.border,
                backgroundColor: pressed ? C.accent : C.card,
                opacity: busy && busy !== r.token ? 0.5 : 1,
              })}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: C.fg }} numberOfLines={1}>
                  {r.carrier} {r.service}
                </Text>
                {r.days != null && (
                  <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                    about {r.days} day{r.days === 1 ? "" : "s"}
                  </Text>
                )}
              </View>
              {busy === r.token
                ? <ActivityIndicator color={C.primary} />
                : <Text style={{ fontSize: 17, fontWeight: "900", color: C.fg }}>{money(r.amount)}</Text>}
            </Pressable>
          ))}
          <Pressable onPress={() => { setRates(null); setErr(null) }} disabled={!!busy}>
            <Text style={{ fontSize: 13, color: C.muted, textAlign: "center", paddingVertical: 6 }}>
              Start over
            </Text>
          </Pressable>
        </>
      )}
      {err && <Text style={{ fontSize: 14, color: C.alert }}>{err}</Text>}
    </View>
  )
}
