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
import { F,C, R } from "@/lib/theme"

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

/**
 * THE AMOUNT, SET WITH A THUMB.
 *
 * A grid of preset buttons answers "one of these five" and nothing else — $250 meant typing
 * on a numeric pad, which on this screen is the step people abandon. A ruler you drag
 * answers every amount at the same cost, and it lands on the presets on the way past.
 *
 * IT IS A ScrollView, not a PanResponder. The feel people mean by "finger meter" is
 * MOMENTUM — you flick it and it coasts and settles — and that is the platform's scroll
 * physics, not something worth re-deriving. Snapping falls out of snapToInterval, so the
 * value can never land between two steps.
 *
 * TWO-WAY WITHOUT A LOOP, AND WITHOUT TRUSTING AN EVENT. Typing and the presets also set
 * the amount, so the ruler must follow them; but the ruler setting the amount must not
 * re-scroll the ruler. The first version gated onScroll on onScrollBeginDrag having fired,
 * which is true of a finger and NOT of a wheel or a programmatic scroll — driven under test
 * the ruler moved 350pt and the field never left blank. A control that reports nothing when
 * one event is missed is the wrong shape. So onScroll ALWAYS reports, and the follow effect
 * skips when the incoming value is the one this component last emitted.
 */
function AmountScrub({ value, min, max, step, onChange }: {
  value: number; min: number; max: number; step: number; onChange: (n: number) => void
}) {
  const PX = 14                        // one step of money, in points of travel
  const ref = useRef<ScrollView>(null)
  /** The last value this ruler produced, so the effect below can tell its own echo from a
   *  change that came from the field or a preset. */
  const emitted = useRef<number | null>(null)
  const [w, setW] = useState(0)
  const steps = Math.max(1, Math.round((max - min) / step))
  const offsetFor = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / step) * PX

  /*
   * Follow the field and the presets; ignore our own echo.
   *
   * NOT ANIMATED, and that is the whole correctness of it. A glided scrollTo emits an
   * onScroll at every frame ALONG THE WAY, and each one reported the value it was passing
   * through — so tapping $500 wrote 10, then 20, then 30, and the last frame to land before
   * React settled won. Measured: the preset produced $10. An instant set emits ONE event, at
   * the destination, which equals what we just recorded as emitted and is therefore skipped.
   * A preset is a discrete choice; it should land, not travel.
   */
  useEffect(() => {
    if (!w || value === emitted.current) return
    emitted.current = value
    ref.current?.scrollTo({ x: offsetFor(value), animated: false })
  }, [value, w])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    /* A WELL, so it reads as something you operate. Loose ticks on the page ground read as
       decoration — shape says kind here as everywhere else, and this one is a field. */
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ marginTop: 12, height: 46, borderRadius: R.chip, backgroundColor: C.hueMist, overflow: "hidden" }}
    >
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={PX}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={(e) => {
          const n = Math.min(max, Math.max(min, min + Math.round(e.nativeEvent.contentOffset.x / PX) * step))
          if (n === emitted.current) return
          emitted.current = n
          onChange(n)
        }}
        /* Half the width of padding at each end, so step zero sits under the centre mark
           rather than at the left edge. */
        contentContainerStyle={{ paddingHorizontal: w / 2 }}
      >
        {Array.from({ length: steps + 1 }, (_, i) => {
          const major = i % 5 === 0
          return (
            <View key={i} style={{ width: PX, alignItems: "center", justifyContent: "center", height: 46 }}>
              <View style={{
                width: major ? 2 : 1, height: major ? 22 : 11, borderRadius: 1,
                backgroundColor: major ? C.edge : C.muted, opacity: major ? 1 : 0.45,
              }} />
            </View>
          )
        })}
      </ScrollView>
      {/* THE MARK IS FIXED AND THE RULER MOVES — the other way round would mean reading a
          value off a moving pointer, which is what makes a slider hard to land precisely. */}
      <View pointerEvents="none" style={{
        position: "absolute", left: "50%", marginLeft: -1.5, top: 7, bottom: 7,
        width: 3, borderRadius: 2, backgroundColor: C.hueDeep,
      }} />
    </View>
  )
}


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

  /** Paid rows from the ledger and unpaid ones from topup_requests, newest first. Two
   *  sources because they are the same fact at two moments — see the note on the list. */
  const entries = [
    ...(history ?? []).map((r) => ({
      key: `l${r.id}`, usd: Number(r.delta) || 0, at: r.created_at, paid: true,
      req: undefined as TopupRequest | undefined,
    })),
    ...(open_ ?? []).map((r) => ({
      key: `r${r.id}`, usd: Number(r.amount_usd) || 0, at: r.created_at, paid: false, req: r,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

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
  /**
   * OPEN AN UNPAID REQUEST AGAIN — never mint a second one.
   *
   * A VietQR request is a virtual account created for one payment. "Pay it later" therefore
   * has to mean re-showing THAT code: creating another would leave two live accounts for the
   * same money, and a transfer against the abandoned one would arrive matching nothing.
   *
   * Everything drawn here comes off the stored row, so the code shown is byte-for-byte the
   * one issued — which is the whole point, since VietQR reconciles against what it issued.
   */
  const reopen = useCallback((r: TopupRequest) => {
    if (!r.qr_code) return
    if (poll.current) clearInterval(poll.current)
    setErr(null)
    setPayment({
      ok: true,
      qrCode: r.qr_code,
      note: r.ref || "",
      content: r.qr_content || r.ref || "",
      amount: Number(r.vnd) || 0,
      amountUsd: Number(r.amount_usd) || 0,
      name: r.receiver_name || "",
      bankCode: r.bank_code || "",
      vaAccount: r.va_account || "",
    })
    setPhase("qr")
    const ref = r.ref || ""
    /* NOT put back into openRef: that ref drives abandon-on-exit, and a request the seller
       deliberately came back to must not be withdrawn again for leaving the screen twice. */
    if (ref) {
      poll.current = setInterval(async () => {
        try {
          const st = await vietqrStatus(ref)
          if (st.paid) { if (poll.current) clearInterval(poll.current); setPhase("paid") }
        } catch { /* a dropped poll is not a failed payment */ }
      }, 4000)
    }
  }, [])

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
    <View style={{ flex: 1, backgroundColor: C.canvas, paddingTop: insets.top }}>
      <Pressable
        onPress={() => router.back()}
        style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 10 }}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={22} color={C.ink} />
        <Text style={{ color: C.ink, fontSize: 16 }}>Wallet</Text>
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}>
        <Text style={{ fontSize: 32, fontFamily: F.bold, color: C.ink }}>Add funds</Text>

        {phase === "paid" ? (
          <View style={{ alignItems: "center", marginTop: 48 }}>
            <Ionicons name="checkmark-circle" size={64} color={C.success} />
            <Text style={{ fontSize: 22, fontFamily: F.bold, color: C.ink, marginTop: 14 }}>Payment received</Text>
            <Text style={{ fontSize: 15, color: C.muted, marginTop: 6, textAlign: "center" }}>
              {payment?.amountUsd ? `${usd0(payment.amountUsd)} is on its way to your balance.` : "Your balance is being updated."}
            </Text>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => ({
                marginTop: 28, height: 52, borderRadius: R.chip, paddingHorizontal: 32,
                alignItems: "center", justifyContent: "center", backgroundColor: C.hueDeep,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: "#FFFFFF", fontFamily: F.bold, fontSize: 16 }}>Back to wallet</Text>
            </Pressable>
          </View>
        ) : phase === "qr" && payment ? (
          <View style={{ alignItems: "center", marginTop: 20 }}>
            <View style={{ padding: 16, borderRadius: R.card, backgroundColor: C.surface, borderWidth: 1, borderColor: C.hairline }}>
              {payment.qrCode
                ? <QRCode value={payment.qrCode} size={qrSize} getRef={(c) => { qrRef.current = c }} />
                : <Text style={{ color: C.muted }}>No scannable code</Text>}
            </View>

            <Text style={{ fontSize: 26, fontFamily: F.bold, color: C.ink, marginTop: 18 }}>
              {vnd0(payment.amount ?? vndAmt)}
            </Text>
            <Text style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>
              {usd0(payment.amountUsd ?? usdAmt)}
            </Text>

            <View style={{ alignSelf: "stretch", marginTop: 24, borderRadius: R.card, backgroundColor: C.hueMist, padding: 16 }}>
              <Field label="Receiver" value={payment.name} />
              <Field label="Bank" value={payment.bankCode} />
              <Field label="Account" value={payment.vaAccount || payment.account} />
              {/* The FULL description, not our short ref — VietQR wraps the ref in a
                  virtual-account prefix, and the payer's banking app shows the wrapped one. */}
              <Field label="Description" value={payment.content || payment.note} last />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20 }}>
              <ActivityIndicator color={C.ink} />
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
                marginTop: 20, height: 50, borderRadius: R.chip, paddingHorizontal: 24,
                borderWidth: 1, borderColor: C.edge, opacity: pressed || saving ? 0.6 : 1,
              })}
            >
              {saving
                ? <ActivityIndicator color={C.ink} />
                : <Ionicons name="download-outline" size={18} color={C.ink} />}
              <Text style={{ fontSize: 15, fontFamily: F.medium, color: C.ink }}>Save QR image</Text>
            </Pressable>

            <Text style={{ fontSize: 13, color: C.muted, marginTop: 14, textAlign: "center", paddingHorizontal: 12 }}>
              Save it, pay in your banking app, then come back — this screen updates itself.
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 12, fontFamily: F.bold, color: C.muted, letterSpacing: 1, marginTop: 28 }}>
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
              marginTop: 10, borderRadius: R.chip, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 8,
              borderWidth: 1, borderColor: C.edge,
              backgroundColor: C.surface,
            }}>
              <TextInput
                value={amount}
                onChangeText={(t) => { setAmount(t.replace(/[^0-9.]/g, "")); setErr(null) }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={C.muted}
                style={{ height: 52, padding: 0, color: C.ink, fontSize: 30, fontFamily: F.bold }}
              />
              {/* Only once there is an amount to convert. "≈ 0 ₫" under a blank field is a
                  sum nobody asked for. */}
              <Text style={{
                height: 16, textAlign: "right", fontSize: 12, fontFamily: F.medium,
                color: usdAmt > 0 && rate > 0 ? C.muted : "transparent",
              }}>
                {usdAmt > 0 && rate > 0 ? `≈ ${vnd0(vndAmt)}` : "·"}
              </Text>
            </View>

            {/* The ruler is bounded by what the server allows below and a ceiling of ten
                minimums or the largest preset, whichever is further — a ruler that runs to
                a number nobody tops up is mostly empty travel. */}
            <AmountScrub
              value={usdAmt}
              min={0}
              max={Math.max(minUsd * 10, ...(presets.length ? presets : [minUsd]), 500)}
              step={10}
              onChange={(n) => { setAmount(String(n)); setErr(null) }}
            />

            {presets.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                {presets.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => { setAmount(String(p)); setErr(null) }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 16, height: 40, borderRadius: R.chip, justifyContent: "center",
                      backgroundColor: String(p) === amount ? C.hueDeep : C.hueMist,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{
                      fontSize: 15, fontFamily: F.semi,
                      color: String(p) === amount ? "#FFFFFF" : C.ink,
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
                marginTop: 28, height: 54, borderRadius: R.chip, alignItems: "center", justifyContent: "center",
                backgroundColor: C.hueDeep, opacity: pressed || busy || !cfg ? 0.7 : 1,
              })}
            >
              {busy
                ? <ActivityIndicator color={"#FFFFFF"} />
                : <Text style={{ color: "#FFFFFF", fontFamily: F.bold, fontSize: 16 }}>Show payment QR</Text>}
            </Pressable>

            {!cfg && !err && (
              <View style={{ alignItems: "center", marginTop: 20 }}>
                <ActivityIndicator color={C.ink} />
              </View>
            )}

            {/* PAST TOP-UPS — short on purpose. This answers one question ("did my last
                transfer land?") and anything longer belongs in the wallet's full ledger,
                which is one screen away. Five rows, amount and date, nothing else. */}
            {/*
              * ONE LIST, EACH ROW CARRYING ITS OWN STATUS.
              *
              * Paid top-ups come from the LEDGER and unpaid requests from topup_requests,
              * because a ledger row is only written when the money lands — so a payment in
              * flight has no ledger row at all and used to be invisible here. They are the
              * same fact at two moments, so they read as one list in one order, and the
              * status is on the row rather than in a heading above a separate section.
              *
              * An unpaid row is PRESSABLE: it re-opens the code that was issued for it. That
              * is the reason the QR is stored — "pay it later" has to mean paying THAT
              * virtual account, and creating a fresh one would leave two live accounts for
              * the same money.
              *
              * Abandoned is not shown as a failure. Closing the QR only takes the request out
              * of the admin queue; the account stays live and the reference still settles.
              */}
            {(entries.length > 0) && (
              <View style={{ marginTop: 36 }}>
                <Text style={{ fontSize: 12, fontFamily: F.bold, color: C.muted, letterSpacing: 1 }}>
                  TOP-UPS
                </Text>
                <View style={{ marginTop: 6 }}>
                  {entries.map((e) => {
                    const row = (
                      <View
                        style={{
                          flexDirection: "row", alignItems: "center", gap: 12,
                          paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.hairline,
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontSize: 15, fontFamily: F.bold, color: C.ink }}>
                            {e.paid ? "+" : ""}{usd0(e.usd)}
                          </Text>
                          <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                            {new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            {e.req?.ref ? ` · ${e.req.ref}` : ""}
                          </Text>
                        </View>
                        <View style={{
                          paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.chip,
                          backgroundColor: e.paid ? C.successTint : C.warnTint,
                        }}>
                          <Text style={{ fontSize: 12, fontFamily: F.bold, color: e.paid ? C.success : C.warn }}>
                            {e.paid ? "Paid" : "Awaiting payment"}
                          </Text>
                        </View>
                      </View>
                    )
                    return e.req?.qr_code ? (
                      <Pressable key={e.key} onPress={() => reopen(e.req as TopupRequest)}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                        {row}
                      </Pressable>
                    ) : <View key={e.key}>{row}</View>
                  })}
                </View>
                {entries.some((e) => !e.paid) && (
                  <Text style={{ fontSize: 13, color: C.muted, marginTop: 10, lineHeight: 19 }}>
                    Tap one awaiting payment to bring its QR back — the account and reference
                    stay live, so paying it still credits your balance.
                  </Text>
                )}
              </View>
            )}

            {history !== null && open_ !== null && entries.length === 0 && (
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
      borderBottomWidth: last ? 0 : 1, borderBottomColor: C.hairline,
    }}>
      <Text style={{ fontSize: 14, color: C.muted }}>{label}</Text>
      <Text selectable style={{ fontSize: 14, fontFamily: F.semi, color: C.ink, flexShrink: 1, textAlign: "right" }}>
        {value || "—"}
      </Text>
    </View>
  )
}
