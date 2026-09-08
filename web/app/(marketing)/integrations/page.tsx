import { PloyIntegrations } from "@/components/marketing/ploy/integrations"

export const metadata = {
  title: "Integrations — EGFUL",
  description: "Which sales channels connect to EGFUL today, what syncs each way, and what is not built yet.",
}

/**
 * NOT content-editable, and that is the point.
 *
 * Every other marketing page reads its copy from Settings › Site content. This one states
 * what is BUILT — which channels import orders, which can publish listings, and which are
 * honestly not started — and that is a fact about the codebase, not copy. Editable, it would
 * drift the moment someone wrote an optimistic sentence, and the reader most likely to be
 * harmed by that is a seller deciding whether to move their shop.
 *
 * The one thing to keep true: when a channel ships, its entry changes HERE, in the same
 * commit. See the list in ploy/integrations.tsx.
 */
export default function IntegrationsPage() {
  return (
    <PloyIntegrations
      headline="Plug in the shop"
      accent="you already run."
      lead="Orders arrive in one queue and tracking goes back to where the sale happened. Here is exactly what connects today, and what does not."
    />
  )
}
