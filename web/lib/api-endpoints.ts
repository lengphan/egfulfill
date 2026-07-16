// Sandbox endpoint catalog for the API Playground — mirrors server/src/routes/sandbox.js
// (/api/v1/*, API-KEY-authed, fully simulated: no real orders/labels/charges).
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
  {
    id: "rates",
    method: "POST",
    path: "/api/v1/shipping-rates",
    title: "Rate-shop shipment",
    description: "Returns simulated carrier rates for a shipment. Needs a to_address.",
    body: JSON.stringify(
      {
        to_address: { name: "Ava Brodeur", street1: "43 Calumet Rd", city: "Fairhaven", state: "MA", zip: "02719", country: "US" },
        from_address: { name: "EG Fulfill", city: "Los Angeles", state: "CA", zip: "90021", country: "US" },
        parcel: { length: 12, width: 9, height: 2, weight_oz: 6 },
      },
      null,
      2
    ),
  },
  {
    id: "label-domestic",
    method: "POST",
    path: "/api/v1/shipping-labels/domestics",
    title: "Buy domestic label",
    description: "Simulates buying a US label. Needs to_address, from_address and parcel (no wallet charge).",
    body: JSON.stringify(
      {
        service: "Ground Advantage",
        to_address: { name: "Ava Brodeur", street1: "43 Calumet Rd", city: "Fairhaven", state: "MA", zip: "02719", country: "US" },
        from_address: { name: "EG Fulfill", street1: "1500 Newton St", city: "Los Angeles", state: "CA", zip: "90021", country: "US" },
        parcel: { length: 12, width: 9, height: 2, weight_oz: 6 },
      },
      null,
      2
    ),
  },
  {
    id: "label-international",
    method: "POST",
    path: "/api/v1/shipping-labels/internationals",
    title: "Buy international label",
    description: "Simulates an international label with customs. Adds customs_items to the domestic fields.",
    body: JSON.stringify(
      {
        service: "Priority Mail International",
        to_address: { name: "Liam Byrne", street1: "12 Abbey St", city: "Dublin", state: "D01", zip: "D01X2P3", country: "IE" },
        from_address: { name: "EG Fulfill", street1: "1500 Newton St", city: "Los Angeles", state: "CA", zip: "90021", country: "US" },
        parcel: { length: 12, width: 9, height: 2, weight_oz: 6 },
        customs_items: [{ description: "Cotton T-Shirt", quantity: 2, value: 18.0, weight_oz: 6, hs_tariff: "610910", origin_country: "US" }],
      },
      null,
      2
    ),
  },
]
