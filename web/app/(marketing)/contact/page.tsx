import Link from "next/link"
import { DocHero, DocSections, DocFoot, DocMail } from "@/components/marketing/bold-doc"
import { Band, INK, SURFACE } from "@/components/marketing/bold-kit"

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
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      <DocHero title="Contact EGFUL">
        EGFUL is the print-on-demand fulfilment platform behind app.egful.store. Orders from your connected
        marketplaces sync into one queue, we print and ship them, and tracking is pushed back to the channel.
        The EGFUL team answers every address below.
      </DocHero>

      {/* ── THE ADDRESS, AT DISPLAY SIZE ─────────────────────────────────────────
          One mailbox answers all four routes, so the routes below are a description of what
          to say rather than four different places to send it. Setting the address as type is
          the page answering its own question before the reader has to read a list — the same
          call /pricing makes with $0.

          It was a bordered card with the address at 24px. The border was drawing a box around
          the one thing on the page nobody could miss. */}
      <Band tone="card">
        <div className="grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end">
          <a
            href="mailto:linh@embroiderygoods.com"
            className="font-display font-semibold leading-[0.95] tracking-[-0.032em] underline decoration-[3px] underline-offset-[10px] transition-opacity hover:opacity-70"
            style={{ fontSize: "clamp(1.75rem, 4.4vw, 3.4rem)", color: INK, textDecorationColor: "var(--mk-acid)" }}
          >
            linh@embroiderygoods.com
          </a>
          {/* THE LIME IS THE UNDERLINE, not the lettering. It is a fill in this system and
              measures 1.03:1 as type on the page — as a 3px rule under ink it is the one
              place the accent can appear in a paragraph without being unreadable. */}
          <p className="max-w-[46ch] text-[16px] leading-relaxed" style={{ color: INK, opacity: 0.62 }}>
            We reply within one business day, Monday to Friday. Include your store name and, where it helps,
            the order number — it is the fastest way to an answer.
          </p>
        </div>
      </Band>

      <DocSections
        tone="paper"
        items={routes.map((r) => ({
          h: r.h,
          p: (
            <>
              {r.p}
              <span className="mt-4 block">
                <DocMail address={r.email} />
              </span>
            </>
          ),
        }))}
      />

      <DocFoot>
        EGFUL &middot; print-on-demand fulfilment for Etsy, Shopify and TikTok Shop sellers. Our{" "}
        <Link href="/privacy" className="font-medium underline decoration-1 underline-offset-[3px] hover:opacity-70">Privacy Policy</Link>{" "}
        and{" "}
        <Link href="/terms" className="font-medium underline decoration-1 underline-offset-[3px] hover:opacity-70">Terms of Service</Link>{" "}
        apply to everything on this site.
      </DocFoot>
    </div>
  )
}
