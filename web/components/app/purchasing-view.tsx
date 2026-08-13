"use client"

import { useEffect, useState } from "react"
import { ShoppingCart } from "@phosphor-icons/react"
import { getFactoryList } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { AllSuppliers } from "@/components/app/all-suppliers"
import { FavoritesView } from "@/components/app/favorites-view"
import { PurchaseView } from "@/components/app/purchase-view"
import { AlibabaOrders } from "@/components/app/alibaba-orders"
import { PageTitle } from "@/components/app/page-title"
import { TabLabel } from "@/components/app/tab-label"

type Tab = "all" | "favorites" | "purchase" | "alibaba"

/**
 * `admin` marks a tab that COMMITS COMPANY MONEY. Operators browse the supplier catalogues
 * and build our own catalogue from them; buying stays with admin, which is the same line the
 * server draws (every /api/purchase* route is requireAdmin).
 */
const TABS = [
  { id: "all", label: "All suppliers", admin: false },
  { id: "favorites", label: "Favorites", admin: false },
  // "Cart", because that is what this tab opens on and what the header cart icon points
  // at. It also holds Ongoing and History as its own tabs — see purchase-view.
  { id: "purchase", label: "Cart", admin: true },
  { id: "alibaba", label: "Sample", admin: true },
] as const

/**
 * Purchasing — the one home for buying blanks. Flattened to a SINGLE tab row —
 * All suppliers · Favorites · Cart & orders — instead of a Browse/Cart toggle stacked over
 * a suppliers' All/Favorites toggle. The browse catalogue views and the cart/orders view
 * are peers; their tested logic is untouched, just reparented. `browse` is a legacy ?tab=
 * alias for `all`; switching updates the URL in place.
 *
 * A TAB IS NOT THROWN AWAY WHEN YOU LEAVE IT.
 *
 * Switching used to unmount the whole view, so every toggle started the next one from
 * nothing: `items === null` renders a centred spinner, which collapses the page to a
 * couple of hundred pixels, and a moment later the real content pushes it back out. Going
 * All suppliers → Orders → All suppliers refetched three suppliers' catalogues to show you
 * the same grid you were looking at two seconds earlier — and threw away your search, your
 * scroll and every extra page you'd loaded on the way.
 *
 * So a visited tab stays mounted and is hidden with `display:none`. Nothing re-mounts,
 * nothing re-renders from null, and there is no spinner and no jump on any tab you have
 * already opened.
 *
 * Keeping it mounted DOES mean keeping its data, which would go stale — these tabs act on
 * each other (favourite a blank in All suppliers and it belongs in Favorites; add to cart
 * and it belongs in Orders). So re-showing a tab bumps its `refreshKey` and the view
 * re-reads in the background. Each of their loaders replaces its list in place rather than
 * blanking it first, so the refresh is invisible: you see the old rows until the new ones
 * arrive, which is the point.
 */
