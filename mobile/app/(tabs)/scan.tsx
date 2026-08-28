import { useCallback, useEffect, useRef, useState } from "react"
import { View, Text, Pressable, ActivityIndicator, ScrollView, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { CameraView, useCameraPermissions } from "expo-camera"
import { Ionicons } from "@expo/vector-icons"
import { scanInventory, getMe, type ScanResult, type User } from "@/lib/api"
import { TAB_BAR,F,C, R } from "@/lib/theme"

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
 * why the mode is enormous and coloured, and why it is stated again in every result line.
 */
type Dir = "in" | "out"
type Entry = { at: number; code: string; dir: Dir; ok: boolean; message: string }

export default function Scan() {
  const insets = useSafeAreaInsets()
  /* 20 is the margin either side. Capped so it does not eat a tablet, floored so a small
     phone still frames a code rather than a slot. */
  const { width: screenW } = useWindowDimensions()
  const camSize = Math.min(420, Math.max(260, screenW - 40))
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
  /*
   * The camera fires continuously — the same label in frame for a second is dozens of
   * callbacks. A ref, not state: it has to be readable and writable synchronously inside
   * the handler, and a state update would arrive far too late to stop the second scan of
   * the same carton being counted.
   */
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 })

  const onScan = useCallback(async ({ data }: { data: string }) => {
    const code = String(data || "").trim()
    if (!code) return
    const now = Date.now()
    if (code === lastRef.current.code && now - lastRef.current.at < 2500) return
    lastRef.current = { code, at: now }

    setBusy(true)
    try {
      const r: ScanResult = await scanInventory(code, dir)
      const ok = !r.error
      setLog((prev) => [{
        at: now, code, dir, ok,
        message: ok
          ? `${r.name ? r.name + " · " : ""}${r.in_stock ?? "?"} in stock`
          : r.error || "Not recognised",
      }, ...prev].slice(0, 30))
    } catch (e) {
      setLog((prev) => [{
        at: now, code, dir, ok: false,
        message: e instanceof Error ? e.message : "Scan failed",
      }, ...prev].slice(0, 30))
    } finally {
      setBusy(false)
    }
  }, [dir])

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
          Moving stock on and off the shelf is the warehouse's to record. Only a warehouse
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
            backgroundColor: C.brand, opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: C.onBrand, fontFamily: F.bold, fontSize: 16 }}>Allow camera</Text>
        </Pressable>
      </View>
    )
  }

  const inMode = dir === "in"
  const tone = inMode ? C.success : C.alert

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text style={{ fontSize: 32, fontFamily: F.bold, color: C.fg, marginTop: 8 }}>Scan</Text>

        {/* THE MODE STILL HAS TO BE UNMISTAKABLE — a wrong one is silent damage to a stock
            count, and that has not changed. What changed is the instrument: this was two
            54pt slabs of flat green and red, which is the loudest thing on the screen
            competing with the camera, the one thing you are actually looking at.
            The reserved colour survives where it carries furthest — as the word itself, a
            rule under it, AND the camera frame below, which is tinted from the same `tone`.
            Three statements of the mode, none of them a coloured square. */}
        <View style={{ flexDirection: "row", gap: 26, marginTop: 16 }}>
          {(["in", "out"] as Dir[]).map((d) => {
            const on = d === dir
            const c = d === "in" ? C.success : C.alert
            return (
              <Pressable key={d} onPress={() => setDir(d)} hitSlop={10} style={{ paddingBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <Ionicons
                    name={d === "in" ? "arrow-down-circle" : "arrow-up-circle"}
                    size={18}
                    color={on ? c : C.muted}
                  />
                  <Text style={{ fontSize: 16, fontFamily: on ? F.semi : F.body, color: on ? c : C.muted }}>
                    {d === "in" ? "Stock in" : "Stock out"}
                  </Text>
                </View>
                <View style={{
                  position: "absolute", left: 0, right: 0, bottom: 0, height: 2,
                  backgroundColor: on ? c : "transparent",
                }} />
              </Pressable>
            )
          })}
        </View>
      </View>

      {/*
        * THE VIEWFINDER IS SIZED FOR WHAT IT READS.
        *
        * It was a fixed 260pt letterbox with a 190×130 landscape reticle — the shape of a
        * 1D barcode, from when that was the only thing on a label. The codes people point
        * this at are QR now (a 25-character SKU as Code-128 is unreadable off a screen,
        * which is why the web shows a QR), and a QR is SQUARE: framing it inside a wide,
        * short box means holding the phone further back, which is exactly when a camera
        * stops resolving the modules.
        *
        * Square, and as wide as the screen allows. More pixels across the code is the
        * whole game — a decoder needs roughly two camera pixels per module.
        */}
      <View style={{
        marginHorizontal: 20, borderRadius: R.card, overflow: "hidden",
        height: camSize, backgroundColor: "#000",
      }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          // Both families, so nobody has to know which kind of label they picked up.
          barcodeScannerSettings={{
            barcodeTypes: ["qr", "code128", "code39", "ean13", "ean8", "upc_a", "upc_e", "itf14", "datamatrix"],
          }}
          onBarcodeScanned={busy ? undefined : onScan}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
            alignItems: "center", justifyContent: "center",
          }}
        >
          {/* Square, because the code is. 68% leaves the quiet zone inside the frame —
              a QR held edge-to-edge with the reticle loses the margin decoders need. */}
          <View style={{ width: camSize * 0.68, height: camSize * 0.68, borderWidth: 3, borderColor: tone, borderRadius: R.card }} />
        </View>
      </View>

      <Text style={{ fontSize: 14, color: C.muted, textAlign: "center", marginTop: 12 }}>
        {busy ? "Recording…" : `Point at a label — everything scanned goes ${inMode ? "IN" : "OUT"}`}
      </Text>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + TAB_BAR.clearance }}>
        {log.length === 0 ? (
          <Text style={{ fontSize: 15, color: C.muted }}>Nothing scanned yet.</Text>
        ) : (
          log.map((e) => (
            <View
              key={`${e.at}-${e.code}`}
              style={{
                flexDirection: "row", alignItems: "center", gap: 12,
                paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border,
              }}
            >
              <Ionicons
                name={e.ok ? "checkmark-circle" : "alert-circle"}
                size={22}
                color={e.ok ? (e.dir === "in" ? C.success : C.alert) : C.warn}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: F.semi, color: C.fg }}>
                  {e.code}
                </Text>
                {/* The direction is repeated on every line. A log that only says what
                    happened, not which way, is unreadable an hour later. */}
                <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                  {e.dir === "in" ? "IN" : "OUT"} · {e.message}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}
