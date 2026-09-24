// components/routes/active-route-card.tsx

"use client"

import { useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Truck,
  User,
  MapPin,
  Package,
  Plus,
  ChevronDown,
  ChevronUp,
  Route,
  Weight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RouteOptimizer, type RouteOptimizerOrder } from "@/components/routes/route-optimizer"
import { RouteCrewDialog } from "@/components/routes/route-crew-dialog"
import {
  calculateAllCoefficients,
  calculateRiskFactors,
  calculateRouteCost,
  formatDuration as formatEtaDuration,
  type ETARequest,
  type RiskLevel,
} from "@/lib/eta"
import { RouteTimeline } from "@/components/routes/route-timeline"
import {
  isOrderClosed,
  isOrderMoving,
  normalizeOrderStatus,
  orderStatusLabel,
} from "@/lib/orders/stages"
import dynamic from "next/dynamic"

// leaflet работает только в браузере, поэтому карта подключается лениво
const RouteSegmentsMap = dynamic(
  () => import("@/components/routes/route-segments-map").then((mod) => mod.RouteSegmentsMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[320px] items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Загрузка карты…
      </div>
    ),
  },
)

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
  status: string
  orders: any[]
}

interface ActiveRouteCardProps {
  route: RouteData
  onAddLoad: () => void
  onRefresh: () => void
}

type RouteEtaPreview = {
  durationBaseSec: number
  durationWithTrafficSec: number
  riskLevel: RiskLevel
  delayProbability: number
  fuelCost: number
  tollsCost: number
  totalCost: number
}

function buildRouteEtaPreview(route: RouteData): RouteEtaPreview | null {
  if (!route.totalDistance || route.totalDistance <= 0) return null

  const distanceKm = route.totalDistance
  const totalWeightKg = route.totalWeight
  const baseSpeedKmH = 60

  const durationBaseSec = (distanceKm / baseSpeedKmH) * 3600

  const etaRequest: ETARequest = {
    origin: { lat: 0, lng: 0 },
    destination: { lat: 0, lng: 0 },
    departureTime: new Date(),
    cargo: {
      weight: totalWeightKg / 1000,
      type: "standard",
    },
    vehicle: {
      type: "truck",
    },
    useCache: false,
  }

  const coeffs = calculateAllCoefficients(etaRequest, distanceKm)
  const durationWithTrafficSec = Math.round(durationBaseSec * coeffs.total)
  const risk = calculateRiskFactors(coeffs, etaRequest, distanceKm)
  const cost = calculateRouteCost(distanceKm, etaRequest.vehicle)

  return {
    durationBaseSec: Math.round(durationBaseSec),
    durationWithTrafficSec,
    riskLevel: risk.level,
    delayProbability: risk.delayProbability,
    fuelCost: cost.fuel,
    tollsCost: cost.tolls,
    totalCost: cost.total,
  }
}