export function PurchasingView() {
  // Read once on mount rather than during render: getUser() reads the session store, which
  // isn't there during SSR. Until it resolves nothing admin-only renders, which is the safe
  // direction to be wrong in.
  const [isAdmin, setIsAdmin] = useState(false)
  /** The tabs THIS user can open. Everything below keys off this rather than TABS, so a tab
   *  an operator can't have is neither shown, nor mounted, nor reachable by ?tab=. */
  const tabs = TABS.filter((t) => isAdmin || !t.admin)
  // An operator's landing tab cannot be the cart. Admins keep opening on it — it's the tab
  // the header cart icon points at.
  const [tab, setTab] = useState<Tab>("all")
  /** Every tab ever opened, and how many times it has been RE-shown. The count is the
   *  refresh signal; a tab absent from here has never been opened and isn't mounted. */
  const [shown, setShown] = useState<Partial<Record<Tab, number>>>({ all: 0 })
  const open = (v: Tab) => {
    setTab(v)
    setShown((p) => ({ ...p, [v]: (p[v] ?? -1) + 1 }))
  }

  useEffect(() => {
    const id = setTimeout(() => {
      const admin = getUser()?.role === "admin"
      setIsAdmin(admin)
      const p = new URLSearchParams(window.location.search).get("tab")
      const wanted = p === "browse" ? "all" : p     // legacy alias
      const allowed = (v: string | null): v is Tab =>
        TABS.some((t) => t.id === v && (admin || !t.admin))
      // A ?tab= an operator may not open falls back to the first tab they may — not to a
      // blank page, and not to the cart.
      if (allowed(wanted)) open(wanted)
      else if (admin) open("purchase")
      else open("all")
    }, 0)
    return () => clearTimeout(id)
  }, [])

  /**
   * How many lines are waiting in the cart, on the tab that holds them.
   *
   * The header badge answers "is there anything in the cart" from anywhere in the app; this
   * answers "how much is waiting" while you are standing in the place that fills it. Adding
   * a blank from All suppliers should visibly move a number on the tab you are about to
   * click, and until now nothing on this page acknowledged the add at all.
   *
   * Same `eg-cart-changed` event the header listens to, so the two can never disagree.
   */
  const [cartCount, setCartCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    const load = () => getFactoryList<unknown[]>("po_saved")
      .then((r) => { if (!cancelled) setCartCount(Array.isArray(r) ? r.length : 0) })
      .catch(() => {})
    load()
    window.addEventListener("eg-cart-changed", load)
    return () => { cancelled = true; window.removeEventListener("eg-cart-changed", load) }
  }, [])

  const pick = (v: Tab) => {
    open(v)
    try {
      const u = new URL(window.location.href)
      u.searchParams.set("tab", v)
      window.history.replaceState(null, "", u)
    } catch { /* URL not writable — the tab still switches */ }
  }

  return (
    <div className="space-y-4">
      {/* One mobile section hero for the whole page (the top bar is desktop-only); the
          inner views hide their own hero via `embedded`. */}
      <div className="flex items-center gap-3 md:hidden">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShoppingCart size={18} weight="fill" /></span>
        <div className="min-w-0">
          <PageTitle>Purchasing</PageTitle>
          <p className="truncate text-sm text-muted-foreground">Browse suppliers, build a cart, and track orders.</p>
        </div>
      </div>
      <div className="flex w-fit rounded-full border border-border p-0.5">
        {/* Alibaba sits beside Orders rather than inside it: those are OUR purchase orders
            to S&S/Otto/SanMar, placed from here and received into stock, while Alibaba's
            are placed and paid on their site and only ever read back. Same page, different
            things — folding them together would put rows with no Receive action into a
            table whose whole point is receiving. */}
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            className={"eg-tap rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <TabLabel>{t.label}</TabLabel>
            {/* Only on the tab it belongs to, and only when there IS something. A zero
                beside every tab is a row of noughts pretending to be information. */}
            {t.id === "purchase" && cartCount > 0 && (
              <span className={"ml-1.5 rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums " + (tab === t.id ? "bg-primary-foreground/20" : "bg-primary/10 text-primary")}>
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Mounted on first visit, hidden thereafter — never unmounted. `hidden` and not a
          zero-height wrapper: the inactive views must take no space and, more to the point,
          must not be scrolled past by a keyboard user. */}
      {tabs.map((t) => shown[t.id] === undefined ? null : (
        <div key={t.id} className={tab === t.id ? undefined : "hidden"} aria-hidden={tab !== t.id}>
          {t.id === "all" ? <AllSuppliers refreshKey={shown.all} />
            : t.id === "favorites" ? <FavoritesView refreshKey={shown.favorites} />
            : t.id === "alibaba" ? <AlibabaOrders refreshKey={shown.alibaba} />
            : <PurchaseView embedded refreshKey={shown.purchase} />}
        </div>
      ))}
    </div>
  )
}
