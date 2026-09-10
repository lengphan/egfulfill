"use client"

import { useState } from "react"
import { MagnifyingGlass, Plus, UploadSimple, Columns, Funnel, DownloadSimple, Printer, CaretDown } from "@phosphor-icons/react"
import { TabBar } from "@/components/app/tab-bar"
import { SearchField } from "@/components/app/search-field"
import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/app/section-card"

/**
 * THREE TOOLBAR GRAMMARS, THE SAME THREE PAGES, SIDE BY SIDE.
 *
 * The problem this exists to settle: Orders, Dispatch and Shipments each put search, filters,
 * columns and the row tally somewhere different, so a control changes surface or shape
 * depending on which tab you are on. Describing the options is cheap and useless — the only
 * way to judge a toolbar is to see the same page drawn three ways.
 *
 * A MOCK, DELIBERATELY. No fetching, no state that matters, nothing wired. It uses the REAL
 * primitives — TabBar, SearchField, Button, SectionCard — so the type, spacing and active
 * treatments are the ones that will ship; only the data is invented. That keeps the question
 * about layout rather than about whether the data loaded.
 *
 * The function table at the bottom is the other half of the job: a layout that looks tidy by
 * dropping a control is not a candidate, so every control is listed against every option.
 */

type PageKey = "orders" | "dispatch" | "shipments"

/** What each page actually has to fit. Taken from the real screens, counts included, so no
 *  option gets to look good by being shown an easier page than it will meet. */
const PAGES: Record<PageKey, {
  title: string
  search: string
  filters: { id: string; label: string; count?: number; disabled?: boolean }[]
  actions: { label: string; icon?: typeof Plus; primary?: boolean }[]
  tools: { columns?: boolean; filters?: boolean; tally?: string }
}> = {
  orders: {
    title: "Production queue",
    search: "Search orders…",
    filters: [
      { id: "all", label: "All" }, { id: "open", label: "Open" },
      { id: "rush", label: "Rush" }, { id: "overdue", label: "Overdue", count: 1055 },
      { id: "draft", label: "Draft" }, { id: "pending", label: "Pending" },
      { id: "approved", label: "Approved" }, { id: "working", label: "Working" },
      { id: "shipped", label: "Shipped" }, { id: "hold", label: "Hold" },
    ],
    actions: [{ label: "Import", icon: UploadSimple }, { label: "New order", icon: Plus, primary: true }],
    tools: { columns: true, filters: true, tally: "1,111 orders" },
  },
  dispatch: {
    title: "Dispatch",
    search: "Search order, customer…",
    filters: [
      { id: "all", label: "All" }, { id: "here", label: "To scan here", count: 24 },
      { id: "partner", label: "With byeastside" }, { id: "unsent", label: "Not sent yet", disabled: true },
      { id: "external", label: "External" },
    ],
    actions: [{ label: "Print", icon: Printer }, { label: "Add label PDF" }, { label: "More" }],
    tools: { columns: true },
  },
  shipments: {
    title: "Shipments",
    search: "Tracking, order, customer or carrier…",
    filters: [
      { id: "all", label: "All" }, { id: "transit", label: "In transit" },
      { id: "stuck", label: "Not collected", count: 18 }, { id: "delivered", label: "Delivered" },
      { id: "problem", label: "Needs a look" }, { id: "unchecked", label: "Not asked yet" },
      { id: "refunded", label: "Refunded" }, { id: "test", label: "Test", disabled: true },
    ],
    actions: [{ label: "Export CSV", icon: DownloadSimple }, { label: "Rate check" }, { label: "New label", icon: Plus, primary: true }],
    tools: { columns: true, tally: "124 shown · 18 not collected" },
  },
}

function Actions({ page, size = "sm" }: { page: PageKey; size?: "sm" | "default" }) {
  return (
    <>
      {PAGES[page].actions.map((a) => (
        <Button key={a.label} size={size} variant={a.primary ? "default" : "outline"} className="shrink-0">
          {a.icon ? <a.icon size={14} weight="bold" /> : null}
          {a.label}
          {a.label === "More" || a.label === "Print" ? <CaretDown size={12} weight="bold" className="opacity-60" /> : null}
        </Button>
      ))}
    </>
  )
}

/** Columns / Filters / tally — the row-level tools, in one order everywhere so the eye learns
 *  where to look once. */
