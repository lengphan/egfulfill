"use client"

import { useState } from "react"
import { setInternalNote } from "@/lib/api"

/**
 * THE FACTORY NOTE — `orders.internal_note`, staff only.
 *
 * The server strips it from every seller read, so this is where the floor writes what it
 * needs to remember about an order without telling the customer: re-hooping, waiting on
 * navy thread, the third reprint.
 *
 * ONE FIELD, OVERWRITTEN. It is not a log — there is no author and no history, and saving
 * replaces whatever was there. That is the right shape for "the thing to know about this
 * order" and the wrong shape for "what happened"; the order's activity thread is where a
 * sequence of events belongs.
 *
 * Lived privately inside orders-hub.tsx, so the order page — the screen where an order is
 * actually worked — had no factory note at all.
 */
export function InternalNote({ orderId, value }: { orderId: string; value: string }) {
  const [text, setText] = useState(value)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const save = async () => {
    if (text === value && state !== "error") return
    setState("saving")
    try { await setInternalNote(orderId, text); setState("saved") }
    catch { setState("error") }
  }
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-2">
        <span className="eg-label text-muted-foreground">Factory note</span>
        <span className="text-2xs text-muted-foreground">
          {state === "saving" ? "saving…" : state === "saved" ? "saved" : state === "error" ? "couldn't save" : "staff only"}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); if (state !== "idle") setState("idle") }}
        onBlur={save}
        rows={2}
        placeholder="e.g. re-hooping, waiting on navy thread…"
        className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs leading-relaxed"
      />
    </div>
  )
}
