"use client"

// app/reports/time/page.tsx
//
// Отчёт «Время водителей»: сколько водители ехали, грузили, выгружали, ждали
// и отдыхали. Числа измерены кнопками в приложении водителя, а не придуманы
// по нормативам — поэтому по ним можно спорить с водителем и с клиентом.
//
// Данные — из GET /api/reports/shift-time (см. components/reports/driver-time-view.tsx).

import { useEffect } from "react"

import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { DriverTimeView } from "@/components/reports/driver-time-view"
import { TruckLoader } from "@/components/ui/truck-loader"

export default function DriverTimePage() {
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
            <h1 className="text-2xl font-bold">Время водителей</h1>
            <p className="text-muted-foreground">
              Путь, погрузка, выгрузка, простои и отдых — по отметкам водителей в приложении
            </p>
          </div>

          <DriverTimeView />
        </main>
      </div>
    </div>
  )
}