export function ActiveRouteCard({ route, onAddLoad, onRefresh }: ActiveRouteCardProps) {
  const [expanded, setExpanded] = useState(false)
  /** Карта грузится по требованию: за ней стоят внешние запросы (Nominatim/OSRM) */
  const [showMap, setShowMap] = useState(false)

  const [showOptimizer, setShowOptimizer] = useState(false)
  const [showCrew, setShowCrew] = useState(false)
  const [applyingOptimizer, setApplyingOptimizer] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const progress =
    route.ordersCount > 0 ? Math.round((route.completedOrders / route.ordersCount) * 100) : 0

  const hasCapacity = route.availableCapacity > 1000 // > 1 тонны
  const additionalLoads = route.orders.filter((o: any) => o.isAdditionalLoad).length

  const optimizableOrders = useMemo(() => {
    const excluded = new Set(["delivered", "cancelled", "rejected"])
    return (route.orders || []).filter(
      (o: any) => !excluded.has(String(o.status || "").toLowerCase()),
    )
  }, [route.orders])

  const defaultSelectedOrderIds = useMemo(() => {
    return optimizableOrders.map((o: any) => String(o.id)).filter(Boolean)
  }, [optimizableOrders])

  const canOptimize = optimizableOrders.length >= 2

  const eta = useMemo(() => buildRouteEtaPreview(route), [route])

  const handleApplyOptimized = async (orderedOrderIds: string[]) => {
    if (!orderedOrderIds || orderedOrderIds.length < 2) {
      toast.message("Нужно минимум 2 точки для оптимизации")
      return
    }

    const deliveredMaxSeq = (route.orders || [])
      .filter((o: any) => String(o.status || "").toLowerCase() === "delivered")
      .map((o: any) => (typeof o.routeSequence === "number" ? o.routeSequence : 0))
      .reduce((max: number, v: number) => Math.max(max, v), 0)

    const startSeq = Math.max(1, deliveredMaxSeq + 1)

    setApplyingOptimizer(true)
    try {
      const orderSequence = orderedOrderIds.map((orderId: any, idx: any) => ({
        orderId,
        sequence: startSeq + idx,
      }))

      const res = await fetch(`/api/routes/${route.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderSequence }),
      })

      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!data?.success) {
        throw new Error(data?.error || "Не удалось применить порядок")
      }

      toast.success("Порядок точек обновлён")
      setShowOptimizer(false)
      onRefresh()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Ошибка применения оптимизации")
    } finally {
      setApplyingOptimizer(false)
    }
  }

  const handleCompleteRoute = async () => {
    if (isCompleting || isCancelling) return

    if (!window.confirm("Завершить рейс? Все незавершённые точки будут помечены как 'доставлено'.")) {
      return
    }

    setIsCompleting(true)
    try {
      const res = await fetch(`/api/routes/${route.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      })

      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось завершить рейс")
      }

      toast.success("Рейс завершён")
      onRefresh()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Ошибка завершения рейса")
    } finally {
      setIsCompleting(false)
    }
  }

  const handleCancelRoute = async () => {
    if (isCancelling || isCompleting) return

    if (
      !window.confirm(
        "Отменить рейс? Все заказы в маршруте будут помечены как 'cancelled', водитель и ТС освободятся.",
      )
    ) {
      return
    }

    setIsCancelling(true)
    try {
      const res = await fetch(`/api/routes/${route.id}`, {
        method: "DELETE",
      })

      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось отменить маршрут")
      }

      toast.success("Маршрут отменён")
      onRefresh()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Ошибка отмены маршрута")
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div
            className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 flex-1">
                <div className="p-3 rounded-xl bg-orange-500/10">
                  <Truck className="h-6 w-6 text-orange-500" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold">{route.vehiclePlate}</span>
                    <Badge
                      variant={route.status === "in_progress" ? "default" : "secondary"}
                      className={cn(route.status === "in_progress" && "bg-orange-500")}
                    >
                      {route.status === "in_progress" ? "В пути" : "Ожидает"}
                    </Badge>
                    {additionalLoads > 0 && (
                      <Badge
                        variant="outline"
                        className="text-purple-500 border-purple-500/30"
                      >
                        +{additionalLoads} догруз
                      </Badge>
                    )}
                    {eta && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          eta.riskLevel === "low" &&
                            "text-emerald-500 border-emerald-500/40",
                          eta.riskLevel === "medium" &&
                            "text-amber-500 border-amber-500/40",
                          (eta.riskLevel === "high" || eta.riskLevel === "critical") &&
                            "text-red-500 border-red-500/50",
                        )}
                      >
                        риск{" "}
                        {eta.riskLevel === "low"
                          ? "низкий"
                          : eta.riskLevel === "medium"
                            ? "средний"
                            : eta.riskLevel === "high"
                              ? "высокий"
                              : "критический"}
                        <span className="ml-1 opacity-80">
                          {Math.round(eta.delayProbability)}%
                        </span>
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="h-3.5 w-3.5" />
                    <span>{route.driverName}</span>
                  </div>

                  <div className="mt-3 flex items-center_gap-4 flex text-sm">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {route.totalDistance} км
                    </span>
                    <span className="flex items-center gap-1">
                      <Weight className="h-3.5 w-3.5 text-muted-foreground" />
                      {(route.totalWeight / 1000).toFixed(1)} т
                    </span>
                    <span className="flex items-center gap-1">
                      <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      {route.completedOrders}/{route.ordersCount} точек
                    </span>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Прогресс</span>
                      <span className="font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-1.5" />
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                {eta && (
                  <div className="text-right text-xs text-muted-foreground">
                    <div className="flex items-center justify-end gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">
                        {formatEtaDuration(eta.durationWithTrafficSec)}
                      </span>
                    </div>
                    <div className="text-[11px]">
                      план: {formatEtaDuration(eta.durationBaseSec)}
                    </div>
                  </div>
                )}

                <span className="text-xl font-bold text-green-600">
                  {route.totalPrice.toLocaleString()} ₽
                </span>

                {eta && (
                  <div className="text-xs text-muted-foreground">
                    Расходы: {eta.totalCost.toLocaleString()} ₽
                  </div>
                )}

                <div className="flex flex-col items-end gap-2">
                  {hasCapacity && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-purple-600 border-purple-500/30 hover:bg-purple-500/10"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddLoad()
                      }}
                      disabled={isCompleting || isCancelling}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Догруз ({(route.availableCapacity / 1000).toFixed(1)}т)
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="border-border"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowCrew(true)
                    }}
                    disabled={isCompleting || isCancelling}
                    title="Назначить машину и водителя на рейс"
                  >
                    <Truck className="h-3.5 w-3.5 mr-2" />
                    Экипаж
                  </Button>

                  {canOptimize && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowOptimizer(true)
                      }}
                      disabled={applyingOptimizer || isCompleting || isCancelling}
                      title="Построить 3 сценария и применить порядок в маршрут"
                    >
                      {applyingOptimizer ? (
                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-2" />
                      )}
                      Оптимизировать
                    </Button>
                  )}
                </div>

                {expanded ? (
                  <ChevronUp className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
            </div>
          </div>

          {expanded && (
            <div className="border-t px-4 py-3 bg-muted/30 space-y-4">
              {/* Один рейс — одна линия: заказы показаны цветными сегментами */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Маршрут на карте
                  </h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowMap((value) => !value)}
                  >
                    {showMap ? "Скрыть карту" : "Показать карту"}
                  </Button>
                </div>
                {showMap ? (
                  <RouteSegmentsMap routeId={route.id} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Каждый заказ рейса — свой цвет на общей линии. Координаты
                    городов и дорога запрашиваются только при открытии карты.
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Route className="h-4 w-4" />
                  Точки маршрута
                </h4>

                <div className="space-y-2">
                  {route.orders.map((order: any, idx: number) => (
                    <div
                      key={order.id}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border",
                        order.status === "delivered"
                          ? "bg-green-500/5 border-green-500/20"
                          : isOrderMoving(order.status)
                            ? "bg-orange-500/5 border-orange-500/20"
                            : "bg-background border-border",
                      )}
                    >
                      <div
                        className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold",
                          order.status === "delivered"
                            ? "bg-green-500 text-white"
                            : isOrderMoving(order.status)
                              ? "bg-orange-500 text-white"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {order.status === "delivered" ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          idx + 1
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {order.routeFrom.split(",")[0]} →{" "}
                            {order.routeTo.split(",")[0]}
                          </span>
                          {order.isAdditionalLoad && (
                            <Badge
                              variant="outline"
                              className="text-[10px] text-purple-500 border-purple-500/30"
                            >
                              Догруз
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span>{order.cargoType}</span>
                          <span>{(order.weight / 1000).toFixed(1)}т</span>
                          <span>{order.distance} км</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-medium text-green-600">
                          {(order.price || 0).toLocaleString()} ₽
                        </span>
                        {/* Подпись точки — из канона этапов заказа
                            (lib/orders/stages.ts): прежние значения приводятся сами */}
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {isOrderMoving(order.status) ? (
                            <span className="text-orange-500 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {orderStatusLabel(order.status)}
                            </span>
                          ) : isOrderClosed(order.status) &&
                            normalizeOrderStatus(order.status) !== "delivered" ? (
                            <span className="text-red-500 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {orderStatusLabel(order.status)}
                            </span>
                          ) : (
                            orderStatusLabel(order.status)
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Таймлайн событий рейса */}
              <RouteTimeline routeId={route.id} />

              {!hasCapacity && (
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Машина загружена полностью
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-500/40 text-red-500 hover:bg-red-500/10"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleCancelRoute()
                  }}
                  disabled={isCancelling || isCompleting}
                >
                  {isCancelling ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <AlertCircle className="h-4 w-4 mr-2" />
                  )}
                  Отменить рейс
                </Button>

                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleCompleteRoute()
                  }}
                  disabled={isCompleting || isCancelling}
                >
                  {isCompleting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Завершить рейс
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <RouteCrewDialog
        routeId={route.id}
        open={showCrew}
        onOpenChange={setShowCrew}
        currentDriverId={route.driverId}
        currentVehicleId={route.vehicleId}
        onAssigned={onRefresh}
      />

      <Dialog open={showOptimizer} onOpenChange={setShowOptimizer}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Оптимизация порядка точек
            </DialogTitle>
            <DialogDescription>
              3 сценария + объяснение. “Применить” сохранит порядок в маршрут через
              routeSequence.
            </DialogDescription>
          </DialogHeader>

          <RouteOptimizer
            orders={optimizableOrders as RouteOptimizerOrder[]}
            defaultSelectedOrderIds={defaultSelectedOrderIds}
            onOptimize={handleApplyOptimized}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}