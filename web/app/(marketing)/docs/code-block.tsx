/**
 * The code surface for the docs.
 *
 * Near-black, on a light page, and the reason is semantic rather than decorative: dark
 * means machine. Someone scanning the page knows which blocks are things-you-type and
 * which are prose without reading a word of either. The old bg-muted/40 panel sat about
 * four percent away from the page behind it, so that distinction had to be read rather
 * than seen.
 *
 * NOT the accent colour. Indigo appears on roughly one word per screen in this house
 * style and nowhere else — that scarcity is the whole mechanism. A tinted panel is a
 * large field of accent, and once every code block is indigo the one indigo word has
 * nowhere left to land. #0b0b0c is the same near-black as the marketing surface, so the
 * docs and the home page read as one product.
 *
 * Lived in two files with identical markup; restyling would have meant editing both and
 * hoping. One component now, imported by both.
 */
export function Block({ children }: { children: string }) {
  return (
    // The border is nearly invisible on a light page and does the separating on a dark
    // one, so a single class covers both surfaces without a theme branch.
    <pre className="overflow-x-auto rounded-lg border border-white/10 bg-[#0b0b0c] p-4 font-mono text-xs leading-relaxed text-neutral-200">
      {children}
    </pre>
  )
}

/**
 * Inline code, inside a sentence. Deliberately NOT the dark surface: at inline size a
 * near-black chip reads as redaction, and a paragraph with three of them turns into a
 * barcode. The block is the machine surface; inline code is a word wearing a label.
 */
export function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
}
