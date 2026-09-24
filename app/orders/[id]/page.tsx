// app/orders/[id]/page.tsx
//
// Полная карточка заказа: этапы процесса, сводка, согласование и торг, лента
// переговоров. Тот же контент, что и в выдвижной панели песочницы
// (components/orders/order-process.tsx) — там для быстрых действий, здесь для
// глубокой работы с заказом.

"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"

import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { OrderProcess } from "@/components/orders/order-process"

export default function OrderPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const orderId = params?.id

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login")
    }
  }, [user, isLoading, router])

  if (isLoading || !user || !orderId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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
        <main className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" asChild>
                <Link href="/orders" aria-label="К списку заказов">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Карточка заказа</h1>
                <p className="text-muted-foreground text-sm">
                  Поиск → Согласование → Маршрут → Документы → Назначение → Контроль
                </p>
              </div>
            </div>
          </div>

          <div className="max-w-4xl">
            <OrderProcess orderId={orderId} />
          </div>
        </main>
      </div>
    </div>
  )
}
