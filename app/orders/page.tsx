// app/orders/page.tsx

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { OrdersSandbox } from "@/components/orders/orders-sandbox"
import { AIParserDemo } from "@/components/orders/ai-parser-demo"
import { AtiSearchPanel } from "@/components/orders/ati-search-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Package, Bot, Loader2, Truck } from "lucide-react"

export default function OrdersPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/")
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
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">Заказы</h1>
              <p className="text-muted-foreground">
                Управление грузовыми заказами
              </p>
            </div>
          </div>

          <Tabs defaultValue="orders" className="space-y-6">
            <TabsList className="bg-secondary w-full justify-start p-1">
              <TabsTrigger value="orders" className="gap-2 px-6">
                <Package className="h-4 w-4" />
                Мои заказы (Песочница)
              </TabsTrigger>

              <TabsTrigger value="ati" className="gap-2 px-6">
                <Truck className="h-4 w-4" />
                ATI.SU Поиск
              </TabsTrigger>

              <TabsTrigger value="parser" className="gap-2 px-6">
                <Bot className="h-4 w-4" />
                AI импорт
              </TabsTrigger>
            </TabsList>

            <TabsContent value="orders">
              <OrdersSandbox />
            </TabsContent>

            <TabsContent value="ati">
              <AtiSearchPanel />
            </TabsContent>

            <TabsContent value="parser">
              <AIParserDemo />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}