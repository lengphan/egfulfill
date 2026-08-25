"use client"

import { useLabelT } from "@/lib/i18n"
import { createContext, useCallback, useContext, useRef, useState } from "react"
import { Warning } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * On-theme replacements for `window.confirm` and `window.prompt`.
 *
 * The native ones render browser chrome — "app.egful.store says" — in the OS's own styling,
 * which lands in the middle of a themed app looking like a security warning. They also can't
 * carry any context beyond one string, and can't be styled at all.
 *
 * Two hooks, same shapes as the browser calls so sites read the same way:
 * const confirm = useConfirm()
 * if (await confirm({ title: "Cancel this card?", body: "…", confirmLabel: "Cancel card" })) { … }
 *
 * const prompt = usePrompt()
 * const note = await prompt({ title: "What needs changing?", multiline: true })
 * if (note == null) return          // Cancel → null, exactly like window.prompt
 */

export type ConfirmOptions = {
 title: string
  /** One sentence on what happens. Omit when the title says it all. */
 body?: string
  /** Names the ACTION ("Delete", "Cancel card") rather than "OK". */
 confirmLabel?: string
 cancelLabel?: string
  /** Red confirm button. On by default: this exists for destructive actions. */
 destructive?: boolean
}

export type PromptOptions = {
 title: string
  /** One sentence of context under the title. */
 body?: string
 placeholder?: string
 defaultValue?: string
 confirmLabel?: string
 cancelLabel?: string
  /** A multi-line note rather than a single field. */
 multiline?: boolean
  /** Block the confirm button until something is typed. Default true. */
 required?: boolean
}

type DialogState =
  | { kind: "confirm"; opts: ConfirmOptions }
  | { kind: "prompt"; opts: PromptOptions }

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null)
const PromptContext = createContext<((o: PromptOptions) => Promise<string | null>) | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const tl = useLabelT()
 const [state, setState] = useState<DialogState | null>(null)
 const [value, setValue] = useState("")
 const resolver = useRef<((v: boolean | string | null) => void) | null>(null)

 const confirm = useCallback((o: ConfirmOptions) => {
 setState({ kind: "confirm", opts: o })
 return new Promise<boolean>((resolve) => { resolver.current = resolve as (v: boolean | string | null) => void })
  }, [])

 const prompt = useCallback((o: PromptOptions) => {
 setValue(o.defaultValue ?? "")
 setState({ kind: "prompt", opts: o })
 return new Promise<string | null>((resolve) => { resolver.current = resolve as (v: boolean | string | null) => void })
  }, [])

 const settle = (v: boolean | string | null) => {
 setState(null)
    // Resolve AFTER clearing, so a caller that opens another dialog on confirm isn't
    // fighting this one's close animation.
 const r = resolver.current
 resolver.current = null
 r?.(v)
  }

 const isPrompt = state?.kind === "prompt"
 const promptOpts = state?.kind === "prompt" ? state.opts : null
 const confirmOpts = state?.kind === "confirm" ? state.opts : null
 const required = promptOpts?.required !== false
 const canSubmit = !isPrompt || !required || value.trim().length > 0

 return (
    <ConfirmContext.Provider value={confirm}>
      <PromptContext.Provider value={prompt}>
        {children}
        <Dialog open={!!state} onOpenChange={(v) => { if (!v) settle(isPrompt ? null : false) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {confirmOpts && confirmOpts.destructive !== false && (
                  <Warning size={17} weight="fill" className="shrink-0 text-hold" />
                )}
                {state?.opts.title}
              </DialogTitle>
            </DialogHeader>
            {state?.opts.body && <p className="px-1 text-sm text-muted-foreground">{state.opts.body}</p>}
            {isPrompt && (promptOpts?.multiline ? (
              <textarea
 autoFocus
 value={value}
 onChange={(e) => setValue(e.target.value)}
 placeholder={promptOpts?.placeholder}
 rows={3}
 className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            ) : (
              <Input
 autoFocus
 value={value}
 onChange={(e) => setValue(e.target.value)}
 placeholder={promptOpts?.placeholder}
 onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) { e.preventDefault(); settle(value.trim()) } }}
              />
            ))}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => settle(isPrompt ? null : false)}>
                {state?.opts.cancelLabel ?? (isPrompt ? tl("confirm", "Cancel") : tl("confirm", "Keep it"))}
              </Button>
              <Button
 size="sm"
 variant={confirmOpts && confirmOpts.destructive !== false ? "destructive" : "default"}
 disabled={!canSubmit}
 onClick={() => settle(isPrompt ? value.trim() : true)}
 autoFocus={!isPrompt}
              >
                {state?.opts.confirmLabel ?? (isPrompt ? tl("confirm", "Send") : tl("confirm", "Confirm"))}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PromptContext.Provider>
    </ConfirmContext.Provider>
  )
}

/** Falls back to window.confirm if no provider is mounted, so a call site can never
 * silently skip the confirmation and just do the destructive thing. */
export function useConfirm() {
 const ctx = useContext(ConfirmContext)
 return useCallback(
 async (o: ConfirmOptions) => (ctx ? ctx(o) : window.confirm([o.title, o.body].filter(Boolean).join("\n\n"))),
 [ctx]
  )
}

/** Falls back to window.prompt if no provider is mounted. Returns the trimmed text, or
 * null when cancelled — same contract as window.prompt. */
export function usePrompt() {
 const ctx = useContext(PromptContext)
 return useCallback(
 async (o: PromptOptions) => (ctx ? ctx(o) : window.prompt([o.title, o.body].filter(Boolean).join("\n\n"), o.defaultValue ?? "")),
 [ctx]
  )
}
