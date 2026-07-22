import type { Metadata } from "next"
import { API_ENDPOINTS } from "@/lib/api-endpoints"
import { DocsNav } from "./docs-nav"

export const metadata: Metadata = {
  title: "API — EGFULFILL",
  description: "Push orders into our factory and get status and tracking back. REST, API-key auth, signed webhooks.",
}

/**
 * PUBLIC API documentation.
 *
 * Deliberately outside the app shell. The reference used to live only on /developers,
 * behind a login — so an engineer evaluating whether to integrate had to create an
 * account before they could read a single endpoint. Docs are a sales asset; the person
 * deciding whether this is feasible will not sign up first.
 *
 * Endpoints are rendered from the SAME array the in-app playground uses, so the public
 * page cannot drift from what the playground sends. Anything listed here is a promise
 * the route works — nothing that returns 501 belongs on this page.
 */
const BASE = "https://api.egful.store"

// One list drives the sidebar; every id here must match a Section below.
const SECTIONS: [string, string][] = [
  ["auth", "Authentication"],
  ["limits", "Rate limits"],
  ["endpoints", "Endpoints"],
  ["billing", "Billing"],
  ["webhooks", "Webhooks"],
  ["verify", "Verifying signatures"],
  ["errors", "Errors"],
]

const EVENTS: { name: string; when: string }[] = [
  { name: "order.received", when: "We accepted an order you pushed." },
  { name: "order.status_changed", when: "It moved along the production pipeline." },
  { name: "order.shipped", when: "Tracking exists. This is the one most integrations care about." },
  { name: "order.cancelled", when: "It was cancelled or refunded — or we refused it. Carries reason and rejected_by." },
]

// Mirrors API_SCOPES in server/src/routes/sandbox.js — keep the two in step.
const SCOPES: { name: string; allows: string }[] = [
  { name: "orders.write", allows: "Create orders." },
  { name: "orders.read", allows: "Read an order's status and tracking." },
  { name: "products.read", allows: "List the blanks you can order." },
  { name: "webhooks.read", allows: "List endpoints and their delivery history." },
  { name: "webhooks.write", allows: "Add, remove and test endpoints." },
  { name: "billing.read", allows: "Read your balance and statements." },
]

const LIMITS: { scope: string; limit: string }[] = [
  { scope: "All endpoints", limit: "600 requests / minute / key" },
  { scope: "Order creation", limit: "60 requests / minute / key" },
]

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
}

