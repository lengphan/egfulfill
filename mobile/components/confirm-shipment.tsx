import { useState } from "react"
import { View, Text, Pressable, Alert, ActivityIndicator } from "react-native"
import * as ImagePicker from "expo-image-picker"
import { Ionicons } from "@expo/vector-icons"
import { uploadAttachment, postOrderMessage, setOrderStage } from "@/lib/api"
import { C, HERO_BUTTON, HERO_LABEL, HERO_GLYPH } from "@/lib/theme"

/**
 * CONFIRM SHIPMENT — the last step, and ONE press.
 *
 * The proof shot used to be a button of its own, sitting on the screen from the moment an
 * order was opened, which put it nowhere in particular: a photo is not a stage, and asking
 * for one before anything has been made is asking for a picture of a shelf. It is now the
 * shipping step itself — the camera opens, the picture goes into the order's own activity,
 * and the order moves to shipped in the same press.
 *
 * ORDER OF OPERATIONS IS DELIBERATE: photograph, log, THEN ship.
 *
 * The server refuses a ship it cannot back — no label, or a decorated line with no artwork
 * (shipBlockers). If the ship is refused after the photo is logged, the photo is still a
 * true record of a parcel that was packed, and the refusal names what is missing. The other
 * order would have shipped the order and then possibly failed to keep any proof, which is
 * the half that cannot be reconstructed later.
 */
export function ConfirmShipment({ orderId, role, by, onDone }: {
  orderId: string
  role?: string
  by?: string
  onDone: () => void
}) {
  const [busy, setBusy] = useState<null | "camera" | "upload" | "ship">(null)

  const capture = async (from: "camera" | "library") => {
    if (from === "camera") {
      // Asked at the moment of use, with the reason on screen. A permission prompt fired on
      // launch, before anyone has pressed anything, is the one people deny.
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) {
        Alert.alert("Camera needed", "Allow camera access to photograph the parcel, or pick an existing photo.")
        return
      }
    }
    setBusy("camera")
    let shot: ImagePicker.ImagePickerResult
    try {
      const opts = { base64: true, quality: 0.6, exif: false } as const
      shot = from === "camera"
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts)
    } finally { setBusy(null) }
    if (shot.canceled || !shot.assets?.[0]?.base64) return

    const asset = shot.assets[0]
    setBusy("upload")
    try {
      const mime = asset.mimeType || "image/jpeg"
      const up = await uploadAttachment(`data:${mime};base64,${asset.base64}`, `package-${Date.now()}.jpg`)
      if (up.error) throw new Error(up.error)
      const posted = await postOrderMessage(orderId, "Shipment confirmed — package photo", {
        role, by, attachment: { url: up.url, name: up.name, mime: up.mime, size: up.size },
        // Idempotent: a double-tap on a slow connection would otherwise file the parcel twice.
        clientId: `ship-${orderId}-${Date.now()}`,
      })
      if (posted.error) throw new Error(posted.error)
    } catch (e) {
      // Say what failed, and say the order did NOT move — otherwise someone walks away
      // believing a parcel is recorded as gone.
      Alert.alert("Photo not saved", `${e instanceof Error ? e.message : "Upload failed."}\n\nThe order has not been marked shipped.`)
      setBusy(null)
      return
    }

    setBusy("ship")
    try {
      const r = await setOrderStage(orderId, "shipped")
      if (r.error) {
        Alert.alert("Photo saved, not shipped", `${r.error}\n\nThe photo is in the order's activity.`)
      }
    } catch (e) {
      Alert.alert("Photo saved, not shipped", e instanceof Error ? e.message : "Try again.")
    } finally {
      setBusy(null)
      onDone()
    }
  }

  const start = () => {
    Alert.alert("Confirm shipment", "Photograph the parcel — the picture is filed on the order and it is marked shipped.", [
      { text: "Take photo", onPress: () => capture("camera") },
      { text: "Choose photo", onPress: () => capture("library") },
      { text: "Cancel", style: "cancel" },
    ])
  }

  const label = busy === "upload" ? "Saving photo…" : busy === "ship" ? "Marking shipped…" : busy ? "Opening camera…" : "Confirm shipment"

  return (
    <Pressable
      onPress={start}
      disabled={!!busy}
      style={({ pressed }) => ({
        ...HERO_BUTTON,
        marginTop: 8, backgroundColor: C.ink,
        opacity: pressed || busy ? 0.8 : 1,
      })}
    >
      {/*
        * THE WORDS, AND A LIME GLYPH THAT SITS ON THE INK.
        *
        * This was a 40pt lime tile holding a camera, a title, a subtitle explaining what
        * the press does, and a trailing arrow — five things to say "Confirm shipment". The
        * subtitle described a sequence nobody reads mid-press, and the filled tile made the
        * glyph a badge rather than a mark. Lime directly on the ink block is the brand pair
        * the whole app is built on; a plate behind it only mutes it.
        */}
      {/* Same shape as Start Order — see HERO_BUTTON. These sit within a screen of each
          other and are the same kind of control, so they are the same size. */}
      {busy
        ? <ActivityIndicator color={C.lime} />
        : <Ionicons name="camera" size={HERO_GLYPH} color={C.lime} />}
      <Text style={{ ...HERO_LABEL, color: C.onInk }}>{label}</Text>
    </Pressable>
  )
}
