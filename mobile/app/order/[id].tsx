import { useCallback, useEffect, useState } from "react"
import { View, Text, ScrollView, Pressable, ActivityIndicator, Linking, Alert, RefreshControl } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useLocalSearchParams, router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import {
  getOrder, getOrderMessages, getOrderDesigns, getMe, setOrderStage, markLabelPrinted,
  type Order, type OrderDesign, type ChatEntry, type User,
} from "@/lib/api"
import {
  normalizeStage, units, isOverdue, numOf, platformOf, nextStage, addressLines,
  STAGE_LABEL, stageAction,
} from "@/lib/orders"
import { F,C, R, LIFT, SECTION, toneOnInk, HERO_BUTTON, HERO_LABEL, HERO_GLYPH } from "@/lib/theme"
import { ActivityRow } from "@/components/activity"
import { ConfirmShipment } from "@/components/confirm-shipment"
import { OrderLine } from "@/components/order-line"
import { BuyLabel } from "@/components/buy-label"
import { recall } from "@/lib/order-cache"
import { printOrderLabel, printWasCancelled } from "@/lib/print-label"

/**
 * ONE ORDER — the job, on the floor, in the hand.
 *
 * It reads top to bottom as the work happens: what this is → the one thing to press now →
 * how to find it and prove it (barcode, label) → the LINES, each with its own artwork and
 * its own files → what has already happened to it.
 *
 * The rebuild fixed four things that made the first version something to look at rather
 * than something to use: there was no obvious place to press to start; the lines were
 * collapsed into a piece count, so an order's items and its files could not be told apart;
 * there was no barcode, so the phone could not stand in for the paper ticket; and the proof
 * photo was a button with no place in the sequence (see confirm-shipment.tsx).
 */

/** Carrier tracking pages. Only carriers we actually ship with — a guessed URL that 404s is
 *  worse than showing the bare number, because it looks like the order is untraceable. */
const TRACK_URL: Record<string, (code: string) => string> = {
  usps: (c) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(c)}`,
  ups: (c) => `https://www.ups.com/track?tracknum=${encodeURIComponent(c)}`,
  fedex: (c) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(c)}`,
  dhl: (c) => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(c)}`,
}

function trackingLink(carrier?: string | null, code?: string | null) {
  if (!code) return null
  const key = String(carrier || "").trim().toLowerCase()
  const make = TRACK_URL[key]
  return make ? make(code) : null
}

function Section({ title, right }: { title: string; right?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 28, marginBottom: 12 }}>
      <Text style={{ fontSize: 12, fontFamily: F.bold, color: C.fg, letterSpacing: 1.4 }}>{title}</Text>
      {right ? <Text style={{ fontSize: 12, color: C.muted, fontFamily: F.medium }}>{right}</Text> : null}
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{
      flexDirection: "row", justifyContent: "space-between", gap: 16,
      paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border,
    }}>
      <Text style={{ fontSize: 14, color: C.muted }}>{label}</Text>
      <Text style={{ fontSize: 14, fontFamily: F.semi, color: C.fg, flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  )
}

