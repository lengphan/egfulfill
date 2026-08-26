/**
 * The code surface for the docs.
 *
 * ONE surface for request and response alike. They were split — dark for what you send,
 * light for what comes back — which sorted them by value at a glance but made the page
 * read as two different documents interleaved, and the dark blocks sat against a light
 * page like holes punched in it.
 *
 * The header strip already says which is which, in words, so the body doesn't need to
 * repeat it in luminance.
 *
 * oklch(0.975 0.012 280) shares hue 280 with --primary at a twentieth of its chroma: a
 * tint that reads as ours rather than as grey, without spending the accent. Indigo appears
 * on about one word per screen in this house style, and a saturated panel would leave that
 * one word nowhere to land — which is why the colour goes on the header strip, a few pixels
 * tall and once per block, and not on the body.
 */
export const CODE_SURFACE = "bg-[oklch(0.975_0.012_280)] text-[oklch(0.28_0.02_280)]"

/**
 * The header strip that names a block — language tabs on a request, "Response" on a
 * response. Full accent: it is the one element small enough to carry it and the one that
 * has to be told apart at a glance.
 */
export const CODE_HEADER = "bg-[var(--primary)] text-white"

/** A titled code block: accent header strip, then the body. `actions` sits at the right of
 *  the strip (copy, language tabs). */
export function TitledBlock({ title, actions, children }: {
  title: React.ReactNode
  actions?: React.ReactNode
  children: string
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--mk-hairline)]">
      <div className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold ${CODE_HEADER}`}>
        {title}
        {actions && <span className="ml-auto flex items-center gap-1">{actions}</span>}
      </div>
      <pre className={`overflow-x-auto p-4 tabular-nums text-xs leading-relaxed ${CODE_SURFACE}`}>
        {children}
      </pre>
    </div>
  )
}

/**
 * An untitled block, for prose sections where the surrounding text already says what the
 * snippet is. No header strip: a bar reading "Request" under a paragraph that just said
 * "send this" labels something already labelled.
 */
export function Block({ children }: { children: string }) {
  return (
    <pre className={`overflow-x-auto rounded-lg border border-[var(--mk-hairline)] p-4 tabular-nums text-xs leading-relaxed ${CODE_SURFACE}`}>
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
  return <code className="rounded bg-[var(--mk-ink)]/[0.06] px-1.5 py-0.5 tabular-nums text-[0.85em]">{children}</code>
}
