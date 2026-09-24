/**
 * THE MCP SERVER — a seller's own AI assistant, using the public API as the seller.
 *
 * "Which of my orders haven't shipped?", "quote 40 black tees in L". The assistant calls
 * tools; the tools call OUR OWN ROUTES with the seller's key.
 *
 * ── The one rule everything else follows ────────────────────────────────────────────────
 *
 * EVERY TOOL RE-DISPATCHES THROUGH `app.inject`, FORWARDING THE CALLER'S KEY. Never the
 * database, never a helper lifted out of sandbox.js. So a tool call gets exactly what a
 * partner's HTTP call gets — the same validation, the same catalogue pricing, the same
 * scope check, the same rate limit, the same supplier redaction (§2.9), the same refusals.
 *
 * That is not tidiness, it is the entire security argument. It means the audit of
 * /api/v1/* transfers to this file unchanged: `catalog_products.id` still never leaves,
 * because the products route is the thing that withholds it; stock is still gated by
 * VISIBLE_TO_PARTNERS; every query is still `where seller_id = $1`; a pg error is still
 * stripped to a reference by `oops()`. A second code path would have to be re-audited, and
 * would drift the first time one of them changed.
 *
 * It also fails CLOSED. Forget to forward the key and the inner route answers 401 — the
 * tool returns a refusal rather than quietly running with more authority than the caller.
 *
 * ── What is deliberately not here yet ───────────────────────────────────────────────────
 *
 * NO `create_order`, NO `cancel_order`. Both write, and an AI agent retries. Until Part A
 * (Idempotency-Key) is live, a retried create is a second garment printed and a second
 * charge taken — see docs/MCP-AND-IDEMPOTENCY.md. `external_id` de-dupes a create today,
 * but nothing de-dupes a cancel, and a model re-calling a tool is a new call rather than a
 * retry. Read-only tools cannot have that failure, so they ship first and alone.
 *
 * NO webhook tools. Integration plumbing is not something to ask an assistant for — and
 * `webhooks.write` is the scope that lets a holder point every order's buyer name and
 * shipping address at a URL of their choosing.
 *
 * NO tool response carrying buyer-authored free text. Tool output is model input, and a
 * personalisation field is typed by a stranger. `GET /api/v1/orders/:id` returns no items
 * today; that is a property to keep on purpose, not an accident to build on.
 *
 * ── Transport ───────────────────────────────────────────────────────────────────────────
 *
 * Streamable HTTP, STATELESS: a fresh McpServer and transport per request, closed when the
 * response ends. Stateless is what lets this sit behind Caddy and a restart-on-deploy
 * container without a session store — and it is why the tool list can be built per request,
 * AFTER the key resolves, so a read-only key is never shown a tool it would be refused.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authKey, keyAllows, presentedKey } from './sandbox.js';

/** JSON-RPC error, written by hand because the transport is not involved yet — at this
 *  point we have refused the request before any MCP machinery saw it. */
const rpcError = (reply, code, message) =>
  reply.code(code === -32001 ? 401 : 400).send({
    jsonrpc: '2.0', error: { code, message }, id: null,
  });

/**
 * THE TOOL TABLE — one entry per DOCUMENTED endpoint, and nothing else.
 *
 * `route` is the promise: web/lib/api-endpoints.ts is what a partner reads, and §6 says an
 * entry there is a promise the route works. A tool naming a route that list does not carry
 * would be an undocumented surface reachable by an assistant, which is the same failure
 * /api/test/* was deleted for. tools/check-mcp.mjs holds that line.
 *
 * `scope` mirrors what the inner route already demands. It is NOT the gate — the route is —
 * it decides only whether the tool is ADVERTISED, so a model never reaches for something it
 * will be refused. Belt and braces, in that order.
 */
