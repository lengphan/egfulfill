import { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, FlatList, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router, useLocalSearchParams, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getOrders, setOrderStage, getMe, type Order, type User } from "@/lib/api"
import { isOpen, isOverdue, numOf, plainNum, nextStage, lineTitle, normalizeStage, STAGE_LABEL, STAGE_VERB, canSetStage, isFactoryOrder } from "@/lib/orders"
import { TAB_BAR,F,C, R, LIFT } from "@/lib/theme"
import { OrderRow } from "@/components/order-row"

/**
 * ORDERS — a searchable list, and the way into one order.
 *
 * FlatList rather than a ScrollView of rows: this list is the length of the floor (237 open
 * on the day it was built), and mounting every row is how a phone list starts dropping
 * frames. It virtualises.
 *
 * Numbers and stage words come from lib/orders, the same rules Today counts with, so a row
 * here cannot describe an order differently from the tile that led you to it.
 *
 * SELECTION is the second thing this screen gained. Twelve orders that all need starting is
 * twelve trips into a detail screen and back, which is the point at which someone stops
 * using the phone and walks to a desk. Long-press opens selection, tap adds, and one press
 * moves them all — each to ITS OWN next stage, since a selection is rarely all at one point
 * in the pipeline.
 */
/* The urgency lenses. They head the single filter row; the stages follow them. */
const LENSES = ["Open", "Late", "All"] as const
const FILTERS = LENSES
/** The stage chips, in pipeline order — the ladder read left to right, exceptions last,
 *  so the row is the floor's own sequence rather than whatever order the data arrived in. */
const STAGE_ORDER = ["", "in_review", "approved", "working", "shipped", "on_hold", "cancelled", "refunded"] as const
type Filter = (typeof FILTERS)[number]

