// components/dashboard/map/panels/RouteTripPanel.tsx
//
// Прогноз рейса на карте логиста — из ЕДИНОГО механизма.
//
// Зачем отдельная панель: карта показывает нитку маршрута, но не говорит,
// на каком этапе рейс, когда прибытие в следующую точку и сколько осталось.
// Логисту это нужнее геометрии.
//
// Откуда данные: GET /api/dashboard/routes → route.trip, который считается
// lib/eta/trip.ts — тем же движком, что кабинет водителя
// (GET /api/routes/[routeId]/trip). Своей формулы ETA в браузере нет, иначе
// карта и кабинет показывали бы разное время на одном рейсе.
//
// GPS: если у водителя нет реальных координат, панель говорит об этом
// прямым текстом. Вымышленное местоположение не подставляется никогда.

"use client"

import { useMemo } from "react"

import { AlertTriangle, Clock, MapPin, Navigation, RotateCcw, Route as RouteIcon } from "lucide-react"

import type { RouteData } from "../types"

/** Прогноз рейса в том виде, в котором его отдаёт /api/dashboard/routes. */
export interface RouteTripPayload {
  currentStageIndex: number | null
  currentStageLabel: string | null
  /** "active" — этап идёт сейчас, "pending" — рейс начат, этап ещё не открыт */
  currentStageStatus: "active" | "pending" | null
  /** Рейс начат: есть хотя бы одна фактическая отметка */
  tripStarted: boolean
  /** Все этапы закрыты */
  finished: boolean
  nextPoint: {
    address: string
    operation: string
    distanceM: number | null
    drivingSec: number
    arrivalAt: string
  } | null
  remaining: {
    drivingSec: number
    stopsSec: number
    restSec: number
    totalSec: number
    arrivalAt: string
  }
  returnToBase: { address: string; drivingSec: number; arrivalAt: string } | null
  /** Обязательные перерывы: когда именно наступают */
  restPlan: {
    breaks: Array<{
      afterStageIndex: number
      minutes: number
      kind: string
      reason: string
      startAt: string
      endAt: string
    }>
    totalMinutes: number
    priorDrivingUnknown: boolean
    warning: string | null
  }
  completionAt: string
  confidence: { level: string; score: number; reasons: string[] }
  dataQuality: string[]
  reliable: boolean
  gpsKnown: boolean
  calculatedAt: string
}

export interface RouteTripPanelProps {
  routes: RouteData[]
  /** Выбранный рейс (если логист ткнул нитку) */
  selectedRouteId: string | null
  onSelectRoute: (routeId: string | null) => void
  onClose: () => void
}

