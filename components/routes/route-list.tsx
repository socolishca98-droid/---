"use client"

import { useState } from "react"
import { RouteCard, type SuggestedRoute } from "./route-card"
import { RouteOptimizer } from "./route-optimizer"
import { mockRoutes, mockOrders } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, TrendingUp } from "lucide-react"

export function RouteList() {
  // mockRoutes в текущем mock-data типизирован как Route[] (из lib/types),
  // а UI RouteCard ожидает SuggestedRoute. Для MVP делаем явный мост через unknown.
  const [routes, setRoutes] = useState<SuggestedRoute[]>(
    mockRoutes as unknown as SuggestedRoute[],
  )

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastOptimized, setLastOptimized] = useState<string[] | null>(null)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await new Promise((resolve) => setTimeout(resolve, 800))
    setIsRefreshing(false)

    // MVP: пока просто триггерим перерендер (в будущем: пересчитать через API)
    setRoutes((prev) => [...prev])
  }

  const handleOptimize = (orderedOrderIds: string[]) => {
    // MVP: в реальном приложении здесь применяем порядок к маршруту/рейсу/песочнице.
    console.log("Optimized order sequence:", orderedOrderIds)
    setLastOptimized(orderedOrderIds)
  }

  const totalProfit = routes.reduce((sum, r) => sum + (r.estimatedProfit || 0), 0)
  const totalDistance = routes.reduce((sum, r) => sum + (r.totalDistance || 0), 0)

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          <Badge variant="secondary" className="px-3 py-1.5">
            <TrendingUp className="h-4 w-4 mr-2 text-success" />
            Потенциальная прибыль: {totalProfit.toLocaleString()} ₽
          </Badge>

          <Badge variant="outline" className="px-3 py-1.5">
            Общая дистанция: {totalDistance.toLocaleString()} км
          </Badge>

          {lastOptimized && (
            <Badge variant="outline" className="px-3 py-1.5">
              Последний порядок: {lastOptimized.join(" → ")}
            </Badge>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
          Пересчитать
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Route Optimizer */}
        <div className="lg:col-span-1">
          <RouteOptimizer orders={mockOrders as any} onOptimize={handleOptimize} />
        </div>

        {/* Routes Grid */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-lg font-semibold">Предложенные маршруты</h3>
          <div className="grid gap-4">
            {routes.map((route) => (
              <RouteCard key={route.id} route={route} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}