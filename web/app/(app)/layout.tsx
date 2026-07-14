import { Sidebar } from "@/components/app/sidebar"
import { TopBar } from "@/components/app/topbar"
import { PageTransition } from "@/components/motion/page-transition"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-background">
      <Sidebar />
      <div className="md:pl-60">
        <TopBar />
        <main className="mx-auto max-w-[1600px] px-6 py-6 md:px-8">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  )
}
