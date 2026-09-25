"use client"

// app/reports/page.tsx
//
// Отчёты (задача 8). Раньше страница показывала выдуманные числа: выручку
// «2.45М ₽», водителей «Александр Петров», заказы «156 выполнено» и «ИИ-отчёт»
// из зашитого текста. Теперь на странице один настоящий отчёт: период,
// деньги за период, разбор по числам, заказы, клиенты, водители, парк и оплаты.
//
// Данные — из GET /api/reports (см. components/reports/reports-view.tsx).

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { ReportsView } from "@/components/reports/reports-view"
import { Loader2 } from "lucide-react"

export default function ReportsPage() {
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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div
        className="transition-all duration-300 ease-in-out"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <main className="space-y-6 p-6">
          <div>
            <h1 className="text-2xl font-bold">Отчёты и аналитика</h1>
            <p className="text-muted-foreground">
              Реальные числа из заказов, рейсов, чеков водителей и оплат — с разбором и выгрузкой
            </p>
          </div>

          <ReportsView />
        </main>
      </div>
    </div>
  )
}
