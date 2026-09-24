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
  /** имя рейса из таблицы Route: «Ярославль → Иваново» */
  name?: string | null
  /** статус рейса из таблицы Route: planned | active | in_transit | completed | cancelled */
  routeStatus?: string
  startedAt?: string | null
  completedAt?: string | null
  notes?: string | null
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
  /** статус для карточки: pending | in_progress | completed | cancelled */
  status: string
  orders: RouteOrder[]
}

interface ApiRoute {
  id: string
  name: string | null
  status: string
  startedAt: string | null
  completedAt: string | null
  notes: string | null
  driver: { id: string; name: string; phone?: string; status?: string } | null
  vehicle: { id: string; plate: string; type?: string; capacity?: number } | null
  orders: RouteOrder[]
  stats: {
    totalDistance: number
    totalWeight: number
    totalPrice: number
    completedOrders: number
  }
}

/** Статус рейса из БД → статус карточки на странице. */
function toCardStatus(routeStatus: string, orders: RouteOrder[]): string {
  if (routeStatus === "cancelled") return "cancelled"
  if (routeStatus === "completed") return "completed"
  if (routeStatus === "in_transit" || routeStatus === "active") return "in_progress"
  if (orders.some((o) => ["in_transit", "loading", "unloading"].includes(o.status))) {
    return "in_progress"
  }
  return "pending"
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
      router.replace("/login")
    }
  }, [user, authLoading, router])

  // Рейсы читаются из таблицы Route (задача 2): один запрос вместо
  // «заказы лимитом 500 → группировка по routeId → два запроса за справочниками».
  const fetchRoutes = useCallback(async () => {
    setIsLoading(true)
    try {
      const statusFilter =
        activeTab === "active"
          ? "planned,active,in_transit"
          : "completed,cancelled"

      const res = await fetch(`/api/routes?status=${statusFilter}&limit=200`, {
        cache: "no-store",
      })
      const data = (await res.json()) as {
        success?: boolean
        error?: string
        routes?: ApiRoute[]
      }

      if (!data.success) {
        throw new Error(data.error || "Failed to fetch routes")
      }

      const enrichedRoutes: RouteData[] = (data.routes || []).map((route) => {
        const sortedOrders = [...route.orders].sort((a, b) => {
          if (a.routeSequence != null && b.routeSequence != null) {
            return a.routeSequence - b.routeSequence
          }
          return 0
        })

        const totalWeight = route.stats?.totalWeight ?? 0
        const vehicleCapacity = route.vehicle?.capacity || 0
        const availableCapacity = Math.max(0, vehicleCapacity - totalWeight)

        return {
          id: route.id,
          name: route.name,
          routeStatus: route.status,
          startedAt: route.startedAt,
          completedAt: route.completedAt,
          notes: route.notes,
          driverName: route.driver?.name || "Не назначен",
          driverId: route.driver?.id || null,
          vehiclePlate: route.vehicle?.plate || "—",
          vehicleId: route.vehicle?.id || null,
          ordersCount: sortedOrders.length,
          completedOrders: route.stats?.completedOrders ?? 0,
          totalDistance: route.stats?.totalDistance ?? 0,
          totalWeight,
          totalPrice: route.stats?.totalPrice ?? 0,
          availableCapacity,
          utilizationPercent:
            vehicleCapacity > 0
              ? Math.round((totalWeight / vehicleCapacity) * 100)
              : 0,
          status: toCardStatus(route.status, sortedOrders),
          orders: sortedOrders,
        }
      })

      setRoutes(enrichedRoutes)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка"
      console.error("Failed to fetch routes:", message)
      toast.error(`Ошибка загрузки маршрутов: ${message}`)
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
    <div className="min-h-screen">
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
            <div className="stagger-in grid gap-4">
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