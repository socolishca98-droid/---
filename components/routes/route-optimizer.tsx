"use client"

// components/routes/route-optimizer.tsx
//
// Три сценария рейса: «быстрее», «дешевле», «сбалансировано».
//
// Компонент НЕ считает километры, время и деньги сам. Раньше он это делал —
// «трафик» брался из хеша строки, платные дороги умножались на константу, а
// скорость была зашита числом. Теперь порядок объезда считает чистая логика
// (lib/routes/optimizer.ts), а реальные цифры — сервер
// (POST /api/routes/optimizer → OSRM + модель расходов lib/eta).
//
// У каждого числа в интерфейсе видно происхождение: измерение (OSRM, Яндекс)
// или оценка (время суток, тарифы платных дорог). Если город не удалось
// поставить на карту, он показывается списком проблем, а не молча выкидывается.

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Bot,
  Sparkles,
  Loader2,
  MapPin,
  ArrowRight,
  Weight,
  Clock,
  Coins,
  AlertTriangle,
  Route as RouteIcon,
  CheckCircle2,
  Fuel,
  Info,
} from "lucide-react"

export interface RouteOptimizerOrder {
  id: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  price?: number | null
  deadline?: Date | string
  status?: string

  // допускаем любые поля
  [key: string]: unknown
}

interface RouteOptimizerProps {
  orders: RouteOptimizerOrder[]
  onOptimize: (orderedOrderIds: string[]) => void
  defaultSelectedOrderIds?: string[]
}

type OptimizerVariantId = "fast" | "cheap" | "balanced"

interface OptimizerVariant {
  id: OptimizerVariantId
  title: string
  subtitle: string
  orderedOrderIds: string[]
  points: Array<{ orderId: string; city: string; role: "from" | "to" }>
  legs: Array<{ from: string; to: string; distanceKm: number; durationMin: number }>
  metrics: {
    distanceKm: number
    etaMin: number
    baseMin: number
    trafficDelayMin: number
    fuelRub: number
    tollsRub: number
    revenueRub: number
    profitRub: number
    profitPerKm: number
    riskScore: number
  }
  sources: {
    routing: "osrm" | "fallback"
    traffic: "yandex" | "estimate"
    tolls: "estimate"
    trafficNote: string
  }
  why: string[]
}

interface OptimizerResponse {
  success: boolean
  error?: string
  code?: string
  problems?: string[]
  skipped?: number
  sources?: {
    routing: "osrm" | "fallback"
    traffic: "yandex" | "estimate"
    tolls: "estimate"
    geocoding: string
  }
  variants?: OptimizerVariant[]
}

function formatEta(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h <= 0) return `${mm}м`
  return `${h}ч ${mm}м`
}

function rub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

/** Короткая подпись источника: «измерено» или «оценка». */
function SourceBadge({
  routing,
  traffic,
}: {
  routing: "osrm" | "fallback"
  traffic: "yandex" | "estimate"
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={routing === "osrm" ? "outline" : "secondary"} className="text-[10px] gap-1">
        {routing === "osrm" ? "OSRM: дороги" : "OSRM недоступен: по прямой"}
      </Badge>
      <Badge variant={traffic === "yandex" ? "outline" : "secondary"} className="text-[10px] gap-1">
        {traffic === "yandex" ? "Пробки: Яндекс" : "Пробки: оценка по времени суток"}
      </Badge>
      <Badge variant="secondary" className="text-[10px] gap-1">
        Платные дороги: оценка
      </Badge>
    </div>
  )
}

