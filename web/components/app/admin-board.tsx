"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ShieldCheck, CheckCircle, XCircle, CircleNotch, UserPlus, Plus, PencilSimple, Trash, Package as PackageIcon } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { StageBadge } from "@/components/app/stage-badge"
import { ProductEditorDialog } from "@/components/app/product-editor-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  getOrders, getUsers, updateUserAdmin, createUserAdmin, getAudit, getTopups, confirmTopup, rejectTopup,
  getCatalogProducts, saveCatalogProducts,
  type OrderRow, type AdminUser, type AuditRow, type TopupRequest, type CatalogProduct,
} from "@/lib/api"

const prodImg = (p: CatalogProduct) => p.img || p.image || p.hero || p.images?.[0] || (p.colorImages ? Object.values(p.colorImages).find(Boolean) || "" : "") || ""
const prodPrice = (p: CatalogProduct) => Number(p.price ?? p.basePrice ?? p.base_price ?? 0) || 0
import { getToken } from "@/lib/auth"
import { orderStage } from "@/lib/factory-status"

const ROLES = ["seller", "operator", "warehouse", "designer", "admin"]
const usd = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const numOf = (o: OrderRow) => (o.seq ? `#${o.seq}` : o.id)
const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
const fmtDateTime = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

export function AdminBoard() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [topups, setTopups] = useState<TopupRequest[]>([])
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [editing, setEditing] = useState<CatalogProduct | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // New-user form
  const [nu, setNu] = useState({ email: "", password: "", role: "operator" })
  const [nuErr, setNuErr] = useState<string | null>(null)

  const loadTopups = useCallback(() => {
    getTopups("pending").then((r) => setTopups(r ?? [])).catch(() => setTopups([]))
  }, [])
  const loadUsers = useCallback(() => {
    getUsers().then((r) => setUsers(r ?? [])).catch(() => setUsers([]))
  }, [])

  useEffect(() => {
    const id = setTimeout(() => {
      if (!getToken()) return
      getOrders().then((r) => setOrders(r ?? [])).catch(() => {})
      getCatalogProducts().then((r) => setProducts(r ?? [])).catch(() => {})
      loadUsers()
      loadTopups()
    }, 0)
    return () => clearTimeout(id)
  }, [loadUsers, loadTopups])

  // Whole-catalog persist on any product add/edit/delete.
  const persistProducts = (next: CatalogProduct[]) => { setProducts(next); saveCatalogProducts(next).catch(() => {}) }
  const saveProduct = (p: CatalogProduct) => {
    const exists = products.some((x) => x.id === p.id)
    persistProducts(exists ? products.map((x) => (x.id === p.id ? p : x)) : [p, ...products])
  }
  const deleteProduct = (id: CatalogProduct["id"]) => persistProducts(products.filter((x) => x.id !== id))

  const stats = useMemo(() => {
    const shipped = orders.filter((o) => orderStage(o.items ?? []) === "shipped").length
    return {
      orders: orders.length,
      open: orders.length - shipped,
      sellers: users.filter((u) => u.role === "seller").length,
      staff: users.filter((u) => u.role !== "seller").length,
      pending: topups.length,
    }
  }, [orders, users, topups])

  const changeRole = async (u: AdminUser, role: string) => {
    setBusy(u.id)
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)))
    try { await updateUserAdmin(u.id, { role }) } catch { loadUsers() } finally { setBusy(null) }
  }

  const addUser = async () => {
    if (!nu.email.trim() || nu.password.length < 8) { setNuErr("Email/username and a password of 8+ characters are required."); return }
    setBusy("new"); setNuErr(null)
    try {
      const r = await createUserAdmin({ email: nu.email.trim(), password: nu.password, role: nu.role })
      if (r.error) throw new Error(r.error)
      setNu({ email: "", password: "", role: "operator" })
      loadUsers()
    } catch (e) {
      setNuErr(e instanceof Error ? e.message : "Couldn't create the user.")
    } finally {
      setBusy(null)
    }
  }

  const reviewTopup = async (t: TopupRequest, action: "confirm" | "reject") => {
    setBusy(t.id)
    setTopups((prev) => prev.filter((x) => x.id !== t.id))
    try { await (action === "confirm" ? confirmTopup(t.id) : rejectTopup(t.id)) } catch { loadTopups() } finally { setBusy(null) }
  }

  const onActivityTab = () => {
    if (audit === null) getAudit({ limit: 200 }).then((r) => setAudit(r ?? [])).catch(() => setAudit([]))
  }

  const recentOrders = orders.slice(0, 12)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck size={18} weight="fill" /></span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">Everything across sellers, staff, and money.</p>
        </div>
      </div>

      <StatGrid>
        <StatCard label="Orders" value={String(stats.orders)} sub={`${stats.open} open`} />
        <StatCard label="Sellers" value={String(stats.sellers)} sub="accounts" />
        <StatCard label="Staff" value={String(stats.staff)} sub="operator / warehouse / admin" />
        <StatCard label="Pending top-ups" value={String(stats.pending)} sub="awaiting review" tone={stats.pending ? "neg" : undefined} />
      </StatGrid>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="topups">Top-ups{stats.pending ? ` (${stats.pending})` : ""}</TabsTrigger>
          <TabsTrigger value="activity" onClick={onActivityTab}>Activity</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <SectionCard title="Recent orders" description="Across all sellers">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Store</TableHead>
                  <TableHead>Stage</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No orders yet</TableCell></TableRow>
                ) : recentOrders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs font-medium">{numOf(o)}</TableCell>
                    <TableCell className="font-medium">{o.customer?.name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{o.store || o.source || "manual"}</TableCell>
                    <TableCell><StageBadge status={orderStage(o.items ?? [])} /></TableCell>
                    <TableCell className="text-right tabular-nums">{usd(Number(o.total) || 0)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtDate(o.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>

        {/* Users */}
        <TabsContent value="users">
          <SectionCard title="New staff / user" description="Create an account with a role (username or email login)">
            <div className="flex flex-wrap items-end gap-2 p-5">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Email / username</span>
                <Input value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} placeholder="ops@egful.store" className="h-9" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Password</span>
                <Input type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="8+ characters" className="h-9" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Role</span>
                <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm capitalize">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <Button size="sm" onClick={addUser} disabled={busy === "new"}>
                {busy === "new" ? <CircleNotch size={14} className="animate-spin" /> : <><UserPlus size={14} weight="bold" /> Create</>}
              </Button>
              {nuErr && <span className="w-full text-sm text-destructive">{nuErr}</span>}
            </div>
          </SectionCard>

          <SectionCard title="Users" description="Change a role inline">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Joined</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">No users</TableCell></TableRow>
                ) : users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name || u.store_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value)}
                        disabled={busy === u.id}
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm capitalize"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtDate(u.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>

        {/* Products */}
        <TabsContent value="products">
          <SectionCard
            title="Catalog products"
            description="What sellers browse and the Design Maker uses as blanks. Upload a mockup image per product."
            actions={<Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true) }}><Plus size={14} weight="bold" /> New product</Button>}
          >
            {products.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
                <PackageIcon size={22} weight="duotone" />
                <div className="font-medium text-foreground">No products yet</div>
                <div className="text-sm">Add your first blank — with a mockup image — for sellers and the maker.</div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Product</TableHead><TableHead>Type</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="w-24" /></TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={String(p.id)}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="relative size-9 shrink-0 overflow-hidden rounded-md bg-muted">
                            {prodImg(p) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={prodImg(p)} alt="" className="size-full object-contain" />
                            ) : (
                              <div className="flex size-full items-center justify-center text-muted-foreground/40"><PackageIcon size={14} weight="duotone" /></div>
                            )}
                          </div>
                          <span className="font-medium">{p.name || "Untitled"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.type || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.method || "—"}</TableCell>
                      <TableCell><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{p.status || "Active"}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{usd(prodPrice(p))}</TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => { setEditing(p); setEditorOpen(true) }} aria-label="Edit"><PencilSimple size={14} /></Button>
                        <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-red-600" onClick={() => deleteProduct(p.id)} aria-label="Delete"><Trash size={14} /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        {/* Top-ups */}
        <TabsContent value="topups">
          <SectionCard title="Pending top-ups" description="Confirm credits the seller's wallet; reject leaves it untouched">
            {topups.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">No pending top-ups 🎉</div>
            ) : (
              <div className="divide-y divide-border">
                {topups.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <div className="font-semibold tabular-nums">{usd(Number(t.amount_usd) || 0)} <span className="text-sm font-normal text-muted-foreground">· {t.method || "transfer"}</span></div>
                      <div className="text-xs text-muted-foreground">{t.ref ? `Ref ${t.ref} · ` : ""}{fmtDateTime(t.created_at)}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => reviewTopup(t, "reject")} disabled={busy === t.id} className="text-red-600 hover:text-red-700">
                        <XCircle size={14} weight="bold" /> Reject
                      </Button>
                      <Button size="sm" onClick={() => reviewTopup(t, "confirm")} disabled={busy === t.id}>
                        {busy === t.id ? <CircleNotch size={14} className="animate-spin" /> : <><CheckCircle size={14} weight="bold" /> Confirm &amp; credit</>}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity">
          <SectionCard title="Activity log" description="Audited actions across the platform">
            {audit === null ? (
              <div className="flex items-center justify-center py-14 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
            ) : audit.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">No activity recorded yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((a) => (
                    <TableRow key={String(a.id)}>
                      <TableCell className="text-muted-foreground">{fmtDateTime(a.ts)}</TableCell>
                      <TableCell>{a.actor || "—"}{a.actor_role ? <span className="text-xs text-muted-foreground"> · {a.actor_role}</span> : null}</TableCell>
                      <TableCell className="font-mono text-xs">{a.action}</TableCell>
                      <TableCell className="text-muted-foreground">{a.entity_type ? `${a.entity_type} ${a.entity_id ?? ""}` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      <ProductEditorDialog open={editorOpen} onOpenChange={setEditorOpen} product={editing} onSave={saveProduct} newIdSeed={orders.length + products.length + 1000} />
    </div>
  )
}
