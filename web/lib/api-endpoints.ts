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
  /** A real response, copied from what the route actually returns. Shown in the public
   *  docs so an integrator can write their parsing before holding a key — guessing the
   *  shape from prose is where wrong field names come from. */
  response?: string
}

export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    id: "ping",
    response: `{
  "ok": true,
  "mode": "test",
  "live": false,
  "seller_id": "8f3c…",
  "time": "2026-07-21T16:04:11.882Z",
  "message": "Sandbox reachable — your test key is valid."
}`,
    method: "GET",
    path: "/api/v1/ping",
    title: "Validate key",
    description: "Checks your test key and confirms the sandbox is reachable.",
  },
  {
    id: "products",
    response: `{
  "object": "list",
  "mode": "test",
  "count": 2,
  "data": [
    { "id": "SS-16468", "sku": "16468", "name": "Heavy Cotton Tee",
      "type": "Apparel", "method": "DTG", "base_price": 8.50 }
  ]
}`,
    method: "GET",
    path: "/api/v1/products",
    title: "List products",
    description: "The blanks you can print on — your real catalogue, in both test and live mode. Order lines must match a sku from here or the order is refused.",
  },
  {
    id: "create-order",
    response: `{
  "object": "order",
  "mode": "live",
  "id": "API-9F2C1A",
  "status": "received",
  "items": [
    { "line": 1, "sku": "16468", "quantity": 2, "size": "L",
      "unit_price": 8.50, "line_total": 17.00 }
  ],
  "totals": { "items": 17.00, "currency": "USD" },
  "created": "2026-07-21T16:04:11.882Z"
}`,
    method: "POST",
    path: "/api/v1/orders",
    title: "Create order",
    description: "Create a fulfillment order. Needs an items array and a shipping_address. A test key validates and prices identically to live but produces nothing; a live key puts it in the factory queue. Every product_id must exist in GET /api/v1/products — we refuse an order we cannot price rather than inventing a number.",
    body: JSON.stringify(
      {
        external_id: "my-store-1001",
        items: [{ product_id: "16468", quantity: 2, color: "Black", size: "L", method: "DTG" }],
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
    response: `{
  "object": "order",
  "mode": "live",
  "id": "API-9F2C1A",
  "status": "shipped",
  "tracking": { "carrier": "USPS", "code": "9400100000000000000000" },
  "total": 17.00,
  "created": "2026-07-21T16:04:11.882Z"
}`,
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
    response: `{
  "object": "list",
  "mode": "test",
  "count": 2,
  "data": [
    { "sku": "16468", "name": "Heavy Cotton Tee", "variant": "Black / L",
      "category": "Apparel", "available": 90, "status": "in_stock" },
    { "sku": "LA6", "name": "Trucker Cap", "variant": "Navy",
      "category": "Headwear", "available": 12, "status": "low" }
  ]
}`,
    method: "GET",
    path: "/api/v1/stock",
    title: "Check stock",
    description:
      "What we can make right now. Returns available quantity per blank sku plus a status band (in_stock / low / out_of_stock). Pass ?sku= to check one. Available is on-hand minus already committed; stock is held per BLANK, so a print-method suffix (-EMB, -DTG, …) is stripped before matching.",
  },
  {
    id: "balance",
    response: `{
  "object": "balance",
  "mode": "live",
  "account": "8f3c…",
  "balance": 90.80,
  "currency": "USD"
}`,
    method: "GET",
    path: "/api/v1/balance",
    title: "Account balance",
    description: "What is currently on account. Negative means charges exceed funds. Needs the billing.read scope.",
  },
  {
    id: "statement",
    response: `{
  "object": "statement",
  "period": { "from": "2026-07-01", "to": "2026-07-31" },
  "opening_balance": 12.30,
  "closing_balance": 90.80,
  "totals": { "charges": -46.00, "credits": 124.50, "net": 78.50 },
  "lines": [
    { "id": "1", "date": "2026-07-02T09:14:22.104Z", "type": "order-out",
      "order_id": "API-9F2C1A", "description": "Order API-9F2C1A",
      "amount": -24.50, "balance": -12.20 }
  ]
}`,
    method: "GET",
    path: "/api/v1/statement",
    title: "Statement",
    description:
      "Every movement in a period with a running balance, defaulting to the current calendar month. Pass ?from=YYYY-MM-DD&to=YYYY-MM-DD. opening_balance + totals.net always equals closing_balance. Needs billing.read.",
  },
  {
    id: "webhooks-list",
    response: `[
  { "id": 3,
    "url": "https://your-app.example.com/hooks/egful",
    "events": ["order.received", "order.shipped"],
    "active": true,
    "created_at": "2026-07-21T14:00:00.000Z" }
]`,
    method: "GET",
    path: "/api/webhooks",
    title: "List webhooks",
    description:
      "Your registered endpoints. Secrets are never returned here — they're shown once, when the endpoint is created.",
  },
  {
    id: "webhooks-create",
    response: `{
  "id": 4,
  "url": "https://your-app.example.com/hooks/egful",
  "events": ["order.shipped"],
  "active": true,
  "secret": "egwh_2f9c1d4b…",
  "_note": "Store this secret now — it is not shown again."
}`,
    method: "POST",
    path: "/api/webhooks",
    title: "Add a webhook",
    description:
      "Register an https endpoint to be notified on. Returns a signing secret ONCE — store it. Omit `events` to receive all of them. Every delivery carries X-EG-Event and X-EG-Signature (sha256=<hex>), an HMAC-SHA256 of the raw body using that secret; compare it in constant time before trusting a payload.",
    body: JSON.stringify(
      {
        url: "https://your-app.example.com/hooks/egful",
        events: ["order.received", "order.status_changed", "order.shipped", "order.cancelled"],
      },
      null,
      2
    ),
  },
  {
    id: "webhooks-deliveries",
    response: `[
  { "id": 11, "event": "order.shipped", "status_code": 200,
    "error": null, "attempts": 1, "created_at": "2026-07-21T15:16:00.000Z" },
  { "id": 10, "event": "order.received", "status_code": 500,
    "error": null, "attempts": 3, "created_at": "2026-07-21T15:02:00.000Z" }
]`,
    method: "GET",
    path: "/api/webhooks/:id/deliveries",
    title: "Delivery attempts",
    description:
      "The last 100 attempts for one endpoint — status code, error and attempt count. Deliveries retry three times with backoff and give up on a non-retryable 4xx, so this is where a missed notification is explained.",
    param: { name: "id", placeholder: "1" },
  },
]
