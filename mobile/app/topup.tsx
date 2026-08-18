import { useCallback, useEffect, useRef, useState } from "react"
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Share } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import QRCode from "react-native-qrcode-svg"
import {
  getTopupConfig, createVietqrPayment, vietqrStatus,
  type TopupConfig, type VietqrPayment,
} from "@/lib/api"
import { C } from "@/lib/theme"

/**
 * ADD FUNDS — VietQR, mirroring the web dialog rather than reinventing it.
 *
 * THE QR COMES FROM THE SERVER AND IS ONLY DRAWN HERE. VietQR issues a virtual account and
 * reconciles against the code it issued; an EMVCo payload built on the device would scan
 * and pay perfectly well, and the money would never be matched to an account. There is
 * exactly one QR, and it is `payment.qrCode`.
 *
 * The rate, the volume tiers and the minimum are all read from the server too — they are
 * admin-set, and a phone that carried its own copy would quote a price the wallet then
 * refuses.
 */
const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`
const vnd0 = (n: number) => `${Math.round(n).toLocaleString()} ₫`

export default function TopUp() {
  const insets = useSafeAreaInsets()
  const [cfg, setCfg] = useState<TopupConfig | null>(null)
  const [amount, setAmount] = useState("")
  const [phase, setPhase] = useState<"pick" | "qr" | "paid">("pick")
  const [payment, setPayment] = useState<VietqrPayment | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    getTopupConfig().then(setCfg).catch(() => setErr("Couldn't load top-up settings."))
    // Polling must stop when this screen goes away, or it keeps running against a closed
    // payment for as long as the app is open.
    return () => { if (poll.current) clearInterval(poll.current) }
  }, [])

  const usdAmt = Number(amount) || 0
  const minUsd = cfg?.minUsd ?? 0
  // The better rate applies from the tier it belongs to — same walk the web does, so the
  // number quoted here is the number the server will charge.
  const rate = (() => {
    let r = cfg?.rate ?? 0
    for (const t of cfg?.tiers ?? []) if (usdAmt >= t.usd && t.rate > 0) r = t.rate
    return r
  })()
  const vndAmt = rate > 0 ? Math.round(usdAmt * rate) : 0
  const presets = [...(cfg?.smallPresets ?? []), ...(cfg?.bulkPresets ?? [])]

  const start = useCallback(async () => {
    if (usdAmt <= 0) { setErr("Enter an amount."); return }
    if (usdAmt < minUsd) { setErr(`Minimum top-up is ${usd0(minUsd)}.`); return }
    if (!rate) { setErr("The exchange rate isn't available right now — try again in a moment."); return }
    setErr(null); setBusy(true)
    try {
      const p = await createVietqrPayment(vndAmt, usdAmt)
      if (p.error) throw new Error(String(p.error))
      if (!p.qrCode && !p.qrLink) {
        throw new Error("VietQR returned no QR — nothing was charged. Ask an admin to check the VietQR keys.")
      }
      /*
       * REFUSE A HALF-FORMED PAYMENT. A QR missing the receiver, bank or account still
       * scans; it just pays the wrong place, or nowhere recoverable. Better to stop than to
       * show something payable that we cannot reconcile.
       */
      const gaps = [
        !p.name && "receiver", !p.bankCode && "bank", !(p.vaAccount || p.account) && "account",
      ].filter(Boolean) as string[]
      if (gaps.length) throw new Error(`VietQR didn't return the ${gaps.join(", ")} — don't pay this. Ask an admin to check the setup.`)

      setPayment(p); setPhase("qr")
      const ref = p.note || ""
      if (ref) {
        poll.current = setInterval(async () => {
          try {
            const s = await vietqrStatus(ref)
            if (s.paid) {
              if (poll.current) clearInterval(poll.current)
              setPhase("paid")
            }
          } catch { /* a dropped poll is not a failed payment — keep asking */ }
        }, 4000)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start the payment.")
    } finally {
      setBusy(false)
    }
  }, [usdAmt, minUsd, rate, vndAmt])

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Pressable
        onPress={() => router.back()}
        style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 10 }}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={22} color={C.primary} />
        <Text style={{ color: C.primary, fontSize: 16 }}>Wallet</Text>
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}>
        <Text style={{ fontSize: 32, fontWeight: "900", color: C.fg }}>Add funds</Text>

        {phase === "paid" ? (
          <View style={{ alignItems: "center", marginTop: 48 }}>
            <Ionicons name="checkmark-circle" size={64} color="#0a7c42" />
            <Text style={{ fontSize: 22, fontWeight: "800", color: C.fg, marginTop: 14 }}>Payment received</Text>
            <Text style={{ fontSize: 15, color: C.muted, marginTop: 6, textAlign: "center" }}>
              {payment?.amountUsd ? `${usd0(payment.amountUsd)} is on its way to your balance.` : "Your balance is being updated."}
            </Text>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => ({
                marginTop: 28, height: 52, borderRadius: 14, paddingHorizontal: 32,
                alignItems: "center", justifyContent: "center", backgroundColor: C.primary,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: C.onPrimary, fontWeight: "800", fontSize: 16 }}>Back to wallet</Text>
            </Pressable>
          </View>
        ) : phase === "qr" && payment ? (
          <View style={{ alignItems: "center", marginTop: 20 }}>
            <View style={{ padding: 16, borderRadius: 20, backgroundColor: "#ffffff", borderWidth: 1, borderColor: C.border }}>
              {payment.qrCode
                ? <QRCode value={payment.qrCode} size={220} />
                : <Text style={{ color: C.muted }}>No scannable code</Text>}
            </View>

            <Text style={{ fontSize: 26, fontWeight: "900", color: C.fg, marginTop: 18 }}>
              {vnd0(payment.amount ?? vndAmt)}
            </Text>
            <Text style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>
              {usd0(payment.amountUsd ?? usdAmt)}
            </Text>

            <View style={{ alignSelf: "stretch", marginTop: 24, borderRadius: 16, backgroundColor: C.accent, padding: 16 }}>
              <Field label="Receiver" value={payment.name} />
              <Field label="Bank" value={payment.bankCode} />
              <Field label="Account" value={payment.vaAccount || payment.account} />
              {/* The FULL description, not our short ref — VietQR wraps the ref in a
                  virtual-account prefix, and the payer's banking app shows the wrapped one. */}
              <Field label="Description" value={payment.content || payment.note} last />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20 }}>
              <ActivityIndicator color={C.primary} />
              <Text style={{ fontSize: 14, color: C.muted }}>Waiting for your transfer…</Text>
            </View>

            <Pressable
              onPress={() => Share.share({ message: payment.qrCode || payment.content || "" })}
              style={({ pressed }) => ({
                marginTop: 20, height: 48, borderRadius: 14, paddingHorizontal: 24,
                alignItems: "center", justifyContent: "center",
                borderWidth: 1, borderColor: C.border, opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: C.fg }}>Share payment details</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 12, fontWeight: "800", color: C.muted, letterSpacing: 1, marginTop: 28 }}>
              AMOUNT (USD)
            </Text>

            <TextInput
              value={amount}
              onChangeText={(t) => { setAmount(t.replace(/[^0-9.]/g, "")); setErr(null) }}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={C.muted}
              style={{
                marginTop: 10, height: 64, borderRadius: 16, paddingHorizontal: 18,
                backgroundColor: C.accent, color: C.fg, fontSize: 30, fontWeight: "800",
              }}
            />

            {presets.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                {presets.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => { setAmount(String(p)); setErr(null) }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 16, height: 40, borderRadius: 20, justifyContent: "center",
                      backgroundColor: String(p) === amount ? C.primary : C.accent,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{
                      fontSize: 15, fontWeight: "700",
                      color: String(p) === amount ? C.onPrimary : C.fg,
                    }}>{usd0(p)}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {cfg && (
              <Text style={{ fontSize: 14, color: C.muted, marginTop: 18 }}>
                {usdAmt > 0 && rate > 0
                  ? `You'll transfer ${vnd0(vndAmt)} · ${Math.round(rate).toLocaleString()} ₫ per $1`
                  : `Minimum ${usd0(minUsd)}`}
              </Text>
            )}

            {err && (
              <Text style={{ fontSize: 14, color: C.alert, marginTop: 14 }}>{err}</Text>
            )}

            <Pressable
              onPress={start}
              disabled={busy || !cfg}
              style={({ pressed }) => ({
                marginTop: 28, height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center",
                backgroundColor: C.primary, opacity: pressed || busy || !cfg ? 0.7 : 1,
              })}
            >
              {busy
                ? <ActivityIndicator color={C.onPrimary} />
                : <Text style={{ color: C.onPrimary, fontWeight: "800", fontSize: 16 }}>Show payment QR</Text>}
            </Pressable>

            {!cfg && !err && (
              <View style={{ alignItems: "center", marginTop: 20 }}>
                <ActivityIndicator color={C.primary} />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Field({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={{
      flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 10,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: C.border,
    }}>
      <Text style={{ fontSize: 14, color: C.muted }}>{label}</Text>
      <Text selectable style={{ fontSize: 14, fontWeight: "700", color: C.fg, flexShrink: 1, textAlign: "right" }}>
        {value || "—"}
      </Text>
    </View>
  )
}
