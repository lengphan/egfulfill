"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { PaperPlaneTilt, Headset, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrderMessages, postOrderMessage, getMe, type ChatEntry } from "@/lib/api"
import { getUser, getToken } from "@/lib/auth"

const fmtTime = (ts?: number) => {
  if (!ts) return ""
  const d = new Date(ts)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

export default function ChatPage() {
  // The seller's own support thread rides on order_messages under `support-<sellerId>`.
  const [threadId, setThreadId] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [messages, setMessages] = useState<ChatEntry[] | null>(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const myName = getUser()?.name || "You"

  // Resolve the thread id (from the stored user, falling back to /api/me).
  useEffect(() => {
    let alive = true
    const id = setTimeout(async () => {
      if (!getToken()) { setSignedOut(true); return }
      let uid = getUser()?.id
      if (!uid) {
        try { uid = (await getMe()).sub } catch {}
      }
      if (!alive) return
      if (uid) setThreadId(`support-${uid}`)
      else setSignedOut(true)
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [])

  const load = useCallback(async () => {
    if (!threadId) return
    try {
      const r = await getOrderMessages(threadId)
      setMessages(Array.isArray(r) ? r : [])
    } catch {
      setMessages((prev) => prev ?? [])
    }
  }, [threadId])

  // Initial load + light polling while the page is open.
  useEffect(() => {
    if (!threadId) return
    const t = setTimeout(load, 0)
    const iv = setInterval(load, 5000)
    return () => { clearTimeout(t); clearInterval(iv) }
  }, [threadId, load])

  // Auto-scroll to newest.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages?.length])

  const send = async () => {
    const text = input.trim()
    if (!text || !threadId || sending) return
    setSending(true)
    setInput("")
    const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setMessages((prev) => [...(prev ?? []), { id: clientId, role: "seller", by: myName, text, ts: Date.now() }])
    try {
      await postOrderMessage(threadId, text, { clientId, by: myName })
      await load()
    } catch {
      /* keep the optimistic bubble; polling will reconcile */
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100svh-7rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Headset size={18} weight="duotone" />
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold">EGFULFILL Support</div>
          <div className="truncate text-xs text-muted-foreground">Typically replies within a couple of hours</div>
        </div>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {signedOut ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            Sign in to chat with support.
          </div>
        ) : messages === null ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <CircleNotch size={22} className="animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Headset size={22} weight="duotone" />
            </span>
            <div className="font-medium">How can we help?</div>
            <div className="max-w-xs text-sm text-muted-foreground">Ask about an order, billing, integrations — anything. We&apos;ll get back to you here.</div>
          </div>
        ) : (
          messages.map((m) => {
            const mine = (m.role ?? "seller") === "seller"
            return (
              <div key={String(m.id)} className={"flex flex-col " + (mine ? "items-end" : "items-start")}>
                <div className={"max-w-[75%] rounded-2xl px-3.5 py-2 text-sm " + (mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {m.text}
                </div>
                <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                  {!mine ? `${m.by || "Support"} · ` : ""}
                  {fmtTime(m.ts)}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* composer */}
      <div className="flex items-center gap-2 border-t border-border p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={signedOut ? "Sign in to send a message" : "Type a message…  (Enter to send)"}
          disabled={signedOut || !threadId}
          className="h-10"
        />
        <Button size="icon" className="size-10" onClick={send} disabled={signedOut || !threadId || !input.trim() || sending}>
          <PaperPlaneTilt size={16} weight="fill" />
        </Button>
      </div>
    </div>
  )
}
