import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const convos = [
  { name: "A. Nguyen", last: "Can you rush #4142?", time: "2m", active: true, unread: 2 },
  { name: "Factory · Print", last: "QC passed on batch 12", time: "1h", active: false, unread: 0 },
  { name: "M. Tran", last: "Thanks so much!", time: "3h", active: false, unread: 0 },
  { name: "Support", last: "Ticket #55 resolved", time: "1d", active: false, unread: 0 },
]

const thread = [
  { me: false, text: "Hi! Any update on my hoodie order?", time: "10:02" },
  { me: true, text: "It's in production now — shipping tomorrow.", time: "10:04" },
  { me: false, text: "Can you rush #4142?", time: "10:06" },
  { me: true, text: "Sure, I've bumped it to the front of the queue.", time: "10:07" },
]

export default function ChatPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <SectionCard title="Conversations" bodyClassName="divide-y divide-border">
        {convos.map((c) => (
          <button
            key={c.name}
            className={"flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent " + (c.active ? "bg-accent" : "")}
          >
            <span className="size-9 shrink-0 rounded-full bg-muted" aria-hidden />
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
      </SectionCard>

      <SectionCard title="A. Nguyen" description="Order #4142" bodyClassName="flex h-[540px] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {thread.map((m, i) => (
            <div key={i} className={"flex " + (m.me ? "justify-end" : "justify-start")}>
              <div
                className={
                  "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm " +
                  (m.me ? "bg-primary text-primary-foreground" : "bg-muted")
                }
              >
                {m.text}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border p-3">
          <Input placeholder="Type a message…" className="h-10" />
          <Button size="icon" className="size-10">
            <PaperPlaneTilt size={16} weight="fill" />
          </Button>
        </div>
      </SectionCard>
    </div>
  )
}
