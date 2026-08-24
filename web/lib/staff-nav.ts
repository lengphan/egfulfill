import { Sparkle, Printer, PenNib, Storefront, CurrencyDollar, Binoculars, Tag, SquaresFour, ShoppingCart, ChartBar, Wallet, Code, Package, Megaphone, Truck, EnvelopeSimple, Needle, Compass, type Icon } from "@phosphor-icons/react"

export type StaffNavItem = { label: string; href: string; icon: Icon; roles: string[] }

// Staff boards, gated by role. Admin sees everything.
export const STAFF_ITEMS: StaffNavItem[] = [
  { label: "Dashboard", href: "/overview", icon: SquaresFour, roles: ["operator", "warehouse", "admin"] },
  { label: "Orders", href: "/production", icon: Printer, roles: ["operator", "warehouse", "admin"] },
  // Warehouse removed: the design board is about artwork moving toward approval, which is
  // upstream of anything the floor does — their work starts at the print queue.
  { label: "Board", href: "/designer", icon: PenNib, roles: ["operator", "designer", "admin"] },
  // Earnings = a designer's own payout view. Admin sees designer credits in Wallet instead.
  { label: "Earnings", href: "/earnings", icon: CurrencyDollar, roles: ["designer"] },
  // Shipping = Dispatch (today's out-queue) + Shipments (parcel archive) as two tabs.
  // They stay distinct tabs, NOT one merged list: Dispatch is a short queue emptied by
  // evening, Shipments is an ever-growing archive — merging the lists would bury the queue.
  // Old /dispatch + /shipments routes redirect here (next.config).
  { label: "Shipping", href: "/shipping", icon: Truck, roles: ["operator", "warehouse", "admin"] },
  // Inventory = Stock (levels on hand) + Scan (the stock in/out station) as two tabs.
  // Scan keeps its own warehouse-write / operator-read gating inside the station. Old
  // /scan route redirects to the Scan tab (next.config).
  { label: "Inventory", href: "/inventory", icon: Package, roles: ["operator", "warehouse", "admin"] },
  // Purchasing = Suppliers (browse) + Purchase (cart/on-order/history) folded into one
  // section with tabs. Old /suppliers + /purchase routes redirect here (next.config).
  //
  // OPERATORS BROWSE; ONLY ADMIN BUYS. The section was admin-only outright, which also shut
  // operators out of the supplier catalogues — so building the product catalogue meant
  // retyping a blank an operator was already looking at, or asking an admin to do it. The
  // tabs are split by that line instead (see PurchasingView): All suppliers, Favorites and a
  // read-only Cart are open to the floor; Sample is not, and no Order button is rendered for
  // them anywhere.
  //
  // WAREHOUSE IS HERE FOR THE CART. The top bar has always shown them the cart button, and
  // it landed on a section their nav didn't list and whose cart tab they couldn't open —
  // so "is this already on order?" was a question they had to ask somebody else.
  //
  // The boundary that matters is the server's, and it already draws the same line: every
  // /api/purchase* route is requireAdmin, while browsing, favourites, add-to-catalog and the
  // cart blob itself (factory_lists/po_saved) are requireStaff. Nothing here grants an
  // operator or a warehouse hand anything the API would not.
  { label: "Purchasing", href: "/purchasing", icon: ShoppingCart, roles: ["operator", "warehouse", "admin"] },
  // Sourcing — the supplier pipeline: where a product could come from, what it lands at, and
  // how far along each supplier is (Saved -> In touch -> Sampling -> Approved, derived from
  // sample orders and recorded messages rather than typed — see SOURCING_STAGES). Its own
  // page rather than a Purchasing tab: Purchasing is about buying from suppliers we already
  // use, Sourcing is about deciding who those should be. ADMIN-only, same as Purchasing.
  { label: "Sourcing", href: "/sourcing", icon: Compass, roles: ["admin"] },
  // Partner billing — what byeastside / Pink Design / carriers / suppliers are owed.
  // Money, so warehouse and admin only, matching every other spend boundary.
  // Finance = Wallet (balances/transactions) + Partner costs (byeastside/carriers/suppliers)
  // as tabs on one page. Replaces the separate Billing + Wallet items.
  { label: "Finance", href: "/finance", icon: Wallet, roles: ["admin"] },
  // Campaigns is HIDDEN until Meta/Google connections exist — there are no settings to
  // connect an ad account yet, so the page can only show an empty shell. The route and
  // component are intact; restore the roles here to bring it back.
  { label: "Campaigns", href: "/campaigns", icon: Megaphone, roles: [] },
  // Broadcasts is seller EMAIL, not ad spend — a different thing from Campaigns above,
  // which is why it gets its own entry rather than a tab inside it. The team can draft;
  // only an admin can send, so this is visible to staff and the send button is not.
  { label: "Broadcasts", href: "/broadcasts", icon: EnvelopeSimple, roles: ["operator", "admin"] },
  // Digitizer — the Wilcom EWA embroidery page: drag a design in → quote + TrueView review
  // → edit → export a machine file.
  //
  // HIDDEN 2026-08-22, by decision rather than by fault: enough of what Wilcom offers is
  // going unused that the page is not worth a slot in the nav. Nothing is deleted — the
  // route, the component, the API keys and /api/wilcom/* are all intact, and the server gate
  // (requireDesignStaff, which excludes warehouse because each Wilcom call bills) still
  // stands. Restore it by putting the roles back: ["operator", "designer", "admin"].
  //
  // Same toggle as Campaigns above, and hiding rather than removing is deliberate: the entry
  // is where the reasoning lives, and an entry deleted outright takes the reasoning with it.
  { label: "Digitizer", href: "/digitizer", icon: Needle, roles: [] },
  // Console retired — Users + Activity live in Settings, Top-ups in Wallet, Products at /products.
]