const TOOLS = [
  {
    name: 'list_products',
    route: 'GET /api/v1/products',
    scope: 'products.read',
    title: 'List printable blanks',
    description:
      'The blanks this seller can order, with sizes and prices. Every order line must name a sku from here. Call this before quoting or ordering anything — a sku invented from memory is refused.',
    input: {},
    call: () => ({ method: 'GET', url: '/api/v1/products' }),
  },
  {
    name: 'check_stock',
    route: 'GET /api/v1/stock',
    scope: 'products.read',
    title: 'Check what can be made now',
    description:
      'Available quantity per blank sku, plus a band: in_stock, low, or out_of_stock. Available is on-hand minus already committed. Pass a sku to check one blank.',
    input: { sku: z.string().optional().describe('A blank sku, e.g. 16468. Omit for everything.') },
    call: (a) => ({ method: 'GET', url: '/api/v1/stock' + (a.sku ? `?sku=${encodeURIComponent(a.sku)}` : '') }),
  },
  {
    name: 'quote_order',
    route: 'POST /api/v1/orders/quote',
    scope: 'orders.read',
    title: 'Price a basket before ordering',
    description:
      'What a basket would cost. Runs the SAME pricing that bills — the size ladder, the print-method surcharge, postage and the seller discount — so this figure is the figure charged. Nothing is created and nothing is charged. Quote before you tell anyone a price.',
    input: {
      items: z.array(z.object({
        product_id: z.string().describe('A sku from list_products.'),
        quantity: z.number().int().positive(),
        size: z.string().optional(),
        color: z.string().optional(),
        method: z.string().optional().describe('Print method, e.g. DTG, EMB.'),
      })).min(1),
    },
    call: (a) => ({ method: 'POST', url: '/api/v1/orders/quote', payload: { items: a.items } }),
  },
  {
    name: 'get_order',
    route: 'GET /api/v1/orders/:id',
    scope: 'orders.read',
    title: 'Look up one order',
    description:
      'Status and tracking for one order id. A cancelled order also carries why it was refused and by whom.',
    input: { id: z.string().describe('The order id, e.g. API-9F2C1A.') },
    call: (a) => ({ method: 'GET', url: `/api/v1/orders/${encodeURIComponent(a.id)}` }),
  },
  {
    name: 'get_balance',
    route: 'GET /api/v1/balance',
    scope: 'billing.read',
    title: 'Account balance',
    description:
      'What is on account right now. Negative means charges exceed funds, which is what stops an order reaching production.',
    input: {},
    call: () => ({ method: 'GET', url: '/api/v1/balance' }),
  },
];

export { TOOLS as MCP_TOOLS };

export function mcpRoutes(app) {
  /**
   * Re-enter our own API as the caller.
   *
   * `app.inject` runs the full request lifecycle — the onRequest hook, the route's own
   * requireKey, the rate limiter — against an in-process request. The key is forwarded
   * verbatim, so the inner route resolves the SAME api_keys row and reaches the same
   * verdict it would over the wire.
   */
  const callApi = async (key, { method, url, payload }) => {
    const res = await app.inject({
      method,
      url,
      headers: { 'x-api-key': key, ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { payload } : {}),
    });
    let body;
    try { body = res.json(); } catch { body = { error: 'Unreadable response from the API.' }; }
    return { status: res.statusCode, body };
  };

  /** One MCP server, built for ONE key. Stateless, so this is cheap and the tool list can
   *  depend on who is asking. */
  const serverFor = (k, key) => {
    const server = new McpServer(
      { name: 'egfulfill', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    for (const t of TOOLS) {
      if (!keyAllows(k, t.scope)) continue;   // never advertise what the route will refuse
      server.registerTool(
        t.name,
        {
          title: t.title,
          description: t.description,
          inputSchema: t.input,
          // Every tool here is a read. When create_order and cancel_order arrive they carry
          // destructiveHint and a description that says to confirm the total, the address
          // and any personalisation with the person first.
          annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async (args) => {
          const { status, body } = await callApi(key, t.call(args || {}));
          /* A REFUSAL IS AN ANSWER, not an exception. The routes already write errors a
             caller can act on — `insufficient_scope` names the scope, `unpriceable_lines`
             names the lines — so handing that text back lets the model say what is wrong
             instead of reporting that a tool failed. isError keeps it out of the model's
             mouth as fact. */
          return {
            content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
            ...(status >= 400 ? { isError: true } : {}),
          };
        }
      );
    }
    return server;
  };

  const handle = async (req, reply) => {
    const key = presentedKey(req);
    const k = key ? await authKey(req) : null;
    if (!k) {
      return rpcError(reply, -32001,
        'Send your EGFULFILL API key in the X-API-Key header (or Authorization: Bearer egk_…). Create one in Settings → API keys; a read-only key is enough to ask questions.');
    }

    const server = serverFor(k, key);
    const transport = new StreamableHTTPServerTransport({
      // STATELESS. No session id, so nothing is held between requests and any instance can
      // answer any call — which is what makes this survive a deploy restart behind Caddy.
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    /* Hijack AFTER auth, so a refusal above is still a normal Fastify reply. From here the
       transport owns the socket. Note @fastify/cors never runs on a hijacked reply — that
       is fine and deliberate: MCP clients are not browsers, and no Access-Control header
       should invite one to try. */
    reply.hijack();
    reply.raw.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e) {
      req.log.error({ err: e }, 'mcp request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
      }
    }
  };

  app.post('/api/mcp', handle);
  /* GET is the SSE half of Streamable HTTP and belongs to a SESSION, which stateless mode
     does not issue. Routed anyway so the transport answers 405 with a real MCP error — a
     client probing it learns what is true, rather than meeting a 404 that reads like the
     endpoint is wrong. */
  app.get('/api/mcp', handle);
}