export function RouteOptimizer({ orders, onOptimize, defaultSelectedOrderIds }: RouteOptimizerProps) {
  const [selectedOrders, setSelectedOrders] = useState<string[]>(() => defaultSelectedOrderIds ?? [])
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [variants, setVariants] = useState<OptimizerVariant[] | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // если дали дефолтный выбор и пользователь ещё ничего не трогал
    if (defaultSelectedOrderIds && selectedOrders.length === 0) {
      setSelectedOrders(defaultSelectedOrderIds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSelectedOrderIds])

  const availableOrders = useMemo(() => {
    const excluded = new Set(["delivered", "cancelled", "rejected", "expired"])
    return orders.filter((order: any) => {
      const status = String(order.status || "").toLowerCase()
      if (!status) return true
      return !excluded.has(status)
    })
  }, [orders])

  const selectedOrderObjects = useMemo(() => {
    const set = new Set(selectedOrders)
    return availableOrders.filter((order: any) => set.has(order.id))
  }, [availableOrders, selectedOrders])

  const toggleOrder = (orderId: string) => {
    setVariants(null)
    setError(null)
    setSelectedOrders((prev) =>
      prev.includes(orderId) ? prev.filter((id: any) => id !== orderId) : [...prev, orderId],
    )
  }

  const handleBuildVariants = async () => {
    if (selectedOrderObjects.length === 0) return

    setIsOptimizing(true)
    setError(null)

    try {
      const res = await fetch("/api/routes/optimizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: selectedOrderObjects.map((order: any) => order.id) }),
      })

      const data = (await res.json().catch(() => null)) as OptimizerResponse | null

      if (!res.ok || !data?.success) {
        setVariants(null)
        setProblems(data?.problems ?? [])
        setError(data?.error || "Не удалось посчитать сценарии")
        return
      }

      setVariants(data.variants ?? [])
      setProblems(data.problems ?? [])
    } catch (e: any) {
      setVariants(null)
      setError(e?.message || "Сервис расчёта недоступен")
    } finally {
      setIsOptimizing(false)
    }
  }

  const sources = variants?.[0]?.sources

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          Оптимизатор рейса
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Выберите точки и получите 3 сценария: <span className="text-foreground">быстрее</span>,{" "}
          <span className="text-foreground">дешевле</span>,{" "}
          <span className="text-foreground">сбалансировано</span>. Пробег и время считаются по
          дорогам (OSRM), деньги — по расходу топлива и оценке платных участков.
        </p>

        <div className="space-y-2 max-h-[280px] overflow-y-auto pr-2">
          {availableOrders.map((order: any) => (
            <div
              key={order.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                selectedOrders.includes(order.id)
                  ? "bg-primary/10 border-primary/30"
                  : "bg-secondary/50 border-transparent hover:border-border"
              }`}
              onClick={() => toggleOrder(order.id)}
            >
              <Checkbox
                checked={selectedOrders.includes(order.id)}
                onCheckedChange={() => toggleOrder(order.id)}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-3 w-3 text-primary flex-shrink-0" />
                  <span className="truncate">{order.routeFrom}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{order.routeTo}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <Weight className="h-3 w-3" />
                  {(Number(order.weight || 0) / 1000).toFixed(1)}т<span>•</span>
                  {order.distance} км
                </div>
              </div>

              <Badge variant="secondary" className="flex-shrink-0">
                {typeof order.price === "number" && order.price > 0
                  ? `${(order.price / 1000).toFixed(0)}к ₽`
                  : "Договор."}
              </Badge>
            </div>
          ))}
        </div>

        {selectedOrders.length > 0 && (
          <div className="flex items-center justify-between text-sm bg-secondary/50 rounded-lg p-3">
            <span className="text-muted-foreground">
              Выбрано точек:{" "}
              <span className="text-foreground font-medium">{selectedOrders.length}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelectedOrders([])}>
              Сбросить
            </Button>
          </div>
        )}

        <Button
          className="w-full bg-primary text-primary-foreground"
          disabled={selectedOrderObjects.length === 0 || isOptimizing}
          onClick={handleBuildVariants}
        >
          {isOptimizing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Считаю по дорогам...
            </>
          ) : (
            <>
              <Bot className="h-4 w-4 mr-2" />
              Показать 3 варианта
            </>
          )}
        </Button>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {problems.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Координаты не найдены: {problems.join(", ")}. Заказы по этим городам в расчёт не
              попали — проверьте название или вернитесь к расчёту позже (адреса кэшируются).
            </span>
          </div>
        )}

        {variants && sources && (
          <div className="space-y-3 pt-2">
            <SourceBadge routing={sources.routing} traffic={sources.traffic} />

            {variants.map((variant) => (
              <div
                key={variant.id}
                className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      <RouteIcon className="h-4 w-4 text-primary" />
                      {variant.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{variant.subtitle}</div>
                  </div>

                  <Badge
                    variant={variant.metrics.riskScore >= 75 ? "destructive" : "outline"}
                    className="flex items-center gap-1"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    риск {variant.metrics.riskScore}%
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-border bg-background/40 p-2">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      В пути
                    </div>
                    <div className="text-sm font-medium">{formatEta(variant.metrics.etaMin)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {variant.metrics.trafficDelayMin > 0
                        ? `+${variant.metrics.trafficDelayMin}м к чистому ходу`
                        : "без задержек"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background/40 p-2">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Пробег
                    </div>
                    <div className="text-sm font-medium">{variant.metrics.distanceKm} км</div>
                    <div className="text-[10px] text-muted-foreground">
                      точек: {variant.points.length}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background/40 p-2">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Fuel className="h-3 w-3" />
                      Топливо
                    </div>
                    <div className="text-sm font-medium">{rub(variant.metrics.fuelRub)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      платные: {rub(variant.metrics.tollsRub)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background/40 p-2">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Coins className="h-3 w-3" />
                      Остаток
                    </div>
                    <div className="text-sm font-medium">{rub(variant.metrics.profitRub)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {rub(variant.metrics.profitPerKm)}/км
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  {variant.why.map((line, idx) => (
                    <div key={idx} className="text-xs text-muted-foreground flex gap-2">
                      <span className="mt-[6px] h-1 w-1 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                      <span className="min-w-0">{line}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="text-[11px] text-muted-foreground">
                    Оплата заказов: {rub(variant.metrics.revenueRub)}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onOptimize(variant.orderedOrderIds)}
                    className="flex-shrink-0"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Применить
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
