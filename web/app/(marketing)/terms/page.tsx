import { Reveal } from "@/components/motion/reveal"

export const metadata = { title: "Terms of Service — EGFULFILL" }

const sections = [
  {
    h: "Your account",
    p: "You are responsible for your account, the accuracy of your information, and any activity under your credentials. You must be able to form a binding contract to use the service.",
  },
  {
    h: "Acceptable use",
    p: "You agree not to upload unlawful, infringing, or harmful content, or to misuse the platform. We may suspend accounts that violate these terms or applicable law.",
  },
  {
    h: "Orders & payment",
    p: "You pay the per-order base cost plus any selected options; you set your own retail prices. Production begins once an order is approved. Fees and availability may change with notice.",
  },
  {
    h: "Your content",
    p: "You retain ownership of designs you upload and grant us a limited license to print and fulfill them. You confirm you have the rights to all content you submit.",
  },
  {
    h: "Connected sales channels",
    p: "EGFULFILL lets you connect third-party marketplaces such as Etsy so we can import your orders for fulfillment. By connecting a store you authorize us to access that platform's data on your behalf through its official API, and you confirm you are permitted to grant that access. Your use of each connected platform remains subject to that platform's own terms. We access connected-platform data only to provide the fulfillment service to you, and handle it in line with our Privacy Policy.",
  },
  {
    h: "Service availability",
    p: "We work to keep the service running but provide it “as is” without warranties. We are not liable for indirect or consequential damages to the extent permitted by law.",
  },
  {
    h: "Changes",
    p: "We may update these terms; material changes will be communicated. Continued use after changes means you accept the updated terms.",
  },
]

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
      <Reveal>
        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: June 2, 2026</p>
        <p className="mt-6 text-muted-foreground text-pretty">
          These terms govern your use of EGFULFILL. By creating an account or using the service, you agree to them.
          Please read them carefully.
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
          Questions? Contact us at{" "}
          <a href="mailto:phanmylinh0410@gmail.com" className="font-medium text-foreground hover:underline">
            phanmylinh0410@gmail.com
          </a>
          .
        </p>
      </Reveal>
    </div>
  )
}
