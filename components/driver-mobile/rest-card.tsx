// components/driver-mobile/rest-card.tsx
//
// Нормы отдыха: сколько осталось до обязательного перерыва и засчитается ли
// текущий.
//
// Раньше этот блок жил внутри огромной страницы и показывался только при
// активном рейсе. Теперь это отдельная карточка: её видно всегда, когда смена
// идёт, и она сама решает, что сказать — «ехать ещё 2 ч 10 мин», «пора
// отдохнуть» или «перерыв идёт, зачтётся с 45 мин».

"use client"

import { AlertCircle, Coffee, Moon } from "lucide-react"

import { formatDuration } from "@/lib/shift/timeline"

export interface RestCardProps {
  resting: boolean
  restDue: boolean
  /** Непрерывное время за рулём, минуты */
  drivingMinutes: number
  /** Минут до напоминания об отдыхе */
  minutesToRest: number
  /** Длительность текущего перерыва, минуты */
  currentBreakMin: number
  /** Перерыв уже засчитывается по норме */
  breakCounts: boolean
  /** Норма непрерывного вождения, минуты */
  limitMin: number
  /** Минимальная длина перерыва, минуты */
  minBreakMin: number
}

export function RestCard({
  resting,
  restDue,
  drivingMinutes,
  minutesToRest,
  currentBreakMin,
  breakCounts,
  limitMin,
  minBreakMin,
}: RestCardProps) {
  const driven = Math.max(0, Math.round(drivingMinutes))
  const progress = Math.min(100, Math.max(0, (driven / Math.max(1, limitMin)) * 100))

  const barColor = restDue && !resting ? "bg-red-500" : minutesToRest <= 30 ? "bg-amber-500" : "bg-green-500"

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {resting ? (
            <Coffee className="h-4 w-4 text-amber-400" />
          ) : (
            <Moon className="h-4 w-4 text-indigo-400" />
          )}
          <h2 className="text-sm font-semibold">Отдых и норма</h2>
        </div>
        <span className="text-[11px] text-gray-500">
          норма {formatDuration(limitMin * 60)} без перерыва
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>За рулём без перерыва</span>
          <span className="font-mono tabular-nums">{formatDuration(driven * 60)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${progress}%` }} />
        </div>
      </div>

      {resting ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-300">
          <Coffee className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Перерыв идёт: {currentBreakMin} мин
            {breakCounts
              ? " — засчитан, можно продолжать"
              : ` — зачтётся с ${minBreakMin} мин`}
          </span>
        </p>
      ) : restDue ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Пора отдохнуть: нажмите «Отдых», время за рулём обнулится</span>
        </p>
      ) : (
        <p className="mt-3 text-xs text-gray-500">
          До обязательного перерыва: {formatDuration(minutesToRest * 60)}. Перерыв от{" "}
          {minBreakMin} мин засчитывается автоматически.
        </p>
      )}
    </section>
  )
}
