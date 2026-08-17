"use client"

import { useCallback, useRef, useState } from "react"
import { ImageSquare, CircleNotch, Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getDeskImageConfig, generateDeskImage, type DeskImageConfig, type ChatAttachment } from "@/lib/api"

/**
 * Generate a product image into the staffer's own assistant channel.
 *
 * Factory-only, and billed per render (~3–13¢), so this control is deliberate about cost:
 * the price of the CURRENT model + size is on screen before you press the button, and the
 * button says what it will spend. Nothing here fires on its own.
 *
 * The config is fetched on OPEN — an event — never from an effect watching state the fetch
 * would itself rewrite.
 */
export function ImageGenButton({ disabled, onGenerated }: {
  disabled?: boolean
  onGenerated: (att: ChatAttachment, meta: { model: string; size: string; aspectRatio: string; usd: number }) => void
}) {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState<DeskImageConfig | null>(null)
  const [loadingCfg, setLoadingCfg] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState("")
  const [size, setSize] = useState("")
  const [ratio, setRatio] = useState("1:1")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const promptRef = useRef<HTMLInputElement>(null)

  const spec = cfg?.models.find((m) => m.id === model) || null
  // Fall back through the model's own default: a size one model offers (4K) may not exist
  // on another (lite is 1K-only), so switching models can strand an impossible selection.
  const effSize = spec ? (spec.sizes.includes(size) ? size : spec.defaultSize) : size
  const usd = spec ? (spec.usd[effSize] ?? 0) : 0

  const openPicker = useCallback(async () => {
    const next = !open
    setOpen(next)
    if (!next || cfg || loadingCfg) return
    setLoadingCfg(true)
    try {
      const c = await getDeskImageConfig()
      setCfg(c)
      setModel(c.model)
      const m = c.models.find((x) => x.id === c.model)
      setSize(m?.defaultSize || "1K")
      setTimeout(() => promptRef.current?.focus(), 0)
    } catch {
      setErr("Couldn't load the image settings.")
    } finally {
      setLoadingCfg(false)
    }
  }, [open, cfg, loadingCfg])

  const run = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true); setErr(null)
    try {
      const r = await generateDeskImage({ prompt: text, aspectRatio: ratio, imageSize: effSize, model })
      if (!r.ok || !r.attachment) {
        setErr(r.error || (r.disabled ? "Image generation is off — an admin can add the Google AI key in Settings › Integrations." : "That didn't work."))
        return
      }
      onGenerated(r.attachment, {
        model: r.model || model, size: r.size || effSize,
        aspectRatio: r.aspectRatio || ratio, usd: r.usd ?? usd,
      })
      setPrompt(""); setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <Button
        variant="ghost" size="icon" className="size-10"
        onClick={openPicker} disabled={disabled} aria-label="Generate an image"
      >
        {busy ? <CircleNotch size={16} className="animate-spin" /> : <ImageSquare size={18} />}
      </Button>

      {open && (
        <>
          {/* click-away to close — same pattern as the emoji picker beside it */}
          <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-[22rem] rounded-lg border border-border bg-card p-3 shadow-lg">
            <div className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Generate an image</div>

            {loadingCfg && <div className="py-6 text-center text-sm text-muted-foreground"><CircleNotch size={16} className="mx-auto animate-spin" /></div>}

            {/* Say WHICH half is missing. "Unavailable" reads the same as broken. */}
            {cfg && !cfg.enabled && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <Warning size={14} className="mt-0.5 shrink-0" />
                <span>
                  {!cfg.keySet
                    ? "No Google AI key is set. An admin can add one in Settings › Integrations."
                    : "File storage isn't configured, so a generated image couldn't be kept."}
                </span>
              </div>
            )}

            {cfg?.enabled && (
              <div className="space-y-2.5">
                <Input
                  ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run() } }}
                  placeholder="A folded heather-grey tee on warm oak, soft daylight…"
                  className="h-9 text-sm" disabled={busy}
                />

                <div>
                  <div className="mb-1 text-2xs text-muted-foreground">Model</div>
                  <select
                    value={model} disabled={busy}
                    onChange={(e) => {
                      const id = e.target.value
                      setModel(id)
                      const m = cfg.models.find((x) => x.id === id)
                      if (m && !m.sizes.includes(size)) setSize(m.defaultSize)
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {cfg.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  {spec && <p className="mt-1 text-2xs leading-snug text-muted-foreground">{spec.note}</p>}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-2xs text-muted-foreground">Shape</div>
                    <select value={ratio} onChange={(e) => setRatio(e.target.value)} disabled={busy}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      {cfg.ratios.map((r) => (
                        <option key={r} value={r}>{cfg.ratioHints[r] ? `${r} — ${cfg.ratioHints[r]}` : r}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-2xs text-muted-foreground">Size</div>
                    <select value={effSize} onChange={(e) => setSize(e.target.value)} disabled={busy}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      {(spec?.sizes || []).map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                {err && <p className="text-xs text-destructive">{err}</p>}

                {/* The price is on the button, not in a tooltip — this spends money. */}
                <Button className="h-9 w-full gap-1.5" onClick={run} disabled={busy || !prompt.trim()}>
                  {busy ? <CircleNotch size={14} className="animate-spin" /> : <ImageSquare size={14} />}
                  {busy ? "Generating…" : `Generate · ~$${usd.toFixed(3)}`}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
