"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { FinancialOverview } from "@/components/reports/financial-overview"
import { DriverPerformance } from "@/components/reports/driver-performance"
import { OrdersAnalytics } from "@/components/reports/orders-analytics"
import { AIReportGenerator } from "@/components/reports/ai-report-generator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BarChart3, Users, Package, Bot, Loader2 } from "lucide-react"

export default function ReportsPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/")
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
          {/* Page Title */}
          <div>
            <h1 className="text-2xl font-bold">Отчёты и аналитика</h1>
            <p className="text-muted-foreground">
              Финансовая аналитика, эффективность водителей и AI-генерация отчётов
            </p>
          </div>

          <Tabs defaultValue="financial" className="space-y-6">
            <TabsList className="bg-secondary">
              <TabsTrigger value="financial" className="gap-2">
                <BarChart3 className="h-4 w-4" />
                Финансы
              </TabsTrigger>
              <TabsTrigger value="drivers" className="gap-2">
                <Users className="h-4 w-4" />
                Водители
              </TabsTrigger>
              <TabsTrigger value="orders" className="gap-2">
                <Package className="h-4 w-4" />
                Заказы
              </TabsTrigger>
              <TabsTrigger value="ai" className="gap-2">
                <Bot className="h-4 w-4" />
                AI-отчёты
              </TabsTrigger>
            </TabsList>

            <TabsContent value="financial">
              <FinancialOverview />
            </TabsContent>

            <TabsContent value="drivers">
              <DriverPerformance />
            </TabsContent>

            <TabsContent value="orders">
              <OrdersAnalytics />
            </TabsContent>

            <TabsContent value="ai">
              <AIReportGenerator />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}
