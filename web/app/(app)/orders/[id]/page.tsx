"use client"

import { useParams } from "next/navigation"
import { OrderDetail } from "@/components/app/order-detail"

/* The full-page frame. The order itself lives in components/app/order-detail.tsx so the order
   lists' side panel can render the same component — see order-panel.tsx. */
export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  return <OrderDetail id={decodeURIComponent(String(params?.id ?? ""))} />
}
