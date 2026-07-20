"use client"

import { createContext, useCallback, useContext, useRef, useState } from "react"
import { Warning } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

/**
 * On-theme replacement for `window.confirm`.
 *
 * The native one renders browser chrome — "app.egful.store says" — in the OS's own styling,
 * which lands in the middle of a themed app looking like a security warning. It also can't
 * carry any context beyond one string.
 *
 * Kept deliberately small: a title, one sentence, two buttons. A destructive confirm is an
 * interruption, and the more it says the less of it gets read. Anything that needs
 * explaining beyond a sentence wants a real dialog, not this.
 *
 * Usage — same shape as window.confirm, so call sites read the same way:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: "Cancel this card?", body: "…", confirmLabel: "Cancel card" })) { … }
 */

export type ConfirmOptions = {
  title: string
  /** One sentence on what happens. Omit when the title says it all. */
  body?: string
  /** Names the ACTION ("Delete", "Cancel card") rather than "OK" — "OK" to a question
   *  starting "Cancel…" is genuinely ambiguous about which way it goes. */
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button. On by default: this exists for destructive actions. */
  destructive?: boolean
}

type Resolver = (ok: boolean) => void
const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<Resolver | null>(null)

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => { resolver.current = resolve })
  }, [])

  const settle = (ok: boolean) => {
    setOpts(null)
    // Resolve AFTER clearing, so a caller that opens another dialog on confirm isn't
    // fighting this one's close animation.
    const r = resolver.current
    resolver.current = null
    r?.(ok)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!opts} onOpenChange={(v) => { if (!v) settle(false) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {opts?.destructive !== false && <Warning size={17} weight="fill" className="shrink-0 text-amber-500" />}
              {opts?.title}
            </DialogTitle>
          </DialogHeader>
          {opts?.body && <p className="px-1 text-sm text-muted-foreground">{opts.body}</p>}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => settle(false)}>
              {opts?.cancelLabel ?? "Keep it"}
            </Button>
            <Button
              size="sm"
              variant={opts?.destructive === false ? "default" : "destructive"}
              onClick={() => settle(true)}
              autoFocus
            >
              {opts?.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

/** Falls back to window.confirm if no provider is mounted, so a call site can never
 *  silently skip the confirmation and just do the destructive thing. */
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  return useCallback(
    async (o: ConfirmOptions) => (ctx ? ctx(o) : window.confirm([o.title, o.body].filter(Boolean).join("\n\n"))),
    [ctx]
  )
}
