"use client"

// app/payments/page.tsx
//
// Оплаты (задача 6): реальные данные заказов, напоминания о просрочке,
// должники по клиентам и выгрузка для бухгалтерии.

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { Header } from "@/components/header"
import { Sidebar } from "@/components/sidebar"
import { PaymentsView } from "@/components/payments/payments-view"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"

export default function PaymentsPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) router.push("/")
    if (!isLoading && user?.role === "driver") router.push("/m")
  }, [user, isLoading, router])

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Загружаем оплаты…
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className={`flex-1 ${isCollapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <Header />
        <main className="p-4 lg:p-6">
          <PaymentsView />
        </main>
      </div>
    </div>
  )
}
