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
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"

import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { AtiSearchPanel } from "@/components/orders/ati-search-panel"

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
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className="transition-all duration-300 ease-in-out"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <main className="p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" asChild>
                <Link href="/orders" aria-label="К заказам">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Поиск грузов</h1>
                <p className="text-muted-foreground">
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
