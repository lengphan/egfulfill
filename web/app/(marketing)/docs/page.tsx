import type { Metadata } from "next"
import { DocHero } from "@/components/marketing/bold-doc"
import { SURFACE } from "@/components/marketing/bold-kit"
import { API_ENDPOINTS } from "@/lib/api-endpoints"
import { DocsNav } from "./docs-nav"
import { EndpointCard } from "./endpoint-card"
import { Block, Code } from "./code-block"

export const metadata: Metadata = {
  title: "API — EGFUL",
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
  /* AFTER Authentication and Rate limits, never before: the connect command IS the API
     key, so a reader who has not met keys yet cannot act on it. And not first — most
     people arriving here are writing code, and burying Endpoints under a section they do
     not want is how a reference stops being one. */
  ["mcp", "Connect MCP"],
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
  { name: "billing.read", allows: "Read your account balance." },
]

/**
 * The MCP tools, DERIVED from the endpoint list rather than typed out here.
 *
 * server/src/routes/mcp.js registers a tool per marked entry and this table renders from
 * the same marks, so what a seller reads and what their assistant is offered cannot
 * disagree — tools/check-mcp.mjs asserts the two sets are equal. A hand-written table here
 * would be a third opinion, and the first one to go stale.
 */
const MCP_TOOLS = API_ENDPOINTS.filter((e) => e.mcp)

