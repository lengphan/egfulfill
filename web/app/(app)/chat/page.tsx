"use client"

import { useEffect, useRef, useState } from "react"
import { PaperPlaneTilt } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Convo = { id: string; name: string; sub: string; last: string; time: string; unread: number }
type Msg = { me: boolean; text: string; time: string }

const CONVOS: Convo[] = [
  { id: "4142", name: "A. Nguyen", sub: "Order #4142", last: "Can you rush #4142?", time: "2m", unread: 2 },
  { id: "print", name: "Factory · Print", sub: "Production", last: "QC passed on batch 12", time: "1h", unread: 0 },
  { id: "4140", name: "M. Tran", sub: "Order #4140", last: "Thanks so much!", time: "3h", unread: 0 },
  { id: "support", name: "Support", sub: "Ticket #55", last: "Ticket #55 resolved", time: "1d", unread: 0 },
]

const THREADS: Record<string, Msg[]> = {
  "4142": [
    { me: false, text: "Hi! Any update on my hoodie order?", time: "10:02" },
    { me: true, text: "It's in production now — shipping tomorrow.", time: "10:04" },
    { me: false, text: "Can you rush #4142?", time: "10:06" },
    { me: true, text: "Sure, I've bumped it to the front of the queue.", time: "10:07" },
  ],
  print: [{ me: false, text: "QC passed on batch 12.", time: "09:12" }],
  "4140": [{ me: false, text: "Thanks so much!", time: "Yesterday" }],
  support: [{ me: false, text: "Ticket #55 resolved. Anything else?", time: "Mon" }],
}

export default function ChatPage() {
  const [activeId, setActiveId] = useState("4142")
  const [threads, setThreads] = useState<Record<string, Msg[]>>(THREADS)
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const active = CONVOS.find((c) => c.id === activeId) ?? CONVOS[0]
  const messages = threads[activeId] ?? []

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, activeId])

  const send = () => {
    const text = input.trim()
    if (!text) return
    const now = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    setThreads((prev) => ({ ...prev, [activeId]: [...(prev[activeId] ?? []), { me: true, text, time: now }] }))
    setInput("")
  }

  return (
    // Fill the viewport below the topbar (h-16) + main padding (py-6) → no dead space.
    <div className="flex h-[calc(100svh-7rem)] gap-4">
      {/* conversations */}
      <div className="hidden w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card sm:flex">
        <div className="border-b border-border px-4 py-3 font-semibold">Conversations</div>
        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {CONVOS.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={
                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent " +
                (c.id === activeId ? "bg-accent" : "")
              }
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                {c.name.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{c.time}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{c.last}</span>
              </span>
              {c.unread > 0 && (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {c.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* thread */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {active.name.charAt(0)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold">{active.name}</div>
            <div className="truncate text-xs text-muted-foreground">{active.sub}</div>
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {messages.map((m, i) => (
            <div key={i} className={"flex " + (m.me ? "justify-end" : "justify-start")}>
              <div className={"max-w-[72%] rounded-2xl px-3.5 py-2 text-sm " + (m.me ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {m.text}
                <span className={"ml-2 align-baseline text-[10px] " + (m.me ? "text-primary-foreground/60" : "text-muted-foreground")}>
                  {m.time}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border p-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Type a message…  (Enter to send)"
            className="h-10"
          />
          <Button size="icon" className="size-10" onClick={send} disabled={!input.trim()}>
            <PaperPlaneTilt size={16} weight="fill" />
          </Button>
        </div>
      </div>
    </div>
  )
}
