"use client"

// app/clients/page.tsx
//
// Клиентская база (задача 5): карточки, статистика, история заказов и импорт.

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { Header } from "@/components/header"
import { Sidebar } from "@/components/sidebar"
import { ClientsView } from "@/components/clients/clients-view"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"

export default function ClientsPage() {
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
        Загружаем клиентскую базу…
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className={`flex-1 ${isCollapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <Header />
        <main className="p-4 lg:p-6">
          <ClientsView />
        </main>
      </div>
    </div>
  )
}