const LIMITS: { scope: string; limit: string }[] = [
  { scope: "All endpoints", limit: "600 requests / minute / key" },
  { scope: "Order creation", limit: "60 requests / minute / key" },
]

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
    /* THE REFERENCE SITS ON THE MARKETING PALETTE, not the app's.
     *
     * Every neutral on this page was a shadcn token — `text-muted-foreground`, `border-border`,
     * `bg-muted`. Those are the APP's chroma-0 tokens, tuned for a queue you read all day, and
     * they do not move with `[data-skin]`: switching skin restyled five marketing pages and
     * left the API reference looking like a screen from a different product. The values are
     * `--mk-*` now, so this page changes with the site.
     *
     * The LAYOUT is unchanged and deliberately so. A rail of anchors beside a long reference is
     * correct for a document you scan for one endpoint, and it is not the marketing scroll —
     * what it owed the rest of the site was its palette and its opening, not its structure.
     */
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      <DocHero eyebrow="Developers" title="egful API">
        Push orders into our factory and get production status and tracking back. REST over HTTPS,
        JSON in and out, API-key auth, signed webhooks.
      </DocHero>

      <div className="w-full" style={{ background: "var(--mk-card)" }}>
      {/* THE SAME 88rem CONTAINER as the header, the hero and every band — it was max-w-[80rem],
          so the anchor rail began 80px right of the wordmark directly above it. */}
      <div className="mx-auto grid max-w-[88rem] gap-12 px-6 py-[clamp(3.5rem,7vw,6rem)] sm:px-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Client component: it highlights the section you're on, which needs scroll
            position. Keeping it separate lets this page stay a server component. */}
        <DocsNav sections={SECTIONS} />

        {/* THE MEASURE IS ON THE PROSE, NOT ON THE COLUMN. Widening the container to match the
            page would otherwise set body copy 1,100px long, which cannot be read — but a table
            of scopes and a curl block genuinely want the width. So paragraphs and lists cap at
            a reading measure and everything else fills the track. */}
        <div className="min-w-0 space-y-14 [&_li]:max-w-[76ch] [&_p]:max-w-[76ch]">
        <Section id="auth" title="Authentication">
          <p className="text-[var(--mk-auth-muted)]">
            Every request carries an API key in the <Code>X-API-Key</Code> header. Generate one in
            your dashboard under Settings → API keys.
          </p>
          <Block>{`curl ${BASE}/api/v1/ping \\
  -H "X-API-Key: egk_test_..."`}</Block>
          <p className="text-[var(--mk-auth-muted)]">
            Keys come in two modes, and the prefix tells you which you are holding.
          </p>
          <ul className="space-y-2 text-[var(--mk-auth-muted)]">
            <li><Code>egk_test_…</Code> — the sandbox. Nothing is produced and nothing is billed, but
              pricing and validation are <strong>identical to live</strong>, so an order that succeeds here
              succeeds there. Webhooks still fire, flagged <Code>test: true</Code>.</li>
            <li><Code>egk_live_…</Code> — real. Orders enter the factory queue and are billed.</li>
          </ul>
          <p className="text-sm text-[var(--mk-auth-muted)]">
            The full key is shown once, at creation, and never again. We store only a hash.
          </p>

          <h3 className="pt-2 font-medium">Scopes</h3>
          <p className="text-[var(--mk-auth-muted)]">
            A key can be limited to what an integration actually needs. Grant the narrowest set
            that works — this is a credential you are handing to someone else.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--mk-hairline)] text-left text-[var(--mk-auth-muted)]">
                <th className="py-2 font-medium">Scope</th><th className="py-2 font-medium">Allows</th>
              </tr></thead>
              <tbody>
                {SCOPES.map((s) => (
                  <tr key={s.name} className="border-b border-[var(--mk-hairline)] align-top">
                    <td className="py-2 pr-4 tabular-nums text-xs">{s.name}</td>
                    <td className="py-2 text-[var(--mk-auth-muted)]">{s.allows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-[var(--mk-auth-muted)]">
            A call outside a key&apos;s scopes returns <Code>403</Code> with <Code>insufficient_scope</Code>
            and names what was required. A key created without any scopes has full access, which keeps
            older integrations working — but new keys should name theirs.
          </p>
        </Section>

        <Section id="limits" title="Rate limits">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--mk-hairline)] text-left text-[var(--mk-auth-muted)]">
                <th className="py-2 font-medium">Scope</th><th className="py-2 font-medium">Limit</th>
              </tr></thead>
              <tbody>
                {LIMITS.map((l) => (
                  <tr key={l.scope} className="border-b border-[var(--mk-hairline)]">
                    <td className="py-2">{l.scope}</td>
                    <td className="py-2 tabular-nums text-xs">{l.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[var(--mk-auth-muted)]">
            Every response carries <Code>X-RateLimit-Limit</Code>, <Code>X-RateLimit-Remaining</Code> and
            <Code>X-RateLimit-Reset</Code> (seconds until the window rolls) — so you can slow down before
            you are cut off rather than after. Exceeding a limit returns <Code>429</Code> with
            <Code>Retry-After</Code>.
          </p>
        </Section>

        {/* CONNECT MCP — the same API, reached by an assistant instead of by code.
            A STEPPER, because this is a thing you DO in order, and a numbered rail is the
            one place numbering encodes something true rather than decorating. Three steps
            and no more: there is no plugin to install and nothing to authorise, so the
            usual middle and end of a connect flow are simply absent here and inventing
            them would be theatre. */}
        <Section id="mcp" title="Connect MCP">
          <p className="text-[var(--mk-auth-muted)]">
            Give an AI assistant your API key and it can answer questions about your orders,
            price a basket and check stock — through the same endpoints documented below, as you,
            with the same scopes and the same limits.
          </p>

          <ol className="space-y-6">
            <li className="border-l border-[var(--mk-hairline)] pl-5">
              <h3 className="font-medium">1 · Create a read-only key</h3>
              <p className="mt-1 text-[var(--mk-auth-muted)]">
                In the app, Settings → API keys → <strong>Read only</strong>. It is shown once, so copy
                it then. Start on a <Code>egk_test_…</Code> key: it prices and validates exactly as live
                and creates nothing.
              </p>
            </li>

            <li className="border-l border-[var(--mk-hairline)] pl-5">
              <h3 className="font-medium">2 · Point your tool at the server</h3>
              <p className="mt-1 text-[var(--mk-auth-muted)]">In Claude Code:</p>
              <div className="mt-2">
                <Block>{`claude mcp add --transport http egful \\
  ${BASE}/api/mcp \\
  --header "X-API-Key: egk_test_..."`}</Block>
              </div>
              <p className="mt-2 text-[var(--mk-auth-muted)]">
                Any other client: it is a Streamable HTTP MCP server at{" "}
                <Code>{BASE}/api/mcp</Code>, authenticated with the same{" "}
                <Code>X-API-Key</Code> header the REST API takes.
              </p>
            </li>

            <li className="border-l border-[var(--mk-hairline)] pl-5">
              <h3 className="font-medium">3 · Ask it something</h3>
              <p className="mt-1 text-[var(--mk-auth-muted)]">
                <em>“Which of my orders haven’t shipped yet?”</em> or{" "}
                <em>“What would 40 black tees in L cost?”</em>
              </p>
            </li>
          </ol>

          <h3 className="pt-2 font-medium">What it can do</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--mk-hairline)] text-left text-[var(--mk-auth-muted)]">
                <th className="py-2 font-medium">Tool</th>
                <th className="py-2 font-medium">Does</th>
                <th className="py-2 font-medium">Endpoint</th>
              </tr></thead>
              <tbody>
                {/* BASELINE, NOT TOP — and one size for all three cells.
                    A tool name and an endpoint path are both things you TYPE somewhere, so
                    neither may be smaller than the prose describing it (§4: a value is at
                    least text-sm; a label may be smaller, and none of these is a label).
                    Setting the tool name at text-xs beside a text-sm description also put
                    their baselines 3px apart under align-top, which is the crooked column
                    §4 warns about — fixed once on the row rather than per cell. */}
                {MCP_TOOLS.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--mk-hairline)] align-baseline">
                    <td className="py-2 pr-4 font-medium">{e.mcp!.tool}</td>
                    <td className="py-2 pr-4 text-[var(--mk-auth-muted)]">{e.title}</td>
                    <td className="py-2">
                      <a href={`#${e.id}`} className="underline decoration-[var(--mk-hairline)] underline-offset-2 hover:decoration-[var(--mk-ink)]">{e.path}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* WHAT IT CANNOT DO, said plainly rather than left to be discovered. A seller
              who expects an assistant to place orders and finds it cannot has been misled
              by silence; §4 forbids an absence that reads the same as a fault. */}
          <p className="text-[var(--mk-auth-muted)]">
            <strong>Every tool is read-only.</strong> An assistant can look things up and price
            work; it cannot place or cancel an order. That is deliberate — an AI agent retries a
            failed call, and a retried order is a second garment printed and a second charge taken.
            Ordering arrives once a retry is provably safe.
          </p>
          <p className="text-sm text-[var(--mk-auth-muted)]">
            A key limited to <Code>products.read</Code> is offered only the product tools. Nothing
            appears that your key would be refused.
          </p>
        </Section>

        <Section id="endpoints" title="Endpoints">
          <p className="text-[var(--mk-auth-muted)]">
            Base URL <Code>{BASE}</Code>. All paths take and return <Code>application/json</Code>.
          </p>
          <div className="space-y-3">
            {API_ENDPOINTS.map((e) => (
              <EndpointCard key={e.id} endpoint={e} />
            ))}
          </div>
        </Section>

        <Section id="billing" title="Billing">
          <p className="text-[var(--mk-auth-muted)]">
            <Code>GET /api/v1/balance</Code> returns what is currently on account. It needs{" "}
            <Code>billing.read</Code>. Negative means charges exceed funds.
          </p>
          <Block>{`{
  "object": "balance",
  "mode": "live",
  "account": "8f3c\u2026",
  "balance": 90.80,
  "currency": "USD"
}`}</Block>
          <p className="text-[var(--mk-auth-muted)]">
            There is no statement endpoint and no invoice object, deliberately. Every movement is
            already itemised on your wallet page, which reads the same append-only ledger this
            balance is summed from — a second surface that can disagree about what is owed is
            worse than one place to read it.
          </p>
        </Section>

        <Section id="webhooks" title="Webhooks">
          <p className="text-[var(--mk-auth-muted)]">
            Rather than polling for status, register a URL and we POST to it when something happens.
            Add one in your dashboard under Developers → Webhooks, where you can also fire a test
            delivery and read the history of every attempt.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--mk-hairline)] text-left text-[var(--mk-auth-muted)]">
                <th className="py-2 font-medium">Event</th><th className="py-2 font-medium">Fires when</th>
              </tr></thead>
              <tbody>
                {EVENTS.map((e) => (
                  <tr key={e.name} className="border-b border-[var(--mk-hairline)] align-top">
                    <td className="py-2 pr-4 tabular-nums text-xs">{e.name}</td>
                    <td className="py-2 text-[var(--mk-auth-muted)]">{e.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Block>{`POST https://your-app.example.com/hooks/egful
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
          <p className="text-[var(--mk-auth-muted)]">
            Your endpoint must be public <strong>https</strong> and should answer <Code>2xx</Code> quickly —
            we abort a delivery after 10 seconds. Acknowledge first, then do the slow work.
          </p>
          <p className="text-[var(--mk-auth-muted)]">
            Three rules the delivery side enforces, so they are worth knowing before you wire one up.
            <strong> Redirects are not followed</strong> — register the final URL, or the delivery is
            recorded as failed. The host is resolved on <strong>every attempt</strong> and must answer a
            public address; a name pointing at a private or link-local range is refused rather than sent
            to. And an account may hold <strong>ten endpoints</strong>, with the same URL registered once —
            fan out on your own side, where you can see the traffic.
          </p>
          <p className="text-[var(--mk-auth-muted)]">
            Failed deliveries retry three times with backoff. A <Code>5xx</Code>, <Code>429</Code> or
            <Code>408</Code> is treated as transient; any other <Code>4xx</Code> is a rejection and we stop.
            Because retries exist, <strong>the same event can arrive more than once</strong> — make
            processing idempotent. Deliveries are independent, so do not assume ordering; treat each
            payload as the current state rather than a diff.
          </p>
        </Section>

        <Section id="verify" title="Verifying signatures">
          <p className="text-[var(--mk-auth-muted)]">
            Anyone can POST to your URL. The signature is the only thing that proves a delivery came
            from us. It is an HMAC-SHA256 of the <strong>raw request body</strong>, keyed with the secret
            shown once when you created the endpoint.
          </p>
          <Block>{`import crypto from "node:crypto"

// express.raw() — NOT express.json(). Re-serialising the body
// changes whitespace and key order, and the digest will not match.
app.post("/hooks/egful", express.raw({ type: "application/json" }), (req, res) => {
  const presented = String(req.headers["x-eg-signature"] || "").replace("sha256=", "")
  const expected  = crypto.createHmac("sha256", SECRET).update(req.body).digest("hex")

  const a = Buffer.from(presented), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401)

  res.sendStatus(200)                        // acknowledge first
  process(JSON.parse(req.body.toString()))   // then work
})`}</Block>
          <p className="text-sm text-[var(--mk-auth-muted)]">
            Compare in constant time. A plain <Code>===</Code> leaks timing information about the
            expected value.
          </p>
        </Section>

        <Section id="errors" title="Errors">
          <p className="text-[var(--mk-auth-muted)]">
            Every error returns a JSON body with <Code>error</Code> in plain words and a{" "}
            <Code>code</Code> to switch on. A validation failure also names the fields it is
            missing under <Code>missing</Code>; an order we cannot price names the lines under{" "}
            <Code>unpriced</Code>.
          </p>
          <Block>{`{
  "error": "An order needs a non-empty \"items\" array.",
  "code": "invalid_request",
  "mode": "live",
  "missing": ["items"]
}`}</Block>
          <Block>{`{
  "error": "Some lines have no catalogue match, so they cannot be priced or produced.",
  "code": "unpriceable_lines",
  "unpriced": [{ "line": 2, "sku": "NOT-OURS", "size": "L", "method": "DTG" }]
}`}</Block>
          <ul className="space-y-1.5 text-sm text-[var(--mk-auth-muted)]">
            <li><Code>400</Code> — the request is wrong. The body names what.</li>
            <li><Code>401</Code> — missing or revoked key.</li>
            <li><Code>429</Code> — rate limited. Wait <Code>Retry-After</Code> seconds.</li>
            <li><Code>501</Code> — a documented capability we do not offer. Carrier label purchasing is
              one: we buy labels ourselves when shipping your order, so read tracking from the order
              instead.</li>
          </ul>
          <p className="text-[var(--mk-auth-muted)]">
            Every line of an order must resolve to a product in our catalogue. We refuse an order we
            cannot price rather than inventing a number and producing it — check your SKUs against{" "}
            <Code>GET /api/v1/products</Code>.
          </p>

          <h3 className="pt-2 font-medium">If we refuse an order after accepting it</h3>
          <p className="text-[var(--mk-auth-muted)]">
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
          <p className="text-sm text-[var(--mk-auth-muted)]">
            <Code>rejected_by</Code> is <Code>factory</Code> when we refused it and <Code>seller</Code>{" "}
            when it was cancelled from your side — they are the same event otherwise, and you almost
            certainly want to treat them differently.
          </p>
        </Section>
        </div>
      </div>
      </div>
    </div>
  )
}
