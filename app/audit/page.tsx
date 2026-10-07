"use client"

// app/audit/page.tsx
//
// Журнал действий организации — только для админа. API /api/admin/audit
// существовал и писался, но своего экрана не имел: записи копились в БД
// и никто их не видел. Теперь видны, с фильтром по действию.

import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { AuditView } from "@/components/audit/audit-view"
import { TruckLoader } from "@/components/ui/truck-loader"

export default function AuditPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/")
    }
    if (!isLoading && user?.role === "driver") {
      router.push("/m")
    }
    // Журнал — только админу организации; логисту он не показывается
    if (!isLoading && user && user.role !== "admin") {
      router.push("/dashboard")
    }
  }, [user, isLoading, router])

  if (isLoading || !user || user.role !== "admin") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <TruckLoader className="text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className={cn("transition-all duration-300 ease-in-out", isCollapsed ? "lg:pl-20" : "lg:pl-64")}>
        <Header />
        <main className="space-y-4 lg:space-y-6 p-4 lg:p-6">
          <div>
            <h1 className="text-2xl font-bold">Журнал действий</h1>
            <p className="text-muted-foreground">
              Кто входил, кого приглашали и одобряли, что меняли — все действия в вашей организации
            </p>
          </div>

          <AuditView />
        </main>
      </div>
    </div>
  )
}
