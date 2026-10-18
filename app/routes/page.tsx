// app/routes/page.tsx
"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { cn } from "@/lib/utils"
import { ActiveRouteCard } from "@/components/routes/active-route-card"
import { RouteHistoryCard } from "@/components/routes/route-history-card"
import { AddLoadDialog } from "@/components/routes/add-load-dialog"
import { BackhaulDialog } from "@/components/routes/backhaul-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  RefreshCw,
  Route,
  CheckCircle2,
  Clock,
  Truck,
  Package,
  TrendingUp,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { MOVING_ORDER_STATUSES, type OrderStatus } from "@/lib/orders/stages"
import { normalizeRouteStatus, type RouteSummary } from "@/lib/routes/model"
import { fetchJsonCached, peekCache, invalidateCache } from "@/lib/client-cache"
import { CardsSkeleton } from "@/components/ui/skeletons"
import { TruckLoader } from "@/components/ui/truck-loader"

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
  stats: RouteSummary
  backhaul?: {
    endpointCity: string
    baseCity: string
    emptyReturnKm: number | null
    candidatesCount: number
  } | null
  fuelAudit?: {
    factL: number
    estimatedL: number
    diffPct: number | null
    flag: boolean
  } | null
  economics?: {
    revenueRub: number
    distanceKm: number
    factCostRub: number | null
    estimatedCostRub: number | null
    rubPerKmRevenue: number | null
    costPerKm: number | null
    profitRub: number | null
    basis: "fact" | "estimate" | null
    unprofitable: boolean
  } | null
  unprofitableOrderIds?: string[]
}

/** Статус рейса из БД → статус карточки на странице. */
function toCardStatus(routeStatus: string, orders: RouteOrder[]): string {
  if (routeStatus === "cancelled") return "cancelled"
  if (routeStatus === "completed") return "completed"
  // Сравнение идёт через normalizeRouteStatus: в базе могут лежать рейсы,
  // сохранённые старым написанием "in_progress", и они тоже «в пути».
  const status = normalizeRouteStatus(routeStatus)
  if (status === "in_transit" || status === "active") return "in_progress"
  // «В пути» — это когда заказ действительно в дороге: канон статусов заказа
  // объявлен в lib/orders/stages.ts (MOVING_ORDER_STATUSES = control).
  // Прежний список (in_transit / loading / unloading) — статусы старой модели,
  // их не бывает ни у одного заказа, поэтому рейс в пути выглядел ожидающим.
  if (orders.some((o) => MOVING_ORDER_STATUSES.includes(o.status as OrderStatus))) {
    return "in_progress"
  }
  return "pending"
}

/**
 * Ответ API → карточки страницы: считаем загрузку машины, прогресс и статус.
 * Чистая функция — её же вызываем из кеша, минуя сеть.
 */