function Block({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <header className="max-w-2xl space-y-3 pb-10">
        <h1 className="text-3xl font-semibold tracking-tight">API reference</h1>
        <p className="text-muted-foreground">
          Push orders into our factory and get production status and tracking back. REST over HTTPS,
          JSON in and out, API-key auth, signed webhooks.
        </p>
      </header>

      <div className="grid gap-12 lg:grid-cols-[200px_1fr]">
        {/* Client component: it highlights the section you're on, which needs scroll
            position. Keeping it separate lets this page stay a server component. */}
        <DocsNav sections={SECTIONS} />

        <div className="min-w-0 space-y-14">
        <Section id="auth" title="Authentication">
          <p className="text-muted-foreground">
            Every request carries an API key in the <Code>X-API-Key</Code> header. Generate one in
            your dashboard under Settings → API keys.
          </p>
          <Block>{`curl ${BASE}/api/v1/ping \\
  -H "X-API-Key: egk_test_..."`}</Block>
          <p className="text-muted-foreground">
            Keys come in two modes, and the prefix tells you which you are holding.
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li><Code>egk_test_…</Code> — the sandbox. Nothing is produced and nothing is billed, but
              pricing and validation are <strong>identical to live</strong>, so an order that succeeds here
              succeeds there. Webhooks still fire, flagged <Code>test: true</Code>.</li>
            <li><Code>egk_live_…</Code> — real. Orders enter the factory queue and are billed.</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            The full key is shown once, at creation, and never again. We store only a hash.
          </p>

          <h3 className="pt-2 font-medium">Scopes</h3>
          <p className="text-muted-foreground">
            A key can be limited to what an integration actually needs. Grant the narrowest set
            that works — this is a credential you are handing to someone else.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 font-medium">Scope</th><th className="py-2 font-medium">Allows</th>
              </tr></thead>
              <tbody>
                {SCOPES.map((s) => (
                  <tr key={s.name} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-4 font-mono text-xs">{s.name}</td>
                    <td className="py-2 text-muted-foreground">{s.allows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            A call outside a key&apos;s scopes returns <Code>403</Code> with <Code>insufficient_scope</Code>
            and names what was required. A key created without any scopes has full access, which keeps
            older integrations working — but new keys should name theirs.
          </p>
        </Section>

        <Section id="limits" title="Rate limits">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 font-medium">Scope</th><th className="py-2 font-medium">Limit</th>
              </tr></thead>
              <tbody>
                {LIMITS.map((l) => (
                  <tr key={l.scope} className="border-b border-border/60">
                    <td className="py-2">{l.scope}</td>
                    <td className="py-2 font-mono text-xs">{l.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground">
            Every response carries <Code>X-RateLimit-Limit</Code>, <Code>X-RateLimit-Remaining</Code> and
            <Code>X-RateLimit-Reset</Code> (seconds until the window rolls) — so you can slow down before
            you are cut off rather than after. Exceeding a limit returns <Code>429</Code> with
            <Code>Retry-After</Code>.
          </p>
        </Section>

        <Section id="endpoints" title="Endpoints">
          <p className="text-muted-foreground">
            Base URL <Code>{BASE}</Code>. All paths take and return <Code>application/json</Code>.
          </p>
          <div className="space-y-3">
            {API_ENDPOINTS.map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={
                    "rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold " +
                    (e.method === "GET" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700")
                  }>{e.method}</span>
                  <code className="font-mono text-sm">{e.path}</code>
                  <span className="ml-auto text-sm font-medium">{e.title}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{e.description}</p>
                {e.body && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Request</div>
                    <Block>{e.body}</Block>
                  </div>
                )}
                {e.response && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Response</div>
                    <Block>{e.response}</Block>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section id="billing" title="Billing">
          <p className="text-muted-foreground">
            <Code>GET /api/v1/balance</Code> returns what is currently on account.
            <Code>GET /api/v1/statement?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</Code> returns every movement
            in a period, defaulting to the current calendar month. Both need <Code>billing.read</Code>.
          </p>
          <Block>{`{
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
}`}</Block>
          <p className="text-muted-foreground">
            Charges are negative, credits positive, and every line carries the running balance
            after it. <Code>opening_balance + totals.net</Code> always equals
            <Code>closing_balance</Code> — if it does not, tell us rather than working around it.
          </p>
          <p className="text-muted-foreground">
            There is no separate invoice object, deliberately. The ledger is append-only, so a
            statement for a closed period cannot change after the fact; inventing an invoice record
            alongside it would create a second thing that can disagree about what is owed.
          </p>
        </Section>

        <Section id="webhooks" title="Webhooks">
          <p className="text-muted-foreground">
            Rather than polling for status, register a URL and we POST to it when something happens.
            Add one in your dashboard under Developers → Webhooks, where you can also fire a test
            delivery and read the history of every attempt.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 font-medium">Event</th><th className="py-2 font-medium">Fires when</th>
              </tr></thead>
              <tbody>
                {EVENTS.map((e) => (
                  <tr key={e.name} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-4 font-mono text-xs">{e.name}</td>
                    <td className="py-2 text-muted-foreground">{e.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Block>{`POST https://your-app.example.com/hooks/egfulfill
X-EG-Event: order.shipped
X-EG-Signature: sha256=<hex>

{
  "event": "order.shipped",
  "created": "2026-07-21T14:56:43.584Z",
  "data": {
    "id": "API-9F2C1A",
    "status": "shipped",
    "tracking": { "carrier": "USPS", "code": "9400100000000000000000" },
    "total": 24.50
  }
}`}</Block>
          <p className="text-muted-foreground">
            Your endpoint must be public <strong>https</strong> and should answer <Code>2xx</Code> quickly —
            we abort a delivery after 10 seconds. Acknowledge first, then do the slow work.
          </p>
          <p className="text-muted-foreground">
            Failed deliveries retry three times with backoff. A <Code>5xx</Code>, <Code>429</Code> or
            <Code>408</Code> is treated as transient; any other <Code>4xx</Code> is a rejection and we stop.
            Because retries exist, <strong>the same event can arrive more than once</strong> — make
            processing idempotent. Deliveries are independent, so do not assume ordering; treat each
            payload as the current state rather than a diff.
          </p>
        </Section>

        <Section id="verify" title="Verifying signatures">
          <p className="text-muted-foreground">
            Anyone can POST to your URL. The signature is the only thing that proves a delivery came
            from us. It is an HMAC-SHA256 of the <strong>raw request body</strong>, keyed with the secret
            shown once when you created the endpoint.
          </p>
          <Block>{`import crypto from "node:crypto"

// express.raw() — NOT express.json(). Re-serialising the body
// changes whitespace and key order, and the digest will not match.
app.post("/hooks/egfulfill", express.raw({ type: "application/json" }), (req, res) => {
  const presented = String(req.headers["x-eg-signature"] || "").replace("sha256=", "")
  const expected  = crypto.createHmac("sha256", SECRET).update(req.body).digest("hex")

  const a = Buffer.from(presented), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401)

  res.sendStatus(200)                        // acknowledge first
  process(JSON.parse(req.body.toString()))   // then work
})`}</Block>
          <p className="text-sm text-muted-foreground">
            Compare in constant time. A plain <Code>===</Code> leaks timing information about the
            expected value.
          </p>
        </Section>

        <Section id="errors" title="Errors">
          <p className="text-muted-foreground">
            Errors return a JSON body with <Code>error</Code> and, where it helps you act, a
            <Code>code</Code> and the offending fields.
          </p>
          <Block>{`{
  "error": "Some lines have no catalogue match, so they cannot be priced or produced.",
  "code": "unpriceable_lines",
  "unpriced": [{ "line": 2, "sku": "NOT-OURS", "size": "L", "method": "DTG" }]
}`}</Block>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li><Code>400</Code> — the request is wrong. The body names what.</li>
            <li><Code>401</Code> — missing or revoked key.</li>
            <li><Code>429</Code> — rate limited. Wait <Code>Retry-After</Code> seconds.</li>
            <li><Code>501</Code> — a documented capability we do not offer. Carrier label purchasing is
              one: we buy labels ourselves when shipping your order, so read tracking from the order
              instead.</li>
          </ul>
          <p className="text-muted-foreground">
            Every line of an order must resolve to a product in our catalogue. We refuse an order we
            cannot price rather than inventing a number and producing it — check your SKUs against{" "}
            <Code>GET /api/v1/products</Code>.
          </p>

          <h3 className="pt-2 font-medium">If we refuse an order after accepting it</h3>
          <p className="text-muted-foreground">
            Some things are only discovered on the floor — a blank out of stock in one colour, artwork
            that cannot be produced at the size ordered. When that happens the order is cancelled and
            you are told why, both on the <Code>order.cancelled</Code> event and on the order itself,
            so a webhook you missed is not a reason you never learn.
          </p>
          <Block>{`GET /api/v1/orders/API-9F2C1A

{
  "object": "order",
  "id": "API-9F2C1A",
  "status": "cancelled",
  "reason": "Blank out of stock in Navy 2XL",
  "rejected_by": "factory",
  "rejected_at": "2026-07-21T17:04:11.882Z"
}`}</Block>
          <p className="text-sm text-muted-foreground">
            <Code>rejected_by</Code> is <Code>factory</Code> when we refused it and <Code>seller</Code>{" "}
            when it was cancelled from your side — they are the same event otherwise, and you almost
            certainly want to treat them differently.
          </p>
        </Section>
        </div>
      </div>

      <footer className="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">
        Something missing or wrong here? Tell us — this page is the contract, and a doc that lies is
        worse than no doc.
      </footer>
    </div>
  )
}
