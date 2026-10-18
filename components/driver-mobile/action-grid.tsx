// components/driver-mobile/action-grid.tsx
//
// Кнопки состояний водителя: в пути, погрузка, выгрузка, ожидание, заправка,
// отдых, сон.
//
// Это не декоративные кнопки: каждое нажатие пишет событие в журнал смены,
// из которого потом считают, сколько водитель простоял на погрузке и сколько
// ждал у ворот. Поэтому:
//   * у активного статуса видно, сколько он уже длится;
//   * следующий по рейсу шаг подсвечен — водитель не думает, что жать;
//   * «Отдых» переключается в «Завершить отдых» и возвращает прежний статус;
//   * после погрузки/выгрузки/заправки рядом появляется кнопка фото.

"use client"

import { Camera, Check, Coffee, Fuel, Moon, Package, Truck, Wrench } from "lucide-react"

import { formatClock, shiftStatusMeta, suggestedNext } from "@/lib/shift/timeline"

export interface ActionGridProps {
  /** Текущий статус смены */
  status: string
  /** Секунд в текущем статусе */
  statusSeconds: number
  /** Есть активный рейс — без него часть кнопок недоступна */
  hasActiveTrip: boolean
  /** Текущая точка рейса — догруз, чтобы подписать кнопку */
  currentPointIsAdditional?: boolean
  /** Идёт отдых прямо сейчас */
  resting: boolean
  /** Длительность текущего перерыва, минуты */
  currentBreakMin: number
  /** Перерыв засчитывается по норме */
  breakCounts: boolean
  /** Минимальная длина перерыва по норме */
  minBreakMin: number
  disabled?: boolean
  /** "__rest_end__" — завершить перерыв и вернуться к прежнему занятию */
  onSelect: (statusId: string) => void
  onPhoto: (context: string) => void
  onMaintenance: () => void
}

/** Порядок кнопок = порядок работы рейса. */
const ACTION_ORDER = [
  "driving",
  "loading",
  "unloading",
  "waiting_point",
  "fueling",
  "resting",
  "sleeping",
] as const

const ICONS: Record<string, typeof Truck> = {
  driving: Truck,
  loading: Package,
  unloading: Package,
  waiting_point: Check,
  fueling: Fuel,
  resting: Coffee,
  sleeping: Moon,
}

export function ActionGrid({
  status,
  statusSeconds,
  hasActiveTrip,
  currentPointIsAdditional,
  resting,
  currentBreakMin,
  breakCounts,
  minBreakMin,
  disabled,
  onSelect,
  onPhoto,
  onMaintenance,
}: ActionGridProps) {
  const next = suggestedNext(status)

  const handleClick = (statusId: string) => {
    if (statusId === "resting" && resting) {
      // Завершение перерыва: возвращаемся к тому, чем занимались
      onSelect("__rest_end__")
      return
    }
    onSelect(statusId)
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">Что делаете</h2>
        <span className="text-[11px] text-gray-600">Время пишется в отчёт</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {ACTION_ORDER.map((statusId) => {
          const meta = shiftStatusMeta(statusId)
          if (!meta) return null
          const Icon = ICONS[statusId] ?? Truck
          const isActive = status === statusId
          const isRestingButton = statusId === "resting"
          const restActive = isRestingButton && resting
          const isSuggested = !isActive && !restActive && next.includes(statusId)

          // Без рейса бессмысленно ехать и грузиться: точки ещё нет
          const pointOnly =
            statusId === "driving" || statusId === "loading" || statusId === "unloading"
          const blocked = pointOnly && !hasActiveTrip

          const label =
            isRestingButton && resting
              ? breakCounts
                ? "Завершить отдых"
                : `Отдых ${currentBreakMin}/${minBreakMin} мин`
              : meta.label

          const photoContext =
            statusId === "loading"
              ? "loading"
              : statusId === "unloading"
                ? "unloading"
                : statusId === "fueling"
                  ? "fueling"
                  : null

          return (
            <div key={statusId} className="space-y-1">
              <button
                type="button"
                onClick={() => handleClick(statusId)}
                disabled={disabled || blocked}
                className={`relative flex min-h-[68px] w-full flex-col items-center justify-center gap-1 rounded-xl border p-2 text-xs font-medium transition-colors active:opacity-70 disabled:opacity-40 ${
                  isActive || restActive
                    ? "border-orange-500/60 bg-orange-500/15 text-orange-300"
                    : isSuggested
                      ? "border-gray-700 bg-gray-900 text-gray-200"
                      : "border-gray-800 bg-gray-900/60 text-gray-400"
                }`}
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-full ${meta.color}`}>
                  <Icon className="h-4 w-4 text-white" />
                </span>
                <span className="text-center leading-tight">{label}</span>

                {statusId === "loading" && currentPointIsAdditional && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-sky-300">
                    догруз
                  </span>
                )}

                {isSuggested && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-orange-300">
                    далее
                  </span>
                )}

                {(isActive || restActive) && (
                  <span className="font-mono text-[11px] tabular-nums text-orange-200/80">
                    {formatClock(statusSeconds)}
                  </span>
                )}
              </button>

              {photoContext && hasActiveTrip && (
                <button
                  type="button"
                  onClick={() => onPhoto(photoContext)}
                  className="flex min-h-[34px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900/40 text-[11px] text-gray-400 active:opacity-70"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Фото {statusId === "fueling" ? "чека" : "груза"}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* ТО / ремонт — отдельный сценарий со своей формой, не статус смены */}
      <button
        type="button"
        onClick={onMaintenance}
        disabled={disabled}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-gray-700 bg-gray-900/60 text-sm text-gray-300 active:opacity-70 disabled:opacity-40"
      >
        <Wrench className="h-4 w-4 text-amber-400" />
        Отметить ТО / ремонт
      </button>
    </section>
  )
}
