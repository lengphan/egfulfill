import { useCallback, useEffect, useState } from "react"
import { View, Text, FlatList, RefreshControl, ActivityIndicator, Pressable } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { getWallet, getMe, type User, type WalletResponse, type LedgerRow } from "@/lib/api"
import { router, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { TAB_BAR,CARD,F,C, R } from "@/lib/theme"
import { useCountUp, useReducedMotion } from "@/lib/motion"
import { TopupApprovals } from "@/components/topup-approvals"

/**
 * WALLET — the balance, what moved it, and the way to add more.
 *
 * `low` comes from the SERVER, which owns the threshold. A client picking its own number is
 * how one screen warns while another stays quiet about the same balance.
 */
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

/** node-pg hands numerics back as strings; a ledger that renders "12.00" + "3.00" as text
 *  would sort and sign wrongly, so every row is coerced once, here. */
const delta = (r: LedgerRow) => Number(r.delta) || 0

export default function Wallet() {
  const insets = useSafeAreaInsets()
  const [w, setW] = useState<WalletResponse | null>(null)
  const reduced = useReducedMotion()
  /* The balance is the number people check most, so it is the one worth watching arrive.
     Counting from the previous value rather than zero: 120 -> 130 should tick up ten, not
     collapse and climb back. */
  const shownBalance = useCountUp(Number(w?.balance ?? 0), reduced)

  const [err, setErr] = useState<string | null>(null)
  const [me, setMe] = useState<User | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try { setW(await getWallet()); setErr(null); getMe().then(setMe).catch(() => {}) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load your wallet.") }
  }, [])
  /**
   * REFETCH WHEN THE SCREEN COMES BACK.
   *
   * These tabs loaded once on mount and never again, so returning from an action showed
   * the numbers from before it: submit an order, come back to Wallet, and the balance is
   * the old one until you pull to refresh. A tab bar makes that constant — you leave and
   * return to these screens dozens of times an hour, and every arrival was stale.
   *
   * useFocusEffect, not an interval: the trigger is arriving at the screen, which is
   * exactly when a person is about to read it. Polling would fetch while nobody is
   * looking and still be stale at the moment they arrive.
   */
  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false)
  }, [load])

  /* Staff ROLE plus an empty ledger. Not a zero balance: a seller who has spent down to
     nothing must still see their zero, their history and their way to add more. */
  const staff = !!me?.role && me.role !== "seller"
  /**
   * WHO MAY CONFIRM MONEY ARRIVED — admin and warehouse, exactly as the web has it
   * (`canReview` in web/components/app/wallet-dashboard.tsx). They share the factory
   * wallet; an operator or a designer does not.
   *
   * This said "any staff", which is what the SERVER allows (topups.js gates on isStaff) —
   * but the web is canonical, and the phone offering an operator a queue of bank transfers
   * to confirm is the phone inventing a permission the boards don't grant.
   */
  const canReview = me?.role === "admin" || me?.role === "warehouse"
  const noWallet = staff && !!w && (w.ledger ?? []).length === 0 && Number(w.balance ?? 0) === 0

  if (w === null && !err) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.primary} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 20 }}>
        <Text style={{ fontSize: 32, fontFamily: F.display, color: C.fg, marginTop: 8, letterSpacing: -0.8 }}>{noWallet && canReview ? "Top-ups" : "Wallet"}</Text>

        {/* A BALANCE IS READ OFTEN, so it is a quiet card rather than a coloured block —
            and "low" is a chip, not a repaint. Turning the whole panel red made a working
            wallet look broken, and left no louder state for something that IS broken. */}
        {/**
          * A STAFF ACCOUNT HAS NO SELLER WALLET, and $0.00 is the wrong way to say so.
          *
          * /api/wallet answers for the signed-in account, and only sellers (and team
          * members, who resolve to their owner) have one. An operator or admin therefore
          * saw a balance of zero above an "Add funds" button — indistinguishable from a
          * seller whose money has gone, and offering to top up an account that will never
          * be charged for anything.
          *
          * The test is a staff ROLE with an empty ledger, not a zero balance: a seller who
          * has genuinely spent down to nothing must still see their zero, their history and
          * their way to add more.
          */}
        {/* AND WHAT STAFF GET INSTEAD.
            "No wallet on this account" was true and it was the whole screen — a tab that
            exists to tell you it has nothing for you. The work that genuinely belongs on
            this tab is the queue of sellers waiting to be told their money landed, which is
            the one job where standing at a desk is the only thing between a seller and
            being able to trade. Staff see approvals here; sellers see their own wallet. */}
        {/*
          * THE BALANCE IS THE SCREEN, not a card on it.
          *
          * It was 46pt inside a white box because the page was a tinted grey and a box was
          * the only way to make one number read as an object. It does not need one: type at
          * 62 with air around it IS the object, and the card was a frame around the only
          * thing anybody opens this screen to see.
          *
          * The figure counts up for the same reason the dashboard tiles do — money that
          * arrives says it was fetched, and this is the number people check most.
          */}
        {noWallet ? null : (
        <View style={{ marginTop: 22 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ color: C.muted, fontSize: 11.5, fontFamily: F.semi, letterSpacing: 1.4 }}>BALANCE</Text>
            {w?.low && (
              <View style={{ paddingHorizontal: 10, height: 24, borderRadius: R.badge, justifyContent: "center", backgroundColor: C.warnTint }}>
                <Text style={{ fontSize: 11, fontFamily: F.bold, color: C.warn }}>
                  LOW{w.lowBelow != null ? ` · UNDER ${money(w.lowBelow)}` : ""}
                </Text>
              </View>
            )}
          </View>
          {/* THE PLACEHOLDER IS MUTED. An em-dash at this size in solid white is a bar, which
              reads as a redaction rather than as "not known" — and on a BALANCE that is the
              worst possible misreading. */}
          <Text style={{
            color: err ? C.muted : C.fg,
            fontSize: 62, fontFamily: F.bold, letterSpacing: -2.4, marginTop: 6,
          }}>
            {err ? "—" : money(shownBalance)}
          </Text>
        </View>
        )}

        {!noWallet && (
        <Pressable
          onPress={() => router.push("/topup")}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            marginTop: 18, height: 54, borderRadius: R.pill, backgroundColor: C.ink,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="add" size={20} color={C.onInk} />
          {/* The one action on the screen, so it is filled rather than outlined. Acid was
              tried here and is wrong on white: the kit measures it at 1.1:1 and forbids it
              off the plate, which is exactly this case. */}
          <Text style={{ color: C.onInk, fontFamily: F.bold, fontSize: 16 }}>Add funds</Text>
        </Pressable>
        )}

        {err && <Text style={{ color: C.alert, fontSize: 14, marginTop: 16 }}>{err}</Text>}

        {!noWallet && (
          <Text style={{ fontSize: 11.5, fontFamily: F.semi, color: C.muted, letterSpacing: 1.4, marginTop: 26 }}>
            RECENT
          </Text>
        )}
      </View>

      {noWallet && canReview ? <TopupApprovals bottomInset={insets.bottom} /> : noWallet ? (
        /* Staff with no seller wallet AND no business confirming transfers. Says which of
           the two it is rather than showing an empty ledger, which reads as a failed load. */
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <Text style={{ fontSize: 15, fontFamily: F.semi, color: C.fg }}>No wallet on this account</Text>
          <Text style={{ fontSize: 14, color: C.muted, marginTop: 4, lineHeight: 20 }}>
            Only a seller account carries a balance. Confirming a seller&apos;s top-up is
            admin or warehouse.
          </Text>
        </View>
      ) : (
      <FlatList
        data={w?.ledger ?? []}
        keyExtractor={(r) => String(r.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + TAB_BAR.clearance }}
        ListEmptyComponent={
          /* THE FOUR PARTS (CLAUDE.md §4): a mark, a line, a note, a way out. One grey
             sentence in a screen's worth of empty space was the "looks dead" complaint in
             miniature — and a 20pt stroke floating in whitespace is decoration the eye reads
             past, while the same glyph on a filled tile is an object it lands on.
             The way out is the Add funds button already above this, so there is no second
             button here: two routes to one end need a word between them or the first reads
             as the thing you were supposed to press. */
          <View style={{ alignItems: "center", paddingTop: 44, paddingHorizontal: 24 }}>
            <View style={{
              width: 46, height: 46, borderRadius: R.control, alignItems: "center", justifyContent: "center",
              backgroundColor: err ? C.alert : C.accent,
            }}>
              <Ionicons name={err ? "alert" : "swap-vertical"} size={22} color={err ? "#fff" : C.fg} />
            </View>
            <Text style={{ color: C.fg, fontSize: 15, fontFamily: F.semi, marginTop: 14 }}>
              {err ? "Couldn't load your history" : "Nothing has moved yet"}
            </Text>
            {/* An empty region may carry one sentence, because there is nothing else to read.
                A populated screen may not — see the same rule in §4. */}
            <Text style={{ color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 5, textAlign: "center", maxWidth: 260 }}>
              {err
                ? "The balance above is still correct — only the list failed."
                : "Every charge and top-up will show up here, newest first."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const d = delta(item)
          return (
            <View style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
              paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
            }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: F.medium, color: C.fg }}>
                  {item.note || item.type}
                </Text>
                <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Text style={{ fontSize: 15, fontFamily: F.bold, color: C.fg }}>
                {d < 0 ? "−" : "+"}{money(Math.abs(d))}
              </Text>
            </View>
          )
        }}
      />
      )}
    </View>
  )
}
