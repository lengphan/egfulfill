// Help content model. Each article has its OWN answer page at /help/[slug] that
// renders these blocks, plus an optional `action` link into the function it explains.
// Kept as plain data (no JSX/icons) so both the client Help center and the server
// answer page can import it.

export type HelpBlock =
  | { type: "p"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "note"; text: string }

export type HelpArticle = {
  slug: string
  category: string // category id
  title: string
  summary: string // one-liner for lists + meta description
  body: HelpBlock[]
  action?: { label: string; href: string } // link to the function page, when there is one
}

export type HelpCategory = { id: string; icon: string; title: string; desc: string }

// Icon names map to phosphor components in the UI layer (see ICONS in the components).
export const HELP_CATEGORIES: HelpCategory[] = [
  { id: "getting-started", icon: "Rocket", title: "Getting started", desc: "Set up your account, connect a store, and place your first order." },
  { id: "orders", icon: "Package", title: "Orders & fulfillment", desc: "Track orders, manage status changes, and handle resubmissions." },
  { id: "products", icon: "GridFour", title: "Products & designs", desc: "Upload artwork, generate mockups, and manage your catalog." },
  { id: "billing", icon: "CreditCard", title: "Billing & plans", desc: "Top up your wallet, upgrade your plan, and manage payments." },
  { id: "integrations", icon: "PlugsConnected", title: "Integrations", desc: "Connect Etsy and other channels, and sync listings." },
  { id: "api", icon: "Code", title: "API & developers", desc: "REST API reference, the sandbox playground, and auth guides." },
]

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Getting started ───────────────────────────────────────────────────────
  {
    slug: "create-account", category: "getting-started",
    title: "How to create your EGFULFILL account",
    summary: "Sign up as a seller and land on your dashboard.",
    body: [
      { type: "p", text: "Signing up creates a seller account — the side that places orders and connects stores. Staff roles (operator, warehouse, designer, admin) are assigned internally, not through signup." },
      { type: "steps", items: [
        "Open the login page and choose “Create account”, or sign in with Google.",
        "Enter your name, email, and a password (or continue with Google).",
        "You’ll be signed in and taken straight to your dashboard.",
      ] },
      { type: "note", text: "Your session is remembered on this device, so you won’t need to sign in each visit." },
    ],
    action: { label: "Go to your dashboard", href: "/dashboard" },
  },
  {
    slug: "connect-store", category: "getting-started",
    title: "Connecting your first store",
    summary: "Link Etsy so orders and listings sync automatically.",
    body: [
      { type: "p", text: "Connecting a store lets EGFULFILL pull your orders in automatically and push tracking back once they ship. Etsy is fully wired today." },
      { type: "steps", items: [
        "Go to Stores and pick the channel you want to connect.",
        "You’ll be sent to the channel to authorize EGFULFILL, then returned here.",
        "Your recent orders and listings sync in; new orders arrive automatically from then on.",
      ] },
      { type: "note", text: "Some Etsy buyer addresses may show as hidden — that’s an Etsy data-access policy, not a bug. See “Why some buyer addresses are hidden.”" },
    ],
    action: { label: "Connect a store", href: "/stores" },
  },
  {
    slug: "sample-order", category: "getting-started",
    title: "Placing a sample order",
    summary: "Create an order by hand to see the whole flow.",
    body: [
      { type: "p", text: "A manual order is the fastest way to see how fulfillment works end-to-end before your store traffic ramps up. Manual orders are prefixed FF-; synced marketplace orders are prefixed by their channel." },
      { type: "steps", items: [
        "Open Orders and choose “New order”.",
        "Add the product, pick the blank (color/size), and attach or design the artwork.",
        "Enter the shipping address and submit — it enters the queue like any live order.",
      ] },
    ],
    action: { label: "Create a new order", href: "/orders/new" },
  },
  {
    slug: "branding-profile", category: "getting-started",
    title: "Setting up your branding profile",
    summary: "Add your business details used across the app.",
    body: [
      { type: "p", text: "Your profile holds your display name and business details. It’s also where you manage API keys and your team." },
      { type: "steps", items: [
        "Open Settings → Profile.",
        "Set your display name and details, then save.",
      ] },
    ],
    action: { label: "Open Settings", href: "/settings" },
  },
  {
    slug: "dashboard-overview", category: "getting-started",
    title: "Understanding the dashboard overview",
    summary: "What the dashboard cards and numbers mean.",
    body: [
      { type: "p", text: "The dashboard is your at-a-glance view: recent orders and their status, your wallet balance, and quick links into the areas you use most." },
      { type: "note", text: "Numbers reconcile from the server on each visit, so they stay accurate across devices." },
    ],
    action: { label: "Go to your dashboard", href: "/dashboard" },
  },

  // ── Orders & fulfillment ──────────────────────────────────────────────────
  {
    slug: "order-statuses", category: "orders",
    title: "How order statuses work",
    summary: "The seller-facing status labels and what each means.",
    body: [
      { type: "p", text: "Every order moves through a simple set of seller-facing stages as the factory works it:" },
      { type: "steps", items: [
        "Received — we have the order and it’s waiting to enter production.",
        "In production — artwork is approved and it’s being printed / embroidered.",
        "Packed — printed, QC’d, and packed with a label ready.",
        "Shipped — handed to the carrier; tracking is attached.",
      ] },
      { type: "note", text: "These labels are a simplified view of the detailed factory statuses — you always see the seller-friendly version." },
    ],
    action: { label: "View your orders", href: "/orders" },
  },
  {
    slug: "import-orders", category: "orders",
    title: "Importing orders from CSV or Sheets",
    summary: "Bulk-create orders from a spreadsheet.",
    body: [
      { type: "p", text: "If an order isn’t coming from a connected store, you can bring it in from a spreadsheet instead of typing it." },
      { type: "steps", items: [
        "Open Orders and choose the import option.",
        "Map your columns (product, variant, quantity, shipping address).",
        "Review the preview and confirm — each row becomes an order.",
      ] },
    ],
    action: { label: "Go to Orders", href: "/orders" },
  },
  {
    slug: "track-shipment", category: "orders",
    title: "Tracking a shipment",
    summary: "Find the carrier and tracking number for an order.",
    body: [
      { type: "p", text: "Once an order ships, its tracking number and carrier are attached to the order and — for connected stores — pushed back to the marketplace so your buyer is notified." },
      { type: "steps", items: [
        "Open Orders and click the order.",
        "The carrier and tracking number appear once the status reaches Shipped.",
      ] },
    ],
    action: { label: "View your orders", href: "/orders" },
  },
  {
    slug: "cancel-edit-order", category: "orders",
    title: "Cancelling or editing an order",
    summary: "What you can change, and when.",
    body: [
      { type: "p", text: "You can edit an order’s items and design while it’s still early in the flow (before it locks for production). Once it’s in production, packed, or shipped, changes have to go through support." },
      { type: "note", text: "If an order has already locked, use Live chat and we’ll help — don’t assume a change went through until it’s confirmed." },
    ],
    action: { label: "View your orders", href: "/orders" },
  },
  {
    slug: "failed-qc", category: "orders",
    title: "What happens if an item fails QC?",
    summary: "Our quality check and automatic reprints.",
    body: [
      { type: "p", text: "Every item is inspected before it’s packed. If a print or embroidery doesn’t meet standard, it’s pulled and reprinted at no cost to you — you don’t need to do anything." },
      { type: "p", text: "A failed-QC item stays in production a little longer while it’s remade, then rejoins the normal flow to Packed and Shipped." },
    ],
  },

  // ── Products & designs ────────────────────────────────────────────────────
  {
    slug: "browse-catalog", category: "products",
    title: "Browsing the product catalog",
    summary: "Find a blank to design on.",
    body: [
      { type: "p", text: "The catalog is the set of blanks you can order — each with its own mockup, available methods (print / embroidery), colors, and sizes. Pick one, then design on it and publish to your store." },
      { type: "note", text: "As a seller you choose and design on products; creating or deleting catalog products is done by our team." },
    ],
    action: { label: "Browse the catalog", href: "/products" },
  },
  {
    slug: "design-lab", category: "products",
    title: "Using the Design Lab",
    summary: "Place artwork on a blank and publish it.",
    body: [
      { type: "p", text: "The Design Lab is where you turn a blank into a finished product — drop your artwork onto the mockup, position and size it, and publish the result to a connected marketplace." },
      { type: "steps", items: [
        "From a product, choose “Design this”.",
        "Upload or pick your artwork and position it on the blank.",
        "Publish — it goes to your store as a draft you review before it’s live.",
      ] },
    ],
    action: { label: "Open the Design Lab", href: "/design" },
  },
  {
    slug: "file-formats", category: "products",
    title: "Accepted file formats and DPI requirements",
    summary: "What artwork to upload for the best print.",
    body: [
      { type: "p", text: "For prints, upload a high-resolution PNG with a transparent background at 300 DPI at the size you want it printed. PNG keeps edges crisp and transparency intact." },
      { type: "p", text: "For embroidery, artwork is matched to thread colors from stock; simpler, bolder art stitches best. Very fine detail and gradients don’t translate to thread." },
      { type: "note", text: "Low-resolution or heavily compressed images can look soft or pixelated when printed at full size." },
    ],
  },
  {
    slug: "generate-mockups", category: "products",
    title: "Generating product mockups",
    summary: "Preview your design on the blank.",
    body: [
      { type: "p", text: "As you place artwork in the Design Lab, it composites onto the product’s mockup so you see exactly how it lands on the garment. That composite is what you publish and what your buyer sees." },
    ],
    action: { label: "Open the Design Lab", href: "/design" },
  },
  {
    slug: "print-area-bleed", category: "products",
    title: "Print area and bleed zone guidelines",
    summary: "Keep your design inside the printable area.",
    body: [
      { type: "p", text: "Each blank has a defined printable area. Keep important elements away from the very edges of that area so nothing critical is clipped, and design at the mockup’s scale so placement matches the finished item." },
      { type: "note", text: "The Design Lab shows the placement box on the mockup — keep text and logos comfortably inside it." },
    ],
  },

  // ── Billing & plans ───────────────────────────────────────────────────────
  {
    slug: "wallet-balance", category: "billing",
    title: "How the wallet balance works",
    summary: "A prepaid balance that fulfillment draws from.",
    body: [
      { type: "p", text: "Your wallet is a prepaid balance. Fulfillment costs are drawn from it as orders are produced and shipped, so keeping a balance means orders never stall on payment." },
      { type: "note", text: "The balance is an append-only ledger reconciled on the server, so it’s consistent everywhere you sign in." },
    ],
    action: { label: "Open your wallet", href: "/wallet" },
  },
  {
    slug: "top-up", category: "billing",
    title: "Topping up (VietQR, card, or transfer)",
    summary: "Add funds to your wallet.",
    body: [
      { type: "p", text: "You can add funds by VietQR bank transfer, card, or manual transfer. For VietQR, scan the QR shown in the top-up window — the payment is matched automatically and the window closes when it lands." },
      { type: "steps", items: [
        "Open your wallet and choose “Top up”.",
        "Pick a method and amount.",
        "For VietQR, scan the QR that appears and pay — it reconciles on its own.",
      ] },
      { type: "note", text: "Use the QR shown in the window — a QR built elsewhere won’t be matched to your account." },
    ],
    action: { label: "Top up your wallet", href: "/wallet" },
  },
  {
    slug: "change-plan", category: "billing",
    title: "Upgrading or downgrading your plan",
    summary: "Switch between Starter, Pro, and Enterprise.",
    body: [
      { type: "p", text: "Plans (Starter / Pro / Enterprise) are managed in Settings. Changing plan takes effect for your account right away." },
    ],
    action: { label: "Manage your plan", href: "/settings" },
  },
  {
    slug: "spydeck-addon", category: "billing",
    title: "Adding SpyDeck to your plan",
    summary: "Enable the product-research add-on.",
    body: [
      { type: "p", text: "SpyDeck is a research add-on — trending products and keywords you can turn into your own listings. Enable it from Settings, then it appears in your sidebar." },
    ],
    action: { label: "Manage add-ons", href: "/settings" },
  },
  {
    slug: "understanding-charges", category: "billing",
    title: "Understanding your charges",
    summary: "Read your wallet ledger.",
    body: [
      { type: "p", text: "Every debit and top-up is a line in your wallet ledger with a reference, so you can trace exactly what each charge was for. The running balance is the sum of those lines." },
    ],
    action: { label: "Review your ledger", href: "/wallet" },
  },

  // ── Integrations ──────────────────────────────────────────────────────────
  {
    slug: "connect-etsy", category: "integrations",
    title: "Connecting Etsy",
    summary: "Authorize Etsy to sync orders and listings.",
    body: [
      { type: "p", text: "Connecting Etsy lets orders flow in automatically and tracking flow back out. You authorize once through Etsy and are returned here." },
      { type: "steps", items: [
        "Open Stores and choose Etsy.",
        "Approve the connection on Etsy’s site.",
        "Your orders and listings sync in; new orders arrive automatically.",
      ] },
    ],
    action: { label: "Connect Etsy", href: "/stores" },
  },
  {
    slug: "sync-listings", category: "integrations",
    title: "Syncing product listings automatically",
    summary: "Keep marketplace listings in step.",
    body: [
      { type: "p", text: "Once a store is connected, its listings sync so your products stay in step with the channel. New orders against those listings come in on their own." },
    ],
    action: { label: "Manage stores", href: "/stores" },
  },
  {
    slug: "disconnect-store", category: "integrations",
    title: "Disconnecting or re-authorizing a store",
    summary: "Remove or refresh a channel connection.",
    body: [
      { type: "p", text: "You can disconnect a channel at any time from Stores, or re-authorize it if the connection expires or you change permissions." },
      { type: "steps", items: [
        "Open Stores and find the connected channel.",
        "Choose disconnect to remove it, or reconnect to re-authorize.",
      ] },
    ],
    action: { label: "Manage stores", href: "/stores" },
  },
  {
    slug: "hidden-addresses", category: "integrations",
    title: "Why some buyer addresses are hidden",
    summary: "An Etsy data-access policy, not a bug.",
    body: [
      { type: "p", text: "For some Etsy orders the buyer’s address comes through blank. That’s an Etsy policy: full address data is gated behind a higher partner access tier on their side — it isn’t something misconfigured on your account." },
      { type: "note", text: "Orders still fulfill once the address is available; if one is missing when you need it, reach out via Live chat." },
    ],
  },

  // ── API & developers ──────────────────────────────────────────────────────
  {
    slug: "api-overview", category: "api",
    title: "API overview and authentication",
    summary: "Authenticate and call the REST API.",
    body: [
      { type: "p", text: "The REST API lets you create and manage orders programmatically. Requests authenticate with an API key you generate in Settings, sent as a bearer token." },
    ],
    action: { label: "Read the API docs", href: "/developers" },
  },
  {
    slug: "create-orders-api", category: "api",
    title: "Creating orders via API",
    summary: "Submit orders from your own system.",
    body: [
      { type: "p", text: "Post an order with its items, variant, quantity, and shipping address and it enters the same fulfillment flow as an order placed in the app." },
    ],
    action: { label: "See order endpoints", href: "/developers" },
  },
  {
    slug: "playground", category: "api",
    title: "Trying endpoints in the Playground",
    summary: "Call safe sandbox endpoints from the browser.",
    body: [
      { type: "p", text: "The API Playground lets you try endpoints against a safe sandbox without touching live data — a quick way to see request and response shapes before you build." },
    ],
    action: { label: "Open the Playground", href: "/developers" },
  },
  {
    slug: "api-keys", category: "api",
    title: "Generating and revoking API keys",
    summary: "Create and rotate developer keys.",
    body: [
      { type: "p", text: "Generate API keys in Settings. Keep them secret; if one is exposed, revoke it there and generate a new one — revoked keys stop working immediately." },
    ],
    action: { label: "Manage API keys", href: "/settings" },
  },
  {
    slug: "rate-limits", category: "api",
    title: "Rate limits and error codes",
    summary: "Handle throttling and errors gracefully.",
    body: [
      { type: "p", text: "The API returns standard HTTP status codes — 2xx on success, 4xx for a bad request or auth problem, 5xx if something breaks on our side. Back off and retry on throttling or transient errors." },
    ],
    action: { label: "Read the API docs", href: "/developers" },
  },
]

export function getArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug)
}
export function articlesByCategory(id: string): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === id)
}
export function categoryById(id: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.id === id)
}
