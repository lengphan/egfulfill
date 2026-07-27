"use client"

import { useState } from "react"
import { OrdersList } from "@/components/app/orders-list"
import { SellerUploadHistory } from "@/components/app/seller-upload-history"

// The seller board: their live orders, and a chronological record of everything they've
// uploaded. Both surfaces show only the seller-facing status — never the factory pipeline.
export default function OrdersPage() {
  const [view, setView] = useState<"orders" | "history">("orders")
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full border border-border p-0.5 text-sm">
        {([["orders", "Orders"], ["history", "Upload history"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={"eg-tap rounded-full px-3 py-1 font-medium transition-colors " + (view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "orders" ? <OrdersList /> : <SellerUploadHistory />}
    </div>
  )
}
