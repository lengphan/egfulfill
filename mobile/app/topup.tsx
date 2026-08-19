import { useCallback, useEffect, useRef, useState } from "react"
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, useWindowDimensions } from "react-native"
import * as FileSystem from "expo-file-system/legacy"
import * as Sharing from "expo-sharing"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import QRCode from "react-native-qrcode-svg"
import {
  getTopupConfig, createVietqrPayment, vietqrStatus, getWallet, abandonVietqr, getMyTopups,
  type TopupConfig, type VietqrPayment, type LedgerRow, type TopupRequest,
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
  /**
   * THE QR IS AS BIG AS THE PHONE ALLOWS.
   *
   * It was pinned at 220pt on every device. This is the one thing on the screen with a job
   * — a banking app has to read it, often off a second phone held at arm's length — and it
   * was rendering smaller than the button beneath it while a third of the width sat empty.
   *
   * 20 is the screen padding either side, 16 is the white card's own padding, and 380 is a
   * ceiling so it does not become the whole page on a tablet — 320 was leaving 38pt unused
   * on a Pro Max, which is real resolution on the one thing that has to be readable.
   */
  const { width: screenW } = useWindowDimensions()
  const qrSize = Math.min(380, Math.max(200, screenW - (20 + 16) * 2))
  const [cfg, setCfg] = useState<TopupConfig | null>(null)
  const [amount, setAmount] = useState("")
  const [phase, setPhase] = useState<"pick" | "qr" | "paid">("pick")
  const [payment, setPayment] = useState<VietqrPayment | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)
  const qrRef = useRef<{ toDataURL?: (cb: (b64: string) => void) => void } | null>(null)
  const [saving, setSaving] = useState(false)
  /* Past top-ups come from the LEDGER, not a top-up table: every method (VietQR, card,
     PayPal, manual transfer) books the same `topup` row, so the ledger is the one place
     that has all of them and cannot disagree with the balance. */
  const [history, setHistory] = useState<LedgerRow[] | null>(null)
  /** Requests that exist and have not been paid. See getMyTopups — these have no ledger
   *  row yet, which is why the old history could not show them. */
  const [open_, setOpen] = useState<TopupRequest[] | null>(null)
  /* The ref of a payment that is still open. Held in a ref, not state, because the cleanup
     below runs on unmount and would otherwise close over the value from first render. */
  const openRef = useRef<string | null>(null)

  useEffect(() => {
    getTopupConfig().then(setCfg).catch(() => setErr("Couldn't load top-up settings."))
    getWallet()
      .then((w) => setHistory((w.ledger ?? []).filter((r) => String(r.type) === "topup").slice(0, 5)))
      .catch(() => setHistory([]))
    getMyTopups()
      .then((rows) => setOpen((rows ?? []).filter((r) => r.status === "pending" || r.status === "abandoned").slice(0, 5)))
      .catch(() => setOpen([]))
    return () => {
      // Polling must stop when this screen goes away, or it keeps running against a closed
      // payment for as long as the app is open.
      if (poll.current) clearInterval(poll.current)
      /* LEAVING WITHOUT PAYING. Writing the request when the QR is DRAWN means merely
         looking at a payment put a row in the admin queue; this takes it back out. Cleared
         on success, so a paid one is never withdrawn. Fire-and-forget: the screen is going
         away and a failure here must not block that. */
      const ref = openRef.current
      if (ref) { openRef.current = null; abandonVietqr(ref).catch(() => {}) }
    }
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
  /**
   * ONE LADDER, IN ORDER, WITH NOTHING REPEATED.
   *
   * These are two admin-set lists concatenated, and $2,000 is in both — so the row rendered
   * it twice, React was handed two children keyed `2000`, and the chips read 200 · 500 ·
   * 1,000 · 2,000 · 3,000 · 2,000 · 5,000, which is a jumbled ladder as well as a console
   * error. Deduped by value (which also makes `key={p}` sound again) and sorted, because
   * the amount a preset carries IS its order — the split into small and bulk is about the
   * volume rate, not about how the buttons are read.
   */
  const presets = Array.from(new Set([...(cfg?.smallPresets ?? []), ...(cfg?.bulkPresets ?? [])]))
    .sort((a, b) => a - b)

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
      openRef.current = ref || null
      if (ref) {
        poll.current = setInterval(async () => {
          try {
            const s = await vietqrStatus(ref)
            if (s.paid) {
              if (poll.current) clearInterval(poll.current)
              openRef.current = null   // paid — never withdraw it
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

  /*
   * SAVE THE QR AS AN IMAGE.
   *
   * The QR is drawn as SVG, so there is no file to hand anywhere until it is rasterised —
   * `toDataURL` is the renderer's own callback and gives back base64 PNG. Written to the
   * cache (not Documents: it is a throwaway of a payment that expires) and handed to the
   * share sheet, where "Save Image" puts it in Photos without us asking for the photo
   * library permission up front.
   */
  const saveQr = useCallback(async () => {
    const ref = qrRef.current
    if (!ref?.toDataURL) { Alert.alert("Nothing to save", "The code hasn't finished drawing yet."); return }
    setSaving(true)
    try {
      const b64: string = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("The code took too long to render.")), 8000)
        ref.toDataURL!((data) => { clearTimeout(t); resolve(data) })
      })
      const file = `${FileSystem.cacheDirectory}egful-topup-${payment?.note || "qr"}.png`
      await FileSystem.writeAsStringAsync(file, b64, { encoding: FileSystem.EncodingType.Base64 })
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Can't share here", "Saving images isn't available on this device.")
        return
      }
      await Sharing.shareAsync(file, { mimeType: "image/png", dialogTitle: "Save the payment QR" })
    } catch (e) {
      Alert.alert("Couldn't save the QR", e instanceof Error ? e.message : "Try again.")
    } finally {
      setSaving(false)
    }
  }, [payment])

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
                ? <QRCode value={payment.qrCode} size={qrSize} getRef={(c) => { qrRef.current = c }} />
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

            {/* SAVE THE CODE, THEN LEAVE. Paying means switching to a banking app, and a QR
                you can only see in OUR app is one you cannot scan from inside theirs. Saved
                as an image so it can be picked from Photos in the bank's own scanner. */}
            <Pressable
              onPress={saveQr}
              disabled={saving || !payment.qrCode}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                marginTop: 20, height: 50, borderRadius: 14, paddingHorizontal: 24,
                borderWidth: 1, borderColor: C.border, opacity: pressed || saving ? 0.6 : 1,
              })}
            >
              {saving
                ? <ActivityIndicator color={C.primary} />
                : <Ionicons name="download-outline" size={18} color={C.fg} />}
              <Text style={{ fontSize: 15, fontWeight: "600", color: C.fg }}>Save QR image</Text>
            </Pressable>

            <Text style={{ fontSize: 13, color: C.muted, marginTop: 14, textAlign: "center", paddingHorizontal: 12 }}>
              Save it, pay in your banking app, then come back — this screen updates itself.
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 12, fontWeight: "800", color: C.muted, letterSpacing: 1, marginTop: 28 }}>
              AMOUNT (USD)
            </Text>

            {/*
              * WHAT YOU TYPE AND WHAT YOU SEND, IN ONE BOX.
              *
              * The dong figure sat under the preset chips — four rows of buttons away from
              * the number it converts — so the two never read as the same fact, and the
              * line had to name itself ("You'll transfer …") to explain what it was about.
              * In the corner of the field it needs no sentence: it is plainly this amount,
              * in the currency the transfer actually happens in.
              *
              * The rate stays below on its own, because it explains the conversion rather
              * than being part of it.
              */}
            <View style={{
              marginTop: 10, borderRadius: 16, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 8,
              backgroundColor: C.accent,
            }}>
              <TextInput
                value={amount}
                onChangeText={(t) => { setAmount(t.replace(/[^0-9.]/g, "")); setErr(null) }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={C.muted}
                style={{ height: 52, padding: 0, color: C.fg, fontSize: 30, fontWeight: "800" }}
              />
              {/* Only once there is an amount to convert. "≈ 0 ₫" under a blank field is a
                  sum nobody asked for. */}
              <Text style={{
                height: 16, textAlign: "right", fontSize: 12, fontWeight: "600",
                color: usdAmt > 0 && rate > 0 ? C.muted : "transparent",
              }}>
                {usdAmt > 0 && rate > 0 ? `≈ ${vnd0(vndAmt)}` : "·"}
              </Text>
            </View>

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
                  ? `${Math.round(rate).toLocaleString()} ₫ per $1`
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

            {/* PAST TOP-UPS — short on purpose. This answers one question ("did my last
                transfer land?") and anything longer belongs in the wallet's full ledger,
                which is one screen away. Five rows, amount and date, nothing else. */}
            {/*
              * AWAITING PAYMENT — the state that had nowhere to appear.
              *
              * Saving the QR means leaving for a banking app, and coming back to a screen
              * that shows nothing in flight reads as "my request vanished". These rows are
              * the proof it did not.
              *
              * `abandoned` is shown too, and not as a failure: closing the QR only takes the
              * request out of the ADMIN queue, because an unpaid VietQR is nothing for them
              * to act on. The virtual account stays live and the reference still settles, so
              * it is a payment the seller can still make.
              */}
            {open_ !== null && open_.length > 0 && (
              <>
                <Text style={{ fontSize: 12, fontWeight: "800", color: C.muted, letterSpacing: 1, marginTop: 28 }}>
                  AWAITING PAYMENT
                </Text>
                <View style={{ marginTop: 8, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
                  {open_.map((r, i) => (
                    <View
                      key={r.id}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 12,
                        paddingHorizontal: 16, paddingVertical: 14,
                        borderTopWidth: i ? 1 : 0, borderTopColor: C.border,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 16, fontWeight: "800", color: C.fg }}>
                          {usd0(Number(r.amount_usd) || 0)}
                          {r.vnd ? <Text style={{ fontSize: 13, fontWeight: "400", color: C.muted }}>{`  ${vnd0(Number(r.vnd))}`}</Text> : null}
                        </Text>
                        <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                          {r.ref ? `Ref ${r.ref} · ` : ""}
                          {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </Text>
                      </View>
                      <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "#fdf3e3" }}>
                        <Text style={{ fontSize: 12, fontWeight: "800", color: C.warn }}>Awaiting payment</Text>
                      </View>
                    </View>
                  ))}
                </View>
                <Text style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 19 }}>
                  Pay one of these from your banking app and the balance updates on its own —
                  the account and reference stay live.
                </Text>
              </>
            )}

            {history !== null && history.length > 0 && (
              <View style={{ marginTop: 36 }}>
                <Text style={{ fontSize: 12, fontWeight: "800", color: C.muted, letterSpacing: 1 }}>
                  RECENT TOP-UPS
                </Text>
                <View style={{ marginTop: 6 }}>
                  {history.map((r) => (
                    <View
                      key={String(r.id)}
                      style={{
                        flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
                        paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border,
                      }}
                    >
                      <Text style={{ fontSize: 14, color: C.muted }}>
                        {new Date(r.created_at).toLocaleDateString()}
                      </Text>
                      <Text style={{ fontSize: 15, fontWeight: "800", color: "#0a7c42" }}>
                        +${(Number(r.delta) || 0).toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {history !== null && history.length === 0 && (
              <Text style={{ fontSize: 14, color: C.muted, marginTop: 36 }}>
                No top-ups yet.
              </Text>
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
