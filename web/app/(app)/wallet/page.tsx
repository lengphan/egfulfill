import { Plus, ArrowLineDown, DownloadSimple, Bank } from "@phosphor-icons/react/dist/ssr"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const kpis = [
  { label: "Available balance", value: "$12,480.00", sub: "Ready for fulfillment", tone: "pos" as const },
  { label: "Fulfillment charges", value: "$6,284", sub: "↓ 4.2% vs last month", tone: "pos" as const },
  { label: "Total deposited", value: "$5,444", sub: "4 deposits this period", tone: "mut" as const },
  { label: "Orders charged", value: "47", sub: "$133.70 avg charge", tone: "mut" as const },
]

type Tx = {
  date: string
  desc: string
  ref: string
  txid: string
  method: string
  type: "Deposit" | "Charge" | "Refund"
  amount: number
  balance: number
}

const txns: Tx[] = [
  { date: "Apr 12", desc: "Bank transfer", ref: "ACH ·2231", txid: "TXN-88201", method: "ACH", type: "Deposit", amount: 500, balance: 12480 },
  { date: "Apr 11", desc: "Hoodie · black", ref: "Order #4142", txid: "TXN-88190", method: "Wallet", type: "Charge", amount: -63.75, balance: 11980 },
  { date: "Apr 11", desc: "Tee · 2-pack", ref: "Order #4140", txid: "TXN-88188", method: "Wallet", type: "Charge", amount: -27, balance: 12043.75 },
  { date: "Apr 10", desc: "Reprint credit", ref: "Order #4088", txid: "TXN-88170", method: "Wallet", type: "Refund", amount: 12, balance: 12070.75 },
  { date: "Apr 09", desc: "Card ·4417", ref: "Visa", txid: "TXN-88155", method: "Card", type: "Deposit", amount: 250, balance: 12090.25 },
]

const fmt = (n: number) =>
  `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const typeTone: Record<Tx["type"], string> = {
  Deposit: "bg-emerald-100 text-emerald-700",
  Refund: "bg-emerald-100 text-emerald-700",
  Charge: "bg-muted text-muted-foreground",
}

export default function WalletPage() {
  return (
    <div className="space-y-4">
      {/* action row */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline">
          <Bank size={16} /> Manage Linked Accounts
        </Button>
        <Button variant="outline">
          <ArrowLineDown size={16} /> Withdraw
        </Button>
        <Button>
          <Plus size={16} weight="bold" /> Add Funds
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-0 p-5">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              {k.label}
            </div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">{k.value}</div>
            <div
              className={
                "mt-1.5 text-[12.5px] font-medium " +
                (k.tone === "pos" ? "text-emerald-600" : "text-muted-foreground")
              }
            >
              {k.sub}
            </div>
          </Card>
        ))}
      </div>

      {/* Transaction history */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="text-[15px] font-bold">Transaction History</div>
            <div className="text-[13px] text-muted-foreground">
              Deposits and fulfillment charges — All Banks, Apr 2026
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="deposits">Deposits</TabsTrigger>
                <TabsTrigger value="charges">Charges</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm">
              <DownloadSimple size={14} /> Export CSV
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Transaction ID</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {txns.map((t) => (
              <TableRow key={t.txid}>
                <TableCell className="text-muted-foreground">{t.date}</TableCell>
                <TableCell className="font-medium">{t.desc}</TableCell>
                <TableCell className="text-muted-foreground">{t.ref}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{t.txid}</TableCell>
                <TableCell className="text-muted-foreground">{t.method}</TableCell>
                <TableCell>
                  <Badge className={typeTone[t.type]} variant="secondary">
                    {t.type}
                  </Badge>
                </TableCell>
                <TableCell
                  className={
                    "text-right font-semibold tabular-nums " +
                    (t.amount >= 0 ? "text-emerald-600" : "text-foreground")
                  }
                >
                  {fmt(t.amount)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  ${t.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
