"use client"

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
} from "lucide-react"

type VariantId = "fast" | "cheap" | "balanced"

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

type OptimizerMetrics = {
  etaMin: number
  distanceKm: number
  trafficDelayMin: number
  tollsRub: number
  profitPerKm: number
  riskScore: number
}

type OptimizerVariant = {
  id: VariantId
  title: string
  subtitle: string
  orderedOrderIds: string[]
  metrics: OptimizerMetrics
  why: string[]
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function stableHash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function normalizeCity(value: string): string {
  return (value || "").trim().split(",")[0]?.trim().toLowerCase() || ""
}

function parseDeadline(value: Date | string | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === "string") {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function formatEta(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h <= 0) return `${mm}м`
  return `${h}ч ${mm}м`
}

function orderOrdersGreedy(orders: RouteOptimizerOrder[], variant: VariantId): string[] {
  if (orders.length === 0) return []

  const remaining = [...orders]

  const toCount = new Map<string, number>()
  for (const o of remaining) {
    const to = normalizeCity(o.routeTo)
    toCount.set(to, (toCount.get(to) || 0) + 1)
  }

  remaining.sort((a, b) => {
    const aFrom = normalizeCity(a.routeFrom)
    const bFrom = normalizeCity(b.routeFrom)
    const aScore = toCount.get(aFrom) || 0
    const bScore = toCount.get(bFrom) || 0
    return aScore - bScore
  })

  const result: string[] = []
  let current = normalizeCity(remaining[0].routeTo)
  result.push(remaining[0].id)
  remaining.splice(0, 1)

  const now = Date.now()

  const scoreCandidate = (o: RouteOptimizerOrder, hasMatch: boolean): number => {
    const dist = o.distance || 0
    const price = typeof o.price === "number" ? o.price : 0
    const deadline = parseDeadline(o.deadline)
    const daysToDeadline = deadline ? (deadline.getTime() - now) / (24 * 3600 * 1000) : null

    const matchScore = hasMatch ? 1000 : 0

    const deadlineScore =
      daysToDeadline == null ? 0 : clamp(1 / Math.max(0.2, daysToDeadline), 0, 3) * 120

    const profitPerKm = dist > 0 ? price / dist : 0
    const profitScore = clamp(profitPerKm, 0, 200) * 2

    const distPenalty = dist * 0.25

    if (variant === "fast") {
      return matchScore + deadlineScore + profitScore - distPenalty
    }

    if (variant === "cheap") {
      return matchScore + profitScore * 0.6 - distPenalty * 1.4 + deadlineScore * 0.4
    }

    return matchScore + deadlineScore * 0.7 + profitScore * 0.7 - distPenalty
  }

  while (remaining.length > 0) {
    const matches = remaining.filter((o: any) => normalizeCity(o.routeFrom) === current)
    const pool = matches.length > 0 ? matches : remaining

    let best = pool[0]
    let bestScore = Number.NEGATIVE_INFINITY

    for (const o of pool) {
      const hasMatch = normalizeCity(o.routeFrom) === current
      const s = scoreCandidate(o, hasMatch)
      if (s > bestScore) {
        bestScore = s
        best = o
      }
    }

    result.push(best.id)
    current = normalizeCity(best.routeTo)
    remaining.splice(remaining.findIndex((x: any) => x.id === best.id), 1)
  }

  return result
}

function buildVariants(selected: RouteOptimizerOrder[]): OptimizerVariant[] {
  const idsKey = selected.map((o: any) => o.id).sort().join("|")
  const baseHash = stableHash(idsKey)

  const distanceKm = selected.reduce((sum: any, o: any) => sum + (o.distance || 0), 0)
  const totalPrice = selected.reduce((sum: any, o: any) => sum + (typeof o.price === "number" ? o.price : 0),
    0,
  )

  const deadlines = selected
    .map((o: any) => parseDeadline(o.deadline))
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())

  const earliestDeadline = deadlines[0] || null
  const daysToEarliest = earliestDeadline
    ? (earliestDeadline.getTime() - Date.now()) / (24 * 3600 * 1000)
    : null

  const trafficSeverity = clamp(((baseHash % 100) / 100) * 0.65 + (selected.length - 1) * 0.06, 0, 1)
  const fuelCostRub = Math.round(distanceKm * 18)

  const buildOne = (id: VariantId): OptimizerVariant => {
    const speed = id === "fast" ? 78 : id === "balanced" ? 67 : 60
    const baseTimeMin = distanceKm > 0 ? (distanceKm / speed) * 60 : 0

    const trafficDelayMin = Math.round(
      baseTimeMin *
        (id === "fast" ? 0.10 : id === "balanced" ? 0.14 : 0.18) *
        (0.35 + trafficSeverity),
    )

    const tollRate = id === "fast" ? 2.2 : id === "balanced" ? 1.3 : 0.4
    const corridorFactor = 1 + ((baseHash % 7) / 30)
    const tollsRub = Math.round(distanceKm * tollRate * corridorFactor)

    const etaMin = Math.round(baseTimeMin + trafficDelayMin)

    const profit = totalPrice - fuelCostRub - tollsRub
    const profitPerKm = distanceKm > 0 ? profit / distanceKm : 0

    const deadlineTightness =
      daysToEarliest == null
        ? 0.35
        : daysToEarliest <= 0
          ? 1
          : daysToEarliest <= 1
            ? 0.85
            : daysToEarliest <= 2
              ? 0.6
              : daysToEarliest <= 4
                ? 0.35
                : 0.15

    const riskScore = Math.round(
      clamp(
        100 * (0.52 * deadlineTightness + 0.38 * trafficSeverity + (id === "cheap" ? 0.08 : 0)),
        0,
        100,
      ),
    )

    const orderedOrderIds = orderOrdersGreedy(selected, id)

    const whyBase: string[] = []
    if (id === "fast") {
      whyBase.push("Приоритет времени: скорость выше, допускаем платные участки.")
      whyBase.push("Снижаем риск срыва сроков: более агрессивная стратегия по ETA.")
    } else if (id === "cheap") {
      whyBase.push("Приоритет затрат: минимизируем платные дороги и стоимость пробега.")
      whyBase.push("ETA может вырасти — осознанный компромисс ради себестоимости.")
    } else {
      whyBase.push("Компромисс: удерживаем затраты под контролем без резкого роста ETA.")
      whyBase.push("Сроки учитываются, но не “переплачиваем” за скорость всегда.")
    }

    if (earliestDeadline) {
      whyBase.push(`Ближайший дедлайн: ${earliestDeadline.toLocaleDateString("ru-RU")} — влияет на риск.`)
    }
    if (trafficDelayMin > 0) {
      whyBase.push(`Трафик учтён эвристически: +${trafficDelayMin} мин к ETA.`)
    }

    const title = id === "fast" ? "Быстрее" : id === "cheap" ? "Дешевле" : "Сбалансировано"
    const subtitle =
      id === "fast"
        ? "Минимизируем ETA, допускаем платные участки"
        : id === "cheap"
          ? "Минимизируем затраты, терпим небольшой рост ETA"
          : "Баланс ETA/затрат/рисков"

    return {
      id,
      title,
      subtitle,
      orderedOrderIds,
      metrics: {
        etaMin,
        distanceKm,
        trafficDelayMin,
        tollsRub,
        profitPerKm,
        riskScore,
      },
      why: whyBase.slice(0, 5),
    }
  }

  return [buildOne("fast"), buildOne("cheap"), buildOne("balanced")]
}