export default function Orders() {
  const insets = useSafeAreaInsets()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  /**
   * OPENED FROM TODAY, with the question already asked.
   *
   * The tiles on Today were four counts that did nothing. They each name a slice this
   * screen can already show, so they now arrive as params rather than as a new screen —
   * "Overdue" is this queue with the Late lens on, "In production" is this queue at
   * Working. Read once as the INITIAL state, not held in sync: after landing, the chips
   * are the user's, and re-imposing the param on every render would fight every tap.
   */
  const params = useLocalSearchParams<{ lens?: string; stage?: string }>()
  const [filter, setFilter] = useState<Filter>(
    () => (FILTERS as readonly string[]).includes(String(params.lens)) ? (params.lens as Filter) : "Open",
  )
  /** null = every stage. A chosen stage narrows the lens above it. */
  const [stage, setStage] = useState<string | null>(() => (params.stage ? String(params.stage) : null))
  const [search, setSearch] = useState("")
  const [me, setMe] = useState<User | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [selecting, setSelecting] = useState(false)
  const [moving, setMoving] = useState(false)

  const load = useCallback(async () => {
    try { setOrders(await getOrders()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load orders.") }
  }, [])
  /* The queue is the screen people leave and come back to most — after moving an order,
     after buying a label, after the designer. Arriving at a list that still shows the
     state you just changed is the one thing a queue must not do. */
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)) }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false)
  }, [load])

  const all = useMemo(() => orders ?? [], [orders])
  const counts = useMemo(() => ({
    Open: all.filter(isOpen).length,
    Late: all.filter(isOverdue).length,
    All: all.length,
  }), [all])

  /**
   * WHICH STAGE — the filter that was missing entirely.
   *
   * Open / Late / All is a lens on urgency, not on status: there was no way to ask "show me
   * what is waiting to be approved" or "show me today's shipped", which is most of what
   * anyone opens a queue for. It NARROWS the lens rather than replacing it, so Open + Working
   * means the working orders that are still open, which is what picking both plainly implies.
   *
   * Only stages that are actually present get a chip. A row of eight, six of them reading
   * zero, is a filter that mostly advertises what the floor is not doing.
   */
  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of all) { const k = normalizeStage(o.factory_status); m[k] = (m[k] ?? 0) + 1 }
    return m
  }, [all])
  const stageChips = useMemo(
    () => STAGE_ORDER.filter((k) => (stageCounts[k] ?? 0) > 0),
    [stageCounts],
  )

  const rows = useMemo(() => {
    const byLens = filter === "All" ? all : filter === "Late" ? all.filter(isOverdue) : all.filter(isOpen)
    const byFilter = stage === null ? byLens : byLens.filter((o) => normalizeStage(o.factory_status) === stage)
    const q = search.trim().toLowerCase()
    if (!q) return byFilter
    /*
     * EVERYTHING THAT NAMES AN ORDER, not just its number.
     *
     * A marketplace order's id (`etsy-abc`) is not the number anyone reads (`#4099…`), and on
     * the floor an order is just as often looked up by what is IN it. But the searches people
     * actually run are just as often a PERSON — a buyer chasing their parcel, a seller asking
     * about theirs — or a tracking number read off a label. Those all identify one order and
     * none of them matched, so the box came back "Nothing matches" for a name that is printed
     * on the screen behind it.
     *
     * `seller_name` is staff-only and the server strips it for a seller, so this simply finds
     * nothing extra for them rather than needing a role check here.
     */
    const has = (v: unknown) => String(v ?? "").toLowerCase().includes(q)
    return byFilter.filter((o) =>
      plainNum(String(o.id)).toLowerCase().includes(q)
      || String(o.seq ?? "").includes(q)
      || has(o.id)
      // Who it is for, and who it is from.
      || has(o.customer?.name) || has(o.customer?.email)
      || has((o as { seller_name?: string | null }).seller_name)
      || has((o as { seller_email?: string | null }).seller_email)
      // The name on the parcel, which is not always the account name.
      || has(o.address?.name) || has(o.address?.city)
      // A tracking number read off a label or pasted from a buyer's message.
      || has(o.tracking)
      || (o.items ?? []).some((it) => lineTitle(it).toLowerCase().includes(q)
        || has(it.sku) || has(it.blank)))
  }, [all, filter, stage, search])

  const role = me?.role ?? ""
  const staff = !!role && role !== "seller"
  /**
   * CAN *THIS PERSON* MOVE *THIS ORDER* — the stage AND the role, asked together.
   *
   * It asked only whether a next stage existed, so an operator selecting twelve approved
   * orders got "Start 12" and twelve refusals in a row: the batch walks them one at a time,
   * and every one of them was a move only the warehouse may make. Same gate as the web.
   */
  const canMove = useCallback((o: Order) => {
    const to = nextStage(o)
    return !!to && canSetStage(role, o.factory_status, to, isFactoryOrder(o))
  }, [role])
  const chosen = useMemo(() => rows.filter((o) => picked.includes(o.id)), [rows, picked])
  // Only the ones that can actually move. A selection of shipped orders — or of orders this
  // role may not advance — must not offer a button that would be refused for every one.
  const movable = useMemo(() => chosen.filter(canMove), [chosen, canMove])

  const toggle = useCallback((id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }, [])

  const clearSelection = useCallback(() => { setSelecting(false); setPicked([]) }, [])

  /**
   * Move every selected order ONE step — each to its own next stage.
   *
   * Sequential, not Promise.all: this writes stage changes, reserves stock and can trigger
   * a replenishment per order, and firing twelve of those at a VPS at once is how a batch
   * turns into a timeout that leaves half the selection moved and nobody sure which half.
   *
   * Every refusal is the SERVER's sentence and every one is reported. A batch that says
   * "done" while quietly skipping three orders is worse than no batch at all.
   */
  /* THE SAME MOVE THE BATCH BAR MAKES, for a single order from its own menu. Deliberately
     the same setOrderStage(nextStage(o)) call rather than a second implementation — the
     stage ladder is shared with the server (see lib/factory-status) and two copies of it
     here is how the phone and the floor start disagreeing. */
  const advanceOne = useCallback(async (o: Order) => {
    const to = nextStage(o)
    if (!to) return
    try {
      const r = await setOrderStage(String(o.id), to)
      if (r.error) Alert.alert("Not moved", r.error)
    } catch (e) {
      Alert.alert("Not moved", e instanceof Error ? e.message : "Try again.")
    }
    await load()
  }, [load])

  const advanceSelected = useCallback(async () => {
    if (!movable.length) return
    setMoving(true)
    const failed: string[] = []
    for (const o of movable) {
      const to = nextStage(o)
      if (!to) continue
      try {
        const r = await setOrderStage(String(o.id), to)
        if (r.error) failed.push(`${numOf(o)}: ${r.error}`)
      } catch (e) {
        failed.push(`${numOf(o)}: ${e instanceof Error ? e.message : "failed"}`)
      }
    }
    setMoving(false)
    clearSelection()
    await load()
    if (failed.length) {
      Alert.alert(
        `${movable.length - failed.length} of ${movable.length} moved`,
        failed.slice(0, 6).join("\n\n") + (failed.length > 6 ? `\n\n…and ${failed.length - 6} more.` : ""),
      )
    }
  }, [movable, clearSelection, load])

  // One verb when the batch all agrees, the neutral one when it does not — and the count
  // inside the phrase rather than appended to it ("Start 4", not "Start this line 4").
  const batchStages = new Set(movable.map((o) => nextStage(o)))
  const n = movable.length
  const batchLabel = !n
    ? "Nothing to move"
    : batchStages.size === 1
      ? `${STAGE_VERB[[...batchStages][0] as string] ?? `Move to ${STAGE_LABEL[[...batchStages][0] as string]}`} ${n}`
      : `Move ${n} on`

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          {/* The one DISPLAY moment on the screen — a weight and a size, not a second
              alphabet. It used to be Playfair, on the argument that a high-contrast serif
              earns its place at 34pt; the face is dropped on both front-ends now, so what
              makes this the title is that it is 32pt bold with the tracking pulled in. */}
          <Text style={{ fontSize: 32, fontFamily: F.display, color: C.fg, marginTop: 6, letterSpacing: -0.6 }}>Orders</Text>
          {staff && orders !== null && (
            <Pressable
              onPress={() => (selecting ? clearSelection() : setSelecting(true))}
              hitSlop={10}
              style={{ paddingVertical: 6, paddingHorizontal: 4 }}
            >
              <Text style={{ fontSize: 14.5, fontFamily: F.semi, color: C.primary }}>
                {selecting ? "Done" : "Select"}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={{
          flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12,
          height: 44, borderRadius: 10, paddingHorizontal: 12,
          backgroundColor: C.accentPaper, borderWidth: 0,
        }}>
          <Ionicons name="search" size={17} color={C.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Order, product, SKU, buyer, seller or tracking"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, color: C.fg, fontSize: 15 }}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={C.muted} />
            </Pressable>
          )}
        </View>

        {/*
          * ONE ROW OF FILTERS, not two.
          *
          * There were two: an urgency LENS (Open/Late/All) above a STAGE row, and they
          * combined — Open + Working was a real and useful question. But two tab bars
          * stacked read as two competing controls, and on a phone the second one was mostly
          * scrolled past. Collapsed into a single mutually-exclusive list: the three lenses
          * first, then the stages that actually have something in them.
          *
          * THE TRADE, stated plainly: you can no longer ask "open AND working" in one go —
          * picking a stage now shows every order at that stage. In exchange the control is
          * one thing you read once. If the combination turns out to matter on the floor, the
          * answer is a second axis somewhere deliberate, not a second tab bar.
          */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 20, paddingTop: 14, paddingBottom: 2, paddingRight: 20 }}
        >
          {LENSES.map((f) => {
            const on = stage === null && filter === f
            const n = counts[f]
            const hot = f === "Late" && n > 0
            return (
              <Pressable
                key={f}
                onPress={() => { setFilter(f); setStage(null) }}
                hitSlop={8}
                style={{ paddingBottom: 7 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 15.5, fontFamily: on ? F.semi : F.body, color: on ? C.fg : C.muted }}>{f}</Text>
                  <Text style={{ fontSize: 13, fontFamily: F.medium, color: hot ? C.alert : C.muted, opacity: on ? 1 : 0.75 }}>
                    {orders === null ? "" : n}
                  </Text>
                </View>
                <View style={{
                  position: "absolute", left: 0, right: 0, bottom: 0, height: 2,
                  backgroundColor: on ? C.fg : "transparent",
                }} />
              </Pressable>
            )
          })}

          {stageChips.map((k) => {
            const on = stage === k
            const label = STAGE_LABEL[k] ?? k
            const n = stageCounts[k] ?? 0
            return (
              <Pressable
                key={k}
                /* A stage shows every order AT that stage — it replaces the lens rather than
                   narrowing it, which is what makes one row honest: whatever is underlined
                   is the whole question being asked. */
                onPress={() => { setStage(k); setFilter("All") }}
                hitSlop={8}
                style={{ paddingBottom: 7 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 15.5, fontFamily: on ? F.semi : F.body, color: on ? C.fg : C.muted }}>{label}</Text>
                  <Text style={{ fontSize: 13, fontFamily: F.medium, color: C.muted, opacity: on ? 1 : 0.75 }}>{n}</Text>
                </View>
                <View style={{
                  position: "absolute", left: 0, right: 0, bottom: 0, height: 2,
                  backgroundColor: on ? C.fg : "transparent",
                }} />
              </Pressable>
            )
          })}
        </ScrollView>
      </View>

      {orders === null && !err ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(o) => o.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          /* NO horizontal padding here. The row owns it (18, the same 18 the title, the
             search field and the filters use), so content lines up down the whole screen and
             the hairline runs edge to edge the way a printed rule does. Padding in BOTH
             places is what left the rows sitting 36 in while the header sat at 18. */
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR.clearance + (selecting ? 86 : 0) }}
          ListEmptyComponent={
            /* Says WHICH it is. An empty list that reads the same as a failed one is how a
               broken fetch gets mistaken for a quiet day. */
            <Text style={{ color: err ? C.alert : C.muted, fontSize: 14, marginTop: 24 }}>
              {err ?? (search ? `Nothing matches “${search}”.` : `No ${filter.toLowerCase()} orders.`)}
            </Text>
          }
          renderItem={({ item }) => (
            <OrderRow
              order={item}
              selecting={selecting}
              selected={picked.includes(item.id)}
              onPress={() => (selecting ? toggle(item.id) : router.push(`/order/${encodeURIComponent(item.id)}`))}
              // Long-press opens selection anywhere, with the pressed row already in it —
              // entering a mode and then having to press the same row again is the step
              // everyone forgets to design and everyone notices.
              onLongPress={() => { if (staff) { setSelecting(true); toggle(item.id) } }}
              onAdvance={staff && canMove(item) ? () => advanceOne(item) : undefined}
              advanceLabel={
                staff && canMove(item)
                  ? (STAGE_VERB[nextStage(item) as string] ?? `Move to ${STAGE_LABEL[nextStage(item) as string]}`)
                  : null
              }
            />
          )}
        />
      )}

      {/* THE BATCH BAR. Floats over the list rather than pushing it, so the rows do not
          jump under the thumb at the moment of choosing. */}
      {selecting && (
        <View style={{
          position: "absolute", left: 14, right: 14, bottom: insets.bottom + TAB_BAR.clearance - 4,
          flexDirection: "row", alignItems: "center", gap: 12,
          backgroundColor: C.ink, borderRadius: R.lg, padding: 12, ...LIFT,
        }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 16, fontFamily: F.bold, color: C.onInk }}>
              {picked.length} selected
            </Text>
            <Text style={{ fontSize: 12, color: C.onInk, opacity: 0.6, marginTop: 1 }}>
              {movable.length === picked.length
                ? "Long-press a row to add more"
                : `${picked.length - movable.length} can’t move from where they are`}
            </Text>
          </View>
          <Pressable
            onPress={advanceSelected}
            disabled={moving || !movable.length}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 8,
              paddingHorizontal: 16, height: 44, borderRadius: R.md,
              backgroundColor: movable.length ? C.pop : "#2E2E2E",
              opacity: pressed || moving ? 0.7 : 1,
            })}
          >
            {moving
              ? <ActivityIndicator color={C.ink} />
              : <Ionicons name="arrow-forward" size={16} color={movable.length ? C.onPop : C.muted} />}
            <Text style={{ fontSize: 15, fontFamily: F.bold, color: movable.length ? C.onPop : C.muted }}>
              {batchLabel}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}
