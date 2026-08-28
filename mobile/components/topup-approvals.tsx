import { useCallback, useEffect, useState } from "react"
import { View, Text, Pressable, ActivityIndicator, Alert, RefreshControl, ScrollView, TextInput } from "react-native"
import { getTopups, confirmTopup, rejectTopup, type Topup } from "@/lib/api"
import { F, C, R, SECTION, TAB_BAR, methodLabel } from "@/lib/theme"

/**
 * TOP-UPS, APPROVED FROM THE FLOOR.
 *
 * Staff have no wallet — orders charge the SELLER's — so this tab was a page saying so and
 * nothing else. The work that actually belongs here is the queue of sellers waiting to be
 * told their money landed, because that is the one thing where being at a desk is the only
 * thing standing between a seller and being able to trade.
 *
 * CONFIRM CREDITS A REAL WALLET. Everything here is built around that:
 *  - It asks before it acts, and the confirmation names the seller and the amount. A
 *    mis-tap here is money.
 *  - The amount is never editable. What the seller says they sent is a claim on the record;
 *    if it is wrong the answer is reject, not quietly credit a different number.
 *  - The FEE is optional and entered per top-up, because it is only knowable now, by the
 *    person looking at what actually arrived. It books as its own named debit rather than
 *    being netted off — see confirmTopup.
 *  - The server is the gate (staff-only) AND the guard: the update is conditional on the row
 *    still being `pending`, so two people approving the same one cannot double-credit. This
 *    screen surfaces that outcome rather than pretending it succeeded.
 */

const MONEY = (v: unknown) => {
  const n = Number(v ?? 0)
  return isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00"
}

/** Status as a mark, matching the queue: a dot in the reserved colour and plain type. */
const TONE: Record<string, string> = {
  pending: C.warn, received: C.success, rejected: C.alert, abandoned: C.muted,
}
const WORD: Record<string, string> = {
  pending: "Waiting", received: "Confirmed", rejected: "Rejected", abandoned: "Expired",
}

const when = (iso?: string | null) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

