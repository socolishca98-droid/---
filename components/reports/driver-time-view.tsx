// components/reports/driver-time-view.tsx
//
// Отчёт «Время водителей»: сколько ехал, сколько стоял на погрузке, сколько
// ждал у ворот, сколько отдыхал.
//
// Данные — из GET /api/reports/shift-time (журнал кнопок водителя). Период
// переключается пресетами, как в основном отчёте.

"use client"

import { useCallback, useEffect, useState } from "react"

import { Coffee, Fuel, Package, Timer, Truck, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatDuration, type ShiftBucket } from "@/lib/shift/timeline"
import { bucketShare, type DriverTimeRow, type ShiftTimeReport } from "@/lib/analytics/shift-time"

const PRESETS = [
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
  { id: "90d", label: "90 дней" },
  { id: "month", label: "Этот месяц" },
] as const

const BUCKET_ROWS: { bucket: ShiftBucket; label: string; icon: typeof Truck }[] = [
  { bucket: "driving", label: "В пути", icon: Truck },
  { bucket: "loading", label: "Погрузка", icon: Package },
  { bucket: "unloading", label: "Выгрузка", icon: Package },
  { bucket: "waiting", label: "Ожидание", icon: Timer },
  { bucket: "resting", label: "Отдых", icon: Coffee },
  { bucket: "fueling", label: "Заправка", icon: Fuel },
]

export function DriverTimeView() {
  const [preset, setPreset] = useState<string>("30d")
  const [report, setReport] = useState<ShiftTimeReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (value: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reports/shift-time?preset=${value}`)
      const data = await res.json()
      if (data.success) {
        setReport(data.report)
      } else {
        setError(data.error || "Не удалось загрузить отчёт")
      }
    } catch {
      setError("Ошибка связи")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(preset)
  }, [preset, load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={preset === item.id ? "default" : "outline"}
            onClick={() => setPreset(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading && !report && <p className="text-sm text-muted-foreground">Считаем время…</p>}

      {report && report.drivers.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            За период нет смен с отметками статусов. Как только водители начнут отмечать
            «погрузка», «выгрузка» и «отдых» в приложении, здесь появятся цифры.
          </p>
        </div>
      )}

      {report && report.drivers.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TotalCard label="Учтённого времени" seconds={sumBucket(report.totals)} />
            <TotalCard
              label="На погрузке"
              seconds={report.totals.loading.seconds}
              hint={`${report.totals.loading.stops} погрузок`}
            />
            <TotalCard
              label="На выгрузке"
              seconds={report.totals.unloading.seconds}
              hint={`${report.totals.unloading.stops} выгрузок`}
            />
            <TotalCard
              label="Простои и ожидание"
              seconds={report.totals.waiting.seconds}
              hint={`${report.totals.waiting.stops} простоев`}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Водитель</th>
                  <th className="px-3 py-2 text-right">Смен</th>
                  {BUCKET_ROWS.map((row) => (
                    <th key={row.bucket} className="px-3 py-2 text-right">
                      {row.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Всего</th>
                </tr>
              </thead>
              <tbody>
                {report.drivers.map((row) => (
                  <tr key={row.driverId} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{row.driverName}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{row.shifts}</td>
                    {BUCKET_ROWS.map((item) => (
                      <td key={item.bucket} className="px-3 py-2 text-right tabular-nums">
                        <span title={`${row.buckets[item.bucket].stops} отрезков`}>
                          {formatDuration(row.buckets[item.bucket].seconds)}
                        </span>
                        {row.buckets[item.bucket].stops > 0 && (
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            ×{row.buckets[item.bucket].stops}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatDuration(row.totalSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Средние длины остановок — по ним видно, где теряется время */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {report.drivers.map((row) => (
              <DriverCard key={row.driverId} row={row} />
            ))}
          </div>

          {report.shiftsWithoutEvents > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Смен без отметок статусов: {report.shiftsWithoutEvents} из {report.shiftsCount}.
              Время в них не измерено — попросите водителей отмечать статусы в приложении.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function DriverCard({ row }: { row: DriverTimeRow }) {
  const total = Math.max(1, row.totalSeconds)
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="truncate text-sm font-medium">{row.driverName}</p>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <dt>Средняя погрузка</dt>
          <dd className="tabular-nums text-foreground">{formatDuration(row.avgLoadingSeconds)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Самая долгая погрузка</dt>
          <dd className="tabular-nums text-foreground">{formatDuration(row.maxLoadingSeconds)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Средняя выгрузка</dt>
          <dd className="tabular-nums text-foreground">{formatDuration(row.avgUnloadingSeconds)}</dd>
        </div>
      </dl>
      {/* Полоски долей: видно, во что уходит смена */}
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
        {BUCKET_ROWS.filter((item) => row.buckets[item.bucket].seconds > 0).map((item) => (
          <span
            key={item.bucket}
            className={barColor(item.bucket)}
            style={{ width: `${bucketShare(row.buckets[item.bucket].seconds, total)}%` }}
            title={`${item.label}: ${formatDuration(row.buckets[item.bucket].seconds)}`}
          />
        ))}
      </div>
    </div>
  )
}

function TotalCard({ label, seconds, hint }: { label: string; seconds: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{formatDuration(seconds)}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function sumBucket(totals: ShiftTimeReport["totals"]): number {
  return Object.values(totals).reduce((sum, entry) => sum + entry.seconds, 0)
}

function barColor(bucket: ShiftBucket): string {
  switch (bucket) {
    case "driving":
      return "bg-orange-500"
    case "loading":
      return "bg-blue-500"
    case "unloading":
      return "bg-emerald-500"
    case "waiting":
      return "bg-gray-500"
    case "resting":
      return "bg-amber-500"
    case "fueling":
      return "bg-purple-500"
    default:
      return "bg-muted"
  }
}