function Tools({ page }: { page: PageKey }) {
  const t = PAGES[page].tools
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {t.tally && <span className="text-xs tabular-nums text-muted-foreground">{t.tally}</span>}
      {t.filters && <Button size="sm" variant="outline"><Funnel size={14} /> Filters</Button>}
      {t.columns && <Button size="sm" variant="outline"><Columns size={14} /> Columns</Button>}
    </div>
  )
}

function Filters({ page }: { page: PageKey }) {
  const [v, setV] = useState("all")
  return (
    <TabBar
      /* THE TOOLS WRAP, THEY DO NOT SQUEEZE — measured, not assumed.
         Forcing one row (min-w-0 flex-1 on this bar) does keep "1,111 orders · Filters ·
         Columns" on the same line, and the cost is the filter bar scrolling: at 1366 minus
         the sidebar, Orders then reads "…Approved Workin" and Shipments "…Not asked ye",
         cut mid-word. A filter you cannot read is worse than a tools row on its own line,
         so the bar keeps its width and the tools drop below when there is no room. Five
         filters still share the row; ten do not, and that is the honest outcome. */
      size="sm" spacing="none" className="border-b-0" ariaLabel={`${page} filters`}
      value={v} onChange={setV}
      items={PAGES[page].filters.map((f) => ({ id: f.id, label: f.label, count: f.count, disabled: f.disabled }))}
    />
  )
}

function Rows() {
  return (
    <div className="divide-y divide-border/60 border-t border-border">
      {["#4166391079", "#4167173796", "#4167173464"].map((n, i) => (
        <div key={n} className="grid grid-cols-[10rem_1fr_10rem] gap-4 px-5 py-2.5 text-sm">
          <span className="font-medium tabular-nums">{n}</span>
          <span className="text-muted-foreground">{["Gracie Vigen", "Gaurav Law", "Mariana Amadou"][i]}</span>
          <span className="tabular-nums text-muted-foreground">{["Converse, TX", "Durham, NC", "Aurora, CO"][i]}</span>
        </div>
      ))}
    </div>
  )
}

/** A — the page header owns search and the actions; the card owns filters and tools. */
function OptionA({ page }: { page: PageKey }) {
  const [q, setQ] = useState("")
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} onClear={() => setQ("")} width="md" placeholder={PAGES[page].search} />
        <Actions page={page} />
      </div>
      <TabBar size="md" value="this" onChange={() => {}} ariaLabel="page" items={[{ id: "this", label: PAGES[page].title }, { id: "b", label: "Other tab" }]} />
      <SectionCard>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <Filters page={page} />
          <Tools page={page} />
        </div>
        <Rows />
      </SectionCard>
    </div>
  )
}

/** B — the card header owns everything: title, search, actions. The page header stays empty. */
function OptionB({ page }: { page: PageKey }) {
  const [q, setQ] = useState("")
  return (
    <div className="space-y-3">
      <TabBar size="md" value="this" onChange={() => {}} ariaLabel="page" items={[{ id: "this", label: PAGES[page].title }, { id: "b", label: "Other tab" }]} />
      <SectionCard
        title={PAGES[page].title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SearchField value={q} onChange={setQ} onClear={() => setQ("")} width="md" placeholder={PAGES[page].search} />
            <Actions page={page} />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <Filters page={page} />
          <Tools page={page} />
        </div>
        <Rows />
      </SectionCard>
    </div>
  )
}

/** C — one rail. Filters, search and tools share a single row inside the card; only the
 *  primary action sits up in the page header. */
function OptionC({ page }: { page: PageKey }) {
  const [q, setQ] = useState("")
  const primary = PAGES[page].actions.find((a) => a.primary) ?? PAGES[page].actions[0]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <TabBar size="md" className="flex-1" value="this" onChange={() => {}} ariaLabel="page" items={[{ id: "this", label: PAGES[page].title }, { id: "b", label: "Other tab" }]} />
        <Button size="sm" className="shrink-0">
          {primary.icon ? <primary.icon size={14} weight="bold" /> : null}{primary.label}
        </Button>
      </div>
      <SectionCard>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <Filters page={page} />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <SearchField value={q} onChange={setQ} onClear={() => setQ("")} width="sm" placeholder="Search…" />
            {PAGES[page].actions.filter((a) => a !== primary).map((a) => (
              <Button key={a.label} size="sm" variant="outline" className="shrink-0">
                {a.icon ? <a.icon size={14} weight="bold" /> : null}{a.label}
              </Button>
            ))}
            <Tools page={page} />
          </div>
        </div>
        <Rows />
      </SectionCard>
    </div>
  )
}

