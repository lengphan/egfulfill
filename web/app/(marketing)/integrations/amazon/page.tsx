import { Reveal } from "@/components/motion/reveal"

export const metadata = {
  title: "Amazon integration — EGFUL",
  description:
    "How EGFUL connects to an Amazon seller account: order sync into one fulfillment queue, print and pack on a vetted network, carrier labels, and tracking pushed back to Amazon.",
}

/**
 * The Amazon channel, described in full and in public.
 *
 * Amazon assesses a Solution Provider's website for a detailed description of the features
 * that use each API role requested — a logo in a marquee does not satisfy it. So this page
 * states, per capability: what the seller gets, what data it needs, and why. The status
 * section is deliberately plain rather than a "coming soon" badge: an application is reviewed
 * BEFORE access is granted, so claiming a live connection would be the false statement, and
 * the platform behind it (queue, print network, labels, tracking push-back) genuinely runs
 * today for three other channels.
 */

const capabilities = [
  {
    h: "Orders sync into one queue",
    role: "Inventory and Order Tracking",
    p: "Once you authorize EGFUL from your Amazon account, new orders are pulled in automatically and land in the same queue as your Etsy, Shopify and TikTok Shop orders. No CSV export, no copy-paste, no second dashboard to watch. Each order arrives with its line items, quantities, options and totals, and stays linked to its Amazon order so status always flows back to the right place.",
  },
  {
    h: "We print, pack and ship it",
    role: "Direct-to-Consumer Shipping (restricted)",
    p: "Your artwork is mapped to a product once; from then on every matching order is produced on our vetted print network — embroidery, DTG, DTF, applique, sublimation, laser and screen — quality-checked at intake, print and pack, then handed to the carrier. To print a shipping label we need the buyer's name and delivery address, which is the only reason EGFUL requests a restricted role on Amazon. That data is used to produce the label and for nothing else: it is never used for marketing, never shared between sellers, never sold, and never used to train models.",
  },
  {
    h: "Tracking is pushed back to Amazon",
    role: "Inventory and Order Tracking",
    p: "When a parcel is handed to the carrier, EGFUL writes the carrier, service and tracking number back to the Amazon order so your buyer sees it where they expect to and your account metrics stay accurate. You do not confirm shipments by hand.",
  },
  {
    h: "Publish products to your Amazon listing",
    role: "Product Listing",
    p: "Products you have built in EGFUL — blank, print method, print areas, variants and images — can be published to your own Amazon account from the same dialog used for Etsy and TikTok Shop, so a product exists once and sells in several places without being rebuilt per channel.",
  },
  {
    h: "Costs reconcile against your wallet",
    role: "Finance and Accounting",
    p: "EGFUL runs on a prepaid wallet. Every order shows its production and shipping cost before it prints, the charge is written to an append-only ledger when the order is submitted, and it is refunded in full if the order is cancelled before production. Reading your Amazon settlement data lets those charges be reconciled against what the channel actually paid out, so the per-order economics are visible rather than inferred.",
  },
]

const dataHandling = [
  {
    h: "What we receive",
    p: "Your seller account identity, your orders and their line items, and — under the restricted shipping role — the buyer name and delivery address needed to produce a label. We never receive or store payment card details.",
  },
  {
    h: "How long we keep it",
    p: "Buyer personal data is deleted within 30 days of the order shipping by an automated job that destroys the buyer's name, street address and the stored label file. What remains is the order number, totals, item SKUs and tracking number, which we keep for accounting, tax and support.",
  },
  {
    h: "How it is protected",
    p: "Traffic is encrypted with HTTPS/TLS end to end. The database is not exposed to the public internet and is reachable only from the application itself. Backups are encrypted and stored off-site. Access to order and buyer data is limited to authenticated staff accounts, and platform tokens are never exposed to the browser or to public code.",
  },
  {
    h: "How you turn it off",
    p: "Disconnect Amazon at any time from Settings → Stores. Disconnecting deletes the stored access and refresh tokens and stops all syncing immediately.",
  },
]

export default function AmazonIntegrationPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
      <Reveal>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Integration
        </div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          EGFUL for Amazon sellers
        </h1>
        <p className="mt-6 text-muted-foreground text-pretty">
          EGFUL is a print-on-demand fulfillment platform. You connect the marketplaces you sell
          on, we produce and ship the orders, and tracking goes back to the channel. This page
          describes what the Amazon connection does, exactly what seller and buyer data it uses,
          and why each piece is needed — the same description that applies to our Etsy, Shopify
          and TikTok Shop channels.
        </p>
      </Reveal>

      <Reveal>
        <h2 className="mt-14 font-display text-2xl font-semibold tracking-tight">
          What the connection does
        </h2>
      </Reveal>

      <div className="mt-8 space-y-8">
        {capabilities.map((c) => (
          <Reveal key={c.h}>
            <div className="rounded-2xl border border-border p-6">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {c.role}
              </div>
              <h3 className="mt-1 font-display text-xl font-semibold tracking-tight">{c.h}</h3>
              <p className="mt-2 text-muted-foreground text-pretty">{c.p}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <h2 className="mt-14 font-display text-2xl font-semibold tracking-tight">
          Seller and buyer data
        </h2>
        <p className="mt-2 text-muted-foreground text-pretty">
          We access your Amazon data only through Amazon&apos;s official API, only with the
          authorization you grant, and only to run the fulfillment service for you.
        </p>
      </Reveal>

      <div className="mt-8 space-y-8">
        {dataHandling.map((d) => (
          <Reveal key={d.h}>
            <h3 className="font-display text-lg font-semibold tracking-tight">{d.h}</h3>
            <p className="mt-2 text-muted-foreground text-pretty">{d.p}</p>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <h2 className="mt-14 font-display text-2xl font-semibold tracking-tight">Pricing</h2>
        <p className="mt-2 text-muted-foreground text-pretty">
          Connecting Amazon costs nothing, and there is no monthly platform fee. You pay the
          per-order production and shipping cost when an order ships, funded from your prepaid
          wallet, and you see that figure on the order before it prints. Shipping is rate-shopped
          across carriers and billed at cost. Full detail is on the{" "}
          <a href="/pricing" className="font-medium text-foreground hover:underline">
            pricing page
          </a>
          .
        </p>
      </Reveal>

      <Reveal>
        <h2 className="mt-14 font-display text-2xl font-semibold tracking-tight">Status</h2>
        <p className="mt-2 text-muted-foreground text-pretty">
          Etsy, Shopify and TikTok Shop are live today — sellers connect them, orders sync, and
          tracking is pushed back. The Amazon channel is in Amazon&apos;s developer registration
          process; the connection opens to sellers once that approval is granted. The fulfillment
          platform it plugs into is the one already running for the other three channels.
        </p>
      </Reveal>

      <Reveal>
        <p className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
          Questions about the Amazon integration? Email the EGFUL team at{" "}
          <a href="mailto:linh@embroiderygoods.com" className="font-medium text-foreground hover:underline">
            linh@embroiderygoods.com
          </a>
          , or read the{" "}
          <a href="/privacy" className="font-medium text-foreground hover:underline">
            Privacy Policy
          </a>
          .
        </p>
      </Reveal>
    </div>
  )
}
