"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Pagination } from "@/components/app/pagination"
import { getNotifications, markNotificationsRead, type Notification } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { EmptyState } from "@/components/app/empty-state"

const PER_PAGE = 25

/** Relative for anything recent, absolute once it stops being "ago". */
function when(iso: string) {
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return ""
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))}d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** Type → a human label. Unknown types fall back to the raw string rather than being
 *  hidden, so a newly-added notification kind is never silently unlabelled. */
const TYPE_LABEL: Record<string, string> = {
  "team-invite": "Team",
  "price-changed": "Pricing",
  "billing-renewed": "Billing",
  "billing-past-due": "Billing",
  "billing-downgraded": "Billing",
  announcement: "Announcement",
}

/**
 * One notification channel per account — the full record behind the bell.
 *
 * The bell shows the newest few and truncates the body, which is fine for a nudge and
 * useless for anything you need to act on or refer back to. This is the same feed,
 * paged, filterable and readable in full.
 *
 * Deliberately NOT per-role tables: notifications are already addressed per user, and
 * notify({ roles: [...] }) fans a message out to everyone in a role. So each role's
 * board reads its own channel here with no extra plumbing, and an announcement to
 * "all sellers" is the same mechanism as a price alert to admins.
 */
export function NotificationsView() {
  const tl = useLabelT()
  const router = useRouter()
  const [items, setItems] = useState<Notification[] | null>(null)
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [page, setPage] = useState(1)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!getToken()) { setItems([]); return }
    getNotifications(PER_PAGE, { offset: (page - 1) * PER_PAGE, unreadOnly })
      .then((r) => { setItems(r.notifications ?? []); setTotal(r.total ?? 0); setUnread(r.unread ?? 0) })
      .catch(() => setItems([]))
  }, [page, unreadOnly])

  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  const openOne = async (n: Notification) => {
    if (!n.read_at) {
      // Optimistic: the row should stop looking unread the moment you act on it.
      setItems((prev) => (prev ?? []).map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
      setUnread((u) => Math.max(0, u - 1))
      markNotificationsRead(n.id).catch(() => load())
      window.dispatchEvent(new CustomEvent("eg-notifications-changed"))
    }
    if (n.href) router.push(n.href)
  }

  const readAll = async () => {
    setBusy(true)
    try {
      await markNotificationsRead()
      window.dispatchEvent(new CustomEvent("eg-notifications-changed"))
      load()
    } finally { setBusy(false) }
  }

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <SectionCard
      title={tl("notifications", "Notifications")}
      actions={
        <div className="flex items-center gap-2">
          {/* A FILTER, so it looks like a field — .eg-control, same edge and radius as an
              Input, normal weight, no fill. It was a rounded-full capsule that went solid
              black when on, which is a primary BUTTON's shape and a primary button's fill:
              two controls side by side, one saying "set this" and one saying "do this", and
              nothing about either told you which. rounded-full is reserved for things that
              are genuinely round — the count badge two elements away is one. */}
          <select
            value={unreadOnly ? "unread" : "all"}
            onChange={(e) => { setUnreadOnly(e.target.value === "unread"); setPage(1) }}
            aria-label={tl("notifications", "Which notifications to show")}
            className="eg-control h-8 text-xs"
          >
            <option value="all">{tl("notifications", "All")}</option>
            <option value="unread">{tl("notifications", "Unread only")}</option>
          </select>
          {unread > 0 && (
            <Button size="sm" variant="outline" onClick={readAll} disabled={busy}>
              Mark all read ({unread})
            </Button>
          )}
        </div>
      }
    >
      {items === null ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={unreadOnly ? "Nothing unread" : "No notifications yet"}
          note={unreadOnly
            ? "Everything here has been read."
            : "Order updates, team invites and announcements for this account appear here."}
        />
      ) : (
        <div className="divide-y divide-border">
          {items.map((n) => (
            <button
              key={String(n.id)}
              onClick={() => openOne(n)}
              className={"flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50 " +
                (n.read_at ? "" : "bg-pop/10")}
            >
              {/* Unread dot rather than bold-everything: the eye finds one mark faster
                  than it compares two weights down a column.
                  THE ACCENT. --pop is the only colour in a chroma-0 grey system and it holds
                  exactly one meaning — this is new, and it is for you. Nothing else takes
                  it. It was ink, which is what everything else on the page already is. */}
              <span className={"mt-1.5 size-2 shrink-0 rounded-full " + (n.read_at ? "bg-transparent" : "bg-pop")} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{n.title}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 eg-label text-muted-foreground">
                    {TYPE_LABEL[n.type] ?? n.type}
                  </span>
                </span>
                {/* Full body, not truncated — this page exists because the bell truncates. */}
                {n.body && <span className="mt-0.5 block whitespace-pre-wrap text-sm text-muted-foreground">{n.body}</span>}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {when(n.created_at)}
                  {n.href ? tl("notifications", " · opens the related page") : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {total > PER_PAGE && (
        <Pagination
          page={page} pageCount={pageCount} perPage={PER_PAGE} total={total}
          start={(page - 1) * PER_PAGE}
          onPage={setPage} onPerPage={() => {}} perPageOptions={[PER_PAGE]}
        />
      )}
    </SectionCard>
  )
}
