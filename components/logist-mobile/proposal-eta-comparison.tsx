// components/logist-mobile/proposal-eta-comparison.tsx
//
// Сравнение «до/после» для предложения помощника.
//
// Показывает, что изменится, если собрать заказы в один рейс: длина,
// время движения, операции, перерывы, длительность, возврат на базу и
// нарушения сроков.
//
// Данные приходят с POST /api/logist-mobile/assistant/compare — тот же
// единый механизм ETA, что у кабинета водителя и карты логиста. Своей
// формулы в браузере нет: иначе помощник обещал бы одно время, а водитель
// увидел бы другое.
//
// Расчёт НЕ создаёт записей в базе: рейс появится только после нажатия
// «Предложить рейс».

"use client"

import { useEffect, useState } from "react"

import { AlertTriangle, ArrowRight, Loader2, Minus, TrendingDown, TrendingUp } from "lucide-react"

import { apiSend } from "@/hooks/use-json-api"

interface EtaSummary {
  distanceKm: number
  drivingSec: number
  stopsSec: number
  restSec: number
  totalSec: number
  returnToBase: boolean
  estimatedLegs: number
}

interface EtaDelta {
  label: string
  before: number
  after: number
  delta: number
  lowerIsBetter: boolean
  unit: "km" | "min"
  why: string
}

interface Comparison {
  before: EtaSummary
  after: EtaSummary
  beforeNote: string
  deltas: EtaDelta[]
  deadlineViolations: Array<{ orderId: string; routeTo: string; deadline: string; arrivalAt: string }>
  explanations: string[]
  baseKnown: boolean
  geocodedPoints: number
}

export interface ProposalEtaComparisonProps {
  orderIds: string[]
  vehicleId?: string | null
}

/** «2 ч 15 мин» из секунд. */
function human(sec: number): string {
  const minutes = Math.round(sec / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} мин`
  if (rest === 0) return `${hours} ч`
  return `${hours} ч ${rest} мин`
}

/** «2 145 км» или «4 ч 30 мин» — в зависимости от единицы показателя. */
function format(value: number, unit: "km" | "min"): string {
  if (unit === "km") return `${value.toLocaleString("ru-RU")} км`
  return human(value * 60)
}

export function ProposalEtaComparison({ orderIds, vehicleId }: ProposalEtaComparisonProps) {
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Ключ набора заказов: сравниваем заново только когда состав изменился
  const key = orderIds.join(",")

  useEffect(() => {
    if (orderIds.length === 0) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const result = await apiSend<Comparison>(
        "/api/logist-mobile/assistant/compare",
        "POST",
        { orderIds, vehicleId: vehicleId ?? null },
      )
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        setError(result.error || "Не удалось сравнить")
        return
      }
      setComparison(result.data ?? null)
    }

    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, vehicleId])

  if (orderIds.length === 0) return null

  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-[12.5px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Считаю, что изменится…
      </div>
    )
  }

  if (error) {
    return (
      <p className="mt-3 rounded-xl bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
        Сравнение недоступно: {error}
      </p>
    )
  }

  if (!comparison) return null

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium">Что изменится</p>
        <p className="text-[11px] text-muted-foreground">
          по отдельности → одним рейсом
        </p>
      </div>

      {/* ── Нарушения сроков: главное предупреждение ── */}
      {comparison.deadlineViolations.length > 0 ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Срок будет нарушен у {comparison.deadlineViolations.length} заказ(ов): доставка позже
            согласованной даты. Начните рейс раньше или не берите эти заказы в него.
          </span>
        </p>
      ) : null}

      {/* ── Показатели ── */}
      <div className="space-y-1.5">
        {comparison.deltas.map((delta) => {
          const better = delta.delta === 0 ? null : delta.delta < 0 === delta.lowerIsBetter
          const Icon = delta.delta === 0 ? Minus : delta.delta < 0 ? TrendingDown : TrendingUp
          return (
            <div key={delta.label} className="flex items-center gap-2 text-[12.5px]">
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${
                  better === null
                    ? "text-muted-foreground"
                    : better
                      ? "text-success"
                      : "text-warning"
                }`}
              />
              <span className="w-[92px] shrink-0 text-muted-foreground">{delta.label}</span>
              <span className="tabular-nums">{format(delta.before, delta.unit)}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="font-medium tabular-nums">{format(delta.after, delta.unit)}</span>
              <span
                className={`ml-auto shrink-0 tabular-nums ${
                  better === null
                    ? "text-muted-foreground"
                    : better
                      ? "text-success"
                      : "text-warning"
                }`}
              >
                {delta.delta === 0
                  ? "без изменений"
                  : `${delta.delta > 0 ? "+" : ""}${format(delta.delta, delta.unit)}`}
              </span>
            </div>
          )
        })}
      </div>

      {/* ── Почему изменилось ── */}
      {comparison.explanations.length > 0 ? (
        <details className="text-[12px] text-muted-foreground">
          <summary className="cursor-pointer">Почему так</summary>
          <ul className="mt-1 space-y-1 pl-4">
            {comparison.explanations.map((line) => (
              <li key={line} className="list-disc">
                {line}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* ── Возврат на базу ── */}
      <p className="text-[11.5px] text-muted-foreground">
        {comparison.after.returnToBase
          ? "Возврат на базу входит в рейс."
          : "База не указана в настройках парка — возврат на базу не считается."}
      </p>

      {/* ── Честность прогноза ── */}
      {comparison.after.estimatedLegs > 0 ? (
        <p className="text-[11.5px] text-muted-foreground">
          У {comparison.after.estimatedLegs} плеч(а) расстояние оценено по прямой: маршрутизатор не
          построил геометрию, цифры грубее.
        </p>
      ) : null}
      {comparison.geocodedPoints === 0 ? (
        <p className="text-[11.5px] text-warning">
          Адреса заказов не определены на карте — сравнение неточное. Уточните адреса.
        </p>
      ) : null}

      <p className="text-[11px] text-muted-foreground">{comparison.beforeNote}</p>
    </div>
  )
}
