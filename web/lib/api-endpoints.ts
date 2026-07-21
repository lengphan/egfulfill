// Endpoint catalog for the API Playground — mirrors server/src/routes/sandbox.js
// (/api/v1/*, API-KEY-authed) and server/src/webhooks.js.
//
// A test key (egk_test_…) simulates everything. A LIVE key creates real orders against
// your account — /api/v1/orders is not a sandbox on a live key.
//
// Keep this list honest: it is the only description of the API a partner ever reads, and
// an entry here is a promise that the route works. Nothing may be listed that the server
// answers with 501.
export type ApiEndpoint = {
  id: string
  method: "GET" | "POST"
  path: string // may contain a :param
  title: string
  description: string
  body?: string // pretty-printed sample JSON for POST (or GET with a param)
  param?: { name: string; placeholder: string } // path :param
}

export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    id: "ping",
    method: "GET",
    path: "/api/v1/ping",
    title: "Validate key",
    description: "Checks your test key and confirms the sandbox is reachable.",
  },
  {
    id: "products",
    method: "GET",
    path: "/api/v1/products",
    title: "List products",
    description: "Returns the catalog blanks you can print on (simulated set).",
  },
  {
    id: "create-order",
    method: "POST",
    path: "/api/v1/orders",
    title: "Create order",
    description: "Simulates creating a fulfillment order. Needs an items array and a shipping_address.",
    body: JSON.stringify(
      {
        external_id: "my-store-1001",
        items: [{ product_id: "gild-64000", quantity: 2, color: "Black", size: "L", method: "DTG" }],
        shipping_address: {
          name: "Ava Brodeur",
          street1: "43 Calumet Rd",
          city: "Fairhaven",
          state: "MA",
          zip: "02719",
          country: "US",
        },
      },
      null,
      2
    ),
  },
  {
    id: "get-order",
    method: "GET",
    path: "/api/v1/orders/:id",
    title: "Retrieve order",
    description: "Looks up an order by id (any well-formed id resolves in the sandbox).",
    param: { name: "id", placeholder: "ord_test123" },
  },
  // Label buying and rate shopping USED to be listed here. They were removed rather than
  // marked "coming soon": the server returns 501 for all three, and before that they
  // returned a 200 carrying an invented tracking code. Documenting an endpoint that
  // cannot work is how an integrator builds against it and discovers the gap in
  // production. EGFULFILL buys carrier labels internally when it ships an order —
  // tracking is read back from Retrieve order, or pushed by the order.shipped webhook.
  {
    id: "stock",
    method: "GET",
    path: "/api/v1/stock",
    title: "Check stock",
    description:
      "What we can make right now. Returns available quantity per blank sku plus a status band (in_stock / low / out_of_stock). Pass ?sku= to check one. Available is on-hand minus already committed; stock is held per BLANK, so a print-method suffix (-EMB, -DTG, …) is stripped before matching.",
  },
  {
    id: "balance",
    method: "GET",
    path: "/api/v1/balance",
    title: "Account balance",
    description: "What is currently on account. Negative means charges exceed funds. Needs the billing.read scope.",
  },
  {
    id: "statement",
    method: "GET",
    path: "/api/v1/statement",
    title: "Statement",
    description:
      "Every movement in a period with a running balance, defaulting to the current calendar month. Pass ?from=YYYY-MM-DD&to=YYYY-MM-DD. opening_balance + totals.net always equals closing_balance. Needs billing.read.",
  },
  {
    id: "webhooks-list",
    method: "GET",
    path: "/api/webhooks",
    title: "List webhooks",
    description:
      "Your registered endpoints. Secrets are never returned here — they're shown once, when the endpoint is created.",
  },
  {
    id: "webhooks-create",
    method: "POST",
    path: "/api/webhooks",
    title: "Add a webhook",
    description:
      "Register an https endpoint to be notified on. Returns a signing secret ONCE — store it. Omit `events` to receive all of them. Every delivery carries X-EG-Event and X-EG-Signature (sha256=<hex>), an HMAC-SHA256 of the raw body using that secret; compare it in constant time before trusting a payload.",
    body: JSON.stringify(
      {
        url: "https://your-app.example.com/hooks/egfulfill",
        events: ["order.received", "order.status_changed", "order.shipped", "order.cancelled"],
      },
      null,
      2
    ),
  },
  {
    id: "webhooks-deliveries",
    method: "GET",
    path: "/api/webhooks/:id/deliveries",
    title: "Delivery attempts",
    description:
      "The last 100 attempts for one endpoint — status code, error and attempt count. Deliveries retry three times with backoff and give up on a non-retryable 4xx, so this is where a missed notification is explained.",
    param: { name: "id", placeholder: "1" },
  },
]
