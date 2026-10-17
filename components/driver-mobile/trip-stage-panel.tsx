// components/driver-mobile/trip-stage-panel.tsx
//
// Активный рейс водителя: текущий этап, кнопки по нему и прогноз.
//
// Почему отдельный компонент: главный экран водителя (app/m/page.tsx) уже
// больше тысячи строк и отвечает за смену, GPS, фото и догрузы. Логика
// исполнения рейса живёт здесь, чтобы не мешать остальному.
//
// Откуда берутся кнопки: с сервера (POST /api/m/route/stage возвращает
// actions). Браузер НЕ решает сам, что доступно — он только рисует то, что
// сказал сервер. Поэтому кнопка, нажатая у водителя, не может быть
// отклонена: правила показа и правила проверки — один модуль
// lib/eta/trip-actions.ts.
//
// Откуда берётся прогноз: GET /api/m/route → блок trip. Он считается единым
// механизмом lib/eta/trip.ts — тем же, что у карты логиста
// (GET /api/routes/[routeId]/trip). Своей формулы ETA в браузере нет и быть
// не должно.

"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  Package,
  Play,
  RotateCcw,
} from "lucide-react"

/** Кнопка, которую разрешил сервер. */
interface ServerAction {
  command: string
  label: string
  danger?: boolean
  primary?: boolean
}

interface TripStage {
  index: number
  kind: string
  label: string
  status: "planned" | "active" | "completed"
  address?: string
  actualStartAt: string | null
  actualEndAt: string | null
}

interface TripData {
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
  completionAt: string
  /** Обязательные перерывы — когда именно остановиться */
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
  stages: TripStage[]
  dataQuality: string[]
  /** Надёжность прогноза: false — время прибытия нельзя использовать как ориентир */
  reliable?: boolean
  /** Почему прогноз ненадёжен (геокодер не справился, рейс завершён, …) */
  reliabilityNote?: string | null
}

export interface TripStagePanelProps {
  routeId: string | null
  /**
   * Прогноз рейса с сервера (из GET /api/m/route — тот же единый механизм,
   * что у карты логиста). Кнопки и этапы рисуются по этим данным:
   * браузер сам не решает, что доступно.
   */
  trip: {
    currentStageIndex: number | null
    finished: boolean
    actions: ServerAction[]
    blocked: Array<{ command: string; reason: string }>
    nextPoint: TripData["nextPoint"]
    remaining: TripData["remaining"]
    returnToBase: TripData["returnToBase"]
    completionAt: string
    stages: TripStage[]
    dataQuality: string[]
    /**
     * Надёжность прогноза и причина её отсутствия. false + note — водителю
     * нельзя показывать «приеду в 00:45» как ориентир: геокодер мог не
     * определить часть адресов, и маршрут построен короче реального.
     */
    reliable?: boolean
    reliabilityNote?: string | null
    /** Признак того, что расстояние плеча оценено, а не построено */
    sources?: string[]
    startedAt?: string | null
  } | null
  /** Перезагрузить данные рейса после команды */
  onRefresh?: () => void | Promise<void>
}