export default function OrderDetail() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  /* SEEDED FROM THE LIST, so this screen has content the moment it slides in. The push
     animation was never the problem — arriving at a blank page and watching it fill was.
     recall() reads memory only, so it is safe as lazy initial state; the fetch below still
     runs and still wins. */
  const [o, setO] = useState<Order | null>(() => recall(id))
  const [err, setErr] = useState<string | null>(null)
  const [designs, setDesigns] = useState<OrderDesign[]>([])
  const [activity, setActivity] = useState<ChatEntry[] | null>(null)
  const [me, setMe] = useState<User | null>(null)
  const [moving, setMoving] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try { setO(await getOrder(String(id))); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load this order.") }
    // The files are a SEPARATE request and a separate failure: a design route that errors
    // must not blank the order. Lines then say "no artwork yet", which is the honest
    // reading of what this screen knows.
    try { setDesigns(await getOrderDesigns(String(id))) } catch { setDesigns([]) }
  }, [id])

  // Separate again: a failing activity thread should not blank the work above it.
  const loadActivity = useCallback(async () => {
    if (!id) return
    try { setActivity(await getOrderMessages(String(id))) } catch { setActivity([]) }
  }, [id])

  useEffect(() => { load(); loadActivity() }, [load, loadActivity])
  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)) }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true); await Promise.all([load(), loadActivity()]); setRefreshing(false)
  }, [load, loadActivity])

  const advance = useCallback(async () => {
    if (!o) return
    const to = nextStage(o)
    if (!to) return
    setMoving(true)
    try {
      const r = await setOrderStage(String(o.id), to)
      // The refusal sentence is the SERVER's — it names which stages would be skipped, or
      // why this role may not go there. Rewriting it here would lose that.
      if (r.error) { Alert.alert("Not moved", r.error); return }
      await load()
      await loadActivity()
    } catch (e) {
      Alert.alert("Not moved", e instanceof Error ? e.message : "Try again.")
    } finally {
      setMoving(false)
    }
  }, [o, load, loadActivity])

  /**
   * PRINT THE LABEL — the system print sheet, on the phone in your hand.
   *
   * This opened the carrier's PDF in the browser and left the human to find Share → Print.
   * It now goes through expo-print (see lib/print-label.ts, which documents exactly what a
   * resolved print means on each platform, because it is weaker on Android).
   *
   * The stamp moved to AFTER the print, not after the file opened. On iOS that makes
   * `label_printed_at` true: dismissing the print sheet rejects, and nothing is stamped.
   *
   * The browser is still here as the FALLBACK, because a phone with no printer set up is a
   * normal state on a factory floor and the label still has to be reachable — but it is now
   * something offered when printing failed, not the whole feature. A `data:` label has no
   * address to open, so it is not offered for one.
   */
  const printLabel = useCallback(async () => {
    if (!o?.tracking_label_url) return
    setPrinting(true)
    try {
      await printOrderLabel(String(o.id))
      const r = await markLabelPrinted(String(o.id))
      if (r.error) Alert.alert("Sent to the printer", `Not stamped as printed: ${r.error}`)
      else await load()
    } catch (e) {
      if (printWasCancelled(e)) return
      const msg = e instanceof Error ? e.message : "Try again."
      const url = o.tracking_label_url
      const openable = /^https?:\/\//i.test(String(url))
      Alert.alert(
        "Couldn't print the label",
        openable ? `${msg}\n\nYou can still open the PDF and print it from there.` : msg,
        openable
          ? [{ text: "Cancel", style: "cancel" }, { text: "Open the PDF", onPress: () => Linking.openURL(String(url)) }]
          : [{ text: "OK" }],
      )
    } finally { setPrinting(false) }
  }, [o, load])

  const code = o?.tracking ?? null
  const link = trackingLink(o?.carrier, code)
  const stage = normalizeStage(o?.factory_status)
  /* The header is the INK block, so the pill takes the on-ink pair. */
  const tone = toneOnInk(stage)
  const staff = !!me?.role && me.role !== "seller"
  const to = o ? nextStage(o) : null
  const items = o?.items ?? []
  const late = o ? isOverdue(o) : false
  /**
   * HOW BIG THIS ORDER IS, in the words anyone would use.
   *
   * It read "1 line · 1 pc" in the header and "1 · 1 pc" beside ITEMS — two numbers that
   * are the same number on most orders, one of them unlabelled, and "pc" abbreviating a
   * word that was already short. Lines and pieces only differ when a line carries a
   * quantity, and the count that answers "how much is in the box" is the pieces: two
   * lines of one and one line of two are both two things to make.
   */
  const itemCount = o ? units(o) : 0
  const sizeText = `${itemCount} ${itemCount === 1 ? "item" : "items"}`

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Pressable
        onPress={() => router.back()}
        style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 10 }}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={22} color={C.primary} />
        <Text style={{ color: C.primary, fontSize: 16, fontFamily: F.medium }}>Orders</Text>
      </Pressable>

      {!o && !err ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : err ? (
        <Text style={{ color: C.alert, fontSize: 14, paddingHorizontal: 20, marginTop: 12 }}>{err}</Text>
      ) : o ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.primary} />}
        >
          {/* ── THE JOB, in one block ──────────────────────────────────────────── */}
          <View style={{ backgroundColor: C.ink, borderRadius: R.xl, padding: 22, ...LIFT }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 12, fontFamily: F.bold, color: C.lime, letterSpacing: 1.4 }}>
                {platformOf(o).toUpperCase()}
              </Text>
              {o.rush && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, backgroundColor: C.warn }}>
                  <Text style={{ fontSize: 10, fontFamily: F.bold, color: "#fff", letterSpacing: 0.6 }}>RUSH</Text>
                </View>
              )}
              {late && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, backgroundColor: C.alert }}>
                  <Text style={{ fontSize: 10, fontFamily: F.bold, color: "#fff", letterSpacing: 0.6 }}>LATE</Text>
                </View>
              )}
            </View>

            <Text selectable style={{ fontSize: 42, fontFamily: F.bold, color: C.onInk, letterSpacing: -1.6, marginTop: 6 }}>
              {numOf(o)}
            </Text>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
              <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill, backgroundColor: tone.bg }}>
                <Text style={{ fontSize: 11, fontFamily: F.bold, color: tone.fg, letterSpacing: 0.6 }}>
                  {(STAGE_LABEL[stage] ?? stage).toUpperCase()}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: C.onInk, opacity: 0.65 }}>
                {sizeText}
                {o.total != null ? ` · $${(Number(o.total) || 0).toFixed(2)}` : ""}
              </Text>
            </View>
          </View>

          {/* ── THE ONE THING TO PRESS ─────────────────────────────────────────────
              Directly under the job and nowhere else. Which button it is depends on where
              the order stands: everything before production is a move, production itself
              ends in a shipment, and a shipped order has nothing to press at all. */}
          {staff && (
            stage === "working" ? (
              <ConfirmShipment orderId={String(o.id)} role={me?.role} by={me?.name ?? undefined} onDone={refresh} />
            ) : to ? (
              /*
               * ONE BUTTON, ONE SENTENCE. It was a 40pt circular icon tile, a title, a
               * subtitle and a trailing arrow — four elements to say "Start Order", with
               * two of them arrows pointing at each other. The biggest thing on the screen
               * should be the words, not the furniture around them.
               */
              <Pressable
                onPress={advance}
                disabled={moving}
                style={({ pressed }) => ({
                  ...HERO_BUTTON,
                  marginTop: 12, backgroundColor: C.primary,
                  opacity: pressed || moving ? 0.8 : 1,
                })}
              >
                {/* THE PLAY MARK, and only on Start. It is the one glyph here that is not a
                    picture of the word next to it — starting has a universal mark and
                    "Approve" does not, which is why the arrow came off that one. */}
                {moving
                  ? <ActivityIndicator color={C.onPrimary} />
                  : to === "working"
                    ? <Ionicons name="play" size={HERO_GLYPH} color={C.onPrimary} />
                    : null}
                <Text style={{ ...HERO_LABEL, color: C.onPrimary }}>
                  {stageAction(to)}
                </Text>
              </Pressable>
            ) : stage === "" ? (
              /* NOT A MISSING BUTTON — a move that is not ours to make. The seller submits
                 and is charged, and only then does this become Pending for the floor to
                 approve. Saying so beats an empty space where a control usually sits. */
              <View style={{
                ...SECTION,
              }}>
                <Text style={{ fontSize: 15, fontFamily: F.semi, color: C.fg }}>
                  Waiting on the seller
                </Text>
                <Text style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
                  Nothing to approve until they submit and pay for it.
                </Text>
              </View>
            ) : null
          )}

          {/* THE WORK TICKET IS GONE. It drew the ORDER NUMBER as Code-128 on the
              reasoning that the handset becomes the ticket for the parcel in the other
              hand — but nothing in this system scans an order number. The only scanner is
              the Scan tab, which posts to /api/inventory/scan, and that route resolves a
              SKU: an order number returns "Unknown SKU: 4149084185". So it was a barcode
              whose only possible outcome was an error, printed under a heading for a
              concept the floor does not have. */}

          {/*
            * WHO IT IS FOR, AND WHERE IT GOES.
            *
            * The screen said what to make and never once said who for. Anyone packing is
            * about to write this on a box, and it is also the thing a label is bought
            * against — so it belongs on the order, not only inside the buy flow.
            *
            * A null address on a marketplace order is Etsy's app-tier PII gate and NOT our
            * bug, so it says so rather than rendering an empty card that reads as a failed
            * fetch. A seller sees a masked version (city and state), which is a permission.
            */}
          <Section title="DELIVER TO" />
          <View style={{
            ...SECTION,
          }}>
            {addressLines(o.address).length > 0 ? (
              <>
                {addressLines(o.address).map((l, i) => (
                  <Text
                    key={i}
                    selectable
                    style={{
                      fontSize: i === 0 ? 17 : 15,
                      fontWeight: i === 0 ? "800" : "400",
                      color: i === 0 ? C.fg : C.muted,
                      letterSpacing: i === 0 ? -0.3 : 0,
                    }}
                  >
                    {l}
                  </Text>
                ))}
                {o.address?.masked && (
                  <Text style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>
                    Only staff can see the full address.
                  </Text>
                )}
              </>
            ) : (
              <>
                <Text style={{ fontSize: 15, fontFamily: F.semi, color: C.fg }}>
                  {o.customer?.name || "No name on this order"}
                </Text>
                <Text style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
                  No delivery address yet. On an Etsy order this is their app-tier privacy
                  gate, not a sync failure.
                </Text>
              </>
            )}
          </View>

          {/* ── TRACKING ───────────────────────────────────────────────────────── */}
          <Section title="SHIPPING" />
          <View style={{
            ...SECTION,
          }}>
            {code ? (
              <>
                <Text selectable style={{ fontSize: 20, fontFamily: F.bold, color: C.fg, letterSpacing: -0.4 }}>{code}</Text>
                <Text style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>
                  {[o.carrier ? String(o.carrier).toUpperCase() : null, o.label_printed_at ? "label printed" : null]
                    .filter(Boolean).join(" · ") || "Carrier unknown"}
                </Text>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  {link && (
                    <Pressable
                      onPress={() => Linking.openURL(link)}
                      style={({ pressed }) => ({
                        flex: 1, height: 46, borderRadius: R.md, flexDirection: "row", gap: 8,
                        alignItems: "center", justifyContent: "center",
                        backgroundColor: C.primary, opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <Text style={{ color: C.onPrimary, fontFamily: F.bold, fontSize: 15 }}>Track</Text>
                    </Pressable>
                  )}
                  {/* Staff only, and only when there is a PDF: the server nulls the label
                      URL for a seller because the buyer's full address is printed on it. */}
                  {o.tracking_label_url ? (
                    <Pressable
                      onPress={printLabel}
                      disabled={printing}
                      style={({ pressed }) => ({
                        flex: 1, height: 46, borderRadius: R.md, flexDirection: "row", gap: 8,
                        alignItems: "center", justifyContent: "center",
                        borderWidth: 1.5, borderColor: C.ink, opacity: pressed || printing ? 0.6 : 1,
                      })}
                    >
                      {printing && <ActivityIndicator color={C.ink} />}
                      <Text style={{ color: C.ink, fontFamily: F.bold, fontSize: 15 }}>Print label</Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : (
              /* Not shipped is a FACT, not a blank. An empty panel here would be
                 indistinguishable from a screen that failed to load it. */
              /* NOT A DEAD END ANY MORE. This said "Not shipped yet — no tracking number"
                 and stopped, on the one screen where somebody is standing over the packed
                 parcel. The server refuses a ship it has no label for, so that sentence was
                 also the reason the Confirm-shipment button below would fail — it just
                 didn't say so, and it offered nothing to do about it. */
              <View style={{ gap: 12 }}>
                {/* A LABEL WITHOUT A TRACKING NUMBER IS STILL A LABEL. Print lived inside
                    the `code` branch, so a buy that came back with a PDF and no tracking —
                    which happens — left the file unreachable and offered to buy a second
                    one. The PDF's own presence is the condition, not the tracking. */}
                <Text style={{ fontSize: 15, color: C.muted }}>
                  {o.tracking_label_url
                    ? "Label bought — not shipped yet."
                    : "Not shipped yet — no tracking number."}
                </Text>
                {o.tracking_label_url ? (
                  <Pressable
                    onPress={printLabel}
                    disabled={printing}
                    style={({ pressed }) => ({
                      height: 46, borderRadius: R.md, flexDirection: "row", gap: 8,
                      alignItems: "center", justifyContent: "center",
                      borderWidth: 1.5, borderColor: C.ink, opacity: pressed || printing ? 0.6 : 1,
                    })}
                  >
                    {printing && <ActivityIndicator color={C.ink} />}
                    <Text style={{ color: C.ink, fontFamily: F.bold, fontSize: 15 }}>Print label</Text>
                  </Pressable>
                ) : staff ? (
                  <BuyLabel order={o} onDone={refresh} />
                ) : null}
              </View>
            )}
          </View>

          {/* ── THE LINES ──────────────────────────────────────────────────────────
              Each with its own artwork, its own files and its own button. This is the
              screen's centre of gravity: an order is not a piece count. */}
          <Section title="ITEMS" right={sizeText} />
          {items.length === 0 ? (
            <Text style={{ fontSize: 15, color: C.muted, paddingVertical: 12 }}>This order has no lines on it.</Text>
          ) : (
            items.map((it, i) => (
              <OrderLine
                key={it.line_id || it.id || `${it.sku}-${i}`}
                orderId={String(o.id)}
                order={o}
                item={it}
                index={i}
                designs={designs}
                canWork={staff}
                onChanged={refresh}
              />
            ))
          )}

          <Section title="DETAILS" />
          <View style={{
            ...SECTION, paddingBottom: 2,
          }}>
            {o.status ? <Row label="Status" value={String(o.status)} /> : null}
            {o.ship_by ? <Row label="Ship by" value={new Date(o.ship_by).toLocaleDateString()} /> : null}
            {o.created_at ? <Row label="Placed" value={new Date(o.created_at).toLocaleDateString()} /> : null}
            {o.total != null ? <Row label="Total" value={`$${(Number(o.total) || 0).toFixed(2)}`} /> : null}
            <Row label="Order id" value={String(o.id)} />
          </View>

          <Section title="ACTIVITY" />
          <View style={{
            ...SECTION, paddingBottom: 4,
          }}>
            {activity === null
              ? <ActivityIndicator style={{ marginVertical: 16 }} color={C.primary} />
              : activity.length === 0
                ? <Text style={{ fontSize: 15, color: C.muted, paddingVertical: 14 }}>Nothing logged yet.</Text>
                : activity.slice().reverse().map((e) => <ActivityRow key={String(e.id)} e={e} />)}
          </View>
        </ScrollView>
      ) : null}
    </View>
  )
}
