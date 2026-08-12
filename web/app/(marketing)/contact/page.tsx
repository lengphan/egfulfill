import { Reveal } from "@/components/motion/reveal"

export const metadata = {
  title: "Contact — EGFUL",
  description:
    "Contact the EGFUL team about print-on-demand fulfillment, marketplace integrations, API access, privacy requests or security reports.",
}

/**
 * A PUBLISHED contact page, reachable without signing in.
 *
 * The site had no direct contact method at all — only the support bubble, which is a widget
 * a logged-out visitor cannot rely on and a marketplace reviewer does not count. Every route
 * below goes to a mailbox a person actually reads; nothing here is a form that posts into a
 * queue nobody owns, and there is no phone number or postal address invented to fill a slot.
 */
const routes = [
  {
    h: "Sellers and support",
    p: "Questions about an order, a connected store, your wallet or a print file. Signed-in sellers can also use the chat in the app, which reaches the same team.",
    email: "linh@embroiderygoods.com",
  },
  {
    h: "Marketplace, API and partnerships",
    p: "Integration questions, API access, or working with EGFUL as a fulfillment or supply partner. This is also the address for marketplace developer and compliance correspondence.",
    email: "linh@embroiderygoods.com",
  },
  {
    h: "Privacy and data requests",
    p: "Access, correction, export or deletion of personal data, and questions about how we handle buyer information on a connected channel. See the Privacy Policy for what we hold and for how long.",
    email: "linh@embroiderygoods.com",
  },
  {
    h: "Security reports",
    p: "Report a vulnerability or a suspected data incident. We acknowledge reports within one business day and notify affected customers and the relevant marketplaces in line with our incident response plan.",
    email: "linh@embroiderygoods.com",
  },
]

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
      <Reveal>
        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Contact EGFUL</h1>
        <p className="mt-6 text-muted-foreground text-pretty">
          EGFUL is the print-on-demand fulfillment platform behind{" "}
          <span className="font-medium text-foreground">app.egful.store</span>. Orders from your
          connected marketplaces sync into one queue, we print and ship them, and tracking is
          pushed back to the channel. The EGFUL team answers every address below.
        </p>
      </Reveal>

      <Reveal>
        <div className="mt-10 rounded-2xl border border-border p-6">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            EGFUL team
          </div>
          <a
            href="mailto:linh@embroiderygoods.com"
            className="mt-2 block font-display text-2xl font-semibold tracking-tight hover:underline"
          >
            linh@embroiderygoods.com
          </a>
          <p className="mt-3 text-sm text-muted-foreground">
            We reply within one business day, Monday to Friday. Include your store name and, where
            it helps, the order number — it is the fastest way to an answer.
          </p>
        </div>
      </Reveal>

      <div className="mt-10 space-y-8">
        {routes.map((r) => (
          <Reveal key={r.h}>
            <h2 className="font-display text-xl font-semibold tracking-tight">{r.h}</h2>
            <p className="mt-2 text-muted-foreground text-pretty">{r.p}</p>
            <a
              href={`mailto:${r.email}`}
              className="mt-2 inline-block text-sm font-medium text-foreground hover:underline"
            >
              {r.email}
            </a>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <p className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
          EGFUL · print-on-demand fulfillment for Etsy, Shopify and TikTok Shop sellers. Our{" "}
          <a href="/privacy" className="font-medium text-foreground hover:underline">
            Privacy Policy
          </a>{" "}
          and{" "}
          <a href="/terms" className="font-medium text-foreground hover:underline">
            Terms of Service
          </a>{" "}
          apply to everything on this site.
        </p>
      </Reveal>
    </div>
  )
}
