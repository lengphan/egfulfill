import { useCallback, useEffect, useRef, useState } from "react"
import {
  View, Text, Pressable, ActivityIndicator, ScrollView, Modal, TextInput,
  KeyboardAvoidingView, Platform, useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { CameraView, useCameraPermissions } from "expo-camera"
import { Ionicons } from "@expo/vector-icons"
import { scanInventory, getMe, type ScanResult, type User } from "@/lib/api"
import { TAB_BAR, F, C, R, S } from "@/lib/theme"

/**
 * SCAN — stock in and out, from the aisle instead of a station.
 *
 * Reads QR **and** barcodes: the labels printed at receiving are one, the supplier cartons
 * are the other, and a scanner that only understands half of what is on the shelf sends
 * someone back to the desk. The camera decodes both, so nobody has to know which they are
 * holding.
 *
 * The scanned string goes to the server UNTOUCHED. A code carries a SKU — ours, or the
 * internal EG-… one printed for consigned stock — and the server already resolves both.
 * Deciding here what kind of code it is would be a second opinion about our own labels.
 *
 * IN and OUT is a MODE, chosen before scanning and staying chosen. Asking after each scan
 * is a question at the worst moment: hands full, ten cartons to go. Getting it wrong is
 * silent damage to a stock count, which is why the mode is stated three times: in the
 * control, in the instruction line, and again in every result row.
 *
 * ── TWO THINGS WERE WRONG WITH THIS SCREEN, AND THEY ARE THE SAME THING ────────────────
 *
 * THE CAMERA WAS A THIRD OF THE PAGE. A square panel with a title above it and a list
 * below, so the one thing you are actually pointing at got the smallest share of the
 * screen. More pixels across a code is the entire game for a decoder — roughly two camera
 * pixels per module — so a small viewfinder is not a styling choice, it is a scanner that
 * makes you step closer. It is full-bleed now; the page is the camera.
 *
 * THE FRAME WAS GREEN. `tone` was `success` in IN mode and `alert` in OUT, painted as a 3pt
 * border around the whole reticle — so the instrument sat there wearing the colour of a
 * finished, successful thing before it had read anything at all. Green means SHIPPED on
 * this floor and red means CANCELLED; spending either on a mode is exactly the misuse the
 * house rule exists to stop, and on a factory floor it is the one an accent must not make.
 *
 * SO: SHAPE CARRIES THE MODE, COLOUR CARRIES THE MOMENT.
 *
 *   - The reticle is four CORNER MARKS, in white, at rest. Corners are the scanner idiom
 *     everywhere for a reason: they frame without enclosing, so they say "put it here"
 *     rather than "this is finished".
 *   - The mode is a filled capsule with an arrow that points the way the stock is going —
 *     down INTO the shelf, up OUT of it. Shape and direction, legible in greyscale.
 *   - Status colour appears for 700ms at the instant of a reading, and then leaves. That is
 *     the only time it is telling the truth: it is reporting what just happened.
 */
type Dir = "in" | "out"
type Entry = { at: number; code: string; dir: Dir; ok: boolean; message: string }
type Flash = { ok: boolean; at: number }

/** One corner of the reticle. Four of these, rotated by which edges they draw. */
function Corner({ tone, style }: { tone: string; style: object }) {
  return <View style={{ position: "absolute", width: 34, height: 34, borderColor: tone, ...style }} />
}

export default function Scan() {
  const insets = useSafeAreaInsets()
  const { width: screenW, height: screenH } = useWindowDimensions()
  const [perm, requestPerm] = useCameraPermissions()
  /**
   * WHOSE TAB THIS IS.
   *
   * POST /api/inventory/scan is `requireWarehouse` — admin and warehouse, nobody else. The
   * screen had no idea: it showed the camera to every signed-in account including SELLERS,
   * asked them for camera permission, and only after a code was in frame came back
   * "Warehouse or admin only". Asking a seller for their camera to run a request they can
   * never make is the worst version of a gate that is checked too late.
   */
  const [me, setMe] = useState<User | null>(null)
  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)) }, [])
  const [dir, setDir] = useState<Dir>("in")
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<Entry[]>([])
  const [flash, setFlash] = useState<Flash | null>(null)
  const [manual, setManual] = useState(false)
  const [typed, setTyped] = useState("")
  /*
   * The camera fires continuously — the same label in frame for a second is dozens of
   * callbacks. A ref, not state: it has to be readable and writable synchronously inside
   * the handler, and a state update would arrive far too late to stop the second scan of
   * the same carton being counted.
   */
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 })

  /* THE READING ITSELF, shared by the camera and by typing. A damaged label is routine, so
     the manual path is not a lesser version of this — it is the same request. */
  const record = useCallback(async (code: string) => {
    const now = Date.now()
    setBusy(true)
    try {
      const r: ScanResult = await scanInventory(code, dir)
      const ok = !r.error
      setFlash({ ok, at: now })
      setLog((prev) => [{
        at: now, code, dir, ok,
        message: ok
          ? `${r.name ? r.name + " · " : ""}${r.in_stock ?? "?"} in stock`
          : r.error || "Not recognised",
      }, ...prev].slice(0, 30))
    } catch (e) {
      setFlash({ ok: false, at: now })
      setLog((prev) => [{
        at: now, code, dir, ok: false,
        message: e instanceof Error ? e.message : "Scan failed",
      }, ...prev].slice(0, 30))
    } finally {
      setBusy(false)
    }
  }, [dir])

  const onScan = useCallback(({ data }: { data: string }) => {
    const code = String(data || "").trim()
    if (!code) return
    const now = Date.now()
    if (code === lastRef.current.code && now - lastRef.current.at < 2500) return
    lastRef.current = { code, at: now }
    void record(code)
  }, [record])

  /* THE COLOUR LEAVES AGAIN. 700ms is long enough to register at arm's length and short
     enough that the instrument is back at rest before the next carton is up. */
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 700)
    return () => clearTimeout(t)
  }, [flash])

  /* Asked BEFORE the camera permission, so the wrong role is never prompted for a camera.
     null = still loading; only a definite answer refuses. */
  const mayScan = !me || me.role === "admin" || me.role === "warehouse"
  if (me && !mayScan) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 40, paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 28, fontFamily: F.bold, color: C.fg }}>Scan stock</Text>
        {/* NEVER HIDE, EXPLAIN — the web's rule. It names the roles rather than saying
            "not allowed", so the answer to "who do I ask" is on the screen. */}
        <Text style={{ fontSize: 16, color: C.muted, marginTop: 10, lineHeight: 22 }}>
          Moving stock on and off the shelf is the warehouse’s to record. Only a warehouse
          or admin account can scan.
        </Text>
      </View>
    )
  }

  if (!perm) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.primary} />
      </View>
    )
  }

  if (!perm.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 40, paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 28, fontFamily: F.bold, color: C.fg }}>Scan stock</Text>
        <Text style={{ fontSize: 16, color: C.muted, marginTop: 10, lineHeight: 22 }}>
          The camera reads the code on a shelf label or a carton, and moves that stock in or out.
        </Text>
        <Pressable
          onPress={requestPerm}
          style={({ pressed }) => ({
            marginTop: 24, height: 54, borderRadius: R.control, alignItems: "center", justifyContent: "center",
            backgroundColor: C.ink, opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: C.onInk, fontFamily: F.bold, fontSize: 16 }}>Allow camera</Text>
        </Pressable>
        {/* The camera is not the only way in, and a refused permission is exactly when that
            matters. */}
        <Pressable
          onPress={() => setManual(true)}
          style={({ pressed }) => ({
            marginTop: 12, height: 48, borderRadius: R.control, alignItems: "center", justifyContent: "center",
            borderWidth: 1, borderColor: C.border, backgroundColor: pressed ? C.accent : C.card,
          })}
        >
          <Text style={{ color: C.fg, fontFamily: F.semi, fontSize: 15 }}>Enter code manually</Text>
        </Pressable>
        <ManualSheet
          open={manual} dir={dir} value={typed} onChange={setTyped}
          onClose={() => setManual(false)}
          onSubmit={() => { const c = typed.trim(); setTyped(""); setManual(false); if (c) void record(c) }}
        />
      </View>
    )
  }

  const inMode = dir === "in"
  /* AT REST IT IS WHITE. Colour only at the instant of a reading. */
  const tone = flash ? (flash.ok ? C.success : C.warn) : "#FFFFFF"
  const box = Math.min(screenW - 72, screenH * 0.4)

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        facing="back"
        // Both families, so nobody has to know which kind of label they picked up.
        barcodeScannerSettings={{
          barcodeTypes: ["qr", "code128", "code39", "ean13", "ean8", "upc_a", "upc_e", "itf14", "datamatrix"],
        }}
        onBarcodeScanned={busy || manual ? undefined : onScan}
      />

      {/* THE RETICLE — four corners, nothing enclosed. It grows a hair and takes the
          result's colour at the moment of a reading, then returns to white. */}
      <View pointerEvents="none" style={{
        position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
        alignItems: "center", justifyContent: "center",
      }}>
        <View style={{ width: box, height: box }}>
          <Corner tone={tone} style={{ top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 }} />
          <Corner tone={tone} style={{ top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 }} />
          <Corner tone={tone} style={{ bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 }} />
          <Corner tone={tone} style={{ bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 }} />
        </View>
      </View>

      {/* TOP — the mode, over a scrim so type on video stays legible. */}
      <View style={{
        position: "absolute", left: 0, right: 0, top: 0,
        paddingTop: insets.top + S.sm, paddingBottom: S.lg, paddingHorizontal: S.xl,
        backgroundColor: "rgba(0,0,0,0.45)",
      }}>
        <Text style={{ fontSize: 13, fontFamily: F.medium, color: "rgba(255,255,255,0.75)" }}>
          {busy ? "Recording…" : `Everything scanned goes ${inMode ? "IN" : "OUT"}`}
        </Text>

        {/* THE MODE, AS SHAPE. A filled capsule for the live one, an arrow pointing the way
            the stock moves. Periwinkle is the app's "you are here" and this is the one
            control on the screen that says where you are — it is not a status, so it does
            not borrow one. */}
        <View style={{
          flexDirection: "row", marginTop: S.sm, padding: 3, gap: 3,
          borderRadius: R.pill, backgroundColor: "rgba(255,255,255,0.14)",
        }}>
          {(["in", "out"] as Dir[]).map((d) => {
            const on = d === dir
            return (
              <Pressable
                key={d}
                onPress={() => setDir(d)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={{
                  flex: 1, height: 42, borderRadius: R.pill,
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
                  backgroundColor: on ? C.lit : "transparent",
                }}
              >
                <Ionicons
                  name={d === "in" ? "arrow-down" : "arrow-up"}
                  size={17}
                  color={on ? C.onLit : "rgba(255,255,255,0.8)"}
                />
                <Text style={{
                  fontSize: 15, fontFamily: on ? F.semi : F.medium,
                  color: on ? C.onLit : "rgba(255,255,255,0.8)",
                }}>
                  {d === "in" ? "Stock in" : "Stock out"}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* BOTTOM — the way through when the label will not read, and what just happened. */}
      <View style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        paddingTop: S.lg, paddingBottom: insets.bottom + TAB_BAR.clearance,
        paddingHorizontal: S.xl,
        backgroundColor: "rgba(0,0,0,0.55)",
      }}>
        {/* THE FALLBACK IS A BUTTON, not a hint. A thermal label goes through a printer, a
            box and a shelf; some of them come back unreadable, and until now that was a
            dead end on this screen. */}
        <Pressable
          onPress={() => setManual(true)}
          style={({ pressed }) => ({
            height: 46, borderRadius: R.control,
            alignItems: "center", justifyContent: "center",
            borderWidth: 1, borderColor: "rgba(255,255,255,0.45)",
            backgroundColor: pressed ? "rgba(255,255,255,0.14)" : "transparent",
          })}
        >
          <Text style={{ color: "#FFFFFF", fontFamily: F.semi, fontSize: 15 }}>Enter code manually</Text>
        </Pressable>

        <ScrollView style={{ maxHeight: 132, marginTop: S.md }} contentContainerStyle={{ gap: 2 }}>
          {log.length === 0 ? (
            <Text style={{ fontSize: 13.5, color: "rgba(255,255,255,0.65)", paddingVertical: 6 }}>
              Nothing scanned yet.
            </Text>
          ) : (
            log.map((e) => (
              <View key={`${e.at}-${e.code}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 }}>
                <Ionicons
                  name={e.ok ? "checkmark-circle" : "alert-circle"}
                  size={18}
                  color={e.ok ? C.success : C.warn}
                />
                <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.semi, color: "#FFFFFF", maxWidth: "42%" }}>
                  {e.code}
                </Text>
                {/* The direction is repeated on every line. A log that only says what
                    happened, not which way, is unreadable an hour later. */}
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
                  {e.dir === "in" ? "IN" : "OUT"} · {e.message}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      <ManualSheet
        open={manual} dir={dir} value={typed} onChange={setTyped}
        onClose={() => setManual(false)}
        onSubmit={() => { const c = typed.trim(); setTyped(""); setManual(false); if (c) void record(c) }}
      />
    </View>
  )
}

/**
 * TYPING THE CODE.
 *
 * Same request, same mode, same log — the only difference is where the string came from, so
 * it says which way the stock is about to move rather than making you trust that the mode
 * behind the sheet is still what you set.
 */
function ManualSheet({ open, dir, value, onChange, onClose, onSubmit }: {
  open: boolean
  dir: Dir
  value: string
  onChange: (v: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}
      >
        <View style={{
          backgroundColor: C.card, borderTopLeftRadius: R.card, borderTopRightRadius: R.card,
          padding: S.xl, gap: S.md,
        }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ flex: 1, fontSize: 18, fontFamily: F.displaySemi, color: C.fg }}>
              Enter code
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={C.muted} />
            </Pressable>
          </View>

          <TextInput
            value={value}
            onChangeText={onChange}
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="EG-2099-1-EMB"
            placeholderTextColor={C.muted}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
            style={{
              height: 52, borderRadius: R.control, borderWidth: 1, borderColor: C.edge,
              paddingHorizontal: S.md, fontSize: 17, fontFamily: F.medium, color: C.fg,
              backgroundColor: C.bg,
            }}
          />

          <Pressable
            onPress={onSubmit}
            disabled={!value.trim()}
            style={({ pressed }) => ({
              height: 50, borderRadius: R.control, alignItems: "center", justifyContent: "center",
              backgroundColor: value.trim() ? C.ink : C.accent,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{
              fontSize: 15.5, fontFamily: F.semi,
              color: value.trim() ? C.onInk : C.muted,
            }}>
              Record {dir === "in" ? "IN" : "OUT"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
