"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Package, Headset, ChatCircle, Warning } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { getNotifications, markNotificationsRead, type Notification } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { onLive } from "@/lib/live"

const ago = (s: string) => {
  const t = new Date(s).getTime()
  if (isNaN(t)) return ""
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const ICON: Record<string, React.ReactNode> = {
  "order-new": <Package size={13} weight="fill" />,
  "support-message": <Headset size={13} weight="fill" />,
  "order-message": <ChatCircle size={13} weight="fill" />,
}

// A short chime, synthesized rather than shipped as an audio file — no asset to
// download, and it matches the scan-station beep approach.
let audioCtx: AudioContext | null = null
function chime() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = audioCtx || new Ctor()
    const ctx = audioCtx
    const play = () => {
      // Two quick notes — distinct from the scanner's single beep.
      ;[880, 1170].forEach((f, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = "sine"; osc.frequency.value = f
        const t0 = ctx.currentTime + i * 0.09
        gain.gain.setValueAtTime(0.0001, t0)
        gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12)
        osc.start(t0); osc.stop(t0 + 0.13)
      })
    }
    if (ctx.state === "suspended") ctx.resume().then(play).catch(() => {})
    else play()
  } catch {}
}

export function NotificationBell() {
  const router = useRouter()
  // The notifications PAGE marks things read too — listen so the badge follows.
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const prevUnread = useRef(0)
  const soundOn = useRef(true)

  const load = useCallback((withSound = false) => {
    if (!getToken()) return
    getNotifications(20)
      .then((r) => {
        setItems(r.notifications ?? [])
        setUnread(r.unread ?? 0)
        // Only chime on a genuine increase — never on first load, or the app would
        // ding every time you open a tab.
        if (withSound && soundOn.current && r.unread > prevUnread.current && prevUnread.current !== -1) chime()
        prevUnread.current = r.unread ?? 0
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    prevUnread.current = -1 // suppress the chime for the very first load
    const id = setTimeout(() => {
      soundOn.current = getUser()?.notify_sound !== false
      load(false)
    }, 0)
    // The /notifications page marks things read as well. Without this the badge kept
    // its old count until the next poll, so the page said "0 unread" while the bell
    // still showed a number.
    const sync = () => load(false)
    window.addEventListener("eg-notifications-changed", sync)
    return () => { clearTimeout(id); window.removeEventListener("eg-notifications-changed", sync) }
  }, [load])

  // Keep the sound pref live when it's toggled in Settings.
  useEffect(() => {
    const sync = () => { soundOn.current = getUser()?.notify_sound !== false }
    window.addEventListener("eg-user-changed", sync)
    return () => window.removeEventListener("eg-user-changed", sync)
  }, [])

  // Live push over the shared SSE hub (lib/live.ts). This used to open its own
  // EventSource; every consumer doing that burns a connection from the browser's ~6 per
  // host, held open for the whole session, on streams carrying identical data.
  //
  // Notification events are addressed server-side to the recipients' own sockets, so
  // simply receiving one means it's ours — the old client-side recipient filter was never
  // a security boundary anyway. The hub's reconnect/poll fallback replaces the local one.
  useEffect(() => onLive("notification", () => load(true)), [load])

  const open = async (n: Notification) => {
    setUnread((u) => Math.max(0, u - (n.read_at ? 0 : 1)))
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
    markNotificationsRead(n.id).catch(() => {})
    if (n.href) router.push(n.href)
  }
  const readAll = async () => {
    setUnread(0)
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })))
    markNotificationsRead().catch(() => {})
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}
        className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full border-2 border-card bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && <button onClick={readAll} className="text-xs text-muted-foreground hover:text-foreground">Mark all read</button>}
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-10 text-center text-muted-foreground">
            <Bell size={20} weight="duotone" />
            <span className="text-xs">Nothing yet — you&apos;re all caught up.</span>
          </div>
        ) : (
          <div className="max-h-96 divide-y divide-border overflow-auto">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => open(n)}
                className={"flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent " + (n.read_at ? "" : "bg-primary/[0.04]")}
              >
                <span className={"mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md " + (n.read_at ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                  {ICON[n.type] ?? <Warning size={13} weight="fill" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={"block truncate text-sm " + (n.read_at ? "" : "font-semibold")}>{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                </span>
                <span className="shrink-0 text-3xs text-muted-foreground">{ago(n.created_at)}</span>
              </button>
            ))}
          </div>
        )}
        {/* The dropdown truncates every body to one line — fine for a nudge, useless for
            anything you need to read or act on later. This is the way to the full
            channel, and it's always offered, including when the dropdown is empty:
            "nothing recent" and "nothing ever" are different questions. */}
        <button
          onClick={() => router.push("/notifications")}
          className="w-full border-t border-border px-3 py-2 text-center text-xs font-medium text-primary hover:bg-accent"
        >
          See all notifications
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
