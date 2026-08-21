"use client"

import { useState } from "react"
import { OrdersList } from "@/components/app/orders-list"
import { SellerUploadHistory } from "@/components/app/seller-upload-history"
import { TabBar } from "@/components/app/tab-bar"

// The seller board: their live orders, and a chronological record of everything they've
// uploaded. Both surfaces show only the seller-facing status — never the factory pipeline.
export default function OrdersPage() {
  const [view, setView] = useState<"orders" | "history">("orders")
  return (
    <div className="space-y-4">
      <TabBar
        ariaLabel="Orders views"
        items={[{ id: "orders", label: "Orders" }, { id: "history", label: "Upload history" }]}
        value={view}
        onChange={setView}
      />
      {view === "orders" ? <OrdersList /> : <SellerUploadHistory />}
    </div>
  )
}
