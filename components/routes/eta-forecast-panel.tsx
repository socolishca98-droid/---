// components/routes/eta-forecast-panel.tsx
//
// Посегментный прогноз времени прибытия: три сценария, уверенность и
// объяснение каждой поправки.
//
// Зачем отдельная панель, а не просто число «Е TA через 6 ч 20 м»:
//   * логист должен видеть, ИЗ ЧЕГО сложилось время — иначе непонятно,
//     поможет ли перенос выезда на два часа;
//   * прогноз может быть ненадёжен (полное перекрытие, нет погоды, нет
//     данных о машине) — и об этом надо говорить прямо, а не показывать
//     уверенное число;
//   * погодных данных может не быть вовсе: бесплатный тариф Open-Meteo
//     не разрешает коммерческое использование, поэтому по умолчанию погода
//     выключена и в панели так и написано.
//
// Данные берёт у POST /api/eta/forecast — серверного эндпоинта с проверкой
// организации. Сеть дёргается только с сервера, ключей в браузере нет.

"use client"

import { useCallback, useEffect, useState } from "react"

import { AlertTriangle, Clock, CloudRain, Gauge, ListTree, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface Coordinates {
  lat: number
  lng: number
}

interface SegmentRow {
  index: number
  distanceM: number
  roadClassLabel: string
  roadName?: string
  baseSpeedKmh: number
  drivingSec: number
  totalFactor: number
  blocked?: boolean
  weather?: { label: string; factor: number } | null
  corrections: Array<{ kind: string; factor: number; reason: string }>
}

interface ForecastHistory {
  /** Сколько раз прогноз пересчитывали (0 — первый расчёт) */
  recalcCount: number
  /** Время прибытия по ПЕРВОМУ расчёту — не перезаписывается */
  initialArrivalAt: string | null
  /** Время прибытия по последнему расчёту */
  currentArrivalAt: string | null
  versions: Array<{ id: string; calculatedAt: string; arrivalAt: string; recalcCount: number }>
}

interface ForecastResponse {
  id: string | null
  saved: boolean
  /** История версий прогноза по рейсу */
  history?: ForecastHistory | null
  modelVersion: string
  reliable: boolean
  reliabilityNote?: string
  departureAt: string
  scenarios: {
    optimistic: { totalSec: number; arrivalAt: string }
    base: { totalSec: number; arrivalAt: string; drivingSec: number; stopsSec: number; restSec: number }
    conservative: { totalSec: number; arrivalAt: string }
  }
  distanceM: number
  confidence: { level: "high" | "medium" | "low"; score: number; reasons: string[] }
  explanation: Array<{ kind: string; label: string; factor: number; detail: string }>
  segments: SegmentRow[]
  sources: {
    routing: "osrm" | "fallback"
    weather: string
    weatherEnabled: boolean
  }
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "border-success/40 bg-success/10 text-success",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-destructive/40 bg-destructive/10 text-destructive",
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours <= 0) return `${minutes} мин`
  return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`
}

function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })
}

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(0)} км`
}

/** Насколько прогноз уехал: исходное время против актуального. */
function driftMinutes(initialIso: string, currentIso: string): string {
  const diffMin = Math.round(
    (new Date(currentIso).getTime() - new Date(initialIso).getTime()) / 60_000,
  )
  if (diffMin === 0) return "прогноз не изменился"
  const sign = diffMin > 0 ? "позже" : "раньше"
  return `${sign} на ${Math.abs(diffMin)} мин`
}

export interface EtaForecastPanelProps {
  /** Координаты не обязательны: если передан routeId — сервер возьмёт
   *  точки из заказов рейса и превратит названия городов в координаты. */
  origin?: Coordinates
  destination?: Coordinates
  waypoints?: Coordinates[]
  /** Рейс, к которому привязать прогноз — тогда его можно сверить с фактом */
  routeId?: string
  vehicleId?: string | null
  /** Время выезда; по умолчанию — сейчас */
  departure?: Date
}

