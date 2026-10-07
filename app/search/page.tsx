// app/search/page.tsx
//
// Поиск грузов — отдельная страница «по требованию», а не постоянная вкладка на
// странице заказов (решение пользователя).
//
// Источник по умолчанию — своя накопленная база (AtiCache, её наполняют плановые
// сканы по расписанию). Живой запрос на ATI.su — явная вторая вкладка с
// предупреждением: он тратит лимиты токена и нужен только когда в своей базе
// ничего не нашлось.
//
// «Взять в работу» создаёт заказ организации на этапе «Поиск»
// (POST /api/orders/from-cache) — дальше заказ живёт в карточке /orders/[id].

"use client"

import { useEffect } from "react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { AtiSearchPanel } from "@/components/orders/ati-search-panel"
import { TruckLoader } from "@/components/ui/truck-loader"

export default function SearchPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login")
    }
  }, [user, isLoading, router])

  if (isLoading || !user) {
    // Подложка прозрачная: живой фон приложения виден и во время загрузки
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <TruckLoader className="text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className={cn("transition-all duration-300 ease-in-out", isCollapsed ? "lg:pl-20" : "lg:pl-64")}>
        <Header />
        <main className="p-4 lg:p-6 space-y-4 lg:space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="outline" size="icon" asChild>
                <Link href="/orders" aria-label="К заказам">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0">
                <h1 className="text-xl font-bold lg:text-2xl">Поиск грузов</h1>
                {/* Описание длинное — на телефоне оно занимало пол-экрана; там
                    оставляем короткую подсказку, полный текст читается на ПК. */}
                <p className="text-xs text-muted-foreground lg:hidden">
                  «Взять в работу» создаёт заказ на этапе «Поиск».
                </p>
                <p className="hidden text-muted-foreground lg:block">
                  Своя накопленная база — основной источник; живой ATI — по
                  необходимости. «Взять в работу» создаёт заказ на этапе «Поиск».
                </p>
              </div>
            </div>
          </div>

          <AtiSearchPanel />
        </main>
      </div>
    </div>
  )
}
