// app/routes/page.tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { ActiveRouteCard } from "@/components/routes/active-route-card"
import { AddLoadDialog } from "@/components/routes/add-load-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import {
  Loader2,
  Search,
  RefreshCw,
  Route,
  CheckCircle2,
  Clock,
  Truck,
  Package,
  TrendingUp,
  Map,
  List,
  AlertCircle,
} from "lucide-react"
import { toast } from "sonner"

// ============================================
// ТИПЫ
// ============================================

interface RouteOrder {
  id: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  price: number
  cargoType: string
  status: string
  isAdditionalLoad?: boolean
  routeSequence?: number
  assignedDriverId?: string | null
  assignedVehicleId?: string | null
  routeId?: string
}

interface Driver {
  id: string
  name: string
  phone?: string
  status?: string
}

interface Vehicle {
  id: string
  plate: string
  type?: string
  capacity: number
}

interface RouteData {
  id: string
  driverName: string
  driverId: string | null
  vehiclePlate: string
  vehicleId: string | null
  ordersCount: number
  completedOrders: number
  totalDistance: number
  totalWeight: number
  totalPrice: number
  availableCapacity: number
  utilizationPercent: number
  status: string
  orders: RouteOrder[]
}

// ============================================
// КОМПОНЕНТ
// ============================================