export function EtaForecastPanel({
  origin,
  destination,
  waypoints,
  routeId,
  vehicleId,
  departure,
}: EtaForecastPanelProps) {
  const [state, setState] = useState<{
    loading: boolean
    error: string | null
    data: ForecastResponse | null
  }>({ loading: false, error: null, data: null })

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const response = await fetch("/api/eta/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          destination,
          waypoints: waypoints || [],
          departure: (departure || new Date()).toISOString(),
          routeId,
          vehicleId: vehicleId || undefined,
        }),
      })

      const data = (await response.json().catch(() => null)) as ForecastResponse | { error?: string } | null

      if (!response.ok) {
        setState({
          loading: false,
          error: (data as { error?: string })?.error || "Не удалось посчитать прогноз",
          data: null,
        })
        return
      }

      setState({ loading: false, error: null, data: data as ForecastResponse })
    } catch {
      setState({ loading: false, error: "Сервис прогноза недоступен", data: null })
    }
  }, [origin, destination, waypoints, routeId, vehicleId, departure])

  useEffect(() => {
    void load()
  }, [load])

  if (state.loading && !state.data) {
    return (
      <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
        <RefreshCw className="mr-2 inline h-3.5 w-3.5 animate-spin" />
        Считаю прогноз по сегментам…
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{state.error}</span>
      </div>
    )
  }

  const data = state.data
  if (!data) return null

  return (
    <div className="space-y-3 rounded-xl border border-border bg-secondary/30 p-4">
      {/* ── Заголовок: модель, расстояние, источник ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="gap-1 text-[10px]">
          <ListTree className="h-3 w-3" />
          {data.segments.length} сегментов
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {formatKm(data.distanceM)}
        </Badge>
        <Badge variant="secondary" className="text-[10px]" title="Модель посегментного расчёта">
          {data.modelVersion}
        </Badge>
        {data.sources.routing === "fallback" && (
          <Badge variant="secondary" className="text-[10px]">
            OSRM недоступен: по прямой
          </Badge>
        )}
        <Badge
          variant="secondary"
          className="gap-1 text-[10px]"
          title={
            data.sources.weatherEnabled
              ? "Погода по часам прохождения сегментов — Open-Meteo"
              : "Погода выключена: бесплатный тариф Open-Meteo разрешён только для некоммерческого использования"
          }
        >
          <CloudRain className="h-3 w-3" />
          {data.sources.weather === "open-meteo"
            ? "погода учтена"
            : data.sources.weather === "disabled"
              ? "погода выключена"
              : "погоды нет"}
        </Badge>
      </div>

      {/* ── Ненадёжный прогноз: говорим прямо, а не показываем число ── */}
      {!data.reliable && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {data.reliabilityNote || "Прогноз ненадёжен"}
            {data.segments.some((segment) => segment.blocked)
              ? " Точное время прибытия неизвестно, пока маршрут не изменён."
              : ""}
          </span>
        </div>
      )}

      {/* ── Три сценария ── */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border bg-background/40 p-2">
          <div className="text-[10px] text-muted-foreground">Оптимистично</div>
          <div className="text-sm font-medium">{formatDuration(data.scenarios.optimistic.totalSec)}</div>
          <div className="text-[10px] text-muted-foreground">
            к {formatClock(data.scenarios.optimistic.arrivalAt)}
          </div>
        </div>
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-2">
          <div className="text-[10px] text-primary">Базовый</div>
          <div className="text-sm font-medium">{formatDuration(data.scenarios.base.totalSec)}</div>
          <div className="text-[10px] text-muted-foreground">
            к {formatClock(data.scenarios.base.arrivalAt)} · {formatDate(data.scenarios.base.arrivalAt)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-2">
          <div className="text-[10px] text-muted-foreground">Консервативно</div>
          <div className="text-sm font-medium">{formatDuration(data.scenarios.conservative.totalSec)}</div>
          <div className="text-[10px] text-muted-foreground">
            к {formatClock(data.scenarios.conservative.arrivalAt)}
          </div>
        </div>
      </div>

      {/* ── Уверенность и её причины ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={`gap-1 text-[10px] ${CONFIDENCE_STYLE[data.confidence.level] || ""}`}>
          <Gauge className="h-3 w-3" />
          уверенность {CONFIDENCE_LABEL[data.confidence.level] || data.confidence.level} ·{" "}
          {Math.round(data.confidence.score * 100)}%
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => void load()}
          disabled={state.loading}
          title="Пересчитать прогноз: сохранится новая версия, исходная останется"
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${state.loading ? "animate-spin" : ""}`} />
          Пересчитать
        </Button>
        {data.history && data.history.recalcCount > 0 ? (
          <Badge
            variant="outline"
            className="text-[10px]"
            title={`Пересчётов: ${data.history.recalcCount}. Исходный прогноз сохранён отдельно.`}
          >
            пересчётов: {data.history.recalcCount}
          </Badge>
        ) : null}
        {data.saved && (
          <Badge variant="outline" className="text-[10px]" title="Прогноз сохранён — по нему запишется факт">
            <Clock className="mr-1 h-3 w-3" />
            сохранён
          </Badge>
        )}
      </div>

      {/* ── История прогноза: уезжало ли время по ходу рейса ── */}
      {data.history && data.history.initialArrivalAt && data.history.currentArrivalAt ? (
        <div className="rounded-lg border border-border bg-background/40 p-2 text-[11px]">
          <div className="mb-1 font-medium text-foreground">История прогноза</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>
              Исходно: <span className="tabular-nums">{formatClock(data.history.initialArrivalAt)}</span>{" "}
              {formatDate(data.history.initialArrivalAt)}
            </span>
            <span>
              Сейчас:{" "}
              <span className="tabular-nums">{formatClock(data.history.currentArrivalAt)}</span>{" "}
              {formatDate(data.history.currentArrivalAt)}
            </span>
            <span className="tabular-nums">
              {driftMinutes(data.history.initialArrivalAt, data.history.currentArrivalAt)}
            </span>
          </div>
          {data.history.versions.length > 1 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {data.history.versions.map((version, index) => (
                <span
                  key={version.id}
                  className="rounded bg-muted px-1 py-0.5 text-[10px] tabular-nums"
                  title={`Версия ${index + 1}: ${formatClock(version.arrivalAt)} ${formatDate(version.arrivalAt)}`}
                >
                  v{index + 1}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {data.confidence.reasons.length > 0 && (
        <ul className="space-y-1 text-[11px] text-muted-foreground">
          {data.confidence.reasons.map((reason) => (
            <li key={reason} className="flex gap-1.5">
              <span className="text-muted-foreground/60">·</span>
              {reason}
            </li>
          ))}
        </ul>
      )}

      {/* ── Из чего сложилось время ── */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium text-foreground">Из чего сложилось время</div>
        {data.explanation.map((item) => (
          <div key={item.kind} className="flex items-start gap-2 text-[11px]">
            <span className="w-[110px] shrink-0 text-muted-foreground">{item.label}</span>
            <span className="font-medium tabular-nums">
              {item.factor === 1 ? "—" : `×${item.factor.toFixed(2)}`}
            </span>
            <span className="min-w-0 flex-1 text-muted-foreground">{item.detail}</span>
          </div>
        ))}
      </div>

      {/* ── Сегменты: класс дороги и момент прохождения ── */}
      <details className="text-[11px]">
        <summary className="cursor-pointer text-muted-foreground">
          Сегменты маршрута ({data.segments.length})
        </summary>
        <div className="mt-2 space-y-1">
          {data.segments.map((segment) => (
            <div
              key={segment.index}
              className={`flex items-center gap-2 rounded px-1.5 py-1 ${
                segment.blocked ? "bg-destructive/10 text-destructive" : ""
              }`}
            >
              <span className="w-6 shrink-0 text-muted-foreground tabular-nums">
                {segment.index + 1}
              </span>
              <span className="w-[130px] shrink-0 truncate">
                {segment.roadName || segment.roadClassLabel}
              </span>
              <span className="w-[70px] shrink-0 text-muted-foreground">
                {formatKm(segment.distanceM)}
              </span>
              <span className="w-[70px] shrink-0 text-muted-foreground tabular-nums">
                {Math.round(segment.baseSpeedKmh)} км/ч
              </span>
              <span className="w-[80px] shrink-0 tabular-nums">{formatDuration(segment.drivingSec)}</span>
              {segment.weather && segment.weather.factor !== 1 && (
                <span className="text-muted-foreground">{segment.weather.label}</span>
              )}
              {segment.totalFactor !== 1 && (
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  ×{segment.totalFactor.toFixed(2)}
                </span>
              )}
              {segment.blocked && <span className="ml-auto shrink-0">перекрыто</span>}
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
