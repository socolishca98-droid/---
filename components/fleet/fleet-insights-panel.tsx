"use client"

// components/fleet/fleet-insights-panel.tsx
//
// Практика вместо «процента загрузки автопарка» (задача 4).
//
// Логисту на странице автопарка нужны ответы на три вопроса:
//   * какие машины стоят и сколько дней;
//   * что пора обслужить (ТО, страховка, техосмотр, открытые работы);
//   * кто на какой машине ездил.
// Процент «в рейсе / всего» ничего из этого не показывал.
//
// Данные — GET /api/fleet/insights; счёт целиком на сервере
// (lib/fleet/insights.ts), здесь только отображение.

import { AlertTriangle, Clock, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export type FleetInsights = {
  idle: {
    vehicleId: string
    plate: string
    type: string
    driverName: string | null
    idleDays: number
  }[]
  service: {
    vehicleId: string
    plate: string
    kind: string
    title: string
    date: string
    daysLeft: number
    status: "overdue" | "today" | "soon"
  }[]
  openMaintenance: {
    vehicleId: string
    plate: string
    type: string
    description: string
    startedAt: string
    daysOpen: number
  }[]
  /** История назначений по машинам: vehicleId → последние рейсы. */
  history: Record<
    string,
    {
      routeId: string
      routeName: string | null
      driverId: string | null
      driverName: string | null
      startedAt: string | null
      completedAt: string | null
      status: string
      isActive: boolean
    }[]
  >
  summary: {
    vehicles: number
    working: number
    idle: number
    idleOverWeek: number
    serviceSoon: number
    serviceOverdue: number
    openMaintenance: number
    /** Всего предупреждений об обслуживании (то же, что service.length). */
    service: number
  }
}

function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

/** Дни до даты по-русски: «просрочено на 3 дн.», «сегодня», «через 12 дн.» */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft < 0) return `просрочено на ${Math.abs(daysLeft)} дн.`
  if (daysLeft === 0) return "сегодня"
  return `через ${daysLeft} дн.`
}

/** Простой по-русски: «2 дн.», «3 нед.», «2 мес.». */
export function idleLabel(days: number): string {
  if (days <= 0) return "сегодня работала"
  if (days < 7) return `${days} дн.`
  if (days < 31) return `${Math.floor(days / 7)} нед.`
  return `${Math.floor(days / 30)} мес.`
}

const VISIBLE_LIMIT = 5

export function FleetInsightsPanel({ insights }: { insights: FleetInsights | null }) {
  if (!insights) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Сводка по автопарку</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    )
  }

  const { idle, service, openMaintenance, summary } = insights
  const idleTop = idle.filter((item) => item.idleDays > 0).slice(0, VISIBLE_LIMIT)
  const serviceTop = service.slice(0, VISIBLE_LIMIT)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Простой */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Простаивают
            <Badge variant={summary.idle > 0 ? "secondary" : "outline"}>
              {summary.idle} из {summary.vehicles}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            В работе {summary.working}, без рейса {summary.idle}
            {summary.idleOverWeek > 0 ? ` (дольше недели — ${summary.idleOverWeek})` : ""}.
          </p>

          {idleTop.length === 0 ? (
            <p className="text-sm text-emerald-600">Свободных машин нет — все заняты или на ТО.</p>
          ) : (
            <ul className="space-y-1.5">
              {idleTop.map((item) => (
                <li key={item.vehicleId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{item.plate}</span>
                  <span className="text-muted-foreground">
                    {item.driverName ? `${item.driverName} · ` : ""}
                    {idleLabel(item.idleDays)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {idle.length > VISIBLE_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              и ещё {idle.length - VISIBLE_LIMIT} — в списке транспорта
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Обслуживание */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            Пора обслужить
            <Badge variant={summary.serviceOverdue > 0 ? "destructive" : "secondary"}>
              {summary.service}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {serviceTop.length === 0 && openMaintenance.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Открытых работ нет, ближайшие ТО и страховки — в пределах нормы.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {serviceTop.map((item) => (
                <li
                  key={`${item.vehicleId}-${item.kind}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {item.status !== "soon" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    ) : null}
                    <span className="font-medium">{item.plate}</span>
                    <span className="text-muted-foreground">{item.title}</span>
                  </span>
                  <span
                    className={
                      item.status !== "soon" ? "text-destructive" : "text-muted-foreground"
                    }
                  >
                    {formatDay(item.date)} · {daysLeftLabel(item.daysLeft)}
                  </span>
                </li>
              ))}

              {openMaintenance.slice(0, VISIBLE_LIMIT).map((item) => (
                <li key={item.vehicleId + item.type} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5 text-amber-500" />
                    <span className="font-medium">{item.plate}</span>
                    <span className="text-muted-foreground">
                      {item.description || item.type}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    идёт {idleLabel(item.daysOpen)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {openMaintenance.length > VISIBLE_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              и ещё {openMaintenance.length - VISIBLE_LIMIT} открытых работ
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
