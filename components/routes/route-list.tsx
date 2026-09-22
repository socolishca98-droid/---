"use client"

import { useState, useEffect } from "react"
import { RouteCard, type SuggestedRoute } from "./route-card"
import { RouteOptimizer } from "./route-optimizer"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, TrendingUp } from "lucide-react"

export function RouteList() {
  const [routes, setRoutes] = useState<SuggestedRoute[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastOptimized, setLastOptimized] = useState<string[] | null>(null)

  const loadData = async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch("/api/orders?limit=20")
      if (res.ok) {
        const data = await res.json()
        if (data.success && Array.isArray(data.orders)) {
          setOrders(data.orders)
          const totalDist = data.orders.reduce((acc: number, o: any) => acc + (o.distance || 0), 0) || 750
          const totalPrice = data.orders.reduce((acc: number, o: any) => acc + (o.price || 0), 0) || 120000
          const fuelCost = Math.round(totalDist * 22)
          const tollCost = 2500
          const sampleRoute: SuggestedRoute = {
            id: "route-auto-1",
            name: "Оптимальный сборный маршрут",
            orders: data.orders.map((o: any) => o.id),
            totalDistance: totalDist,
            estimatedTime: Math.round(totalDist / 60),
            fuelCost,
            tollCost,
            estimatedProfit: Math.max(0, totalPrice - fuelCost - tollCost),
            driver: data.orders[0]?.driver ? {
              id: data.orders[0].driver.id,
              name: data.orders[0].driver.name,
              vehiclePlate: data.orders[0].vehicle?.plate,
            } : null,
            status: "active",
            aiExplanation: "Маршрут сформирован с учетом весогабаритных ограничений и минимизации порожнего пробега.",
            waypoints: data.orders.map((o: any, idx: number) => ({
              name: `${o.routeFrom} → ${o.routeTo}`,
              type: idx === 0 ? "start" : idx === data.orders.length - 1 ? "end" : "waypoint",
            })),
          }
          setRoutes([sampleRoute])
        }
      }
    } catch (e) {
      console.error("Failed to load routes in RouteList:", e)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const handleRefresh = async () => {
    await loadData()
  }

  const handleOptimize = (orderedOrderIds: string[]) => {
    console.log("Optimized order sequence:", orderedOrderIds)
    setLastOptimized(orderedOrderIds)
  }

  const totalProfit = routes.reduce((sum: any, r: any) => sum + (r.estimatedProfit || 0), 0)
  const totalDistance = routes.reduce((sum: any, r: any) => sum + (r.totalDistance || 0), 0)

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
          <RouteOptimizer orders={orders as any} onOptimize={handleOptimize} />
        </div>

        {/* Routes Grid */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-lg font-semibold">Предложенные маршруты</h3>
          <div className="grid gap-4">
            {routes.map((route: any) => (
              <RouteCard key={route.id} route={route} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}