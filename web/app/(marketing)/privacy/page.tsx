import { Reveal } from "@/components/motion/reveal"

export const metadata = { title: "Privacy Policy — EGFULFILL" }

const sections = [
  {
    h: "Information we collect",
    p: "Account details (name, email, store connections), order and fulfillment data, uploaded designs, and basic usage/analytics needed to operate the platform. We do not sell your personal information.",
  },
  {
    h: "How we use it",
    p: "To process and fulfill orders, sync your connected stores, provide support, prevent fraud, and improve the product. We process data on the lawful bases of contract performance and legitimate interest.",
  },
  {
    h: "Connected sales channels (Etsy & others)",
    p: "When you connect a third-party store such as Etsy, we access your data through that platform's official API using OAuth authorization that you grant. We receive your shop identity and order data — order details, totals, line items, and the buyer name and shipping address required to fulfill the order — and we store the access/refresh tokens the platform issues so we can keep your orders in sync. We access this data only on your behalf, use it solely to provide the fulfillment service to you, never sell or share it, and never use it to build a competing product. You can disconnect a store at any time (Settings → Stores → Disconnect), which deletes the stored tokens and stops syncing.",
  },
  {
    h: "How we store & protect data",
    p: "Your data is stored in our own database on a private server we control. The database is not exposed to the public internet and is protected by a firewall; all traffic between your browser and our servers is encrypted with HTTPS/TLS; access to order and buyer data is restricted to authenticated staff accounts; passwords are stored only as secure one-way hashes; and platform access tokens are never exposed to the browser or to public code.",
  },
  {
    h: "Cookies & analytics",
    p: "We use essential cookies to keep you signed in and aggregate analytics to understand usage. You can control non-essential cookies through your browser settings.",
  },
  {
    h: "Sharing & third parties",
    p: "We share data only with processors that help us run the service (e.g. payment, shipping, and hosting providers) under appropriate data-protection terms, or where required by law.",
  },
  {
    h: "Your rights",
    p: "You may access, correct, export, or delete your personal data, and object to certain processing. Contact us to exercise these rights; we respond within applicable legal timeframes.",
  },
  {
    h: "Data retention",
    p: "We keep data for as long as your account is active and as needed to meet legal, tax, and accounting obligations, then delete or anonymize it.",
  },
]

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
      <Reveal>
        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: June 2, 2026</p>
        <p className="mt-6 text-muted-foreground text-pretty">
          EGFULFILL (&ldquo;we&rdquo;, &ldquo;us&rdquo;) respects your privacy. This policy explains what information we
          collect, how we use it, and the choices you have. It applies to our website, dashboards, and services.
        </p>
      </Reveal>

      <div className="mt-10 space-y-8">
        {sections.map((s) => (
          <Reveal key={s.h}>
            <h2 className="font-display text-xl font-semibold tracking-tight">{s.h}</h2>
            <p className="mt-2 text-muted-foreground text-pretty">{s.p}</p>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <p className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
          Questions or data requests? Contact us at{" "}
          <a href="mailto:phanmylinh0410@gmail.com" className="font-medium text-foreground hover:underline">
            phanmylinh0410@gmail.com
          </a>
          .
        </p>
      </Reveal>
    </div>
  )
}
