// Opt a page OUT of the shell's reading-width cap.
//
// Both shells cap <main> at a reading width (`.eg-content`, see app/globals.css) because
// detail panels, forms and settings rows read badly stretched across a 1900px monitor.
// Tables and dense card grids are the opposite case — they want every pixel, and capping
// them brings back horizontal scrolling.
//
// A page declares itself full-bleed by wrapping its content:
//
//   export default function OrdersPage() {
//     return (
//       <FullBleed reason="Orders table — 6 columns; capping brings back h-scroll.">
//         <OrdersList />
//       </FullBleed>
//     )
//   }
//
// `reason` is documentation, not behaviour: it is required so the next person reading the
// page can see WHY this one is full width without opening the view component. Grep
// `<FullBleed` for the complete list of full-width pages.
//
// The wrapper is `display: contents`, so it adds no box and changes no layout — it exists
// only to carry the marker attribute the shell's `:has()` selector looks for.
export function FullBleed({
  children,
}: {
  /** Why this page needs the full width — usually "…table, N columns". */
  reason: string
  children: React.ReactNode
}) {
  return (
    <div data-full-bleed className="contents">
      {children}
    </div>
  )
}
