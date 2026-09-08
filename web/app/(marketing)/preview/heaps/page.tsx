import { HeapsPreview } from "@/components/marketing/ploy/heaps-preview"

/**
 * A LOCAL COMPARISON PAGE for the closing-section object layout.
 *
 * Four arrangements, one under the other, each in a band the size of the real CTA so they are
 * judged at the size they will actually run. It is `noindex` and it is meant to be DELETED
 * once one is chosen — a preview route that outlives its decision becomes a page nobody
 * maintains and a search engine eventually finds.
 */
export const metadata = { title: "Heaps — preview", robots: { index: false, follow: false } }

export default function HeapsPreviewPage() {
  return <HeapsPreview />
}
