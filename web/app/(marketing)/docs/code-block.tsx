/**
 * The code surface for the docs.
 *
 * Dark, on a light page, and the reason is semantic rather than decorative: dark means
 * machine. Someone scanning the page knows which blocks are things-you-type and which are
 * prose without reading a word of either. The old bg-muted/40 panel sat about four percent
 * away from the page behind it, so that distinction had to be read rather than seen.
 *
 * THE HUE IS THE ACCENT'S, THE CHROMA IS ALMOST NOTHING. oklch(0.24 0.03 280) shares hue
 * 280 with --primary, so the panel is unmistakably OURS rather than a generic black — but
 * at 0.03 chroma against the accent's 0.245 it reads as a dark neutral with a cast, not as
 * a field of violet. That distinction is the whole point: indigo appears on about one word
 * per screen in this house style, and a genuinely violet panel would spend that scarcity
 * on decoration and leave the one indigo word nowhere to land. It's the same move Stripe
 * makes with a blue-tinted slate.
 *
 * Pure #0b0b0c was the first attempt. It worked, but it belonged to no one — the same
 * black any docs site uses.
 *
 * Lived in two files with identical markup; restyling would have meant editing both and
 * hoping. One component now, imported by both.
 */
/**
 * The one definition of the code surface. Exported because the language tabs sit directly
 * above a block and have to BE the same colour, not approximately it — a near-match reads
 * as a mistake far louder than a deliberate contrast would.
 */
export const CODE_SURFACE = "bg-[oklch(0.24_0.03_280)] text-[oklch(0.93_0.012_280)]"

/**
 * The header strip that names a block — the language tabs on a request, "Response" on a
 * response. Full accent, and this is the one place it earns a whole surface: the strip is
 * a few pixels tall, it appears once per block, and it's the thing that tells you which of
 * the two you're looking at. Spending the accent on the label rather than the body is what
 * keeps the body readable.
 */
export const CODE_HEADER = "bg-[var(--primary)] text-white"

/**
 * The response body. Light violet rather than the request's dark surface, because request
 * and response are not the same kind of thing: one is what you send, one is what comes
 * back, and a reader scanning a long page sorts them by value before reading either. Same
 * hue 280, near-white lightness — a tint, not a fill.
 */
export const RESPONSE_SURFACE = "bg-[oklch(0.975_0.012_280)] text-[oklch(0.28_0.02_280)]"

/**
 * A titled code block: accent header strip, then the body.
 *
 * `tone` picks which body — "request" is the dark machine surface, "response" the light
 * violet one. `actions` sits at the right of the strip (copy, language tabs).
 */
export function TitledBlock({ title, tone = "request", actions, children }: {
  title: React.ReactNode
  tone?: "request" | "response"
  actions?: React.ReactNode
  children: string
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-black/10">
      <div className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold ${CODE_HEADER}`}>
        {title}
        {actions && <span className="ml-auto flex items-center gap-1">{actions}</span>}
      </div>
      <pre className={`overflow-x-auto p-4 font-mono text-xs leading-relaxed ${tone === "response" ? RESPONSE_SURFACE : CODE_SURFACE}`}>
        {children}
      </pre>
    </div>
  )
}

/**
 * An untitled block, for prose sections where the surrounding text already says what the
 * snippet is. No header strip: a bar reading "Request" under a paragraph that just said
 * "send this" is a label for something already labelled.
 */
export function Block({ children }: { children: string }) {
  return (
    <pre className={`overflow-x-auto rounded-lg border border-black/10 p-4 font-mono text-xs leading-relaxed ${CODE_SURFACE}`}>
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
