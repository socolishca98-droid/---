// components/driver-mobile/control-panel.tsx
//
// Пульт водителя: чем занят сейчас + на каком шаге рейса + живой таймер.
//
// Зачем отдельный компонент: это главный экран кабины. Водитель смотрит на
// него одной рукой, часто в перчатках, и должен сразу понимать три вещи —
// что он делает, сколько это длится и что дальше по рейсу. Поэтому крупная
// подпись, крупный таймер и полоска шагов, а не таблица со статусами.

"use client"

import { useEffect, useState } from "react"

import { Coffee, Moon, Package, PauseCircle, Truck } from "lucide-react"

import {
  TRIP_FLOW,
  formatClock,
  shiftStatusMeta,
  suggestedNext,
  tripStep,
  type ShiftBucket,
  type ShiftTotals,
} from "@/lib/shift/timeline"

/** Шаги рейса для полоски прогресса: путь → погрузка → путь → выгрузка. */
const FLOW_STEPS = [
  { id: "driving", label: "В пути", icon: Truck },
  { id: "loading", label: "Погрузка", icon: Package },
  { id: "driving-to", label: "В пути", icon: Truck },
  { id: "unloading", label: "Выгрузка", icon: Package },
] as const

export interface ControlPanelProps {
  /** Текущий статус смены */
  status: string
  /** Секунд в текущем статусе на момент последнего ответа сервера */
  statusSeconds: number
  /** Итоги за смену — для живой строки под таймером */
  totals: ShiftTotals
  /** Идёт ли рейс (есть открытые точки) */
  hasActiveTrip: boolean
  /** Рейс есть, но все точки закрыты — работа выполнена */
  tripFinished?: boolean
  /** Сколько точек рейса закрыто */
  closedPoints?: number
  /** Сколько всего точек */
  totalPoints?: number
  /**
   * Следующий пункт рейса словами («Погрузка · Ярославль»). Строится из точек
   * рейса, а не из статусов смены: раньше здесь стояло «В пути → Отдых →
   * Заправка», и водитель читал отдых с заправкой как обязательные этапы рейса.
   */
  nextStopLabel?: string | null
}

export function ControlPanel({
  status,
  statusSeconds,
  totals,
  hasActiveTrip,
  tripFinished,
  closedPoints,
  totalPoints,
  nextStopLabel,
}: ControlPanelProps) {
  // Таймер тикает локально: ждать ответа сервера каждую секунду незачем,
  // а водителю нужны точные секунды на погрузке.
  const [elapsed, setElapsed] = useState(statusSeconds)

  useEffect(() => {
    setElapsed(statusSeconds)
  }, [statusSeconds, status])

  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const meta = shiftStatusMeta(status)
  const step = tripStep(status)
  const next = suggestedNext(status).slice(0, 3)
  const statusColor = meta?.color ?? "bg-gray-600"

  const StatusIcon = status === "resting" ? Coffee : status === "sleeping" ? Moon : Truck

  const liveTotals = liveTotalsFor(status, totals, elapsed)

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${statusColor}`}>
            <StatusIcon className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-gray-500">Сейчас</p>
            <p className="truncate text-lg font-bold leading-tight">{meta?.label ?? status}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-2xl font-bold tabular-nums text-orange-400">
            {formatClock(elapsed)}
          </p>
          <p className="text-[11px] text-gray-500">в этом статусе</p>
        </div>
      </div>

      {/* Подсказка под статусом. Раньше здесь всегда стояло «Смена идёт,
          задания нет» — даже когда на экране висела карточка назначенного
          рейса, и это было прямым противоречием. */}
      <p className="mt-2 text-xs text-gray-500">
        {status === "waiting" && tripFinished
          ? "Рейс выполнен, ждём новое задание"
          : status === "waiting" && hasActiveTrip
            ? "Рейс назначен — начните его кнопкой ниже"
            : meta?.hint}
      </p>

      {/* Полоска шагов рейса — где я в цепочке «путь → погрузка → выгрузка» */}
      {hasActiveTrip && step > 0 && (
        <ol className="mt-4 flex items-center gap-1">
          {FLOW_STEPS.map((flowStep, index) => {
            const active = index + 1 === step
            const done = index + 1 < step
            const Icon = flowStep.icon
            return (
              <li key={`${flowStep.id}-${index}`} className="flex flex-1 items-center gap-1">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    active
                      ? "border-orange-500 bg-orange-500/20 text-orange-300"
                      : done
                        ? "border-green-500/40 bg-green-500/10 text-green-400"
                        : "border-gray-800 bg-gray-900 text-gray-600"
                  }`}
                  title={flowStep.label}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                {index < FLOW_STEPS.length - 1 && (
                  <span className={`h-0.5 flex-1 rounded ${done ? "bg-green-500/40" : "bg-gray-800"}`} />
                )}
              </li>
            )
          })}
        </ol>
      )}

      {/* Живая сводка за смену: цифры растут на глазах */}
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <LiveTotal label="В пути" seconds={liveTotals.driving} />
        <LiveTotal label="Погрузка" seconds={liveTotals.loading} />
        <LiveTotal label="Выгрузка" seconds={liveTotals.unloading} />
        <LiveTotal label="Ожидание" seconds={liveTotals.waiting} />
        <LiveTotal label="Отдых" seconds={liveTotals.resting} />
        <LiveTotal label="Заправка" seconds={liveTotals.fueling} />
      </dl>

      <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1">
          <PauseCircle className="h-3 w-3" />
          Смена идёт · цифры за смену
        </span>
        {/* Счётчик точек — только когда есть незакрытые: иначе «закрыто 1 из 1»
            висело на экране до начала рейса и читалось как «уже всё сделано». */}
        {hasActiveTrip &&
          typeof closedPoints === "number" &&
          typeof totalPoints === "number" &&
          totalPoints > 0 && (
            <span>
              Точек закрыто: {closedPoints} из {totalPoints}
            </span>
          )}
      </div>

      {/* Следующий пункт рейса — из точек рейса. Если сервер ещё не прислал
          этапы, показываем шаги смены, но подписываем их честно («по смене»). */}
      {hasActiveTrip && nextStopLabel && (
        <p className="mt-2 truncate text-[11px] text-gray-400">
          Следующий пункт: {nextStopLabel}
        </p>
      )}
      {hasActiveTrip && !nextStopLabel && next.length > 0 && (
        <p className="mt-2 text-[11px] text-gray-500">
          Дальше по смене:{" "}
          {next
            .map((id) => shiftStatusMeta(id)?.label ?? id)
            .join(" → ")}
        </p>
      )}
    </section>
  )
}

function LiveTotal({ label, seconds }: { label: string; seconds: number }) {
  return (
    <div className="rounded-xl bg-gray-900 px-1 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums text-gray-200">{formatClock(seconds)}</dd>
    </div>
  )
}

/**
 * Итоги с поправкой на текущий незакрытый статус: сервер присылает секунды
 * до последнего переключения, поэтому время текущего статуса добавляем сами.
 */
export function liveTotalsFor(
  status: string,
  totals: ShiftTotals,
  elapsedSeconds: number,
): ShiftTotals {
  const meta = shiftStatusMeta(status)
  if (!meta) return totals
  const bucket: ShiftBucket = meta.bucket
  const current = totals[bucket] ?? 0
  return { ...totals, [bucket]: current + Math.max(0, elapsedSeconds) }
}
