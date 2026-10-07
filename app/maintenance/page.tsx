"use client"

// app/maintenance/page.tsx
//
// Обслуживание и документы машин: сроки ТО, страховки и техосмотра по парку
// + журнал работ с ценами. У водителя свой экран (m/maintenance) — здесь
// сводная картина для организатора.

import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { MaintenanceView } from "@/components/maintenance/maintenance-view"
import { TruckLoader } from "@/components/ui/truck-loader"

export default function MaintenancePage() {
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
  }, [user, isLoading, router])

  if (isLoading || !user) {
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
            <h1 className="text-2xl font-bold">Обслуживание и документы</h1>
            <p className="text-muted-foreground">
              Сроки ТО, страховки и техосмотра по парку, журнал работ и их стоимость
            </p>
          </div>

          <MaintenanceView />
        </main>
      </div>
    </div>
  )
}
