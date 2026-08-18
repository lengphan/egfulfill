import { useState } from "react"
import { View, Text, Pressable, Alert, ActivityIndicator, Image } from "react-native"
import * as ImagePicker from "expo-image-picker"
import { Ionicons } from "@expo/vector-icons"
import { uploadAttachment, postOrderMessage } from "@/lib/api"
import { C } from "@/lib/theme"

/**
 * PACKAGE PHOTO — the proof shot, taken where the parcel is.
 *
 * This is the one thing a phone does that a desk cannot: the package is in your hands, and
 * the record of it should not depend on someone remembering to upload a photo later.
 *
 * It posts into the order's OWN activity thread, so the picture sits with the order rather
 * than in a camera roll — which is the whole point of taking it here.
 *
 * The role is passed explicitly. The server files a message as `b.role || 'seller'`, so a
 * photo taken on the factory floor would otherwise be recorded as if the seller sent it.
 */
export function PackagePhoto({ orderId, role, by, onPosted }: {
  orderId: string
  role?: string
  by?: string
  onPosted?: () => void
}) {
  const [busy, setBusy] = useState<null | "camera" | "upload">(null)

  const take = async () => {
    // Ask at the moment of use, with the reason on screen — a permission prompt fired on
    // launch, before anyone has pressed anything, is the one people deny.
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      Alert.alert("Camera needed", "Allow camera access to attach a photo of the package.")
      return
    }

    setBusy("camera")
    let shot: ImagePicker.ImagePickerResult
    try {
      shot = await ImagePicker.launchCameraAsync({
        // base64 so it can go straight up as a data URL, and quality well under the
        // server's 12MB ceiling — a raw 48MP capture would be refused.
        base64: true,
        quality: 0.6,
        exif: false,
      })
    } finally {
      setBusy(null)
    }
    if (shot.canceled || !shot.assets?.[0]?.base64) return

    const asset = shot.assets[0]
    setBusy("upload")
    try {
      const mime = asset.mimeType || "image/jpeg"
      const up = await uploadAttachment(`data:${mime};base64,${asset.base64}`, `package-${Date.now()}.jpg`)
      if (up.error) throw new Error(up.error)
      const r = await postOrderMessage(orderId, "Package photo", {
        role, by, attachment: { url: up.url, name: up.name, mime: up.mime, size: up.size },
        // Idempotent: a double-tap on a slow connection would otherwise file the parcel twice.
        clientId: `pkg-${orderId}-${Date.now()}`,
      })
      if (r.error) throw new Error(r.error)
      onPosted?.()
    } catch (e) {
      // Say what failed. "Couldn't save" sends someone to re-take a photo that was fine.
      Alert.alert("Photo not saved", e instanceof Error ? e.message : "Upload failed.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Pressable
      onPress={take}
      disabled={!!busy}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
        height: 54, borderRadius: 14, backgroundColor: C.primary,
        opacity: pressed || busy ? 0.75 : 1,
      })}
    >
      {busy ? (
        <>
          <ActivityIndicator color={C.onPrimary} />
          <Text style={{ color: C.onPrimary, fontWeight: "800", fontSize: 16 }}>
            {busy === "upload" ? "Saving…" : "Opening camera…"}
          </Text>
        </>
      ) : (
        <>
          <Ionicons name="camera" size={20} color={C.onPrimary} />
          <Text style={{ color: C.onPrimary, fontWeight: "800", fontSize: 16 }}>Photo of package</Text>
        </>
      )}
    </Pressable>
  )
}

/** One entry in the order's activity, rendered small — this is a log, not a chat. */
export function ActivityRow({ e }: { e: { by?: string; role?: string; text?: string; ts?: number; attachment?: { url: string; mime: string } | null } }) {
  const when = e.ts ? new Date(e.ts).toLocaleString() : ""
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <Text style={{ fontSize: 15, color: C.fg }}>{e.text || "—"}</Text>
      <Text style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
        {[e.by, when].filter(Boolean).join(" · ")}
      </Text>
      {/* The asset route is unguarded but unguessable, so a plain <Image> loads it without
          having to attach a bearer token to an image request. */}
      {e.attachment?.url && String(e.attachment.mime || "").startsWith("image/") && (
        <Image
          source={{ uri: e.attachment.url }}
          style={{ width: "100%", height: 180, marginTop: 8, borderRadius: 10, backgroundColor: C.accent }}
          resizeMode="cover"
        />
      )}
    </View>
  )
}
