// app/orders/page.tsx

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import Link from "next/link"
import { OrdersSandbox } from "@/components/orders/orders-sandbox"
import { TextParsePanel } from "@/components/orders/text-parse-panel"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Package, Bot, Loader2, Search } from "lucide-react"

export default function OrdersPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login")
    }
    // Водителей через этот логин больше нет, поэтому
    // редирект на /m тут не нужен.
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
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold">Заказы</h1>
              <p className="text-muted-foreground">
                Поиск → Согласование → Маршрут → Документы → Назначение → Контроль
              </p>
            </div>
            {/* Поиск грузов — по требованию, на отдельной странице: он не
                занимает постоянную вкладку и не уводит из заказов */}
            <Button asChild>
              <Link href="/search">
                <Search className="h-4 w-4 mr-2" />
                Найти груз
              </Link>
            </Button>
          </div>

          <Tabs defaultValue="orders" className="space-y-6">
            <TabsList className="bg-secondary w-full justify-start p-1">
              <TabsTrigger value="orders" className="gap-2 px-6">
                <Package className="h-4 w-4" />
                Мои заказы (Песочница)
              </TabsTrigger>

              <TabsTrigger value="parser" className="gap-2 px-6">
                <Bot className="h-4 w-4" />
                Заказ из текста
              </TabsTrigger>
            </TabsList>

            <TabsContent value="orders">
              <OrdersSandbox />
            </TabsContent>

            <TabsContent value="parser">
              <TextParsePanel />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}