export default function RoutesPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  const [routes, setRoutes] = useState<RouteData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"active" | "completed">("active")
  const [viewMode, setViewMode] = useState<"list" | "map">("list")
  const [addLoadRoute, setAddLoadRoute] = useState<RouteData | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/")
    }
  }, [user, authLoading, router])

  // ✅ ИСПРАВЛЕНО: Оптимизированная загрузка с bulk fetch
  const fetchRoutes = useCallback(async () => {
    setIsLoading(true)
    try {
      const statusFilter =
        activeTab === "active"
          ? "confirmed,in_transit,loading,unloading"
          : "delivered"

      const res = await fetch(`/api/orders?status=${statusFilter}&limit=500`)
      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || "Failed to fetch orders")
      }

      const orders: RouteOrder[] = data.orders || []

      // Группируем заказы по routeId
      const routeMap: Record<
        string,
        {
          id: string
          driverId: string | null
          vehicleId: string | null
          orders: RouteOrder[]
        }
      > = {}

      for (const order of orders) {
        if (!order.routeId) continue

        if (!routeMap[order.routeId]) {
          routeMap[order.routeId] = {
            id: order.routeId,
            driverId: order.assignedDriverId || null,
            vehicleId: order.assignedVehicleId || null,
            orders: [],
          }
        }

        routeMap[order.routeId].orders.push(order)
      }

      // ✅ Собираем уникальные ID водителей и транспорта
      const driverIds = new Set<string>()
      const vehicleIds = new Set<string>()

      Object.values(routeMap).forEach((route) => {
        if (route.driverId) driverIds.add(route.driverId)
        if (route.vehicleId) vehicleIds.add(route.vehicleId)
      })

      // ✅ Делаем ОДИН bulk-запрос для водителей и ОДИН для транспорта
      const [driversResponse, vehiclesResponse] = await Promise.all([
        driverIds.size > 0
          ? fetch(`/api/drivers?ids=${Array.from(driverIds).join(",")}`)
          : Promise.resolve(null),
        vehicleIds.size > 0
          ? fetch(`/api/vehicles?ids=${Array.from(vehicleIds).join(",")}`)
          : Promise.resolve(null),
      ])

      // Парсим ответы
      let driversMap: Record<string, Driver> = {}
      let vehiclesMap: Record<string, Vehicle> = {}

      if (driversResponse) {
        const driversData = await driversResponse.json()
        if (driversData.success && driversData.driversMap) {
          driversMap = driversData.driversMap
        }
      }

      if (vehiclesResponse) {
        const vehiclesData = await vehiclesResponse.json()
        if (vehiclesData.success && vehiclesData.vehiclesMap) {
          vehiclesMap = vehiclesData.vehiclesMap
        }
      }

      // ✅ Строим обогащённые маршруты без дополнительных запросов
      const enrichedRoutes: RouteData[] = []

      for (const routeId of Object.keys(routeMap)) {
        const routeData = routeMap[routeId]
        const sortedOrders = routeData.orders.sort((a, b) => {
          if (a.routeSequence != null && b.routeSequence != null) {
            return a.routeSequence - b.routeSequence
          }
          return 0
        })

        // ✅ Получаем данные из Map (O(1) вместо сетевого запроса)
        const driver = routeData.driverId
          ? driversMap[routeData.driverId]
          : null
        const vehicle = routeData.vehicleId
          ? vehiclesMap[routeData.vehicleId]
          : null

        const totalWeight = sortedOrders.reduce(
          (sum, o) => sum + (o.weight || 0),
          0
        )
        const vehicleCapacity = vehicle?.capacity || 0
        const availableCapacity = Math.max(0, vehicleCapacity - totalWeight)

        enrichedRoutes.push({
          id: routeId,
          driverName: driver?.name || "Не назначен",
          driverId: driver?.id || null,
          vehiclePlate: vehicle?.plate || "—",
          vehicleId: vehicle?.id || null,
          ordersCount: sortedOrders.length,
          completedOrders: sortedOrders.filter((o) => o.status === "delivered")
            .length,
          totalDistance: sortedOrders.reduce(
            (sum, o) => sum + (o.distance || 0),
            0
          ),
          totalWeight,
          totalPrice: sortedOrders.reduce((sum, o) => sum + (o.price || 0), 0),
          availableCapacity,
          utilizationPercent:
            vehicleCapacity > 0
              ? Math.round((totalWeight / vehicleCapacity) * 100)
              : 0,
          status: sortedOrders.some((o) =>
            ["in_transit", "loading", "unloading"].includes(o.status)
          )
            ? "in_progress"
            : sortedOrders.every((o) => o.status === "delivered")
              ? "completed"
              : "pending",
          orders: sortedOrders,
        })
      }

      setRoutes(enrichedRoutes)
    } catch (error) {
      console.error("Failed to fetch routes:", error)
      toast.error("Ошибка загрузки маршрутов")
    } finally {
      setIsLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    if (user) {
      fetchRoutes()
      const interval = setInterval(fetchRoutes, 30000)
      return () => clearInterval(interval)
    }
  }, [user, fetchRoutes])

  const filteredRoutes = routes.filter((route) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      route.driverName.toLowerCase().includes(q) ||
      route.vehiclePlate.toLowerCase().includes(q) ||
      route.orders.some(
        (o) =>
          o.routeFrom?.toLowerCase().includes(q) ||
          o.routeTo?.toLowerCase().includes(q)
      )
    )
  })

  const stats = {
    totalRoutes: routes.length,
    inProgress: routes.filter((r) => r.status === "in_progress").length,
    pending: routes.filter((r) => r.status === "pending").length,
    totalRevenue: routes.reduce((sum, r) => sum + r.totalPrice, 0),
    totalCapacity: routes.reduce((sum, r) => sum + r.availableCapacity, 0),
    avgUtilization:
      routes.length > 0
        ? Math.round(
            routes.reduce((sum, r) => sum + r.utilizationPercent, 0) /
              routes.length
          )
        : 0,
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className="transition-all duration-300"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <main className="p-6 space-y-6">
          {/* Заголовок */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">Активные маршруты</h1>
              <p className="text-muted-foreground">
                Управление рейсами и догрузами
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="icon"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "map" ? "default" : "outline"}
                size="icon"
                onClick={() => setViewMode("map")}
                disabled
                title="Карта в разработке"
              >
                <Map className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Статистика */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10">
                    <Route className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats.totalRoutes}</p>
                    <p className="text-xs text-muted-foreground">Всего</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-500/10">
                    <Truck className="h-5 w-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats.inProgress}</p>
                    <p className="text-xs text-muted-foreground">В пути</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-yellow-500/10">
                    <Clock className="h-5 w-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats.pending}</p>
                    <p className="text-xs text-muted-foreground">Ожидание</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    <TrendingUp className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {(stats.totalRevenue / 1000).toFixed(0)}К
                    </p>
                    <p className="text-xs text-muted-foreground">Выручка</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10">
                    <Package className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {(stats.totalCapacity / 1000).toFixed(1)}т
                    </p>
                    <p className="text-xs text-muted-foreground">Свободно</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-cyan-500/10">
                    <AlertCircle className="h-5 w-5 text-cyan-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats.avgUtilization}%</p>
                    <p className="text-xs text-muted-foreground">Загрузка</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Фильтры и поиск */}
          <div className="flex items-center gap-4 flex-wrap">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "active" | "completed")}
            >
              <TabsList>
                <TabsTrigger value="active" className="gap-2">
                  <Clock className="h-4 w-4" />
                  Активные ({stats.inProgress + stats.pending})
                </TabsTrigger>
                <TabsTrigger value="completed" className="gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Завершённые
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex-1" />

            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по маршрутам..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Button
              variant="outline"
              size="icon"
              onClick={fetchRoutes}
              disabled={isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>

          {/* Контент */}
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : filteredRoutes.length === 0 ? (
            <div className="text-center py-20 bg-muted/30 rounded-xl border border-dashed">
              <Route className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium">Нет маршрутов</p>
              <p className="text-muted-foreground">
                {activeTab === "active"
                  ? "Оформите рейс в разделе Заказы"
                  : "Завершённые маршруты появятся здесь"}
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredRoutes.map((route) => (
                <ActiveRouteCard
                  key={route.id}
                  route={route}
                  onAddLoad={() => setAddLoadRoute(route)}
                  onRefresh={fetchRoutes}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <AddLoadDialog
        open={!!addLoadRoute}
        onOpenChange={(open) => !open && setAddLoadRoute(null)}
        route={addLoadRoute}
        onSuccess={() => {
          setAddLoadRoute(null)
          fetchRoutes()
        }}
      />
    </div>
  )
}