import { View, Text, Image } from "react-native"
import { C, R } from "@/lib/theme"

/**
 * One entry in the order's activity — a LOG, not a chat, so it is dense and quiet.
 *
 * Moved out of package-photo.tsx when the proof shot stopped being a button of its own and
 * became the shipping step (see confirm-shipment.tsx). Nothing about it changed but where
 * it lives and how much air it has.
 */
export function ActivityRow({ e }: {
  e: { by?: string; role?: string; text?: string; ts?: number; attachment?: { url: string; mime: string } | null }
}) {
  const when = e.ts ? new Date(e.ts).toLocaleString() : ""
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingVertical: 12 }}>
      {/* The rail: a log reads as a sequence, and the dot-and-line is what says so without
          a heading per entry. */}
      <View style={{ alignItems: "center", width: 10, paddingTop: 5 }}>
        <View style={{ width: 7, height: 7, borderRadius: R.pill, backgroundColor: C.primary }} />
        <View style={{ flex: 1, width: 1, backgroundColor: C.border, marginTop: 4 }} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, color: C.fg, lineHeight: 20 }}>{e.text || "—"}</Text>
        <Text style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
          {[e.by, when].filter(Boolean).join(" · ")}
        </Text>
        {/* The asset route is unguarded but unguessable, so a plain <Image> loads it without
            having to attach a bearer token to an image request. */}
        {e.attachment?.url && String(e.attachment.mime || "").startsWith("image/") && (
          <Image
            source={{ uri: e.attachment.url }}
            style={{ width: "100%", height: 190, marginTop: 10, borderRadius: R.card, backgroundColor: C.accent }}
            resizeMode="cover"
          />
        )}
      </View>
    </View>
  )
}