export const STAFF_ROLES = ["operator", "warehouse", "designer", "admin"]

// Where a user should land after login / where staff get bounced if they hit a seller page.
export function landingFor(role?: string | null): string {
  switch (role) {
    case "admin": return "/overview"
    case "operator": return "/overview"
    case "warehouse": return "/overview" // staff dashboard is home for the team
    case "designer": return "/designer"
    default: return "/dashboard" // sellers
  }
}
export function isStaffRole(role?: string | null): boolean {
  return !!role && STAFF_ROLES.includes(role)
}

// Seller-side tool pages (in the (app) group) that specific staff roles may also use.
// Admin gets everything; others get a curated set. Designers get none (design-only).
export const STAFF_TOOLS: StaffNavItem[] = [
  // Warehouse removed: competitor research is a merchandising decision, not a fulfilment one.
  { label: "SpyDeck", href: "/spydeck", icon: Binoculars, roles: ["operator", "admin"] },
  { label: "Products", href: "/products", icon: Tag, roles: ["operator", "warehouse", "admin"] },
  // The shop window we publish OUTWARD — curated selection, trade prices, CSV export.
  // Warehouse/admin only: it sets the prices outside buyers are shown, which is a
  // commercial decision rather than a floor one.
  // NOT /catalog — that path is the PUBLIC marketing catalogue in (marketing), and two
  // pages resolving to one URL is a build error, not a runtime surprise.
  //
  // The PAGE lives in app/(app)/, like every other entry in this list. (boards) gates on
  // STAFF_ITEMS only, so a STAFF_TOOLS page placed there renders in the sidebar and then
  // bounces to the landing board the moment you click it — visible, unreachable, and no
  // error anywhere.
  { label: "Catalogue", href: "/published-catalog", icon: Storefront, roles: ["operator", "warehouse", "admin"] },
  { label: "Design Lab", href: "/design", icon: PenNib, roles: ["operator", "warehouse", "admin"] },
  /**
   * ADMIN AND OPERATOR — exactly the roles the server's image gate allows (`IMAGE_ROLES` in
   * `support_ai.js` / `publish.js`), and no more.
   *
   * It was admin-only, and before that it was in every staff sidebar while the server
   * refused everyone but admins: four tabs opening onto a red refusal over an empty page,
   * which is the one thing §4 says a screen must never leave ambiguous. Operators make
   * listing photos, so they get the page AND the gate; warehouse and designer get neither.
   *
   * It spends money per press, so it stays this narrow — and an admin can still hide it in
   * Settings › Permissions, whose rows are built from THIS list.
   */
  { label: "Studio", href: "/studio", icon: Sparkle, roles: ["operator", "admin"] },
  // Admin-only seller pages (full superuser access). (Seller "Orders"/Dashboard are
  // redundant with the factory Orders hub, so they're intentionally not here.)
  { label: "Stores", href: "/stores", icon: Storefront, roles: ["admin"] },
  { label: "Reports", href: "/reports", icon: ChartBar, roles: ["admin"] },
  // Wallet moved into Finance (a STAFF_ITEM) — kept out of Tools to avoid two entries.
  // API keys are a SELLER integration concern — an operator minting live keys is
  // not something the role needs. Warehouse keeps it for connection testing.
  { label: "Developers", href: "/developers", icon: Code, roles: ["warehouse", "admin"] },
]
export function staffTools(role?: string | null): StaffNavItem[] {
  if (!role) return []
  return STAFF_TOOLS.filter((i) => i.roles.includes(role))
}

