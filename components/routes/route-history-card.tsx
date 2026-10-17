"use client"

// components/routes/route-history-card.tsx
// Карточка рейса в ИСТОРИИ (завершённые и отменённые).
//
// Зачем отдельно от ActiveRouteCard: та рассчитана на работу с рейсом —
// догруз, оптимизатор, карта, документы, кнопка завершения. В истории эти
// кнопки только путают, а простыня данных мешает сравнить рейсы между собой.
// Здесь только факты: когда, кто вёл, откуда и куда, сколько точек доставлено,
// километры, тонны и деньги. Никаких действий — история только читается.

import { CalendarClock, Truck, User } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

export interface RouteHistoryOrder {
  id: string
  routeFrom: string
  routeTo: string
  status?: string
  routeSequence?: number
}

export interface RouteHistoryRoute {
  id: string
  name?: string | null
  /** статус рейса из таблицы Route: completed | cancelled (сюда попадают только они) */
  status: string
  startedAt?: string | null
  completedAt?: string | null
  driverName?: string
  vehiclePlate?: string
  ordersCount: number
  completedOrders: number
  totalDistance: number
  totalWeight: number
  totalPrice: number
  orders: RouteHistoryOrder[]
  economics?: {
    revenueRub: number
    distanceKm: number
    profitRub: number | null
  } | null
}

const dateTimeFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

function formatWhen(value: string | null | undefined): string {
  if (!value) return "дата неизвестна"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "дата неизвестна"
  return dateTimeFormat.format(date)
}

export function RouteHistoryCard({ route }: { route: RouteHistoryRoute }) {
  const cancelled = route.status === "cancelled"
  const orders = route.orders ?? []
  const from = orders.length > 0 ? orders[0].routeFrom : "—"
  const to = orders.length > 0 ? orders[orders.length - 1].routeTo : "—"
  const title = route.name?.trim() ? route.name.trim() : `Рейс ${from} → ${to}`

  const points = route.ordersCount ?? orders.length
  const delivered = route.completedOrders ?? 0
  const km = Math.round(route.totalDistance ?? 0)
  const tonnes = ((route.totalWeight ?? 0) / 1000).toFixed(1)
  const revenue = Math.round(route.totalPrice ?? 0)
  const profit = route.economics?.profitRub ?? null

  return (
    <Card className="transition-colors duration-200 hover:border-primary/40">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold" title={title}>
              {title}
            </p>
            <p className="truncate text-[12.5px] text-muted-foreground">
              {from} → {to}
            </p>
          </div>
          <Badge
            variant="outline"
            className={
              cancelled
                ? "shrink-0 border-destructive/40 text-destructive"
                : "shrink-0 border-success/40 text-success"
            }
          >
            {cancelled ? "Отменён" : "Завершён"}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            {formatWhen(route.completedAt ?? route.startedAt)}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{route.driverName?.trim() || "водитель не назначен"}</span>
          </span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Truck className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{route.vehiclePlate?.trim() || "машина не назначена"}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] tabular-nums">
          <span className="text-muted-foreground">
            Точек: <span className="text-foreground">
              {delivered}/{points}
            </span>
          </span>
          <span className="text-muted-foreground">
            {km} км · {tonnes} т
          </span>
          <span className="font-medium">{revenue.toLocaleString("ru-RU")} ₽</span>
          {profit != null ? (
            <span className={profit >= 0 ? "text-success" : "text-destructive"}>
              {profit >= 0 ? "прибыль" : "убыток"} {Math.abs(Math.round(profit)).toLocaleString("ru-RU")} ₽
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