function buildRouteCards(routes: ApiRoute[]): RouteData[] {
  return routes.map((route) => {
    const sortedOrders = [...route.orders].sort((a, b) => {
      if (a.routeSequence != null && b.routeSequence != null) {
        return a.routeSequence - b.routeSequence
      }
      return 0
    })

    // Форма stats — из summarizeRoute (lib/routes/model.ts): вес лежит в
    // cargoWeight, деньги — в revenue, доставленные заказы — deliveredOrders.
    const totalWeight = route.stats?.cargoWeight ?? 0
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
      ordersCount: route.stats?.totalOrders ?? sortedOrders.length,
      completedOrders: route.stats?.deliveredOrders ?? 0,
      totalDistance: route.stats?.totalDistance ?? 0,
      totalWeight,
      totalPrice: route.stats?.revenue ?? 0,
      availableCapacity,
      utilizationPercent:
        vehicleCapacity > 0 ? Math.round((totalWeight / vehicleCapacity) * 100) : 0,
      status: toCardStatus(route.status, sortedOrders),
      orders: sortedOrders,
      backhaul: route.backhaul ?? null,
      fuelAudit: route.fuelAudit ?? null,
      economics: route.economics ?? null,
      unprofitableOrderIds: route.unprofitableOrderIds ?? [],
    }
  })
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
  const [backhaulRoute, setBackhaulRoute] = useState<RouteData | null>(null)
  const [addLoadRoute, setAddLoadRoute] = useState<RouteData | null>(null)

  // ── История рейсов (вкладка «Завершённые») ──
  // Период и статус уходят на сервер: иначе «за неделю» пришлось бы выискивать
  // в последних 200 рейсах. Водитель, машина, поиск и сортировка — на клиенте,
  // потому что выборка уже загружена.
  const [period, setPeriod] = useState<"7" | "30" | "90" | "all">("30")
  const [historyStatus, setHistoryStatus] = useState<"any" | "completed" | "cancelled">("any")
  const [driverFilter, setDriverFilter] = useState("all")
  const [vehicleFilter, setVehicleFilter] = useState("all")
  const [sortOrder, setSortOrder] = useState<"new" | "old">("new")
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login")
    }
  }, [user, authLoading, router])

  /** Сколько рейсов грузим за раз: история листается «Показать ещё». */
  const PAGE_SIZE = 50

  /** Левая граница периода истории в формате YYYY-MM-DD (null — всё время). */
  const dateFrom = useMemo(() => {
    if (period === "all") return null
    const from = new Date()
    from.setDate(from.getDate() - Number(period))
    return from.toISOString().slice(0, 10)
  }, [period])

  // Рейсы читаются из таблицы Route (задача 2): один запрос вместо
  // «заказы лимитом 500 → группировка по routeId → два запроса за справочниками».
  const fetchRoutes = useCallback(
    async (options?: { force?: boolean; append?: boolean }) => {
      const statusFilter =
        activeTab === "active"
          ? "planned,active,in_transit"
          : historyStatus === "any"
            ? "completed,cancelled"
            : historyStatus
      const params = new URLSearchParams({ status: statusFilter, limit: String(PAGE_SIZE) })
      // Период истории считаем на сервере: у отменённого рейса может не быть
      // completedAt, и «за неделю» иначе пришлось бы собирать на клиенте.
      if (activeTab === "completed" && dateFrom) params.set("dateFrom", dateFrom)
      const baseUrl = `/api/routes?${params.toString()}`
      const nextOffset = options?.append ? routes.length : 0
      const url = nextOffset > 0 ? `${baseUrl}&offset=${nextOffset}` : baseUrl

      // Вкладка «Активные» и «Завершённые» — разные адреса, поэтому у каждой
      // свой кеш: переключение туда-обратно рисуется мгновенно.
      // force = «данные изменились»: сбрасываем все запросы рейсов, включая
      // списки фильтров на других страницах (фото, песочница)
      if (options?.force) invalidateCache("/api/routes")
      const known =
        options?.force || options?.append
          ? null
          : peekCache<{ routes?: ApiRoute[]; total?: number }>(url)
      if (known) {
        setRoutes(buildRouteCards(known.data.routes ?? []))
        setTotal(known.data.total ?? known.data.routes?.length ?? 0)
        setIsLoading(false)
      } else {
        if (options?.append) setLoadingMore(true)
        else setIsLoading(true)
      }

      try {
        const data = await fetchJsonCached<{
          success?: boolean
          error?: string
          routes?: ApiRoute[]
          total?: number
        }>(url, { force: options?.force })

        if (!data.success) {
          throw new Error(data.error || "Failed to fetch routes")
        }

        setTotal(data.total ?? 0)
        setRoutes((prev) => {
          const fresh = buildRouteCards(data.routes || [])
          return options?.append ? [...prev, ...fresh] : fresh
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Неизвестная ошибка"
        console.error("Failed to fetch routes:", message)
        toast.error(`Ошибка загрузки маршрутов: ${message}`)
      } finally {
        setIsLoading(false)
        setLoadingMore(false)
      }
    },
    [activeTab, historyStatus, dateFrom, routes.length],
  )

  useEffect(() => {
    if (!user) return

    void fetchRoutes()
    // Обновляем в фоне, но только когда вкладка видима: иначе десяток открытых
    // вкладок молотит один и тот же список
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchRoutes({ force: true })
    }, 30000)
    return () => clearInterval(interval)
  }, [user, fetchRoutes])

  // Водители и машины для фильтров истории — из уже загруженных рейсов:
  // отдельный справочник тянуть незачем, а вариантов «кто вёл рейсы» ровно столько.
  const driverOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const route of routes) {
      if (route.driverId && route.driverName) map.set(route.driverId, route.driverName)
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
  }, [routes])

  const vehicleOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const route of routes) {
      if (route.vehicleId && route.vehiclePlate) map.set(route.vehicleId, route.vehiclePlate)
    }
    return [...map.entries()]
      .map(([id, plate]) => ({ id, plate }))
      .sort((a, b) => a.plate.localeCompare(b.plate, "ru"))
  }, [routes])

  const filteredRoutes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const list = routes.filter((route) => {
      if (driverFilter !== "all" && route.driverId !== driverFilter) return false
      if (vehicleFilter !== "all" && route.vehicleId !== vehicleFilter) return false
      if (!q) return true
      return (
        route.driverName.toLowerCase().includes(q) ||
        route.vehiclePlate.toLowerCase().includes(q) ||
        (route.name ?? "").toLowerCase().includes(q) ||
        route.orders.some(
          (o) =>
            o.routeFrom?.toLowerCase().includes(q) ||
            o.routeTo?.toLowerCase().includes(q),
        )
      )
    })
    // В истории рейсы сортируются по дате завершения: сервер отдаёт по
    // createdAt, а человеку важно «когда рейс закрылся».
    if (activeTab !== "completed") return list
    return [...list].sort((a, b) => {
      const at = new Date(a.completedAt ?? a.startedAt ?? 0).getTime()
      const bt = new Date(b.completedAt ?? b.startedAt ?? 0).getTime()
      return sortOrder === "new" ? bt - at : at - bt
    })
  }, [routes, searchQuery, driverFilter, vehicleFilter, activeTab, sortOrder])

  /** Итоги по загруженной части истории — честно «показано», не «всего». */
  const historySummary = useMemo(() => {
    const delivered = filteredRoutes.reduce((sum, r) => sum + (r.completedOrders ?? 0), 0)
    const points = filteredRoutes.reduce((sum, r) => sum + (r.ordersCount ?? 0), 0)
    const revenue = filteredRoutes.reduce((sum, r) => sum + (r.totalPrice ?? 0), 0)
    return { delivered, points, revenue: Math.round(revenue) }
  }, [filteredRoutes])

  /** Есть ли активные фильтры истории — от них зависит текст пустого состояния. */
  const hasHistoryFilters =
    driverFilter !== "all" ||
    vehicleFilter !== "all" ||
    historyStatus !== "any" ||
    searchQuery.trim().length > 0

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
        <TruckLoader className="text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className={cn("transition-all duration-300", isCollapsed ? "lg:pl-20" : "lg:pl-64")}>
        <Header />
        <main className="space-y-6 p-4 lg:p-6">
          {/* Заголовок */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">
                {activeTab === "active" ? "Активные маршруты" : "История рейсов"}
              </h1>
              <p className="text-muted-foreground">
                {activeTab === "active"
                  ? "Управление рейсами и догрузами"
                  : "Завершённые и отменённые рейсы за выбранный период"}
              </p>
            </div>

            {/* Переключателя «список/карта» здесь нет намеренно: карта рейса
                живёт внутри карточки рейса (RouteSegmentsMap), а кнопка-заглушка
                «Карта в разработке» только путала — нажималась и ничего не делала. */}
          </div>

          {/* Статистика: для активных рейсов — занятость и загрузка, для
              истории — сколько рейсов и заказов в выборке. Плитки «Свободно» и
              «Загрузка» на завершённых рейсах не значат ничего. */}
          {activeTab === "active" ? (
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
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card p-4 text-[13px]">
              <span className="text-muted-foreground">
                Рейсов за период:{" "}
                <span className="font-semibold text-foreground tabular-nums">{total}</span>
              </span>
              <span className="text-muted-foreground">
                Загружено:{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {filteredRoutes.length}
                </span>
              </span>
              <span className="text-muted-foreground">
                Доставлено заказов:{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {historySummary.delivered}
                  {historySummary.points > 0 ? ` из ${historySummary.points}` : ""}
                </span>
              </span>
              <span className="text-muted-foreground">
                Выручка:{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {historySummary.revenue.toLocaleString("ru-RU")} ₽
                </span>
              </span>
            </div>
          )}

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
              onClick={() => void fetchRoutes({ force: true })}
              disabled={isLoading}
              aria-label="Обновить список маршрутов"
              title="Обновить список маршрутов"
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>

          {/* Фильтры истории: без них «Завершённые» — это одна простыня из
              последних рейсов, в которой нельзя ни выбрать период, ни отделить
              отменённые, ни посмотреть одного водителя. */}
          {activeTab === "completed" ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted-foreground">Период</span>
                <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
                  <SelectTrigger className="w-[140px]" aria-label="Период">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 дней</SelectItem>
                    <SelectItem value="30">30 дней</SelectItem>
                    <SelectItem value="90">90 дней</SelectItem>
                    <SelectItem value="all">всё время</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Select
                value={historyStatus}
                onValueChange={(v) => setHistoryStatus(v as typeof historyStatus)}
              >
                <SelectTrigger className="w-[160px]" aria-label="Статус рейса">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Завершённые и отменённые</SelectItem>
                  <SelectItem value="completed">Только завершённые</SelectItem>
                  <SelectItem value="cancelled">Только отменённые</SelectItem>
                </SelectContent>
              </Select>

              <Select value={driverFilter} onValueChange={setDriverFilter}>
                <SelectTrigger className="w-[190px]" aria-label="Водитель">
                  <SelectValue placeholder="Все водители" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все водители</SelectItem>
                  {driverOptions.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
                <SelectTrigger className="w-[150px]" aria-label="Машина">
                  <SelectValue placeholder="Все машины" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все машины</SelectItem>
                  {vehicleOptions.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as typeof sortOrder)}>
                <SelectTrigger className="w-[180px]" aria-label="Сортировка">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Сначала новые</SelectItem>
                  <SelectItem value="old">Сначала старые</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* Контент */}
          {isLoading ? (
            <CardsSkeleton count={3} className="xl:grid-cols-2" />
          ) : filteredRoutes.length === 0 ? (
            <div className="text-center py-20 bg-muted/30 rounded-xl border border-dashed">
              <Route className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium">
                {activeTab === "active" ? "Нет маршрутов" : "Рейсов за этот период нет"}
              </p>
              <p className="text-muted-foreground">
                {activeTab === "active"
                  ? "Оформите рейс в разделе Заказы"
                  : hasHistoryFilters
                    ? "Измените период или снимите фильтры — возможно, рейсы есть за другое время."
                    : "Завершённые рейсы появятся здесь после закрытия рейса."}
              </p>
            </div>
          ) : activeTab === "active" ? (
            <div className="stagger-in grid gap-4">
              {filteredRoutes.map((route) => (
                <ActiveRouteCard
                  key={route.id}
                  route={route}
                  onAddLoad={() => setAddLoadRoute(route)}
                  onBackhaul={() => setBackhaulRoute(route)}
                  onRefresh={() => void fetchRoutes({ force: true })}
                />
              ))}
            </div>
          ) : (
            <>
              {/* История: компактные карточки без кнопок действий, в две колонки
                  на широком экране — так рейсы сравниваются между собой. */}
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredRoutes.map((route) => (
                  <RouteHistoryCard key={route.id} route={route} />
                ))}
              </div>

              {routes.length < total ? (
                <div className="flex flex-col items-center gap-1.5">
                  <Button
                    variant="outline"
                    onClick={() => void fetchRoutes({ append: true })}
                    disabled={loadingMore}
                  >
                    {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Показать ещё ({routes.length} из {total})
                  </Button>
                  <p className="text-[12px] text-muted-foreground">
                    Грузим по {PAGE_SIZE} рейсов — длинный список открывается быстрее.
                  </p>
                </div>
              ) : (
                <p className="text-center text-[12.5px] text-muted-foreground">
                  Показаны все рейсы за выбранный период: {total}
                </p>
              )}
            </>
          )}
        </main>
      </div>

      <BackhaulDialog
        open={!!backhaulRoute}
        onOpenChange={(open) => !open && setBackhaulRoute(null)}
        route={backhaulRoute ? { id: backhaulRoute.id, vehiclePlate: backhaulRoute.vehiclePlate } : null}
        onSuccess={() => void fetchRoutes({ force: true })}
      />

      <AddLoadDialog
        open={!!addLoadRoute}
        onOpenChange={(open) => !open && setAddLoadRoute(null)}
        route={addLoadRoute}
        onSuccess={() => {
          setAddLoadRoute(null)
          void fetchRoutes({ force: true })
        }}
      />
    </div>
  )
}