/** «2 ч 15 мин» из секунд. */
function humanDuration(sec: number): string {
  const minutes = Math.round(sec / 60)
  if (minutes < 1) return "меньше минуты"
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} мин`
  if (rest === 0) return `${hours} ч`
  return `${hours} ч ${rest} мин`
}

/** «через 2 ч 15 мин» относительно сейчас. */
function until(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now()
  if (diffMs <= 0) return "сейчас"
  return `через ${humanDuration(diffMs / 1000)}`
}

function stageIcon(kind: string, status: string) {
  if (status === "completed") return <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
  if (kind === "loading") return <Package className="h-4 w-4 shrink-0 text-orange-400" />
  if (kind === "unloading") return <Package className="h-4 w-4 shrink-0 text-sky-400" />
  if (kind === "return_to_base") return <RotateCcw className="h-4 w-4 shrink-0 text-sky-400" />
  return <Navigation className="h-4 w-4 shrink-0 text-gray-400" />
}

export function TripStagePanel({ routeId, trip: tripProp, onRefresh }: TripStagePanelProps) {
  // Локальная копия: после команды сервер присылает новое состояние, и
  // экран обновляется сразу, не дожидаясь следующего опроса
  const [trip, setTrip] = useState<TripData | null>(tripProp as unknown as TripData | null)
  const [actions, setActions] = useState<ServerAction[]>(tripProp?.actions ?? [])
  const [currentStageIndex, setCurrentStageIndex] = useState<number | null>(
    tripProp?.currentStageIndex ?? null,
  )
  const [sending, setSending] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // id последней отправленной команды: повторный тап по кнопке не создаст
  // вторую отметку (сервер тоже проверяет, но лишний запрос не нужен)
  const lastSentRef = useRef<string | null>(null)

  useEffect(() => {
    if (!tripProp) return
    setTrip(tripProp as unknown as TripData)
    setActions(tripProp.actions ?? [])
    setCurrentStageIndex(tripProp.currentStageIndex ?? null)
  }, [tripProp])

  const refresh = useCallback(async () => {
    await onRefresh?.()
  }, [onRefresh])

  const send = useCallback(
    async (command: string, label: string) => {
      if (!routeId || sending) return
      // Защита от двойного тапа: та же команда подряд не отправляется
      const guard = `${command}:${label}`
      if (lastSentRef.current === guard && sending) return

      setSending(command)
      setError(null)
      setMessage(null)
      lastSentRef.current = guard

      try {
        const res = await fetch("/api/m/route/stage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId,
            command,
            clientEventId: `${routeId}-${command}-${Date.now()}`,
          }),
        })
        const data = await res.json()

        if (!res.ok) {
          setError(data.error || "Команда не выполнена")
          return
        }
        if (data.duplicate) {
          setMessage("Уже принято ранее")
          return
        }
        setMessage(data.message || "Принято")
        if (Array.isArray(data.actions)) {
          setActions(data.actions)
          setCurrentStageIndex(data.currentStageIndex ?? null)
        }
        if (Array.isArray(data.stages)) {
          setTrip((prev) => (prev ? { ...prev, stages: data.stages } : prev))
        }
        if (data.remaining) {
          setTrip((prev) => (prev ? { ...prev, remaining: data.remaining } : prev))
        }
        await refresh()
      } catch {
        setError("Нет связи. Повторите, когда сеть вернётся")
      } finally {
        setSending(null)
      }
    },
    [routeId, sending, refresh],
  )

  // Проблема — отдельной кнопкой, чтобы не мешать основным действиям
  const reportProblem = useCallback(async () => {
    if (!routeId || sending) return
    setSending("report_problem")
    setError(null)
    try {
      const res = await fetch("/api/m/route/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeId,
          command: "report_problem",
          note: "Водитель сообщил о проблеме",
        }),
      })
      const data = await res.json()
      if (res.ok) setMessage(data.message || "Проблема передана логисту")
      else setError(data.error || "Не удалось передать")
    } catch {
      setError("Нет связи. Повторите, когда сеть вернётся")
    } finally {
      setSending(null)
    }
  }, [routeId, sending])

  if (!routeId) return null

  const currentStage = currentStageIndex == null ? null : trip?.stages[currentStageIndex] ?? null

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      {/* ── Заголовок: что сейчас ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-orange-400" />
          <span className="truncate text-sm font-medium">
            {currentStage ? currentStage.label : "Рейс"}
          </span>
        </div>
        {trip?.remaining ? (
          <span className="shrink-0 text-xs text-gray-500">
            осталось {humanDuration(trip.remaining.totalSec)}
          </span>
        ) : null}
      </div>

      {/* ── Куда едем и когда прибудем (единый прогноз, тот же что у логиста) ── */}
      {trip?.nextPoint ? (
        <div className="rounded-xl bg-gray-800/50 px-3 py-2">
          <p className="text-xs text-gray-500">Следующая точка</p>
          <p className="truncate text-sm font-medium">{trip.nextPoint.address}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            {trip.nextPoint.operation} • {until(trip.nextPoint.arrivalAt)}
            {trip.nextPoint.distanceM
              ? ` • ${(trip.nextPoint.distanceM / 1000).toFixed(0)} км`
              : ""}
          </p>
        </div>
      ) : null}

      {/* ── Обязательные перерывы: когда именно остановиться ── */}
      {trip?.restPlan && trip.restPlan.breaks.length > 0 ? (
        <div className="rounded-xl bg-gray-800/50 px-3 py-2">
          <p className="text-xs text-gray-500">
            Обязательные перерывы ({trip.restPlan.breaks.length})
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {trip.restPlan.breaks.slice(0, 3).map((rest, index) => (
              <li key={`${rest.afterStageIndex}-${index}`} className="flex justify-between text-xs">
                <span className="text-gray-400">
                  {rest.kind === "daily_rest" ? "отдых" : "перерыв"} {rest.minutes} мин
                </span>
                <span className="text-gray-300">{until(rest.startAt)}</span>
              </li>
            ))}
            {trip.restPlan.breaks.length > 3 ? (
              <li className="text-xs text-gray-500">…и ещё {trip.restPlan.breaks.length - 3}</li>
            ) : null}
          </ul>
          {trip.restPlan.warning ? (
            <p className="mt-1 text-xs text-orange-400">{trip.restPlan.warning}</p>
          ) : null}
        </div>
      ) : null}

      {/* ── Возврат на базу ── */}
      {trip?.returnToBase ? (
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          Возврат на базу: {until(trip.returnToBase.arrivalAt)}
        </p>
      ) : null}

      {/* ── Кнопки текущего этапа ── */}
      {actions.length > 0 ? (
        <div className="space-y-2">
          {actions
            .filter((action) => action.command !== "report_problem")
            .map((action) => (
              <button
                key={action.command}
                type="button"
                onClick={() => void send(action.command, action.label)}
                disabled={sending !== null}
                className={`flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl font-semibold active:opacity-80 disabled:opacity-50 ${
                  action.danger
                    ? "border border-red-500/30 bg-red-500/10 text-red-400"
                    : action.primary
                      ? "bg-green-600 text-white"
                      : "border border-gray-700 bg-gray-900 text-gray-200"
                }`}
              >
                {sending === action.command ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {sending === action.command ? "Отправляем..." : action.label}
              </button>
            ))}

          <button
            type="button"
            onClick={() => void reportProblem()}
            disabled={sending !== null}
            className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-sm font-medium text-amber-400 active:opacity-70 disabled:opacity-50"
          >
            <AlertCircle className="h-4 w-4" />
            {sending === "report_problem" ? "Отправляем..." : "Сообщить о проблеме"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          Действия появятся, когда логист назначит рейс и вы начнёте его.
        </p>
      )}

      {message ? <p className="text-xs text-green-400">{message}</p> : null}
      {error ? (
        <p className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {/* ── Этапы рейса с фактическими отметками ── */}
      {trip && trip.stages.length > 0 ? (
        <div className="space-y-1 border-t border-gray-800 pt-3">
          <p className="text-xs text-gray-500">Этапы рейса</p>
          {trip.stages.map((stage) => (
            <div key={stage.index} className="flex items-center gap-2 py-1">
              {stageIcon(stage.kind, stage.status)}
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-xs ${
                    stage.status === "completed" ? "text-gray-500" : "text-gray-300"
                  }`}
                >
                  {stage.index + 1}. {stage.label}
                  {stage.address ? ` — ${stage.address}` : ""}
                </p>
                {stage.actualStartAt ? (
                  <p className="text-[11px] text-gray-600">
                    {new Date(stage.actualStartAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {stage.actualEndAt
                      ? ` — ${new Date(stage.actualEndAt).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : " — идёт"}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Время прибытия недостоверно: говорим прямо ── */}
      {/* Предупреждения ниже перечисляют причины мелким шрифтом; здесь —
          главный вердикт, чтобы число «приеду в ...» не читалось как обещание. */}
      {trip && trip.reliable === false ? (
        <p className="flex items-start gap-1.5 border-t border-gray-800 pt-2 text-[11px] text-red-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Время прибытия недостоверно
          {trip.reliabilityNote ? `: ${trip.reliabilityNote}` : "."}
        </p>
      ) : null}

      {/* ── Честное предупреждение о качестве данных ── */}
      {trip && trip.dataQuality.length > 0 ? (
        <p className="flex items-start gap-1.5 border-t border-gray-800 pt-2 text-[11px] text-amber-400/80">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          {trip.dataQuality.join("; ")}
        </p>
      ) : null}
    </div>
  )
}
