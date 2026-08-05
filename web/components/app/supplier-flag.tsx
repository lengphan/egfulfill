import Image from "next/image"

// Badge assets are cropped + background-knocked-out versions of the suppliers' logos
// (see public/suppliers). S&S is cropped to the "S&S" mark alone — the full lockup
// includes "ACTIVEWEAR" in small caps, which is illegible at badge size.
const LOGOS: Record<string, { src: string; w: number; h: number; alt: string }> = {
  ss: { src: "/suppliers/ss.png", w: 183, h: 96, alt: "S&S Activewear" },
  otto: { src: "/suppliers/otto.png", w: 240, h: 71, alt: "OTTO" },
}

// Normalise the various labels the boards pass ("S&S", "s&s", "Otto", "otto caps").
function keyOf(label: string): string | null {
  const s = label.toLowerCase()
  if (s.includes("otto")) return "otto"
  if (s.includes("s&s") || s.startsWith("ss")) return "ss"
  return null
}

/**
 * Supplier flag for a product image — a white chip carrying the real logo, replacing the
 * dark text pill that just said "S&S" / "Otto".
 *
 * The chip stays white in both themes on purpose: these are brand marks with fixed
 * colours (OTTO red, S&S black), so tinting the backing to the UI theme would either
 * wash them out or recolour someone's trademark. Unknown labels fall back to the old
 * text pill rather than rendering nothing.
 */
export function SupplierFlag({ label, className }: { label: string; className?: string }) {
  const key = keyOf(label)
  const logo = key ? LOGOS[key] : null

  if (!logo) {
    return (
      <span className={"rounded-full bg-foreground/80 px-2 py-0.5 text-3xs font-semibold text-background backdrop-blur " + (className ?? "")}>
        {label}
      </span>
    )
  }

  // Height is fixed and width follows the logo's aspect, so OTTO (wide) and S&S (squarer)
  // both read at the same optical weight instead of one dominating.
  const h = 13
  const w = Math.round((logo.w / logo.h) * h)

  return (
    <span
      className={
        "inline-flex items-center rounded-md bg-white px-1.5 py-1 shadow-sm ring-1 ring-black/10 " + (className ?? "")
      }
      title={logo.alt}
    >
      <Image src={logo.src} alt={logo.alt} width={w} height={h} style={{ width: w, height: h }} unoptimized />
    </span>
  )
}
