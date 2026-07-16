import { CircleNotch } from "@phosphor-icons/react"

// One simple, consistent "waiting for the API" state used across result pages.
export function Loading({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={"flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground " + (className ?? "")}>
      <CircleNotch size={24} className="animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}