export function RouteOptimizer({ orders, onOptimize, defaultSelectedOrderIds }: RouteOptimizerProps) {
  const [selectedOrders, setSelectedOrders] = useState<string[]>(() => defaultSelectedOrderIds ?? [])
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [variants, setVariants] = useState<OptimizerVariant[] | null>(null)

  useEffect(() => {
    // если дали дефолтный выбор и пользователь ещё ничего не трогал
    if (defaultSelectedOrderIds && selectedOrders.length === 0) {
      setSelectedOrders(defaultSelectedOrderIds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSelectedOrderIds])

  const availableOrders = useMemo(() => {
    // Для реальных рейсов: исключаем финальные/неактуальные
    const excluded = new Set(["delivered", "cancelled", "rejected"])
    return orders.filter((o: any) => {
      const s = String(o.status || "").toLowerCase()
      if (!s) return true
      return !excluded.has(s)
    })
  }, [orders])

  const selectedOrderObjects = useMemo(() => {
    const set = new Set(selectedOrders)
    return availableOrders.filter((o: any) => set.has(o.id))
  }, [availableOrders, selectedOrders])

  const toggleOrder = (orderId: string) => {
    setVariants(null)
    setSelectedOrders((prev) =>
      prev.includes(orderId) ? prev.filter((id: any) => id !== orderId) : [...prev, orderId],
    )
  }

  const handleBuildVariants = async () => {
    if (selectedOrderObjects.length === 0) return
    setIsOptimizing(true)

    await new Promise((resolve) => setTimeout(resolve, 450))

    setVariants(buildVariants(selectedOrderObjects))
    setIsOptimizing(false)
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          RouteOptimizer
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Выберите точки и получите 3 сценария: <span className="text-foreground">быстрее</span>,{" "}
          <span className="text-foreground">дешевле</span>,{" "}
          <span className="text-foreground">сбалансировано</span>. MVP-эвристика (готово к замене на API).
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
              Считаю варианты...
            </>
          ) : (
            <>
              <Bot className="h-4 w-4 mr-2" />
              Показать 3 варианта
            </>
          )}
        </Button>

        {variants && (
          <div className="space-y-3 pt-2">
            {variants.map((v: any) => (
              <div
                key={v.id}
                className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      <RouteIcon className="h-4 w-4 text-primary" />
                      {v.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{v.subtitle}</div>
                  </div>

                  <Badge
                    variant={v.metrics.riskScore >= 75 ? "destructive" : "outline"}
                    className="flex items-center gap-1"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    риск {v.metrics.riskScore}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border bg-background/40 p-2">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      ETA
                    </div>
                    <div className="text-sm font-medium">{formatEta(v.metrics.etaMin)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      +{v.metrics.trafficDelayMin}м трафик
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background/40 p-2">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Дистанция
                    </div>
                    <div className="text-sm font-medium">{v.metrics.distanceKm} км</div>
                    <div className="text-[10px] text-muted-foreground">
                      порядок: {v.orderedOrderIds.join(" → ")}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background/40 p-2">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Coins className="h-3 w-3" />
                      Платные
                    </div>
                    <div className="text-sm font-medium">{v.metrics.tollsRub.toLocaleString()} ₽</div>
                    <div className="text-[10px] text-muted-foreground">
                      {Math.round(v.metrics.profitPerKm).toLocaleString()} ₽/км (профит)
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  {v.why.map((line: any, idx: any) => (
                    <div key={idx} className="text-xs text-muted-foreground flex gap-2">
                      <span className="mt-[6px] h-1 w-1 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                      <span className="min-w-0">{line}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="text-[11px] text-muted-foreground">
                    MVP-эвристика • готово к замене на API/внешний роутинг
                  </div>
                  <Button size="sm" onClick={() => onOptimize(v.orderedOrderIds)} className="flex-shrink-0">
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