function Row({ t, onDone }: { t: Topup; onDone: () => void }) {
  const [busy, setBusy] = useState<null | "ok" | "no">(null)
  const [fee, setFee] = useState("")
  const [feeOpen, setFeeOpen] = useState(false)
  const pending = t.status === "pending"
  const who = t.seller_name || t.seller_email || t.seller_id || "Unknown seller"

  const act = useCallback((kind: "ok" | "no") => {
    const f = Number(fee)
    const feeLine = kind === "ok" && isFinite(f) && f > 0 ? `\nTransfer fee: ${MONEY(f)}` : ""
    Alert.alert(
      kind === "ok" ? "Confirm this top-up?" : "Reject this top-up?",
      kind === "ok"
        ? `${who}\n${MONEY(t.amount_usd)}${feeLine}\n\nTheir wallet is credited immediately.`
        : `${who}\n${MONEY(t.amount_usd)}\n\nNothing is credited. They are told it was rejected.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: kind === "ok" ? "Confirm" : "Reject",
          style: kind === "ok" ? "default" : "destructive",
          onPress: async () => {
            setBusy(kind)
            try {
              if (kind === "ok") await confirmTopup(String(t.id), isFinite(f) && f > 0 ? f : undefined)
              else await rejectTopup(String(t.id))
              onDone()
            } catch (e) {
              /* The server only updates a row that is STILL pending, so this is the honest
                 answer when someone else got there first — not a failure to report as one. */
              const msg = e instanceof Error ? e.message : "Try again."
              Alert.alert(/already processed|not found/i.test(msg) ? "Already handled" : "Couldn't do that", msg)
            } finally { setBusy(null); onDone() }
          },
        },
      ],
    )
  }, [t, fee, who, onDone])

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ fontSize: 20, fontFamily: F.semi, color: C.fg, letterSpacing: -0.3 }}>{MONEY(t.amount_usd)}</Text>
        <Text style={{ fontSize: 13, fontFamily: F.body, color: C.muted, flex: 1 }} numberOfLines={1}>
          {methodLabel(t.method)}
        </Text>
        {/* THE WORD, COLOURED — not a dot beside a word. Two marks for one fact, and the dot
            was the half that cannot be read: it needs the word to mean anything, while the
            word never needed it. Colour moves onto the lettering, which is where the status
            chips elsewhere in this app already put it. */}
        <Text style={{ fontSize: 12.5, fontFamily: F.medium, color: TONE[String(t.status)] ?? C.fg }}>
          {WORD[String(t.status)] ?? t.status}
        </Text>
      </View>

      <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: F.medium, color: C.fg, marginTop: 4 }}>{who}</Text>
      <Text style={{ fontSize: 12.5, fontFamily: F.body, color: C.muted, marginTop: 2 }}>
        {[when(t.created_at), t.ref ? `ref ${t.ref}` : null].filter(Boolean).join("  ·  ")}
      </Text>
      {!!t.note && (
        <Text numberOfLines={2} style={{ fontSize: 13, fontFamily: F.body, color: C.muted, marginTop: 4 }}>{t.note}</Text>
      )}

      {pending && (
        <>
          {/* The fee is opt-in per top-up: most need none, and a box that is always open
              invites a number into a field that should usually stay empty. */}
          {feeOpen ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
              <Text style={{ fontSize: 13, fontFamily: F.body, color: C.muted }}>Transfer fee $</Text>
              <TextInput
                value={fee}
                onChangeText={setFee}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={C.muted}
                style={{
                  flex: 1, height: 38, borderRadius: R.control, paddingHorizontal: 10,
                  borderWidth: 1, borderColor: C.edge,
                  backgroundColor: C.card, color: C.fg, fontFamily: F.medium, fontSize: 15,
                }}
              />
            </View>
          ) : (
            <Pressable onPress={() => setFeeOpen(true)} hitSlop={8} style={{ marginTop: 10 }}>
              <Text style={{ fontSize: 13, fontFamily: F.medium, color: C.primary }}>Add a transfer fee</Text>
            </Pressable>
          )}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Pressable
              onPress={() => act("no")}
              disabled={!!busy}
              style={({ pressed }) => ({
                flex: 1, height: 44, borderRadius: R.control, flexDirection: "row", gap: 8,
                alignItems: "center", justifyContent: "center",
                borderWidth: 1, borderColor: C.border,
                opacity: pressed || busy ? 0.6 : 1,
              })}
            >
              {busy === "no" && <ActivityIndicator color={C.alert} />}
              <Text style={{ fontSize: 15, fontFamily: F.semi, color: C.alert }}>Reject</Text>
            </Pressable>
            <Pressable
              onPress={() => act("ok")}
              disabled={!!busy}
              style={({ pressed }) => ({
                flex: 1, height: 44, borderRadius: R.control, flexDirection: "row", gap: 8,
                alignItems: "center", justifyContent: "center",
                backgroundColor: C.ink,
                opacity: pressed || busy ? 0.7 : 1,
              })}
            >
              {busy === "ok" && <ActivityIndicator color={C.onInk} />}
              <Text style={{ fontSize: 15, fontFamily: F.semi, color: C.onInk }}>Confirm</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  )
}

export function TopupApprovals({ bottomInset }: { bottomInset: number }) {
  const [rows, setRows] = useState<Topup[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try { setRows(await getTopups()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load top-ups.") }
  }, [])
  useEffect(() => { load() }, [load])
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [load])

  const waiting = (rows ?? []).filter((r) => r.status === "pending")
  const settled = (rows ?? []).filter((r) => r.status !== "pending")

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: bottomInset + TAB_BAR.clearance }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.primary} />}
    >
      {rows === null && !err ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={C.primary} /></View>
      ) : err ? (
        <Text style={{ fontSize: 14, fontFamily: F.body, color: C.alert, marginTop: 16 }}>{err}</Text>
      ) : (
        <>
          {/* NO EMPTY STATE, AND NO EMPTY HEADING.
              "Nothing waiting — every top-up has been answered" was a sentence, a tick and a
              whole section reporting an absence, at the top of a screen whose actual content
              (the answered ones) then started below the fold. A queue with nothing in it is
              self-evident when the list below it is full of settled rows; the heading only
              earns its space when there is something under it. */}
          {waiting.length > 0 && (
          <View style={{ ...SECTION, marginTop: 8 }}>
            <Text style={{ fontSize: 11.5, fontFamily: F.semi, color: C.muted, letterSpacing: 1.4 }}>
              WAITING ON YOU
            </Text>
            {waiting.map((t) => <Row key={String(t.id)} t={t} onDone={load} />)}
          </View>
          )}

          {settled.length > 0 && (
            <View style={{ ...SECTION }}>
              <Text style={{ fontSize: 11.5, fontFamily: F.semi, color: C.muted, letterSpacing: 1.4 }}>
                ALREADY ANSWERED
              </Text>
              {settled.map((t) => <Row key={String(t.id)} t={t} onDone={load} />)}
            </View>
          )}
        </>
      )}
    </ScrollView>
  )
}
