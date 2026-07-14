import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

function Field({ label, defaultValue, type = "text" }: { label: string; defaultValue?: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Input defaultValue={defaultValue} type={type} />
    </label>
  )
}

export default function SettingsPage() {
  return (
    <Tabs defaultValue="profile" className="space-y-4">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <SectionCard title="Profile" description="Your account and store details">
          <div className="grid max-w-2xl gap-4 p-5 sm:grid-cols-2">
            <Field label="Full name" defaultValue="Phan My Linh" />
            <Field label="Email" defaultValue="phanmylinh04@gmail.com" type="email" />
            <Field label="Store name" defaultValue="EGFULFILL" />
            <Field label="Phone" defaultValue="+84 90 000 0000" />
          </div>
          <div className="border-t border-border px-5 py-4">
            <Button>Save changes</Button>
          </div>
        </SectionCard>
      </TabsContent>

      <TabsContent value="billing">
        <SectionCard title="Billing" description="Wallet, invoices and payout methods">
          <div className="p-5 text-sm text-muted-foreground">
            Manage funds on the <span className="font-medium text-foreground">Wallet</span> page. Linked payout
            accounts and invoices appear here.
          </div>
        </SectionCard>
      </TabsContent>

      <TabsContent value="team">
        <SectionCard
          title="Team"
          description="Members and access"
          actions={<Button size="sm">Invite member</Button>}
        >
          <div className="p-5 text-sm text-muted-foreground">No team members yet.</div>
        </SectionCard>
      </TabsContent>

      <TabsContent value="notifications">
        <SectionCard title="Notifications" description="How you hear from us">
          <div className="p-5 text-sm text-muted-foreground">Email and in-app notification preferences.</div>
        </SectionCard>
      </TabsContent>
    </Tabs>
  )
}