const OPTIONS = [
  { id: "a", name: "A · Header actions", note: "Search and every action in the page header. The card holds filters and row tools only.", render: OptionA },
  { id: "b", name: "B · Card header", note: "The card owns its title, search and actions. Nothing sits above the tabs.", render: OptionB },
  { id: "c", name: "C · One rail", note: "Filters, search and tools share one row. Only the primary action is promoted to the header.", render: OptionC },
] as const

/** Every control on every page, against every option. A layout that looks tidy by dropping a
 *  control is not a candidate, so this is the half that decides it. */
const FUNCTIONS: { control: string; a: string; b: string; c: string }[] = [
  { control: "Search", a: "Page header", b: "Card header", c: "Filter row, right" },
  { control: "Primary action (New order / New label)", a: "Page header", b: "Card header", c: "Page header" },
  { control: "Secondary actions (Import, Export, Rate check, Print, More)", a: "Page header", b: "Card header", c: "Filter row, right" },
  { control: "Status filters", a: "Filter row", b: "Filter row", c: "Filter row, left" },
  { control: "Counts on unresolved filters", a: "On the filter", b: "On the filter", c: "On the filter" },
  { control: "Columns menu", a: "Filter row, right", b: "Filter row, right", c: "Filter row, right" },
  { control: "Advanced Filters (orders only)", a: "Filter row, right", b: "Filter row, right", c: "Filter row, right" },
  { control: "Row tally (“1,111 orders”)", a: "Filter row, right", b: "Filter row, right", c: "Filter row, right" },
  { control: "Page tabs (Dispatch / Shipments / Rates)", a: "Under the actions", b: "Above the card", c: "Shares a row with the primary action" },
  { control: "Bulk bar (Select all, Send to byeastside)", a: "Appears in the filter row when rows are picked", b: "Same", c: "Same" },
]

export default function ToolbarPreview() {
  const [opt, setOpt] = useState<"a" | "b" | "c">("a")
  const Render = OPTIONS.find((o) => o.id === opt)!.render
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Toolbar grammar · three options</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The same three pages drawn three ways. Mock data, real primitives — the type, spacing
          and active states are the ones that would ship. Pick one and it becomes the rule for
          every list in the app.
        </p>
      </div>

      <TabBar
        size="md" ariaLabel="Toolbar options" value={opt} onChange={(v) => setOpt(v as "a" | "b" | "c")}
        items={OPTIONS.map((o) => ({ id: o.id, label: o.name }))}
      />
      <p className="-mt-3 text-sm text-muted-foreground">{OPTIONS.find((o) => o.id === opt)!.note}</p>

      {(["orders", "dispatch", "shipments"] as PageKey[]).map((p) => (
        <div key={p} className="space-y-2">
          <div className="eg-label text-muted-foreground">{p}</div>
          <div className="rounded-xl bg-muted/30 p-4">
            <Render page={p} />
          </div>
        </div>
      ))}

      <div className="space-y-2">
        <div className="eg-label text-muted-foreground">Nothing is lost</div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left eg-label text-muted-foreground">
                <th className="px-4 py-2">Control</th>
                <th className="px-4 py-2">A</th>
                <th className="px-4 py-2">B</th>
                <th className="px-4 py-2">C</th>
              </tr>
            </thead>
            <tbody>
              {FUNCTIONS.map((f) => (
                <tr key={f.control} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2">{f.control}</td>
                  <td className="px-4 py-2 text-muted-foreground">{f.a}</td>
                  <td className="px-4 py-2 text-muted-foreground">{f.b}</td>
                  <td className="px-4 py-2 text-muted-foreground">{f.c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <MagnifyingGlass size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          Two decisions this settles, whichever wins: <span className="text-foreground">search has one home</span> —
          it is in the page header on Dispatch and Shipments today and in the card header on Orders,
          and it cannot be both — and <span className="text-foreground">the row tally has one home</span>,
          which is the right end of the filter row, beside the tools that also describe the list.
        </p>
      </div>
    </div>
  )
}