/** «2 ч 15 мин» из секунд. */
function humanDuration(sec: number): string {
  const total = Math.round(sec / 60)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes} мин`
  if (minutes === 0) return `${hours} ч`
  return `${hours} ч ${minutes} мин`
}

/** «через 2 ч 15 мин» относительно сейчас. */
function until(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now()
  if (diffMs <= 0) return "время наступило"
  return `через ${humanDuration(diffMs / 1000)}`
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
}

const OPERATION_LABEL: Record<string, string> = {
  driving: "движение",
  loading: "погрузка",
  unloading: "выгрузка",
  documents: "оформление",
  waiting: "ожидание",
  rest: "перерыв",
  return_to_base: "возврат на базу",
}

export function RouteTripPanel({
  routes,
  selectedRouteId,
  onSelectRoute,
  onClose,
}: RouteTripPanelProps) {
  const route = useMemo(
    () => routes.find((item) => item.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  )
  const trip = (route?.trip ?? null) as RouteTripPayload | null

  if (!route) return null

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-[1000] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
      {/* ── Заголовок ── */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <RouteIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate text-[13px] font-medium">{route.driverName}</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {route.vehiclePlate ? `${route.vehiclePlate} · ` : ""}
            {route.routeFrom} → {route.routeTo}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted active:opacity-70"
          aria-label="Закрыть прогноз рейса"
        >
          ✕
        </button>
      </div>

      {/* ── GPS честно ── */}
      {!route.driverPos || route.driverPos.length !== 2 ? (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Нет GPS-координат водителя. Местоположение на карте не показано — подменять его
          вычисленной точкой нельзя.
        </p>
      ) : null}

      {!trip ? (
        <p className="rounded-lg bg-muted/50 px-2 py-2 text-[11.5px] text-muted-foreground">
          Прогноза по рейсу нет: заказы не собраны в рейс (видны как «solo»), либо единый движок
          недоступен. Время на карте — старая оценка по километражу.
        </p>
      ) : (
        <div className="space-y-2">
          {/* ── Текущий этап ── */}
          <div className="rounded-lg bg-muted/40 px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Текущий этап
            </p>
            <p className="text-[13px] font-medium">
              {trip.currentStageLabel ?? (trip.tripStarted ? "Рейс завершён" : "Рейс не начат")}
            </p>
            {/* Рейс в пути, но этап ещё не открывали — это не «рейс не начат» */}
            {trip.tripStarted && trip.currentStageStatus === "pending" ? (
              <p className="text-[10px] text-muted-foreground">
                этап ещё не открыт водителем
              </p>
            ) : null}
            {trip.finished ? (
              <p className="text-[10px] text-muted-foreground">все этапы закрыты</p>
            ) : null}
          </div>

          {/* ── Следующая точка ── */}
          {trip.nextPoint ? (
            <div className="rounded-lg border border-border px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Следующая точка
                </span>
              </div>
              <p className="truncate text-[12.5px] font-medium">{trip.nextPoint.address}</p>
              <p className="text-[11px] text-muted-foreground">
                {OPERATION_LABEL[trip.nextPoint.operation] ?? trip.nextPoint.operation} ·{" "}
                {until(trip.nextPoint.arrivalAt)}
                {trip.nextPoint.distanceM
                  ? ` · ${(trip.nextPoint.distanceM / 1000).toFixed(0)} км`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="rounded-lg bg-muted/40 px-2 py-1.5 text-[11.5px] text-muted-foreground">
              Точек впереди нет — рейс завершён или все этапы закрыты.
            </p>
          )}

          {/* ── Оставшееся время ── */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border border-border px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground">Осталось по рейсу</p>
              <p className="text-[13px] font-medium tabular-nums">
                {humanDuration(trip.remaining.totalSec)}
              </p>
              <p className="text-[10px] text-muted-foreground">до {until(trip.remaining.arrivalAt)}</p>
            </div>
            <div className="rounded-lg border border-border px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground">Возврат на базу</p>
              {trip.returnToBase ? (
                <>
                  <p className="text-[13px] font-medium tabular-nums">
                    {humanDuration(trip.returnToBase.drivingSec)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {until(trip.returnToBase.arrivalAt)}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">в рейсе не предусмотрен</p>
              )}
            </div>
          </div>

          {/* ── Из чего сложилось ── */}
          <div className="flex flex-wrap gap-1.5 text-[10.5px] text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">
              движение {humanDuration(trip.remaining.drivingSec)}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5">
              операции {humanDuration(trip.remaining.stopsSec)}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5">
              перерывы {humanDuration(trip.remaining.restSec)}
            </span>
          </div>

          {/* ── Обязательные перерывы: когда именно ── */}
          {trip.restPlan.breaks.length > 0 ? (
            <div className="rounded-lg border border-border px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Обязательные перерывы ({trip.restPlan.breaks.length})
              </p>
              <ul className="mt-0.5 space-y-0.5 text-[11px]">
                {trip.restPlan.breaks.slice(0, 4).map((rest, index) => (
                  <li key={`${rest.afterStageIndex}-${index}`} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      после этапа {rest.afterStageIndex + 1}
                    </span>
                    <span className="tabular-nums">
                      {rest.kind === "daily_rest" ? "отдых" : "перерыв"} {rest.minutes} мин ·{" "}
                      {new Date(rest.startAt).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
                {trip.restPlan.breaks.length > 4 ? (
                  <li className="text-[10px] text-muted-foreground">
                    …и ещё {trip.restPlan.breaks.length - 4}
                  </li>
                ) : null}
              </ul>
              {trip.restPlan.warning ? (
                <p className="mt-1 text-[10px] text-warning">{trip.restPlan.warning}</p>
              ) : null}
            </div>
          ) : null}

          {/* ── Уверенность и качество данных ── */}
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            уверенность {CONFIDENCE_LABEL[trip.confidence.level] ?? trip.confidence.level} ·{" "}
            {Math.round(trip.confidence.score * 100)}%
          </div>
          {trip.dataQuality.length > 0 ? (
            <ul className="space-y-0.5 text-[10.5px] text-warning">
              {trip.dataQuality.map((warning) => (
                <li key={warning} className="flex gap-1">
                  <span className="shrink-0">·</span>
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          {/* ── Переключение между рейсами ── */}
          {routes.length > 1 ? (
            <div className="flex flex-wrap gap-1 border-t border-border pt-2">
              {routes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectRoute(item.id)}
                  className={`rounded px-1.5 py-0.5 text-[10.5px] active:opacity-70 ${
                    item.id === selectedRouteId
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {item.driverName.split(" ")[0]}
                </button>
              ))}
            </div>
          ) : null}

          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Navigation className="h-2.5 w-2.5" />
            Расчёт {new Date(trip.calculatedAt).toLocaleTimeString("ru-RU")} — единый механизм,
            тот же что в кабинете водителя
          </p>
        </div>
      )}
    </div>
  )
}

/** Иконка этапа — для возможной метки на карте. */
export function stageIcon(kind: string) {
  if (kind === "return_to_base") return <RotateCcw className="h-3.5 w-3.5" />
  if (kind === "loading" || kind === "unloading") return <MapPin className="h-3.5 w-3.5" />
  return <Navigation className="h-3.5 w-3.5" />
}
