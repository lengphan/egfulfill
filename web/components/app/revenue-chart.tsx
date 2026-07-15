"use client"

import { useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { SectionCard } from "@/components/app/section-card"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

export type RevenuePoint = { label: string; revenue: number; prev: number }

const DATA: Record<string, RevenuePoint[]> = {
  "7d": [
    { label: "Mon", revenue: 1240, prev: 980 },
    { label: "Tue", revenue: 1580, prev: 1120 },
    { label: "Wed", revenue: 1320, prev: 1360 },
    { label: "Thu", revenue: 1890, prev: 1440 },
    { label: "Fri", revenue: 2310, prev: 1720 },
    { label: "Sat", revenue: 1760, prev: 1510 },
    { label: "Sun", revenue: 1420, prev: 1180 },
  ],
  "4w": [
    { label: "W1", revenue: 9800, prev: 8600 },
    { label: "W2", revenue: 11200, prev: 9100 },
    { label: "W3", revenue: 10400, prev: 9900 },
    { label: "W4", revenue: 13100, prev: 10200 },
  ],
  "3m": [
    { label: "Wk 1", revenue: 9800, prev: 8600 },
    { label: "Wk 3", revenue: 11200, prev: 9100 },
    { label: "Wk 5", revenue: 10400, prev: 9900 },
    { label: "Wk 7", revenue: 13100, prev: 10200 },
    { label: "Wk 9", revenue: 12200, prev: 11000 },
    { label: "Wk 11", revenue: 14800, prev: 11800 },
  ],
}

const chartConfig = {
  revenue: { label: "This period", color: "var(--chart-1)" },
  prev: { label: "Previous", color: "var(--chart-2)" },
} satisfies ChartConfig

export function RevenueChart({ data: dataProp }: { data?: Record<string, RevenuePoint[]> }) {
  const source = dataProp ?? DATA
  const [period, setPeriod] = useState<string>("4w")
  const [compare, setCompare] = useState(false)
  const data = source[period] ?? []

  return (
    <SectionCard
      title="Revenue"
      description="Gross revenue across your stores"
      actions={
        <>
          <label className="mr-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={compare} onCheckedChange={setCompare} />
            Compare
          </label>
          <ToggleGroup
            value={[period]}
            onValueChange={(v) => v[0] && setPeriod(v[0])}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="7d">7d</ToggleGroupItem>
            <ToggleGroupItem value="4w">4 weeks</ToggleGroupItem>
            <ToggleGroupItem value="3m">3 months</ToggleGroupItem>
          </ToggleGroup>
        </>
      }
      bodyClassName="p-4"
    >
      <ChartContainer config={chartConfig} className="h-[260px] w-full">
        <AreaChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
          <defs>
            <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="fillPrev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-prev)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--color-prev)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {compare && (
            <Area
              dataKey="prev"
              type="natural"
              fill="url(#fillPrev)"
              stroke="var(--color-prev)"
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          )}
          <Area
            dataKey="revenue"
            type="natural"
            fill="url(#fillRevenue)"
            stroke="var(--color-revenue)"
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    </SectionCard>
  )
}