// Pages every staff member may use inside the seller (app) group.
// Seller-shell pages any staff role may sit on. /orders is here because the boards link
// INTO it — "Open order" and manual order creation both land on seller-shell routes, and
// without this a non-admin was silently bounced to their dashboard, which reads as the
// page being broken rather than forbidden.
//
// NB this allows the SUB-routes (/orders/new, /orders/:id). The seller order LIST at
// exactly /orders is redirected away for staff — see ordersHomeFor. Two different
// "Orders" pages in the same shell reads as the app switching between a seller and a
// factory design, which is exactly what it looks like.
const STAFF_SHARED_PATHS = ["/chat", "/settings", "/help", "/notifications"]
// Order routes are for roles that actually handle orders. A designer works the artwork
// board and nothing else, so opening an order — let alone creating one — isn't theirs.
const ORDER_ROLES = ["operator", "warehouse", "admin"]

/** Where "orders" means for this role: staff get their production board, sellers the list. */
export function ordersHomeFor(role?: string | null): string {
  return isStaffRole(role) ? "/production" : "/orders"
}
// May this staff role sit on this (app) page? (admin = all; others = shared + their tools)
export function staffCanUseAppPath(role: string | null | undefined, pathname: string): boolean {
  if (role === "admin") return true
  const tools = staffTools(role).map((i) => i.href)
  const allowed = [
    ...STAFF_SHARED_PATHS,
    ...(ORDER_ROLES.includes(String(role)) ? ["/orders"] : []),
    ...tools,
    // /publish is not a nav item — it is where SpyDeck and Design Lab GO. So it is allowed
    // to whoever may use one of those, and to nobody else. Without this an operator
    // pressing "Make product" was bounced to their dashboard, which reads as the button
    // being broken rather than the page being forbidden.
    ...(tools.some((h) => PUBLISH_ENTRY_PATHS.includes(h)) ? ["/publish"] : []),
    // /sheet is not a nav item either — it is where IMPORT goes. The import flow now hands
    // you a real page instead of a dialog, and both entry points into it sit on an orders
    // surface (orders-hub for staff, orders-list for a seller), so it belongs to whoever may
    // work orders. Without this, pressing Import as an operator or warehouse pushed /sheet,
    // failed this check and bounced to /overview — the staff dashboard — which reads exactly
    // like the Import button being broken. Same failure as /publish above, same shape of fix;
    // an entry point added without a line here is a button that silently goes home.
    ...(ORDER_ROLES.includes(String(role)) ? ["/sheet"] : []),
  ]
  return allowed.some((p) => pathname === p || pathname.startsWith(p + "/"))
}
/** The pages that open the publish page. Kept beside the rule that reads them. */
const PUBLISH_ENTRY_PATHS = ["/spydeck", "/design"]

export function staffNav(role?: string | null): StaffNavItem[] {
  if (!role) return []
  return STAFF_ITEMS.filter((i) => i.roles.includes(role))
}

// Title for the top bar. Covers EVERY staff-reachable page — the board items, the tools
// (Products/SpyDeck/Design Lab/Stores/Wallet/…) AND the shared pages — not just
// STAFF_ITEMS, so a detail route like /products/16468 shows "Products" instead of falling
// through to the bare "EGFUL" brand. Longest-prefix wins so /products/x beats /.
const SHARED_TITLES: Record<string, string> = { "/chat": "Chat", "/settings": "Settings", "/help": "Help", "/orders": "Orders", "/notifications": "Notifications", "/publish": "Publish" }
export function staffNavTitle(pathname: string): string {
  const all = [...STAFF_ITEMS, ...STAFF_TOOLS, ...Object.entries(SHARED_TITLES).map(([href, label]) => ({ href, label }))]
  let best = ""; let bestLen = -1
  for (const i of all) {
    if ((pathname === i.href || pathname.startsWith(i.href + "/")) && i.href.length > bestLen) { best = i.label; bestLen = i.href.length }
  }
  return best || "EGFUL"
}
